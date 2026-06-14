import type { TeacherRoomRequest } from "../_shared/contracts.ts";
import { createAdminClient } from "../_shared/admin.ts";
import { buildDiagnosticError, logEdgeError, safeErrorMessage } from "../_shared/edge-error.ts";
import { teacherSyncRoom } from "../_shared/game-core.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { runRoomMutation } from "../_shared/room-store.ts";
import { normalizeTeacherRoomRequest } from "../_shared/teacher-room-identity.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  let normalizedPayload: TeacherRoomRequest | null = null;
  try {
    const payload = await readJsonRequest<TeacherRoomRequest>(request);
    const now = Date.now();
    const admin = createAdminClient();
    normalizedPayload = await normalizeTeacherRoomRequest(admin, payload);
    const result = await runRoomMutation(
      admin,
      normalizedPayload.roomId,
      now,
      (room, presenceByPlayerId) => teacherSyncRoom(room, normalizedPayload, presenceByPlayerId, now)
    );
    return jsonResponse(result.response);
  } catch (error) {
    const message = safeErrorMessage(error, "Teacher sync failed with a non-Error exception.");
    logEdgeError("teacher-sync-room", error, {
      roomId: normalizedPayload?.roomId,
      roomCode: normalizedPayload?.roomCode
    });
    return jsonResponse({
      error: buildDiagnosticError(
        buildError("TEACHER_SYNC_FAILED", message, normalizedPayload?.roomId),
        "teacher-sync-room",
        error
      )
    }, 400);
  }
});
