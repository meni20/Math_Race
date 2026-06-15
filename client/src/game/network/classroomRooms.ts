import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createLocalClassroomRoom,
  listLocalClassroomRooms,
  localRoomToStateUpdate,
  readLocalClassroomRoom,
  subscribeLocalClassroomRoom,
  updateLocalClassroomRoom,
  type LocalClassroomRoom
} from "./localClassroom";
import { getSupabaseTransportConfig } from "./transportConfig";
import type { GameStateUpdateMessage, RoomSettings } from "../types/messages";
import { normalizeRoomSettings } from "../utils/roomSettings";
import { recordActiveClassroomListRequest, recordNetworkRequest } from "../sync/syncLifecycle";

export type ClassroomRoomLifecycleStatus = "DRAFT" | "CREATED" | "WAITING" | "RACING" | "FINISHED" | "CLOSED" | "DELETED";
export type ClassroomAdapterMode = "supabase" | "local-dev" | "unavailable";

export interface ClassroomRoomSummary {
  id: string;
  teacherId: string | null;
  roomCode: string;
  raceName: string;
  className: string | null;
  status: ClassroomRoomLifecycleStatus;
  maxPlayers: number;
  currentPlayers: number;
  raceDurationSeconds: number;
  questionTimeLimitSeconds: number;
  targetScore: number;
  difficulty: string | null;
  mapId: string | null;
  requiresApproval: boolean;
  isLocked: boolean;
  isListed: boolean;
  allowMidGameJoin: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  closedAt: string | null;
  deletedAt: string | null;
}

export interface ClassroomCreateRoomInput {
  roomCode: string;
  teacherSessionId: string;
  roomSettings: RoomSettings;
  className?: string;
  difficulty?: string;
  mapId?: string;
  questionTypes?: string[];
  requiresApproval?: boolean;
}

export interface ClassroomCreateRoomResult {
  room: ClassroomRoomSummary;
  stateUpdate?: GameStateUpdateMessage;
}

interface GameFunctionResponse {
  stateUpdate?: GameStateUpdateMessage;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

interface ListRoomsResponse {
  rooms?: ClassroomRoomSummary[];
  error?: {
    code?: string;
    message?: string;
  } | null;
}

interface GetRoomResponse {
  room?: ClassroomRoomSummary | null;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

interface ArchiveStaleRoomsResponse {
  archivedCount?: number;
  thresholdHours?: number;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

export interface ArchiveStaleRoomsInput {
  teacherSessionId: string;
  thresholdHours?: number;
  excludeRoomCode?: string;
}

export interface ClassroomAdapterInfo {
  mode: ClassroomAdapterMode;
  supabaseConfigured: boolean;
  localDevEnabled: boolean;
  message: string;
}

export interface ClassroomRoomService {
  readonly mode: ClassroomAdapterMode;
  createRoom(input: ClassroomCreateRoomInput): Promise<ClassroomCreateRoomResult>;
  listTeacherRooms(teacherSessionId: string): Promise<ClassroomRoomSummary[]>;
  listActiveRooms(): Promise<ClassroomRoomSummary[]>;
  getRoomByCode(roomCode: string): Promise<ClassroomRoomSummary | null>;
  archiveStaleRooms(input: ArchiveStaleRoomsInput): Promise<{ archivedCount: number; thresholdHours: number }>;
  deleteRoom(roomCode: string, teacherSessionId: string): Promise<GameFunctionResponse>;
  closeRoom(roomCode: string, teacherSessionId: string): Promise<GameFunctionResponse>;
  endRoom(roomCode: string, teacherSessionId: string): Promise<GameFunctionResponse>;
  subscribeToRoom(roomCode: string, listener: (stateUpdate: GameStateUpdateMessage | null) => void): () => void;
}

let classroomRoomsClient: SupabaseClient | null = null;
let didLogDiagnostics = false;
const LOCAL_DEV_SESSION_STORAGE_KEY = "mathRace.classroomDevSessionId";

function isExplicitLocalDevEnabled() {
  return String(import.meta.env.VITE_CLASSROOM_LOCAL_DEV ?? "").toLowerCase() === "true";
}

function getLocalDevSessionId() {
  if (typeof window === "undefined") {
    return "server";
  }
  const raw = window.localStorage.getItem(LOCAL_DEV_SESSION_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id?: string; createdAtMs?: number };
      if (parsed.id && parsed.createdAtMs && Date.now() - parsed.createdAtMs < 12 * 60 * 60 * 1000) {
        return parsed.id;
      }
    } catch {
      // Recreate malformed dev metadata below.
    }
  }
  const next = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `dev-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(LOCAL_DEV_SESSION_STORAGE_KEY, JSON.stringify({ id: next, createdAtMs: Date.now() }));
  return next;
}

export function getClassroomAdapterInfo(): ClassroomAdapterInfo {
  const supabaseConfigured = Boolean(getSupabaseTransportConfig());
  const localDevEnabled = !supabaseConfigured && (Boolean(import.meta.env.DEV) || isExplicitLocalDevEnabled());
  const info: ClassroomAdapterInfo = supabaseConfigured
    ? {
      mode: "supabase",
      supabaseConfigured,
      localDevEnabled: false,
      message: "Using Supabase classroom database."
    }
    : localDevEnabled
      ? {
        mode: "local-dev",
        supabaseConfigured,
        localDevEnabled,
        message: "Local classroom dev mode"
      }
      : {
        mode: "unavailable",
        supabaseConfigured,
        localDevEnabled,
        message: "Supabase is not configured. Classroom rooms cannot be created."
      };

  if (import.meta.env.DEV && !didLogDiagnostics) {
    didLogDiagnostics = true;
    console.info("[classroom]", {
      supabaseConfigured: info.supabaseConfigured,
      classroomAdapter: info.mode,
      message: info.message
    });
  }

  return info;
}

function getClient() {
  if (classroomRoomsClient) {
    return classroomRoomsClient;
  }
  const config = getSupabaseTransportConfig();
  if (!config) {
    throw new Error("Supabase is not configured. Classroom rooms cannot be created.");
  }
  classroomRoomsClient = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  return classroomRoomsClient;
}

function logClassroomError(operation: string, payload: object, error: unknown) {
  if (!import.meta.env.DEV) {
    return;
  }
  console.error("[classroom]", operation, {
    error,
    payload
  });
}

function formatFunctionError(functionName: string, error: { code?: string; message?: string; operation?: string; missingFieldOrColumn?: string; validationIssue?: string; originalMessage?: string } | null | undefined) {
  if (!error) {
    return `Supabase function failed: ${functionName}`;
  }
  const detail = [
    error.message || error.code || `Supabase function failed: ${functionName}`,
    error.operation ? `operation: ${error.operation}` : "",
    error.missingFieldOrColumn ? `missing field/column: ${error.missingFieldOrColumn}` : "",
    error.validationIssue ? `validation: ${error.validationIssue}` : "",
    error.originalMessage && error.originalMessage !== error.message ? `original: ${error.originalMessage}` : ""
  ].filter(Boolean);
  return detail.join(" | ");
}

function formatInvokeTransportError(functionName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const config = getSupabaseTransportConfig();
  let host = "the configured Supabase project";
  if (config) {
    try {
      host = new URL(config.url).host;
    } catch {
      host = config.url;
    }
  }
  if (message.includes("Failed to send a request to the Edge Function")) {
    return `Cannot reach Supabase Edge Function "${functionName}" at ${host}. Check that VITE_SUPABASE_URL points to an active Supabase project and that the function is deployed.`;
  }
  return message || `Supabase function not deployed: ${functionName}`;
}

async function invokeFunction<T>(functionName: string, payload: object = {}) {
  const { data, error } = await getClient().functions.invoke(functionName, {
    body: payload as Record<string, unknown>
  });
  if (error) {
    logClassroomError(functionName, payload, error);
    throw new Error(formatInvokeTransportError(functionName, error));
  }
  const response = (data ?? {}) as T & { error?: { code?: string; message?: string; operation?: string; missingFieldOrColumn?: string; validationIssue?: string; originalMessage?: string } | null };
  if (response.error) {
    logClassroomError(functionName, payload, response.error);
    throw new Error(formatFunctionError(functionName, response.error));
  }
  return response;
}

function dateFromMs(value: number | null | undefined) {
  return Number.isFinite(value) && value && value > 0 ? new Date(value).toISOString() : null;
}

function deriveLocalStatus(room: LocalClassroomRoom): ClassroomRoomLifecycleStatus {
  if (room.deletedAtMs) {
    return "DELETED";
  }
  if (room.closedAtMs) {
    return "CLOSED";
  }
  if (room.endedAtMs || room.raceStopped || room.racePhase === "finish") {
    return "FINISHED";
  }
  if (room.racePhase === "active" || room.racePhase === "starting") {
    return "RACING";
  }
  return "WAITING";
}

function isJoinable(room: ClassroomRoomSummary) {
  const joinableStatus = room.status === "WAITING" || (room.status === "RACING" && room.allowMidGameJoin);
  return joinableStatus
    && !room.deletedAt
    && !room.closedAt
    && !room.endedAt
    && room.isListed
    && !room.isLocked
    && room.currentPlayers < room.maxPlayers;
}

function localRoomToSummary(room: LocalClassroomRoom): ClassroomRoomSummary {
  const settings = normalizeRoomSettings(room.roomId, room.roomSettings);
  const createdAt = dateFromMs(room.createdAtMs) ?? new Date(0).toISOString();
  return {
    id: room.roomId,
    teacherId: room.teacherSessionId ?? null,
    roomCode: room.roomId,
    raceName: settings.raceName,
    className: null,
    status: deriveLocalStatus(room),
    maxPlayers: settings.maxPlayers,
    currentPlayers: Object.keys(room.players ?? {}).length,
    raceDurationSeconds: settings.raceDurationSeconds,
    questionTimeLimitSeconds: settings.questionTimeLimitSeconds,
    targetScore: settings.targetScore,
    difficulty: settings.difficulty ?? null,
    mapId: settings.mapId ?? null,
    requiresApproval: false,
    isLocked: Boolean(room.isLocked),
    isListed: room.isListed !== false,
    allowMidGameJoin: room.allowMidGameJoin !== false,
    createdAt,
    updatedAt: dateFromMs(room.updatedAtMs) ?? createdAt,
    startedAt: dateFromMs(room.startedAtMs ?? room.raceStartedAtMs),
    endedAt: dateFromMs(room.endedAtMs),
    closedAt: dateFromMs(room.closedAtMs),
    deletedAt: dateFromMs(room.deletedAtMs)
  };
}

class SupabaseClassroomRoomService implements ClassroomRoomService {
  readonly mode = "supabase" as const;

  async createRoom(input: ClassroomCreateRoomInput) {
    const response = await invokeFunction<GameFunctionResponse>("teacher-create-room", {
      roomId: input.roomCode,
      teacherSessionId: input.teacherSessionId,
      roomSettings: input.roomSettings,
      className: input.className,
      difficulty: input.difficulty,
      mapId: input.mapId,
      questionTypes: ["MIXED"],
      requiresApproval: false
    });
    const room = await this.getRoomByCode(input.roomCode);
    if (!room) {
      throw new Error("Could not create room: Supabase did not return the created classroom room.");
    }
    return { room, stateUpdate: response.stateUpdate };
  }

  async listTeacherRooms(teacherSessionId: string) {
    recordNetworkRequest("list-teacher-rooms", "teacher");
    const response = await invokeFunction<ListRoomsResponse>("list-teacher-rooms", { teacherSessionId });
    return response.rooms ?? [];
  }

  async listActiveRooms() {
    const response = await invokeFunction<ListRoomsResponse>("list-active-classroom-rooms");
    return response.rooms ?? [];
  }

  async getRoomByCode(roomCode: string) {
    const response = await invokeFunction<GetRoomResponse>("get-classroom-room", { roomCode });
    return response.room ?? null;
  }

  async archiveStaleRooms(input: ArchiveStaleRoomsInput) {
    const response = await invokeFunction<ArchiveStaleRoomsResponse>("teacher-archive-stale-classroom-rooms", {
      teacherSessionId: input.teacherSessionId,
      thresholdHours: input.thresholdHours,
      excludeRoomCode: input.excludeRoomCode
    });
    return {
      archivedCount: Math.max(0, Math.trunc(response.archivedCount ?? 0)),
      thresholdHours: Math.max(12, Math.trunc(response.thresholdHours ?? input.thresholdHours ?? 24))
    };
  }

  async deleteRoom(roomCode: string, teacherSessionId: string) {
    return invokeFunction<GameFunctionResponse>("teacher-delete-room", { roomCode, teacherSessionId });
  }

  async closeRoom(roomCode: string, teacherSessionId: string) {
    return invokeFunction<GameFunctionResponse>("teacher-close-room", { roomCode, teacherSessionId });
  }

  async endRoom(roomCode: string, teacherSessionId: string) {
    return invokeFunction<GameFunctionResponse>("teacher-end-room", { roomCode, teacherSessionId });
  }

  subscribeToRoom(_roomCode: string, _listener: (stateUpdate: GameStateUpdateMessage | null) => void) {
    return () => undefined;
  }

}

class LocalDevClassroomRoomService implements ClassroomRoomService {
  readonly mode = "local-dev" as const;

  async createRoom(input: ClassroomCreateRoomInput) {
    const room = createLocalClassroomRoom(input.roomCode, input.roomSettings);
    room.teacherSessionId = input.teacherSessionId;
    room.devSessionId = getLocalDevSessionId();
    room.requiresApproval = false;
    room.isListed = true;
    room.isLocked = false;
    room.allowMidGameJoin = true;
    room.updatedAtMs = Date.now();
    updateLocalClassroomRoom(room.roomId, () => room);
    return {
      room: localRoomToSummary(room),
      stateUpdate: localRoomToStateUpdate(room)
    };
  }

  async listTeacherRooms(teacherSessionId: string) {
    return listLocalClassroomRooms()
      .filter((room) => room.devSessionId === getLocalDevSessionId())
      .filter((room) => !room.deletedAtMs && (!room.teacherSessionId || room.teacherSessionId === teacherSessionId))
      .map(localRoomToSummary)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listActiveRooms() {
    return listLocalClassroomRooms()
      .filter((room) => room.devSessionId === getLocalDevSessionId())
      .map(localRoomToSummary)
      .filter(isJoinable)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getRoomByCode(roomCode: string) {
    const room = readLocalClassroomRoom(roomCode);
    return room ? localRoomToSummary(room) : null;
  }

  async archiveStaleRooms(input: ArchiveStaleRoomsInput) {
    const thresholdHours = Math.max(12, Math.trunc(input.thresholdHours ?? 24));
    const cutoffMs = Date.now() - (thresholdHours * 60 * 60 * 1000);
    const excludeRoomCode = (input.excludeRoomCode ?? "").trim().toUpperCase();
    let archivedCount = 0;

    for (const room of listLocalClassroomRooms()) {
      if (room.devSessionId !== getLocalDevSessionId()) {
        continue;
      }
      if (room.roomId === excludeRoomCode) {
        continue;
      }
      if (room.deletedAtMs || room.closedAtMs || room.endedAtMs) {
        continue;
      }
      if (room.racePhase !== "lobby" || room.raceStopped) {
        continue;
      }
      if ((room.createdAtMs ?? Date.now()) > cutoffMs) {
        continue;
      }
      const updatedRoom = updateLocalClassroomRoom(room.roomId, (current) => ({
        ...current,
        deletedAtMs: Date.now(),
        closedAtMs: current.closedAtMs || Date.now(),
        isListed: false,
        isLocked: true,
        raceStopped: true,
        raceStoppedAtMs: Date.now()
      }));
      if (updatedRoom) {
        archivedCount += 1;
      }
    }
    return { archivedCount, thresholdHours };
  }

  async deleteRoom(roomCode: string) {
    const now = Date.now();
    const room = updateLocalClassroomRoom(roomCode, (current) => ({
      ...current,
      deletedAtMs: now,
      closedAtMs: current.closedAtMs || now,
      isListed: false,
      isLocked: true
    }));
    return { stateUpdate: room ? localRoomToStateUpdate(room) : undefined };
  }

  async closeRoom(roomCode: string) {
    const now = Date.now();
    const room = updateLocalClassroomRoom(roomCode, (current) => ({
      ...current,
      closedAtMs: now,
      isListed: false,
      isLocked: true
    }));
    return { stateUpdate: room ? localRoomToStateUpdate(room) : undefined };
  }

  async endRoom(roomCode: string) {
    const now = Date.now();
    const room = updateLocalClassroomRoom(roomCode, (current) => ({
      ...current,
      racePhase: "finish",
      raceStopped: true,
      raceStoppedAtMs: now,
      endedAtMs: now,
      isListed: false,
      isLocked: true,
      players: Object.fromEntries(Object.values(current.players).map((player) => [
        player.playerId,
        {
          ...player,
          racePhase: "finish",
          speedMps: 0
        }
      ]))
    }));
    return { stateUpdate: room ? localRoomToStateUpdate(room) : undefined };
  }

  subscribeToRoom(roomCode: string, listener: (stateUpdate: GameStateUpdateMessage | null) => void) {
    return subscribeLocalClassroomRoom(roomCode, (room) => listener(localRoomToStateUpdate(room)));
  }
}

class UnavailableClassroomRoomService implements ClassroomRoomService {
  readonly mode = "unavailable" as const;

  private fail(): never {
    throw new Error("Supabase is not configured. Classroom rooms cannot be created.");
  }

  async createRoom(): Promise<ClassroomCreateRoomResult> {
    this.fail();
  }

  async listTeacherRooms() {
    return [] as ClassroomRoomSummary[];
  }

  async listActiveRooms() {
    return [] as ClassroomRoomSummary[];
  }

  async getRoomByCode() {
    return null;
  }

  async archiveStaleRooms() {
    return { archivedCount: 0, thresholdHours: 24 };
  }

  async deleteRoom(): Promise<GameFunctionResponse> {
    this.fail();
  }

  async closeRoom(): Promise<GameFunctionResponse> {
    this.fail();
  }

  async endRoom(): Promise<GameFunctionResponse> {
    this.fail();
  }

  subscribeToRoom() {
    return () => undefined;
  }
}

export function getClassroomRoomService(): ClassroomRoomService {
  const info = getClassroomAdapterInfo();
  if (info.mode === "supabase") {
    return new SupabaseClassroomRoomService();
  }
  if (info.mode === "local-dev") {
    return new LocalDevClassroomRoomService();
  }
  return new UnavailableClassroomRoomService();
}

export async function listActiveClassroomRooms(options: { panelOpen?: boolean; inClassroomRoom?: boolean; manual?: boolean } = {}) {
  if (getClassroomAdapterInfo().mode === "supabase") {
    recordActiveClassroomListRequest({
      panelOpen: Boolean(options.panelOpen),
      inClassroomRoom: Boolean(options.inClassroomRoom),
      manual: options.manual
    });
  }
  return getClassroomRoomService().listActiveRooms();
}

export async function listTeacherClassroomRooms(teacherSessionId: string) {
  return getClassroomRoomService().listTeacherRooms(teacherSessionId);
}

export async function archiveStaleClassroomRooms(input: ArchiveStaleRoomsInput) {
  return getClassroomRoomService().archiveStaleRooms(input);
}
