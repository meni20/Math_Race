import { Client, StompSubscription } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { useGameStore } from "../store/useGameStore";
import { isSoloRoomId, normalizePlayerId, normalizeRoomId } from "../utils/gameIds";
import { normalizeCarId } from "../utils/carSelection";
import type {
  AnswerFeedbackMessage,
  AnswerSubmissionRequest,
  ConnectPayload,
  DecisionChoiceRequest,
  DecisionPointMessage,
  GameStateUpdateMessage,
  JoinRoomRequest,
  QuestionMessage,
  RoomSettings,
  RoomJoinedMessage,
  CarId
} from "../types/messages";
import { DemoRaceClient } from "./demoRace";
import { isFirebaseClassroomEnabled } from "./firebaseClassroom";
import { SupabaseGameClient } from "./supabaseGame";
import { getConfiguredGameTransport, getGameBackendUrl } from "./transportConfig";

const WEBSOCKET_SESSION_STORAGE_KEY = "asphalt8.websocket.session";
const WEBSOCKET_RESUME_TOKEN_STORAGE_KEY = "asphalt8.websocket.resume-token";
const WEBSOCKET_SYNC_INTERVAL_MS = 1000;

interface GameErrorMessage {
  code?: string;
  message?: string;
  roomId?: string;
  playerId?: string;
}

interface StoredWebsocketSession {
  roomId: string;
  playerId: string;
  displayName: string;
  carId?: CarId;
}

function canUsePersistentStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function buildRandomToken(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}${crypto.randomUUID()}`;
  }
  return `${prefix}${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateWebsocketResumeToken() {
  if (!canUsePersistentStorage()) {
    return buildRandomToken("ws-resume-");
  }

  const existing = window.localStorage.getItem(WEBSOCKET_RESUME_TOKEN_STORAGE_KEY)?.trim();
  if (existing) {
    return existing;
  }

  const nextToken = buildRandomToken("ws-resume-");
  window.localStorage.setItem(WEBSOCKET_RESUME_TOKEN_STORAGE_KEY, nextToken);
  return nextToken;
}

function persistWebsocketSession(payload: StoredWebsocketSession) {
  if (!canUsePersistentStorage()) {
    return;
  }
  window.localStorage.setItem(WEBSOCKET_SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function clearPersistedWebsocketSession() {
  if (!canUsePersistentStorage()) {
    return;
  }
  window.localStorage.removeItem(WEBSOCKET_SESSION_STORAGE_KEY);
}

function readPersistedWebsocketSession(): ConnectPayload | null {
  if (!canUsePersistentStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(WEBSOCKET_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWebsocketSession>;
    const roomId = normalizeRoomId(parsed.roomId ?? "");
    const playerId = normalizePlayerId(parsed.playerId ?? "");
    const displayName = typeof parsed.displayName === "string" ? parsed.displayName.trim() : "";
    if (!roomId || !playerId || !displayName) {
      return null;
    }
    return { roomId, playerId, displayName, carId: normalizeCarId(parsed.carId) };
  } catch {
    return null;
  }
}

class GameSocketClient {
  private client: Client | null = null;
  private intentionalDisconnect = false;
  private personalSubscriptions: StompSubscription[] = [];
  private lifecycle: Promise<void> = Promise.resolve();
  private connectionGeneration = 0;
  private demoClient = new DemoRaceClient();
  private supabaseClient = new SupabaseGameClient();
  private websocketSyncIntervalId: number | null = null;

  connect(payload: ConnectPayload) {
    this.lifecycle = this.lifecycle.then(() => this.connectInternal(payload));
    return this.lifecycle;
  }

  disconnect(resetSession = true) {
    this.lifecycle = this.lifecycle.then(() => this.disconnectInternal(resetSession));
    return this.lifecycle;
  }

  submitAnswer(answer: string, timeout = false) {
    const transport = this.getRuntimeTransport();
    if (transport === "supabase") {
      void this.supabaseClient.submitAnswer(answer, timeout);
      return;
    }

    if (transport === "demo") {
      this.demoClient.submitAnswer(answer, timeout);
      return;
    }

    useGameStore.getState().beginLocalAnswerPrediction(answer);
    const state = useGameStore.getState();
    if (!this.client || !this.client.connected || !state.question) {
      return;
    }

    const payload: AnswerSubmissionRequest = {
      roomId: state.roomId,
      playerId: state.playerId,
      questionId: state.question.questionId,
      answer,
      timeout
    };
    this.client.publish({
      destination: "/app/game.answer",
      body: JSON.stringify(payload)
    });
  }

  submitDecision(choice: "HIGHWAY" | "DIRT") {
    const transport = this.getRuntimeTransport();
    if (transport === "supabase") {
      useGameStore.getState().beginLocalDecisionPrediction(choice);
      void this.supabaseClient.submitDecision(choice);
      return;
    }

    if (transport === "demo") {
      this.demoClient.submitDecision(choice);
      return;
    }

    useGameStore.getState().beginLocalDecisionPrediction(choice);
    const state = useGameStore.getState();
    if (!this.client || !this.client.connected || !state.decision) {
      return;
    }

    const payload: DecisionChoiceRequest = {
      roomId: state.roomId,
      playerId: state.playerId,
      eventId: state.decision.eventId,
      choice
    };
    this.client.publish({
      destination: "/app/game.decision",
      body: JSON.stringify(payload)
    });
  }

  startRace() {
    const transport = this.getRuntimeTransport();
    if (transport === "supabase") {
      void this.supabaseClient.startRace();
      return;
    }

    if (transport === "demo") {
      this.demoClient.startRace();
      return;
    }

    const state = useGameStore.getState();
    if (!this.client || !this.client.connected || !state.roomId || !state.playerId) {
      return;
    }

    this.client.publish({
      destination: "/app/game.start",
      body: JSON.stringify({
        roomId: state.roomId,
        playerId: state.playerId
      })
    });
  }

  updateRoomSettings(roomSettings: RoomSettings) {
    const transport = this.getRuntimeTransport();
    if (transport === "supabase") {
      void this.supabaseClient.updateRoomSettings(roomSettings);
      return;
    }

    if (transport === "demo") {
      this.demoClient.updateRoomSettings(roomSettings);
      return;
    }

    const state = useGameStore.getState();
    if (!this.client || !this.client.connected || !state.roomId || !state.playerId) {
      return;
    }

    this.client.publish({
      destination: "/app/game.updateRoomSettings",
      body: JSON.stringify({
        roomId: state.roomId,
        playerId: state.playerId,
        roomSettings
      })
    });
  }

  setReady(ready: boolean) {
    const state = useGameStore.getState();
    if (state.sessionMode === "shared" && state.roomCreatorPlayerId === "") {
      return;
    }
    const transport = this.getRuntimeTransport();
    if (transport === "supabase") {
      void this.supabaseClient.setReady(ready);
      return;
    }
    if (transport === "demo") {
      this.demoClient.setReady(ready);
      return;
    }
    // Supabase/WebSocket ready-state support is pending backend deployment.
  }

  returnToLobby() {
    const transport = this.getRuntimeTransport();
    if (transport === "supabase") {
      void this.supabaseClient.returnToLobby();
      return;
    }

    if (transport === "demo") {
      this.demoClient.returnToLobby();
      return;
    }

    const state = useGameStore.getState();
    if (!this.client || !this.client.connected || !state.roomId || !state.playerId) {
      return;
    }

    this.client.publish({
      destination: "/app/game.returnToLobby",
      body: JSON.stringify({
        roomId: state.roomId,
        playerId: state.playerId
      })
    });
  }

  leaveRoom() {
    this.lifecycle = this.lifecycle.then(() => this.leaveRoomInternal());
    return this.lifecycle;
  }

  getPersistedWebsocketSession() {
    return readPersistedWebsocketSession();
  }

  private clearSubscriptions() {
    for (const subscription of this.personalSubscriptions) {
      try {
        subscription.unsubscribe();
      } catch {
        // no-op
      }
    }
    this.personalSubscriptions = [];
  }

  private subscribeToPersonalQueues() {
    if (!this.client) {
      return;
    }
    this.clearSubscriptions();
    const client = this.client;

    this.personalSubscriptions.push(client.subscribe("/user/queue/game.state", (message) => {
      const payload = this.safeParse<GameStateUpdateMessage>(message.body);
      if (!payload) {
        return;
      }
      useGameStore.getState().applyStateUpdate(payload);
    }));

    this.personalSubscriptions.push(client.subscribe("/user/queue/game.joined", (message) => {
      const payload = this.safeParse<RoomJoinedMessage>(message.body);
      if (!payload) {
        return;
      }
      useGameStore.getState().applyJoin(payload);
      persistWebsocketSession({
        roomId: payload.roomId,
        playerId: payload.targetPlayerId,
        displayName: payload.displayName,
        carId: normalizeCarId(payload.carId ?? useGameStore.getState().selectedCarId)
      });
      this.startWebsocketSyncLoop();
    }));

    this.personalSubscriptions.push(client.subscribe("/user/queue/game.question", (message) => {
      const payload = this.safeParse<QuestionMessage>(message.body);
      if (!payload) {
        return;
      }
      useGameStore.getState().applyQuestion(payload);
    }));

    this.personalSubscriptions.push(client.subscribe("/user/queue/game.decision", (message) => {
      const payload = this.safeParse<DecisionPointMessage>(message.body);
      if (!payload) {
        return;
      }
      useGameStore.getState().applyDecision(payload);
    }));

    this.personalSubscriptions.push(client.subscribe("/user/queue/game.answer-feedback", (message) => {
      const payload = this.safeParse<AnswerFeedbackMessage>(message.body);
      if (!payload) {
        return;
      }
      useGameStore.getState().applyAnswerFeedback(payload);
    }));

    this.personalSubscriptions.push(client.subscribe("/user/queue/game.error", (message) => {
      const payload = this.safeParse<GameErrorMessage>(message.body);
      if (!payload) {
        return;
      }
      const code = payload.code ?? "UNKNOWN";
      const detail = payload.message?.trim() || "Session request rejected by server.";
      console.warn(`[game.error] ${code}: ${detail}`);
      useGameStore.getState().setConnection("error", detail);
    }));
  }

  private async connectInternal(payload: ConnectPayload) {
    await this.supabaseClient.disconnect();
    await this.demoClient.disconnect();
    this.stopWebsocketSyncLoop();
    await this.deactivateCurrentClient(false);
    this.intentionalDisconnect = false;
    useGameStore.getState().setConnection("connecting");
    const normalizedPayload: ConnectPayload = {
      ...payload,
      roomId: normalizeRoomId(payload.roomId) || payload.roomId.trim(),
      playerId: normalizePlayerId(payload.playerId) || payload.playerId.trim(),
      displayName: payload.displayName.trim(),
      carId: normalizeCarId(payload.carId)
    };
    persistWebsocketSession({
      roomId: normalizedPayload.roomId,
      playerId: normalizedPayload.playerId,
      displayName: normalizedPayload.displayName,
      carId: normalizedPayload.carId
    });

    const transport = this.getRuntimeTransport(normalizedPayload);
    if (transport === "supabase") {
      await this.supabaseClient.connect(normalizedPayload);
      return;
    }

    const backendUrl = getGameBackendUrl();
    if (!backendUrl) {
      await this.demoClient.connect(normalizedPayload);
      return;
    }

    const resumeToken = getOrCreateWebsocketResumeToken();
    const wsUrl = `${backendUrl}/ws?resume=${encodeURIComponent(resumeToken)}`;
    const generation = ++this.connectionGeneration;

    const client = new Client({
      webSocketFactory: () => new SockJS(wsUrl),
      reconnectDelay: 1500,
      heartbeatIncoming: 5000,
      heartbeatOutgoing: 5000,
      debug: () => undefined
    });

    client.onConnect = () => {
      if (generation !== this.connectionGeneration || this.client !== client) {
        return;
      }

      useGameStore.getState().setConnection("connecting");
      this.subscribeToPersonalQueues();
      const normalizedRoomId = normalizeRoomId(payload.roomId) || payload.roomId.trim();
      const normalizedPlayerId = normalizePlayerId(payload.playerId) || payload.playerId.trim();

      const joinRequest: JoinRoomRequest = {
        roomId: normalizedRoomId,
        playerId: normalizedPlayerId,
        displayName: payload.displayName,
        carId: normalizeCarId(payload.carId)
      };
      client.publish({
        destination: "/app/game.join",
        body: JSON.stringify(joinRequest)
      });
    };

    client.onStompError = () => {
      if (generation !== this.connectionGeneration || this.client !== client) {
        return;
      }
      useGameStore.getState().setConnection("error");
    };

    client.onWebSocketClose = () => {
      if (generation !== this.connectionGeneration) {
        return;
      }
      this.clearSubscriptions();
      if (!this.intentionalDisconnect) {
        useGameStore.getState().setConnection("connecting");
      }
    };

    this.client = client;
    client.activate();
  }

  private getRuntimeTransport(payload?: ConnectPayload) {
    const payloadRoomId = payload?.roomId ? normalizeRoomId(payload.roomId) : "";
    const state = useGameStore.getState();
    if (
      (payloadRoomId && isSoloRoomId(payloadRoomId)) ||
      state.sessionMode === "solo" ||
      (state.roomId && isSoloRoomId(state.roomId))
    ) {
      return "demo";
    }
    const localClassroomEnabled = String(import.meta.env.VITE_CLASSROOM_LOCAL_DEV ?? "").toLowerCase() === "true"
      || isFirebaseClassroomEnabled();
    if (localClassroomEnabled) {
      return "demo";
    }
    return getConfiguredGameTransport();
  }

  private async disconnectInternal(resetSession: boolean) {
    await this.supabaseClient.disconnect();
    await this.demoClient.disconnect();
    this.stopWebsocketSyncLoop();
    await this.deactivateCurrentClient(true);

    if (resetSession) {
      clearPersistedWebsocketSession();
    }
    useGameStore.getState().setConnection("idle");
    if (resetSession) {
      useGameStore.getState().resetSession();
    }
  }

  private async leaveRoomInternal() {
    const transport = getConfiguredGameTransport();
    if (transport === "websocket" && this.client?.connected) {
      const state = useGameStore.getState();
      if (state.roomId && state.playerId) {
        this.client.publish({
          destination: "/app/game.leave",
          body: JSON.stringify({
            roomId: state.roomId,
            playerId: state.playerId
          })
        });
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
    }

    await this.supabaseClient.disconnect();
    await this.demoClient.disconnect();
    this.stopWebsocketSyncLoop();
    await this.deactivateCurrentClient(true);

    useGameStore.getState().setConnection("idle");
    useGameStore.getState().resetSession();
  }

  private async deactivateCurrentClient(intentional: boolean) {
    this.stopWebsocketSyncLoop();
    this.clearSubscriptions();
    const activeClient = this.client;
    if (!activeClient) {
      if (intentional) {
        this.intentionalDisconnect = true;
      }
      return;
    }

    this.client = null;
    this.connectionGeneration += 1;
    this.intentionalDisconnect = intentional;
    try {
      await activeClient.deactivate();
    } catch {
      // no-op
    }
  }

  private startWebsocketSyncLoop() {
    this.stopWebsocketSyncLoop();
    this.requestWebsocketSync();
    this.websocketSyncIntervalId = window.setInterval(() => {
      this.requestWebsocketSync();
    }, WEBSOCKET_SYNC_INTERVAL_MS);
  }

  private stopWebsocketSyncLoop() {
    if (this.websocketSyncIntervalId !== null) {
      window.clearInterval(this.websocketSyncIntervalId);
      this.websocketSyncIntervalId = null;
    }
  }

  private requestWebsocketSync() {
    if (!this.client || !this.client.connected) {
      return;
    }

    const state = useGameStore.getState();
    if (!state.roomId || !state.playerId) {
      return;
    }

    this.client.publish({
      destination: "/app/game.sync",
      body: JSON.stringify({
        roomId: state.roomId,
        playerId: state.playerId
      })
    });
    recordWebsocketSyncPublish(Date.now());
  }

  private safeParse<T>(body: string): T | null {
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }
}

export const gameSocket = new GameSocketClient();

let websocketSyncWindowStartedAtMs = 0;
let websocketSyncPublishCount = 0;

function recordWebsocketSyncPublish(nowMs: number) {
  if (!import.meta.env.DEV) {
    return;
  }
  if (websocketSyncWindowStartedAtMs <= 0) {
    websocketSyncWindowStartedAtMs = nowMs;
  }
  websocketSyncPublishCount += 1;
  if (nowMs - websocketSyncWindowStartedAtMs < 5000) {
    return;
  }

  const seconds = (nowMs - websocketSyncWindowStartedAtMs) / 1000;
  console.debug("[websocket-sync] publishes/sec", (websocketSyncPublishCount / seconds).toFixed(1));
  websocketSyncWindowStartedAtMs = nowMs;
  websocketSyncPublishCount = 0;
}
