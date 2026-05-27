import { create } from "zustand";
import type {
  AnswerFeedbackMessage,
  DecisionPointMessage,
  GameStateUpdateMessage,
  PlayerSnapshot,
  QuestionMessage,
  RacePhase,
  TrackTheme,
  RoomSettings,
  RoomJoinedMessage
} from "../types/messages";
import type { CarId } from "../types/messages";
import {
  buildAnswerPrediction,
  buildDecisionPrediction,
  type LocalMotionPrediction,
  type PlayerSyncMeta
} from "../utils/renderMotion";
import { isSoloRoomId, normalizePlayerId, normalizeRoomId } from "../utils/gameIds";
import { buildDefaultRoomSettings, normalizeRoomSettings } from "../utils/roomSettings";
import { DEFAULT_CAR_ID, normalizeCarId } from "../utils/carSelection";

const MAX_LANE_INDEX = 7;

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
type SessionMode = "personal" | "shared" | "solo";

interface AnswerFeedbackState {
  correct: boolean;
  accepted: boolean;
  resultType?: "CORRECT" | "WRONG" | "TIMEOUT";
  feedback?: "correct" | "wrong" | "timeout";
  pointsDelta?: number;
  progressDelta?: number;
  updatedProgress?: number;
  streak?: number;
  expectedAnswer?: number;
  submittedAnswer?: string;
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
  roomCreatorPlayerId: string;
  roomSettings: RoomSettings;
  trackTheme: TrackTheme;
  selectedCarId: CarId;
  trackLengthMeters: number;
  totalLaps: number;
  latestTick: number;
  players: Record<string, PlayerSnapshot>;
  playerIds: string[];
  playerSyncMeta: Record<string, PlayerSyncMeta>;
  localMotionPrediction: LocalMotionPrediction | null;
  question: QuestionMessage | null;
  questionReceivedAtMs: number;
  lastSubmittedQuestionId: string;
  lastAppliedQuestionIssuedAtMs: number;
  decision: DecisionPointMessage | null;
  answerFeedback: AnswerFeedbackState | null;
  setConnection: (status: ConnectionStatus, errorMessage?: string) => void;
  prepareJoin: (roomId: string, displayName: string, playerId: string) => void;
  applyJoin: (message: RoomJoinedMessage) => void;
  applyStateUpdate: (message: GameStateUpdateMessage) => void;
  applyOptimisticRoomSettings: (roomSettings: RoomSettings) => void;
  applyQuestion: (message: QuestionMessage, source?: "submit-answer" | "sync" | "realtime" | "local") => void;
  applyDecision: (message: DecisionPointMessage) => void;
  applyAnswerFeedback: (message: AnswerFeedbackMessage) => void;
  markQuestionSubmitted: (questionId: string) => void;
  beginLocalAnswerPrediction: (answer: string) => void;
  beginLocalDecisionPrediction: (choice: "HIGHWAY" | "DIRT") => void;
  clearLocalMotionPrediction: () => void;
  clearDecision: () => void;
  clearQuestion: () => void;
  changeEnvironment: (themeName: TrackTheme) => void;
  selectCar: (carId: CarId) => void;
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
  roomCreatorPlayerId: "",
  roomSettings: buildDefaultRoomSettings(""),
  trackTheme: "sunny-forest" as TrackTheme,
  selectedCarId: DEFAULT_CAR_ID,
  trackLengthMeters: 3000,
  totalLaps: 1,
  latestTick: 0,
  players: {} as Record<string, PlayerSnapshot>,
  playerIds: [] as string[],
  playerSyncMeta: {} as Record<string, PlayerSyncMeta>,
  localMotionPrediction: null as LocalMotionPrediction | null,
  question: null as QuestionMessage | null,
  questionReceivedAtMs: 0,
  lastSubmittedQuestionId: "",
  lastAppliedQuestionIssuedAtMs: 0,
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
      roomCreatorPlayerId: "",
      roomSettings: buildDefaultRoomSettings(normalizedRoomId),
      selectedCarId: normalizeCarId(get().selectedCarId),
      baseSpeedMps: initialState.baseSpeedMps,
      latestTick: 0,
      players: {},
      playerIds: [],
      playerSyncMeta: {},
      localMotionPrediction: null,
      question: null,
      questionReceivedAtMs: 0,
      lastSubmittedQuestionId: "",
      lastAppliedQuestionIssuedAtMs: 0,
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
      roomCreatorPlayerId: typeof message.roomCreatorPlayerId === "string" ? message.roomCreatorPlayerId : message.targetPlayerId,
      roomSettings: normalizeRoomSettings(message.roomId, message.roomSettings, 2),
      trackTheme: normalizeTrackTheme(message.roomSettings?.mapId ?? get().trackTheme),
      totalLaps: message.totalLaps,
      trackLengthMeters: message.trackLengthMeters,
      selectedCarId: normalizeCarId(message.carId ?? get().selectedCarId)
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
      const minimumPlayers = Math.max(2, message.players.length || state.playerIds.length || 0);
      const roomCreatorPlayerId = typeof message.roomCreatorPlayerId === "string"
        ? message.roomCreatorPlayerId
        : state.roomCreatorPlayerId;
      const roomSettings = normalizeRoomSettings(
        message.roomId || state.roomId,
        message.roomSettings ?? state.roomSettings,
        minimumPlayers
      );
      const trackLengthMeters = Number.isFinite(message.trackLengthMeters)
        ? Math.max(1, message.trackLengthMeters ?? state.trackLengthMeters)
        : state.trackLengthMeters;
      const playersById: Record<string, PlayerSnapshot> = {};
      const playerSyncMeta: Record<string, PlayerSyncMeta> = {};
      for (const player of message.players) {
        const safeLaneIndex = Number.isFinite(player.laneIndex)
          ? Math.max(0, Math.min(MAX_LANE_INDEX, Math.trunc(player.laneIndex)))
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
          racePhase: safeRacePhase,
          carId: normalizeCarId(player.carId ?? (player.playerId === state.playerId ? state.selectedCarId : undefined)),
          ready: Boolean(player.ready),
          correctAnswers: Math.max(0, Math.trunc(player.correctAnswers ?? 0)),
          wrongAnswers: Math.max(0, Math.trunc(player.wrongAnswers ?? 0)),
          timeoutAnswers: Math.max(0, Math.trunc(player.timeoutAnswers ?? 0)),
          score: Math.trunc(player.score ?? 0),
          streak: Math.max(0, Math.trunc(player.streak ?? 0)),
          averageAnswerTimeMs: Math.max(0, Math.trunc(player.averageAnswerTimeMs ?? 0))
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
        roomCreatorPlayerId,
        roomSettings,
        trackTheme: normalizeTrackTheme(roomSettings.mapId ?? state.trackTheme),
        trackLengthMeters,
        question,
        decision
      };
    });
  },
  applyOptimisticRoomSettings: (roomSettings) => {
    set((state) => ({
      roomSettings: normalizeRoomSettings(
        state.roomId,
        roomSettings,
        Math.max(2, state.playerIds.length || 0)
      ),
      trackTheme: normalizeTrackTheme(roomSettings.mapId ?? state.trackTheme)
    }));
  },
  applyQuestion: (message, source = "realtime") => {
    const state = get();
    if (message.targetPlayerId !== state.playerId || state.racePhase !== "active") {
      return;
    }
    const incomingIssuedAtMs = getQuestionIssuedAtMs(message);
    const currentIssuedAtMs = state.question ? getQuestionIssuedAtMs(state.question) : 0;
    const isStaleSubmittedQuestion =
      source !== "submit-answer"
      && Boolean(state.lastSubmittedQuestionId)
      && message.questionId === state.lastSubmittedQuestionId;
    const isOlderThanCurrent =
      source !== "submit-answer"
      && Boolean(state.question)
      && incomingIssuedAtMs > 0
      && currentIssuedAtMs > 0
      && incomingIssuedAtMs < currentIssuedAtMs;

    if (isStaleSubmittedQuestion || isOlderThanCurrent) {
      return;
    }

    if (import.meta.env.DEV && !hasExpectedQuestionDuration(message)) {
      console.warn("[question-timer] Unexpected classroom question duration", {
        questionId: message.questionId,
        kind: message.kind,
        routeMode: message.routeMode,
        timeLimitMs: message.timeLimitMs,
        timeLimitSeconds: message.timeLimitSeconds
      });
    }

    set((currentState) => {
      const sameQuestion = currentState.question?.questionId === message.questionId;
      return {
        question: message,
        questionReceivedAtMs: sameQuestion ? currentState.questionReceivedAtMs : Date.now(),
        lastAppliedQuestionIssuedAtMs: Math.max(
          currentState.lastAppliedQuestionIssuedAtMs,
          incomingIssuedAtMs
        ),
        decision: null,
        localMotionPrediction: currentState.localMotionPrediction?.kind === "decision"
          ? null
          : currentState.localMotionPrediction
      };
    });
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
        resultType: message.resultType,
        feedback: message.feedback,
        pointsDelta: message.pointsDelta,
        progressDelta: message.progressDelta,
        updatedProgress: message.updatedProgress,
        streak: message.streak,
        expectedAnswer: message.expectedAnswer,
        submittedAnswer: message.submittedAnswer,
        receivedAtMs: Date.now()
      },
      localMotionPrediction: null
    });
  },
  markQuestionSubmitted: (questionId) => {
    set({ lastSubmittedQuestionId: questionId });
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
  changeEnvironment: (themeName) => {
    set({ trackTheme: themeName });
  },
  selectCar: (carId) => {
    set({ selectedCarId: normalizeCarId(carId) });
  },
  resetSession: () => {
    set({
      ...initialState,
      displayName: get().displayName,
      selectedCarId: get().selectedCarId
    });
  }
}));

function latestTickChanged(nextTick: number, previousTick: number) {
  return Number.isFinite(nextTick) && nextTick !== previousTick;
}

function getQuestionIssuedAtMs(question: QuestionMessage) {
  if (typeof question.createdAtMs === "number" && Number.isFinite(question.createdAtMs)) {
    return question.createdAtMs;
  }
  if (
    typeof question.expiresAtMs === "number"
    && Number.isFinite(question.expiresAtMs)
    && typeof question.timeLimitMs === "number"
    && Number.isFinite(question.timeLimitMs)
  ) {
    return question.expiresAtMs - question.timeLimitMs;
  }
  return 0;
}

function hasExpectedQuestionDuration(question: QuestionMessage) {
  const seconds = typeof question.timeLimitSeconds === "number"
    ? question.timeLimitSeconds
    : Math.round(question.timeLimitMs / 1000);
  if (question.routeMode === "DIRT_ROAD") {
    return seconds === 30;
  }
  if (question.routeMode === "HIGHWAY") {
    return seconds === 60;
  }
  if (!question.routeMode || question.routeMode === "NORMAL") {
    return seconds === 15;
  }
  return true;
}

function normalizeTrackTheme(value: unknown): TrackTheme {
  return value === "sunny-forest" || value === "snow-peak" || value === "fun-world" || value === "grand_prix"
    ? value
    : "sunny-forest";
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
