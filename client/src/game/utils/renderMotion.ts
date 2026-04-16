import type { DecisionChoiceRequest, PlayerSnapshot, QuestionMessage } from "../types/messages";

const DEFAULT_BASE_SPEED_MPS = 42;
const MIN_SPEED_MPS = 18;
const BOOST_EXTRA_SPEED_MPS = 30;
const WRONG_ANSWER_SPEED_PENALTY_MPS = 7.5;
const HIGHWAY_TELEPORT_METERS = 240;
const HIGHWAY_BOOST_MULTIPLIER = 1.35;

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
