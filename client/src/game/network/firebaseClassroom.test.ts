import { getClassroomTerminalRank, isExplicitClassroomReset } from "./firebaseClassroom";
import { finishLocalClassroomRoom } from "./classroomLifecycle";
import type { LocalClassroomRoom } from "./localClassroom";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function room(overrides: Partial<LocalClassroomRoom> = {}): LocalClassroomRoom {
  return {
    roomId: "test-room",
    roomSettings: { raceName: "Test", maxPlayers: 4, raceDurationSeconds: 60, questionTimeLimitSeconds: 15, targetScore: 100 },
    trackLengthMeters: 100,
    totalLaps: 1,
    racePhase: "active",
    raceStartingAtMs: 0,
    raceStartedAtMs: 1,
    raceStopped: false,
    raceStoppedAtMs: 0,
    winnerPlayerId: null,
    tick: 1,
    players: {},
    removedPlayerIds: {},
    ...overrides
  };
}

export function runFirebaseClassroomTests() {
  assert(getClassroomTerminalRank(room()) === 0, "An active room is not terminal.");
  assert(getClassroomTerminalRank(room({ racePhase: "finish", raceStopped: true })) === 1, "A finished room is terminal.");
  assert(getClassroomTerminalRank(room({ closedAtMs: 2 })) === 2, "A closed room advances terminal lifecycle.");
  assert(getClassroomTerminalRank(room({ deletedAtMs: 3 })) === 3, "A deleted room has the highest terminal lifecycle.");
  assert(isExplicitClassroomReset(room({ racePhase: "lobby", raceStartedAtMs: 0 })), "A clean lobby snapshot may deliberately reset a finished room.");
  assert(!isExplicitClassroomReset(room()), "A stale active snapshot is not an explicit reset.");
  const manuallyFinished = finishLocalClassroomRoom(room({
    players: {
      leader: { playerId: "leader", displayName: "Leader", laneIndex: 0, positionMeters: 80, speedMps: 12, lap: 0, finished: false, racePhase: "active", score: 80 },
      second: { playerId: "second", displayName: "Second", laneIndex: 1, positionMeters: 50, speedMps: 10, lap: 0, finished: false, racePhase: "active", score: 50 }
    }
  }), 5000);
  assert(manuallyFinished.winnerPlayerId === "leader", "Teacher end selects the current leader for final results.");
  assert(manuallyFinished.raceStopped && manuallyFinished.racePhase === "finish", "Teacher end makes the room terminal.");
  assert(Object.values(manuallyFinished.players).every((player) => player.racePhase === "finish" && player.speedMps === 0), "Teacher end freezes every participant.");
}

runFirebaseClassroomTests();
