import { createAdminClient } from "../_shared/admin.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { createSession, findUserByUsername, markUserLoggedIn, toPublicUser, validatePassword, validateUsername, verifyPassword } from "../_shared/math-race-auth.ts";

interface LoginRequest {
  username?: string;
  password?: string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<LoginRequest>(request);
    const username = validateUsername(payload.username);
    const password = validatePassword(payload.password);
    const admin = createAdminClient();
    const userRow = await findUserByUsername(admin, username);
    const valid = userRow ? await verifyPassword(password, String(userRow.password_hash ?? "")) : false;
    if (!userRow || !valid) {
      return jsonResponse({ error: buildError("INVALID_CREDENTIALS", "Invalid username or password.") }, 401);
    }
    const user = toPublicUser(userRow);
    const sessionToken = await createSession(admin, user.id);
    await markUserLoggedIn(admin, user.id);
    return jsonResponse({ user, sessionToken, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("LOGIN_FAILED", message) }, 400);
  }
});
