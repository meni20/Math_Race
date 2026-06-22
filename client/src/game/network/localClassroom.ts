import type { GameStateUpdateMessage, PlayerSnapshot, RacePhase, RoomSettings } from "../types/messages";
import { normalizeCarId } from "../utils/carSelection";
import { normalizeRoomSettings } from "../utils/roomSettings";
import {
  isFirebaseClassroomEnabled,
  subscribeFirebaseClassroomRoom,
  writeFirebaseClassroomRoom
} from "./firebaseClassroom";

export interface LocalClassroomRoom {
  roomId: string;
  joinCode?: string;
  teacherSessionId?: string;
  devSessionId?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  startedAtMs?: number;
  endedAtMs?: number;
  closedAtMs?: number;
  deletedAtMs?: number;
  isLocked?: boolean;
  isListed?: boolean;
  allowMidGameJoin?: boolean;
  requiresApproval?: boolean;
  roomSettings: RoomSettings;
  trackLengthMeters: number;
  totalLaps: number;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceStopped: boolean;
  raceStoppedAtMs: number;
  winnerPlayerId: string | null;
  tick: number;
  players: Record<string, PlayerSnapshot>;
  removedPlayerIds: Record<string, number>;
}

export const LOCAL_CLASSROOM_ROOM_PREFIX = "math-race.classroom.";
export const LOCAL_CLASSROOM_EVENT = "math-race-classroom-updated";

function keyForRoom(roomId: string) {
  return `${LOCAL_CLASSROOM_ROOM_PREFIX}${roomId}`;
}

function notify(roomId: string) {
  window.dispatchEvent(new CustomEvent(LOCAL_CLASSROOM_EVENT, { detail: { roomId } }));
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(LOCAL_CLASSROOM_EVENT);
    channel.postMessage({ roomId });
    channel.close();
  }
}

export function readLocalClassroomRoom(roomId: string): LocalClassroomRoom | null {
  if (typeof window === "undefined" || !roomId) {
    return null;
  }
  const raw = window.localStorage.getItem(keyForRoom(roomId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as LocalClassroomRoom;
  } catch {
    return null;
  }
}

export function listLocalClassroomRooms() {
  if (typeof window === "undefined") {
    return [] as LocalClassroomRoom[];
  }
  const rooms: LocalClassroomRoom[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(LOCAL_CLASSROOM_ROOM_PREFIX)) {
      continue;
    }
    const room = readLocalClassroomRoom(key.slice(LOCAL_CLASSROOM_ROOM_PREFIX.length));
    if (room) {
      rooms.push(room);
    }
  }
  return rooms.sort((left, right) => left.roomId.localeCompare(right.roomId));
}

interface LocalClassroomWriteOptions {
  syncRemote?: boolean;
}

interface LocalClassroomUpdateOptions extends LocalClassroomWriteOptions {
  persist?: boolean;
}

let localClassroomWriteWindowStartedAtMs = 0;
let localClassroomWriteCount = 0;
let firebaseClassroomWriteCount = 0;

function recordLocalClassroomWrite(nowMs: number, syncRemote: boolean) {
  if (!import.meta.env.DEV) {
    return;
  }
  if (localClassroomWriteWindowStartedAtMs <= 0) {
    localClassroomWriteWindowStartedAtMs = nowMs;
  }
  localClassroomWriteCount += 1;
  if (syncRemote) {
    firebaseClassroomWriteCount += 1;
  }
  if (nowMs - localClassroomWriteWindowStartedAtMs < 5000) {
    return;
  }

  const seconds = (nowMs - localClassroomWriteWindowStartedAtMs) / 1000;
  console.debug("[local-classroom] writes/sec", {
    local: (localClassroomWriteCount / seconds).toFixed(1),
    firebase: (firebaseClassroomWriteCount / seconds).toFixed(1)
  });
  localClassroomWriteWindowStartedAtMs = nowMs;
  localClassroomWriteCount = 0;
  firebaseClassroomWriteCount = 0;
}

export function writeLocalClassroomRoom(room: LocalClassroomRoom, options: LocalClassroomWriteOptions = {}) {
  const shouldSyncRemote = options.syncRemote !== false && isFirebaseClassroomEnabled();
  window.localStorage.setItem(keyForRoom(room.roomId), JSON.stringify(room));
  notify(room.roomId);
  recordLocalClassroomWrite(Date.now(), shouldSyncRemote);
  if (shouldSyncRemote) {
    void writeFirebaseClassroomRoom(room).catch((error) => {
      if (import.meta.env.DEV) {
        console.warn("[firebase-classroom] write failed", error);
      }
    });
  }
}

export function createLocalClassroomRoom(roomId: string, roomSettings: RoomSettings): LocalClassroomRoom {
  const now = Date.now();
  const settings = normalizeRoomSettings(roomId, roomSettings);
  const room: LocalClassroomRoom = {
    roomId,
    createdAtMs: now,
    updatedAtMs: now,
    isLocked: false,
    isListed: true,
    allowMidGameJoin: true,
    requiresApproval: false,
    roomSettings: settings,
    trackLengthMeters: Math.max(1, settings.targetScore),
    totalLaps: 1,
    racePhase: "lobby",
    raceStartingAtMs: 0,
    raceStartedAtMs: 0,
    raceStopped: false,
    raceStoppedAtMs: 0,
    winnerPlayerId: null,
    tick: 0,
    players: {},
    removedPlayerIds: {}
  };
  writeLocalClassroomRoom(room);
  return room;
}

export function updateLocalClassroomRoom(
  roomId: string,
  updater: (room: LocalClassroomRoom) => LocalClassroomRoom | null,
  options: LocalClassroomUpdateOptions = {}
) {
  const current = readLocalClassroomRoom(roomId);
  if (!current) {
    return null;
  }
  const next = updater(current);
  if (!next) {
    return null;
  }
  next.tick += 1;
  next.updatedAtMs = Math.max(Date.now(), (current.updatedAtMs ?? 0) + 1);
  if (options.persist !== false) {
    writeLocalClassroomRoom(next, options);
  }
  return next;
}

export function localRoomToStateUpdate(room: LocalClassroomRoom): GameStateUpdateMessage {
  const lifecycleStatus = room.deletedAtMs
    ? "DELETED"
    : room.closedAtMs
      ? "CLOSED"
      : room.endedAtMs || room.raceStopped || room.racePhase === "finish"
        ? "FINISHED"
        : room.racePhase === "active" || room.racePhase === "starting"
          ? "RACING"
          : "WAITING";

  return {
    roomId: room.roomId,
    lifecycleStatus,
    serverTimeMs: Date.now(),
    tick: room.tick,
    racePhase: room.racePhase,
    raceStartingAtMs: room.raceStartingAtMs,
    raceStartedAtMs: room.raceStartedAtMs,
    raceStopped: room.raceStopped,
    raceStoppedAtMs: room.raceStoppedAtMs,
    winnerPlayerId: room.winnerPlayerId,
    roomCreatorPlayerId: "",
    roomSettings: room.roomSettings,
    trackLengthMeters: room.trackLengthMeters,
    players: Object.values(room.players)
      .sort((left, right) => {
        const scoreDelta = Math.max(0, Math.trunc(right.score ?? 0)) - Math.max(0, Math.trunc(left.score ?? 0));
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        if (left.positionMeters !== right.positionMeters) {
          return right.positionMeters - left.positionMeters;
        }
        return (left.joinedAtMs ?? 0) - (right.joinedAtMs ?? 0);
      })
      .map((player, index) => ({
        ...player,
        laneIndex: index,
        carId: normalizeCarId(player.carId),
        ready: Boolean(player.ready)
      }))
  };
}

export function subscribeLocalClassroomRoom(roomId: string, listener: (room: LocalClassroomRoom) => void) {
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(LOCAL_CLASSROOM_EVENT) : null;
  let latestRemoteSnapshot = "";
  const handleChange = (event: Event) => {
    if (event instanceof StorageEvent && event.key !== keyForRoom(roomId)) {
      return;
    }
    if (event instanceof CustomEvent && event.detail?.roomId !== roomId) {
      return;
    }
    const room = readLocalClassroomRoom(roomId);
    if (room) {
      listener(room);
    }
  };
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.roomId !== roomId) {
      return;
    }
    const room = readLocalClassroomRoom(roomId);
    if (room) {
      listener(room);
    }
  };
  window.addEventListener("storage", handleChange);
  window.addEventListener(LOCAL_CLASSROOM_EVENT, handleChange);
  channel?.addEventListener("message", handleBroadcast);
  const unsubscribeRemote = isFirebaseClassroomEnabled()
    ? subscribeFirebaseClassroomRoom(roomId, (room) => {
      // Firestore snapshots for a document are already ordered. Comparing only
      // updatedAtMs dropped valid player changes made within the same millisecond
      // (and changes from another client whose local clock was behind).
      const serializedRoom = JSON.stringify(room);
      if (serializedRoom === latestRemoteSnapshot) {
        return;
      }
      latestRemoteSnapshot = serializedRoom;
      if (serializedRoom === JSON.stringify(readLocalClassroomRoom(roomId))) {
        return;
      }
      writeLocalClassroomRoom(room, { syncRemote: false });
    })
    : null;
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(LOCAL_CLASSROOM_EVENT, handleChange);
    channel?.removeEventListener("message", handleBroadcast);
    channel?.close();
    unsubscribeRemote?.();
  };
}
