import type { JoinGameRequest } from "../_shared/contracts.ts";
import { createAdminClient } from "../_shared/admin.ts";
import { findClassroomRoom } from "../_shared/classroom-store.ts";
import { buildDiagnosticError, logEdgeError, safeErrorMessage } from "../_shared/edge-error.ts";
import { joinRoom } from "../_shared/game-core.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { normalizePlayerId } from "../_shared/input.ts";
import { runRoomMutation } from "../_shared/room-store.ts";
import { normalizeClassroomRoomCode } from "../_shared/teacher-room-identity.ts";

type JoinPayload = JoinGameRequest & { roomCode?: string };

async function playerExistsInRoom(admin: ReturnType<typeof createAdminClient>, roomId: string, playerId: string) {
  const { data, error } = await admin
    .from("game_rooms")
    .select("state_json")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  const state = data?.state_json as { players?: Record<string, unknown> } | null | undefined;
  return Boolean(state?.players?.[playerId]);
}

async function cleanupFailedNewJoin(admin: ReturnType<typeof createAdminClient>, roomId: string, playerId: string) {
  const { data, error } = await admin
    .from("game_rooms")
    .select("version,state_json")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error || !data?.state_json) {
    if (error) {
      console.warn("[join-game] cleanup fetch failed", error);
    }
    return;
  }
  const state = structuredClone(data.state_json) as { players?: Record<string, unknown> };
  if (!state.players?.[playerId]) {
    return;
  }
  delete state.players[playerId];
  const currentVersion = Number(data.version ?? 0);
  const { error: updateError } = await admin
    .from("game_rooms")
    .update({
      version: currentVersion + 1,
      state_json: state,
      updated_at: new Date().toISOString()
    })
    .eq("room_id", roomId)
    .eq("version", currentVersion);
  if (updateError) {
    console.warn("[join-game] cleanup room update failed", updateError);
  }
  await admin
    .from("game_room_presence")
    .delete()
    .eq("room_id", roomId)
    .eq("player_id", playerId);

  const classroomRoom = await findClassroomRoom(admin, roomId).catch(() => null);
  if (classroomRoom?.id) {
    await admin
      .from("room_participants")
      .delete()
      .eq("room_id", classroomRoom.id)
      .eq("player_id", playerId);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  let normalizedPayload: JoinGameRequest | null = null;
  let createdNewPlayer = false;
  let mutationStarted = false;
  const admin = createAdminClient();
  try {
    const payload = await readJsonRequest<JoinPayload>(request);
    normalizedPayload = {
      roomId: normalizeClassroomRoomCode(payload),
      playerId: normalizePlayerId(payload.playerId, false),
      displayName: payload.displayName,
      sessionId: String(payload.sessionId ?? ""),
      carId: String(payload.carId ?? "")
    };
    const now = Date.now();
    const classroomRoom = await findClassroomRoom(admin, normalizedPayload.roomId);
    if (!classroomRoom) {
      return jsonResponse({
        error: buildError("ROOM_NOT_FOUND", "Classroom room not found. Check the room code and try again.", normalizedPayload.roomId, normalizedPayload.playerId)
      });
    }
    if (classroomRoom.status === "DELETED" || classroomRoom.deletedAt) {
      return jsonResponse({ error: buildError("ROOM_DELETED", "This room is no longer available.", normalizedPayload.roomId, normalizedPayload.playerId) });
    }
    if (classroomRoom.status === "CLOSED" || classroomRoom.closedAt) {
      return jsonResponse({ error: buildError("ROOM_CLOSED", "This room was closed by the teacher.", normalizedPayload.roomId, normalizedPayload.playerId) });
    }
    if (classroomRoom.status === "FINISHED" || classroomRoom.endedAt) {
      return jsonResponse({ error: buildError("ROOM_FINISHED", "This race has finished.", normalizedPayload.roomId, normalizedPayload.playerId) });
    }
    if (classroomRoom.isLocked) {
      return jsonResponse({ error: buildError("ROOM_LOCKED", "Registration is locked for this room.", normalizedPayload.roomId, normalizedPayload.playerId) });
    }
    if (!classroomRoom.isListed) {
      return jsonResponse({ error: buildError("ROOM_UNLISTED", "This classroom room is not available for student joins.", normalizedPayload.roomId, normalizedPayload.playerId) });
    }
    if (classroomRoom.status !== "WAITING" && !(classroomRoom.status === "RACING" && classroomRoom.allowMidGameJoin)) {
      return jsonResponse({ error: buildError("ROOM_NOT_JOINABLE", "This classroom room is not joinable right now.", normalizedPayload.roomId, normalizedPayload.playerId) });
    }
    createdNewPlayer = !(await playerExistsInRoom(admin, normalizedPayload.roomId, normalizedPayload.playerId));
    mutationStarted = true;
    const result = await runRoomMutation(
      admin,
      normalizedPayload.roomId,
      now,
      (room, presenceByPlayerId) => joinRoom(room, normalizedPayload, presenceByPlayerId, now)
    );
    return jsonResponse(result.response);
  } catch (error) {
    if (mutationStarted && createdNewPlayer && normalizedPayload) {
      try {
        await cleanupFailedNewJoin(admin, normalizedPayload.roomId, normalizedPayload.playerId);
      } catch (cleanupError) {
        console.warn("[join-game] cleanup failed", cleanupError);
      }
    }
    const message = safeErrorMessage(error, "Join failed with a non-Error exception.");
    logEdgeError("join-game", error, {
      roomId: normalizedPayload?.roomId,
      playerId: normalizedPayload?.playerId,
      cleanedUpNewPlayer: mutationStarted && createdNewPlayer
    });
    return jsonResponse({
      error: buildDiagnosticError(
        buildError("JOIN_FAILED", message, normalizedPayload?.roomId, normalizedPayload?.playerId),
        "join-game",
        error
      )
    }, 400);
  }
});
