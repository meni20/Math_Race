import { createAdminClient } from "../_shared/admin.ts";
import { listTeacherRooms } from "../_shared/classroom-store.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";

interface ListTeacherRoomsRequest {
  teacherSessionId?: string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<ListTeacherRoomsRequest>(request);
    const teacherSessionId = typeof payload.teacherSessionId === "string" && payload.teacherSessionId.trim()
      ? payload.teacherSessionId.trim()
      : null;
    const rooms = await listTeacherRooms(createAdminClient(), teacherSessionId);
    return jsonResponse({ rooms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("LIST_TEACHER_ROOMS_FAILED", message) }, 400);
  }
});
