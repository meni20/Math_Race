import { create } from "zustand";
import type {
  AnswerFeedbackMessage,
  DecisionPointMessage,
  GameStateUpdateMessage,
  PlayerSnapshot,
  QuestionMessage,
  RoomJoinedMessage
} from "../types/messages";
import {
  buildAnswerPrediction,
  buildDecisionPrediction,
  type LocalMotionPrediction,
  type PlayerSyncMeta
} from "../utils/renderMotion";
import { normalizePlayerId, normalizeRoomId } from "../utils/gameIds";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

interface AnswerFeedbackState {
  correct: boolean;
  accepted: boolean;
  receivedAtMs: number;
}

interface GameStore {
  connection: ConnectionStatus;
  roomId: string;
  playerId: string;
  displayName: string;
  baseSpeedMps: number;
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
  setConnection: (status: ConnectionStatus) => void;
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
  roomId: "",
  playerId: "",
  displayName: "",
  baseSpeedMps: 42,
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
  setConnection: (status) => {
    set({ connection: status });
  },
  prepareJoin: (roomId, displayName, playerId) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    const normalizedPlayerId = normalizePlayerId(playerId);
    set({
      roomId: normalizedRoomId,
      displayName: displayName.trim(),
      playerId: normalizedPlayerId,
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
      roomId: message.roomId,
      playerId: message.targetPlayerId,
      displayName: message.displayName,
      connection: "connected",
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
        playersById[player.playerId] = {
          ...player,
          laneIndex: safeLaneIndex,
          positionMeters: safePosition,
          speedMps: safeSpeed
        };
        playerSyncMeta[player.playerId] = {
          receivedAtMs,
          serverTimeMs: Number.isFinite(message.serverTimeMs) ? message.serverTimeMs : receivedAtMs
        };
      }

      const incomingIds = message.players.map((player) => player.playerId);
      const idsChanged =
        incomingIds.length !== state.playerIds.length ||
        incomingIds.some((id) => !state.playerIds.includes(id));

      const localPlayer = state.playerId ? playersById[state.playerId] : undefined;
      const previousLocal = state.playerId ? state.players[state.playerId] : undefined;

      let raceStartedAtMs = raceStartedAtFromServer > 0
        ? raceStartedAtFromServer
        : state.raceStartedAtMs;
      if (!raceStartedAtMs && localPlayer) {
        raceStartedAtMs = Date.now();
      }

      const sortedStandings = Object.values(playersById).sort((a, b) => {
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

      const raceRestarted = state.raceStopped && !raceStopped;
      if (raceRestarted) {
        raceStartedAtMs = raceStartedAtFromServer > 0 ? raceStartedAtFromServer : Date.now();
        raceFinishedAtMs = null;
        racePlacement = null;
        if (question && question.expiresAtMs <= raceStartedAtMs) {
          question = null;
        }
        decision = null;
        localMotionPrediction = null;
      }

      if (raceStopped) {
        raceFinishedAtMs = raceStoppedAtMs > 0
          ? raceStoppedAtMs
          : (state.raceFinishedAtMs ?? Date.now());
        const finishIndex = sortedStandings.findIndex((player) => player.playerId === state.playerId);
        racePlacement = finishIndex >= 0 ? finishIndex + 1 : null;
        question = null;
        decision = null;
        localMotionPrediction = null;
      }

      if (!raceStopped && previousLocal?.finished && localPlayer && !localPlayer.finished) {
        raceStartedAtMs = raceStartedAtFromServer > 0 ? raceStartedAtFromServer : Date.now();
        raceFinishedAtMs = null;
        racePlacement = null;
        localMotionPrediction = null;
      }

      if (localMotionPrediction) {
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
    if (message.targetPlayerId !== get().playerId) {
      return;
    }
    set((state) => ({
      question: message,
      questionReceivedAtMs: Date.now(),
      decision: null,
      localMotionPrediction: state.localMotionPrediction?.kind === "decision"
        ? null
        : state.localMotionPrediction
    }));
  },
  applyDecision: (message) => {
    if (message.targetPlayerId !== get().playerId) {
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
    if (!question || !localPlayer) {
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
    if (!decision || !localPlayer) {
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
      roomId: get().roomId,
      displayName: get().displayName
    });
  }
}));

function latestTickChanged(nextTick: number, previousTick: number) {
  return Number.isFinite(nextTick) && nextTick !== previousTick;
}
