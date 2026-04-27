import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  GameRoomPresenceDelete,
  GameRoomPresenceRecord,
  GameRoomPresenceRow,
  GameRoomPresenceUpsert,
  GameRoomRow,
  GameRoomStateRecord,
  RoomMutationResult
} from "./contracts.ts";
import { buildRaceHistoryRow } from "./game-core.ts";

const ROOM_TABLE = "game_rooms";
const PRESENCE_TABLE = "game_room_presence";
const PROFILE_TABLE = "user_profiles";
const RACE_HISTORY_TABLE = "race_history";
const MAX_UPDATE_RETRIES = 8;

async function fetchRoomRow(admin: SupabaseClient, roomId: string) {
  const { data, error } = await admin
    .from(ROOM_TABLE)
    .select("room_id, version, state_json, updated_at")
    .eq("room_id", roomId)
    .maybeSingle<GameRoomRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchPresenceRows(admin: SupabaseClient, roomId: string) {
  const { data, error } = await admin
    .from(PRESENCE_TABLE)
    .select("room_id, player_id, session_id, last_seen_at, updated_at")
    .eq("room_id", roomId)
    .returns<GameRoomPresenceRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

function mapPresenceRows(rows: GameRoomPresenceRow[]) {
  const presenceByPlayerId: Record<string, GameRoomPresenceRecord> = {};
  for (const row of rows) {
    const parsedLastSeenAtMs = Number(new Date(row.last_seen_at).getTime());
    presenceByPlayerId[row.player_id] = {
      roomId: row.room_id,
      playerId: row.player_id,
      sessionId: row.session_id,
      lastSeenAtMs: Number.isFinite(parsedLastSeenAtMs) ? parsedLastSeenAtMs : 0
    };
  }
  return presenceByPlayerId;
}

async function saveInsertedRoom(admin: SupabaseClient, roomId: string, room: GameRoomStateRecord, now: number) {
  const { error } = await admin.from(ROOM_TABLE).insert({
    room_id: roomId,
    version: 1,
    state_json: room,
    updated_at: new Date(now).toISOString()
  });

  if (!error) {
    return 1;
  }

  if (error.code === "23505") {
    return null;
  }

  throw error;
}

async function saveUpdatedRoom(
  admin: SupabaseClient,
  roomId: string,
  previousVersion: number,
  room: GameRoomStateRecord,
  now: number
) {
  const nextVersion = previousVersion + 1;
  const { data, error } = await admin
    .from(ROOM_TABLE)
    .update({
      version: nextVersion,
      state_json: room,
      updated_at: new Date(now).toISOString()
    })
    .eq("room_id", roomId)
    .eq("version", previousVersion)
    .select("version");

  if (error) {
    throw error;
  }

  if (!data || data.length !== 1) {
    return null;
  }

  return nextVersion;
}

async function upsertUserProfile(admin: SupabaseClient, profile: { id: string; display_name: string }) {
  const { error } = await admin.from(PROFILE_TABLE).upsert(profile, { onConflict: "id" });
  if (error) {
    throw error;
  }
}

async function applyPresenceDeletes(admin: SupabaseClient, presenceDeletes: GameRoomPresenceDelete[]) {
  for (const entry of presenceDeletes) {
    const { error } = await admin
      .from(PRESENCE_TABLE)
      .delete()
      .eq("room_id", entry.roomId)
      .eq("player_id", entry.playerId);
    if (error) {
      throw error;
    }
  }
}

async function applyPresenceUpserts(admin: SupabaseClient, presenceUpserts: GameRoomPresenceUpsert[], now: number) {
  if (presenceUpserts.length === 0) {
    return;
  }

  const rows = presenceUpserts.map((entry) => ({
    room_id: entry.roomId,
    player_id: entry.playerId,
    session_id: entry.sessionId,
    last_seen_at: new Date(entry.lastSeenAtMs).toISOString(),
    updated_at: new Date(now).toISOString()
  }));

  const { error } = await admin.from(PRESENCE_TABLE).upsert(rows, { onConflict: "room_id,player_id" });
  if (error) {
    throw error;
  }
}

async function applyPresenceMutations(
  admin: SupabaseClient,
  presenceUpserts: GameRoomPresenceUpsert[] | undefined,
  presenceDeletes: GameRoomPresenceDelete[] | undefined,
  now: number
) {
  if (presenceDeletes && presenceDeletes.length > 0) {
    await applyPresenceDeletes(admin, presenceDeletes);
  }
  if (presenceUpserts && presenceUpserts.length > 0) {
    await applyPresenceUpserts(admin, presenceUpserts, now);
  }
}

async function markResultPersisted(
  admin: SupabaseClient,
  room: GameRoomStateRecord,
  currentVersion: number,
  now: number
) {
  room.resultPersisted = true;
  const nextVersion = currentVersion + 1;
  const { error } = await admin
    .from(ROOM_TABLE)
    .update({
      version: nextVersion,
      state_json: room,
      updated_at: new Date(now).toISOString()
    })
    .eq("room_id", room.roomId)
    .eq("version", currentVersion);

  if (error) {
    room.resultPersisted = false;
  }
}

async function persistRaceHistoryIfNeeded(
  admin: SupabaseClient,
  room: GameRoomStateRecord,
  currentVersion: number,
  now: number
) {
  if (!room.raceStopped || room.resultPersisted || !room.winnerPlayerId) {
    return;
  }

  const row = buildRaceHistoryRow(room);
  if (!row) {
    return;
  }

  const { error } = await admin.from(RACE_HISTORY_TABLE).upsert(row, { onConflict: "id" });
  if (error) {
    throw error;
  }

  await markResultPersisted(admin, structuredClone(room), currentVersion, now);
}

export async function runRoomMutation(
  admin: SupabaseClient,
  roomId: string,
  now: number,
  mutate: (
    room: GameRoomStateRecord | null,
    presenceByPlayerId: Record<string, GameRoomPresenceRecord>
  ) => RoomMutationResult
) {
  for (let attempt = 0; attempt < MAX_UPDATE_RETRIES; attempt += 1) {
    const current = await fetchRoomRow(admin, roomId);
    const presenceRows = await fetchPresenceRows(admin, roomId);
    const workingRoom = current?.state_json ? structuredClone(current.state_json) : null;
    const result = mutate(workingRoom, mapPresenceRows(presenceRows));

    if (!result.persist || !result.room) {
      await applyPresenceMutations(admin, result.presenceUpserts, result.presenceDeletes, now);
      return {
        room: result.room,
        version: current?.version ?? 0,
        response: result.response
      };
    }

    let savedVersion: number | null;
    if (!current) {
      savedVersion = await saveInsertedRoom(admin, roomId, result.room, now);
    } else {
      savedVersion = await saveUpdatedRoom(admin, roomId, current.version, result.room, now);
    }

    if (savedVersion === null) {
      continue;
    }

    if (result.profile) {
      await upsertUserProfile(admin, result.profile);
    }
    await persistRaceHistoryIfNeeded(admin, result.room, savedVersion, now);
    await applyPresenceMutations(admin, result.presenceUpserts, result.presenceDeletes, now);

    return {
      room: result.room,
      version: savedVersion,
      response: result.response
    };
  }

  throw new Error("Could not persist room state after several retries.");
}
