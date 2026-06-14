import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TeacherRoomRequest } from "./contracts.ts";
import { normalizeRoomId } from "./input.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeClassroomRoomCode(payload: { roomId?: string | null; roomCode?: string | null }) {
  const explicitRoomCode = String(payload.roomCode ?? "").trim();
  const rawRoomId = String(payload.roomId ?? "").trim();
  return normalizeRoomId(explicitRoomCode || rawRoomId, false);
}

export async function normalizeTeacherRoomRequest(
  admin: SupabaseClient,
  payload: Partial<TeacherRoomRequest>
): Promise<TeacherRoomRequest> {
  const teacherSessionId = String(payload.teacherSessionId ?? "");
  const explicitRoomCode = String(payload.roomCode ?? "").trim();
  const rawRoomId = String(payload.roomId ?? "").trim();

  if (explicitRoomCode) {
    const roomCode = normalizeClassroomRoomCode(payload);
    return {
      roomId: roomCode,
      roomCode,
      teacherSessionId
    };
  }

  if (UUID_PATTERN.test(rawRoomId)) {
    const { data, error } = await admin
      .from("classroom_rooms")
      .select("room_code")
      .eq("id", rawRoomId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data?.room_code) {
      throw new Error("Teacher room was not found for the supplied room id.");
    }
    const roomCode = normalizeRoomId(String(data.room_code), false);
    return { roomId: roomCode, roomCode, teacherSessionId };
  }

  const roomCode = normalizeClassroomRoomCode(payload);
  return { roomId: roomCode, roomCode, teacherSessionId };
}
