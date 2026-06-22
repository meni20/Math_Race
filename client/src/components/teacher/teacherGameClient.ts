import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseTransportConfig } from "../../game/network/transportConfig";
import { getClassroomAdapterInfo, getClassroomRoomService, listTeacherClassroomRooms } from "../../game/network/classroomRooms";
import {
  localRoomToStateUpdate,
  readLocalClassroomRoom,
  subscribeLocalClassroomRoom,
  updateLocalClassroomRoom
} from "../../game/network/localClassroom";
import type { GameStateUpdateMessage, PlayerSnapshot, RacePhase, RoomSettings } from "../../game/types/messages";
import { normalizeCarId } from "../../game/utils/carSelection";
import { DEFAULT_TARGET_SCORE, normalizeRoomSettings } from "../../game/utils/roomSettings";
import { connectTeacherRoomLiveUpdates, type TeacherRoomLiveSubscription } from "../../game/sync/teacherLiveSubscription";
import { recordNetworkRequest, startSyncLifecycle, stopSyncLifecycle, updateSyncLifecycle } from "../../game/sync/syncLifecycle";
import { buildTeacherPlayers, configToRoomSettings, isStaleTeacherRaceUpdate } from "./teacherUtils";
import type { TeacherLiveTransportState, TeacherPlayerStatus, TeacherRaceConfig, TeacherRoomLifecycleStatus, TeacherRoomSnapshot, TeacherRoomSummary } from "./teacherTypes";
import type { TeacherRoomLiveUpdate } from "../../game/sync/teacherLiveSubscription";

interface GameFunctionResponse {
  stateUpdate?: GameStateUpdateMessage;
  error?: {
    code?: string;
    message?: string;
    operation?: string;
    missingFieldOrColumn?: string;
    validationIssue?: string;
    originalMessage?: string;
    originalCode?: string;
    details?: string;
    hint?: string;
  } | null;
}

interface GameRoomStateRecord {
  roomId: string;
  trackLengthMeters?: number;
  totalLaps?: number;
  tick: number;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceStopped: boolean;
  raceStoppedAtMs: number;
  winnerPlayerId: string | null;
  endedAtMs?: number;
  closedAtMs?: number;
  deletedAtMs?: number;
  roomSettings: RoomSettings;
  players: Record<string, PlayerSnapshot>;
}

type SnapshotListener = (snapshot: TeacherRoomSnapshot | null) => void;
type ConnectionListener = (status: "idle" | "connecting" | "connected" | "error", message?: string) => void;

const TEACHER_SESSION_STORAGE_KEY = "mathRace.teacherSessionId";
const LOCAL_START_DELAY_MS = 1800;
const SSE_CONNECT_TIMEOUT_MS = 4000;
const SSE_RECENT_EVENT_MS = 30000;
const SSE_STALE_EVENT_MS = 45000;

function formatTeacherFunctionError(functionName: string, error: GameFunctionResponse["error"]) {
  if (!error) {
    return `Teacher request failed: ${functionName}`;
  }
  return [
    error.message || error.code || `Teacher request failed: ${functionName}`,
    error.operation ? `operation: ${error.operation}` : "",
    error.missingFieldOrColumn ? `missing field/column: ${error.missingFieldOrColumn}` : "",
    error.validationIssue ? `validation: ${error.validationIssue}` : "",
    error.originalMessage && error.originalMessage !== error.message ? `original: ${error.originalMessage}` : "",
    error.originalCode ? `code: ${error.originalCode}` : "",
    error.details ? `details: ${error.details}` : "",
    error.hint ? `hint: ${error.hint}` : ""
  ].filter(Boolean).join(" | ");
}

function buildSessionId() {
  if (typeof window !== "undefined") {
    const existing = window.localStorage.getItem(TEACHER_SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }
  }
  let nextSessionId: string;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    nextSessionId = crypto.randomUUID();
  } else {
    nextSessionId = `teacher-${Math.random().toString(36).slice(2, 12)}`;
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TEACHER_SESSION_STORAGE_KEY, nextSessionId);
  }
  return nextSessionId;
}

function snapshotFromStateUpdate(
  update: GameStateUpdateMessage,
  statuses: Record<string, TeacherPlayerStatus>
): TeacherRoomSnapshot {
  const targetScore = Math.max(1, Math.trunc(update.roomSettings?.targetScore ?? DEFAULT_TARGET_SCORE));
  return {
    roomId: update.roomId,
    lifecycleStatus: update.lifecycleStatus ?? lifecycleFromRacePhase(update.racePhase, update.raceStopped),
    racePhase: update.racePhase,
    raceStartingAtMs: update.raceStartingAtMs,
    raceStartedAtMs: update.raceStartedAtMs,
    raceStopped: update.raceStopped,
    raceStoppedAtMs: update.raceStoppedAtMs,
    winnerPlayerId: update.winnerPlayerId ?? "",
    roomSettings: update.roomSettings,
    trackLengthMeters: update.trackLengthMeters ?? targetScore,
    totalLaps: 1,
    players: buildTeacherPlayers(update.players, targetScore, statuses)
  };
}

function lifecycleFromRacePhase(racePhase: RacePhase, raceStopped = false): TeacherRoomSnapshot["lifecycleStatus"] {
  if (raceStopped || racePhase === "finish") {
    return "FINISHED";
  }
  if (racePhase === "active" || racePhase === "starting") {
    return "RACING";
  }
  return "WAITING";
}

function isTerminalLifecycle(status: TeacherRoomLifecycleStatus | undefined) {
  return status === "CLOSED" || status === "DELETED";
}

function stateRecordToUpdate(record: GameRoomStateRecord): GameStateUpdateMessage {
  const players = Object.values(record.players ?? {})
    .sort((left, right) => (left.joinedAtMs ?? 0) - (right.joinedAtMs ?? 0) || left.playerId.localeCompare(right.playerId))
    .map((player) => ({
      ...player,
      carId: normalizeCarId(player.carId)
    }));

  return {
    roomId: record.roomId,
    lifecycleStatus: record.deletedAtMs
      ? "DELETED"
      : record.closedAtMs
        ? "CLOSED"
        : record.endedAtMs || record.raceStopped || record.racePhase === "finish"
          ? "FINISHED"
          : record.racePhase === "active" || record.racePhase === "starting"
            ? "RACING"
            : "WAITING",
    serverTimeMs: Date.now(),
    tick: Number.isFinite(record.tick) ? record.tick : 0,
    racePhase: record.racePhase ?? "lobby",
    raceStartingAtMs: Number.isFinite(record.raceStartingAtMs) ? record.raceStartingAtMs : 0,
    raceStartedAtMs: Number.isFinite(record.raceStartedAtMs) ? record.raceStartedAtMs : 0,
    raceStopped: Boolean(record.raceStopped),
    raceStoppedAtMs: Number.isFinite(record.raceStoppedAtMs) ? record.raceStoppedAtMs : 0,
    winnerPlayerId: record.winnerPlayerId ?? "",
    roomCreatorPlayerId: "",
    roomSettings: record.roomSettings,
    trackLengthMeters: record.trackLengthMeters ?? record.roomSettings?.targetScore ?? DEFAULT_TARGET_SCORE,
    players
  };
}

export class TeacherGameClient {
  private supabaseClient: SupabaseClient | null = null;
  private roomChannel: RealtimeChannel | null = null;
  private syncTimerId: number | null = null;
  private syncAbortController: AbortController | null = null;
  private syncGeneration = 0;
  private syncFailureCount = 0;
  private syncLifecycleId: number | null = null;
  private liveSubscription: TeacherRoomLiveSubscription | null = null;
  private sseConnected = false;
  private liveTransportState: TeacherLiveTransportState = "idle";
  private liveStopReason = "";
  private sseConnectFallbackTimerId: number | null = null;
  private sseStaleTimerId: number | null = null;
  private lastSseEventAtMs = 0;
  private lastSseEventType = "";
  private sseMessageCount = 0;
  private lastTeacherPollAtMs = 0;
  private currentLiveRoomCode = "";
  private localUnsubscribe: (() => void) | null = null;
  private teacherSessionId = buildSessionId();
  private snapshotListener: SnapshotListener | null = null;
  private connectionListener: ConnectionListener | null = null;
  private localStatuses: Record<string, TeacherPlayerStatus> = {};
  private latestSnapshot: TeacherRoomSnapshot | null = null;
  private latestUpdateTick = -1;

  onSnapshot(listener: SnapshotListener) {
    this.snapshotListener = listener;
  }

  onConnection(listener: ConnectionListener) {
    this.connectionListener = listener;
  }

  getTeacherSessionId() {
    return this.teacherSessionId;
  }

  getAdapterInfo() {
    return getClassroomAdapterInfo();
  }

  getLiveDebugState() {
    return {
      transportState: this.liveTransportState,
      sseConnected: this.sseConnected,
      sseHealthy: this.isSseHealthy(),
      teacherPollingActive: this.syncLifecycleId !== null,
      latestRoomStatus: this.latestSnapshot?.lifecycleStatus ?? null,
      syncFailureCount: this.syncFailureCount,
      selectedRoomCode: this.currentLiveRoomCode || this.latestSnapshot?.roomId || null,
      lastSseEventAtMs: this.lastSseEventAtMs,
      lastSseEventType: this.lastSseEventType,
      sseMessageCount: this.sseMessageCount,
      lastTeacherPollAtMs: this.lastTeacherPollAtMs,
      stopReason: this.liveStopReason,
      fallbackIntervalMs: this.syncLifecycleId !== null ? this.getTeacherSyncIntervalMs() : 0,
      activeTeacherTimers: (this.syncTimerId !== null ? 1 : 0) + (this.sseConnectFallbackTimerId !== null ? 1 : 0) + (this.sseStaleTimerId !== null ? 1 : 0)
    };
  }

  async listRooms(): Promise<TeacherRoomSummary[]> {
    return listTeacherClassroomRooms(this.teacherSessionId) as Promise<TeacherRoomSummary[]>;
  }

  async openRoom(roomCode: string) {
    const adapter = getClassroomAdapterInfo();
    if (adapter.mode === "local-dev") {
      this.openLocalRoom(roomCode);
      return true;
    }
    if (adapter.mode !== "supabase") {
      throw new Error(adapter.message);
    }
    this.clearRuntime();
    this.setConnection("connecting");
    try {
      const response = await this.invokeSupabase("teacher-sync-room", { roomCode, teacherSessionId: this.teacherSessionId });
      if (response.stateUpdate) {
        this.applyUpdate(response.stateUpdate);
      }
      if (!isTerminalLifecycle(this.latestSnapshot?.lifecycleStatus)) {
        this.startSupabaseLive(roomCode);
      }
      this.setConnection("connected");
      return true;
    } catch (error) {
      this.setConnection("error", error instanceof Error ? error.message : "Unable to open teacher room.");
      throw error;
    }
  }

  async createRoom(config: TeacherRaceConfig) {
    this.clearRuntime();
    this.localStatuses = {};
    this.setConnection("connecting");
    const service = getClassroomRoomService();
    if (service.mode === "unavailable") {
      const message = getClassroomAdapterInfo().message;
      this.setConnection("error", message);
      throw new Error(message);
    }
    const result = await service.createRoom({
      roomCode: config.roomCode,
      teacherSessionId: this.teacherSessionId,
      roomSettings: configToRoomSettings(config),
      className: config.classGroup,
      difficulty: config.difficulty,
      mapId: config.trackTheme,
      questionTypes: ["MIXED"],
      requiresApproval: false
    });
    if (result.stateUpdate) {
      this.applyUpdate(result.stateUpdate);
    }
    if (service.mode === "local-dev") {
      this.subscribeToLocalRoom(config.roomCode);
    } else {
      this.startSupabaseLive(config.roomCode);
    }
    this.setConnection("connected", service.mode === "local-dev" ? "Local classroom dev mode" : undefined);
    return this.latestSnapshot;
  }

  async updateRoomSettings(settings: RoomSettings) {
    const adapter = getClassroomAdapterInfo();
    if (adapter.mode === "supabase") {
      await this.invokeSupabase("teacher-update-room-settings", { roomCode: this.latestSnapshot?.roomId, teacherSessionId: this.teacherSessionId, roomSettings: settings });
      return;
    }
    if (adapter.mode === "local-dev" && this.latestSnapshot) {
      updateLocalClassroomRoom(this.latestSnapshot.roomId, (room) => {
        const roomSettings = normalizeRoomSettings(room.roomId, settings);
        return {
          ...room,
          roomSettings,
          trackLengthMeters: Math.max(1, roomSettings.targetScore)
        };
      });
      return;
    }
    throw new Error(adapter.message);
  }

  async removePlayer(playerId: string) {
    this.localStatuses = { ...this.localStatuses, [playerId]: "DISCONNECTED" };
    const adapter = getClassroomAdapterInfo();
    if (adapter.mode === "supabase") {
      await this.invokeSupabase("teacher-remove-player", { roomCode: this.latestSnapshot?.roomId, teacherSessionId: this.teacherSessionId, targetPlayerId: playerId });
      return;
    }
    if (adapter.mode === "local-dev" && this.latestSnapshot) {
      updateLocalClassroomRoom(this.latestSnapshot.roomId, (room) => {
        const players = { ...room.players };
        delete players[playerId];
        return {
          ...room,
          players,
          removedPlayerIds: {
            ...room.removedPlayerIds,
            [playerId]: Date.now()
          }
        };
      });
      return;
    }
    throw new Error(adapter.message);
  }

  async startRace() {
    const adapter = getClassroomAdapterInfo();
    if (adapter.mode === "supabase") {
      await this.invokeSupabase("teacher-start-race", { roomCode: this.latestSnapshot?.roomId, teacherSessionId: this.teacherSessionId });
      return;
    }
    if (adapter.mode === "local-dev") {
      this.startLocalRace();
      return;
    }
    throw new Error(adapter.message);
  }

  async endRace() {
    const roomId = this.latestSnapshot?.roomId;
    if (!roomId) {
      return;
    }
    const response = await getClassroomRoomService().endRoom(roomId, this.teacherSessionId);
    if (response.stateUpdate) {
      this.applyUpdate(response.stateUpdate);
    }
  }

  async closeRoom(roomCode?: string) {
    const roomId = roomCode ?? this.latestSnapshot?.roomId;
    if (!roomId) {
      return;
    }
    const response = await getClassroomRoomService().closeRoom(roomId, this.teacherSessionId);
    if (response.stateUpdate) {
      this.applyUpdate(response.stateUpdate);
    }
    if (this.latestSnapshot && isTerminalLifecycle(this.latestSnapshot.lifecycleStatus)) {
      this.stopSupabaseLive("room-closed");
      this.stopSupabaseSync("room-closed");
    }
  }

  async deleteRoom(roomCode?: string) {
    const roomId = roomCode ?? this.latestSnapshot?.roomId;
    if (!roomId) {
      return;
    }
    await getClassroomRoomService().deleteRoom(roomId, this.teacherSessionId);
    if (!roomCode || roomId === this.latestSnapshot?.roomId) {
      this.clearRuntime();
      this.latestSnapshot = null;
      this.snapshotListener?.(null);
    }
  }

  async disconnect() {
    this.clearRuntime();
    this.latestSnapshot = null;
    this.localStatuses = {};
    this.setConnection("idle");
  }

  private rebuildLatestStatuses() {
    const snapshot = this.latestSnapshot;
    if (!snapshot) {
      return;
    }
    this.latestSnapshot = {
      ...snapshot,
      players: snapshot.players.map((player) => ({
        ...player,
        status: this.localStatuses[player.playerId] ?? player.status
      }))
    };
    this.snapshotListener?.(this.latestSnapshot);
  }

  private applyUpdate(update: GameStateUpdateMessage) {
    if (this.latestSnapshot && isStaleTeacherRaceUpdate(
      this.latestSnapshot.racePhase,
      this.latestSnapshot.raceStartedAtMs,
      this.latestUpdateTick,
      update.racePhase,
      update.raceStartedAtMs,
      update.tick
    )) {
      return;
    }
    const nextSnapshot = snapshotFromStateUpdate(update, this.localStatuses);
    for (const player of nextSnapshot.players) {
      if (!this.localStatuses[player.playerId]) {
        this.localStatuses[player.playerId] = "JOINED";
      }
    }
    this.latestSnapshot = snapshotFromStateUpdate(update, this.localStatuses);
    this.latestUpdateTick = Number.isFinite(update.tick) ? update.tick : this.latestUpdateTick;
    this.snapshotListener?.(this.latestSnapshot);
    if (isTerminalLifecycle(this.latestSnapshot.lifecycleStatus)) {
      this.stopSupabaseSync(this.latestSnapshot.lifecycleStatus.toLowerCase());
      this.stopSupabaseLive(this.latestSnapshot.lifecycleStatus.toLowerCase());
    }
  }

  private openLocalRoom(roomCode: string) {
    this.clearRuntime();
    const room = readLocalClassroomRoom(roomCode);
    if (!room || room.deletedAtMs) {
      throw new Error("Room not found or not available.");
    }
    this.applyUpdate(localRoomToStateUpdate(room));
    this.subscribeToLocalRoom(roomCode);
    this.setConnection("connected", "Local classroom dev mode");
  }

  private subscribeToLocalRoom(roomCode: string) {
    this.clearRuntime();
    const unsubscribe = subscribeLocalClassroomRoom(roomCode, (room) => {
      if (room.deletedAtMs) {
        this.latestSnapshot = null;
        this.snapshotListener?.(null);
        this.clearRuntime();
        this.setConnection("error", "This room was deleted.");
        return;
      }
      if (room.closedAtMs) {
        this.applyUpdate(localRoomToStateUpdate(room));
        this.clearRuntime();
        this.setConnection("connected", "Room closed");
        return;
      }
      this.applyUpdate(localRoomToStateUpdate(room));
    });
    this.localUnsubscribe = unsubscribe;
  }

  private startLocalRace() {
    const snapshot = this.latestSnapshot;
    if (!snapshot || snapshot.players.length === 0 || snapshot.racePhase !== "lobby") {
      return;
    }
    const now = Date.now();
    updateLocalClassroomRoom(snapshot.roomId, (room) => {
      const players: Record<string, PlayerSnapshot> = {};
      for (const player of Object.values(room.players)) {
        players[player.playerId] = {
          ...player,
          positionMeters: 0,
          speedMps: 0,
          lap: 0,
          finished: false,
          racePhase: "starting"
        };
      }
      return {
        ...room,
        racePhase: "starting",
        raceStartingAtMs: now + LOCAL_START_DELAY_MS,
        raceStartedAtMs: 0,
        startedAtMs: now + LOCAL_START_DELAY_MS,
        raceStopped: false,
        raceStoppedAtMs: 0,
        winnerPlayerId: null,
        players
      };
    });
  }

  private async invokeSupabase(functionName: string, payload: object, signal?: AbortSignal) {
    const config = getSupabaseTransportConfig();
    if (!config) {
      throw new Error("Supabase transport is not configured.");
    }
    if (functionName === "teacher-sync-room") {
      if (this.blockTeacherSyncRoomRequest("invoke-supabase")) {
        return { error: null } satisfies GameFunctionResponse;
      }
      recordNetworkRequest("teacher-sync-room", "teacher");
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
    const body = await response.json().catch(() => ({})) as GameFunctionResponse;
    if (!response.ok) {
      throw new Error(formatTeacherFunctionError(functionName, body.error));
    }
    if (body.error) {
      throw new Error(formatTeacherFunctionError(functionName, body.error));
    }
    if (body.stateUpdate) {
      this.applyUpdate(body.stateUpdate);
    }
    return body;
  }

  private subscribeToSupabaseRoom(roomId: string) {
    void this.unsubscribeFromSupabaseRoom();
    this.roomChannel = this.getSupabaseClient()
      .channel(`teacher-room:${roomId}`)
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
          if (stateJson) {
            this.applyUpdate(stateRecordToUpdate(stateJson));
          }
        }
      )
      .subscribe();
  }

  private startSupabaseSync(roomId: string, reason = "fallback") {
    this.stopSupabaseSync("restart");
    if (this.blockTeacherSyncRoomRequest(`start-${reason}`) || isTerminalLifecycle(this.latestSnapshot?.lifecycleStatus)) {
      return;
    }
    this.setLiveTransportState("polling_fallback", reason);
    const generation = ++this.syncGeneration;
    this.syncLifecycleId = startSyncLifecycle({
      key: `teacher:${roomId}`,
      role: "teacher",
      mode: "classroom",
      adapter: "supabase",
      roomId,
      roomCode: roomId,
      intervalMs: this.getTeacherSyncIntervalMs()
    });
    if (import.meta.env.DEV) {
      console.info("[teacher-sync] polling fallback started", { roomId, reason });
    }
    this.scheduleTeacherSync(roomId, generation, 0);
  }

  private stopSupabaseSync(reason = "stopped") {
    this.syncGeneration += 1;
    if (this.syncTimerId !== null) {
      window.clearTimeout(this.syncTimerId);
      this.syncTimerId = null;
    }
    if (this.syncAbortController) {
      this.syncAbortController.abort();
      this.syncAbortController = null;
    }
    stopSyncLifecycle(this.syncLifecycleId, reason);
    this.syncLifecycleId = null;
    this.syncFailureCount = 0;
  }

  private scheduleTeacherSync(roomId: string, generation: number, delayMs: number) {
    if (generation !== this.syncGeneration || this.blockTeacherSyncRoomRequest("schedule") || isTerminalLifecycle(this.latestSnapshot?.lifecycleStatus)) {
      return;
    }
    if (this.syncTimerId !== null) {
      window.clearTimeout(this.syncTimerId);
    }
    this.syncTimerId = window.setTimeout(() => {
      this.syncTimerId = null;
      void this.runTeacherSync(roomId, generation);
    }, delayMs);
    updateSyncLifecycle(this.syncLifecycleId ?? 0, { nextSyncAtMs: Date.now() + delayMs });
  }

  private async runTeacherSync(roomId: string, generation: number) {
    if (generation !== this.syncGeneration || this.blockTeacherSyncRoomRequest("run") || isTerminalLifecycle(this.latestSnapshot?.lifecycleStatus)) {
      return;
    }
    this.syncAbortController = new AbortController();
    try {
      if (this.blockTeacherSyncRoomRequest("before-fetch")) {
        return;
      }
      const response = await this.invokeSupabase("teacher-sync-room", { roomCode: roomId, teacherSessionId: this.teacherSessionId }, this.syncAbortController.signal);
      if (generation !== this.syncGeneration) {
        return;
      }
      this.syncFailureCount = 0;
      this.lastTeacherPollAtMs = Date.now();
      updateSyncLifecycle(this.syncLifecycleId ?? 0, {
        lastSyncAtMs: Date.now(),
        lastStatus: response.stateUpdate?.lifecycleStatus ?? "OK"
      });
      if (isTerminalLifecycle(response.stateUpdate?.lifecycleStatus)) {
        this.stopSupabaseSync(response.stateUpdate?.lifecycleStatus?.toLowerCase() ?? "terminal");
        return;
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError" && generation === this.syncGeneration) {
        this.syncFailureCount += 1;
        this.setConnection("error", error instanceof Error ? error.message : "Teacher sync failed.");
        if (this.syncFailureCount >= 5) {
          this.stopSupabaseSync("teacher-sync-repeated-failure");
        }
      }
    } finally {
      this.syncAbortController = null;
      if (generation === this.syncGeneration) {
        if (this.blockTeacherSyncRoomRequest("finally")) {
          return;
        }
        const intervalMs = this.syncFailureCount >= 3
          ? 30000
          : Math.min(15000, this.getTeacherSyncIntervalMs() * Math.max(1, this.syncFailureCount + 1));
        updateSyncLifecycle(this.syncLifecycleId ?? 0, { intervalMs });
        this.scheduleTeacherSync(roomId, generation, intervalMs);
      }
    }
  }

  private getTeacherSyncIntervalMs() {
    const snapshot = this.latestSnapshot;
    if (!snapshot) {
      return 10000;
    }
    if (document.visibilityState === "hidden") {
      return 15000;
    }
    if (snapshot.lifecycleStatus === "RACING") {
      return 5000;
    }
    if (snapshot.lifecycleStatus === "WAITING") {
      return 5000;
    }
    return 15000;
  }

  private startSupabaseLive(roomId: string) {
    this.stopSupabaseLive("restart");
    this.stopSupabaseSync("sse-connecting");
    this.currentLiveRoomCode = roomId;
    this.resetSseHealth();
    this.setLiveTransportState("connecting_sse", "start");
    this.sseConnectFallbackTimerId = window.setTimeout(() => {
      this.sseConnectFallbackTimerId = null;
      if (this.liveTransportState === "connecting_sse" && !this.sseConnected) {
        this.setLiveTransportState("sse_error", "connect-timeout");
        this.startSupabaseSync(roomId, "sse-connect-timeout");
      }
    }, SSE_CONNECT_TIMEOUT_MS);
    recordNetworkRequest("teacher-room-events", "teacher");
    this.liveSubscription = connectTeacherRoomLiveUpdates({
      roomId,
      roomCode: roomId,
      teacherSessionId: this.teacherSessionId,
      onConnected: (event) => {
        this.sseConnected = true;
        this.clearSseConnectFallbackTimer();
        this.stopSupabaseSync("sse-connected");
        this.setLiveTransportState("sse_connected", event.event);
        this.setConnection("connected");
      },
      onUpdate: (event) => {
        this.markSseHealthy(event);
        if (this.sseConnected && this.syncLifecycleId !== null && import.meta.env.DEV) {
          console.warn("BUG: teacher SSE and polling are active at the same time", this.getLiveDebugState());
          this.stopSupabaseSync("bug-sse-and-polling");
        }
        if (event.stateUpdate) {
          this.applyUpdate(event.stateUpdate);
        }
        if (event.event === "room_closed" || event.event === "room_deleted" || event.event === "room_finished") {
          this.stopSupabaseLive(event.event);
        }
      },
      onError: (error) => {
        this.sseConnected = false;
        this.liveSubscription = null;
        this.clearSseConnectFallbackTimer();
        this.clearSseStaleTimer();
        this.setLiveTransportState("sse_error", error.message);
        if (import.meta.env.DEV) {
          console.warn("[teacher-sse] falling back to polling", error);
        }
        this.startSupabaseSync(roomId, "sse-error");
      }
    });
  }

  private stopSupabaseLive(reason = "stopped") {
    this.clearSseConnectFallbackTimer();
    this.clearSseStaleTimer();
    if (this.liveSubscription) {
      this.liveSubscription.disconnect(reason);
      this.liveSubscription = null;
    }
    this.sseConnected = false;
    this.setLiveTransportState("stopped", reason);
  }

  private clearSseConnectFallbackTimer() {
    if (this.sseConnectFallbackTimerId !== null) {
      window.clearTimeout(this.sseConnectFallbackTimerId);
      this.sseConnectFallbackTimerId = null;
    }
  }

  private clearSseStaleTimer() {
    if (this.sseStaleTimerId !== null) {
      window.clearTimeout(this.sseStaleTimerId);
      this.sseStaleTimerId = null;
    }
  }

  private resetSseHealth() {
    this.clearSseStaleTimer();
    this.lastSseEventAtMs = 0;
    this.lastSseEventType = "";
    this.sseMessageCount = 0;
  }

  private isSseRecentlyHealthy() {
    return this.lastSseEventAtMs > 0 && Date.now() - this.lastSseEventAtMs <= SSE_RECENT_EVENT_MS;
  }

  private isSseHealthy() {
    return this.sseConnected && this.isSseRecentlyHealthy();
  }

  private blockTeacherSyncRoomRequest(reason: string) {
    const shouldBlock = this.liveTransportState === "sse_connected" || this.isSseHealthy() || (this.liveSubscription !== null && this.liveTransportState !== "sse_error" && this.isSseRecentlyHealthy());
    if (!shouldBlock) {
      return false;
    }
    recordNetworkRequest("teacher-sync-room-blocked", "teacher");
    if (import.meta.env.DEV) {
      console.warn("Blocked teacher-sync-room because SSE is healthy", {
        reason,
        transportState: this.liveTransportState,
        sseConnected: this.sseConnected,
        lastSseEventAtMs: this.lastSseEventAtMs,
        lastSseEventType: this.lastSseEventType,
        roomCode: this.currentLiveRoomCode
      });
    }
    if (this.syncLifecycleId !== null || this.syncTimerId !== null || this.syncAbortController) {
      this.stopSupabaseSync("sse-connected");
    }
    return true;
  }

  private markSseHealthy(event: TeacherRoomLiveUpdate) {
    this.lastSseEventAtMs = Date.now();
    this.lastSseEventType = event.event;
    this.sseMessageCount += 1;
    this.sseConnected = true;
    this.clearSseConnectFallbackTimer();
    this.stopSupabaseSync("sse-connected");
    if (this.liveTransportState !== "sse_connected") {
      this.setLiveTransportState("sse_connected", event.event);
    }
    this.clearSseStaleTimer();
    this.sseStaleTimerId = window.setTimeout(() => {
      this.sseStaleTimerId = null;
      if (!this.sseConnected || this.liveTransportState !== "sse_connected") {
        return;
      }
      if (Date.now() - this.lastSseEventAtMs < SSE_STALE_EVENT_MS) {
        return;
      }
      this.sseConnected = false;
      this.setLiveTransportState("sse_error", "sse-stale");
      if (import.meta.env.DEV) {
        console.warn("[teacher-sse] stale stream detected; polling fallback can resume", this.getLiveDebugState());
      }
      if (this.currentLiveRoomCode && !isTerminalLifecycle(this.latestSnapshot?.lifecycleStatus)) {
        this.startSupabaseSync(this.currentLiveRoomCode, "sse-stale");
      }
    }, SSE_STALE_EVENT_MS);
  }

  private setLiveTransportState(state: TeacherLiveTransportState, reason = "") {
    this.liveTransportState = state;
    this.liveStopReason = reason;
    if (import.meta.env.DEV) {
      console.info("[teacher-live]", { state, reason, roomCode: this.currentLiveRoomCode });
    }
  }

  private async unsubscribeFromSupabaseRoom() {
    const channel = this.roomChannel;
    this.roomChannel = null;
    if (channel && this.supabaseClient) {
      await this.supabaseClient.removeChannel(channel);
    }
  }

  private clearRuntime() {
    this.stopSupabaseLive("clear-runtime");
    this.stopSupabaseSync("clear-runtime");
    void this.unsubscribeFromSupabaseRoom();
    if (this.localUnsubscribe) {
      this.localUnsubscribe();
      this.localUnsubscribe = null;
    }
    this.latestUpdateTick = -1;
  }

  private getSupabaseClient() {
    if (this.supabaseClient) {
      return this.supabaseClient;
    }
    const config = getSupabaseTransportConfig();
    if (!config) {
      throw new Error("Supabase transport is not configured.");
    }
    this.supabaseClient = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    return this.supabaseClient;
  }

  private setConnection(status: "idle" | "connecting" | "connected" | "error", message?: string) {
    this.connectionListener?.(status, message);
  }
}
