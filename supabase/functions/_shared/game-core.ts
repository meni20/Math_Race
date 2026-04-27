import type {
  AnswerFeedbackMessage,
  AnswerSubmissionRequest,
  DecisionChoiceRequest,
  DecisionPointMessage,
  DecisionPointRecord,
  GameErrorMessage,
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
  RoomJoinedMessage,
  UpdateRoomSettingsRequest,
  RoomMutationResult
} from "./contracts.ts";
import { normalizeDisplayName } from "./input.ts";
import { generateQuestion } from "./question-generator.ts";

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
const STALE_SESSION_MS = 20000;
const JOIN_RATE_LIMIT_MS = 500;
const ANSWER_RATE_LIMIT_MS = 75;
const DECISION_RATE_LIMIT_MS = 120;
const MAX_ADVANCE_STEP_MS = 250;
const DEFAULT_TRACK_LENGTH_METERS = 3000;
const DEFAULT_TOTAL_LAPS = 1;
const RACE_START_COUNTDOWN_MS = 2600;
const HIGHWAY_CHOICE = "HIGHWAY";
const DIRT_CHOICE = "DIRT";
const DEFAULT_MAX_PLAYERS = 4;
const MIN_MAX_PLAYERS = 2;
const MAX_MAX_PLAYERS = 4;
const DEFAULT_RACE_DURATION_SECONDS = 180;
const MIN_RACE_DURATION_SECONDS = 60;
const MAX_RACE_DURATION_SECONDS = 600;
const DEFAULT_QUESTION_TIME_LIMIT_SECONDS = 8;
const MIN_QUESTION_TIME_LIMIT_SECONDS = 5;
const MAX_QUESTION_TIME_LIMIT_SECONDS = 20;

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
    questionTimeLimitSeconds: DEFAULT_QUESTION_TIME_LIMIT_SECONDS
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
    maxPlayers: clampInteger(
      Number(roomSettings?.maxPlayers ?? defaults.maxPlayers),
      defaults.maxPlayers,
      safeMinimumPlayers,
      MAX_MAX_PLAYERS
    ),
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
    )
  };
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

function getSortedPlayerIds(room: GameRoomStateRecord) {
  return Object.keys(room.players).sort((left, right) => left.localeCompare(right));
}

function pickNextRoomCreator(room: GameRoomStateRecord) {
  return getSortedPlayerIds(room)[0] ?? null;
}

function hydrateRoomSetup(room: GameRoomStateRecord) {
  room.roomSettings = normalizeRoomSettings(
    room.roomId,
    room.roomSettings,
    Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length || MIN_MAX_PLAYERS)
  );

  if (!room.roomCreatorPlayerId || !room.players[room.roomCreatorPlayerId]) {
    room.roomCreatorPlayerId = pickNextRoomCreator(room);
  }
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

function createPlayerState(playerId: string, displayName: string, laneIndex: number): PlayerStateRecord {
  return {
    playerId,
    displayName,
    laneIndex,
    positionMeters: 0,
    speedMps: BASE_SPEED_MPS,
    baseSpeedMps: BASE_SPEED_MPS,
    boostSpeedMps: BASE_SPEED_MPS,
    boostUntilMs: 0,
    lap: 0,
    finished: false,
    correctStreak: 0,
    pendingQuestion: null,
    pendingDecisionPoint: null,
    decisionCooldownUntilMs: 0,
    highwayChallengeActive: false,
    racePhase: "lobby",
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

function createPendingQuestion(
  room: GameRoomStateRecord,
  difficulty: number,
  highwayChallenge: boolean,
  now: number
): PendingQuestionRecord {
  const baseQuestion = generateQuestion(difficulty);
  const timeLimitMs = Math.max(
    MIN_QUESTION_TIME_LIMIT_SECONDS * 1000,
    room.roomSettings.questionTimeLimitSeconds * 1000
  );
  const question = {
    ...baseQuestion,
    timeLimitMs
  };
  return {
    question,
    expiresAtMs: now + question.timeLimitMs,
    fromHighwayChallenge: highwayChallenge
  };
}

function toQuestionMessage(roomId: string, player: PlayerStateRecord, pending: PendingQuestionRecord): QuestionMessage {
  return {
    roomId,
    targetPlayerId: player.playerId,
    questionId: pending.question.questionId,
    prompt: pending.question.prompt,
    difficulty: pending.question.difficulty,
    timeLimitMs: pending.question.timeLimitMs,
    expiresAtMs: pending.expiresAtMs,
    highwayChallenge: pending.fromHighwayChallenge
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

function issueNewQuestion(room: GameRoomStateRecord, player: PlayerStateRecord, difficulty: number, highwayChallenge: boolean, now: number) {
  player.pendingQuestion = createPendingQuestion(room, difficulty, highwayChallenge, now);
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
  if (player.pendingDecisionPoint || player.highwayChallengeActive) {
    return false;
  }
  if (now < player.decisionCooldownUntilMs) {
    return false;
  }
  return Math.random() < DECISION_TRIGGER_PROBABILITY;
}

function issueDecision(room: GameRoomStateRecord, player: PlayerStateRecord, now: number) {
  const point: DecisionPointRecord = {
    eventId: crypto.randomUUID(),
    prompt: "Choose route: HIGHWAY (hard question, huge boost) or DIRT (safe bonus).",
    options: [HIGHWAY_CHOICE, DIRT_CHOICE],
    expiresAtMs: now + DECISION_TTL_MS
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
  player.pendingQuestion = null;
  player.pendingDecisionPoint = null;
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

  for (const player of Object.values(room.players)) {
    resetPlayerForNewRace(player);
    player.racePhase = "starting";
  }
}

function rebalanceLanes(room: GameRoomStateRecord) {
  const ordered = Object.values(room.players).sort((left, right) => left.playerId.localeCompare(right.playerId));
  for (let index = 0; index < ordered.length; index += 1) {
    ordered[index].laneIndex = index % 4;
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
  room.winnerPlayerId = winner.playerId;
  room.resultHistoryId = room.resultHistoryId ?? buildHistoryId(room.roomId, room.raceStartedAtMs);

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
  if (
    room.raceStopped
    || !isRaceActive(room.racePhase)
    || player.racePhase !== "active"
    || !player.pendingQuestion
    || now <= player.pendingQuestion.expiresAtMs
  ) {
    return;
  }

  player.correctStreak = 0;
  player.highwayChallengeActive = false;
  player.speedMps = Math.max(MIN_SPEED_MPS, player.speedMps - TIMEOUT_ANSWER_SPEED_PENALTY_MPS);
  issueNewQuestion(room, player, 1, false, now);
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
    issueNewQuestion(room, player, 1, false, now);
  }
}

function pruneInactivePlayers(room: GameRoomStateRecord, now: number) {
  let removedWinner = false;
  for (const [playerId, player] of Object.entries(room.players)) {
    if (player.session && !isFreshSession(player.session, now)) {
      delete room.players[playerId];
      if (playerId === room.winnerPlayerId) {
        removedWinner = true;
      }
    }
  }

  if (removedWinner) {
    room.winnerPlayerId = null;
  }

  rebalanceLanes(room);
}

function advanceRoomToNow(room: GameRoomStateRecord, now: number) {
  pruneInactivePlayers(room, now);
  hydratePlayerRacePhases(room);
  hydrateRoomSetup(room);

  if (Object.keys(room.players).length === 0) {
    room.roomCreatorPlayerId = null;
    resetRoomForNewRace(room, now);
    room.lastInteractionAtMs = now;
    return;
  }

  if (allPlayersInLobby(room) && room.racePhase !== "lobby") {
    resetRoomForNewRace(room, now);
    return;
  }

  if (
    room.racePhase !== "lobby"
    && !anyPlayersActivelyRacing(room)
    && anyPlayersWaitingInLobby(room)
  ) {
    resetRoomForNewRace(room, now);
    return;
  }

  if (room.racePhase === "lobby") {
    room.lastInteractionAtMs = now;
    return;
  }

  if (room.racePhase === "starting") {
    if (!Object.values(room.players).some((player) => player.racePhase === "starting")) {
      resetRoomForNewRace(room, now);
      return;
    }
    const startAtMs = room.raceStartingAtMs || now;
    if (now < startAtMs) {
      room.lastInteractionAtMs = now;
      return;
    }
    activateRace(room, startAtMs);
  }

  if (!isRaceActive(room.racePhase)) {
    room.lastInteractionAtMs = now;
    return;
  }

  if (now <= room.lastInteractionAtMs) {
    room.lastInteractionAtMs = now;
    return;
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
        refreshExpiredQuestion(room, player, stepNow);
        clearExpiredDecision(room, player, stepNow);
      }
    }

    if (!room.raceStopped && winnerCandidate) {
      stopRace(room, winnerCandidate.player, winnerCandidate.crossedAtMs);
    }

    cursor = stepNow;
    remainingMs -= stepMs;
  }

  room.lastInteractionAtMs = now;
}

function buildStateUpdate(room: GameRoomStateRecord, now: number): GameStateUpdateMessage {
  const players = sortedPlayers(room).map<PlayerSnapshot>((player) => {
    const safeLap = Math.max(0, Math.min(room.totalLaps, player.lap));
    const safePosition = player.finished
      ? room.trackLengthMeters
      : Math.max(0, Math.min(room.trackLengthMeters, sanitizeFinite(player.positionMeters, 0)));
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      laneIndex: Math.max(0, Math.min(3, Math.trunc(player.laneIndex))),
      positionMeters: round(safePosition),
      speedMps: round(Math.max(0, sanitizeFinite(player.speedMps, 0))),
      lap: safeLap,
      finished: player.finished,
      racePhase: normalizeStoredPlayerRacePhase(player, room)
    };
  });

  return {
    roomId: room.roomId,
    serverTimeMs: now,
    tick: room.tick,
    racePhase: room.racePhase,
    raceStartingAtMs: room.raceStartingAtMs,
    raceStartedAtMs: room.raceStartedAtMs,
    raceStopped: room.raceStopped,
    raceStoppedAtMs: room.raceStoppedAtMs,
    winnerPlayerId: room.winnerPlayerId,
    roomCreatorPlayerId: room.roomCreatorPlayerId ?? "",
    roomSettings: room.roomSettings,
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
    roomCreatorPlayerId: room.roomCreatorPlayerId ?? player.playerId,
    roomSettings: room.roomSettings
  };
}

function markSeen(player: PlayerStateRecord, now: number) {
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
  now: number
) {
  const player = room.players[playerId] ?? null;
  if (!player || !player.session || player.session.sessionId !== sessionId || !isFreshSession(player.session, now)) {
    return null;
  }

  markSeen(player, now);
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
  now: number
): RoomMutationResult {
  const room = existingRoom ?? createRoomState(request.roomId, now);
  advanceRoomToNow(room, now);

  let player = room.players[request.playerId] ?? null;
  const joinPhase = room.racePhase;
  const isExistingMember = Boolean(player);
  if (!isExistingMember && joinPhase !== "lobby") {
    return {
      persist: false,
      room,
      response: errorResponse(
        "ROOM_MEMBERSHIP_LOCKED",
        `Join rejected: room is in ${joinPhase}. New players can only join while the room is in the lobby.`,
        room.roomId,
        request.playerId
      )
    };
  }

  if (!isExistingMember && Object.keys(room.players).length >= room.roomSettings.maxPlayers) {
    return {
      persist: false,
      room,
      response: errorResponse(
        "ROOM_FULL",
        "Join rejected: this classroom race is already full.",
        room.roomId,
        request.playerId
      )
    };
  }

  if (player?.session && player.session.sessionId !== request.sessionId && isFreshSession(player.session, now)) {
    return {
      persist: false,
      room,
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
    player = createPlayerState(request.playerId, displayName, Object.keys(room.players).length % 4);
    room.players[player.playerId] = player;
  } else {
    player.displayName = displayName;
  }

  if (!room.roomCreatorPlayerId) {
    room.roomCreatorPlayerId = player.playerId;
  }
  room.roomSettings = normalizeRoomSettings(room.roomId, room.roomSettings, Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length));

  player.session = buildSession(player.session, request.sessionId, now);
  player.session.lastJoinAtMs = now;
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
  advanceRoomToNow(room, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, now);
  if (!player) {
    return {
      persist: false,
      room,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (room.racePhase !== "lobby" || !allPlayersInLobby(room)) {
    return {
      persist: false,
      room,
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
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    response: buildResponseForPlayer(room, player, now)
  };
}

export function syncRoom(
  existingRoom: GameRoomStateRecord | null,
  request: { roomId: string; playerId: string; sessionId: string },
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
  advanceRoomToNow(room, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, now);
  if (!player) {
    return {
      persist: false,
      room,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
    response: buildResponseForPlayer(room, player, now)
  };
}

function buildAnswerFeedback(roomId: string, playerId: string, accepted: boolean, correct: boolean): AnswerFeedbackMessage {
  return {
    roomId,
    targetPlayerId: playerId,
    accepted,
    correct
  };
}

export function submitAnswer(
  existingRoom: GameRoomStateRecord | null,
  request: AnswerSubmissionRequest,
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
  advanceRoomToNow(room, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, now);
  if (!player) {
    return {
      persist: false,
      room,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (player.session && (now - player.session.lastAnswerAtMs) < ANSWER_RATE_LIMIT_MS) {
    return {
      persist: false,
      room,
      response: buildResponseForPlayer(room, player, now)
    };
  }
  if (player.session) {
    player.session.lastAnswerAtMs = now;
  }
  room.lastInteractionAtMs = now;

  if (player.finished || room.raceStopped || !isRaceActive(room.racePhase) || player.racePhase !== "active") {
    return {
      persist: true,
      room,
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }

  const activeDecision = player.pendingDecisionPoint;
  if (activeDecision && now <= activeDecision.expiresAtMs) {
    return {
      persist: true,
      room,
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
    issueNewQuestion(room, player, 1, false, now);
    return {
      persist: true,
      room,
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }

  const pending = player.pendingQuestion;
  const expectedQuestion = pending.question.questionId === request.questionId;
  if (!expectedQuestion) {
    return {
      persist: false,
      room,
      response: {
        ...buildResponseForPlayer(room, player, now),
        answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, false, false)
      }
    };
  }

  const notExpired = now <= (pending.expiresAtMs + ANSWER_GRACE_MS);
  const submittedAnswer = typeof request.answer === "string" ? request.answer.trim() : "";
  const correct = notExpired && submittedAnswer.toLowerCase() === pending.question.correctAnswer.trim().toLowerCase();

  if (correct) {
    player.correctStreak += 1;
    let boostDuration = BASE_BOOST_DURATION_MS;
    let boostMultiplier = pending.question.boostMultiplier;
    if (pending.fromHighwayChallenge) {
      player.positionMeters += HIGHWAY_TELEPORT_METERS;
      boostMultiplier *= 1.35;
      boostDuration += HIGHWAY_SUPER_BOOST_MS;
      player.highwayChallengeActive = false;
    }
    applyBoost(player, boostMultiplier, boostDuration, now);
  } else {
    player.correctStreak = 0;
    player.highwayChallengeActive = false;
    player.speedMps = Math.max(MIN_SPEED_MPS, player.speedMps - WRONG_ANSWER_SPEED_PENALTY_MPS);
  }

  player.pendingQuestion = null;

  let decision: DecisionPointMessage | null = null;
  if (correct && shouldOfferDecision(player, now)) {
    decision = issueDecision(room, player, now);
  } else {
    issueNewQuestion(room, player, calculateDifficulty(player, correct), false, now);
  }

  const prompt = currentPrompt(room, player, now);
  return {
    persist: true,
    room,
    response: {
      stateUpdate: buildStateUpdate(room, now),
      question: prompt.question,
      decision: decision ?? prompt.decision,
      answerFeedback: buildAnswerFeedback(room.roomId, player.playerId, true, correct),
      error: null
    }
  };
}

export function submitDecision(
  existingRoom: GameRoomStateRecord | null,
  request: DecisionChoiceRequest,
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
  advanceRoomToNow(room, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, now);
  if (!player) {
    return {
      persist: false,
      room,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (player.session && (now - player.session.lastDecisionAtMs) < DECISION_RATE_LIMIT_MS) {
    return {
      persist: false,
      room,
      response: buildResponseForPlayer(room, player, now)
    };
  }
  if (player.session) {
    player.session.lastDecisionAtMs = now;
  }
  room.lastInteractionAtMs = now;

  if (player.finished || room.raceStopped || !isRaceActive(room.racePhase) || player.racePhase !== "active") {
    return {
      persist: true,
      room,
      response: buildResponseForPlayer(room, player, now)
    };
  }

  const point = player.pendingDecisionPoint;
  if (!point || point.eventId !== request.eventId || now > point.expiresAtMs) {
    if (now > (point?.expiresAtMs ?? 0)) {
      player.pendingDecisionPoint = null;
      if (!player.pendingQuestion) {
        issueNewQuestion(room, player, 1, false, now);
      }
    }
    return {
      persist: true,
      room,
      response: buildResponseForPlayer(room, player, now)
    };
  }

  player.pendingDecisionPoint = null;
  player.decisionCooldownUntilMs = now + DECISION_COOLDOWN_MS;

  if (request.choice === HIGHWAY_CHOICE) {
    player.highwayChallengeActive = true;
    issueNewQuestion(room, player, 3, true, now);
  } else if (request.choice === DIRT_CHOICE) {
    player.highwayChallengeActive = false;
    applyBoost(player, 0.6, 1600, now);
    issueNewQuestion(room, player, Math.max(1, calculateDifficulty(player, true) - 1), false, now);
  } else {
    player.pendingDecisionPoint = point;
  }

  return {
    persist: true,
    room,
    response: buildResponseForPlayer(room, player, now)
  };
}

export function leaveRoom(
  existingRoom: GameRoomStateRecord | null,
  request: { roomId: string; playerId: string; sessionId: string },
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
  advanceRoomToNow(room, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, now);
  if (!player) {
    return {
      persist: false,
      room,
      response: { question: null, decision: null, error: null }
    };
  }

  delete room.players[request.playerId];
  if (request.playerId === room.winnerPlayerId) {
    room.winnerPlayerId = null;
  }
  if (request.playerId === room.roomCreatorPlayerId) {
    room.roomCreatorPlayerId = pickNextRoomCreator(room);
  }
  rebalanceLanes(room);
  room.roomSettings = normalizeRoomSettings(room.roomId, room.roomSettings, Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length || MIN_MAX_PLAYERS));
  if (!anyPlayersActivelyRacing(room)) {
    resetRoomForNewRace(room, now);
  }
  room.lastInteractionAtMs = now;
  return {
    persist: true,
    room,
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
  advanceRoomToNow(room, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, now);
  if (!player) {
    return {
      persist: false,
      room,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  resetPlayerForNewRace(player);
  player.racePhase = "lobby";
  player.session = buildSession(player.session, request.sessionId, now);
  room.lastInteractionAtMs = now;

  if (!anyPlayersActivelyRacing(room)) {
    resetRoomForNewRace(room, now);
  }

  return {
    persist: true,
    room,
    response: buildResponseForPlayer(room, player, now)
  };
}

export function updateRoomSettings(
  existingRoom: GameRoomStateRecord | null,
  request: UpdateRoomSettingsRequest,
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
  advanceRoomToNow(room, now);
  const player = ensureAuthorizedPlayer(room, request.playerId, request.sessionId, now);
  if (!player) {
    return {
      persist: false,
      room,
      response: rejectUnauthorized(room.roomId, request.playerId)
    };
  }

  if (room.roomCreatorPlayerId && room.roomCreatorPlayerId !== player.playerId) {
    return {
      persist: false,
      room,
      response: {
        ...buildResponseForPlayer(room, player, now),
        error: {
          code: "ROOM_CREATOR_ONLY",
          message: "Only the room creator can change teacher setup.",
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

  room.roomCreatorPlayerId = room.roomCreatorPlayerId ?? player.playerId;
  room.roomSettings = normalizeRoomSettings(
    room.roomId,
    request.roomSettings,
    Math.max(MIN_MAX_PLAYERS, Object.keys(room.players).length)
  );
  room.lastInteractionAtMs = now;

  return {
    persist: true,
    room,
    response: buildResponseForPlayer(room, player, now)
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
    finished: player.finished
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
      standings
    })
  };
}
