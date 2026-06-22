import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getStoredAuthSessionToken, type UserRole } from "./authClient";
import { getSupabaseTransportConfig } from "./transportConfig";

export interface AdminUserSummary {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AdminListUsersResponse {
  users?: Array<{
    id?: string;
    username?: string;
    role?: UserRole;
    created_at?: string;
    last_login_at?: string | null;
  }>;
  total?: number;
  limit?: number;
  offset?: number;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

let adminApiClient: SupabaseClient | null = null;

function getClient() {
  if (adminApiClient) {
    return adminApiClient;
  }
  const config = getSupabaseTransportConfig();
  if (!config) {
    throw new Error("Supabase is not configured.");
  }
  adminApiClient = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  return adminApiClient;
}

export async function listAdminUsers({ limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}) {
  const sessionToken = getStoredAuthSessionToken();
  const { data, error } = await getClient().functions.invoke("admin-list-users", {
    body: {
      sessionToken,
      limit,
      offset
    }
  });
  if (error) {
    throw new Error(error.message || "Unable to load admin users.");
  }

  const response = (data ?? {}) as AdminListUsersResponse;
  if (response.error) {
    throw new Error(response.error.message || response.error.code || "Unable to load admin users.");
  }

  return {
    users: (response.users ?? []).map((user) => ({
      id: String(user.id ?? ""),
      username: String(user.username ?? ""),
      role: user.role ?? "student",
      createdAt: String(user.created_at ?? ""),
      lastLoginAt: user.last_login_at ? String(user.last_login_at) : null
    })),
    total: Math.max(0, Math.trunc(response.total ?? response.users?.length ?? 0)),
    limit: Math.max(1, Math.trunc(response.limit ?? limit)),
    offset: Math.max(0, Math.trunc(response.offset ?? offset))
  };
}
