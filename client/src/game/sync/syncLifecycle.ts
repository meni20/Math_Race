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
  | "list-teacher-rooms"
  | "list-active-classroom-rooms";

interface NetworkRequestEntry {
  name: NetworkRequestName;
  atMs: number;
  role: SyncRole;
  manual?: boolean;
}

let nextLifecycleId = 1;
const activeEntries = new Map<string, SyncLifecycleEntry>();
const stoppedEntries: SyncLifecycleEntry[] = [];
const networkRequests: NetworkRequestEntry[] = [];
const activeClassroomListState = {
  panelOpen: false,
  inClassroomRoom: false,
  visible: typeof document === "undefined" ? true : document.visibilityState === "visible",
  pollingActive: false,
  inFlight: false,
  lastRefreshAtMs: 0,
  nextRefreshAtMs: 0,
  activePollingTimers: 0
};
const studentRealtimeState = {
  connected: false,
  healthy: false,
  status: "idle",
  lastEventAtMs: 0,
  staleAtMs: 0,
  syncFallbackActive: false
};

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

export function recordNetworkRequest(name: NetworkRequestName, role: SyncRole, options: { manual?: boolean } = {}) {
  networkRequests.push({ name, role, atMs: Date.now(), manual: options.manual });
  const cutoff = Date.now() - 120000;
  while (networkRequests.length > 0 && networkRequests[0].atMs < cutoff) {
    networkRequests.shift();
  }
}

export function countNetworkRequests(name: NetworkRequestName, windowMs = 60000, predicate?: (request: NetworkRequestEntry) => boolean) {
  const cutoff = Date.now() - windowMs;
  return networkRequests.filter((request) => request.name === name && request.atMs >= cutoff && (!predicate || predicate(request))).length;
}

export function updateActiveClassroomListDebugState(update: Partial<typeof activeClassroomListState>) {
  Object.assign(activeClassroomListState, update);
}

export function updateStudentRealtimeDebugState(update: Partial<typeof studentRealtimeState>) {
  Object.assign(studentRealtimeState, update);
}

export function recordActiveClassroomListRequest(options: { panelOpen: boolean; inClassroomRoom?: boolean; manual?: boolean }) {
  recordNetworkRequest("list-active-classroom-rooms", "student", { manual: options.manual });
  if (!isDev()) {
    return;
  }
  if (!options.panelOpen) {
    console.warn("[classroom-list] list-active-classroom-rooms ran while Join Room panel was closed");
  }
  const automaticCount = countNetworkRequests("list-active-classroom-rooms", 60000, (request) => !request.manual);
  if (automaticCount > 3) {
    console.warn("[classroom-list] list-active-classroom-rooms ran more than 3 times in 60 seconds without manual refresh", {
      automaticCount,
      state: { ...activeClassroomListState }
    });
  }
  if (options.inClassroomRoom) {
    console.warn("[classroom-list] list-active-classroom-rooms ran while the student was already in a classroom room", {
      state: { ...activeClassroomListState }
    });
  }
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
      listTeacherRooms: countNetworkRequests("list-teacher-rooms"),
      listActiveClassroomRooms: countNetworkRequests("list-active-classroom-rooms")
    },
    activeClassroomList: { ...activeClassroomListState },
    studentRealtime: { ...studentRealtimeState },
    activePollingTimersCount: activeEntries.size + activeClassroomListState.activePollingTimers
  };
}
