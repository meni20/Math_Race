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
}

runRenderMotionTests();
