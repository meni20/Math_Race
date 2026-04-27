import { Client, StompSubscription } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { useGameStore } from "../store/useGameStore";
import { normalizePlayerId, normalizeRoomId } from "../utils/gameIds";
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
  RoomJoinedMessage
} from "../types/messages";
import { DemoRaceClient } from "./demoRace";
import { SupabaseGameClient } from "./supabaseGame";
import { getConfiguredGameTransport, getGameBackendUrl } from "./transportConfig";

interface GameErrorMessage {
  code?: string;
  message?: string;
  roomId?: string;
  playerId?: string;
}

class GameSocketClient {
  private client: Client | null = null;
  private intentionalDisconnect = false;
  private personalSubscriptions: StompSubscription[] = [];
  private lifecycle: Promise<void> = Promise.resolve();
  private connectionGeneration = 0;
  private demoClient = new DemoRaceClient();
  private supabaseClient = new SupabaseGameClient();

  connect(payload: ConnectPayload) {
    this.lifecycle = this.lifecycle.then(() => this.connectInternal(payload));
    return this.lifecycle;
  }

  disconnect(resetSession = true) {
    this.lifecycle = this.lifecycle.then(() => this.disconnectInternal(resetSession));
    return this.lifecycle;
  }

  submitAnswer(answer: string) {
    const transport = getConfiguredGameTransport();
    if (transport === "supabase") {
      useGameStore.getState().beginLocalAnswerPrediction(answer);
      void this.supabaseClient.submitAnswer(answer);
      return;
    }

    if (transport === "demo") {
      this.demoClient.submitAnswer(answer);
      return;
    }

    const state = useGameStore.getState();
    if (!this.client || !this.client.connected || !state.question) {
      return;
    }

    const payload: AnswerSubmissionRequest = {
      roomId: state.roomId,
      playerId: state.playerId,
      questionId: state.question.questionId,
      answer
    };
    this.client.publish({
      destination: "/app/game.answer",
      body: JSON.stringify(payload)
    });
  }

  submitDecision(choice: "HIGHWAY" | "DIRT") {
    const transport = getConfiguredGameTransport();
    if (transport === "supabase") {
      useGameStore.getState().beginLocalDecisionPrediction(choice);
      void this.supabaseClient.submitDecision(choice);
      return;
    }

    if (transport === "demo") {
      this.demoClient.submitDecision(choice);
      return;
    }

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
    const transport = getConfiguredGameTransport();
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
    const transport = getConfiguredGameTransport();
    if (transport === "supabase") {
      void this.supabaseClient.updateRoomSettings(roomSettings);
      return;
    }

    if (transport === "demo") {
      this.demoClient.updateRoomSettings(roomSettings);
      return;
    }
  }

  returnToLobby() {
    const transport = getConfiguredGameTransport();
    if (transport === "supabase") {
      void this.supabaseClient.returnToLobby();
      return;
    }

    if (transport === "demo") {
      this.demoClient.returnToLobby();
      return;
    }

    this.disconnect(false);
  }

  leaveRoom() {
    this.lifecycle = this.lifecycle.then(() => this.leaveRoomInternal());
    return this.lifecycle;
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
      useGameStore.getState().setConnection("error");
    }));
  }

  private async connectInternal(payload: ConnectPayload) {
    await this.supabaseClient.disconnect();
    await this.demoClient.disconnect();
    await this.deactivateCurrentClient(false);
    this.intentionalDisconnect = false;
    useGameStore.getState().setConnection("connecting");

    const transport = getConfiguredGameTransport();
    if (transport === "supabase") {
      await this.supabaseClient.connect(payload);
      return;
    }

    const backendUrl = getGameBackendUrl();
    if (!backendUrl) {
      await this.demoClient.connect(payload);
      return;
    }

    const wsUrl = `${backendUrl}/ws`;
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

      this.subscribeToPersonalQueues();
      const normalizedRoomId = normalizeRoomId(payload.roomId) || payload.roomId.trim();
      const normalizedPlayerId = normalizePlayerId(payload.playerId) || payload.playerId.trim();

      const joinRequest: JoinRoomRequest = {
        roomId: normalizedRoomId,
        playerId: normalizedPlayerId,
        displayName: payload.displayName
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
        useGameStore.getState().setConnection("error");
      }
    };

    this.client = client;
    client.activate();
  }

  private async disconnectInternal(resetSession: boolean) {
    await this.supabaseClient.disconnect();
    await this.demoClient.disconnect();
    await this.deactivateCurrentClient(true);

    useGameStore.getState().setConnection("idle");
    if (resetSession) {
      useGameStore.getState().resetSession();
    }
  }

  private async leaveRoomInternal() {
    await this.supabaseClient.disconnect();
    await this.demoClient.disconnect();
    await this.deactivateCurrentClient(true);

    useGameStore.getState().setConnection("idle");
    useGameStore.getState().resetSession();
  }

  private async deactivateCurrentClient(intentional: boolean) {
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

  private safeParse<T>(body: string): T | null {
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }
}

export const gameSocket = new GameSocketClient();
