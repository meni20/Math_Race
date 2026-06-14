import type { TeacherRoomRequest } from "../_shared/contracts.ts";
import { createAdminClient } from "../_shared/admin.ts";
import { insertRoomEvent, markClassroomRoomClosed } from "../_shared/classroom-store.ts";
import { teacherCloseRoom } from "../_shared/game-core.ts";
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

  try {
    const payload = await readJsonRequest<TeacherRoomRequest>(request);
    const now = Date.now();
    const admin = createAdminClient();
    const normalizedPayload = await normalizeTeacherRoomRequest(admin, payload);
    const result = await runRoomMutation(
      admin,
      normalizedPayload.roomId,
      now,
      (room, presenceByPlayerId) => teacherCloseRoom(room, normalizedPayload, presenceByPlayerId, now)
    );
    await markClassroomRoomClosed(admin, normalizedPayload.roomId, normalizedPayload.teacherSessionId, now);
    await insertRoomEvent(admin, normalizedPayload.roomId, "ROOM_CLOSED", {
      teacherSessionId: normalizedPayload.teacherSessionId
    });
    return jsonResponse(result.response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("TEACHER_CLOSE_FAILED", message) }, 400);
  }
});
