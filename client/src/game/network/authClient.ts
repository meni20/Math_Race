import { getSupabaseTransportConfig } from "./transportConfig";

export type UserRole = "teacher" | "student" | "admin";

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt?: string;
}

interface AuthResponse {
  user?: AuthUser | null;
  sessionToken?: string;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

const AUTH_SESSION_STORAGE_KEY = "mathRace.authSession";

function readStoredSessionToken() {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY) ?? "{}") as { sessionToken?: string };
    return parsed.sessionToken?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeStoredSessionToken(sessionToken: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ sessionToken }));
}

function clearStoredSessionToken() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

async function invokeAuth(functionName: string, body: Record<string, unknown>): Promise<AuthResponse> {
  const config = getSupabaseTransportConfig();
  if (!config) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  let response: Response;
  try {
    response = await fetch(`${config.url}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("Cannot connect to server. Make sure the Supabase Functions are deployed and reachable.");
  }
  const data = await response.json().catch(() => ({})) as AuthResponse;
  if (!response.ok || data.error) {
    if (response.status === 404) {
      throw new Error(`Auth endpoint not found: ${functionName}. Deploy the Supabase function first.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(data.error?.message || "Authentication request is not authorized.");
    }
    throw new Error(data.error?.message || `Auth request failed: ${functionName}.`);
  }
  return data;
}

export function getStoredAuthSessionToken() {
  return readStoredSessionToken();
}

export async function createUser(username: string, password: string, role: UserRole) {
  const data = await invokeAuth("auth-create-user", { username, password, role });
  if (data.sessionToken) {
    writeStoredSessionToken(data.sessionToken);
  }
  return data.user ?? null;
}

export async function loginUser(username: string, password: string) {
  const data = await invokeAuth("auth-login", { username, password });
  if (data.sessionToken) {
    writeStoredSessionToken(data.sessionToken);
  }
  return data.user ?? null;
}

export async function getCurrentUser() {
  const sessionToken = readStoredSessionToken();
  if (!sessionToken) {
    return null;
  }
  try {
    const data = await invokeAuth("auth-current-user", { sessionToken });
    return data.user ?? null;
  } catch {
    clearStoredSessionToken();
    return null;
  }
}

export async function logoutUser() {
  const sessionToken = readStoredSessionToken();
  clearStoredSessionToken();
  if (!sessionToken) {
    return;
  }
  await invokeAuth("auth-logout", { sessionToken }).catch(() => undefined);
}
