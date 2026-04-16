export interface JoinRoomRequest {
  roomId: string;
  playerId: string;
  displayName: string;
}

export interface JoinGameRequest extends JoinRoomRequest {
  sessionId: string;
}

export interface SyncRoomRequest {
  roomId: string;
  playerId: string;
  sessionId: string;
}

export interface AnswerSubmissionRequest extends SyncRoomRequest {
  questionId: string;
  answer: string;
}

export interface DecisionChoiceRequest extends SyncRoomRequest {
  eventId: string;
  choice: "HIGHWAY" | "DIRT";
}

export interface RoomJoinedMessage {
  roomId: string;
  targetPlayerId: string;
  displayName: string;
  trackLengthMeters: number;
  totalLaps: number;
  baseSpeedMps: number;
}

export interface PlayerSnapshot {
  playerId: string;
  displayName: string;
  laneIndex: number;
  positionMeters: number;
  speedMps: number;
  lap: number;
  finished: boolean;
}

export interface GameStateUpdateMessage {
  roomId: string;
  serverTimeMs: number;
  tick: number;
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

export interface GameErrorMessage {
  code: string;
  message: string;
  roomId?: string;
  playerId?: string;
}

export interface GameFunctionResponse {
  joined?: RoomJoinedMessage;
  stateUpdate?: GameStateUpdateMessage;
  question?: QuestionMessage | null;
  decision?: DecisionPointMessage | null;
  answerFeedback?: AnswerFeedbackMessage | null;
  error?: GameErrorMessage | null;
}

export interface GeneratedQuestionRecord {
  questionId: string;
  prompt: string;
  correctAnswer: string;
  difficulty: number;
  timeLimitMs: number;
  boostMultiplier: number;
}

export interface PendingQuestionRecord {
  question: GeneratedQuestionRecord;
  expiresAtMs: number;
  fromHighwayChallenge: boolean;
}

export interface DecisionPointRecord {
  eventId: string;
  prompt: string;
  options: string[];
  expiresAtMs: number;
}

export interface PlayerSessionRecord {
  sessionId: string;
  boundAtMs: number;
  lastSeenAtMs: number;
  lastJoinAtMs: number;
  lastAnswerAtMs: number;
  lastDecisionAtMs: number;
}

export interface PlayerStateRecord {
  playerId: string;
  displayName: string;
  laneIndex: number;
  positionMeters: number;
  speedMps: number;
  baseSpeedMps: number;
  boostSpeedMps: number;
  boostUntilMs: number;
  lap: number;
  finished: boolean;
  correctStreak: number;
  pendingQuestion: PendingQuestionRecord | null;
  pendingDecisionPoint: DecisionPointRecord | null;
  decisionCooldownUntilMs: number;
  highwayChallengeActive: boolean;
  session: PlayerSessionRecord | null;
}

export interface GameRoomStateRecord {
  roomId: string;
  trackLengthMeters: number;
  totalLaps: number;
  createdAtMs: number;
  tick: number;
  resultPersisted: boolean;
  raceStopped: boolean;
  raceStartedAtMs: number;
  raceStoppedAtMs: number;
  lastInteractionAtMs: number;
  winnerPlayerId: string | null;
  resultHistoryId: string | null;
  players: Record<string, PlayerStateRecord>;
}

export interface GameRoomRow {
  room_id: string;
  version: number;
  state_json: GameRoomStateRecord;
  updated_at: string;
}

export interface UserProfileUpsert {
  id: string;
  display_name: string;
}

export interface RaceHistoryRow {
  id: string;
  room_id: string;
  winner_player_id: string;
  total_players: number;
  total_laps: number;
  track_length_meters: number;
  finished_at: string;
  result_payload_json: string;
}

export interface RoomMutationResult {
  persist: boolean;
  room: GameRoomStateRecord | null;
  response: GameFunctionResponse;
  profile?: UserProfileUpsert;
}
