import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type UserRole = "teacher" | "student" | "admin";

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

const USERS_TABLE = "math_race_users";
const SESSIONS_TABLE = "math_race_user_sessions";
const PASSWORD_ITERATIONS = 210_000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

function base64FromBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function isRole(value: unknown): value is UserRole {
  return value === "teacher" || value === "student" || value === "admin";
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left[index] ^ right[index];
  }
  return result === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function sha256Base64(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64FromBytes(new Uint8Array(digest));
}

export function validateUsername(username: unknown) {
  const value = String(username ?? "").trim();
  if (!value) {
    throw new Error("Username cannot be empty.");
  }
  if (value.length > 40) {
    throw new Error("Username is too long.");
  }
  return value;
}

export function validatePassword(password: unknown) {
  const value = String(password ?? "");
  if (value.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if (value.length > 256) {
    throw new Error("Password is too long.");
  }
  return value;
}

export function validateRole(role: unknown) {
  if (!isRole(role)) {
    throw new Error("Role must be teacher, student, or admin.");
  }
  return role;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${base64FromBytes(salt)}$${base64FromBytes(hash)}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = storedHash.split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterationsRaw || !saltRaw || !hashRaw) {
    return false;
  }
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 100_000) {
    return false;
  }
  const expected = bytesFromBase64(hashRaw);
  const actual = await pbkdf2(password, bytesFromBase64(saltRaw), iterations);
  return constantTimeEqual(actual, expected);
}

export function toPublicUser(row: Record<string, unknown>): PublicUser {
  return {
    id: String(row.id ?? ""),
    username: String(row.username ?? ""),
    role: validateRole(row.role),
    createdAt: String(row.created_at ?? "")
  };
}

export async function createSession(admin: SupabaseClient, userId: string) {
  const token = base64FromBytes(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const tokenHash = await sha256Base64(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await admin.from(SESSIONS_TABLE).insert({
    user_id: userId,
    session_token_hash: tokenHash,
    expires_at: expiresAt
  });
  if (error) {
    throw error;
  }
  return token;
}

export async function findUserByUsername(admin: SupabaseClient, username: string) {
  const { data, error } = await admin
    .from(USERS_TABLE)
    .select("*")
    .eq("username_normalized", normalizeUsername(username))
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as Record<string, unknown> | null;
}

export async function insertUser(admin: SupabaseClient, username: string, passwordHash: string, role: UserRole) {
  const { data, error } = await admin
    .from(USERS_TABLE)
    .insert({
      username,
      username_normalized: normalizeUsername(username),
      password_hash: passwordHash,
      role
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Record<string, unknown>;
}

export async function markUserLoggedIn(admin: SupabaseClient, userId: string) {
  const { error } = await admin
    .from(USERS_TABLE)
    .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    throw error;
  }
}

export async function findUserBySessionToken(admin: SupabaseClient, sessionToken: string) {
  const token = String(sessionToken ?? "").trim();
  if (!token) {
    return null;
  }
  const tokenHash = await sha256Base64(token);
  const { data, error } = await admin
    .from(SESSIONS_TABLE)
    .select("id, expires_at, revoked_at, user:math_race_users(*)")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data || data.revoked_at || new Date(String(data.expires_at)).getTime() <= Date.now()) {
    return null;
  }
  const user = (data.user ?? null) as Record<string, unknown> | null;
  return user ? toPublicUser(user) : null;
}

export async function revokeSession(admin: SupabaseClient, sessionToken: string) {
  const token = String(sessionToken ?? "").trim();
  if (!token) {
    return;
  }
  const tokenHash = await sha256Base64(token);
  const { error } = await admin
    .from(SESSIONS_TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_token_hash", tokenHash)
    .is("revoked_at", null);
  if (error) {
    throw error;
  }
}
