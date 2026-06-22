import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GameRoomStateRecord, PlayerStateRecord, RoomSettings } from "./contracts.ts";

export type ClassroomRoomStatus = "DRAFT" | "CREATED" | "WAITING" | "RACING" | "FINISHED" | "CLOSED" | "DELETED";

export interface ClassroomRoomSummary {
  id: string;
  teacherId: string | null;
  roomCode: string;
  joinCode: string;
  raceName: string;
  className: string | null;
  status: ClassroomRoomStatus;
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

const CLASSROOM_ROOMS_TABLE = "classroom_rooms";
const ROOM_PARTICIPANTS_TABLE = "room_participants";
const ROOM_EVENTS_TABLE = "room_events";
const DEFAULT_TARGET_SCORE = 300;
const MIN_TARGET_SCORE = 50;
const MAX_TARGET_SCORE = 10000;
const OPTIONAL_CLASSROOM_ROOM_COLUMNS = new Set(["target_score", "join_code"]);
const OPTIONAL_ROOM_PARTICIPANT_COLUMNS = new Set([
  "timeout_answers",
  "score",
  "connection_status",
  "last_seen_at",
  "player_session_id"
]);

function dateFromMs(value: number | null | undefined) {
  return Number.isFinite(value) && value && value > 0 ? new Date(value).toISOString() : null;
}

function settingsValue(settings: RoomSettings | undefined | null, fallbackRoomCode: string) {
  const targetScore = Number(settings?.targetScore ?? DEFAULT_TARGET_SCORE);
  return {
    raceName: settings?.raceName?.trim() || "Classroom Math Race",
    maxPlayers: 8,
    raceDurationSeconds: Math.max(1, Math.trunc(settings?.raceDurationSeconds ?? 180)),
    questionTimeLimitSeconds: Math.max(1, Math.trunc(settings?.questionTimeLimitSeconds ?? 15)),
    targetScore: Number.isFinite(targetScore)
      ? Math.max(MIN_TARGET_SCORE, Math.min(MAX_TARGET_SCORE, Math.trunc(targetScore)))
      : DEFAULT_TARGET_SCORE,
    roomCode: fallbackRoomCode
  };
}

export function buildClassroomJoinCode(roomCode: string) {
  const value = roomCode.trim().toUpperCase();
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  }
  return String((hash % 900000) + 100000);
}

function errorText(error: unknown) {
  if (!error || typeof error !== "object") {
    return typeof error === "string" ? error : "";
  }
  const record = error as Record<string, unknown>;
  return ["message", "details", "hint", "code"]
    .map((key) => typeof record[key] === "string" ? record[key] : "")
    .filter(Boolean)
    .join(" ");
}

function missingColumnName(error: unknown) {
  const text = errorText(error);
  return text.match(/'([^']+)' column/i)?.[1]
    ?? text.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i)?.[1]
    ?? null;
}

async function upsertClassroomRoomRow(admin: SupabaseClient, row: Record<string, unknown>) {
  const response = await admin
    .from(CLASSROOM_ROOMS_TABLE)
    .upsert(row, { onConflict: "room_code" })
    .select("*")
    .single();

  if (!response.error) {
    return response.data;
  }

  const missingColumn = missingColumnName(response.error);
  if (!missingColumn || !OPTIONAL_CLASSROOM_ROOM_COLUMNS.has(missingColumn)) {
    throw response.error;
  }

  const retryRow = { ...row };
  delete retryRow[missingColumn];
  console.warn("[classroom-store] Retrying classroom room upsert without optional missing column.", {
    table: CLASSROOM_ROOMS_TABLE,
    missingColumn,
    message: errorText(response.error)
  });

  const retry = await admin
    .from(CLASSROOM_ROOMS_TABLE)
    .upsert(retryRow, { onConflict: "room_code" })
    .select("*")
    .single();
  if (retry.error) {
    throw retry.error;
  }
  return retry.data;
}

async function upsertParticipantRows(admin: SupabaseClient, rows: Array<Record<string, unknown>>) {
  let retryRows = rows;
  const removedColumns = new Set<string>();
  for (let attempt = 0; attempt < OPTIONAL_ROOM_PARTICIPANT_COLUMNS.size + 1; attempt += 1) {
    const { error } = await admin
      .from(ROOM_PARTICIPANTS_TABLE)
      .upsert(retryRows, { onConflict: "room_id,player_id" });
    if (!error) {
      return;
    }

    const missingColumn = missingColumnName(error);
    if (!missingColumn || !OPTIONAL_ROOM_PARTICIPANT_COLUMNS.has(missingColumn) || removedColumns.has(missingColumn)) {
      throw error;
    }

    removedColumns.add(missingColumn);
    console.warn("[classroom-store] Retrying participant upsert without optional missing column.", {
      table: ROOM_PARTICIPANTS_TABLE,
      missingColumn,
      message: errorText(error)
    });
    retryRows = retryRows.map((row) => {
      const next = { ...row };
      delete next[missingColumn];
      return next;
    });
  }
}

export function deriveClassroomStatus(room: GameRoomStateRecord): ClassroomRoomStatus {
  if (room.deletedAtMs) {
    return "DELETED";
  }
  if (room.closedAtMs) {
    return "CLOSED";
  }
  if (room.endedAtMs || room.raceStopped || room.racePhase === "finish") {
    return "FINISHED";
  }
  if (room.racePhase === "starting" || room.racePhase === "active") {
    return "RACING";
  }
  return "WAITING";
}

function progressPercent(room: GameRoomStateRecord, player: PlayerStateRecord) {
  const targetScore = Math.max(1, Math.trunc(room.targetScore ?? room.roomSettings?.targetScore ?? DEFAULT_TARGET_SCORE));
  if (room.teacherSessionId) {
    return Math.max(0, Math.min(100, (Math.max(0, player.score ?? 0) / targetScore) * 100));
  }
  const totalDistance = Math.max(1, room.trackLengthMeters * Math.max(1, room.totalLaps));
  const completed = (Math.max(0, player.lap) * room.trackLengthMeters) + Math.max(0, player.positionMeters);
  return Math.max(0, Math.min(100, (completed / totalDistance) * 100));
}

function participantStatus(room: GameRoomStateRecord, player: PlayerStateRecord) {
  if (player.finished || player.racePhase === "finish" || deriveClassroomStatus(room) === "FINISHED") {
    return "FINISHED";
  }
  if (player.connected === false || !player.session) {
    return "DISCONNECTED";
  }
  if (player.racePhase === "active" || player.racePhase === "starting") {
    return "RACING";
  }
  return "JOINED";
}

function sortedPlayersByProgress(room: GameRoomStateRecord) {
  return Object.values(room.players ?? {})
    .sort((left, right) => {
      const progressDelta = progressPercent(room, right) - progressPercent(room, left);
      return progressDelta || ((left.joinedAtMs ?? 0) - (right.joinedAtMs ?? 0)) || left.playerId.localeCompare(right.playerId);
    });
}

function mapRoomRow(row: Record<string, unknown>): ClassroomRoomSummary {
  const targetScore = Number(row.target_score ?? DEFAULT_TARGET_SCORE);
  const roomCode = String(row.room_code ?? "");
  return {
    id: String(row.id ?? ""),
    teacherId: row.teacher_id ? String(row.teacher_id) : null,
    roomCode,
    joinCode: String(row.join_code ?? "") || buildClassroomJoinCode(roomCode),
    raceName: String(row.race_name ?? "Classroom Math Race"),
    className: row.class_name ? String(row.class_name) : null,
    status: String(row.status ?? "WAITING") as ClassroomRoomStatus,
    maxPlayers: Number(row.max_players ?? 8),
    currentPlayers: Number(row.current_players ?? 0),
    raceDurationSeconds: Number(row.race_duration_sec ?? 180),
    questionTimeLimitSeconds: Number(row.question_time_limit_sec ?? 8),
    targetScore: Number.isFinite(targetScore) ? Math.max(MIN_TARGET_SCORE, Math.min(MAX_TARGET_SCORE, Math.trunc(targetScore))) : DEFAULT_TARGET_SCORE,
    difficulty: row.difficulty ? String(row.difficulty) : null,
    mapId: row.map_id ? String(row.map_id) : null,
    requiresApproval: Boolean(row.requires_approval),
    isLocked: Boolean(row.is_locked),
    isListed: Boolean(row.is_listed),
    allowMidGameJoin: Boolean(row.allow_mid_game_join),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    startedAt: row.started_at ? String(row.started_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null
  };
}

export async function findClassroomRoom(admin: SupabaseClient, roomCode: string) {
  const byRoomCode = await admin
    .from(CLASSROOM_ROOMS_TABLE)
    .select("*")
    .eq("room_code", roomCode)
    .maybeSingle();
  if (byRoomCode.error) {
    throw byRoomCode.error;
  }
  if (byRoomCode.data) {
    return mapRoomRow(byRoomCode.data as Record<string, unknown>);
  }

  const byJoinCode = await admin
    .from(CLASSROOM_ROOMS_TABLE)
    .select("*")
    .eq("join_code", roomCode)
    .maybeSingle();
  if (byJoinCode.error) {
    throw byJoinCode.error;
  }
  return byJoinCode.data ? mapRoomRow(byJoinCode.data as Record<string, unknown>) : null;
}

export async function upsertClassroomRoomFromState(admin: SupabaseClient, room: GameRoomStateRecord) {
  if (!room.teacherSessionId) {
    return null;
  }

  const settings = settingsValue(room.roomSettings, room.roomId);
  const status = deriveClassroomStatus(room);
  const terminal = status === "FINISHED" || status === "CLOSED" || status === "DELETED";
  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    teacher_id: room.teacherSessionId,
    room_code: room.roomId,
    join_code: buildClassroomJoinCode(room.roomId),
    race_name: settings.raceName,
    class_name: room.className ?? null,
    status,
    max_players: settings.maxPlayers,
    current_players: Object.keys(room.players ?? {}).length,
    race_duration_sec: settings.raceDurationSeconds,
    question_time_limit_sec: settings.questionTimeLimitSeconds,
    target_score: settings.targetScore,
    difficulty: room.difficulty ?? null,
    question_type: ["MIXED"],
    map_id: room.mapId ?? null,
    requires_approval: false,
    is_locked: terminal ? true : Boolean(room.isLocked),
    is_listed: terminal ? false : room.isListed !== false,
    allow_mid_game_join: room.allowMidGameJoin !== false,
    updated_at: nowIso,
    started_at: status === "RACING" ? (dateFromMs(room.raceStartedAtMs || room.raceStartingAtMs) ?? nowIso) : dateFromMs(room.raceStartedAtMs),
    ended_at: status === "FINISHED" ? (dateFromMs(room.endedAtMs) ?? nowIso) : dateFromMs(room.endedAtMs),
    closed_at: dateFromMs(room.closedAtMs),
    deleted_at: dateFromMs(room.deletedAtMs)
  };

  const data = await upsertClassroomRoomRow(admin, row);

  const classroomRoom = mapRoomRow(data as Record<string, unknown>);
  await syncRoomParticipantsFromState(admin, classroomRoom.id, room);
  return classroomRoom;
}

export async function syncRoomParticipantsFromState(admin: SupabaseClient, classroomRoomId: string, room: GameRoomStateRecord) {
  const players = sortedPlayersByProgress(room);
  if (players.length === 0) {
    const { error } = await admin
      .from(ROOM_PARTICIPANTS_TABLE)
      .delete()
      .eq("room_id", classroomRoomId);
    if (error) {
      throw error;
    }
    return;
  }

  const nowIso = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = players.map((player, index) => {
    const status = participantStatus(room, player);
    return {
      room_id: classroomRoomId,
      player_id: player.playerId,
      display_name: player.displayName,
      car_id: player.carId ?? null,
      car_name: player.carId ?? null,
      status,
      progress_percent: progressPercent(room, player),
      rank: index + 1,
      correct_answers: Math.max(0, player.correctAnswers ?? 0),
      wrong_answers: Math.max(0, player.wrongAnswers ?? 0),
      timeout_answers: Math.max(0, player.timeoutAnswers ?? 0),
      score: Math.trunc(player.score ?? 0),
      connection_status: player.connected === false || !player.session ? "DISCONNECTED" : "CONNECTED",
      last_seen_at: dateFromMs(player.session?.lastSeenAtMs ?? player.disconnectedAtMs) ?? nowIso,
      player_session_id: player.playerId,
      streak: Math.max(0, player.correctStreak ?? 0),
      average_answer_time_ms: (player.answerCount ?? 0) > 0
        ? Math.round(Math.max(0, player.totalAnswerTimeMs ?? 0) / Math.max(1, player.answerCount ?? 1))
        : null,
      joined_at: dateFromMs(player.joinedAtMs) ?? nowIso,
      approved_at: status === "APPROVED" ? nowIso : null,
      ready_at: null,
      finished_at: status === "FINISHED" ? nowIso : null,
      updated_at: nowIso
    };
  });

  await upsertParticipantRows(admin, rows);
}

export async function insertRoomEvent(
  admin: SupabaseClient,
  roomId: string,
  eventType: string,
  payload: Record<string, unknown> = {}
) {
  const classroomRoom = await findClassroomRoom(admin, roomId);
  if (!classroomRoom) {
    return;
  }
  const { error } = await admin.from(ROOM_EVENTS_TABLE).insert({
    room_id: classroomRoom.id,
    event_type: eventType,
    payload
  });
  if (error) {
    throw error;
  }
}

export async function markRoomParticipantKicked(admin: SupabaseClient, roomCode: string, playerId: string, now: number) {
  const classroomRoom = await findClassroomRoom(admin, roomCode);
  if (!classroomRoom) {
    return;
  }
  const nowIso = new Date(now).toISOString();
  const { error } = await admin
    .from(ROOM_PARTICIPANTS_TABLE)
    .update({
      status: "KICKED",
      kicked_at: nowIso,
      updated_at: nowIso
    })
    .eq("room_id", classroomRoom.id)
    .eq("player_id", playerId);
  if (error) {
    throw error;
  }
}

export async function listTeacherRooms(admin: SupabaseClient, teacherId: string | null) {
  let query = admin
    .from(CLASSROOM_ROOMS_TABLE)
    .select("*")
    .is("deleted_at", null)
    .neq("status", "DELETED")
    .order("created_at", { ascending: false })
    .limit(80);

  if (teacherId) {
    query = query.eq("teacher_id", teacherId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => mapRoomRow(row as Record<string, unknown>));
}

export async function listActiveClassroomRooms(admin: SupabaseClient) {
  const { data, error } = await admin
    .from(CLASSROOM_ROOMS_TABLE)
    .select("*")
    .is("deleted_at", null)
    .is("closed_at", null)
    .is("ended_at", null)
    .eq("is_listed", true)
    .eq("is_locked", false)
    .in("status", ["WAITING", "RACING"])
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    throw error;
  }
  return (data ?? [])
    .map((row) => mapRoomRow(row as Record<string, unknown>))
    .filter((room) => room.currentPlayers < room.maxPlayers)
    .filter((room) => room.status === "WAITING" || room.allowMidGameJoin);
}

export async function archiveStaleClassroomRooms(
  admin: SupabaseClient,
  teacherSessionId: string,
  thresholdHours: number,
  excludeRoomCode?: string
) {
  const safeThresholdHours = Math.max(12, Math.trunc(thresholdHours));
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - (safeThresholdHours * 60 * 60 * 1000)).toISOString();
  let query = admin
    .from(CLASSROOM_ROOMS_TABLE)
    .update({
      status: "DELETED",
      is_listed: false,
      is_locked: true,
      deleted_at: nowIso,
      updated_at: nowIso
    }, { count: "exact" })
    .eq("teacher_id", teacherSessionId)
    .in("status", ["DRAFT", "CREATED", "WAITING"])
    .eq("is_listed", true)
    .eq("is_locked", false)
    .is("started_at", null)
    .is("ended_at", null)
    .is("closed_at", null)
    .is("deleted_at", null)
    .lt("created_at", cutoffIso);

  if (excludeRoomCode) {
    query = query.neq("room_code", excludeRoomCode);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }
  return {
    archivedCount: Number(count ?? 0),
    thresholdHours: safeThresholdHours
  };
}

export async function markClassroomRoomDeleted(admin: SupabaseClient, roomCode: string, teacherSessionId: string, now: number) {
  const nowIso = new Date(now).toISOString();
  const { error } = await admin
    .from(CLASSROOM_ROOMS_TABLE)
    .update({
      status: "DELETED",
      is_listed: false,
      is_locked: true,
      deleted_at: nowIso,
      updated_at: nowIso
    })
    .eq("room_code", roomCode)
    .eq("teacher_id", teacherSessionId);
  if (error) {
    throw error;
  }
}

export async function markClassroomRoomClosed(admin: SupabaseClient, roomCode: string, teacherSessionId: string, now: number) {
  const nowIso = new Date(now).toISOString();
  const { error } = await admin
    .from(CLASSROOM_ROOMS_TABLE)
    .update({
      status: "CLOSED",
      is_listed: false,
      is_locked: true,
      closed_at: nowIso,
      updated_at: nowIso
    })
    .eq("room_code", roomCode)
    .eq("teacher_id", teacherSessionId);
  if (error) {
    throw error;
  }
}
