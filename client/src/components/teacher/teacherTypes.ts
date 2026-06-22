import type { CarId, RacePhase, RoomSettings, TrackTheme } from "../../game/types/messages";

export type TeacherPlayerStatus = "JOINED" | "WAITING_APPROVAL" | "APPROVED" | "RACING" | "FINISHED" | "KICKED" | "REMOVED" | "DISCONNECTED";
export type TeacherDashboardView = "overview" | "create" | "lobby" | "live" | "results" | "closed";
export type TeacherLiveTransportState = "idle" | "connecting_sse" | "sse_connected" | "sse_error" | "polling_fallback" | "stopped";
export type TeacherRoomLifecycleStatus = "DRAFT" | "CREATED" | "WAITING" | "RACING" | "FINISHED" | "CLOSED" | "DELETED";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export interface TeacherRaceConfig {
  raceName: string;
  classGroup: string;
  roomCode: string;
  trackTheme: TrackTheme;
  difficulty: Difficulty;
  targetScore: number;
}

export interface TeacherPlayerView {
  playerId: string;
  name: string;
  carId?: CarId;
  carName?: string;
  carColor?: string;
  status: TeacherPlayerStatus;
  progressPercent: number;
  rank: number;
  correctAnswers: number;
  wrongAnswers: number;
  timeoutAnswers: number;
  score: number;
  targetScore: number;
  routeMode?: string;
  connected?: boolean;
  streak?: number;
  averageAnswerTimeMs?: number;
  routeStats?: Record<string, number>;
  maxSpeedMps?: number;
}

export interface TeacherEvent {
  id: string;
  type: string;
  playerId?: string;
  message: string;
  createdAt: string;
}

export interface TeacherRoomSnapshot {
  roomId: string;
  lifecycleStatus: Exclude<TeacherRoomLifecycleStatus, "DRAFT" | "CREATED">;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceStopped: boolean;
  raceStoppedAtMs: number;
  winnerPlayerId: string;
  roomSettings: RoomSettings;
  trackLengthMeters: number;
  totalLaps: number;
  players: TeacherPlayerView[];
}

export interface TeacherRoomSummary {
  id: string;
  teacherId: string | null;
  roomCode: string;
  raceName: string;
  className: string | null;
  status: TeacherRoomLifecycleStatus;
  maxPlayers: number;
  currentPlayers: number;
  raceDurationSeconds: number;
  questionTimeLimitSeconds: number;
  targetScore: number;
  difficulty: string | null;
  mapId: string | null;
  requiresApproval: boolean;
  isLocked: boolean;
  isListed: boolean;
  allowMidGameJoin: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  closedAt: string | null;
  deletedAt: string | null;
}
