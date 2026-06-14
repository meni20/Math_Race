export type RacePhase = "lobby" | "starting" | "active" | "finish";
export type RoomLifecycleStatus = "WAITING" | "RACING" | "FINISHED" | "CLOSED" | "DELETED";
export type TrackTheme = "sunny-forest" | "snow-peak" | "fun-world" | "grand_prix";
export type CarId =
  | "bmw-m3"
  | "ford-gt"
  | "mercedes-amg"
  | "carson-annihilator"
  | "ferrari-testarossa"
  | "kitano-hydros";

export interface RoomSettings {
  raceName: string;
  maxPlayers: number;
  raceDurationSeconds: number;
  questionTimeLimitSeconds: number;
  classGroup?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  mapId?: TrackTheme;
  targetScore: number;
  operations?: "MIXED";
}

export interface JoinRoomRequest {
  roomId: string;
  playerId: string;
  displayName: string;
  carId?: CarId;
}

export interface ConnectPayload {
  roomId: string;
  playerId: string;
  displayName: string;
  carId?: CarId;
  roomSettings?: Partial<RoomSettings>;
  soloBotCount?: number;
}

export interface StartRaceRequest {
  roomId: string;
  playerId: string;
}

export interface UpdateRoomSettingsRequest {
  roomId: string;
  playerId: string;
  roomSettings: RoomSettings;
}

export interface RoomJoinedMessage {
  roomId: string;
  targetPlayerId: string;
  displayName: string;
  trackLengthMeters: number;
  totalLaps: number;
  baseSpeedMps: number;
  roomCreatorPlayerId: string;
  roomSettings: RoomSettings;
  carId?: CarId;
}

export interface AnswerSubmissionRequest {
  roomId: string;
  playerId: string;
  questionId: string;
  answer: string;
  timeout?: boolean;
}

export interface DecisionChoiceRequest {
  roomId: string;
  playerId: string;
  eventId: string;
  choice: "HIGHWAY" | "DIRT";
}

export interface PlayerSnapshot {
  playerId: string;
  displayName: string;
  joinedAtMs?: number;
  laneIndex: number;
  positionMeters: number;
  speedMps: number;
  lap: number;
  finished: boolean;
  racePhase: RacePhase;
  carId?: CarId;
  ready?: boolean;
  connected?: boolean;
  disconnectedAtMs?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  timeoutAnswers?: number;
  score?: number;
  visualDriveMeters?: number;
  routeMode?: string;
  streak?: number;
  averageAnswerTimeMs?: number;
}

export interface GameStateUpdateMessage {
  roomId: string;
  lifecycleStatus?: RoomLifecycleStatus;
  serverTimeMs: number;
  tick: number;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceStopped: boolean;
  raceStoppedAtMs: number;
  winnerPlayerId: string | null;
  roomCreatorPlayerId: string;
  roomSettings: RoomSettings;
  trackLengthMeters?: number;
  players: PlayerSnapshot[];
}

export interface QuestionMessage {
  roomId: string;
  targetPlayerId: string;
  questionId: string;
  id?: string;
  kind?: string;
  routeMode?: string;
  operation?: string;
  prompt: string;
  choices?: string[];
  difficulty: number;
  difficultyLabel?: string;
  timeLimitMs: number;
  timeLimitSeconds?: number;
  createdAtMs?: number;
  expiresAtMs: number;
  highwayChallenge: boolean;
}

export interface DecisionPointMessage {
  roomId: string;
  targetPlayerId: string;
  eventId: string;
  prompt: string;
  options: string[];
  expiresAtMs: number;
}

export interface AnswerFeedbackMessage {
  roomId: string;
  targetPlayerId: string;
  accepted: boolean;
  correct: boolean;
  resultType?: "CORRECT" | "WRONG" | "TIMEOUT";
  feedback?: "correct" | "wrong" | "timeout";
  pointsDelta?: number;
  progressDelta?: number;
  updatedProgress?: number;
  streak?: number;
  submittedAnswer?: string;
  expectedAnswer?: number;
}
