import type { PlayerSnapshot, RacePhase, RoomSettings, TrackTheme } from "../../game/types/messages";
import { getGarageCarById } from "../../game/utils/carCatalog";
import { normalizeRoomId } from "../../game/utils/gameIds";
import { DEFAULT_TARGET_SCORE, MAX_TARGET_SCORE, MIN_TARGET_SCORE, normalizeRoomSettings } from "../../game/utils/roomSettings";
import type { TeacherPlayerStatus, TeacherPlayerView, TeacherRaceConfig } from "./teacherTypes";

export const TRACK_THEME_LABELS: Record<TrackTheme, string> = {
  "sunny-forest": "יער שמשי",
  "snow-peak": "פסגת שלג",
  "fun-world": "עולם כיף",
  grand_prix: "אצטדיון גרנד פרי"
};

export const DEFAULT_TEACHER_CONFIG: TeacherRaceConfig = {
  raceName: "מרוץ מתמטיקה כיתתי",
  classGroup: "כיתה ד",
  roomCode: "",
  trackTheme: "sunny-forest",
  difficulty: "MEDIUM",
  targetScore: DEFAULT_TARGET_SCORE
};

export function isStaleTeacherRaceUpdate(
  currentPhase: RacePhase,
  currentRaceStartedAtMs: number,
  currentTick: number,
  incomingPhase: RacePhase,
  incomingRaceStartedAtMs: number,
  incomingTick: number
) {
  return currentPhase === "active"
    && incomingPhase === "active"
    && currentRaceStartedAtMs > 0
    && incomingRaceStartedAtMs === currentRaceStartedAtMs
    && Number.isFinite(incomingTick)
    && incomingTick < currentTick;
}

export function buildRandomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.floor(Math.random() * 1_000_000_000).toString(36).slice(0, 8)}`;
}

export function buildRoomCode() {
  return normalizeRoomId(`class-${Math.random().toString(36).slice(2, 8)}`).toUpperCase();
}

export function buildJoinLink(roomCode: string) {
  if (typeof window === "undefined") {
    return roomCode;
  }
  const configuredBaseUrl = import.meta.env.VITE_PUBLIC_APP_URL;
  const baseUrl = typeof configuredBaseUrl === "string" && configuredBaseUrl.trim()
    ? configuredBaseUrl.trim()
    : window.location.origin;
  const url = new URL(baseUrl);
  url.search = "";
  return url.toString();
}

export function buildQrCells(value: string) {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = ((seed << 5) - seed + value.charCodeAt(index)) | 0;
  }
  return Array.from({ length: 81 }, (_, index) => {
    const borderCell = index < 9 || index >= 72 || index % 9 === 0 || index % 9 === 8;
    if (borderCell) {
      return true;
    }
    const next = Math.sin(seed + index * 17.13) * 10000;
    return (next - Math.floor(next)) > 0.5;
  });
}

export function configToRoomSettings(config: TeacherRaceConfig): RoomSettings {
  return normalizeRoomSettings(config.roomCode, {
    raceName: config.raceName,
    classGroup: config.classGroup,
    difficulty: config.difficulty,
    mapId: config.trackTheme,
    targetScore: config.targetScore,
    maxPlayers: 8,
    raceDurationSeconds: 180,
    questionTimeLimitSeconds: 15,
    operations: "MIXED"
  });
}

export function getRaceProgress(player: PlayerSnapshot, targetScore: number) {
  const safeTargetScore = Math.max(1, Math.trunc(targetScore || DEFAULT_TARGET_SCORE));
  return Math.max(0, Math.min(100, (Math.max(0, Math.trunc(player.score ?? 0)) / safeTargetScore) * 100));
}

export function getTeacherPlayerStatus(player: PlayerSnapshot, localStatus?: TeacherPlayerStatus): TeacherPlayerStatus {
  if (localStatus === "DISCONNECTED") {
    return "DISCONNECTED";
  }
  if (localStatus === "KICKED" || localStatus === "REMOVED") {
    return localStatus;
  }
  if (player.finished || player.racePhase === "finish") {
    return "FINISHED";
  }
  if (player.connected === false) {
    return "DISCONNECTED";
  }
  if (player.racePhase === "active" || player.racePhase === "starting") {
    return "RACING";
  }
  return localStatus ?? "JOINED";
}

export function buildTeacherPlayers(
  players: PlayerSnapshot[],
  targetScore: number,
  statuses: Record<string, TeacherPlayerStatus>
): TeacherPlayerView[] {
  const safeTargetScore = Math.max(1, Math.trunc(targetScore || DEFAULT_TARGET_SCORE));
  return [...players]
    .sort((left, right) => getRaceProgress(right, safeTargetScore) - getRaceProgress(left, safeTargetScore))
    .map((player, index) => {
      const car = getGarageCarById(player.carId);
      return {
        playerId: player.playerId,
        name: player.displayName,
        carId: car.id,
        carName: car.name,
        carColor: car.accentColor,
        status: getTeacherPlayerStatus(player, statuses[player.playerId]),
        progressPercent: getRaceProgress(player, safeTargetScore),
        rank: index + 1,
        correctAnswers: Math.max(0, Math.trunc(player.correctAnswers ?? 0)),
        wrongAnswers: Math.max(0, Math.trunc(player.wrongAnswers ?? 0)),
        timeoutAnswers: Math.max(0, Math.trunc(player.timeoutAnswers ?? 0)),
        score: Math.max(0, Math.trunc(player.score ?? 0)),
        targetScore: safeTargetScore,
        routeMode: player.routeMode,
        connected: player.connected !== false,
        streak: Math.max(0, Math.trunc(player.streak ?? 0)),
        averageAnswerTimeMs: Math.max(0, Math.trunc(player.averageAnswerTimeMs ?? 0)),
        routeStats: player.routeStats,
        maxSpeedMps: player.maxSpeedMps
      };
    });
}

export function normalizeTeacherConfig(config: TeacherRaceConfig): TeacherRaceConfig {
  const roomCode = (normalizeRoomId(config.roomCode.trim()) || buildRoomCode()).toUpperCase();
  return {
    ...config,
    roomCode,
    raceName: config.raceName.trim() || DEFAULT_TEACHER_CONFIG.raceName,
    classGroup: config.classGroup.trim() || DEFAULT_TEACHER_CONFIG.classGroup,
    targetScore: Math.max(MIN_TARGET_SCORE, Math.min(MAX_TARGET_SCORE, Math.trunc(config.targetScore || DEFAULT_TEACHER_CONFIG.targetScore)))
  };
}

export function formatClock(ms: number) {
  const safeMs = Math.max(0, Math.trunc(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
