import type { RoomSettings } from "../types/messages";

const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 4;
const MIN_RACE_DURATION_SECONDS = 60;
const MAX_RACE_DURATION_SECONDS = 600;
const MIN_QUESTION_TIME_LIMIT_SECONDS = 5;
const MAX_QUESTION_TIME_LIMIT_SECONDS = 20;

function clampInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function buildDefaultRaceName(roomId: string) {
  const trimmedRoomId = roomId.trim();
  if (!trimmedRoomId) {
    return "Classroom Race";
  }
  return `${trimmedRoomId.replace(/[-_]+/g, " ")} setup`;
}

export function buildDefaultRoomSettings(roomId: string): RoomSettings {
  return {
    raceName: buildDefaultRaceName(roomId),
    maxPlayers: MAX_MAX_PLAYERS,
    raceDurationSeconds: 180,
    questionTimeLimitSeconds: 8
  };
}

export function normalizeRoomSettings(
  roomId: string,
  settings: Partial<RoomSettings> | null | undefined,
  minimumPlayers = MIN_MAX_PLAYERS
): RoomSettings {
  const defaults = buildDefaultRoomSettings(roomId);
  const safeMinimumPlayers = Math.max(MIN_MAX_PLAYERS, Math.min(MAX_MAX_PLAYERS, Math.trunc(minimumPlayers)));
  const raceName = typeof settings?.raceName === "string" && settings.raceName.trim()
    ? settings.raceName.trim().slice(0, 80)
    : defaults.raceName;

  return {
    raceName,
    maxPlayers: clampInteger(settings?.maxPlayers ?? defaults.maxPlayers, defaults.maxPlayers, safeMinimumPlayers, MAX_MAX_PLAYERS),
    raceDurationSeconds: clampInteger(
      settings?.raceDurationSeconds ?? defaults.raceDurationSeconds,
      defaults.raceDurationSeconds,
      MIN_RACE_DURATION_SECONDS,
      MAX_RACE_DURATION_SECONDS
    ),
    questionTimeLimitSeconds: clampInteger(
      settings?.questionTimeLimitSeconds ?? defaults.questionTimeLimitSeconds,
      defaults.questionTimeLimitSeconds,
      MIN_QUESTION_TIME_LIMIT_SECONDS,
      MAX_QUESTION_TIME_LIMIT_SECONDS
    )
  };
}

export function areRoomSettingsEqual(left: RoomSettings, right: RoomSettings) {
  return (
    left.raceName === right.raceName
    && left.maxPlayers === right.maxPlayers
    && left.raceDurationSeconds === right.raceDurationSeconds
    && left.questionTimeLimitSeconds === right.questionTimeLimitSeconds
  );
}

export function formatDurationLabel(seconds: number) {
  const safeSeconds = Math.max(0, Math.trunc(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainderSeconds = safeSeconds % 60;
  if (remainderSeconds === 0) {
    return `${minutes} min`;
  }
  return `${minutes}m ${remainderSeconds}s`;
}
