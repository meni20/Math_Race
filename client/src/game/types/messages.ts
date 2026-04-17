export type RacePhase = "lobby" | "starting" | "active" | "finish";

export interface JoinRoomRequest {
  roomId: string;
  playerId: string;
  displayName: string;
}

export interface ConnectPayload {
  roomId: string;
  playerId: string;
  displayName: string;
}

export interface StartRaceRequest {
  roomId: string;
  playerId: string;
}

export interface RoomJoinedMessage {
  roomId: string;
  targetPlayerId: string;
  displayName: string;
  trackLengthMeters: number;
  totalLaps: number;
  baseSpeedMps: number;
}

export interface AnswerSubmissionRequest {
  roomId: string;
  playerId: string;
  questionId: string;
  answer: string;
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
  laneIndex: number;
  positionMeters: number;
  speedMps: number;
  lap: number;
  finished: boolean;
  racePhase: RacePhase;
}

export interface GameStateUpdateMessage {
  roomId: string;
  serverTimeMs: number;
  tick: number;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceStopped: boolean;
  raceStoppedAtMs: number;
  winnerPlayerId: string | null;
  players: PlayerSnapshot[];
}

export interface QuestionMessage {
  roomId: string;
  targetPlayerId: string;
  questionId: string;
  prompt: string;
  difficulty: number;
  timeLimitMs: number;
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
}
