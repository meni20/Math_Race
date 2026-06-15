import { createAdminClient } from "../_shared/admin.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { findUserBySessionToken } from "../_shared/math-race-auth.ts";

interface CurrentUserRequest {
  sessionToken?: string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<CurrentUserRequest>(request);
    const admin = createAdminClient();
    const user = await findUserBySessionToken(admin, String(payload.sessionToken ?? ""));
    if (!user) {
      return jsonResponse({ error: buildError("NOT_AUTHENTICATED", "No active user session.") }, 401);
    }
    return jsonResponse({ user, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("CURRENT_USER_FAILED", message) }, 400);
  }
});
