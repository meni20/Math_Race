import { createAdminClient } from "../_shared/admin.ts";
import { listActiveClassroomRooms } from "../_shared/classroom-store.ts";
import { buildError, corsHeaders, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const rooms = await listActiveClassroomRooms(createAdminClient());
    return jsonResponse({ rooms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("LIST_ACTIVE_ROOMS_FAILED", message) }, 400);
  }
});
