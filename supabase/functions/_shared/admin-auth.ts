import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { findUserBySessionToken, type PublicUser } from "./math-race-auth.ts";

export class AdminAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export async function requireAdminUser(admin: SupabaseClient, sessionToken: unknown): Promise<PublicUser> {
  const token = String(sessionToken ?? "").trim();
  if (!token) {
    throw new AdminAuthError("Admin session token is required.", 401);
  }

  const user = await findUserBySessionToken(admin, token);
  if (!user) {
    throw new AdminAuthError("No active user session.", 401);
  }
  if (user.role !== "admin") {
    throw new AdminAuthError("Admin role is required.", 403);
  }

  return user;
}
