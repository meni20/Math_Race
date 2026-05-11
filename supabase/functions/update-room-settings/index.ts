import type { UpdateRoomSettingsRequest } from "../_shared/contracts.ts";
import { createAdminClient } from "../_shared/admin.ts";
import { updateRoomSettings } from "../_shared/game-core.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { normalizePlayerId, normalizeRoomId } from "../_shared/input.ts";
import { runRoomMutation } from "../_shared/room-store.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<UpdateRoomSettingsRequest>(request);
    const normalizedPayload: UpdateRoomSettingsRequest = {
      roomId: normalizeRoomId(payload.roomId, false),
      playerId: normalizePlayerId(payload.playerId, false),
      sessionId: String(payload.sessionId ?? ""),
      roomSettings: payload.roomSettings ?? {
        raceName: "",
        maxPlayers: 4,
        raceDurationSeconds: 180,
        questionTimeLimitSeconds: 8
      }
    };
    const now = Date.now();
    const admin = createAdminClient();
    const result = await runRoomMutation(
      admin,
      normalizedPayload.roomId,
      now,
      (room, presenceByPlayerId) => updateRoomSettings(room, normalizedPayload, presenceByPlayerId, now)
    );
    return jsonResponse(result.response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("UPDATE_ROOM_SETTINGS_FAILED", message) }, 400);
  }
});
