import { gameSocket } from "./gameSocket";
import { getOrCreateSupabaseSessionId, getStudentSyncDelayMs } from "./supabaseGame";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  } satisfies Storage;
}

export function runClassroomConnectionTests() {
  const sharedLocalStorage = memoryStorage();
  const firstTabStorage = memoryStorage();
  const secondTabStorage = memoryStorage();
  const storedSessionKey = "asphalt8.websocket.session";
  sharedLocalStorage.setItem(storedSessionKey, JSON.stringify({ roomId: "ROOM-1", playerId: "shared-player", displayName: "Shared" }));
  firstTabStorage.setItem(storedSessionKey, JSON.stringify({ roomId: "ROOM-1", playerId: "first-player", displayName: "First" }));

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: sharedLocalStorage, sessionStorage: firstTabStorage }
  });

  assert(gameSocket.getPersistedWebsocketSession()?.playerId === "first-player", "Game identity is read from per-tab sessionStorage.");
  const firstSession = getOrCreateSupabaseSessionId({ roomId: "ROOM-1", playerId: "first-player" });
  assert(getOrCreateSupabaseSessionId({ roomId: "ROOM-1", playerId: "first-player" }) === firstSession, "Supabase session identity survives a refresh in the same tab.");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: sharedLocalStorage, sessionStorage: secondTabStorage }
  });
  assert(gameSocket.getPersistedWebsocketSession() === null, "A second tab does not inherit another student's game identity from localStorage.");
  const secondSession = getOrCreateSupabaseSessionId({ roomId: "ROOM-1", playerId: "second-player" });
  assert(secondSession !== firstSession, "Separate tabs receive separate Supabase sessions.");

  assert(getStudentSyncDelayMs({
    realtimeHealthy: true,
    lastRealtimeEventAtMs: 1000,
    nowMs: 2000,
    fallbackIntervalMs: 30000
  }) === 10000, "Healthy Realtime never suppresses the presence heartbeat beyond ten seconds.");
  assert(getStudentSyncDelayMs({
    realtimeHealthy: false,
    lastRealtimeEventAtMs: 0,
    nowMs: 2000,
    fallbackIntervalMs: 15000
  }) === 15000, "Polling keeps its normal fallback interval while Realtime is unavailable.");

  Reflect.deleteProperty(globalThis, "window");
}

runClassroomConnectionTests();
