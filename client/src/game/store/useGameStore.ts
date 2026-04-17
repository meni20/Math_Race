import { create } from "zustand";
import type {
  AnswerFeedbackMessage,
  DecisionPointMessage,
  GameStateUpdateMessage,
  PlayerSnapshot,
  QuestionMessage,
  RacePhase,
  RoomJoinedMessage
} from "../types/messages";
import {
  buildAnswerPrediction,
  buildDecisionPrediction,
  type LocalMotionPrediction,
  type PlayerSyncMeta
} from "../utils/renderMotion";
import { isSoloRoomId, normalizePlayerId, normalizeRoomId } from "../utils/gameIds";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
type SessionMode = "personal" | "shared" | "solo";

interface AnswerFeedbackState {
  correct: boolean;
  accepted: boolean;
  receivedAtMs: number;
}

interface GameStore {
  connection: ConnectionStatus;
  connectionErrorMessage: string;
  sessionMode: SessionMode;
  roomId: string;
  playerId: string;
  displayName: string;
  baseSpeedMps: number;
  roomRacePhase: RacePhase;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceFinishedAtMs: number | null;
  racePlacement: number | null;
  raceStopped: boolean;
  winnerPlayerId: string;
  trackLengthMeters: number;
  totalLaps: number;
  latestTick: number;
  players: Record<string, PlayerSnapshot>;
  playerIds: string[];
  playerSyncMeta: Record<string, PlayerSyncMeta>;
  localMotionPrediction: LocalMotionPrediction | null;
  question: QuestionMessage | null;
  questionReceivedAtMs: number;
  decision: DecisionPointMessage | null;
  answerFeedback: AnswerFeedbackState | null;
  setConnection: (status: ConnectionStatus, errorMessage?: string) => void;
  prepareJoin: (roomId: string, displayName: string, playerId: string) => void;
  applyJoin: (message: RoomJoinedMessage) => void;
  applyStateUpdate: (message: GameStateUpdateMessage) => void;
  applyQuestion: (message: QuestionMessage) => void;
  applyDecision: (message: DecisionPointMessage) => void;
  applyAnswerFeedback: (message: AnswerFeedbackMessage) => void;
  beginLocalAnswerPrediction: (answer: string) => void;
  beginLocalDecisionPrediction: (choice: "HIGHWAY" | "DIRT") => void;
  clearLocalMotionPrediction: () => void;
  clearDecision: () => void;
  clearQuestion: () => void;
  resetSession: () => void;
}

const initialState = {
  connection: "idle" as ConnectionStatus,
  connectionErrorMessage: "",
  sessionMode: "personal" as SessionMode,
  roomId: "",
  playerId: "",
  displayName: "",
  baseSpeedMps: 42,
  roomRacePhase: "lobby" as RacePhase,
  racePhase: "lobby" as RacePhase,
  raceStartingAtMs: 0,
  raceStartedAtMs: 0,
  raceFinishedAtMs: null as number | null,
  racePlacement: null as number | null,
  raceStopped: false,
  winnerPlayerId: "",
  trackLengthMeters: 3000,
  totalLaps: 1,
  latestTick: 0,
  players: {} as Record<string, PlayerSnapshot>,
  playerIds: [] as string[],
  playerSyncMeta: {} as Record<string, PlayerSyncMeta>,
  localMotionPrediction: null as LocalMotionPrediction | null,
  question: null as QuestionMessage | null,
  questionReceivedAtMs: 0,
  decision: null as DecisionPointMessage | null,
  answerFeedback: null as AnswerFeedbackState | null
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,
  setConnection: (status, errorMessage) => {
    set({
      connection: status,
      connectionErrorMessage: status === "error"
        ? (errorMessage?.trim() || "Connection error.")
        : ""
    });
  },
  prepareJoin: (roomId, displayName, playerId) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    const normalizedPlayerId = normalizePlayerId(playerId);
    set({
      sessionMode: deriveSessionMode(normalizedRoomId),
      roomId: normalizedRoomId,
      displayName: displayName.trim(),
      playerId: normalizedPlayerId,
      roomRacePhase: "lobby",
      racePhase: "lobby",
      raceStartingAtMs: 0,
      raceStartedAtMs: 0,
      raceFinishedAtMs: null,
      racePlacement: null,
      raceStopped: false,
      winnerPlayerId: "",
      baseSpeedMps: initialState.baseSpeedMps,
      latestTick: 0,
      players: {},
      playerIds: [],
      playerSyncMeta: {},
      localMotionPrediction: null,
      question: null,
      questionReceivedAtMs: 0,
      decision: null,
      answerFeedback: null
    });
  },
  applyJoin: (message) => {
    set({
      sessionMode: deriveSessionMode(message.roomId),
      roomId: message.roomId,
      playerId: message.targetPlayerId,
      displayName: message.displayName,
      connection: "connected",
      connectionErrorMessage: "",
      baseSpeedMps: Number.isFinite(message.baseSpeedMps) ? Math.max(0, message.baseSpeedMps) : initialState.baseSpeedMps,
      totalLaps: message.totalLaps,
      trackLengthMeters: message.trackLengthMeters
    });
  },
  applyStateUpdate: (message) => {
    set((state) => {
      if (state.roomId && message.roomId !== state.roomId) {
        return state;
      }

      const raceStopped = Boolean(message.raceStopped);
      const raceStoppedAtMs = typeof message.raceStoppedAtMs === "number" ? message.raceStoppedAtMs : 0;
      const roomRacePhase = normalizeRacePhase(message.racePhase, raceStopped, message.raceStartedAtMs);
      const raceStartedAtFromServer = typeof message.raceStartedAtMs === "number" ? message.raceStartedAtMs : 0;
      const receivedAtMs = Date.now();
      const winnerPlayerId = message.winnerPlayerId ?? "";
      const playersById: Record<string, PlayerSnapshot> = {};
      const playerSyncMeta: Record<string, PlayerSyncMeta> = {};
      for (const player of message.players) {
        const safeLaneIndex = Number.isFinite(player.laneIndex)
          ? Math.max(0, Math.min(3, Math.trunc(player.laneIndex)))
          : 0;
        const safePosition = Number.isFinite(player.positionMeters) ? Math.max(0, player.positionMeters) : 0;
        const safeSpeed = Number.isFinite(player.speedMps) ? Math.max(0, player.speedMps) : 0;
        const safeRacePhase = normalizePlayerRacePhase(
          player.racePhase,
          roomRacePhase,
          raceStopped,
          raceStartedAtFromServer,
          Boolean(player.finished)
        );
        playersById[player.playerId] = {
          ...player,
          laneIndex: safeLaneIndex,
          positionMeters: safePosition,
          speedMps: safeSpeed,
          racePhase: safeRacePhase
        };
        playerSyncMeta[player.playerId] = {
          receivedAtMs,
          serverTimeMs: Number.isFinite(message.serverTimeMs) ? message.serverTimeMs : receivedAtMs
        };
      }

      const localPlayer = state.playerId ? playersById[state.playerId] : undefined;
      const racePhase = normalizePlayerRacePhase(
        localPlayer?.racePhase,
        roomRacePhase,
        raceStopped,
        raceStartedAtFromServer,
        Boolean(localPlayer?.finished)
      );
      const raceStartingAtMs = racePhase === "starting" && Number.isFinite(message.raceStartingAtMs)
        ? Math.max(0, message.raceStartingAtMs)
        : 0;

      const incomingIds = message.players.map((player) => player.playerId);
      const idsChanged =
        incomingIds.length !== state.playerIds.length ||
        incomingIds.some((id) => !state.playerIds.includes(id));

      const sortedStandings = Object.values(playersById)
        .filter((player) => player.racePhase !== "lobby" || player.finished)
        .sort((a, b) => {
        if (a.lap !== b.lap) {
          return b.lap - a.lap;
        }
        return b.positionMeters - a.positionMeters;
        });

      let raceFinishedAtMs = state.raceFinishedAtMs;
      let racePlacement = state.racePlacement;
      let question = state.question;
      let decision = state.decision;
      let localMotionPrediction = state.localMotionPrediction;

      let raceStartedAtMs = state.raceStartedAtMs;
      if (racePhase === "active") {
        raceStartedAtMs = raceStartedAtFromServer > 0 ? raceStartedAtFromServer : state.raceStartedAtMs;
        raceFinishedAtMs = null;
        racePlacement = null;
      } else if (racePhase === "finish") {
        raceStartedAtMs = raceStartedAtFromServer > 0 ? raceStartedAtFromServer : state.raceStartedAtMs;
        raceFinishedAtMs = raceStoppedAtMs > 0
          ? raceStoppedAtMs
          : (state.raceFinishedAtMs ?? Date.now());
        const finishIndex = sortedStandings.findIndex((player) => player.playerId === state.playerId);
        racePlacement = finishIndex >= 0 ? finishIndex + 1 : null;
        question = null;
        decision = null;
        localMotionPrediction = null;
      } else {
        raceStartedAtMs = 0;
        raceFinishedAtMs = null;
        racePlacement = null;
        question = null;
        decision = null;
        localMotionPrediction = null;
      }

      if (racePhase === "active" && localMotionPrediction) {
        const localMeta = playerSyncMeta[state.playerId];
        if (
          !playersById[state.playerId]
          || Date.now() >= localMotionPrediction.expiresAtMs
          || (localMeta && localMeta.receivedAtMs > localMotionPrediction.submittedAtMs && latestTickChanged(message.tick, state.latestTick))
        ) {
          localMotionPrediction = null;
        }
      }

      return {
        players: playersById,
        playerIds: idsChanged ? incomingIds : state.playerIds,
        playerSyncMeta,
        localMotionPrediction,
        latestTick: message.tick,
        roomRacePhase,
        racePhase,
        raceStartingAtMs,
        raceStartedAtMs,
        raceFinishedAtMs,
        racePlacement,
        raceStopped,
        winnerPlayerId,
        question,
        decision
      };
    });
  },
  applyQuestion: (message) => {
    const state = get();
    if (message.targetPlayerId !== state.playerId || state.racePhase !== "active") {
      return;
    }
    set((currentState) => ({
      question: message,
      questionReceivedAtMs: Date.now(),
      decision: null,
      localMotionPrediction: currentState.localMotionPrediction?.kind === "decision"
        ? null
        : currentState.localMotionPrediction
    }));
  },
  applyDecision: (message) => {
    const state = get();
    if (message.targetPlayerId !== state.playerId || state.racePhase !== "active") {
      return;
    }
    set({
      decision: message,
      question: null
    });
  },
  applyAnswerFeedback: (message) => {
    if (message.targetPlayerId !== get().playerId) {
      return;
    }
    set({
      answerFeedback: {
        correct: message.correct,
        accepted: message.accepted,
        receivedAtMs: Date.now()
      },
      localMotionPrediction: null
    });
  },
  beginLocalAnswerPrediction: (answer) => {
    const state = get();
    const question = state.question;
    const localPlayer = state.players[state.playerId];
    if (state.racePhase !== "active" || !question || !localPlayer) {
      return;
    }

    const prediction = buildAnswerPrediction(
      question,
      answer,
      localPlayer,
      state.baseSpeedMps,
      Date.now()
    );
    if (!prediction) {
      return;
    }

    set({ localMotionPrediction: prediction });
  },
  beginLocalDecisionPrediction: (choice) => {
    const state = get();
    const decision = state.decision;
    const localPlayer = state.players[state.playerId];
    if (state.racePhase !== "active" || !decision || !localPlayer) {
      return;
    }

    const prediction = buildDecisionPrediction(
      choice,
      decision.eventId,
      localPlayer,
      state.baseSpeedMps,
      Date.now()
    );
    if (!prediction) {
      return;
    }

    set({ localMotionPrediction: prediction });
  },
  clearLocalMotionPrediction: () => {
    set({ localMotionPrediction: null });
  },
  clearDecision: () => {
    set({ decision: null });
  },
  clearQuestion: () => {
    set({ question: null, questionReceivedAtMs: 0 });
  },
  resetSession: () => {
    set({
      ...initialState,
      displayName: get().displayName
    });
  }
}));

function latestTickChanged(nextTick: number, previousTick: number) {
  return Number.isFinite(nextTick) && nextTick !== previousTick;
}

function normalizeRacePhase(
  phase: GameStateUpdateMessage["racePhase"] | undefined,
  raceStopped: boolean,
  raceStartedAtMs: number
): RacePhase {
  if (phase === "lobby" || phase === "starting" || phase === "active" || phase === "finish") {
    return phase;
  }
  if (raceStopped) {
    return "finish";
  }
  if (Number.isFinite(raceStartedAtMs) && raceStartedAtMs > 0) {
    return "active";
  }
  return "lobby";
}

function normalizePlayerRacePhase(
  phase: RacePhase | undefined,
  roomRacePhase: RacePhase,
  raceStopped: boolean,
  raceStartedAtMs: number,
  finished: boolean
): RacePhase {
  if (phase === "lobby" || phase === "starting" || phase === "active" || phase === "finish") {
    return phase;
  }
  if (finished || raceStopped || roomRacePhase === "finish") {
    return "finish";
  }
  if (roomRacePhase === "starting") {
    return "starting";
  }
  if (roomRacePhase === "active" || (Number.isFinite(raceStartedAtMs) && raceStartedAtMs > 0)) {
    return "active";
  }
  return "lobby";
}

function deriveSessionMode(roomId: string): SessionMode {
  if (!roomId) {
    return "personal";
  }
  return isSoloRoomId(roomId) ? "solo" : "shared";
}
