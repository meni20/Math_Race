import type { PlayerSnapshot } from "../types/messages";
import { advanceRenderedPlayers } from "./renderMotion";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function player(positionMeters: number, score: number): PlayerSnapshot {
  return {
    playerId: "p1",
    displayName: "Neon Racer",
    laneIndex: 0,
    positionMeters,
    speedMps: 0,
    lap: 0,
    finished: false,
    racePhase: "active",
    score
  };
}

function finishedPlayer(positionMeters: number, score: number): PlayerSnapshot {
  return {
    ...player(positionMeters, score),
    finished: true,
    racePhase: "finish"
  };
}

export function runRenderMotionTests() {
  const previous = player(120, 120);
  const lowerServerSnapshot = player(80, 80);
  const afterLowerSnapshot = advanceRenderedPlayers({
    previousPlayers: { p1: previous },
    authoritativePlayers: { p1: lowerServerSnapshot },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 2050,
    lastFrameAtMs: 2000
  });
  assert(afterLowerSnapshot.p1.positionMeters >= previous.positionMeters, "Classroom visual position does not decrease after lower server snapshot.");

  const afterFrame = advanceRenderedPlayers({
    previousPlayers: { p1: previous },
    authoritativePlayers: { p1: previous },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 2050,
    lastFrameAtMs: 2000
  });
  assert(afterFrame.p1.positionMeters > previous.positionMeters, "Classroom visual movement continues between syncs.");

  const terminalPrevious = finishedPlayer(220, 200);
  const terminalAuthoritative = finishedPlayer(200, 200);
  const afterTerminalFrame = advanceRenderedPlayers({
    previousPlayers: { p1: terminalPrevious },
    authoritativePlayers: { p1: terminalAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: true,
    nowMs: 12000,
    lastFrameAtMs: 2000
  });
  const afterSecondTerminalFrame = advanceRenderedPlayers({
    previousPlayers: afterTerminalFrame,
    authoritativePlayers: { p1: terminalAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: true,
    nowMs: 22000,
    lastFrameAtMs: 12000
  });
  assert(
    afterSecondTerminalFrame.p1.positionMeters === afterTerminalFrame.p1.positionMeters,
    "Classroom finished rendered player does not advance position between frames."
  );
  assert(afterSecondTerminalFrame.p1.speedMps === 0, "Classroom finished rendered player speed is frozen at zero.");
}

runRenderMotionTests();
