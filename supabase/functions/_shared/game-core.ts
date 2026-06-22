import type {
  AnswerFeedbackMessage,
  AnswerSubmissionRequest,
  DecisionChoiceRequest,
  DecisionPointMessage,
  DecisionPointRecord,
  GameErrorMessage,
  GameRoomPresenceDelete,
  GameRoomPresenceRecord,
  GameRoomPresenceUpsert,
  GameFunctionResponse,
  GameRoomStateRecord,
  GameStateUpdateMessage,
  JoinGameRequest,
  PendingQuestionRecord,
  PlayerSessionRecord,
  PlayerSnapshot,
  PlayerStateRecord,
  QuestionMessage,
  RaceHistoryRow,
  RacePhase,
  RoomSettings,
  SetReadyRequest,
  RoomJoinedMessage,
  RoomLifecycleStatus,
  TeacherCreateRoomRequest,
  TeacherRemovePlayerRequest,
  TeacherRoomRequest,
  TeacherUpdateRoomSettingsRequest,
  UpdateRoomSettingsRequest,
  RoomMutationResult
} from "./contracts.ts";
import { normalizeDisplayName } from "./input.ts";
import { validateAnswer } from "./questions/answerValidator.ts";
import { scoreAnswer } from "./questions/scoringEngine.ts";
import {
  advanceQuestionStateAfterAnswer,
  chooseRoute,
  createInitialPlayerQuestionState,
  createRouteChoicePrompt,
  ensureNextPrompt,
  hasAnsweredQuestion,
  normalizePlayerQuestionState
} from "./questions/questionStateMachine.ts";
import type {
  Difficulty,
  PlayerQuestionState,
  QuestionResultType,
  RaceQuestionPrivate,
  RouteMode
} from "./questions/questionTypes.ts";

const BASE_SPEED_MPS = 42;
const MIN_SPEED_MPS = 18;
const BASE_ACCEL_MPS2 = 11;
const BOOST_ACCEL_MPS2 = 28;
const DRAG_MPS2 = 8;
const BOOST_EXTRA_SPEED_MPS = 30;
const BASE_BOOST_DURATION_MS = 3000;
const WRONG_ANSWER_SPEED_PENALTY_MPS = 7.5;
const TIMEOUT_ANSWER_SPEED_PENALTY_MPS = 9.5;
const ANSWER_GRACE_MS = 350;
const DECISION_TRIGGER_PROBABILITY = 0.22;
const DECISION_COOLDOWN_MS = 12000;
const DECISION_TTL_MS = 8000;
const HIGHWAY_TELEPORT_METERS = 240;
const HIGHWAY_SUPER_BOOST_MS = 2200;
const STALE_SESSION_MS = 60000;
const JOIN_RATE_LIMIT_MS = 500;
const ANSWER_RATE_LIMIT_MS = 75;
const DECISION_RATE_LIMIT_MS = 120;
const MAX_ADVANCE_STEP_MS = 250;
const SYNC_PRESENCE_HEARTBEAT_MS = 5000;
const DEFAULT_TRACK_LENGTH_METERS = 300;
const DEFAULT_TOTAL_LAPS = 1;
const RACE_START_COUNTDOWN_MS = 2600;
const HIGHWAY_CHOICE = "HIGHWAY";
const DIRT_CHOICE = "DIRT";
const DEFAULT_MAX_PLAYERS = 8;
const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 8;
const DEFAULT_RACE_DURATION_SECONDS = 180;
const MIN_RACE_DURATION_SECONDS = 60;
const MAX_RACE_DURATION_SECONDS = 600;
const DEFAULT_QUESTION_TIME_LIMIT_SECONDS = 8;
const MIN_QUESTION_TIME_LIMIT_SECONDS = 5;
const MAX_QUESTION_TIME_LIMIT_SECONDS = 20;
const DEFAULT_TARGET_SCORE = 300;
const MIN_TARGET_SCORE = 50;
const MAX_TARGET_SCORE = 10000;

type PresenceByPlayerId = Record<string, GameRoomPresenceRecord>;

interface AdvanceRoomResult {
  persist: boolean;
  presenceDeletes: GameRoomPresenceDelete[];
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function sanitizeFinite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function clampInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function buildDefaultRaceName(roomId: string) {
  return roomId.trim()
    ? `${roomId.trim().replace(/[-_]+/g, " ")} setup`
    : "Classroom Race";
}

function buildDefaultRoomSettings(roomId: string): RoomSettings {
  return {
    raceName: buildDefaultRaceName(roomId),
    maxPlayers: DEFAULT_MAX_PLAYERS,
    raceDurationSeconds: DEFAULT_RACE_DURATION_SECONDS,
    questionTimeLimitSeconds: 15,
    targetScore: DEFAULT_TARGET_SCORE,
    operations: "MIXED",
    mapId: "sunny-forest"
  };
}

function normalizeRoomSettings(
  roomId: string,
  roomSettings: Partial<RoomSettings> | null | undefined,
  minimumPlayers = MIN_MAX_PLAYERS
): RoomSettings {
  const defaults = buildDefaultRoomSettings(roomId);
  const safeMinimumPlayers = Math.max(MIN_MAX_PLAYERS, Math.min(MAX_MAX_PLAYERS, Math.trunc(minimumPlayers)));
  const raceName = typeof roomSettings?.raceName === "string" && roomSettings.raceName.trim()
    ? roomSettings.raceName.trim().slice(0, 80)
    : defaults.raceName;

  return {
    raceName,
    maxPlayers: MAX_MAX_PLAYERS,
    raceDurationSeconds: clampInteger(
      Number(roomSettings?.raceDurationSeconds ?? defaults.raceDurationSeconds),
      defaults.raceDurationSeconds,
      MIN_RACE_DURATION_SECONDS,
      MAX_RACE_DURATION_SECONDS
    ),
    questionTimeLimitSeconds: clampInteger(
      Number(roomSettings?.questionTimeLimitSeconds ?? defaults.questionTimeLimitSeconds),
      defaults.questionTimeLimitSeconds,
      MIN_QUESTION_TIME_LIMIT_SECONDS,
      MAX_QUESTION_TIME_LIMIT_SECONDS
    ),
    targetScore: clampInteger(
      Number(roomSettings?.targetScore ?? defaults.targetScore),
      defaults.targetScore,
      MIN_TARGET_SCORE,
      MAX_TARGET_SCORE
    ),
    classGroup: typeof roomSettings?.classGroup === "string" ? roomSettings.classGroup.trim().slice(0, 80) : defaults.classGroup,
    difficulty: roomSettings?.difficulty === "EASY" || roomSettings?.difficulty === "MEDIUM" || roomSettings?.difficulty === "HARD"
      ? roomSettings.difficulty
      : defaults.difficulty,
    mapId: typeof roomSettings?.mapId === "string" ? roomSettings.mapId : defaults.mapId,
    operations: "MIXED"
  };
}

function getPlayerJoinedAtMs(player: PlayerStateRecord) {
  return Number.isFinite(player.joinedAtMs) ? Number(player.joinedAtMs) : 0;
}

function rosterPlayers(room: GameRoomStateRecord) {
  return Object.values(room.players).sort((left, right) => {
    const joinedDelta = getPlayerJoinedAtMs(left) - getPlayerJoinedAtMs(right);
    if (joinedDelta !== 0) {
      return joinedDelta;
    }
    return left.playerId.localeCompare(right.playerId);
  });
}

function sortedPlayers(room: GameRoomStateRecord) {
  return Object.values(room.players).sort((left, right) => {
    if (left.lap !== right.lap) {
      return right.lap - left.lap;
    }
    if (left.positionMeters !== right.positionMeters) {
      return right.positionMeters - left.positionMeters;
    }
    return left.playerId.localeCompare(right.playerId);
  });
}

function isRaceActive(phase: RacePhase) {
  return phase === "active";
}

function roomLifecycleStatus(room: GameRoomStateRecord): RoomLifecycleStatus {
  if (room.deletedAtMs) {
    return "DELETED";
  }
  if (room.closedAtMs) {
    return "CLOSED";
  }
  if (room.endedAtMs || room.raceStopped || room.racePhase === "finish") {
    return "FINISHED";
  }
  if (room.racePhase === "starting" || room.racePhase === "active") {
    return "RACING";
  }
  return "WAITING";
}

function normalizeStoredPlayerRacePhase(player: PlayerStateRecord, room: GameRoomStateRecord): RacePhase {
  if (
    player.racePhase === "lobby"
    || player.racePhase === "starting"
    || player.racePhase === "active"
    || player.racePhase === "finish"
  ) {
    return player.racePhase;
  }

  if (player.finished || room.raceStopped || room.racePhase === "finish") {
    return "finish";
  }
  if (room.racePhase === "starting") {
    return "starting";
  }
  if (room.racePhase === "active") {
    return "active";
  }
  return "lobby";
}

function hydratePlayerRacePhases(room: GameRoomStateRecord) {
  for (const player of Object.values(room.players)) {
    player.racePhase = normalizeStoredPlayerRacePhase(player, room);
  }
}

function pickRoomHost(room: GameRoomStateRecord) {
  return rosterPlayers(room)[0]?.playerId ?? null;
}

function hydrateRoomSetup(room: GameRoomStateRecord) {
  const previousCreatorPlayerId = room.roomCreatorPlayerId;
  const previousRoomSettings = room.roomSettings;
  let fallbackJoinedAtMs = room.createdAtMs;
  for (const player of Object.values(room.players)) {
    if (!Number.isFinite(player.joinedAtMs)) {
      player.joinedAtMs = fallbackJoinedAtMs;
      fallbackJoinedAtMs += 1;
    }
  }

  room.roomSettings = normalizeRoomSettings(
    room.roomId,
    room.roomSettings,
    Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length || MIN_MAX_PLAYERS)
  );

  room.roomCreatorPlayerId = room.teacherSessionId ? null : pickRoomHost(room);
  if (room.teacherSessionId) {
    room.targetScore = room.roomSettings.targetScore;
    room.trackLengthMeters = room.targetScore;
    room.totalLaps = 1;
  }

  return previousCreatorPlayerId !== room.roomCreatorPlayerId
    || !areRoomSettingsEqual(previousRoomSettings, room.roomSettings);
}

function allPlayersInLobby(room: GameRoomStateRecord) {
  const players = Object.values(room.players);
  return players.length > 0 && players.every((player) => player.racePhase === "lobby");
}

function anyPlayersActivelyRacing(room: GameRoomStateRecord) {
  return Object.values(room.players).some((player) => (
    player.racePhase === "starting"
    || player.racePhase === "active"
  ));
}

function anyPlayersWaitingInLobby(room: GameRoomStateRecord) {
  return Object.values(room.players).some((player) => player.racePhase === "lobby");
}

function areRoomSettingsEqual(left: RoomSettings | null | undefined, right: RoomSettings | null | undefined) {
  if (!left || !right) {
    return left === right;
  }
  return left.raceName === right.raceName
    && left.maxPlayers === right.maxPlayers
    && left.raceDurationSeconds === right.raceDurationSeconds
    && left.questionTimeLimitSeconds === right.questionTimeLimitSeconds
    && left.targetScore === right.targetScore
    && left.mapId === right.mapId
    && left.difficulty === right.difficulty
    && left.classGroup === right.classGroup;
}

function isFreshPresence(presence: GameRoomPresenceRecord | null | undefined, now: number) {
  return Boolean(presence && (now - presence.lastSeenAtMs) <= STALE_SESSION_MS);
}

function buildPresenceUpsert(roomId: string, playerId: string, sessionId: string, now: number): GameRoomPresenceUpsert {
  return {
    roomId,
    playerId,
    sessionId,
    lastSeenAtMs: now
  };
}

function shouldPersistPresenceHeartbeat(
  presenceByPlayerId: PresenceByPlayerId,
  roomId: string,
  playerId: string,
  sessionId: string,
  now: number
) {
  const presence = presenceByPlayerId[playerId] ?? null;
  if (!presence) {
    return true;
  }
  if (presence.roomId !== roomId || presence.sessionId !== sessionId) {
    return true;
  }
  return (now - presence.lastSeenAtMs) >= SYNC_PRESENCE_HEARTBEAT_MS;
}

function buildSession(previous: PlayerSessionRecord | null, sessionId: string, now: number): PlayerSessionRecord {
  return {
    sessionId,
    boundAtMs: previous?.sessionId === sessionId ? previous.boundAtMs : now,
    lastSeenAtMs: now,
    lastJoinAtMs: previous?.lastJoinAtMs ?? 0,
    lastAnswerAtMs: previous?.lastAnswerAtMs ?? 0,
    lastDecisionAtMs: previous?.lastDecisionAtMs ?? 0
  };
}

function isFreshSession(session: PlayerSessionRecord | null, now: number) {
  return Boolean(session && (now - session.lastSeenAtMs) <= STALE_SESSION_MS);
}

function normalizeCarId(carId: string | null | undefined) {
  const normalized = String(carId ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 64);
  return normalized || undefined;
}

function createPlayerState(playerId: string, displayName: string, laneIndex: number, joinedAtMs: number, carId?: string): PlayerStateRecord {
  return {
    playerId,
    displayName,
    carId: normalizeCarId(carId),
    joinedAtMs,
    laneIndex,
    positionMeters: 0,
    speedMps: BASE_SPEED_MPS,
    baseSpeedMps: BASE_SPEED_MPS,
    boostSpeedMps: BASE_SPEED_MPS,
    boostUntilMs: 0,
    lap: 0,
    finished: false,
    correctStreak: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    timeoutAnswers: 0,
    score: 0,
    totalAnswerTimeMs: 0,
    answerCount: 0,
    pendingQuestion: null,
    pendingDecisionPoint: null,
    questionState: createInitialPlayerQuestionState(),
    decisionCooldownUntilMs: 0,
    highwayChallengeActive: false,
    racePhase: "lobby",
    ready: false,
    connected: true,
    disconnectedAtMs: 0,
    session: null
  };
}

export function createRoomState(
  roomId: string,
  now: number,
  trackLengthMeters = DEFAULT_TRACK_LENGTH_METERS,
  totalLaps = DEFAULT_TOTAL_LAPS
): GameRoomStateRecord {
  return {
    roomId,
    trackLengthMeters,
    totalLaps,
    createdAtMs: now,
    tick: 0,
    resultPersisted: false,
    racePhase: "lobby",
    raceStartingAtMs: 0,
    raceStopped: false,
    raceStartedAtMs: 0,
    raceStoppedAtMs: 0,
    lastInteractionAtMs: now,
    winnerPlayerId: null,
    roomCreatorPlayerId: null,
    teacherSessionId: null,
    teacherLastSeenAtMs: 0,
    requiresApproval: false,
    difficulty: "MEDIUM",
    mapId: "sunny-forest",
    questionTypes: ["MIXED"],
    targetScore: DEFAULT_TARGET_SCORE,
    isLocked: false,
    isListed: true,
    allowMidGameJoin: true,
    endedAtMs: 0,
    closedAtMs: 0,
    deletedAtMs: 0,
    roomSettings: buildDefaultRoomSettings(roomId),
    resultHistoryId: null,
    players: {}
  };
}

function errorResponse(code: string, message: string, roomId?: string, playerId?: string): GameFunctionResponse {
  const error: GameErrorMessage = { code, message, roomId, playerId };
  return {
    question: null,
    decision: null,
    error
  };
}

function difficultyToNumber(difficulty: RaceQuestionPrivate["difficulty"]) {
  return difficulty === "HARD" ? 3 : difficulty === "MEDIUM" ? 2 : 1;
}

function getRoomQuestionDifficulty(room: GameRoomStateRecord): Difficulty {
  const difficulty = room.roomSettings?.difficulty ?? room.difficulty;
  return difficulty === "EASY" || difficulty === "MEDIUM" || difficulty === "HARD" ? difficulty : "MEDIUM";
}

function getPlayerQuestionState(player: PlayerStateRecord): PlayerQuestionState {
  const fallback = createInitialPlayerQuestionState();
  fallback.streak = Math.max(0, Math.trunc(player.correctStreak ?? 0));
  return normalizePlayerQuestionState(player.questionState ?? fallback);
}

function setPlayerQuestionState(player: PlayerStateRecord, state: PlayerQuestionState) {
  player.questionState = normalizePlayerQuestionState(state);
  player.correctStreak = player.questionState.streak;
}

function syncPendingQuestionFromState(player: PlayerStateRecord) {
  const question = player.questionState?.currentQuestion;
  player.pendingQuestion = question
    ? {
      question,
      expiresAtMs: question.expiresAtMs,
      fromHighwayChallenge: question.routeMode === "HIGHWAY"
    }
    : null;
}

function createPendingQuestionFromEngine(question: RaceQuestionPrivate): PendingQuestionRecord {
  return {
    question,
    expiresAtMs: question.expiresAtMs,
    fromHighwayChallenge: question.routeMode === "HIGHWAY"
  };
}

function toQuestionMessage(roomId: string, player: PlayerStateRecord, pending: PendingQuestionRecord): QuestionMessage {
  const question = pending.question;
  return {
    roomId,
    targetPlayerId: player.playerId,
    questionId: question.id,
    id: question.id,
    kind: question.kind,
    routeMode: question.routeMode,
    operation: question.operation,
    prompt: question.prompt,
    choices: question.choices,
    difficulty: difficultyToNumber(question.difficulty),
    difficultyLabel: question.difficulty,
    timeLimitMs: question.timeLimitSeconds * 1000,
    timeLimitSeconds: question.timeLimitSeconds,
    createdAtMs: question.createdAtMs,
    expiresAtMs: question.expiresAtMs,
    highwayChallenge: question.routeMode === "HIGHWAY"
  };
}

function toDecisionMessage(roomId: string, player: PlayerStateRecord, point: DecisionPointRecord): DecisionPointMessage {
  return {
    roomId,
    targetPlayerId: player.playerId,
    eventId: point.eventId,
    prompt: point.prompt,
    options: point.options,
    expiresAtMs: point.expiresAtMs
  };
}

function currentPrompt(room: GameRoomStateRecord, player: PlayerStateRecord, now: number) {
  if (!isRaceActive(room.racePhase) || room.raceStopped || player.racePhase !== "active") {
    return {
      question: null,
      decision: null
    };
  }

  const pendingDecision = player.pendingDecisionPoint;
  if (pendingDecision && now <= pendingDecision.expiresAtMs) {
    return {
      question: null,
      decision: toDecisionMessage(room.roomId, player, pendingDecision)
    };
  }

  const pendingQuestion = player.pendingQuestion;
  if (pendingQuestion && now <= pendingQuestion.expiresAtMs) {
    return {
      question: toQuestionMessage(room.roomId, player, pendingQuestion),
      decision: null
    };
  }

  return {
    question: null,
    decision: null
  };
}

function issueNewQuestion(room: GameRoomStateRecord, player: PlayerStateRecord, _difficulty: number, _highwayChallenge: boolean, now: number) {
  const result = ensureNextPrompt(getPlayerQuestionState(player), now, getRoomQuestionDifficulty(room));
  setPlayerQuestionState(player, result.state);
  syncPendingQuestionFromState(player);
  if (result.routeChoice) {
    player.pendingDecisionPoint = {
      eventId: result.routeChoice.id,
      prompt: result.routeChoice.prompt,
      options: [HIGHWAY_CHOICE, DIRT_CHOICE],
      expiresAtMs: result.routeChoice.expiresAtMs
    };
  } else {
    player.pendingDecisionPoint = null;
  }
}

function calculateDifficulty(player: PlayerStateRecord, correctAnswer: boolean) {
  let levelByStreak = 1 + Math.min(2, Math.floor(player.correctStreak / 2));
  if (player.lap >= 2) {
    levelByStreak = Math.min(3, levelByStreak + 1);
  }
  if (!correctAnswer) {
    levelByStreak = Math.max(1, levelByStreak - 1);
  }
  return levelByStreak;
}

function applyBoost(player: PlayerStateRecord, multiplier: number, durationMs: number, now: number) {
  const cappedMultiplier = Math.max(0.35, Math.min(multiplier, 2.5));
  const boostSpeed = player.baseSpeedMps + (BOOST_EXTRA_SPEED_MPS * cappedMultiplier);
  player.boostSpeedMps = Math.max(player.boostSpeedMps, boostSpeed);
  player.boostUntilMs = Math.max(player.boostUntilMs, now + durationMs);
}

function shouldOfferDecision(player: PlayerStateRecord, now: number) {
  void player;
  void now;
  return false;
}

function issueDecision(room: GameRoomStateRecord, player: PlayerStateRecord, now: number) {
  const routeChoice = createRouteChoicePrompt(now);
  const point: DecisionPointRecord = {
    eventId: routeChoice.id,
    prompt: routeChoice.prompt,
    options: [HIGHWAY_CHOICE, DIRT_CHOICE],
    expiresAtMs: routeChoice.expiresAtMs
  };
  player.pendingDecisionPoint = point;
  return toDecisionMessage(room.roomId, player, point);
}

function resetPlayerForNewRace(player: PlayerStateRecord) {
  player.positionMeters = 0;
  player.speedMps = BASE_SPEED_MPS;
  player.baseSpeedMps = BASE_SPEED_MPS;
  player.boostSpeedMps = BASE_SPEED_MPS;
  player.boostUntilMs = 0;
  player.lap = 0;
  player.finished = false;
  player.correctStreak = 0;
  player.correctAnswers = player.correctAnswers ?? 0;
  player.wrongAnswers = player.wrongAnswers ?? 0;
  player.timeoutAnswers = player.timeoutAnswers ?? 0;
  player.score = player.score ?? 0;
  player.totalAnswerTimeMs = player.totalAnswerTimeMs ?? 0;
  player.answerCount = player.answerCount ?? 0;
  player.routeStats = {};
  player.maxSpeedMps = BASE_SPEED_MPS;
  player.pendingQuestion = null;
  player.pendingDecisionPoint = null;
  player.questionState = createInitialPlayerQuestionState();
  player.decisionCooldownUntilMs = 0;
  player.highwayChallengeActive = false;
  player.racePhase = "lobby";
}

function resetRoomForNewRace(room: GameRoomStateRecord, now: number) {
  room.resultPersisted = false;
  room.racePhase = "lobby";
  room.raceStartingAtMs = 0;
  room.raceStopped = false;
  room.raceStartedAtMs = 0;
  room.raceStoppedAtMs = 0;
  room.lastInteractionAtMs = now;
  room.tick = 0;
  room.winnerPlayerId = null;
  room.resultHistoryId = null;
  room.endedAtMs = 0;
  for (const player of Object.values(room.players)) {
    resetPlayerForNewRace(player);
  }
}

function activateRace(room: GameRoomStateRecord, startAtMs: number) {
  room.racePhase = "active";
  room.raceStartingAtMs = 0;
  room.raceStopped = false;
  room.raceStartedAtMs = startAtMs;
  room.raceStoppedAtMs = 0;
  room.lastInteractionAtMs = startAtMs;
  room.tick = 0;
  room.winnerPlayerId = null;
  room.endedAtMs = 0;

  for (const player of Object.values(room.players)) {
    player.racePhase = "active";
    player.pendingDecisionPoint = null;
    if (!player.finished) {
      player.highwayChallengeActive = false;
      if (!player.pendingQuestion) {
        issueNewQuestion(room, player, 1, false, startAtMs);
      }
    }
  }
}

function scheduleRaceStart(room: GameRoomStateRecord, now: number) {
  room.resultPersisted = false;
  room.racePhase = "starting";
  room.raceStartingAtMs = now + RACE_START_COUNTDOWN_MS;
  room.raceStopped = false;
  room.raceStartedAtMs = 0;
  room.raceStoppedAtMs = 0;
  room.winnerPlayerId = null;
  room.lastInteractionAtMs = now;
  room.tick = 0;
  room.resultHistoryId = null;
  room.endedAtMs = 0;

  for (const player of Object.values(room.players)) {
    resetPlayerForNewRace(player);
    player.racePhase = "starting";
  }
}

function rebalanceLanes(room: GameRoomStateRecord) {
  const ordered = rosterPlayers(room);
  for (let index = 0; index < ordered.length; index += 1) {
    ordered[index].laneIndex = index % MAX_MAX_PLAYERS;
  }
}

function buildHistoryId(roomId: string, raceStartedAtMs: number) {
  const base = `${roomId}-${raceStartedAtMs}`;
  return base.length <= 64 ? base : base.slice(0, 64);
}

function stopRace(room: GameRoomStateRecord, winner: PlayerStateRecord, now: number) {
  if (room.raceStopped) {
    return;
  }

  room.lastInteractionAtMs = now;
  room.racePhase = "finish";
  room.raceStartingAtMs = 0;
  room.raceStopped = true;
  room.raceStoppedAtMs = now;
  room.endedAtMs = now;
  room.winnerPlayerId = winner.playerId;
  room.resultHistoryId = room.resultHistoryId ?? buildHistoryId(room.roomId, room.raceStartedAtMs);
  if (room.teacherSessionId) {
    room.isListed = false;
    room.isLocked = true;
  }

  for (const player of Object.values(room.players)) {
    if (player.racePhase === "active" || player.racePhase === "starting") {
      player.racePhase = "finish";
      player.speedMps = 0;
      player.boostUntilMs = 0;
      player.boostSpeedMps = player.baseSpeedMps;
    }
    player.pendingQuestion = null;
    player.pendingDecisionPoint = null;
    player.highwayChallengeActive = false;
  }
}

function updatePlayerMovement(room: GameRoomStateRecord, player: PlayerStateRecord, deltaSeconds: number, now: number) {
  if (room.raceStopped || !isRaceActive(room.racePhase) || player.finished || player.racePhase !== "active") {
    return null;
  }
  if (room.teacherSessionId) {
    return null;
  }

  const safeDt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0.05;
  player.speedMps = Math.max(0, sanitizeFinite(player.speedMps, player.baseSpeedMps));

  const boosted = now < player.boostUntilMs;
  let targetSpeed = boosted ? player.boostSpeedMps : player.baseSpeedMps;
  targetSpeed = Math.max(0, sanitizeFinite(targetSpeed, BASE_SPEED_MPS));
  if (!boosted) {
    player.boostSpeedMps = player.baseSpeedMps;
  }

  if (player.speedMps < targetSpeed) {
    const accel = boosted ? BOOST_ACCEL_MPS2 : BASE_ACCEL_MPS2;
    player.speedMps = Math.min(targetSpeed, player.speedMps + (accel * safeDt));
  } else if (player.speedMps > targetSpeed) {
    player.speedMps = Math.max(targetSpeed, player.speedMps - (DRAG_MPS2 * safeDt));
  }
  player.maxSpeedMps = Math.max(player.maxSpeedMps ?? 0, player.speedMps);

  const trackLength = room.trackLengthMeters;
  const totalRaceDistance = room.totalLaps * trackLength;
  const currentDistance = (Math.max(0, Math.min(room.totalLaps, player.lap)) * trackLength)
    + Math.max(0, Math.min(trackLength, player.positionMeters));
  const travelDistance = Math.max(0, player.speedMps * safeDt);
  const nextDistance = currentDistance + travelDistance;

  if (nextDistance >= totalRaceDistance) {
    player.lap = room.totalLaps;
    player.finished = true;
    player.positionMeters = trackLength;
    player.pendingQuestion = null;
    player.pendingDecisionPoint = null;
    player.highwayChallengeActive = false;

    const tickWindowMs = Math.max(1, Math.round(safeDt * 1000));
    const remainingDistance = Math.max(0, totalRaceDistance - currentDistance);
    const ratioWithinTick = travelDistance > 0 ? Math.min(1, remainingDistance / travelDistance) : 1;
    const crossedAtMs = now - tickWindowMs + Math.round(ratioWithinTick * tickWindowMs);
    return {
      player,
      crossedAtMs
    };
  }

  const lap = Math.floor(nextDistance / trackLength);
  const lapStart = lap * trackLength;
  player.lap = lap;
  player.positionMeters = nextDistance - lapStart;
  return null;
}

function refreshExpiredQuestion(room: GameRoomStateRecord, player: PlayerStateRecord, now: number) {
  void room;
  void player;
  void now;
  return false;
}

function clearExpiredDecision(room: GameRoomStateRecord, player: PlayerStateRecord, now: number) {
  if (
    room.raceStopped
    || !isRaceActive(room.racePhase)
    || player.racePhase !== "active"
    || !player.pendingDecisionPoint
    || now <= player.pendingDecisionPoint.expiresAtMs
  ) {
    return;
  }

  player.pendingDecisionPoint = null;
  player.highwayChallengeActive = false;

  if (!player.pendingQuestion && !player.finished) {
    const result = chooseRoute(getPlayerQuestionState(player), "DIRT_ROAD", now);
    setPlayerQuestionState(player, result.state);
    syncPendingQuestionFromState(player);
  }
  return true;
}

function pruneInactivePlayers(room: GameRoomStateRecord, presenceByPlayerId: PresenceByPlayerId, now: number, presenceDeletes: GameRoomPresenceDelete[]) {
  let removedWinner = false;
  let removedCreator = false;
  let removedAnyPlayers = false;
  for (const [playerId, player] of Object.entries(room.players)) {
    const presence = presenceByPlayerId[playerId] ?? null;
    const isStale = player.session && (
      presence
        ? presence.sessionId !== player.session.sessionId || !isFreshPresence(presence, now)
        : !isFreshSession(player.session, now)
    );
    if (isStale) {
      player.connected = false;
      player.disconnectedAtMs = player.disconnectedAtMs || now;
      player.session = null;
      presenceDeletes.push({ roomId: room.roomId, playerId });
      removedAnyPlayers = true;
    }
  }

  if (removedWinner) {
    room.winnerPlayerId = null;
  }
  if (removedCreator) {
    room.roomCreatorPlayerId = pickRoomHost(room);
  }

  if (removedAnyPlayers) {
    room.roomSettings = normalizeRoomSettings(
      room.roomId,
      room.roomSettings,
      Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length || MIN_MAX_PLAYERS)
    );
    rebalanceLanes(room);
  }

  return removedAnyPlayers || removedWinner || removedCreator;
}

function advanceRoomToNow(room: GameRoomStateRecord, presenceByPlayerId: PresenceByPlayerId, now: number): AdvanceRoomResult {
  const presenceDeletes: GameRoomPresenceDelete[] = [];
  let persist = pruneInactivePlayers(room, presenceByPlayerId, now, presenceDeletes);
  hydratePlayerRacePhases(room);
  persist = hydrateRoomSetup(room) || persist;

  if (Object.keys(room.players).length === 0) {
    room.roomCreatorPlayerId = null;
    resetRoomForNewRace(room, now);
    room.lastInteractionAtMs = now;
    return { persist: true, presenceDeletes };
  }

  if (allPlayersInLobby(room) && room.racePhase !== "lobby") {
    resetRoomForNewRace(room, now);
    return { persist: true, presenceDeletes };
  }

  if (
    room.racePhase !== "lobby"
    && !anyPlayersActivelyRacing(room)
    && anyPlayersWaitingInLobby(room)
  ) {
    resetRoomForNewRace(room, now);
    return { persist: true, presenceDeletes };
  }

  if (room.racePhase === "lobby") {
    return { persist, presenceDeletes };
  }

  if (room.racePhase === "starting") {
    if (!Object.values(room.players).some((player) => player.racePhase === "starting")) {
      resetRoomForNewRace(room, now);
      return { persist: true, presenceDeletes };
    }
    const startAtMs = room.raceStartingAtMs || now;
    if (now < startAtMs) {
      return { persist, presenceDeletes };
    }
    activateRace(room, startAtMs);
    persist = true;
  }

  if (!isRaceActive(room.racePhase)) {
    return { persist, presenceDeletes };
  }

  if (now <= room.lastInteractionAtMs) {
    return { persist, presenceDeletes };
  }

  let cursor = room.lastInteractionAtMs;
  let remainingMs = now - room.lastInteractionAtMs;
  while (remainingMs > 0) {
    const stepMs = Math.min(remainingMs, MAX_ADVANCE_STEP_MS);
    const stepNow = cursor + stepMs;
    const deltaSeconds = Math.max(0.01, stepMs / 1000);
    room.tick += 1;

    let winnerCandidate: { player: PlayerStateRecord; crossedAtMs: number } | null = null;
    for (const player of Object.values(room.players)) {
      const finishCandidate = updatePlayerMovement(room, player, deltaSeconds, stepNow);
      if (finishCandidate) {
        if (!winnerCandidate) {
          winnerCandidate = finishCandidate;
        } else if (
          finishCandidate.crossedAtMs < winnerCandidate.crossedAtMs
          || (
            finishCandidate.crossedAtMs === winnerCandidate.crossedAtMs
            && finishCandidate.player.playerId.localeCompare(winnerCandidate.player.playerId) < 0
          )
        ) {
          winnerCandidate = finishCandidate;
        }
      }
      if (!room.raceStopped) {
        persist = refreshExpiredQuestion(room, player, stepNow) || persist;
        persist = clearExpiredDecision(room, player, stepNow) || persist;
      }
    }

    if (!room.raceStopped && winnerCandidate) {
      stopRace(room, winnerCandidate.player, winnerCandidate.crossedAtMs);
      persist = true;
    }

    cursor = stepNow;
    remainingMs -= stepMs;
  }

  if (persist) {
    room.lastInteractionAtMs = now;
  }
  return { persist, presenceDeletes };
}

function buildStateUpdate(room: GameRoomStateRecord, now: number): GameStateUpdateMessage {
  const players = rosterPlayers(room).map<PlayerSnapshot>((player) => {
    const safeLap = Math.max(0, Math.min(room.totalLaps, player.lap));
    const safePosition = player.finished
      ? room.trackLengthMeters
      : Math.max(0, Math.min(room.trackLengthMeters, sanitizeFinite(player.positionMeters, 0)));
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      joinedAtMs: getPlayerJoinedAtMs(player),
      laneIndex: Math.max(0, Math.min(MAX_MAX_PLAYERS - 1, Math.trunc(player.laneIndex))),
      positionMeters: round(safePosition),
      speedMps: round(Math.max(0, sanitizeFinite(player.speedMps, 0))),
      lap: safeLap,
      finished: player.finished,
      racePhase: normalizeStoredPlayerRacePhase(player, room),
      carId: normalizeCarId(player.carId),
      ready: Boolean(player.ready),
      connected: player.connected !== false && Boolean(player.session),
      disconnectedAtMs: Math.max(0, Math.trunc(player.disconnectedAtMs ?? 0)),
      correctAnswers: Math.max(0, Math.trunc(player.correctAnswers ?? 0)),
      wrongAnswers: Math.max(0, Math.trunc(player.wrongAnswers ?? 0)),
      timeoutAnswers: Math.max(0, Math.trunc(player.timeoutAnswers ?? 0)),
      score: Math.trunc(player.score ?? 0),
      routeMode: player.questionState?.routeMode ?? "NORMAL",
      streak: Math.max(0, Math.trunc(player.correctStreak ?? 0)),
      averageAnswerTimeMs: (player.answerCount ?? 0) > 0
        ? Math.round(Math.max(0, player.totalAnswerTimeMs ?? 0) / Math.max(1, player.answerCount ?? 1))
        : 0,
      routeStats: player.routeStats ?? {},
      maxSpeedMps: Math.max(0, player.maxSpeedMps ?? player.speedMps ?? 0)
    };
  });

  return {
    roomId: room.roomId,
    lifecycleStatus: roomLifecycleStatus(room),
    serverTimeMs: now,
    tick: room.tick,
    racePhase: room.racePhase,
    raceStartingAtMs: room.raceStartingAtMs,
    raceStartedAtMs: room.raceStartedAtMs,
    raceStopped: room.raceStopped,
    raceStoppedAtMs: room.raceStoppedAtMs,
    winnerPlayerId: room.winnerPlayerId,
    roomCreatorPlayerId: room.teacherSessionId ? "" : (pickRoomHost(room) ?? ""),
    roomSettings: room.roomSettings,
    trackLengthMeters: room.trackLengthMeters,
    players
  };
}

function buildJoinMessage(room: GameRoomStateRecord, player: PlayerStateRecord): RoomJoinedMessage {
  return {
    roomId: room.roomId,
    targetPlayerId: player.playerId,
    displayName: player.displayName,
    trackLengthMeters: room.trackLengthMeters,
    totalLaps: room.totalLaps,
    baseSpeedMps: BASE_SPEED_MPS,
    roomCreatorPlayerId: room.roomCreatorPlayerId ?? (room.teacherSessionId ? "" : player.playerId),
    roomSettings: room.roomSettings,
    carId: normalizeCarId(player.carId)
  };
}

function touchSession(player: PlayerStateRecord, now: number) {
  if (player.session) {
    player.session.lastSeenAtMs = now;
  }
}

function rejectUnauthorized(roomId: string, playerId: string) {
  return errorResponse(
    "SESSION_NOT_AUTHORIZED",
    "The active session is no longer authorized for this player. Rejoin the race.",
    roomId,
    playerId
  );
}

function ensureAuthorizedPlayer(
  room: GameRoomStateRecord,
  playerId: string,
  sessionId: string,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
) {
  const player = room.players[playerId] ?? null;
  const presence = presenceByPlayerId[playerId] ?? null;
  if (
    !player
    || !player.session
    || player.session.sessionId !== sessionId
    || (
      presence
        ? presence.sessionId !== sessionId || !isFreshPresence(presence, now)
        : !isFreshSession(player.session, now)
    )
  ) {
    return null;
  }

  return player;
}

function buildResponseForPlayer(room: GameRoomStateRecord, player: PlayerStateRecord, now: number): GameFunctionResponse {
  const prompt = currentPrompt(room, player, now);
  return {
    stateUpdate: buildStateUpdate(room, now),
    question: prompt.question,
    decision: prompt.decision,
    error: null
  };
}

export function joinRoom(
  existingRoom: GameRoomStateRecord | null,
  request: JoinGameRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  const room = existingRoom ?? createRoomState(request.roomId, now);
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);

  let player = room.players[request.playerId] ?? null;
  const joinPhase = room.racePhase;
  const isExistingMember = Boolean(player);
  if (!isExistingMember && room.removedPlayerIds?.[request.playerId]) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("PLAYER_REMOVED", "You were removed from the room by the teacher.", room.roomId, request.playerId)
    };
  }
  if (!isExistingMember && room.deletedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_DELETED", "This room is no longer available.", room.roomId, request.playerId)
    };
  }
  if (!isExistingMember && room.closedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_CLOSED", "This room was closed by the teacher.", room.roomId, request.playerId)
    };
  }
  if (!isExistingMember && room.isLocked) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_LOCKED", "Registration is locked for this room.", room.roomId, request.playerId)
    };
  }
  if (!isExistingMember && joinPhase === "finish") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse(
        "ROOM_MEMBERSHIP_LOCKED",
        "Join rejected: this classroom race has finished.",
        room.roomId,
        request.playerId
      )
    };
  }
  if (!isExistingMember && (joinPhase === "active" || joinPhase === "starting") && room.allowMidGameJoin === false) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse(
        "ROOM_ALREADY_STARTED",
        "This classroom race has already started.",
        room.roomId,
        request.playerId
      )
    };
  }

  if (!isExistingMember && Object.keys(room.players).length >= room.roomSettings.maxPlayers) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse(
        "ROOM_FULL",
        "Join rejected: this classroom race is already full.",
        room.roomId,
        request.playerId
      )
    };
  }

  const currentPresence = presenceByPlayerId[request.playerId] ?? null;
  if (
    player?.session
    && player.session.sessionId !== request.sessionId
    && (
      currentPresence
        ? currentPresence.sessionId === player.session.sessionId && isFreshPresence(currentPresence, now)
        : isFreshSession(player.session, now)
    )
  ) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse(
        "BIND_REJECTED",
        "Player is already bound to another active session.",
        room.roomId,
        request.playerId
      )
    };
  }

  if (player?.session && player.session.sessionId === request.sessionId) {
    if ((now - player.session.lastJoinAtMs) < JOIN_RATE_LIMIT_MS) {
      return {
        persist: false,
        room,
        presenceDeletes: advanceResult.presenceDeletes,
        response: errorResponse(
          "JOIN_RATE_LIMITED",
          "Join rejected: too many requests. Please retry in a moment.",
          room.roomId,
          request.playerId
        )
      };
    }
  }

  const displayName = normalizeDisplayName(request.displayName, request.playerId);
  if (!player) {
    player = createPlayerState(request.playerId, displayName, Object.keys(room.players).length % MAX_MAX_PLAYERS, now, request.carId);
    if (room.racePhase === "active" || room.racePhase === "starting") {
      player.racePhase = room.racePhase;
    }
    room.players[player.playerId] = player;
  } else {
    player.displayName = displayName;
    player.carId = normalizeCarId(request.carId);
    if (room.racePhase === "active" || room.racePhase === "starting") {
      player.racePhase = player.finished ? "finish" : room.racePhase;
    }
  }

  room.roomCreatorPlayerId = pickRoomHost(room);
  room.roomSettings = normalizeRoomSettings(room.roomId, room.roomSettings, Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length));

  player.session = buildSession(player.session, request.sessionId, now);
  player.connected = true;
  player.disconnectedAtMs = 0;
  player.session.lastJoinAtMs = now;
  touchSession(player, now);
  room.lastInteractionAtMs = now;

  if (room.racePhase === "active" && player.racePhase === "active") {
    if (player.pendingDecisionPoint && now > player.pendingDecisionPoint.expiresAtMs) {
      player.pendingDecisionPoint = null;
    }
    if (!player.pendingQuestion || now > player.pendingQuestion.expiresAtMs) {
      issueNewQuestion(room, player, 1, false, now);
    }
  } else {
    player.pendingQuestion = null;
    player.pendingDecisionPoint = null;
  }

  const prompt = currentPrompt(room, player, now);
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
    profile: {
      id: player.playerId,
      display_name: player.displayName
    },
    response: {
      joined: buildJoinMessage(room, player),
      stateUpdate: buildStateUpdate(room, now),
      question: prompt.question,
      decision: prompt.decision,
      error: null
    }
  };
}

export function startRace(
  existingRoom: GameRoomStateRecord | null,
  request: { roomId: string; playerId: string; sessionId: string },
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId, request.playerId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (room.deletedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_DELETED", "This room is no longer available.", room.roomId, request.playerId)
    };
  }
  if (room.closedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_CLOSED", "This room was closed by the teacher.", room.roomId, request.playerId)
    };
  }
  if (room.removedPlayerIds?.[request.playerId]) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("PLAYER_REMOVED", "You were removed from the room by the teacher.", room.roomId, request.playerId)
    };
  }
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  const roomHostPlayerId = pickRoomHost(room);
  if (roomHostPlayerId && roomHostPlayerId !== player.playerId) {
    return {
      persist: false,
      room,
      response: {
        ...buildResponseForPlayer(room, player, now),
        error: {
          code: "ROOM_HOST_ONLY",
          message: "Only the room host can start the race.",
          roomId: room.roomId,
          playerId: request.playerId
        }
      }
    };
  }

  if (room.racePhase !== "lobby" || !allPlayersInLobby(room)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: {
        ...buildResponseForPlayer(room, player, now),
        error: {
          code: "ROOM_NOT_READY",
          message: "Race can only start when all room members are back in the lobby.",
          roomId: room.roomId,
          playerId: request.playerId
        }
      }
    };
  }

  scheduleRaceStart(room, now);
  touchSession(player, now);
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
    response: buildResponseForPlayer(room, player, now)
  };
}

export function syncRoom(
  existingRoom: GameRoomStateRecord | null,
  request: { roomId: string; playerId: string; sessionId: string },
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId, request.playerId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (room.deletedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_DELETED", "This room is no longer available.", room.roomId, request.playerId)
    };
  }
  if (room.closedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_CLOSED", "This room was closed by the teacher.", room.roomId, request.playerId)
    };
  }
  if (room.removedPlayerIds?.[request.playerId]) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("PLAYER_REMOVED", "You were removed from the room by the teacher.", room.roomId, request.playerId)
    };
  }
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (advanceResult.persist) {
    touchSession(player, now);
  }

  return {
    persist: advanceResult.persist,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: shouldPersistPresenceHeartbeat(
      presenceByPlayerId,
      room.roomId,
      player.playerId,
      request.sessionId,
      now
    )
      ? [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)]
      : [],
    response: buildResponseForPlayer(room, player, now)
  };
}

function buildAnswerFeedback(
  roomId: string,
  playerId: string,
  accepted: boolean,
  correct: boolean,
  extra: Partial<AnswerFeedbackMessage> = {}
): AnswerFeedbackMessage {
  return {
    roomId,
    targetPlayerId: playerId,
    accepted,
    correct,
    ...extra
  };
}

function getPlayerProgressMeters(room: GameRoomStateRecord, player: PlayerStateRecord) {
  if (room.teacherSessionId) {
    return Math.max(0, Math.trunc(player.score ?? 0));
  }
  return (Math.max(0, Math.min(room.totalLaps, player.lap)) * room.trackLengthMeters)
    + Math.max(0, Math.min(room.trackLengthMeters, sanitizeFinite(player.positionMeters, 0)));
}

function setPlayerProgressMeters(room: GameRoomStateRecord, player: PlayerStateRecord, progressMeters: number) {
  const finishThreshold = room.teacherSessionId
    ? Math.max(1, Math.trunc(room.targetScore ?? room.roomSettings.targetScore ?? DEFAULT_TARGET_SCORE))
    : Math.max(1, Math.trunc(room.trackLengthMeters * room.totalLaps));
  const clamped = Math.max(0, Math.min(finishThreshold, sanitizeFinite(progressMeters, 0)));
  if (room.teacherSessionId) {
    player.score = Math.trunc(clamped);
    player.lap = clamped >= finishThreshold ? room.totalLaps : 0;
    player.positionMeters = clamped;
    if (clamped >= finishThreshold) {
      player.finished = true;
    }
    return clamped;
  }
  player.lap = Math.min(room.totalLaps, Math.floor(clamped / room.trackLengthMeters));
  player.positionMeters = player.lap >= room.totalLaps
    ? room.trackLengthMeters
    : clamped - (player.lap * room.trackLengthMeters);
  if (clamped >= finishThreshold) {
    player.lap = room.totalLaps;
    player.positionMeters = room.trackLengthMeters;
    player.finished = true;
  }
  return clamped;
}

function applyProgressDelta(room: GameRoomStateRecord, player: PlayerStateRecord, progressDelta: number) {
  return setPlayerProgressMeters(room, player, getPlayerProgressMeters(room, player) + progressDelta);
}

export function submitAnswer(
  existingRoom: GameRoomStateRecord | null,
  request: AnswerSubmissionRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId, request.playerId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (room.deletedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_DELETED", "This room is no longer available.", room.roomId, request.playerId)
    };
  }
  if (room.closedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_CLOSED", "This room was closed by the teacher.", room.roomId, request.playerId)
    };
  }
  if (room.removedPlayerIds?.[request.playerId]) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("PLAYER_REMOVED", "You were removed from the room by the teacher.", room.roomId, request.playerId)
    };
  }
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (player.session && (now - player.session.lastAnswerAtMs) < ANSWER_RATE_LIMIT_MS) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: buildResponseForPlayer(room, player, now)
    };
  }

  if (player.finished || room.raceStopped || !isRaceActive(room.racePhase) || player.racePhase !== "active") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }

  const activeDecision = player.pendingDecisionPoint;
  if (activeDecision && now <= activeDecision.expiresAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }
  if (activeDecision && now > activeDecision.expiresAtMs) {
    player.pendingDecisionPoint = null;
  }

  if (!player.pendingQuestion) {
    if (player.session) {
      player.session.lastAnswerAtMs = now;
    }
    touchSession(player, now);
    room.lastInteractionAtMs = now;
    issueNewQuestion(room, player, 1, false, now);
    return {
      persist: true,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }

  const pending = player.pendingQuestion;
  const expectedQuestion = pending.question.id === request.questionId;
  if (!expectedQuestion) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }

  if (player.session) {
    player.session.lastAnswerAtMs = now;
  }
  touchSession(player, now);
  room.lastInteractionAtMs = now;

  const questionState = getPlayerQuestionState(player);
  if (hasAnsweredQuestion(questionState, pending.question.id)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }

  const timeoutRequestedBeforeExpiry = Boolean(request.timeout) && now < pending.question.expiresAtMs;
  if (timeoutRequestedBeforeExpiry) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: buildResponseForPlayer(room, player, now)
    };
  }

  const validation = validateAnswer(pending.question, request.answer, now);
  const resultType: QuestionResultType = validation.resultType;
  const correct = validation.correct;
  const score = scoreAnswer(pending.question, resultType);
  const answeredInMs = Math.max(
    0,
    Math.min(
      pending.question.timeLimitSeconds * 1000,
      (pending.question.timeLimitSeconds * 1000) - Math.max(0, pending.question.expiresAtMs - now)
    )
  );
  player.answerCount = Math.max(0, player.answerCount ?? 0) + 1;
  player.totalAnswerTimeMs = Math.max(0, player.totalAnswerTimeMs ?? 0) + answeredInMs;
  player.routeStats = {
    ...(player.routeStats ?? {}),
    [pending.question.routeMode]: Math.max(0, player.routeStats?.[pending.question.routeMode] ?? 0) + 1
  };
  player.maxSpeedMps = Math.max(player.maxSpeedMps ?? 0, player.speedMps ?? 0);
  const updatedProgress = applyProgressDelta(room, player, score.progressDelta);

  if (resultType === "CORRECT") {
    player.correctAnswers = Math.max(0, player.correctAnswers ?? 0) + 1;
    let boostDuration = BASE_BOOST_DURATION_MS;
    let boostMultiplier = pending.question.routeMode === "HIGHWAY" ? 1.6 : pending.question.routeMode === "DIRT_ROAD" ? 0.85 : 1;
    if (pending.question.routeMode === "HIGHWAY") {
      boostDuration += HIGHWAY_SUPER_BOOST_MS;
      player.highwayChallengeActive = false;
    }
    applyBoost(player, boostMultiplier, boostDuration, now);
  } else if (resultType === "TIMEOUT") {
    player.timeoutAnswers = Math.max(0, player.timeoutAnswers ?? 0) + 1;
    player.highwayChallengeActive = false;
    player.speedMps = Math.max(MIN_SPEED_MPS, player.speedMps - TIMEOUT_ANSWER_SPEED_PENALTY_MPS);
  } else {
    player.wrongAnswers = Math.max(0, player.wrongAnswers ?? 0) + 1;
    player.highwayChallengeActive = false;
    player.speedMps = Math.max(MIN_SPEED_MPS, player.speedMps - WRONG_ANSWER_SPEED_PENALTY_MPS);
  }

  const advanced = advanceQuestionStateAfterAnswer(questionState, pending.question, resultType, now, getRoomQuestionDifficulty(room));
  setPlayerQuestionState(player, advanced.state);
  syncPendingQuestionFromState(player);

  let decision: DecisionPointMessage | null = null;
  if (advanced.routeChoice) {
    player.pendingDecisionPoint = {
      eventId: advanced.routeChoice.id,
      prompt: advanced.routeChoice.prompt,
      options: [HIGHWAY_CHOICE, DIRT_CHOICE],
      expiresAtMs: advanced.routeChoice.expiresAtMs
    };
    decision = toDecisionMessage(room.roomId, player, player.pendingDecisionPoint);
  } else {
    player.pendingDecisionPoint = null;
  }

  if (player.finished && !room.raceStopped) {
    stopRace(room, player, now);
  }
  const terminalClassroomFinish = Boolean(
    room.teacherSessionId
    && (room.raceStopped || room.racePhase === "finish" || player.finished || roomLifecycleStatus(room) === "FINISHED")
  );

  const prompt = currentPrompt(room, player, now);
  const answerEvent = resultType === "CORRECT"
    ? "ANSWER_CORRECT"
    : resultType === "WRONG"
      ? "ANSWER_WRONG"
      : "ANSWER_TIMEOUT";
  return {
    persist: true,
    room,
    skipClassroomSync: !terminalClassroomFinish,
    roomEvents: [
      {
        eventType: answerEvent,
        payload: {
          playerId: player.playerId,
          questionId: pending.question.id,
          pointsDelta: score.pointsDelta,
          progressDelta: score.progressDelta,
          routeMode: pending.question.routeMode
        }
      },
      ...advanced.events.map((eventType) => ({
        eventType,
        payload: { playerId: player.playerId }
      }))
    ],
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: prompt.question,
      decision: decision ?? prompt.decision,
      answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, true, correct, {
        resultType,
        feedback: score.feedback,
        pointsDelta: score.pointsDelta,
        progressDelta: score.progressDelta,
        updatedProgress,
        streak: player.correctStreak,
        submittedAnswer: validation.submittedAnswer,
        expectedAnswer: validation.expectedAnswer
      }),
      error: null
    }
  };
}

export function submitDecision(
  existingRoom: GameRoomStateRecord | null,
  request: DecisionChoiceRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId, request.playerId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (room.deletedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_DELETED", "This room is no longer available.", room.roomId, request.playerId)
    };
  }
  if (room.closedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_CLOSED", "This room was closed by the teacher.", room.roomId, request.playerId)
    };
  }
  if (room.removedPlayerIds?.[request.playerId]) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("PLAYER_REMOVED", "You were removed from the room by the teacher.", room.roomId, request.playerId)
    };
  }
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (player.session && (now - player.session.lastDecisionAtMs) < DECISION_RATE_LIMIT_MS) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: buildResponseForPlayer(room, player, now)
    };
  }

  if (player.finished || room.raceStopped || !isRaceActive(room.racePhase) || player.racePhase !== "active") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: buildResponseForPlayer(room, player, now)
    };
  }

  const point = player.pendingDecisionPoint;
  if (!point || point.eventId !== request.eventId || now > point.expiresAtMs) {
    const recoveredExpiredDecision = now > (point?.expiresAtMs ?? 0);
    if (now > (point?.expiresAtMs ?? 0)) {
      player.pendingDecisionPoint = null;
      if (!player.pendingQuestion) {
        const result = chooseRoute(getPlayerQuestionState(player), "DIRT_ROAD", now);
        setPlayerQuestionState(player, result.state);
        syncPendingQuestionFromState(player);
      }
    }
    return {
      persist: recoveredExpiredDecision,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: buildResponseForPlayer(room, player, now)
    };
  }

  if (player.session) {
    player.session.lastDecisionAtMs = now;
  }
  touchSession(player, now);
  room.lastInteractionAtMs = now;

  player.pendingDecisionPoint = null;
  player.decisionCooldownUntilMs = now + DECISION_COOLDOWN_MS;

  if (request.choice === HIGHWAY_CHOICE) {
    player.highwayChallengeActive = true;
    const result = chooseRoute(getPlayerQuestionState(player), "HIGHWAY", now);
    setPlayerQuestionState(player, result.state);
    syncPendingQuestionFromState(player);
  } else if (request.choice === DIRT_CHOICE) {
    player.highwayChallengeActive = false;
    const result = chooseRoute(getPlayerQuestionState(player), "DIRT_ROAD", now);
    setPlayerQuestionState(player, result.state);
    syncPendingQuestionFromState(player);
  } else {
    player.pendingDecisionPoint = point;
  }

  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
    response: buildResponseForPlayer(room, player, now)
  };
}

export function leaveRoom(
  existingRoom: GameRoomStateRecord | null,
  request: { roomId: string; playerId: string; sessionId: string },
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: { question: null, decision: null, error: null }
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: { question: null, decision: null, error: null }
    };
  }

  player.connected = false;
  player.disconnectedAtMs = now;
  player.session = null;
  room.roomSettings = normalizeRoomSettings(room.roomId, room.roomSettings, Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length || MIN_MAX_PLAYERS));
  if (!anyPlayersActivelyRacing(room)) {
    resetRoomForNewRace(room, now);
  }
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    presenceDeletes: [
      ...advanceResult.presenceDeletes,
      { roomId: room.roomId, playerId: request.playerId }
    ],
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function returnPlayerToLobby(
  existingRoom: GameRoomStateRecord | null,
  request: { roomId: string; playerId: string; sessionId: string },
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId, request.playerId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (room.teacherSessionId && (room.endedAtMs || room.raceStopped || room.racePhase === "finish")) {
    room.isListed = false;
    room.isLocked = true;
    room.endedAtMs = room.endedAtMs || now;
    touchSession(player, now);
    room.lastInteractionAtMs = now;
    return {
      persist: true,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
      response: buildResponseForPlayer(room, player, now)
    };
  }

  resetPlayerForNewRace(player);
  player.racePhase = "lobby";
  player.session = buildSession(player.session, request.sessionId, now);
  touchSession(player, now);
  room.lastInteractionAtMs = now;

  if (!anyPlayersActivelyRacing(room)) {
    resetRoomForNewRace(room, now);
  }

  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
    response: buildResponseForPlayer(room, player, now)
  };
}

export function updateRoomSettings(
  existingRoom: GameRoomStateRecord | null,
  request: UpdateRoomSettingsRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId, request.playerId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  const roomHostPlayerId = pickRoomHost(room);
  if (roomHostPlayerId && roomHostPlayerId !== player.playerId) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: {
        ...buildResponseForPlayer(room, player, now),
        error: {
          code: "ROOM_HOST_ONLY",
          message: "Only the room host can change teacher setup.",
          roomId: room.roomId,
          playerId: request.playerId
        }
      }
    };
  }

  if (room.racePhase !== "lobby") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: {
        ...buildResponseForPlayer(room, player, now),
        error: {
          code: "ROOM_SETTINGS_LOCKED",
          message: "Teacher setup can only be edited while the room is in the lobby.",
          roomId: room.roomId,
          playerId: request.playerId
        }
      }
    };
  }

  room.roomCreatorPlayerId = roomHostPlayerId ?? player.playerId;
  room.roomSettings = normalizeRoomSettings(
    room.roomId,
    request.roomSettings,
    Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length)
  );
  touchSession(player, now);
  room.lastInteractionAtMs = now;

  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
    response: buildResponseForPlayer(room, player, now)
  };
}

export function setPlayerReady(
  existingRoom: GameRoomStateRecord | null,
  request: SetReadyRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId, request.playerId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (room.deletedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_DELETED", "This room is no longer available.", room.roomId, request.playerId)
    };
  }
  if (room.closedAtMs) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_CLOSED", "This room was closed by the teacher.", room.roomId, request.playerId)
    };
  }
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, presenceByPlayerId, now);
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }
  if (room.racePhase !== "lobby") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("READY_LOCKED", "Ready status can only be changed before the race starts.", room.roomId, request.playerId)
    };
  }
  player.ready = Boolean(request.ready);
  touchSession(player, now);
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    presenceUpserts: [buildPresenceUpsert(room.roomId, player.playerId, request.sessionId, now)],
    response: buildResponseForPlayer(room, player, now)
  };
}

function ensureAuthorizedTeacher(room: GameRoomStateRecord, teacherSessionId: string) {
  return Boolean(room.teacherSessionId && teacherSessionId && room.teacherSessionId === teacherSessionId);
}

function teacherUnauthorized(roomId: string) {
  return errorResponse(
    "TEACHER_SESSION_NOT_AUTHORIZED",
    "Teacher session is not authorized for this room.",
    roomId
  );
}

export function teacherCreateRoom(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherCreateRoomRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  const room = existingRoom ?? createRoomState(request.roomId, now);
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);

  if (room.racePhase !== "lobby" && room.teacherSessionId && room.teacherSessionId !== request.teacherSessionId) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_IN_USE", "This teacher room is already active.", room.roomId)
    };
  }

  room.teacherSessionId = request.teacherSessionId;
  room.teacherLastSeenAtMs = now;
  room.isListed = true;
  room.isLocked = false;
  room.requiresApproval = false;
  room.className = typeof request.className === "string" ? request.className : request.roomSettings.classGroup ?? null;
  room.difficulty = request.roomSettings.difficulty ?? (typeof request.difficulty === "string" ? request.difficulty : "MEDIUM");
  room.mapId = request.roomSettings.mapId ?? (typeof request.mapId === "string" ? request.mapId : "sunny-forest");
  room.questionTypes = ["MIXED"];
  room.allowMidGameJoin = true;
  room.closedAtMs = 0;
  room.deletedAtMs = 0;
  room.endedAtMs = 0;
  room.roomSettings = normalizeRoomSettings(
    room.roomId,
    {
      ...request.roomSettings,
      classGroup: typeof request.className === "string" ? request.className : request.roomSettings.classGroup,
      difficulty: room.difficulty as RoomSettings["difficulty"],
      mapId: room.mapId ?? undefined,
      maxPlayers: MAX_MAX_PLAYERS,
      operations: "MIXED"
    },
    MAX_MAX_PLAYERS
  );
  room.targetScore = room.roomSettings.targetScore;
  room.trackLengthMeters = room.targetScore;
  room.totalLaps = 1;
  room.lastInteractionAtMs = now;

  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherSyncRoom(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRoomRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }

  room.teacherLastSeenAtMs = now;
  return {
    persist: advanceResult.persist,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherUpdateRoomSettings(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherUpdateRoomSettingsRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }
  if (room.racePhase !== "lobby") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_SETTINGS_LOCKED", "Teacher setup can only be edited while the room is in the lobby.", room.roomId)
    };
  }

  room.roomSettings = normalizeRoomSettings(
    room.roomId,
    { ...request.roomSettings, maxPlayers: MAX_MAX_PLAYERS, operations: "MIXED" },
    MAX_MAX_PLAYERS
  );
  room.className = room.roomSettings.classGroup ?? room.className ?? null;
  room.difficulty = room.roomSettings.difficulty ?? room.difficulty ?? "MEDIUM";
  room.mapId = room.roomSettings.mapId ?? room.mapId ?? "sunny-forest";
  room.targetScore = room.roomSettings.targetScore;
  room.trackLengthMeters = room.targetScore;
  room.totalLaps = 1;
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherStartRace(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRoomRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }
  const players = Object.values(room.players);
  if (players.length === 0 || room.racePhase !== "lobby") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("ROOM_NOT_READY", "Race can only start when students are in the lobby.", room.roomId)
    };
  }

  scheduleRaceStart(room, now);
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  room.isListed = true;
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherRemovePlayer(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRemovePlayerRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }

  room.removedPlayerIds = {
    ...(room.removedPlayerIds ?? {}),
    [request.targetPlayerId]: now
  };
  delete room.players[request.targetPlayerId];
  if (request.targetPlayerId === room.winnerPlayerId) {
    room.winnerPlayerId = null;
  }
  if (request.targetPlayerId === room.roomCreatorPlayerId) {
    room.roomCreatorPlayerId = pickRoomHost(room);
  }
  rebalanceLanes(room);
  room.roomSettings = normalizeRoomSettings(room.roomId, room.roomSettings, Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length || MIN_MAX_PLAYERS));
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  if (!room.teacherSessionId && !anyPlayersActivelyRacing(room)) {
    resetRoomForNewRace(room, now);
  }

  return {
    persist: true,
    room,
    presenceDeletes: [
      ...advanceResult.presenceDeletes,
      { roomId: room.roomId, playerId: request.targetPlayerId }
    ],
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherApprovePlayer(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRemovePlayerRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }
  if (room.racePhase !== "lobby") {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("APPROVAL_LOCKED", "Students can only be approved before the race starts.", room.roomId)
    };
  }
  const player = room.players[request.targetPlayerId];
  if (!player) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: errorResponse("PLAYER_NOT_FOUND", "Student is no longer in this room.", room.roomId)
    };
  }

  player.ready = true;
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  touchSession(player, now);
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherReturnToLobby(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRoomRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }

  resetRoomForNewRace(room, now);
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherFinishRoom(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRoomRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }

  room.racePhase = "finish";
  room.raceStartingAtMs = 0;
  room.raceStopped = true;
  room.raceStoppedAtMs = now;
  room.endedAtMs = now;
  room.isListed = false;
  room.isLocked = true;
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  room.winnerPlayerId = room.winnerPlayerId ?? sortedPlayers(room)[0]?.playerId ?? null;
  room.resultHistoryId = room.resultHistoryId ?? buildHistoryId(room.roomId, room.raceStartedAtMs);
  for (const player of Object.values(room.players)) {
    player.racePhase = "finish";
    player.pendingQuestion = null;
    player.pendingDecisionPoint = null;
    player.speedMps = 0;
  }

  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherCloseRoom(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRoomRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }

  room.closedAtMs = now;
  room.isListed = false;
  room.isLocked = true;
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function teacherDeleteRoom(
  existingRoom: GameRoomStateRecord | null,
  request: TeacherRoomRequest,
  presenceByPlayerId: PresenceByPlayerId,
  now: number
): RoomMutationResult {
  if (!existingRoom) {
    return {
      persist: false,
      room: null,
      response: errorResponse("ROOM_NOT_FOUND", "Race room not found.", request.roomId)
    };
  }

  const room = existingRoom;
  const advanceResult = advanceRoomToNow(room, presenceByPlayerId, now);
  if (!ensureAuthorizedTeacher(room, request.teacherSessionId)) {
    return {
      persist: false,
      room,
      presenceDeletes: advanceResult.presenceDeletes,
      response: teacherUnauthorized(room.roomId)
    };
  }

  room.deletedAtMs = now;
  room.closedAtMs = room.closedAtMs || now;
  room.isListed = false;
  room.isLocked = true;
  room.teacherLastSeenAtMs = now;
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    presenceDeletes: advanceResult.presenceDeletes,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: null,
      decision: null,
      error: null
    }
  };
}

export function buildRaceHistoryRow(room: GameRoomStateRecord): RaceHistoryRow | null {
  if (!room.winnerPlayerId) {
    return null;
  }

  const standings = sortedPlayers(room).map((player) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    lap: player.lap,
    positionMeters: player.positionMeters,
    speedMps: player.speedMps,
    finished: player.finished,
    score: Math.max(0, player.score ?? 0),
    correctAnswers: Math.max(0, player.correctAnswers ?? 0),
    wrongAnswers: Math.max(0, player.wrongAnswers ?? 0),
    timeoutAnswers: Math.max(0, player.timeoutAnswers ?? 0),
    averageAnswerTimeMs: (player.answerCount ?? 0) > 0
      ? Math.round(Math.max(0, player.totalAnswerTimeMs ?? 0) / Math.max(1, player.answerCount ?? 1))
      : 0,
    routeMode: player.questionState?.routeMode ?? "NORMAL",
    routeStats: player.routeStats ?? {},
    maxSpeedMps: Math.max(0, player.maxSpeedMps ?? player.speedMps ?? 0)
  }));

  return {
    id: room.resultHistoryId ?? buildHistoryId(room.roomId, room.raceStartedAtMs),
    room_id: room.roomId,
    winner_player_id: room.winnerPlayerId,
    total_players: Object.keys(room.players).length,
    total_laps: room.totalLaps,
    track_length_meters: room.trackLengthMeters,
    finished_at: new Date(room.raceStoppedAtMs || Date.now()).toISOString(),
    result_payload_json: JSON.stringify({
      roomId: room.roomId,
      tick: room.tick,
      createdAtMs: room.createdAtMs,
      raceStartedAtMs: room.raceStartedAtMs,
      raceStoppedAtMs: room.raceStoppedAtMs,
      mapId: room.mapId ?? room.roomSettings.mapId ?? null,
      standings
    })
  };
}
