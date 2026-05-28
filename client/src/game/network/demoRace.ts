import { useGameStore } from "../store/useGameStore";
import type {
  AnswerFeedbackMessage,
  ConnectPayload,
  DecisionChoiceRequest,
  DecisionPointMessage,
  GameStateUpdateMessage,
  PlayerSnapshot,
  QuestionMessage,
  RacePhase,
  RoomSettings,
  RoomJoinedMessage
} from "../types/messages";
import { DEFAULT_TARGET_SCORE, buildDefaultRoomSettings, normalizeRoomSettings } from "../utils/roomSettings";
import { getRandomCarId, normalizeCarId } from "../utils/carSelection";
import {
  localRoomToStateUpdate,
  readLocalClassroomRoom,
  subscribeLocalClassroomRoom,
  updateLocalClassroomRoom,
  writeLocalClassroomRoom,
  type LocalClassroomRoom
} from "./localClassroom";
import { validateAnswer } from "../questions/answerValidator";
import { scoreAnswer } from "../questions/scoringEngine";
import {
  advanceQuestionStateAfterAnswer,
  chooseRoute,
  createInitialPlayerQuestionState,
  ensureNextPrompt
} from "../questions/questionStateMachine";
import type { PlayerQuestionState, RaceQuestionPrivate, QuestionResultType } from "../questions/questionTypes";

interface DemoPlayerState extends PlayerSnapshot {
  baseSpeedMps: number;
  aiPhase: number;
  aiVariance: number;
  temporaryDeltaMps: number;
  temporaryDeltaEndsAtMs: number;
  nextBotAnswerAtMs?: number;
  lastBotAnswerAtMs?: number;
}

interface PendingQuestion {
  question: RaceQuestionPrivate;
}

interface PendingDecision {
  eventId: string;
  expiresAtMs: number;
}

interface DemoSession {
  roomId: string;
  localPlayerId: string;
  roomCreatorPlayerId: string;
  roomSettings: RoomSettings;
  trackLengthMeters: number;
  totalLaps: number;
  racePhase: RacePhase;
  raceStartingAtMs: number;
  raceStartedAtMs: number;
  raceStopped: boolean;
  raceStoppedAtMs: number;
  winnerPlayerId: string | null;
  tick: number;
  players: DemoPlayerState[];
  nextEventAtMs: number;
  eventCount: number;
  pendingQuestion: PendingQuestion | null;
  pendingDecision: PendingDecision | null;
  questionState: PlayerQuestionState;
  soloBotCount: number;
}

const TICK_MS = 100;
const DEMO_TOTAL_LAPS = 1;
const DEMO_START_COUNTDOWN_MS = 2600;
const DEMO_DECISION_PROMPT = "Choose your route";
const DEMO_DECISION_OPTIONS = ["HIGHWAY", "DIRT"];
const KMH_TO_MPS = 1 / 3.6;
const DEMO_BASE_SPEED_MPS = 60 * KMH_TO_MPS;
const DEMO_MIN_SPEED_MPS = 30 * KMH_TO_MPS;
const DEMO_SPEED_MODIFIER_DURATION_MS = 5000;
const MIN_DYNAMIC_TRACK_LENGTH_METERS = 360;
export const SOLO_BOT_OPTIONS = [1, 2, 3] as const;

function buildQuestionId() {
  return `q-${Math.random().toString(36).slice(2, 10)}`;
}

function buildDecisionId() {
  return `d-${Math.random().toString(36).slice(2, 10)}`;
}

function clampSpeed(speedMps: number) {
  return Math.max(DEMO_MIN_SPEED_MPS, speedMps);
}

function calculateDynamicTrackLengthMeters(roomSettings: RoomSettings) {
  return Math.max(MIN_DYNAMIC_TRACK_LENGTH_METERS, Math.trunc(roomSettings.targetScore ?? DEFAULT_TARGET_SCORE) * 12);
}

function getTargetScore(session: DemoSession) {
  return Math.max(1, Math.trunc(session.roomSettings.targetScore ?? DEFAULT_TARGET_SCORE));
}

export function normalizeSoloBotCount(value: number) {
  if (!Number.isFinite(value)) {
    return 2;
  }
  return Math.max(1, Math.min(3, Math.trunc(value)));
}

function getRoomDifficulty(session: DemoSession): NonNullable<RoomSettings["difficulty"]> {
  return session.roomSettings.difficulty === "EASY"
    || session.roomSettings.difficulty === "MEDIUM"
    || session.roomSettings.difficulty === "HARD"
    ? session.roomSettings.difficulty
    : "MEDIUM";
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function getSoloBotAnswerProfile(difficulty: NonNullable<RoomSettings["difficulty"]>) {
  if (difficulty === "EASY") {
    return { correctChance: 0.6, minDelayMs: 9000, maxDelayMs: 14000 };
  }
  if (difficulty === "HARD") {
    return { correctChance: 0.8, minDelayMs: 6000, maxDelayMs: 10000 };
  }
  return { correctChance: 0.7, minDelayMs: 7500, maxDelayMs: 12000 };
}

function scheduleNextBotAnswer(player: DemoPlayerState, difficulty: NonNullable<RoomSettings["difficulty"]>, now: number) {
  const profile = getSoloBotAnswerProfile(difficulty);
  player.nextBotAnswerAtMs = now + Math.round(randomBetween(profile.minDelayMs, profile.maxDelayMs));
}

function scoreDeltaToSpeedDeltaMps(pointsDelta: number) {
  return pointsDelta * KMH_TO_MPS;
}

function createAiPlayers(localPlayerId: string, count: number) {
  const names = [
    "Byte Rider",
    "Circuit Fox",
    "Vector Nova",
    "Pixel Dash",
    "Orbit Ace",
    "Turbo Tess",
    "Neon Max"
  ];

  return names.slice(0, count).map<DemoPlayerState>((displayName, index) => ({
    playerId: `${localPlayerId}-ai-${index + 1}`,
    displayName,
    laneIndex: Math.min(7, index + 1),
    positionMeters: 0,
    speedMps: 0,
    lap: 0,
    finished: false,
    racePhase: "lobby",
    carId: getRandomCarId(),
    score: 0,
    baseSpeedMps: DEMO_BASE_SPEED_MPS,
    aiPhase: (index + 1) * 1.35,
    aiVariance: 0.6 + index * 0.15,
    temporaryDeltaMps: 0,
    temporaryDeltaEndsAtMs: 0,
    nextBotAnswerAtMs: 0,
    lastBotAnswerAtMs: 0
  }));
}

function buildJoinMessage(payload: ConnectPayload): RoomJoinedMessage {
  const roomSettings = normalizeRoomSettings(payload.roomId, {
    ...buildDefaultRoomSettings(payload.roomId),
    ...payload.roomSettings
  });
  return {
    roomId: payload.roomId,
    targetPlayerId: payload.playerId,
    displayName: payload.displayName,
    trackLengthMeters: calculateDynamicTrackLengthMeters(roomSettings),
    totalLaps: DEMO_TOTAL_LAPS,
    baseSpeedMps: DEMO_BASE_SPEED_MPS,
    roomCreatorPlayerId: payload.playerId,
    roomSettings,
    carId: normalizeCarId(payload.carId)
  };
}

function buildJoinMessageFromLocalRoom(payload: ConnectPayload, room: LocalClassroomRoom): RoomJoinedMessage {
  return {
    roomId: room.roomId,
    targetPlayerId: payload.playerId,
    displayName: payload.displayName,
    trackLengthMeters: room.trackLengthMeters,
    totalLaps: room.totalLaps,
    baseSpeedMps: DEMO_BASE_SPEED_MPS,
    roomCreatorPlayerId: "",
    roomSettings: room.roomSettings,
    carId: normalizeCarId(payload.carId)
  };
}

function buildArithmeticQuestion(
  highwayChallenge: boolean,
  questionTimeLimitSeconds: number
): Omit<QuestionMessage, "roomId" | "targetPlayerId" | "questionId" | "expiresAtMs"> & { answer: number } {
  const timeLimitMs = Math.max(5000, Math.trunc(questionTimeLimitSeconds * 1000));
  if (highwayChallenge) {
    const left = 5 + Math.floor(Math.random() * 6);
    const right = 6 + Math.floor(Math.random() * 5);
    const offset = 8 + Math.floor(Math.random() * 15);
    return {
      prompt: `${left} x ${right} + ${offset}`,
      answer: (left * right) + offset,
      difficulty: 3,
      timeLimitMs,
      highwayChallenge: true
    };
  }

  const choice = Math.random();
  if (choice < 0.5) {
    const left = 7 + Math.floor(Math.random() * 20);
    const right = 6 + Math.floor(Math.random() * 18);
    return {
      prompt: `${left} + ${right}`,
      answer: left + right,
      difficulty: 1,
      timeLimitMs,
      highwayChallenge: false
    };
  }

  const left = 3 + Math.floor(Math.random() * 7);
  const right = 2 + Math.floor(Math.random() * 8);
  return {
    prompt: `${left} x ${right}`,
    answer: left * right,
    difficulty: 2,
    timeLimitMs,
    highwayChallenge: false
  };
}

function buildStateMessage(session: DemoSession): GameStateUpdateMessage {
  return {
    roomId: session.roomId,
    serverTimeMs: Date.now(),
    tick: session.tick,
    racePhase: session.racePhase,
    raceStartingAtMs: session.raceStartingAtMs,
    raceStartedAtMs: session.raceStartedAtMs,
    raceStopped: session.raceStopped,
    raceStoppedAtMs: session.raceStoppedAtMs,
    winnerPlayerId: session.winnerPlayerId,
    roomCreatorPlayerId: session.roomCreatorPlayerId,
    roomSettings: session.roomSettings,
    trackLengthMeters: session.trackLengthMeters,
    players: [...session.players].sort(compareStandings).map<PlayerSnapshot>((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      laneIndex: player.laneIndex,
      positionMeters: player.positionMeters,
      speedMps: player.speedMps,
      lap: player.lap,
      finished: player.finished,
        racePhase: player.racePhase,
        carId: normalizeCarId(player.carId),
        ready: Boolean(player.ready),
        correctAnswers: Math.max(0, Math.trunc(player.correctAnswers ?? 0)),
        wrongAnswers: Math.max(0, Math.trunc(player.wrongAnswers ?? 0)),
        timeoutAnswers: Math.max(0, Math.trunc(player.timeoutAnswers ?? 0)),
        score: Math.max(0, Math.trunc(player.score ?? 0)),
        streak: Math.max(0, Math.trunc(player.streak ?? 0)),
        averageAnswerTimeMs: Math.max(0, Math.trunc(player.averageAnswerTimeMs ?? 0)),
        routeMode: player.routeMode
      }))
  };
}

function buildFeedback(
  roomId: string,
  targetPlayerId: string,
  accepted: boolean,
  correct: boolean,
  extra: Partial<AnswerFeedbackMessage> = {}
): AnswerFeedbackMessage {
  return {
    roomId,
    targetPlayerId,
    accepted,
    correct,
    ...extra
  };
}

function difficultyToNumber(difficulty: RaceQuestionPrivate["difficulty"]) {
  return difficulty === "HARD" ? 3 : difficulty === "MEDIUM" ? 2 : 1;
}

function questionToMessage(session: DemoSession, question: RaceQuestionPrivate): QuestionMessage {
  return {
    roomId: session.roomId,
    targetPlayerId: session.localPlayerId,
    questionId: question.id,
    id: question.id,
    kind: question.kind,
    routeMode: question.routeMode,
    operation: question.operation,
    prompt: question.prompt,
    difficulty: difficultyToNumber(question.difficulty),
    difficultyLabel: question.difficulty,
    timeLimitMs: question.timeLimitSeconds * 1000,
    timeLimitSeconds: question.timeLimitSeconds,
    createdAtMs: question.createdAtMs,
    expiresAtMs: question.expiresAtMs,
    highwayChallenge: question.routeMode === "HIGHWAY"
  };
}

function getLocalPlayer(session: DemoSession) {
  return session.players.find((player) => player.playerId === session.localPlayerId) ?? null;
}

function isAiPlayer(session: DemoSession, player: DemoPlayerState) {
  return player.playerId !== session.localPlayerId;
}

function compareStandings(a: DemoPlayerState, b: DemoPlayerState) {
  const scoreDelta = Math.max(0, Math.trunc(b.score ?? 0)) - Math.max(0, Math.trunc(a.score ?? 0));
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  if (a.lap !== b.lap) {
    return b.lap - a.lap;
  }
  if (a.positionMeters !== b.positionMeters) {
    return b.positionMeters - a.positionMeters;
  }
  return a.playerId.localeCompare(b.playerId);
}

function syncDemoLobbyRoster(session: DemoSession) {
  const localPlayer = getLocalPlayer(session);
  if (!localPlayer) {
    return;
  }

  const desiredAiCount = Math.max(0, session.roomSettings.maxPlayers - 1);
  const desiredSoloAiCount = session.roomId.startsWith("solo-")
    ? normalizeSoloBotCount(session.soloBotCount)
    : desiredAiCount;
  session.players = [localPlayer, ...createAiPlayers(session.localPlayerId, desiredSoloAiCount)];
}

function toDemoPlayerState(player: PlayerSnapshot): DemoPlayerState {
  return {
    ...player,
    carId: normalizeCarId(player.carId),
    baseSpeedMps: DEMO_BASE_SPEED_MPS,
    aiPhase: 0,
    aiVariance: 0,
    temporaryDeltaMps: 0,
    temporaryDeltaEndsAtMs: 0,
    nextBotAnswerAtMs: 0,
    lastBotAnswerAtMs: 0
  };
}

export class DemoRaceClient {
  private intervalId: number | null = null;
  private connectTimeoutId: number | null = null;
  private lastTickAtMs = 0;
  private sessionToken = 0;
  private session: DemoSession | null = null;
  private localClassroomMode = false;
  private localClassroomUnsubscribe: (() => void) | null = null;

  async connect(payload: ConnectPayload) {
    await this.disconnect();
    useGameStore.getState().setConnection("connecting");
    const token = ++this.sessionToken;

    this.connectTimeoutId = window.setTimeout(() => {
      if (token !== this.sessionToken) {
        return;
      }

      const now = Date.now();
      const localRoom = readLocalClassroomRoom(payload.roomId);
      if (localRoom && !payload.roomId.startsWith("solo-")) {
        this.connectLocalClassroom(payload, localRoom, now, token);
        return;
      }

      const localPlayer: DemoPlayerState = {
        playerId: payload.playerId,
        displayName: payload.displayName,
        laneIndex: 0,
        positionMeters: 0,
        speedMps: 0,
        lap: 0,
        finished: false,
        racePhase: "lobby" as RacePhase,
        carId: normalizeCarId(payload.carId),
        ready: false,
        score: 0,
        correctAnswers: 0,
        wrongAnswers: 0,
        timeoutAnswers: 0,
        streak: 0,
        baseSpeedMps: DEMO_BASE_SPEED_MPS,
        aiPhase: 0,
        aiVariance: 0,
        temporaryDeltaMps: 0,
        temporaryDeltaEndsAtMs: 0,
        nextBotAnswerAtMs: 0,
        lastBotAnswerAtMs: 0
      };

      this.session = {
        roomId: payload.roomId,
        localPlayerId: payload.playerId,
        roomCreatorPlayerId: payload.playerId,
        roomSettings: normalizeRoomSettings(payload.roomId, {
          ...buildDefaultRoomSettings(payload.roomId),
          ...payload.roomSettings
        }),
        trackLengthMeters: calculateDynamicTrackLengthMeters(normalizeRoomSettings(payload.roomId, {
          ...buildDefaultRoomSettings(payload.roomId),
          ...payload.roomSettings
        })),
        totalLaps: DEMO_TOTAL_LAPS,
        racePhase: "lobby",
        raceStartingAtMs: 0,
        raceStartedAtMs: 0,
        raceStopped: false,
        raceStoppedAtMs: 0,
        winnerPlayerId: null,
        tick: 0,
        players: [localPlayer],
        nextEventAtMs: now,
        eventCount: 0,
        pendingQuestion: null,
        pendingDecision: null,
        questionState: createInitialPlayerQuestionState(),
        soloBotCount: normalizeSoloBotCount(payload.soloBotCount ?? 2)
      };
      syncDemoLobbyRoster(this.session);

      this.lastTickAtMs = now;
      useGameStore.getState().applyJoin(buildJoinMessage(payload));
      useGameStore.getState().applyStateUpdate(buildStateMessage(this.session!));

      this.intervalId = window.setInterval(() => this.tick(token), TICK_MS);
    }, 260);
  }

  async disconnect() {
    this.sessionToken += 1;
    if (this.connectTimeoutId !== null) {
      window.clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.lastTickAtMs = 0;
    this.session = null;
    this.localClassroomMode = false;
    if (this.localClassroomUnsubscribe) {
      this.localClassroomUnsubscribe();
      this.localClassroomUnsubscribe = null;
    }
  }

  leaveRoom() {
    void this.disconnect();
    useGameStore.getState().setConnection("idle");
    useGameStore.getState().resetSession();
  }

  submitAnswer(answer: string, timeout = false) {
    const session = this.session;
    if (!session) {
      return;
    }

    const pendingQuestion = session.pendingQuestion;
    if (!pendingQuestion) {
      useGameStore.getState().applyAnswerFeedback(
        buildFeedback(session.roomId, session.localPlayerId, false, false)
      );
      return;
    }

    const now = Date.now();
    const validation = validateAnswer(pendingQuestion.question, answer, timeout ? Math.max(now, pendingQuestion.question.expiresAtMs + 1) : now);
    this.applySoloAnswerResult(session, pendingQuestion.question, validation.resultType, validation.submittedAnswer, validation.expectedAnswer, now);
  }

  private applySoloAnswerResult(
    session: DemoSession,
    question: RaceQuestionPrivate,
    resultType: QuestionResultType,
    submittedAnswer: string,
    expectedAnswer: number,
    now: number
  ) {
    const correct = resultType === "CORRECT";
    const score = scoreAnswer(question, resultType);
    const answeredInMs = Math.max(
      0,
      Math.min(
        question.timeLimitSeconds * 1000,
        (question.timeLimitSeconds * 1000) - Math.max(0, question.expiresAtMs - now)
      )
    );
    const localPlayer = getLocalPlayer(session);
    if (localPlayer) {
      const targetScore = getTargetScore(session);
      const nextScore = Math.max(0, Math.min(targetScore, Math.trunc(localPlayer.score ?? 0) + score.pointsDelta));
      localPlayer.score = nextScore;
      if (nextScore >= targetScore) {
        localPlayer.finished = true;
        localPlayer.lap = session.totalLaps;
        localPlayer.racePhase = "finish";
        this.finishRace(session, localPlayer, now);
      }
    }
    this.applyTemporaryDelta(
      session.localPlayerId,
      scoreDeltaToSpeedDeltaMps(score.pointsDelta),
      DEMO_SPEED_MODIFIER_DURATION_MS
    );
    this.recordAnswerStats(session.localPlayerId, resultType, answeredInMs);

    const advanced = advanceQuestionStateAfterAnswer(session.questionState, question, resultType, now, getRoomDifficulty(session));
    session.questionState = advanced.state;
    useGameStore.getState().applyAnswerFeedback(
      buildFeedback(session.roomId, session.localPlayerId, true, correct, {
        resultType,
        feedback: score.feedback,
        pointsDelta: score.pointsDelta,
        progressDelta: score.progressDelta,
        updatedProgress: localPlayer?.score,
        streak: session.questionState.streak,
        submittedAnswer,
        expectedAnswer
      })
    );
    if (session.raceStopped) {
      return;
    }
    this.applyPromptResult(session, advanced, now);
  }

  private recordAnswerStats(playerId: string, resultType: QuestionResultType, answeredInMs: number) {
    const session = this.session;
    const player = session?.players.find((entry) => entry.playerId === playerId);
    const correct = resultType === "CORRECT";
    const wrong = resultType === "WRONG";
    if (player) {
      const previousAnswers = (player.correctAnswers ?? 0) + (player.wrongAnswers ?? 0) + (player.timeoutAnswers ?? 0);
      const previousAverage = player.averageAnswerTimeMs ?? 0;
      const nextAnswers = previousAnswers + 1;
      player.correctAnswers = (player.correctAnswers ?? 0) + (correct ? 1 : 0);
      player.wrongAnswers = (player.wrongAnswers ?? 0) + (wrong ? 1 : 0);
      player.timeoutAnswers = (player.timeoutAnswers ?? 0) + (resultType === "TIMEOUT" ? 1 : 0);
      player.streak = correct ? (player.streak ?? 0) + 1 : 0;
      player.averageAnswerTimeMs = Math.round(((previousAverage * previousAnswers) + answeredInMs) / nextAnswers);
    }

    if (!this.localClassroomMode || !session) {
      return;
    }
    updateLocalClassroomRoom(session.roomId, (room) => {
      const current = room.players[playerId];
      if (!current) {
        return room;
      }
      const previousAnswers = (current.correctAnswers ?? 0) + (current.wrongAnswers ?? 0) + (current.timeoutAnswers ?? 0);
      const previousAverage = current.averageAnswerTimeMs ?? 0;
      const nextAnswers = previousAnswers + 1;
      return {
        ...room,
        players: {
          ...room.players,
          [playerId]: {
            ...current,
            correctAnswers: (current.correctAnswers ?? 0) + (correct ? 1 : 0),
            wrongAnswers: (current.wrongAnswers ?? 0) + (wrong ? 1 : 0),
            timeoutAnswers: (current.timeoutAnswers ?? 0) + (resultType === "TIMEOUT" ? 1 : 0),
            streak: correct ? (current.streak ?? 0) + 1 : 0,
            averageAnswerTimeMs: Math.round(((previousAverage * previousAnswers) + answeredInMs) / nextAnswers)
          }
        }
      };
    });
  }

  submitDecision(choice: DecisionChoiceRequest["choice"]) {
    const session = this.session;
    if (!session || !session.pendingDecision) {
      return;
    }

    const now = Date.now();
    useGameStore.getState().clearDecision();
    const result = chooseRoute(session.questionState, choice === "HIGHWAY" ? "HIGHWAY" : "DIRT_ROAD", now);
    session.questionState = result.state;
    this.applyPromptResult(session, result, now);
  }

  startRace() {
    const session = this.session;
    if (!session || session.racePhase !== "lobby") {
      return;
    }
    if (this.localClassroomMode) {
      return;
    }

    const now = Date.now();
    syncDemoLobbyRoster(session);
    session.trackLengthMeters = calculateDynamicTrackLengthMeters(session.roomSettings);
    session.racePhase = "starting";
    session.raceStartingAtMs = now + DEMO_START_COUNTDOWN_MS;
    session.raceStartedAtMs = 0;
    session.raceStopped = false;
    session.raceStoppedAtMs = 0;
    session.winnerPlayerId = null;
    session.pendingQuestion = null;
    session.pendingDecision = null;
    session.questionState = createInitialPlayerQuestionState();
    for (const player of session.players) {
      player.positionMeters = 0;
      player.speedMps = 0;
      player.lap = 0;
      player.finished = false;
      player.racePhase = "starting";
      player.score = 0;
      player.correctAnswers = 0;
      player.wrongAnswers = 0;
      player.timeoutAnswers = 0;
      player.streak = 0;
      player.averageAnswerTimeMs = 0;
      player.temporaryDeltaMps = 0;
      player.temporaryDeltaEndsAtMs = 0;
      player.nextBotAnswerAtMs = 0;
      player.lastBotAnswerAtMs = 0;
    }
    session.nextEventAtMs = session.raceStartingAtMs + 4000;
    this.lastTickAtMs = now;
    if (this.intervalId === null) {
      const token = this.sessionToken;
      this.intervalId = window.setInterval(() => this.tick(token), TICK_MS);
    }
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();
    useGameStore.getState().applyStateUpdate(buildStateMessage(session));
  }

  updateRoomSettings(nextSettings: RoomSettings) {
    const session = this.session;
    if (!session || session.roomId.startsWith("solo-")) {
      return;
    }
    if (this.localClassroomMode) {
      return;
    }

    if (session.racePhase !== "lobby" || session.roomCreatorPlayerId !== session.localPlayerId) {
      return;
    }

    session.roomSettings = normalizeRoomSettings(
      session.roomId,
      nextSettings,
      2
    );
    syncDemoLobbyRoster(session);
    useGameStore.getState().applyStateUpdate(buildStateMessage(session));
  }

  returnToLobby() {
    const session = this.session;
    if (!session) {
      return;
    }
    if (this.localClassroomMode) {
      return;
    }

    const localPlayer = session.players.find((player) => player.playerId === session.localPlayerId);
    if (!localPlayer) {
      return;
    }

    for (const player of session.players) {
      player.positionMeters = 0;
      player.speedMps = 0;
      player.lap = 0;
      player.finished = false;
      player.racePhase = "lobby";
      player.score = 0;
      player.correctAnswers = 0;
      player.wrongAnswers = 0;
      player.timeoutAnswers = 0;
      player.streak = 0;
      player.averageAnswerTimeMs = 0;
      player.temporaryDeltaMps = 0;
      player.temporaryDeltaEndsAtMs = 0;
      player.nextBotAnswerAtMs = 0;
      player.lastBotAnswerAtMs = 0;
    }
    session.pendingQuestion = null;
    session.pendingDecision = null;
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();

    session.racePhase = "lobby";
    session.raceStartingAtMs = 0;
    session.raceStartedAtMs = 0;
    session.raceStopped = false;
    session.raceStoppedAtMs = 0;
    session.winnerPlayerId = null;
    session.tick = 0;
    syncDemoLobbyRoster(session);

    useGameStore.getState().applyStateUpdate(buildStateMessage(session));
  }

  private tick(token: number) {
    if (token !== this.sessionToken || !this.session) {
      return;
    }
    if (this.localClassroomMode) {
      this.tickLocalClassroom(token);
      return;
    }

    const session = this.session;
    const now = Date.now();
    const deltaSeconds = Math.max(0.04, Math.min(0.18, (now - this.lastTickAtMs) / 1000));
    this.lastTickAtMs = now;

    if (session.racePhase === "starting" && now >= session.raceStartingAtMs) {
      this.activateRace(session, session.raceStartingAtMs || now);
    }

    if (session.racePhase === "active" && !session.raceStopped) {
      this.advancePlayers(session, now, deltaSeconds);
      if (!session.raceStopped) {
        this.simulateBotAnswers(session, now);
        this.stopRaceIfTimerExpired(session, now);
        this.processPendingState(session, now);
        this.maybeOpenEvent(session, now);
      }
    }

    session.tick += 1;
    useGameStore.getState().applyStateUpdate(buildStateMessage(session));
  }

  setReady(ready: boolean) {
    const session = this.session;
    if (!session || !this.localClassroomMode) {
      return;
    }
    updateLocalClassroomRoom(session.roomId, (room) => {
      const player = room.players[session.localPlayerId];
      if (!player || room.racePhase !== "lobby") {
        return room;
      }
      return {
        ...room,
        players: {
          ...room.players,
          [player.playerId]: {
            ...player,
            ready
          }
        }
      };
    });
  }

  private connectLocalClassroom(payload: ConnectPayload, room: LocalClassroomRoom, now: number, token: number) {
    if (room.racePhase === "finish" || room.raceStopped) {
      useGameStore.getState().setConnection("error", "This classroom race has finished.");
      return;
    }
    const existingPlayer = room.players[payload.playerId];
    if (!existingPlayer && Object.keys(room.players).length >= room.roomSettings.maxPlayers) {
      useGameStore.getState().setConnection("error", "This classroom race is already full.");
      return;
    }

    const nextPlayer: PlayerSnapshot = {
      playerId: payload.playerId,
      displayName: payload.displayName,
      joinedAtMs: existingPlayer?.joinedAtMs ?? now,
      laneIndex: existingPlayer?.laneIndex ?? Object.keys(room.players).length,
      positionMeters: existingPlayer?.positionMeters ?? 0,
      speedMps: existingPlayer?.speedMps ?? 0,
      lap: existingPlayer?.lap ?? 0,
      finished: existingPlayer?.finished ?? false,
      racePhase: room.racePhase === "active" || room.racePhase === "starting" ? room.racePhase : "lobby",
      carId: normalizeCarId(payload.carId),
      ready: existingPlayer?.ready ?? false
    };

    const updatedRoom: LocalClassroomRoom = {
      ...room,
      removedPlayerIds: {
        ...room.removedPlayerIds,
        [payload.playerId]: 0
      },
      players: {
        ...room.players,
        [payload.playerId]: nextPlayer
      }
    };
    writeLocalClassroomRoom(updatedRoom);

    this.localClassroomMode = true;
    this.session = {
      roomId: updatedRoom.roomId,
      localPlayerId: payload.playerId,
      roomCreatorPlayerId: "",
      roomSettings: updatedRoom.roomSettings,
      trackLengthMeters: updatedRoom.trackLengthMeters,
      totalLaps: updatedRoom.totalLaps,
      racePhase: updatedRoom.racePhase,
      raceStartingAtMs: updatedRoom.raceStartingAtMs,
      raceStartedAtMs: updatedRoom.raceStartedAtMs,
      raceStopped: updatedRoom.raceStopped,
      raceStoppedAtMs: updatedRoom.raceStoppedAtMs,
      winnerPlayerId: updatedRoom.winnerPlayerId,
      tick: updatedRoom.tick,
      players: Object.values(updatedRoom.players).map(toDemoPlayerState),
      nextEventAtMs: now + 4000,
      eventCount: 0,
      pendingQuestion: null,
      pendingDecision: null,
      questionState: createInitialPlayerQuestionState(),
      soloBotCount: 0
    };

    this.localClassroomUnsubscribe = subscribeLocalClassroomRoom(updatedRoom.roomId, (nextRoom) => this.applyLocalClassroomRoom(nextRoom));
    this.lastTickAtMs = now;
    useGameStore.getState().applyJoin(buildJoinMessageFromLocalRoom(payload, updatedRoom));
    useGameStore.getState().applyStateUpdate(localRoomToStateUpdate(updatedRoom));
    useGameStore.getState().setConnection("connected");
    this.intervalId = window.setInterval(() => this.tick(token), TICK_MS);
  }

  private applyLocalClassroomRoom(room: LocalClassroomRoom) {
    const session = this.session;
    if (!session || !this.localClassroomMode) {
      return;
    }
    if (room.removedPlayerIds[session.localPlayerId] && !room.players[session.localPlayerId]) {
      useGameStore.getState().setConnection("error", "You were removed from this classroom race.");
      void this.disconnect();
      return;
    }
    if (room.closedAtMs || room.deletedAtMs) {
      useGameStore.getState().setConnection("error", room.deletedAtMs ? "This room is no longer available." : "This room was closed by the teacher.");
      void this.disconnect();
      return;
    }
    session.roomSettings = room.roomSettings;
    session.trackLengthMeters = room.trackLengthMeters;
    session.totalLaps = room.totalLaps;
    session.racePhase = room.racePhase;
    session.raceStartingAtMs = room.raceStartingAtMs;
    session.raceStartedAtMs = room.raceStartedAtMs;
    session.raceStopped = room.raceStopped;
    session.raceStoppedAtMs = room.raceStoppedAtMs;
    session.winnerPlayerId = room.winnerPlayerId;
    session.tick = room.tick;
    session.players = Object.values(room.players).map(toDemoPlayerState);
    useGameStore.getState().applyStateUpdate(localRoomToStateUpdate(room));
  }

  private tickLocalClassroom(token: number) {
    if (token !== this.sessionToken || !this.session) {
      return;
    }
    const session = this.session;
    const now = Date.now();
    const deltaSeconds = Math.max(0.04, Math.min(0.18, (now - this.lastTickAtMs) / 1000));
    this.lastTickAtMs = now;

    updateLocalClassroomRoom(session.roomId, (room) => {
      const localPlayer = room.players[session.localPlayerId];
      if (!localPlayer) {
        return room;
      }

      let racePhase = room.racePhase;
      const players = { ...room.players };
      if (racePhase === "starting" && now >= room.raceStartingAtMs) {
        racePhase = "active";
        for (const player of Object.values(players)) {
          players[player.playerId] = { ...player, racePhase: "active" };
        }
      }

      if (racePhase === "active" && !room.raceStopped) {
        const sessionLocal = getLocalPlayer(session);
        const activeDelta = sessionLocal && now < sessionLocal.temporaryDeltaEndsAtMs ? sessionLocal.temporaryDeltaMps : 0;
        const effectiveSpeed = clampSpeed(DEMO_BASE_SPEED_MPS + activeDelta + Math.sin(now / 1200) * 0.6);
        const nextPosition = Math.max(0, Math.min(room.trackLengthMeters, Math.trunc(localPlayer.score ?? 0)));
        const finished = nextPosition >= room.trackLengthMeters;
        players[localPlayer.playerId] = {
          ...localPlayer,
          positionMeters: nextPosition,
          speedMps: finished ? 0 : effectiveSpeed,
          lap: finished ? room.totalLaps : 0,
          finished,
          racePhase: finished ? "finish" : "active"
        };
      }

      const allFinished = Object.values(players).length > 0 && Object.values(players).every((player) => player.finished);
      const shouldFinish = racePhase === "active" && allFinished;
      const standings = Object.values(players).sort((left, right) => {
        if (left.lap !== right.lap) {
          return right.lap - left.lap;
        }
        return right.positionMeters - left.positionMeters;
      });

      return {
        ...room,
        racePhase: shouldFinish ? "finish" : racePhase,
        raceStartingAtMs: racePhase === "starting" ? room.raceStartingAtMs : 0,
        raceStartedAtMs: racePhase === "active" && room.raceStartedAtMs <= 0 ? now : room.raceStartedAtMs,
        raceStopped: shouldFinish,
        raceStoppedAtMs: shouldFinish ? now : 0,
        winnerPlayerId: shouldFinish ? standings[0]?.playerId ?? null : room.winnerPlayerId,
        players
      };
    });

    const latestRoom = readLocalClassroomRoom(session.roomId);
    if (latestRoom) {
      this.applyLocalClassroomRoom(latestRoom);
    }
    if (session.racePhase === "active" && !session.raceStopped) {
      this.processPendingState(session, now);
      this.maybeOpenEvent(session, now);
    }
  }

  private advancePlayers(session: DemoSession, now: number, deltaSeconds: number) {
    const targetScore = getTargetScore(session);
    for (const player of session.players) {
      if (player.racePhase !== "active") {
        player.speedMps = 0;
        continue;
      }

      if (player.finished) {
        player.speedMps = 0;
        continue;
      }

      const activeDelta = now < player.temporaryDeltaEndsAtMs ? player.temporaryDeltaMps : 0;
      if (now >= player.temporaryDeltaEndsAtMs) {
        player.temporaryDeltaMps = 0;
      }

      const aiWave = player.playerId === session.localPlayerId
        ? Math.sin(now / 1200) * 0.6
        : Math.sin((now / 1000) + player.aiPhase) * player.aiVariance;

      const effectiveSpeed = clampSpeed(player.baseSpeedMps + activeDelta + aiWave);
      player.speedMps = effectiveSpeed;
      player.positionMeters = Math.max(0, player.positionMeters + (effectiveSpeed * deltaSeconds));
      player.lap = Math.max(0, Math.floor(player.positionMeters / Math.max(1, session.trackLengthMeters)));

      if (Math.trunc(player.score ?? 0) >= targetScore) {
        player.finished = true;
        player.lap = session.totalLaps;
        player.racePhase = "finish";
        player.speedMps = 0;
        player.temporaryDeltaMps = 0;
        player.temporaryDeltaEndsAtMs = 0;
        if (!session.winnerPlayerId) {
          session.winnerPlayerId = player.playerId;
        }
        this.finishRace(session, player, now);
        return;
      }
    }
  }

  private simulateBotAnswers(session: DemoSession, now: number) {
    const difficulty = getRoomDifficulty(session);
    const profile = getSoloBotAnswerProfile(difficulty);
    const targetScore = getTargetScore(session);
    for (const player of session.players) {
      if (!isAiPlayer(session, player) || player.racePhase !== "active" || player.finished) {
        continue;
      }
      if (!player.nextBotAnswerAtMs || player.nextBotAnswerAtMs <= 0) {
        scheduleNextBotAnswer(player, difficulty, now);
        continue;
      }
      if (now < player.nextBotAnswerAtMs) {
        continue;
      }

      const question = ensureNextPrompt(createInitialPlayerQuestionState(), now, difficulty).nextQuestion;
      if (!question) {
        scheduleNextBotAnswer(player, difficulty, now);
        continue;
      }

      const resultType: QuestionResultType = Math.random() < profile.correctChance ? "CORRECT" : "WRONG";
      const score = scoreAnswer(question, resultType);
      const previousScore = Math.max(0, Math.trunc(player.score ?? 0));
      const nextScore = Math.max(0, Math.min(targetScore, previousScore + score.pointsDelta));
      player.score = nextScore;
      player.lastBotAnswerAtMs = now;
      player.correctAnswers = Math.max(0, Math.trunc(player.correctAnswers ?? 0)) + (resultType === "CORRECT" ? 1 : 0);
      player.wrongAnswers = Math.max(0, Math.trunc(player.wrongAnswers ?? 0)) + (resultType === "WRONG" ? 1 : 0);
      player.streak = resultType === "CORRECT" ? Math.max(0, Math.trunc(player.streak ?? 0)) + 1 : 0;
      player.temporaryDeltaMps = scoreDeltaToSpeedDeltaMps(score.pointsDelta);
      player.temporaryDeltaEndsAtMs = now + DEMO_SPEED_MODIFIER_DURATION_MS;

      if (nextScore >= targetScore) {
        player.finished = true;
        player.lap = session.totalLaps;
        player.racePhase = "finish";
        this.finishRace(session, player, now);
        return;
      }
      scheduleNextBotAnswer(player, difficulty, now);
    }
  }

  private stopRaceIfTimerExpired(session: DemoSession, now: number) {
    void session;
    void now;
  }

  private processPendingState(session: DemoSession, now: number) {
    const localPlayer = getLocalPlayer(session);
    if (session.racePhase !== "active" || localPlayer?.racePhase !== "active") {
      return;
    }

    if (session.pendingQuestion && now > session.pendingQuestion.question.expiresAtMs) {
      this.applySoloAnswerResult(session, session.pendingQuestion.question, "TIMEOUT", "", session.pendingQuestion.question.correctAnswer, now);
    }

    if (session.pendingDecision && now > session.pendingDecision.expiresAtMs) {
      useGameStore.getState().clearDecision();
      const result = chooseRoute(session.questionState, "DIRT_ROAD", now);
      session.questionState = result.state;
      this.applyPromptResult(session, result, now);
    }
  }

  private maybeOpenEvent(session: DemoSession, now: number) {
    const localPlayer = getLocalPlayer(session);
    if (session.racePhase !== "active" || localPlayer?.racePhase !== "active") {
      return;
    }

    if (session.pendingQuestion || session.pendingDecision || now < session.nextEventAtMs) {
      return;
    }

    session.eventCount += 1;
    const result = ensureNextPrompt(session.questionState, now, getRoomDifficulty(session));
    session.questionState = result.state;
    this.applyPromptResult(session, result, now);
  }

  private openQuestion(session: DemoSession, now: number, highwayChallenge: boolean) {
    if (getLocalPlayer(session)?.racePhase !== "active") {
      return;
    }

    const result = highwayChallenge
      ? chooseRoute(session.questionState, "HIGHWAY", now)
      : ensureNextPrompt(session.questionState, now, getRoomDifficulty(session));
    session.questionState = result.state;
    this.applyPromptResult(session, result, now);
  }

  private openDecision(session: DemoSession, now: number) {
    if (getLocalPlayer(session)?.racePhase !== "active") {
      return;
    }

    const expiresAtMs = now + 7000;
    const message: DecisionPointMessage = {
      roomId: session.roomId,
      targetPlayerId: session.localPlayerId,
      eventId: buildDecisionId(),
      prompt: DEMO_DECISION_PROMPT,
      options: DEMO_DECISION_OPTIONS,
      expiresAtMs
    };

    session.pendingDecision = {
      eventId: message.eventId,
      expiresAtMs
    };
    session.nextEventAtMs = expiresAtMs + 3600;
    useGameStore.getState().applyDecision(message);
  }

  private applyPromptResult(
    session: DemoSession,
    result: ReturnType<typeof ensureNextPrompt> | ReturnType<typeof chooseRoute>,
    now: number
  ) {
    session.pendingQuestion = null;
    session.pendingDecision = null;
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();

    if (result.nextQuestion) {
      session.pendingQuestion = { question: result.nextQuestion };
      session.nextEventAtMs = result.nextQuestion.expiresAtMs + 3200;
      useGameStore.getState().applyQuestion(questionToMessage(session, result.nextQuestion));
      return;
    }

    if (result.routeChoice) {
      session.pendingDecision = {
        eventId: result.routeChoice.id,
        expiresAtMs: result.routeChoice.expiresAtMs
      };
      session.nextEventAtMs = result.routeChoice.expiresAtMs + 3600;
      useGameStore.getState().applyDecision({
        roomId: session.roomId,
        targetPlayerId: session.localPlayerId,
        eventId: result.routeChoice.id,
        prompt: DEMO_DECISION_PROMPT,
        options: ["HIGHWAY", "DIRT"],
        expiresAtMs: result.routeChoice.expiresAtMs
      });
      return;
    }

    session.nextEventAtMs = now + 2000;
  }

  private expireQuestion(session: DemoSession, now: number) {
    if (session.pendingQuestion) {
      this.applySoloAnswerResult(
        session,
        session.pendingQuestion.question,
        "TIMEOUT",
        "",
        session.pendingQuestion.question.correctAnswer,
        now
      );
    }
  }

  private applyTemporaryDelta(playerId: string, deltaMps: number, durationMs: number) {
    const session = this.session;
    if (!session) {
      return;
    }

    const player = session.players.find((entry) => entry.playerId === playerId);
    if (!player) {
      return;
    }

    player.temporaryDeltaMps = deltaMps;
    player.temporaryDeltaEndsAtMs = Date.now() + durationMs;
  }

  private activateRace(session: DemoSession, startAtMs: number) {
    session.racePhase = "active";
    session.raceStartingAtMs = 0;
    session.raceStartedAtMs = startAtMs;
    session.raceStopped = false;
    session.raceStoppedAtMs = 0;
    session.winnerPlayerId = null;
    session.pendingQuestion = null;
    session.pendingDecision = null;
    session.nextEventAtMs = startAtMs;
    for (const player of session.players) {
      player.racePhase = "active";
      player.baseSpeedMps = DEMO_BASE_SPEED_MPS;
      if (isAiPlayer(session, player)) {
        scheduleNextBotAnswer(player, getRoomDifficulty(session), startAtMs);
      }
    }
    this.lastTickAtMs = startAtMs;
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();
    const result = ensureNextPrompt(session.questionState, startAtMs, getRoomDifficulty(session));
    session.questionState = result.state;
    this.applyPromptResult(session, result, startAtMs);
  }

  private finishRace(session: DemoSession, winner: DemoPlayerState | null, finishedAtMs: number) {
    session.racePhase = "finish";
    session.raceStartingAtMs = 0;
    session.raceStopped = true;
    session.raceStoppedAtMs = finishedAtMs;
    session.winnerPlayerId = winner?.playerId ?? null;
    session.pendingQuestion = null;
    session.pendingDecision = null;
    session.questionState = createInitialPlayerQuestionState();
    for (const player of session.players) {
      if (player.racePhase === "active" || player.racePhase === "starting") {
        player.racePhase = "finish";
      }
      if (player.playerId !== winner?.playerId) {
        player.speedMps = 0;
      }
    }
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();
  }
}
