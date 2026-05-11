import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useGameStore } from "../store/useGameStore";
import { normalizePlayerId, normalizeRoomId } from "../utils/gameIds";
import type {
  AnswerFeedbackMessage,
  ConnectPayload,
  DecisionChoiceRequest,
  DecisionPointMessage,
  GameStateUpdateMessage,
  QuestionMessage,
  RoomSettings,
  RoomJoinedMessage
} from "../types/messages";
import { getSupabaseTransportConfig } from "./transportConfig";

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

interface SessionPayload {
  roomId: string;
  playerId: string;
  sessionId: string;
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
  private syncIntervalId: number | null = null;
  private syncGeneration = 0;
  private syncInFlight = false;

  async connect(payload: ConnectPayload) {
    await this.disconnect();

    const normalizedPayload: ConnectPayload = {
      roomId: normalizeRoomId(payload.roomId) || payload.roomId.trim(),
      playerId: normalizePlayerId(payload.playerId) || payload.playerId.trim(),
      displayName: payload.displayName.trim()
    };

    this.currentSessionId = buildSessionId();
    this.currentConnectPayload = normalizedPayload;
    useGameStore.getState().setConnection("connecting");

    try {
      const response = await this.invoke("join-game", {
        ...normalizedPayload,
        sessionId: this.currentSessionId
      });
      if (!this.applyResponse(response)) {
        this.currentSessionId = null;
        this.currentConnectPayload = null;
        return;
      }
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

  async submitAnswer(answer: string) {
    const sessionPayload = this.getSessionPayload();
    const question = useGameStore.getState().question;
    if (!sessionPayload || !question) {
      return;
    }

    try {
      const response = await this.invoke("submit-answer", {
        ...sessionPayload,
        questionId: question.questionId,
        answer
      });
      this.applyResponse(response);
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
      this.applyResponse(response);
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
      this.applyResponse(response);
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

    try {
      const response = await this.invoke("update-room-settings", {
        ...sessionPayload,
        roomSettings
      });
      this.applyResponse(response);
    } catch (error) {
      console.warn("[supabase] update-room-settings failed", error);
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
      this.applyResponse(response);
    } catch (error) {
      console.warn("[supabase] return-to-lobby failed", error);
      useGameStore.getState().setConnection("error");
    }
  }

  private startSyncLoop() {
    this.stopSyncLoop();
    const generation = ++this.syncGeneration;
    this.syncIntervalId = window.setInterval(() => {
      void this.sync(generation);
    }, 250);
  }

  private stopSyncLoop() {
    this.syncGeneration += 1;
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  private async sync(generation: number) {
    if (generation !== this.syncGeneration || this.syncInFlight) {
      return;
    }

    const sessionPayload = this.getSessionPayload();
    if (!sessionPayload) {
      return;
    }

    this.syncInFlight = true;
    try {
      const response = await this.invoke("sync-room", sessionPayload);
      if (generation !== this.syncGeneration) {
        return;
      }
      this.applyResponse(response);
    } catch (error) {
      if (generation === this.syncGeneration) {
        console.warn("[supabase] sync-room failed", error);
        useGameStore.getState().setConnection("error");
      }
    } finally {
      this.syncInFlight = false;
    }
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

  private async invoke(functionName: string, payload: object) {
    const { data, error } = await this.getClient().functions.invoke(functionName, {
      body: payload as Record<string, unknown>
    });
    if (error) {
      throw error;
    }
    return (data ?? {}) as GameFunctionResponse;
  }

  private applyResponse(response: GameFunctionResponse) {
    if (response.error) {
      const code = response.error.code ?? "UNKNOWN";
      const detail = response.error.message?.trim() || "Supabase backend rejected the request.";
      console.warn(`[supabase.error] ${code}: ${detail}`);
      useGameStore.getState().setConnection("error", detail);
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
        store.applyQuestion(response.question);
      } else {
        store.clearQuestion();
      }
    }

    if ("decision" in response) {
      if (response.decision) {
        store.applyDecision(response.decision);
      } else {
        store.clearDecision();
      }
    }

    if (response.answerFeedback) {
      store.applyAnswerFeedback(response.answerFeedback);
    }

    return true;
  }
}
