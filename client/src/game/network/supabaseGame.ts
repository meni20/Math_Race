import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useGameStore } from "../store/useGameStore";
import { normalizePlayerId, normalizeRoomId } from "../utils/gameIds";
import { normalizeCarId } from "../utils/carSelection";
import { DEFAULT_TARGET_SCORE } from "../utils/roomSettings";
import type {
  AnswerFeedbackMessage,
  ConnectPayload,
  DecisionChoiceRequest,
  DecisionPointMessage,
  GameStateUpdateMessage,
  PlayerSnapshot,
  QuestionMessage,
  RoomLifecycleStatus,
  RoomSettings,
  RoomJoinedMessage
} from "../types/messages";
import { getSupabaseTransportConfig } from "./transportConfig";
import {
  countNetworkRequests,
  recordNetworkRequest,
  startSyncLifecycle,
  stopSyncLifecycle,
  updateStudentRealtimeDebugState,
  updateSyncLifecycle
} from "../sync/syncLifecycle";

interface GameErrorMessage {
  code?: string;
  message?: string;
  roomId?: string;
  playerId?: string;
}

interface GameFunctionResponse {
  joined?: RoomJoinedMessage;
  stateUpdate?: GameStateUpdateMessage;
  question?: QuestionMessage | null;
  decision?: DecisionPointMessage | null;
  answerFeedback?: AnswerFeedbackMessage | null;
  error?: GameErrorMessage | null;
}

type ResponseSource = "join" | "sync" | "submit-answer" | "action";

const STUDENT_SYNC_INTERVALS_MS = {
  waiting: 15000,
  racing: 5000,
  starting: 2000,
  hidden: 30000,
  maxBackoff: 30000
};
const STUDENT_REALTIME_STALE_MS = 45000;

interface SessionPayload {
  roomId: string;
  playerId: string;
  sessionId: string;
}

interface GameRoomStateRecord {
  roomId: string;
  tick: number;
  racePhase: GameStateUpdateMessage["racePhase"];
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceStopped: boolean;
  raceStoppedAtMs: number;
  winnerPlayerId: string | null;
  roomCreatorPlayerId: string | null;
  trackLengthMeters?: number;
  endedAtMs?: number;
  closedAtMs?: number;
  deletedAtMs?: number;
  roomSettings: RoomSettings;
  players: Record<string, PlayerStateRecord>;
}

interface RaceQuestionRecord {
  id: string;
  kind?: string;
  routeMode?: string;
  operation?: string;
  prompt: string;
  choices?: string[];
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  timeLimitSeconds?: number;
  createdAtMs?: number;
  expiresAtMs: number;
}

interface PendingQuestionRecord {
  question?: RaceQuestionRecord;
  expiresAtMs?: number;
  fromHighwayChallenge?: boolean;
}

interface PlayerStateRecord extends PlayerSnapshot {
  pendingQuestion?: PendingQuestionRecord | null;
}

function lifecycleFromRecord(record: GameRoomStateRecord): RoomLifecycleStatus {
  if (record.deletedAtMs) {
    return "DELETED";
  }
  if (record.closedAtMs) {
    return "CLOSED";
  }
  if (record.endedAtMs || record.raceStopped || record.racePhase === "finish") {
    return "FINISHED";
  }
  if (record.racePhase === "active" || record.racePhase === "starting") {
    return "RACING";
  }
  return "WAITING";
}

function difficultyToNumber(difficulty: RaceQuestionRecord["difficulty"]) {
  return difficulty === "HARD" ? 3 : difficulty === "MEDIUM" ? 2 : 1;
}

function buildSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Math.random().toString(36).slice(2, 12)}`;
}

export class SupabaseGameClient {
  private client: SupabaseClient | null = null;
  private currentSessionId: string | null = null;
  private currentConnectPayload: ConnectPayload | null = null;
  private syncTimerId: number | null = null;
  private syncAbortController: AbortController | null = null;
  private roomChannel: RealtimeChannel | null = null;
  private syncGeneration = 0;
  private syncInFlight = false;
  private syncFailureCount = 0;
  private syncLifecycleId: number | null = null;
  private visibilityListener: (() => void) | null = null;
  private lastSyncAtMs = 0;
  private nextSyncAtMs = 0;
  private lastStopReason = "";
  private terminalStatusReceived = false;
  private realtimeConnected = false;
  private lastRealtimeEventAtMs = 0;
  private realtimeStatus = "idle";

  async connect(payload: ConnectPayload) {
    await this.disconnect();

    const normalizedPayload: ConnectPayload = {
      roomId: normalizeRoomId(payload.roomId) || payload.roomId.trim(),
      playerId: normalizePlayerId(payload.playerId) || payload.playerId.trim(),
      displayName: payload.displayName.trim(),
      carId: normalizeCarId(payload.carId)
    };

    this.currentSessionId = buildSessionId();
    this.currentConnectPayload = normalizedPayload;
    this.terminalStatusReceived = false;
    this.lastStopReason = "";
    useGameStore.getState().setConnection("connecting");

    try {
      const response = await this.invoke("join-game", {
        ...normalizedPayload,
        sessionId: this.currentSessionId
      });
      if (!this.applyResponse(response, "join")) {
        this.currentSessionId = null;
        this.currentConnectPayload = null;
        return;
      }
      this.subscribeToRoomChanges(normalizedPayload.roomId);
      this.startSyncLoop();
    } catch (error) {
      console.warn("[supabase] join-game failed", error);
      useGameStore.getState().setConnection("error", "Unable to join room. Please retry.");
      this.currentSessionId = null;
      this.currentConnectPayload = null;
    }
  }

  async disconnect() {
    this.stopSyncLoop();
    await this.unsubscribeFromRoomChanges();

    const sessionPayload = this.getSessionPayload();
    this.currentSessionId = null;
    this.currentConnectPayload = null;

    if (!sessionPayload) {
      return;
    }

    try {
      await this.invoke("leave-game", sessionPayload);
    } catch {
      // best-effort disconnect
    }
  }

  async submitAnswer(answer: string, timeout = false) {
    const sessionPayload = this.getSessionPayload();
    const question = useGameStore.getState().question;
    if (!sessionPayload || !question) {
      return;
    }

    useGameStore.getState().markQuestionSubmitted(question.questionId);
    try {
      const response = await this.invoke("submit-answer", {
        ...sessionPayload,
        questionId: question.questionId,
        answer,
        timeout
      });
      this.applyResponse(response, "submit-answer");
    } catch (error) {
      console.warn("[supabase] submit-answer failed", error);
      useGameStore.getState().setConnection("error");
    }
  }

  async submitDecision(choice: DecisionChoiceRequest["choice"]) {
    const sessionPayload = this.getSessionPayload();
    const decision = useGameStore.getState().decision;
    if (!sessionPayload || !decision) {
      return;
    }

    try {
      const response = await this.invoke("submit-decision", {
        ...sessionPayload,
        eventId: decision.eventId,
        choice
      });
      this.applyResponse(response, "action");
    } catch (error) {
      console.warn("[supabase] submit-decision failed", error);
      useGameStore.getState().setConnection("error");
    }
  }

  async startRace() {
    const sessionPayload = this.getSessionPayload();
    if (!sessionPayload) {
      return;
    }

    try {
      const response = await this.invoke("start-race", sessionPayload);
      this.applyResponse(response, "action");
    } catch (error) {
      console.warn("[supabase] start-race failed", error);
      useGameStore.getState().setConnection("error");
    }
  }

  async updateRoomSettings(roomSettings: RoomSettings) {
    const sessionPayload = this.getSessionPayload();
    if (!sessionPayload) {
      return;
    }

    useGameStore.getState().applyOptimisticRoomSettings(roomSettings);
    try {
      const response = await this.invoke("update-room-settings", {
        ...sessionPayload,
        roomSettings
      });
      this.applyResponse(response, "action");
    } catch (error) {
      console.warn("[supabase] update-room-settings failed", error);
      useGameStore.getState().setConnection("error");
    }
  }

  async setReady(ready: boolean) {
    const sessionPayload = this.getSessionPayload();
    if (!sessionPayload) {
      return;
    }

    try {
      const response = await this.invoke("set-ready", {
        ...sessionPayload,
        ready
      });
      this.applyResponse(response, "action");
    } catch (error) {
      console.warn("[supabase] set-ready failed", error);
      useGameStore.getState().setConnection("error");
    }
  }

  async returnToLobby() {
    const sessionPayload = this.getSessionPayload();
    if (!sessionPayload) {
      return;
    }

    try {
      const response = await this.invoke("return-to-lobby", sessionPayload);
      this.applyResponse(response, "action");
    } catch (error) {
      console.warn("[supabase] return-to-lobby failed", error);
      useGameStore.getState().setConnection("error");
    }
  }

  private startSyncLoop() {
    this.stopSyncLoop("restart");
    const generation = ++this.syncGeneration;
    const roomId = this.currentConnectPayload?.roomId ?? "";
    this.syncLifecycleId = startSyncLifecycle({
      key: `student:${roomId}`,
      role: "student",
      mode: "classroom",
      adapter: "supabase",
      roomId,
      roomCode: roomId,
      intervalMs: this.getSyncIntervalMs()
    });
    this.visibilityListener = () => {
      if (document.visibilityState === "visible") {
        this.scheduleSync(generation, 0, true);
      } else {
        this.scheduleSync(generation, this.getFallbackSyncDelayMs());
      }
    };
    document.addEventListener("visibilitychange", this.visibilityListener);
    this.scheduleSync(generation, this.getFallbackSyncDelayMs());
  }

  private stopSyncLoop(reason = "stopped") {
    this.syncGeneration += 1;
    if (this.syncTimerId !== null) {
      window.clearTimeout(this.syncTimerId);
      this.syncTimerId = null;
    }
    if (this.syncAbortController) {
      this.syncAbortController.abort();
      this.syncAbortController = null;
    }
    if (this.visibilityListener) {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      this.visibilityListener = null;
    }
    stopSyncLifecycle(this.syncLifecycleId, reason);
    this.syncLifecycleId = null;
    this.syncInFlight = false;
    this.syncFailureCount = 0;
    this.lastStopReason = reason;
    this.nextSyncAtMs = 0;
    updateStudentRealtimeDebugState({ syncFallbackActive: false });
  }

  private scheduleSync(generation: number, delayMs: number, force = false) {
    if (generation !== this.syncGeneration || !this.getSessionPayload()) {
      return;
    }
    if (this.syncTimerId !== null) {
      window.clearTimeout(this.syncTimerId);
    }
    this.nextSyncAtMs = Date.now() + delayMs;
    updateSyncLifecycle(this.syncLifecycleId ?? 0, { nextSyncAtMs: this.nextSyncAtMs, intervalMs: delayMs });
    updateStudentRealtimeDebugState({
      syncFallbackActive: force || !this.isRealtimeHealthy(),
      staleAtMs: this.lastRealtimeEventAtMs > 0 ? this.lastRealtimeEventAtMs + STUDENT_REALTIME_STALE_MS : 0
    });
    this.syncTimerId = window.setTimeout(() => {
      this.syncTimerId = null;
      void this.sync(generation, force);
    }, delayMs);
  }

  private getFallbackSyncDelayMs() {
    if (this.isRealtimeHealthy()) {
      return Math.max(0, (this.lastRealtimeEventAtMs + STUDENT_REALTIME_STALE_MS) - Date.now());
    }
    return this.getSyncIntervalMs();
  }

  private getSyncIntervalMs() {
    const state = useGameStore.getState();
    if (document.visibilityState === "hidden") {
      return STUDENT_SYNC_INTERVALS_MS.hidden;
    }
    if (state.racePhase === "active") {
      return STUDENT_SYNC_INTERVALS_MS.racing;
    }
    if (state.racePhase === "starting") {
      return STUDENT_SYNC_INTERVALS_MS.starting;
    }
    return STUDENT_SYNC_INTERVALS_MS.waiting;
  }

  private shouldStopForLifecycle(status: RoomLifecycleStatus | "REMOVED" | "KICKED" | undefined) {
    return status === "CLOSED" || status === "DELETED" || status === "FINISHED" || status === "REMOVED" || status === "KICKED";
  }

  private isRealtimeHealthy() {
    return this.realtimeConnected
      && this.lastRealtimeEventAtMs > 0
      && Date.now() - this.lastRealtimeEventAtMs < STUDENT_REALTIME_STALE_MS;
  }

  private markRealtimeHealthy(status: string) {
    this.realtimeConnected = true;
    this.realtimeStatus = status;
    this.lastRealtimeEventAtMs = Date.now();
    updateStudentRealtimeDebugState({
      connected: true,
      healthy: true,
      status,
      lastEventAtMs: this.lastRealtimeEventAtMs,
      staleAtMs: this.lastRealtimeEventAtMs + STUDENT_REALTIME_STALE_MS,
      syncFallbackActive: false
    });
    if (this.syncLifecycleId !== null) {
      this.scheduleSync(this.syncGeneration, this.getFallbackSyncDelayMs());
    }
  }

  private markRealtimeUnhealthy(status: string) {
    this.realtimeConnected = false;
    this.realtimeStatus = status;
    updateStudentRealtimeDebugState({
      connected: false,
      healthy: false,
      status,
      syncFallbackActive: this.syncLifecycleId !== null
    });
    if (this.syncLifecycleId !== null) {
      this.scheduleSync(this.syncGeneration, 0);
    }
  }

  private subscribeToRoomChanges(roomId: string) {
    void this.unsubscribeFromRoomChanges();
    const client = this.getClient();
    this.roomChannel = client
      .channel(`game-room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_rooms",
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          const stateJson = (payload.new as { state_json?: GameRoomStateRecord }).state_json;
          const stateUpdate = this.stateRecordToUpdate(stateJson);
          if (stateUpdate) {
            this.markRealtimeHealthy("UPDATE");
            useGameStore.getState().applyStateUpdate(stateUpdate);
            const question = this.stateRecordToQuestion(stateJson);
            if (question) {
              useGameStore.getState().applyQuestion(question, "realtime");
            }
            if (this.shouldStopForLifecycle(stateUpdate.lifecycleStatus) || this.isLocalParticipantMissing(stateUpdate)) {
              this.stopSyncLoop(stateUpdate.lifecycleStatus ?? "participant-missing");
              if (this.isLocalParticipantMissing(stateUpdate)) {
                useGameStore.getState().resetSession();
                useGameStore.getState().setConnection("error", "You were removed from the room by the teacher.");
              }
              return;
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.markRealtimeHealthy(status);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this.markRealtimeUnhealthy(status);
        }
      });
  }

  private async unsubscribeFromRoomChanges() {
    const channel = this.roomChannel;
    this.roomChannel = null;
    this.realtimeConnected = false;
    this.realtimeStatus = "idle";
    this.lastRealtimeEventAtMs = 0;
    updateStudentRealtimeDebugState({
      connected: false,
      healthy: false,
      status: "idle",
      lastEventAtMs: 0,
      staleAtMs: 0,
      syncFallbackActive: false
    });
    if (!channel || !this.client) {
      return;
    }
    await this.client.removeChannel(channel);
  }

  private async sync(generation: number, force = false) {
    if (generation !== this.syncGeneration || this.syncInFlight) {
      return;
    }

    const sessionPayload = this.getSessionPayload();
    if (!sessionPayload) {
      return;
    }
    if (!force && this.isRealtimeHealthy()) {
      this.scheduleSync(generation, this.getFallbackSyncDelayMs());
      return;
    }

    this.syncInFlight = true;
    this.syncAbortController = new AbortController();
    try {
      recordNetworkRequest("sync-room", "student");
      if (import.meta.env.DEV && this.isRealtimeHealthy() && countNetworkRequests("sync-room") > 1) {
        console.warn("[supabase] sync-room ran repeatedly while student Realtime was healthy", {
          roomId: sessionPayload.roomId,
          playerId: sessionPayload.playerId,
          realtimeStatus: this.realtimeStatus,
          lastRealtimeEventAtMs: this.lastRealtimeEventAtMs
        });
      }
      const response = await this.invoke("sync-room", sessionPayload, this.syncAbortController.signal);
      if (generation !== this.syncGeneration) {
        return;
      }
      this.lastSyncAtMs = Date.now();
      this.syncFailureCount = 0;
      updateSyncLifecycle(this.syncLifecycleId ?? 0, {
        lastSyncAtMs: Date.now(),
        lastStatus: response.stateUpdate?.lifecycleStatus ?? response.error?.code ?? "OK"
      });
      const keepRunning = this.applyResponse(response, "sync");
      if (!keepRunning || this.shouldStopForLifecycle(response.stateUpdate?.lifecycleStatus) || this.isLocalParticipantMissing(response.stateUpdate)) {
        this.terminalStatusReceived = !keepRunning || this.shouldStopForLifecycle(response.stateUpdate?.lifecycleStatus);
        this.stopSyncLoop(response.error?.code ?? response.stateUpdate?.lifecycleStatus ?? "terminal");
        if (this.isLocalParticipantMissing(response.stateUpdate)) {
          useGameStore.getState().resetSession();
          useGameStore.getState().setConnection("error", "You were removed from the room by the teacher.");
        }
        return;
      }
    } catch (error) {
      if (generation === this.syncGeneration) {
        if ((error as Error).name !== "AbortError") {
          this.syncFailureCount += 1;
          console.warn("[supabase] sync-room failed", error);
          if (this.syncFailureCount >= 5) {
            useGameStore.getState().setConnection("error", "Room sync failed repeatedly. Please rejoin.");
            this.stopSyncLoop("sync-failure-threshold");
            return;
          }
        }
      }
    } finally {
      this.syncAbortController = null;
      this.syncInFlight = false;
      if (generation === this.syncGeneration) {
        const baseIntervalMs = this.getFallbackSyncDelayMs();
        const backoffMs = this.isRealtimeHealthy()
          ? baseIntervalMs
          : Math.min(STUDENT_SYNC_INTERVALS_MS.maxBackoff, baseIntervalMs * Math.max(1, this.syncFailureCount + 1));
        if (import.meta.env.DEV) {
          const state = useGameStore.getState();
          if ((state.racePhase === "lobby" || state.racePhase === "starting") && state.racePhase !== "starting" && backoffMs < STUDENT_SYNC_INTERVALS_MS.waiting) {
            console.warn("BUG: student waiting polling interval too aggressive", {
              intervalMs: backoffMs,
              roomId: state.roomId,
              playerId: state.playerId
            });
          }
        }
        updateSyncLifecycle(this.syncLifecycleId ?? 0, { intervalMs: backoffMs });
        this.scheduleSync(generation, backoffMs);
      }
    }
  }

  private isLocalParticipantMissing(stateUpdate: GameStateUpdateMessage | undefined) {
    const playerId = this.currentConnectPayload?.playerId;
    if (!stateUpdate || !playerId || this.shouldStopForLifecycle(stateUpdate.lifecycleStatus)) {
      return false;
    }
    return !stateUpdate.players.some((player) => player.playerId === playerId);
  }

  private stateRecordToUpdate(record: GameRoomStateRecord | null | undefined): GameStateUpdateMessage | null {
    if (!record) {
      return null;
    }

    const state = useGameStore.getState();
    const players = Object.values(record.players ?? {})
      .sort((left, right) => {
        const joinedDelta = (left.joinedAtMs ?? 0) - (right.joinedAtMs ?? 0);
        return joinedDelta || left.playerId.localeCompare(right.playerId);
      })
      .map<PlayerSnapshot>((player) => ({
        playerId: player.playerId,
        displayName: player.displayName,
        joinedAtMs: player.joinedAtMs,
        laneIndex: player.laneIndex,
        positionMeters: player.positionMeters,
        speedMps: player.speedMps,
        lap: player.lap,
        finished: player.finished,
        racePhase: player.racePhase,
        carId: normalizeCarId(player.carId),
        ready: Boolean(player.ready),
        correctAnswers: Math.max(0, Math.trunc(player.correctAnswers ?? 0)),
        wrongAnswers: Math.max(0, Math.trunc(player.wrongAnswers ?? 0)),
        timeoutAnswers: Math.max(0, Math.trunc(player.timeoutAnswers ?? 0)),
        score: Math.max(0, Math.trunc(player.score ?? player.positionMeters ?? 0)),
        streak: Math.max(0, Math.trunc(player.streak ?? 0)),
        averageAnswerTimeMs: Math.max(0, Math.trunc(player.averageAnswerTimeMs ?? 0)),
        connected: player.connected !== false,
        disconnectedAtMs: Math.max(0, Math.trunc(player.disconnectedAtMs ?? 0)),
        routeMode: player.routeMode,
        routeStats: player.routeStats,
        maxSpeedMps: player.maxSpeedMps
      }));

    return {
      roomId: record.roomId,
      lifecycleStatus: lifecycleFromRecord(record),
      serverTimeMs: Date.now(),
      tick: Number.isFinite(record.tick) ? record.tick : state.latestTick,
      racePhase: record.racePhase ?? state.roomRacePhase,
      raceStartingAtMs: Number.isFinite(record.raceStartingAtMs) ? record.raceStartingAtMs : 0,
      raceStartedAtMs: Number.isFinite(record.raceStartedAtMs) ? record.raceStartedAtMs : 0,
      raceStopped: Boolean(record.raceStopped),
      raceStoppedAtMs: Number.isFinite(record.raceStoppedAtMs) ? record.raceStoppedAtMs : 0,
      winnerPlayerId: record.winnerPlayerId ?? "",
      roomCreatorPlayerId: record.roomCreatorPlayerId ?? "",
      roomSettings: record.roomSettings ?? state.roomSettings,
      trackLengthMeters: Number.isFinite(record.trackLengthMeters)
        ? Math.max(1, record.trackLengthMeters ?? state.trackLengthMeters)
        : Math.max(1, Math.trunc((record.roomSettings ?? state.roomSettings).targetScore ?? DEFAULT_TARGET_SCORE)),
      players
    };
  }

  private stateRecordToQuestion(record: GameRoomStateRecord | null | undefined): QuestionMessage | null {
    const playerId = this.currentConnectPayload?.playerId;
    if (!record || !playerId || record.racePhase !== "active" || record.raceStopped) {
      return null;
    }
    const player = record.players?.[playerId];
    const pending = player?.pendingQuestion;
    const question = pending?.question;
    const expiresAtMs = Number(question?.expiresAtMs ?? pending?.expiresAtMs ?? 0);
    if (!player || player.racePhase !== "active" || !question || !question.id || !question.prompt || !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      return null;
    }
    const timeLimitSeconds = Math.max(1, Math.trunc(Number(question.timeLimitSeconds ?? 15)));
    return {
      roomId: record.roomId,
      targetPlayerId: playerId,
      questionId: question.id,
      id: question.id,
      kind: question.kind,
      routeMode: question.routeMode,
      operation: question.operation,
      prompt: question.prompt,
      choices: Array.isArray(question.choices) ? question.choices.map(String) : undefined,
      difficulty: difficultyToNumber(question.difficulty),
      difficultyLabel: question.difficulty,
      timeLimitMs: timeLimitSeconds * 1000,
      timeLimitSeconds,
      createdAtMs: Number.isFinite(question.createdAtMs) ? question.createdAtMs : expiresAtMs - (timeLimitSeconds * 1000),
      expiresAtMs,
      highwayChallenge: question.routeMode === "HIGHWAY" || Boolean(pending.fromHighwayChallenge)
    };
  }

  private getClient() {
    if (this.client) {
      return this.client;
    }

    const config = getSupabaseTransportConfig();
    if (!config) {
      throw new Error("Supabase transport is not configured.");
    }

    this.client = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    return this.client;
  }

  private getSessionPayload(): SessionPayload | null {
    if (!this.currentSessionId || !this.currentConnectPayload) {
      return null;
    }

    return {
      roomId: this.currentConnectPayload.roomId,
      playerId: this.currentConnectPayload.playerId,
      sessionId: this.currentSessionId
    };
  }

  private async invoke(functionName: string, payload: object, signal?: AbortSignal) {
    const config = getSupabaseTransportConfig();
    if (!config) {
      throw new Error("Supabase transport is not configured.");
    }
    const response = await fetch(`${config.url}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as GameFunctionResponse).error?.message ?? `Supabase function failed: ${functionName}`);
    }
    return (data ?? {}) as GameFunctionResponse;
  }

  private applyResponse(response: GameFunctionResponse, source: ResponseSource = "action") {
    if (response.error) {
      const code = response.error.code ?? "UNKNOWN";
      const detail = response.error.message?.trim() || "Supabase backend rejected the request.";
      console.warn(`[supabase.error] ${code}: ${detail}`);
      const store = useGameStore.getState();
      if (
        code === "ROOM_DELETED"
        || code === "ROOM_CLOSED"
        || code === "ROOM_FINISHED"
        || code === "PLAYER_REMOVED"
        || code === "PLAYER_KICKED"
        || code === "SESSION_NOT_AUTHORIZED"
      ) {
        this.terminalStatusReceived = true;
        this.stopSyncLoop(code);
        store.resetSession();
      } else {
        store.setConnection("error", detail);
      }
      return false;
    }

    const store = useGameStore.getState();

    if (response.joined) {
      store.applyJoin(response.joined);
    }
    if (response.stateUpdate) {
      store.applyStateUpdate(response.stateUpdate);
    }

    if ("question" in response) {
      if (response.question) {
        store.applyQuestion(response.question, source === "submit-answer" ? "submit-answer" : "sync");
      } else if (source !== "sync") {
        store.clearQuestion();
      }
    }

    if ("decision" in response) {
      if (response.decision) {
        store.applyDecision(response.decision);
      } else if (source !== "sync") {
        store.clearDecision();
      }
    }

    if (response.answerFeedback && source !== "sync") {
      store.applyAnswerFeedback(response.answerFeedback);
    }

    if (this.shouldStopForLifecycle(response.stateUpdate?.lifecycleStatus) || this.isLocalParticipantMissing(response.stateUpdate)) {
      const stopReason = response.stateUpdate?.lifecycleStatus ?? "participant-missing";
      this.terminalStatusReceived = this.shouldStopForLifecycle(response.stateUpdate?.lifecycleStatus);
      this.stopSyncLoop(stopReason);
      if (this.isLocalParticipantMissing(response.stateUpdate)) {
        store.resetSession();
        store.setConnection("error", "You were removed from the room by the teacher.");
      }
    }

    return true;
  }

  getDebugState() {
    const state = useGameStore.getState();
    return {
      studentSyncActive: this.syncLifecycleId !== null,
      currentSyncIntervalMs: this.getSyncIntervalMs(),
      lastSyncAtMs: this.lastSyncAtMs,
      nextSyncAtMs: this.nextSyncAtMs,
      lastStopReason: this.lastStopReason,
      terminalStatusReceived: this.terminalStatusReceived,
      realtimeConnected: this.realtimeConnected,
      realtimeHealthy: this.isRealtimeHealthy(),
      realtimeStatus: this.realtimeStatus,
      lastRealtimeEventAtMs: this.lastRealtimeEventAtMs,
      roomId: state.roomId,
      roomStatus: state.roomRacePhase,
      participantId: state.playerId,
      participantStatus: state.playerId ? (state.players[state.playerId]?.racePhase ?? "missing") : "none"
    };
  }
}
