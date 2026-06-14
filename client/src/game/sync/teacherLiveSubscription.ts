import type { GameStateUpdateMessage } from "../types/messages";
import { getSupabaseTransportConfig } from "../network/transportConfig";

export type TeacherRoomLiveEventType =
  | "room_snapshot"
  | "room_closed"
  | "room_deleted"
  | "room_finished"
  | "room_event"
  | "heartbeat";

export interface TeacherRoomLiveUpdate {
  event: TeacherRoomLiveEventType;
  stateUpdate?: GameStateUpdateMessage;
  payload?: Record<string, unknown>;
}

export interface TeacherRoomLiveSubscription {
  disconnect: (reason?: string) => void;
  isConnected: () => boolean;
  getLastEventAtMs: () => number;
}

interface ConnectTeacherRoomLiveUpdatesInput {
  roomId: string;
  roomCode?: string;
  teacherSessionId: string;
  onConnected?: (update: TeacherRoomLiveUpdate) => void;
  onUpdate: (update: TeacherRoomLiveUpdate) => void;
  onError: (error: Error) => void;
}

function parseSseEvent(rawEvent: string): TeacherRoomLiveUpdate | null {
  const lines = rawEvent.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    } else if (line.startsWith("id:")) {
      continue;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const parsed = JSON.parse(dataLines.join("\n")) as Omit<TeacherRoomLiveUpdate, "event">;
  return {
    event: event as TeacherRoomLiveEventType,
    ...parsed
  };
}

export function connectTeacherRoomLiveUpdates({
  roomId,
  roomCode,
  teacherSessionId,
  onConnected,
  onUpdate,
  onError
}: ConnectTeacherRoomLiveUpdatesInput): TeacherRoomLiveSubscription {
  const config = getSupabaseTransportConfig();
  const abortController = new AbortController();
  let connected = false;
  let terminalReceived = false;
  let lastEventAtMs = 0;
  let parseFailureCount = 0;

  if (!config) {
    queueMicrotask(() => onError(new Error("Supabase transport is not configured.")));
    return {
      disconnect: () => abortController.abort(),
      isConnected: () => false,
      getLastEventAtMs: () => 0
    };
  }

  const endpoint = new URL(`${config.url}/functions/v1/teacher-room-events`);
  endpoint.searchParams.set("roomCode", roomCode || roomId);
  endpoint.searchParams.set("teacherSessionId", teacherSessionId);

  void fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      Accept: "text/event-stream"
    },
    signal: abortController.signal
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        throw new Error(`Teacher live stream failed with ${response.status}.`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/event-stream")) {
        throw new Error(`Teacher live stream returned ${contentType || "unknown content type"}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n|\r\n\r\n/);
        buffer = events.pop() ?? "";
        for (const rawEvent of events) {
          try {
            const update = parseSseEvent(rawEvent);
            if (update) {
              lastEventAtMs = Date.now();
              parseFailureCount = 0;
              if (!connected && (update.event === "room_snapshot" || update.event === "heartbeat" || update.event === "room_event")) {
                connected = true;
                onConnected?.(update);
              }
              if (update.event === "room_closed" || update.event === "room_deleted" || update.event === "room_finished") {
                terminalReceived = true;
              }
              onUpdate(update);
            }
          } catch (error) {
            parseFailureCount += 1;
            if (parseFailureCount >= 3) {
              throw error;
            }
          }
        }
      }
      if (!abortController.signal.aborted && !terminalReceived) {
        throw new Error("Teacher live stream closed unexpectedly.");
      }
    })
    .catch((error) => {
      if (abortController.signal.aborted) {
        return;
      }
      connected = false;
      onError(error instanceof Error ? error : new Error("Teacher live stream failed."));
    });

  return {
    disconnect: () => {
      connected = false;
      abortController.abort();
    },
    isConnected: () => connected && !abortController.signal.aborted,
    getLastEventAtMs: () => lastEventAtMs
  };
}
