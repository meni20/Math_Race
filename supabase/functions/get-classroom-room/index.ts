import { createAdminClient } from "../_shared/admin.ts";
import { findClassroomRoom } from "../_shared/classroom-store.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { normalizeRoomId } from "../_shared/input.ts";

interface GetClassroomRoomRequest {
  roomCode?: string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<GetClassroomRoomRequest>(request);
    const roomCode = normalizeRoomId(payload.roomCode ?? "", false);
    const room = await findClassroomRoom(createAdminClient(), roomCode);
    return jsonResponse({ room });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("GET_CLASSROOM_ROOM_FAILED", message) }, 400);
  }
});
