import type { GameStateUpdateMessage, QuestionMessage, RoomJoinedMessage } from "../types/messages";
import { buildDefaultRoomSettings } from "../utils/roomSettings";
import { useGameStore } from "./useGameStore";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function question(questionId: string, createdAtMs: number): QuestionMessage {
  return {
    roomId: "CLASS-TEST",
    targetPlayerId: "p1",
    questionId,
    id: questionId,
    kind: "ARITHMETIC",
    routeMode: "NORMAL",
    prompt: "1 + 1",
    difficulty: 1,
    difficultyLabel: "EASY",
    timeLimitMs: 15000,
    timeLimitSeconds: 15,
    createdAtMs,
    expiresAtMs: createdAtMs + 15000,
    highwayChallenge: false
  };
}

function activeStateUpdate(): GameStateUpdateMessage {
  return {
    roomId: "CLASS-TEST",
    serverTimeMs: 1000,
    tick: 1,
    racePhase: "active",
    raceStartingAtMs: 0,
    raceStartedAtMs: 1000,
    raceStopped: false,
    raceStoppedAtMs: 0,
    winnerPlayerId: null,
    roomCreatorPlayerId: "",
    roomSettings: buildDefaultRoomSettings("CLASS-TEST"),
    trackLengthMeters: 500,
    players: [{
      playerId: "p1",
      displayName: "Neon Racer",
      laneIndex: 0,
      positionMeters: 0,
      speedMps: 0,
      lap: 0,
      finished: false,
      racePhase: "active",
      score: 0
    }]
  };
}

export function runQuestionLifecycleStoreTests() {
  useGameStore.getState().resetSession();
  useGameStore.getState().prepareJoin("CLASS-TEST", "Neon Racer", "p1");
  useGameStore.getState().applyJoin({
    roomId: "CLASS-TEST",
    targetPlayerId: "p1",
    displayName: "Neon Racer",
    trackLengthMeters: 500,
    totalLaps: 1,
    baseSpeedMps: 16.667,
    roomCreatorPlayerId: "",
    roomSettings: buildDefaultRoomSettings("CLASS-TEST")
  } satisfies RoomJoinedMessage);
  useGameStore.getState().applyStateUpdate(activeStateUpdate());

  const oldQuestion = question("old", 1000);
  const nextQuestion = question("next", 2000);
  useGameStore.getState().applyQuestion(oldQuestion, "submit-answer");
  useGameStore.getState().markQuestionSubmitted(oldQuestion.questionId);
  useGameStore.getState().applyQuestion(nextQuestion, "submit-answer");
  useGameStore.getState().applyQuestion(oldQuestion, "sync");

  assert(useGameStore.getState().question?.questionId === "next", "Stale sync-room question cannot replace newer submit-answer question.");
}

runQuestionLifecycleStoreTests();
