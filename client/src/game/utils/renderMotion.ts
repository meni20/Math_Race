import type { DecisionChoiceRequest, PlayerSnapshot, QuestionMessage } from "../types/messages";

const DEFAULT_BASE_SPEED_MPS = 42;
const MIN_SPEED_MPS = 18;
const BOOST_EXTRA_SPEED_MPS = 30;
const WRONG_ANSWER_SPEED_PENALTY_MPS = 7.5;
const HIGHWAY_TELEPORT_METERS = 240;
const HIGHWAY_BOOST_MULTIPLIER = 1.35;
const MAX_RENDER_FRAME_DELTA_SECONDS = 0.05;
const POSITION_CATCH_UP_RATE = 10;
const POSITION_CORRECTION_RATE = 16;
const SPEED_CATCH_UP_RATE = 12;
const SNAP_POSITION_DELTA_METERS = 160;
const SNAP_SPEED_DELTA_MPS = 70;

export interface PlayerSyncMeta {
  receivedAtMs: number;
  serverTimeMs: number;
}

export interface LocalMotionPrediction {
  kind: "answer" | "decision";
  playerId: string;
  submittedAtMs: number;
  expiresAtMs: number;
  token: string;
  targetSpeedMps: number;
  teleportMeters: number;
}

interface EvaluatedPrompt {
  correctAnswer: string;
  boostMultiplier: number;
}

function clampMeters(value: number, trackLengthMeters: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(trackLengthMeters, value));
}

function clampSpeed(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function clampLap(value: number, totalLaps: number) {
  const safeTotalLaps = Math.max(1, Math.trunc(totalLaps));
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(safeTotalLaps - 1, Math.trunc(value)));
}

function dampScalar(current: number, target: number, smoothing: number, deltaSeconds: number) {
  if (!Number.isFinite(current)) {
    return target;
  }
  if (!Number.isFinite(target) || deltaSeconds <= 0) {
    return current;
  }
  const factor = 1 - Math.exp(-Math.max(0, smoothing) * deltaSeconds);
  return current + ((target - current) * factor);
}

function parsePattern(prompt: string, pattern: RegExp, evaluator: (...values: number[]) => number, boostMultiplier: number) {
  const match = prompt.trim().match(pattern);
  if (!match) {
    return null;
  }

  const values = match.slice(1).map((entry) => Number(entry));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    correctAnswer: String(evaluator(...values)),
    boostMultiplier
  } satisfies EvaluatedPrompt;
}

export function evaluateQuestionPrompt(prompt: string): EvaluatedPrompt | null {
  return (
    parsePattern(prompt, /^(\d+)\s*\+\s*(\d+)$/, (left, right) => left + right, 1)
    ?? parsePattern(prompt, /^(\d+)\s*-\s*(\d+)$/, (left, right) => left - right, 1.05)
    ?? parsePattern(prompt, /^(\d+)\s*\*\s*(\d+)$/, (left, right) => left * right, 1.2)
    ?? parsePattern(prompt, /^\((\d+)\s*\*\s*(\d+)\)\s*\+\s*(\d+)$/, (left, right, offset) => (left * right) + offset, 1.25)
    ?? parsePattern(prompt, /^\((\d+)\s*\*\s*(\d+)\)\s*-\s*(\d+)$/, (left, right, offset) => (left * right) - offset, 1.4)
    ?? parsePattern(prompt, /^\((\d+)\s*\+\s*(\d+)\)\s*\*\s*(\d+)$/, (left, right, multiplier) => (left + right) * multiplier, 1.45)
  );
}

export function buildAnswerPrediction(
  question: QuestionMessage,
  submittedAnswer: string,
  player: PlayerSnapshot,
  baseSpeedMps: number,
  nowMs: number
): LocalMotionPrediction | null {
  const evaluated = evaluateQuestionPrompt(question.prompt);
  if (!evaluated) {
    return null;
  }

  const normalizedAnswer = submittedAnswer.trim();
  if (!normalizedAnswer) {
    return null;
  }

  const currentSpeedMps = clampSpeed(player.speedMps);
  if (normalizedAnswer === evaluated.correctAnswer) {
    const multiplier = question.highwayChallenge
      ? evaluated.boostMultiplier * HIGHWAY_BOOST_MULTIPLIER
      : evaluated.boostMultiplier;

    const predictedBoostSpeed = Math.max(
      currentSpeedMps,
      Math.max(DEFAULT_BASE_SPEED_MPS, baseSpeedMps) + (BOOST_EXTRA_SPEED_MPS * multiplier)
    );

    return {
      kind: "answer",
      playerId: player.playerId,
      submittedAtMs: nowMs,
      expiresAtMs: nowMs + (question.highwayChallenge ? 1400 : 1000),
      token: question.questionId,
      targetSpeedMps: predictedBoostSpeed,
      teleportMeters: question.highwayChallenge ? HIGHWAY_TELEPORT_METERS : 0
    };
  }

  return {
    kind: "answer",
    playerId: player.playerId,
    submittedAtMs: nowMs,
    expiresAtMs: nowMs + 900,
    token: question.questionId,
    targetSpeedMps: Math.max(MIN_SPEED_MPS, currentSpeedMps - WRONG_ANSWER_SPEED_PENALTY_MPS),
    teleportMeters: 0
  };
}

export function buildDecisionPrediction(
  choice: DecisionChoiceRequest["choice"],
  eventId: string,
  player: PlayerSnapshot,
  baseSpeedMps: number,
  nowMs: number
): LocalMotionPrediction | null {
  if (choice !== "DIRT") {
    return null;
  }

  return {
    kind: "decision",
    playerId: player.playerId,
    submittedAtMs: nowMs,
    expiresAtMs: nowMs + 900,
    token: eventId,
    targetSpeedMps: Math.max(
      clampSpeed(player.speedMps),
      Math.max(DEFAULT_BASE_SPEED_MPS, baseSpeedMps) + (BOOST_EXTRA_SPEED_MPS * 0.6)
    ),
    teleportMeters: 0
  };
}

export function getRenderedPlayerSnapshot(
  player: PlayerSnapshot | undefined,
  syncMeta: PlayerSyncMeta | undefined,
  prediction: LocalMotionPrediction | null,
  trackLengthMeters: number,
  raceStopped: boolean,
  nowMs: number
): PlayerSnapshot | null {
  if (!player) {
    return null;
  }

  const safeTrackLengthMeters = Math.max(1, trackLengthMeters);
  const safeSpeedMps = clampSpeed(player.speedMps);
  const safePositionMeters = clampMeters(player.positionMeters, safeTrackLengthMeters);
  const snapshotReceivedAtMs = syncMeta?.receivedAtMs ?? nowMs;
  const snapshotAgeSeconds = raceStopped || player.finished
    ? 0
    : Math.max(0, nowMs - snapshotReceivedAtMs) / 1000;

  let predictedSpeedMps = safeSpeedMps;
  let predictedPositionMeters = safePositionMeters + (safeSpeedMps * snapshotAgeSeconds);

  const predictionStillApplies = Boolean(
    prediction
    && prediction.playerId === player.playerId
    && nowMs < prediction.expiresAtMs
    && snapshotReceivedAtMs <= prediction.submittedAtMs
    && !raceStopped
    && !player.finished
  );

  if (predictionStillApplies && prediction) {
    const predictionElapsedSeconds = Math.max(0, nowMs - prediction.submittedAtMs) / 1000;
    predictedPositionMeters += prediction.teleportMeters;
    predictedPositionMeters += Math.max(0, prediction.targetSpeedMps - safeSpeedMps) * predictionElapsedSeconds;
    predictedSpeedMps = prediction.targetSpeedMps;
  }

  return {
    ...player,
    positionMeters: clampMeters(predictedPositionMeters, safeTrackLengthMeters),
    speedMps: clampSpeed(predictedSpeedMps)
  };
}

interface AdvanceRenderedPlayersArgs {
  previousPlayers: Record<string, PlayerSnapshot>;
  authoritativePlayers: Record<string, PlayerSnapshot>;
  playerIds: string[];
  localPlayerId: string;
  playerSyncMeta: Record<string, PlayerSyncMeta>;
  localMotionPrediction: LocalMotionPrediction | null;
  trackLengthMeters: number;
  raceStopped: boolean;
  nowMs: number;
  lastFrameAtMs: number;
}

function shouldSnapRenderedPlayer(
  previousPlayer: PlayerSnapshot,
  targetPlayer: PlayerSnapshot
) {
  if (previousPlayer.racePhase !== targetPlayer.racePhase) {
    return true;
  }

  if (previousPlayer.finished !== targetPlayer.finished) {
    return true;
  }

  if (previousPlayer.lap !== targetPlayer.lap) {
    return true;
  }

  if (Math.abs(targetPlayer.positionMeters - previousPlayer.positionMeters) >= SNAP_POSITION_DELTA_METERS) {
    return true;
  }

  if (Math.abs(targetPlayer.speedMps - previousPlayer.speedMps) >= SNAP_SPEED_DELTA_MPS) {
    return true;
  }

  return false;
}

function advanceRenderedPlayer(
  previousPlayer: PlayerSnapshot | undefined,
  targetPlayer: PlayerSnapshot,
  deltaSeconds: number,
  trackLengthMeters: number
) {
  if (!previousPlayer) {
    return targetPlayer;
  }

  if (shouldSnapRenderedPlayer(previousPlayer, targetPlayer) || deltaSeconds <= 0) {
    return targetPlayer;
  }

  const nextSpeedMps = clampSpeed(
    dampScalar(previousPlayer.speedMps, targetPlayer.speedMps, SPEED_CATCH_UP_RATE, deltaSeconds)
  );
  const projectedPositionMeters = clampMeters(
    previousPlayer.positionMeters + (nextSpeedMps * deltaSeconds),
    trackLengthMeters
  );
  const correctionRate = targetPlayer.positionMeters >= projectedPositionMeters
    ? POSITION_CATCH_UP_RATE
    : POSITION_CORRECTION_RATE;
  const nextPositionMeters = clampMeters(
    dampScalar(projectedPositionMeters, targetPlayer.positionMeters, correctionRate, deltaSeconds),
    trackLengthMeters
  );

  return {
    ...targetPlayer,
    positionMeters: nextPositionMeters,
    speedMps: nextSpeedMps
  };
}

export function advanceRenderedPlayers({
  previousPlayers,
  authoritativePlayers,
  playerIds,
  localPlayerId,
  playerSyncMeta,
  localMotionPrediction,
  trackLengthMeters,
  raceStopped,
  nowMs,
  lastFrameAtMs
}: AdvanceRenderedPlayersArgs) {
  const deltaSeconds = lastFrameAtMs > 0
    ? Math.min(MAX_RENDER_FRAME_DELTA_SECONDS, Math.max(0, nowMs - lastFrameAtMs) / 1000)
    : 0;
  const nextPlayers: Record<string, PlayerSnapshot> = {};
  const activePlayerIds = new Set(playerIds);

  if (localPlayerId) {
    activePlayerIds.add(localPlayerId);
  }

  for (const currentPlayerId of activePlayerIds) {
    const authoritativePlayer = authoritativePlayers[currentPlayerId];
    const targetPlayer = getRenderedPlayerSnapshot(
      authoritativePlayer,
      playerSyncMeta[currentPlayerId],
      localMotionPrediction,
      trackLengthMeters,
      raceStopped || authoritativePlayer?.racePhase !== "active",
      nowMs
    );

    if (!targetPlayer) {
      continue;
    }

    nextPlayers[currentPlayerId] = advanceRenderedPlayer(
      previousPlayers[currentPlayerId],
      targetPlayer,
      deltaSeconds,
      trackLengthMeters
    );
  }

  return nextPlayers;
}

export function getPlayerRaceDistanceMeters(
  player: PlayerSnapshot | null | undefined,
  trackLengthMeters: number,
  totalLaps: number
) {
  if (!player) {
    return 0;
  }

  const safeTrackLengthMeters = Math.max(1, trackLengthMeters);
  const safeTotalLaps = Math.max(1, Math.trunc(totalLaps));
  const totalRaceDistanceMeters = safeTrackLengthMeters * safeTotalLaps;

  if (player.finished) {
    return totalRaceDistanceMeters;
  }

  const completedLaps = clampLap(player.lap, safeTotalLaps);
  const positionMeters = clampMeters(player.positionMeters, safeTrackLengthMeters);
  return Math.max(
    0,
    Math.min(totalRaceDistanceMeters, (completedLaps * safeTrackLengthMeters) + positionMeters)
  );
}

export function getPlayerProgressRatio(
  player: PlayerSnapshot | null | undefined,
  trackLengthMeters: number,
  totalLaps: number
) {
  const safeTrackLengthMeters = Math.max(1, trackLengthMeters);
  const safeTotalLaps = Math.max(1, Math.trunc(totalLaps));
  const totalRaceDistanceMeters = safeTrackLengthMeters * safeTotalLaps;
  return getPlayerRaceDistanceMeters(player, safeTrackLengthMeters, safeTotalLaps) / totalRaceDistanceMeters;
}

export function getDistanceToFinishMeters(
  player: PlayerSnapshot | null | undefined,
  trackLengthMeters: number,
  totalLaps: number
) {
  const safeTrackLengthMeters = Math.max(1, trackLengthMeters);
  const safeTotalLaps = Math.max(1, Math.trunc(totalLaps));
  const totalRaceDistanceMeters = safeTrackLengthMeters * safeTotalLaps;
  return Math.max(
    0,
    totalRaceDistanceMeters - getPlayerRaceDistanceMeters(player, safeTrackLengthMeters, safeTotalLaps)
  );
}

export function isPlayerOnFinalLap(
  player: PlayerSnapshot | null | undefined,
  trackLengthMeters: number,
  totalLaps: number
) {
  if (!player || player.finished) {
    return false;
  }

  const safeTrackLengthMeters = Math.max(1, trackLengthMeters);
  const safeTotalLaps = Math.max(1, Math.trunc(totalLaps));
  const finalLapStartMeters = Math.max(0, safeTotalLaps - 1) * safeTrackLengthMeters;
  return getPlayerRaceDistanceMeters(player, safeTrackLengthMeters, safeTotalLaps) >= finalLapStartMeters;
}
