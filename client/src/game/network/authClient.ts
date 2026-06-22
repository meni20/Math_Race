import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseTransportConfig } from "./transportConfig";

export type UserRole = "teacher" | "student" | "admin";

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt?: string;
}

interface StoredAuthUser extends AuthUser {
  passwordHash: string;
}

interface StoredSession {
  sessionToken?: string;
  userId?: string;
}

const AUTH_SESSION_STORAGE_KEY = "mathRace.authSession";
const AUTH_USERS_STORAGE_KEY = "mathRace.localUsers";
let authSupabaseClient: SupabaseClient | null = null;

interface AuthFunctionResponse {
  user?: AuthUser | null;
  sessionToken?: string;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

function getAuthSupabaseClient() {
  const firebaseClassroomEnabled = String(import.meta.env.VITE_CLASSROOM_FIREBASE ?? "").toLowerCase() === "true";
  const localClassroomEnabled = String(import.meta.env.VITE_CLASSROOM_LOCAL_DEV ?? "").toLowerCase() === "true";
  if (firebaseClassroomEnabled || localClassroomEnabled) {
    return null;
  }
  if (authSupabaseClient) {
    return authSupabaseClient;
  }
  const config = getSupabaseTransportConfig();
  if (!config) {
    return null;
  }
  authSupabaseClient = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  return authSupabaseClient;
}

async function invokeAuthFunction(functionName: string, body: Record<string, unknown>) {
  const client = getAuthSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) {
    throw new Error(error.message || "Auth request failed.");
  }
  const response = (data ?? {}) as AuthFunctionResponse;
  if (response.error) {
    throw new Error(response.error.message || response.error.code || "Auth request failed.");
  }
  return response;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readStoredSession(): StoredSession {
  return readJson<StoredSession>(AUTH_SESSION_STORAGE_KEY, {});
}

function writeStoredSession(userId: string, sessionToken = createId("session")) {
  writeJson(AUTH_SESSION_STORAGE_KEY, { sessionToken, userId });
}

function clearStoredSessionToken() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

function readStoredUsers() {
  return readJson<StoredAuthUser[]>(AUTH_USERS_STORAGE_KEY, []);
}

function writeStoredUsers(users: StoredAuthUser[]) {
  writeJson(AUTH_USERS_STORAGE_KEY, users);
}

function createId(prefix: string) {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${randomId}`;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function toPublicUser(user: StoredAuthUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt
  };
}

async function hashPassword(username: string, password: string) {
  const value = `${normalizeUsername(username)}:${password}`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return btoa(unescape(encodeURIComponent(value)));
}

function validateRole(role: UserRole) {
  return role === "student" || role === "teacher" || role === "admin";
}

export function getStoredAuthSessionToken() {
  return readStoredSession().sessionToken?.trim() ?? "";
}

export async function createUser(username: string, password: string, role: UserRole) {
  if (getAuthSupabaseClient()) {
    const response = await invokeAuthFunction("auth-create-user", { username, password, role });
    if (!response.user || !response.sessionToken) {
      throw new Error("Could not create user session.");
    }
    writeStoredSession(response.user.id, response.sessionToken);
    return response.user;
  }

  const cleanUsername = username.trim();
  if (!cleanUsername) {
    throw new Error("Username cannot be empty.");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if (!validateRole(role)) {
    throw new Error("Choose a valid role.");
  }

  const users = readStoredUsers();
  const normalizedUsername = normalizeUsername(cleanUsername);
  if (users.some((user) => normalizeUsername(user.username) === normalizedUsername)) {
    throw new Error("This username already exists on this device.");
  }

  const nextUser: StoredAuthUser = {
    id: createId("user"),
    username: cleanUsername,
    role,
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(cleanUsername, password)
  };
  writeStoredUsers([...users, nextUser]);
  writeStoredSession(nextUser.id);
  return toPublicUser(nextUser);
}

export async function loginUser(username: string, password: string) {
  if (getAuthSupabaseClient()) {
    const response = await invokeAuthFunction("auth-login", { username, password });
    if (!response.user || !response.sessionToken) {
      throw new Error("Could not create user session.");
    }
    writeStoredSession(response.user.id, response.sessionToken);
    return response.user;
  }

  const cleanUsername = username.trim();
  const passwordHash = await hashPassword(cleanUsername, password);
  const user = readStoredUsers().find((storedUser) => (
    normalizeUsername(storedUser.username) === normalizeUsername(cleanUsername)
    && storedUser.passwordHash === passwordHash
  ));
  if (!user) {
    throw new Error("Username or password is incorrect on this device.");
  }
  writeStoredSession(user.id);
  return toPublicUser(user);
}

export async function changeUserPassword(currentPassword: string, nextPassword: string) {
  if (getAuthSupabaseClient()) {
    throw new Error("Password change is not connected to Supabase yet.");
  }

  const { userId } = readStoredSession();
  if (!userId) {
    throw new Error("You must be signed in to change your password.");
  }
  if (nextPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const users = readStoredUsers();
  const userIndex = users.findIndex((storedUser) => storedUser.id === userId);
  if (userIndex < 0) {
    clearStoredSessionToken();
    throw new Error("Current user was not found on this device.");
  }

  const user = users[userIndex];
  const currentPasswordHash = await hashPassword(user.username, currentPassword);
  if (user.passwordHash !== currentPasswordHash) {
    throw new Error("Current password is incorrect.");
  }

  const nextUsers = [...users];
  nextUsers[userIndex] = {
    ...user,
    passwordHash: await hashPassword(user.username, nextPassword)
  };
  writeStoredUsers(nextUsers);
  return toPublicUser(nextUsers[userIndex]);
}

export async function getCurrentUser() {
  const { userId, sessionToken } = readStoredSession();
  if (getAuthSupabaseClient()) {
    if (!sessionToken) {
      return null;
    }
    try {
      const response = await invokeAuthFunction("auth-current-user", { sessionToken });
      if (!response.user) {
        clearStoredSessionToken();
        return null;
      }
      return response.user;
    } catch {
      clearStoredSessionToken();
      return null;
    }
  }

  if (!userId) {
    return null;
  }
  const user = readStoredUsers().find((storedUser) => storedUser.id === userId);
  if (!user) {
    clearStoredSessionToken();
    return null;
  }
  return toPublicUser(user);
}

export async function logoutUser() {
  const { sessionToken } = readStoredSession();
  if (getAuthSupabaseClient() && sessionToken) {
    await invokeAuthFunction("auth-logout", { sessionToken }).catch(() => undefined);
  }
  clearStoredSessionToken();
}
