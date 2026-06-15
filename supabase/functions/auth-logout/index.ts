import { createAdminClient } from "../_shared/admin.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { revokeSession } from "../_shared/math-race-auth.ts";

interface LogoutRequest {
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
    const payload = await readJsonRequest<LogoutRequest>(request);
    const admin = createAdminClient();
    await revokeSession(admin, String(payload.sessionToken ?? ""));
    return jsonResponse({ error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("LOGOUT_FAILED", message) }, 400);
  }
});
