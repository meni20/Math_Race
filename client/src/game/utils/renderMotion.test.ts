import type { PlayerSnapshot } from "../types/messages";
import {
  advanceRenderedPlayers,
  getClassroomScoreProgressRatio,
  getClassroomScoreVisualPositionMeters,
  getClassroomVisualDriveMeters,
  getClassroomVisualTrackMeters
} from "./renderMotion";

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
  assert(getClassroomVisualDriveMeters(afterLowerSnapshot.p1) > getClassroomVisualDriveMeters(previous), "Classroom sync snapshots do not rewind visual drive motion.");

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
  assert(getClassroomVisualDriveMeters(afterFrame.p1) > getClassroomVisualDriveMeters(previous), "Classroom visual movement continues between syncs.");
  assert(getClassroomVisualDriveMeters(afterFrame.p1) - getClassroomVisualDriveMeters(previous) > 1.5, "Classroom visual drive uses a render-only speed multiplier for racing feel.");
  assert(
    afterFrame.p1.positionMeters === getClassroomScoreVisualPositionMeters(previous, 500),
    "Classroom score progress position stays tied to score instead of elapsed visual motion."
  );

  const afterIdleFrame = advanceRenderedPlayers({
    previousPlayers: afterFrame,
    authoritativePlayers: { p1: previous },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 2550,
    lastFrameAtMs: 2500
  });
  assert(getClassroomVisualDriveMeters(afterIdleFrame.p1) > getClassroomVisualDriveMeters(afterFrame.p1), "Classroom visual drive advances while score is unchanged.");

  const afterLargeDeltaFrame = advanceRenderedPlayers({
    previousPlayers: afterFrame,
    authoritativePlayers: { p1: previous },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 10000,
    lastFrameAtMs: 2000
  });
  assert(
    getClassroomVisualDriveMeters(afterLargeDeltaFrame.p1) - getClassroomVisualDriveMeters(afterFrame.p1) < 2.1,
    "Classroom visual drive clamps huge frame deltas to avoid jumps."
  );

  const afterCorrectBoost = advanceRenderedPlayers({
    previousPlayers: { p1: previous },
    authoritativePlayers: { p1: previous },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: { accepted: true, resultType: "CORRECT", pointsDelta: 20, receivedAtMs: 2025 },
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 2050,
    lastFrameAtMs: 2000
  });
  assert(afterCorrectBoost.p1.speedMps > afterFrame.p1.speedMps, "Classroom correct answer temporarily increases visual speed.");

  const afterWrongSlowdown = advanceRenderedPlayers({
    previousPlayers: { p1: previous },
    authoritativePlayers: { p1: previous },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: true,
    answerFeedback: { accepted: true, resultType: "WRONG", pointsDelta: -10, receivedAtMs: 2025 },
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 2050,
    lastFrameAtMs: 2000
  });
  assert(afterWrongSlowdown.p1.speedMps < afterFrame.p1.speedMps, "Classroom wrong answer temporarily decreases visual speed.");
  assert(afterWrongSlowdown.p1.speedMps > 0, "Classroom slowdown does not stop visual driving.");

  const fastNearFinish = { ...player(490, 0), speedMps: 90 };
  const finishedAuthoritative = { ...finishedPlayer(498, 0), speedMps: 90 };
  const afterFinishedFrame = advanceRenderedPlayers({
    previousPlayers: { p1: fastNearFinish },
    authoritativePlayers: { p1: finishedAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: false,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 2050,
    lastFrameAtMs: 2000
  });
  const afterSecondFinishedFrame = advanceRenderedPlayers({
    previousPlayers: afterFinishedFrame,
    authoritativePlayers: { p1: finishedAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: false,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 3050,
    lastFrameAtMs: 2050
  });
  assert(afterFinishedFrame.p1.positionMeters === 500, "Finished rendered player snaps to the finish line.");
  assert(afterSecondFinishedFrame.p1.positionMeters === 500, "Finished rendered player stays frozen at the finish line.");
  assert(afterSecondFinishedFrame.p1.speedMps === 0, "Finished rendered player speed is frozen at zero.");

  const finishPhaseAuthoritative = { ...player(260, 0), speedMps: 80, racePhase: "finish" as const };
  const afterFinishPhaseFrame = advanceRenderedPlayers({
    previousPlayers: { p1: { ...player(260, 0), speedMps: 80 } },
    authoritativePlayers: { p1: finishPhaseAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: false,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 2050,
    lastFrameAtMs: 2000
  });
  const afterSecondFinishPhaseFrame = advanceRenderedPlayers({
    previousPlayers: afterFinishPhaseFrame,
    authoritativePlayers: { p1: finishPhaseAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: false,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: false,
    nowMs: 3050,
    lastFrameAtMs: 2050
  });
  assert(afterFinishPhaseFrame.p1.positionMeters === 260, "Finish-phase rendered player does not coast beyond the authoritative position.");
  assert(afterSecondFinishPhaseFrame.p1.positionMeters === 260, "Finish-phase rendered player stays stable between frames.");
  assert(afterSecondFinishPhaseFrame.p1.speedMps === 0, "Finish-phase rendered player speed is frozen at zero.");

  const stoppedAuthoritative = { ...player(300, 0), speedMps: 80 };
  const afterStoppedFrame = advanceRenderedPlayers({
    previousPlayers: { p1: stoppedAuthoritative },
    authoritativePlayers: { p1: stoppedAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: false,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: true,
    nowMs: 2050,
    lastFrameAtMs: 2000
  });
  const afterSecondStoppedFrame = advanceRenderedPlayers({
    previousPlayers: afterStoppedFrame,
    authoritativePlayers: { p1: stoppedAuthoritative },
    playerIds: ["p1"],
    localPlayerId: "p1",
    playerSyncMeta: { p1: { receivedAtMs: 2000, serverTimeMs: 2000 } },
    localMotionPrediction: null,
    classroomVisualMode: false,
    answerFeedback: null,
    trackLengthMeters: 500,
    raceStopped: true,
    nowMs: 3050,
    lastFrameAtMs: 2050
  });
  assert(afterStoppedFrame.p1.positionMeters === 300, "Stopped rendered player does not advance from the authoritative position.");
  assert(afterSecondStoppedFrame.p1.positionMeters === 300, "Stopped rendered player stays stable between frames.");
  assert(afterSecondStoppedFrame.p1.speedMps === 0, "Stopped rendered player speed is frozen at zero.");

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
    getClassroomVisualDriveMeters(afterTerminalFrame.p1) === getClassroomVisualDriveMeters(terminalPrevious),
    "Classroom score finish does not snap visual drive to a finish line."
  );
  assert(
    getClassroomVisualDriveMeters(afterSecondTerminalFrame.p1) === getClassroomVisualDriveMeters(afterTerminalFrame.p1),
    "Classroom finished rendered player does not advance position between frames."
  );
  assert(afterSecondTerminalFrame.p1.speedMps === 0, "Classroom finished rendered player speed is frozen at zero.");

  const halfProgressPlayer = player(0, 375);
  assert(getClassroomScoreProgressRatio(halfProgressPlayer, 750) === 0.5, "Classroom visual progress uses score divided by target score.");
  assert(
    getClassroomScoreVisualPositionMeters(halfProgressPlayer, 750) === getClassroomVisualTrackMeters() / 2,
    "Classroom visual position is normalized to the classroom visual track."
  );
  assert(getClassroomVisualTrackMeters() < 3000, "Classroom visual finish does not use the old 3000 meter finish distance.");
}

runRenderMotionTests();
