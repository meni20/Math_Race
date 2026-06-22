import { createAdminClient } from "../_shared/admin.ts";
import { AdminAuthError, requireAdminUser } from "../_shared/admin-auth.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";

interface AdminListUsersRequest {
  sessionToken?: string;
  limit?: number;
  offset?: number;
}

function normalizeLimit(value: unknown) {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function normalizeOffset(value: unknown) {
  const offset = Number(value ?? 0);
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.trunc(offset));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<AdminListUsersRequest>(request);
    const admin = createAdminClient();
    await requireAdminUser(admin, payload.sessionToken);

    const limit = normalizeLimit(payload.limit);
    const offset = normalizeOffset(payload.offset);
    const { data, error, count } = await admin
      .from("math_race_users")
      .select("id, username, role, created_at, last_login_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return jsonResponse({
      users: data ?? [],
      total: count ?? 0,
      limit,
      offset,
      error: null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = error instanceof AdminAuthError ? error.status : 400;
    return jsonResponse({ error: buildError("ADMIN_LIST_USERS_FAILED", message) }, status);
  }
});
