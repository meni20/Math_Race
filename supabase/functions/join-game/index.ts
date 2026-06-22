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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  let normalizedPayload: JoinGameRequest | null = null;
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
    normalizedPayload.roomId = classroomRoom.roomCode;
    const result = await runRoomMutation(
      admin,
      normalizedPayload.roomId,
      now,
      (room, presenceByPlayerId) => joinRoom(room, normalizedPayload, presenceByPlayerId, now)
    );
    return jsonResponse(result.response);
  } catch (error) {
    const message = safeErrorMessage(error, "Join failed with a non-Error exception.");
    logEdgeError("join-game", error, {
      roomId: normalizedPayload?.roomId,
      playerId: normalizedPayload?.playerId
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
