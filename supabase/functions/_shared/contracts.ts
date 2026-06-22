import type { PlayerQuestionState, RaceQuestionPrivate } from "./questions/questionTypes.ts";

export type RacePhase = "lobby" | "starting" | "active" | "finish";
export type RoomLifecycleStatus = "WAITING" | "RACING" | "FINISHED" | "CLOSED" | "DELETED";

export interface RoomSettings {
  raceName: string;
  maxPlayers: number;
  raceDurationSeconds: number;
  questionTimeLimitSeconds: number;
  classGroup?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  mapId?: string;
  targetScore: number;
  operations?: "MIXED";
}

export interface JoinRoomRequest {
  roomId: string;
  playerId: string;
  displayName: string;
  carId?: string;
}

export interface JoinGameRequest extends JoinRoomRequest {
  sessionId: string;
}

export interface SyncRoomRequest {
  roomId: string;
  playerId: string;
  sessionId: string;
}

export interface StartRaceRequest extends SyncRoomRequest {}

export interface UpdateRoomSettingsRequest extends SyncRoomRequest {
  roomSettings: RoomSettings;
}

export interface SetReadyRequest extends SyncRoomRequest {
  ready: boolean;
}

export interface TeacherRoomRequest {
  roomId: string;
  roomCode?: string;
  teacherSessionId: string;
}

export interface TeacherCreateRoomRequest extends TeacherRoomRequest {
  roomSettings: RoomSettings;
  className?: string;
  difficulty?: string;
  mapId?: string;
  requiresApproval?: boolean;
  questionTypes?: string[];
}

export interface TeacherUpdateRoomSettingsRequest extends TeacherRoomRequest {
  roomSettings: RoomSettings;
}

export interface TeacherRemovePlayerRequest extends TeacherRoomRequest {
  targetPlayerId: string;
}

export interface AnswerSubmissionRequest extends SyncRoomRequest {
  questionId: string;
  answer: string;
  timeout?: boolean;
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
  roomCreatorPlayerId: string;
  roomSettings: RoomSettings;
  carId?: string;
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
  carId?: string;
  ready?: boolean;
  connected?: boolean;
  disconnectedAtMs?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  timeoutAnswers?: number;
  score?: number;
  routeMode?: string;
  streak?: number;
  averageAnswerTimeMs?: number;
  routeStats?: Record<string, number>;
  maxSpeedMps?: number;
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
  choices: string[];
  difficulty: number;
  timeLimitMs: number;
  boostMultiplier: number;
}

export interface PendingQuestionRecord {
  question: RaceQuestionPrivate;
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
  carId?: string;
  joinedAtMs?: number;
  laneIndex: number;
  positionMeters: number;
  speedMps: number;
  baseSpeedMps: number;
  boostSpeedMps: number;
  boostUntilMs: number;
  lap: number;
  finished: boolean;
  correctStreak: number;
  correctAnswers: number;
  wrongAnswers: number;
  timeoutAnswers?: number;
  score?: number;
  totalAnswerTimeMs: number;
  answerCount: number;
  routeStats?: Record<string, number>;
  maxSpeedMps?: number;
  pendingQuestion: PendingQuestionRecord | null;
  pendingDecisionPoint: DecisionPointRecord | null;
  questionState?: PlayerQuestionState | null;
  decisionCooldownUntilMs: number;
  highwayChallengeActive: boolean;
  racePhase: RacePhase;
  ready?: boolean;
  connected?: boolean;
  disconnectedAtMs?: number;
  session: PlayerSessionRecord | null;
}

export interface GameRoomStateRecord {
  roomId: string;
  trackLengthMeters: number;
  totalLaps: number;
  createdAtMs: number;
  tick: number;
  resultPersisted: boolean;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStopped: boolean;
  raceStartedAtMs: number;
  raceStoppedAtMs: number;
  lastInteractionAtMs: number;
  winnerPlayerId: string | null;
  roomCreatorPlayerId: string | null;
  teacherSessionId?: string | null;
  teacherLastSeenAtMs?: number;
  requiresApproval?: boolean;
  className?: string | null;
  difficulty?: string | null;
  mapId?: string | null;
  questionTypes?: string[];
  targetScore?: number;
  isLocked?: boolean;
  isListed?: boolean;
  allowMidGameJoin?: boolean;
  endedAtMs?: number;
  closedAtMs?: number;
  deletedAtMs?: number;
  removedPlayerIds?: Record<string, number>;
  roomSettings: RoomSettings;
  resultHistoryId: string | null;
  players: Record<string, PlayerStateRecord>;
}

export interface GameRoomRow {
  room_id: string;
  version: number;
  state_json: GameRoomStateRecord;
  updated_at: string;
}

export interface GameRoomPresenceRow {
  room_id: string;
  player_id: string;
  session_id: string;
  last_seen_at: string;
  updated_at: string;
}

export interface GameRoomPresenceRecord {
  roomId: string;
  playerId: string;
  sessionId: string;
  lastSeenAtMs: number;
}

export interface GameRoomPresenceUpsert {
  roomId: string;
  playerId: string;
  sessionId: string;
  lastSeenAtMs: number;
}

export interface GameRoomPresenceDelete {
  roomId: string;
  playerId: string;
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
  skipClassroomSync?: boolean;
  roomEvents?: Array<{
    eventType: string;
    payload?: Record<string, unknown>;
  }>;
  profile?: UserProfileUpsert;
  presenceUpserts?: GameRoomPresenceUpsert[];
  presenceDeletes?: GameRoomPresenceDelete[];
}
