import type { TeacherRoomRequest } from "../_shared/contracts.ts";
import { createAdminClient } from "../_shared/admin.ts";
import { findClassroomRoom } from "../_shared/classroom-store.ts";
import { teacherSyncRoom } from "../_shared/game-core.ts";
import { buildError, corsHeaders, jsonResponse } from "../_shared/http.ts";
import { runRoomMutation } from "../_shared/room-store.ts";
import { normalizeTeacherRoomRequest } from "../_shared/teacher-room-identity.ts";

const encoder = new TextEncoder();
const HEARTBEAT_MS = 15000;
const SNAPSHOT_POLL_MS = 1000;

function writeSse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function terminalEvent(status: string | undefined) {
  if (status === "CLOSED") {
    return "room_closed";
  }
  if (status === "DELETED") {
    return "room_deleted";
  }
  if (status === "FINISHED") {
    return "room_finished";
  }
  return null;
}

async function fetchNewRoomEvents(
  admin: ReturnType<typeof createAdminClient>,
  roomCode: string,
  afterCreatedAt: string | null
) {
  const classroomRoom = await findClassroomRoom(admin, roomCode);
  if (!classroomRoom) {
    return [];
  }
  let query = admin
    .from("room_events")
    .select("id,event_type,payload,created_at")
    .eq("room_id", classroomRoom.id)
    .order("created_at", { ascending: true })
    .limit(50);
  if (afterCreatedAt) {
    query = query.gt("created_at", afterCreatedAt);
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data ?? [];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use GET for this endpoint.") }, 405);
  }

  const url = new URL(request.url);
  const rawPayload: Partial<TeacherRoomRequest> = {
    roomId: url.searchParams.get("roomId") ?? "",
    roomCode: url.searchParams.get("roomCode") ?? "",
    teacherSessionId: String(url.searchParams.get("teacherSessionId") ?? "")
  };

  if ((!rawPayload.roomId && !rawPayload.roomCode) || !rawPayload.teacherSessionId) {
    return jsonResponse({ error: buildError("BAD_REQUEST", "roomCode or roomId and teacherSessionId are required.") }, 400);
  }

  const admin = createAdminClient();
  let payload: TeacherRoomRequest;
  try {
    payload = await normalizeTeacherRoomRequest(admin, rawPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Teacher room was not found.";
    return jsonResponse({ error: buildError("ROOM_NOT_FOUND", message) }, 404);
  }
  let closed = false;
  let timerId: number | null = null;
  let lastHeartbeatAtMs = 0;
  let lastSnapshotKey = "";
  let lastRoomEventCreatedAt: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const closeStream = () => {
        closed = true;
        if (timerId !== null) {
          clearInterval(timerId);
          timerId = null;
        }
        controller.close();
      };

      const sendSnapshot = async () => {
        if (closed) {
          return;
        }
        try {
          const now = Date.now();
          const result = await runRoomMutation(
            admin,
            payload.roomId,
            now,
            (room, presenceByPlayerId) => teacherSyncRoom(room, payload, presenceByPlayerId, now)
          );
          if (closed) {
            return;
          }

          if (result.response.error) {
            writeSse(controller, "room_event", { error: result.response.error });
            closeStream();
            return;
          }

          const stateUpdate = result.response.stateUpdate;
          const snapshotKey = stateUpdate
            ? `${stateUpdate.lifecycleStatus}:${stateUpdate.tick}:${stateUpdate.players.length}:${stateUpdate.racePhase}`
            : "";

          if (stateUpdate && snapshotKey !== lastSnapshotKey) {
            lastSnapshotKey = snapshotKey;
            writeSse(controller, "room_snapshot", { stateUpdate });
          }

          const roomEvents = await fetchNewRoomEvents(admin, payload.roomId, lastRoomEventCreatedAt);
          for (const roomEvent of roomEvents) {
            lastRoomEventCreatedAt = String(roomEvent.created_at);
            writeSse(controller, "room_event", {
              eventType: roomEvent.event_type,
              payload: roomEvent.payload ?? {},
              createdAt: roomEvent.created_at
            });
          }

          const terminal = terminalEvent(stateUpdate?.lifecycleStatus);
          if (terminal) {
            writeSse(controller, terminal, { stateUpdate });
            closeStream();
            return;
          }

          if (now - lastHeartbeatAtMs >= HEARTBEAT_MS) {
            lastHeartbeatAtMs = now;
            writeSse(controller, "heartbeat", { at: new Date(now).toISOString() });
          }
        } catch (error) {
          writeSse(controller, "room_event", {
            error: {
              code: "TEACHER_ROOM_EVENTS_FAILED",
              message: error instanceof Error ? error.message : "Teacher live stream failed."
            }
          });
          closeStream();
        }
      };

      void sendSnapshot();
      timerId = setInterval(() => void sendSnapshot(), SNAPSHOT_POLL_MS);
    },
    cancel() {
      closed = true;
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
});
