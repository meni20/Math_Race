export type SyncRole = "student" | "teacher";
export type SyncMode = "classroom" | "solo";
export type SyncAdapter = "supabase" | "local-dev" | "websocket" | "demo";

export interface SyncLifecycleEntry {
  id: number;
  key: string;
  role: SyncRole;
  mode: SyncMode;
  adapter: SyncAdapter;
  roomId?: string;
  roomCode?: string;
  active: boolean;
  startedAtMs: number;
  stoppedAtMs?: number;
  lastSyncAtMs?: number;
  nextSyncAtMs?: number;
  lastStatus?: string;
  intervalMs?: number;
  stopReason?: string;
}

export type NetworkRequestName =
  | "sync-room"
  | "teacher-sync-room"
  | "teacher-sync-room-blocked"
  | "teacher-room-events"
  | "list-teacher-rooms";

interface NetworkRequestEntry {
  name: NetworkRequestName;
  atMs: number;
  role: SyncRole;
}

let nextLifecycleId = 1;
const activeEntries = new Map<string, SyncLifecycleEntry>();
const stoppedEntries: SyncLifecycleEntry[] = [];
const networkRequests: NetworkRequestEntry[] = [];

function isDev() {
  return Boolean(import.meta.env.DEV);
}

function logLifecycle(message: string, entry: SyncLifecycleEntry, extra?: Record<string, unknown>) {
  if (!isDev()) {
    return;
  }
  console.info(`[sync] ${message}`, {
    id: entry.id,
    key: entry.key,
    role: entry.role,
    mode: entry.mode,
    adapter: entry.adapter,
    roomId: entry.roomId,
    roomCode: entry.roomCode,
    intervalMs: entry.intervalMs,
    ...extra
  });
}

export function startSyncLifecycle(entry: Omit<SyncLifecycleEntry, "id" | "active" | "startedAtMs">) {
  const existing = activeEntries.get(entry.key);
  if (existing && isDev()) {
    console.warn("[sync] duplicate sync lifecycle for room", {
      key: entry.key,
      existing,
      next: entry
    });
  }

  const next: SyncLifecycleEntry = {
    ...entry,
    id: nextLifecycleId,
    active: true,
    startedAtMs: Date.now()
  };
  nextLifecycleId += 1;
  activeEntries.set(next.key, next);
  logLifecycle("started", next);
  return next.id;
}

export function updateSyncLifecycle(id: number, update: Partial<Pick<SyncLifecycleEntry, "intervalMs" | "lastStatus" | "lastSyncAtMs" | "nextSyncAtMs">>) {
  for (const [key, entry] of activeEntries) {
    if (entry.id !== id) {
      continue;
    }
    activeEntries.set(key, { ...entry, ...update });
    return;
  }
}

export function recordNetworkRequest(name: NetworkRequestName, role: SyncRole) {
  networkRequests.push({ name, role, atMs: Date.now() });
  const cutoff = Date.now() - 120000;
  while (networkRequests.length > 0 && networkRequests[0].atMs < cutoff) {
    networkRequests.shift();
  }
}

export function countNetworkRequests(name: NetworkRequestName, windowMs = 60000) {
  const cutoff = Date.now() - windowMs;
  return networkRequests.filter((request) => request.name === name && request.atMs >= cutoff).length;
}

export function stopSyncLifecycle(id: number | null | undefined, reason: string) {
  if (!id) {
    return;
  }
  for (const [key, entry] of activeEntries) {
    if (entry.id !== id) {
      continue;
    }
    const stopped: SyncLifecycleEntry = {
      ...entry,
      active: false,
      stoppedAtMs: Date.now(),
      stopReason: reason
    };
    activeEntries.delete(key);
    stoppedEntries.unshift(stopped);
    stoppedEntries.splice(12);
    logLifecycle("stopped", stopped, { reason });
    return;
  }
}

export function getActiveSyncDebugState() {
  return {
    active: Array.from(activeEntries.values()),
    recentStops: stoppedEntries.slice(0, 6),
    activeTimerCount: activeEntries.size,
    requestCountsLast60s: {
      syncRoom: countNetworkRequests("sync-room"),
      teacherSyncRoom: countNetworkRequests("teacher-sync-room"),
      teacherSyncRoomBlocked: countNetworkRequests("teacher-sync-room-blocked"),
      teacherRoomEvents: countNetworkRequests("teacher-room-events"),
      listTeacherRooms: countNetworkRequests("list-teacher-rooms")
    }
  };
}
