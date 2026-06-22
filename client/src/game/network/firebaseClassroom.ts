import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { collection, doc, getDoc, getDocs, getFirestore, onSnapshot, runTransaction } from "firebase/firestore";
import type { LocalClassroomRoom } from "./localClassroom";

type FirebaseWebConfig = FirebaseOptions & {
  apiKey: string;
  projectId: string;
};

const FIREBASE_APP_NAME = "math-race-classroom";
const ROOM_COLLECTION = "classroomRooms";

let configPromise: Promise<FirebaseWebConfig | null> | null = null;

function envConfig(): FirebaseWebConfig | null {
  const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY ?? "").trim();
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
  if (!apiKey || !projectId) {
    return null;
  }
  return {
    apiKey,
    projectId,
    authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim() || undefined,
    storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "").trim() || undefined,
    messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "").trim() || undefined,
    appId: String(import.meta.env.VITE_FIREBASE_APP_ID ?? "").trim() || undefined
  };
}

async function loadHostingConfig(): Promise<FirebaseWebConfig | null> {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const response = await fetch("/__/firebase/init.json", { cache: "force-cache" });
    if (!response.ok) {
      return null;
    }
    const data = await response.json() as Partial<FirebaseWebConfig>;
    return data.apiKey && data.projectId
      ? { ...data, apiKey: data.apiKey, projectId: data.projectId }
      : null;
  } catch {
    return null;
  }
}

export function isFirebaseClassroomEnabled() {
  return String(import.meta.env.VITE_CLASSROOM_FIREBASE ?? "").toLowerCase() === "true" || Boolean(envConfig());
}

async function getFirebaseWebConfig() {
  if (!isFirebaseClassroomEnabled()) {
    return null;
  }
  if (!configPromise) {
    configPromise = Promise.resolve(envConfig()).then((config) => config ?? loadHostingConfig());
  }
  return configPromise;
}

async function getClassroomDb() {
  const config = await getFirebaseWebConfig();
  if (!config) {
    return null;
  }
  const existingApp = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  const app = existingApp ?? initializeApp(config, FIREBASE_APP_NAME);
  return getFirestore(app);
}

function encodeRoom(room: LocalClassroomRoom) {
  return {
    roomId: room.roomId,
    joinCode: room.joinCode ?? "",
    updatedAtMs: Math.max(0, Math.trunc(room.updatedAtMs ?? Date.now())),
    roomJson: JSON.stringify(room)
  };
}

function decodeRoom(data: unknown): LocalClassroomRoom | null {
  const raw = (data as { roomJson?: unknown } | null)?.roomJson;
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as LocalClassroomRoom;
  } catch {
    return null;
  }
}

export function getClassroomTerminalRank(room: LocalClassroomRoom | null) {
  if (!room) return 0;
  if (room.deletedAtMs) return 3;
  if (room.closedAtMs) return 2;
  return room.raceStopped || room.racePhase === "finish" || room.endedAtMs ? 1 : 0;
}

export function isExplicitClassroomReset(room: LocalClassroomRoom) {
  return room.racePhase === "lobby"
    && !room.raceStopped
    && !room.winnerPlayerId
    && Object.values(room.players).every((player) => player.racePhase === "lobby" && !player.finished);
}

export async function writeFirebaseClassroomRoom(room: LocalClassroomRoom) {
  const db = await getClassroomDb();
  if (!db) {
    return;
  }
  const roomRef = doc(db, ROOM_COLLECTION, room.roomId);
  await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(roomRef);
    const currentRoom = currentSnapshot.exists() ? decodeRoom(currentSnapshot.data()) : null;
    const currentTerminalRank = getClassroomTerminalRank(currentRoom);
    const incomingTerminalRank = getClassroomTerminalRank(room);

    // Delayed answers may not revive a finished room. A deliberate lobby reset
    // remains supported, and close/delete can still advance terminal lifecycle.
    if (currentTerminalRank > 0 && incomingTerminalRank === 0 && !isExplicitClassroomReset(room)) {
      return;
    }
    if (currentTerminalRank > 0 && incomingTerminalRank > 0 && incomingTerminalRank <= currentTerminalRank) {
      return;
    }
    transaction.set(roomRef, encodeRoom(room));
  });
}

export async function readFirebaseClassroomRoom(roomId: string) {
  const db = await getClassroomDb();
  if (!db) {
    return null;
  }
  const snapshot = await getDoc(doc(db, ROOM_COLLECTION, roomId));
  return snapshot.exists() ? decodeRoom(snapshot.data()) : null;
}

export async function listFirebaseClassroomRooms() {
  const db = await getClassroomDb();
  if (!db) {
    return [] as LocalClassroomRoom[];
  }
  const snapshot = await getDocs(collection(db, ROOM_COLLECTION));
  return snapshot.docs
    .map((item) => decodeRoom(item.data()))
    .filter((room): room is LocalClassroomRoom => Boolean(room));
}

export function subscribeFirebaseClassroomRoom(roomId: string, listener: (room: LocalClassroomRoom) => void) {
  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  void getClassroomDb()
    .then((db) => {
      if (!db || disposed) {
        return;
      }
      unsubscribe = onSnapshot(
        doc(db, ROOM_COLLECTION, roomId),
        (snapshot) => {
          if (!snapshot.exists()) {
            return;
          }
          const room = decodeRoom(snapshot.data());
          if (room) {
            listener(room);
          }
        },
        (error) => {
          if (import.meta.env.DEV) {
            console.warn("[firebase-classroom] snapshot failed", error);
          }
        }
      );
    })
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn("[firebase-classroom] subscribe failed", error);
      }
    });

  return () => {
    disposed = true;
    unsubscribe?.();
  };
}
