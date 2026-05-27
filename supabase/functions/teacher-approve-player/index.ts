import type { TeacherRemovePlayerRequest } from "../_shared/contracts.ts";
import { createAdminClient } from "../_shared/admin.ts";
import { insertRoomEvent } from "../_shared/classroom-store.ts";
import { teacherApprovePlayer } from "../_shared/game-core.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { normalizePlayerId } from "../_shared/input.ts";
import { runRoomMutation } from "../_shared/room-store.ts";
import { normalizeTeacherRoomRequest } from "../_shared/teacher-room-identity.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<TeacherRemovePlayerRequest>(request);
    const admin = createAdminClient();
    const roomPayload = await normalizeTeacherRoomRequest(admin, payload);
    const normalizedPayload: TeacherRemovePlayerRequest = {
      ...roomPayload,
      targetPlayerId: normalizePlayerId(payload.targetPlayerId, false)
    };
    const now = Date.now();
    const result = await runRoomMutation(
      admin,
      normalizedPayload.roomId,
      now,
      (room, presenceByPlayerId) => teacherApprovePlayer(room, normalizedPayload, presenceByPlayerId, now)
    );
    await insertRoomEvent(admin, normalizedPayload.roomId, "PARTICIPANT_APPROVED", {
      playerId: normalizedPayload.targetPlayerId
    });
    return jsonResponse(result.response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("TEACHER_APPROVE_FAILED", message) }, 400);
  }
});
