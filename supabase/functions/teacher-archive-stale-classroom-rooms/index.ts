import { createAdminClient } from "../_shared/admin.ts";
import { archiveStaleClassroomRooms } from "../_shared/classroom-store.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { normalizeRoomId } from "../_shared/input.ts";

interface ArchiveStaleRoomsRequest {
  teacherSessionId?: string;
  thresholdHours?: number;
  excludeRoomCode?: string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<ArchiveStaleRoomsRequest>(request);
    const teacherSessionId = String(payload.teacherSessionId ?? "").trim();
    if (!teacherSessionId) {
      return jsonResponse({ error: buildError("MISSING_TEACHER_SESSION", "teacherSessionId is required.") }, 400);
    }

    const thresholdHours = Math.max(12, Math.trunc(Number(payload.thresholdHours ?? 24)));
    const excludeRoomCode = String(payload.excludeRoomCode ?? "").trim();
    const normalizedExcludeRoomCode = excludeRoomCode
      ? normalizeRoomId(excludeRoomCode, false)
      : undefined;

    const result = await archiveStaleClassroomRooms(
      createAdminClient(),
      teacherSessionId,
      thresholdHours,
      normalizedExcludeRoomCode
    );
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("ARCHIVE_STALE_ROOMS_FAILED", message) }, 400);
  }
});
