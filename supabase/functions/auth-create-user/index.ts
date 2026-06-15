import { createAdminClient } from "../_shared/admin.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { createSession, findUserByUsername, hashPassword, insertUser, markUserLoggedIn, toPublicUser, validatePassword, validateRole, validateUsername } from "../_shared/math-race-auth.ts";

interface CreateUserRequest {
  username?: string;
  password?: string;
  role?: string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<CreateUserRequest>(request);
    const username = validateUsername(payload.username);
    const password = validatePassword(payload.password);
    const role = validateRole(payload.role);
    const admin = createAdminClient();
    const existing = await findUserByUsername(admin, username);
    if (existing) {
      return jsonResponse({ error: buildError("USERNAME_EXISTS", "Username already exists.") }, 409);
    }
    const userRow = await insertUser(admin, username, await hashPassword(password), role);
    const user = toPublicUser(userRow);
    const sessionToken = await createSession(admin, user.id);
    await markUserLoggedIn(admin, user.id);
    return jsonResponse({ user, sessionToken, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: buildError("CREATE_USER_FAILED", message) }, 400);
  }
});
