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
import { buildDefaultRoomSettings, normalizeRoomSettings } from "../utils/roomSettings";

interface DemoPlayerState extends PlayerSnapshot {
  baseSpeedMps: number;
  aiPhase: number;
  aiVariance: number;
  temporaryDeltaMps: number;
  temporaryDeltaEndsAtMs: number;
}

interface PendingQuestion {
  questionId: string;
  prompt: string;
  answer: number;
  expiresAtMs: number;
  timeLimitMs: number;
  highwayChallenge: boolean;
  difficulty: number;
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
}

const TICK_MS = 100;
const DEMO_TRACK_LENGTH_METERS = 1400;
const DEMO_TOTAL_LAPS = 1;
const DEMO_START_COUNTDOWN_MS = 2600;
const DEMO_DECISION_PROMPT = "Choose your route";
const DEMO_DECISION_OPTIONS = ["HIGHWAY", "DIRT"];

function buildQuestionId() {
  return `q-${Math.random().toString(36).slice(2, 10)}`;
}

function buildDecisionId() {
  return `d-${Math.random().toString(36).slice(2, 10)}`;
}

function clampSpeed(speedMps: number) {
  return Math.max(14, speedMps);
}

function createAiPlayers(localPlayerId: string, count: number) {
  const names = ["Byte Rider", "Circuit Fox", "Vector Nova"];

  return names.slice(0, count).map<DemoPlayerState>((displayName, index) => ({
    playerId: `${localPlayerId}-ai-${index + 1}`,
    displayName,
    laneIndex: Math.min(3, index + 1),
    positionMeters: 0,
    speedMps: 0,
    lap: 0,
    finished: false,
    racePhase: "lobby",
    baseSpeedMps: 26.6 + index * 1.15,
    aiPhase: (index + 1) * 1.35,
    aiVariance: 2 + index * 0.45,
    temporaryDeltaMps: 0,
    temporaryDeltaEndsAtMs: 0
  }));
}

function buildJoinMessage(payload: ConnectPayload): RoomJoinedMessage {
  const roomSettings = buildDefaultRoomSettings(payload.roomId);
  return {
    roomId: payload.roomId,
    targetPlayerId: payload.playerId,
    displayName: payload.displayName,
    trackLengthMeters: DEMO_TRACK_LENGTH_METERS,
    totalLaps: DEMO_TOTAL_LAPS,
    baseSpeedMps: 28,
    roomCreatorPlayerId: payload.playerId,
    roomSettings
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
    players: session.players.map<PlayerSnapshot>((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      laneIndex: player.laneIndex,
      positionMeters: player.positionMeters,
      speedMps: player.speedMps,
      lap: player.lap,
      finished: player.finished,
      racePhase: player.racePhase
    }))
  };
}

function buildFeedback(roomId: string, targetPlayerId: string, accepted: boolean, correct: boolean): AnswerFeedbackMessage {
  return {
    roomId,
    targetPlayerId,
    accepted,
    correct
  };
}

function getLocalPlayer(session: DemoSession) {
  return session.players.find((player) => player.playerId === session.localPlayerId) ?? null;
}

function syncDemoLobbyRoster(session: DemoSession) {
  const localPlayer = getLocalPlayer(session);
  if (!localPlayer) {
    return;
  }

  const desiredAiCount = session.roomId.startsWith("solo-")
    ? 2
    : Math.max(0, session.roomSettings.maxPlayers - 1);
  session.players = [localPlayer, ...createAiPlayers(session.localPlayerId, desiredAiCount)];
}

export class DemoRaceClient {
  private intervalId: number | null = null;
  private connectTimeoutId: number | null = null;
  private lastTickAtMs = 0;
  private sessionToken = 0;
  private session: DemoSession | null = null;

  async connect(payload: ConnectPayload) {
    await this.disconnect();
    useGameStore.getState().setConnection("connecting");
    const token = ++this.sessionToken;

    this.connectTimeoutId = window.setTimeout(() => {
      if (token !== this.sessionToken) {
        return;
      }

      const now = Date.now();
      const localPlayer: DemoPlayerState = {
        playerId: payload.playerId,
        displayName: payload.displayName,
        laneIndex: 0,
        positionMeters: 0,
        speedMps: 0,
        lap: 0,
        finished: false,
        racePhase: "lobby" as RacePhase,
        baseSpeedMps: 28,
        aiPhase: 0,
        aiVariance: 0,
        temporaryDeltaMps: 0,
        temporaryDeltaEndsAtMs: 0
      };

      this.session = {
        roomId: payload.roomId,
        localPlayerId: payload.playerId,
        roomCreatorPlayerId: payload.playerId,
        roomSettings: normalizeRoomSettings(payload.roomId, buildDefaultRoomSettings(payload.roomId)),
        trackLengthMeters: DEMO_TRACK_LENGTH_METERS,
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
        pendingDecision: null
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
  }

  leaveRoom() {
    void this.disconnect();
    useGameStore.getState().setConnection("idle");
    useGameStore.getState().resetSession();
  }

  submitAnswer(answer: string) {
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
    if (now > pendingQuestion.expiresAtMs) {
      this.expireQuestion(session, now);
      return;
    }

    const numericAnswer = Number(answer.trim());
    const correct = Number.isFinite(numericAnswer) && numericAnswer === pendingQuestion.answer;
    this.applyTemporaryDelta(
      session.localPlayerId,
      correct ? (pendingQuestion.highwayChallenge ? 16 : 11) : (pendingQuestion.highwayChallenge ? -10 : -7),
      correct ? (pendingQuestion.highwayChallenge ? 5200 : 3400) : 2400
    );

    useGameStore.getState().applyAnswerFeedback(
      buildFeedback(session.roomId, session.localPlayerId, true, correct)
    );
    session.pendingQuestion = null;
    useGameStore.getState().clearQuestion();
    session.nextEventAtMs = now + (correct ? 4500 : 3400);
  }

  submitDecision(choice: DecisionChoiceRequest["choice"]) {
    const session = this.session;
    if (!session || !session.pendingDecision) {
      return;
    }

    const now = Date.now();
    session.pendingDecision = null;
    useGameStore.getState().clearDecision();

    if (choice === "DIRT") {
      this.applyTemporaryDelta(session.localPlayerId, 6, 2600);
      session.nextEventAtMs = now + 3800;
      return;
    }

    this.openQuestion(session, now, true);
  }

  startRace() {
    const session = this.session;
    if (!session || session.racePhase !== "lobby") {
      return;
    }

    const now = Date.now();
    session.racePhase = "starting";
    session.raceStartingAtMs = now + DEMO_START_COUNTDOWN_MS;
    session.raceStartedAtMs = 0;
    session.raceStopped = false;
    session.raceStoppedAtMs = 0;
    session.winnerPlayerId = null;
    session.pendingQuestion = null;
    session.pendingDecision = null;
    for (const player of session.players) {
      player.positionMeters = 0;
      player.speedMps = 0;
      player.lap = 0;
      player.finished = false;
      player.racePhase = "starting";
      player.temporaryDeltaMps = 0;
      player.temporaryDeltaEndsAtMs = 0;
    }
    session.nextEventAtMs = session.raceStartingAtMs + 4000;
    this.lastTickAtMs = now;
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();
    useGameStore.getState().applyStateUpdate(buildStateMessage(session));
  }

  updateRoomSettings(nextSettings: RoomSettings) {
    const session = this.session;
    if (!session || session.roomId.startsWith("solo-")) {
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

    const localPlayer = session.players.find((player) => player.playerId === session.localPlayerId);
    if (!localPlayer) {
      return;
    }

    localPlayer.positionMeters = 0;
    localPlayer.speedMps = 0;
    localPlayer.lap = 0;
    localPlayer.finished = false;
    localPlayer.racePhase = "lobby";
    localPlayer.temporaryDeltaMps = 0;
    localPlayer.temporaryDeltaEndsAtMs = 0;
    session.pendingQuestion = null;
    session.pendingDecision = null;
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();

    if (session.players.every((player) => player.racePhase === "lobby")) {
      session.racePhase = "lobby";
      session.raceStartingAtMs = 0;
      session.raceStartedAtMs = 0;
      session.raceStopped = false;
      session.raceStoppedAtMs = 0;
      session.winnerPlayerId = null;
      session.tick = 0;
    }

    useGameStore.getState().applyStateUpdate(buildStateMessage(session));
  }

  private tick(token: number) {
    if (token !== this.sessionToken || !this.session) {
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
      this.processPendingState(session, now);
      this.maybeOpenEvent(session, now);
    }

    session.tick += 1;
    useGameStore.getState().applyStateUpdate(buildStateMessage(session));

    if (session.raceStopped && this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private advancePlayers(session: DemoSession, now: number, deltaSeconds: number) {
    let raceWinner: DemoPlayerState | null = null;

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
      player.positionMeters = Math.min(
        session.trackLengthMeters,
        player.positionMeters + (effectiveSpeed * deltaSeconds)
      );
      player.lap = player.positionMeters >= session.trackLengthMeters ? session.totalLaps - 1 : 0;

      if (player.positionMeters >= session.trackLengthMeters) {
        player.finished = true;
        player.speedMps = 0;
        if (!raceWinner) {
          raceWinner = player;
        }
      }
    }

    if (raceWinner) {
      this.finishRace(session, raceWinner, now);
    }
  }

  private processPendingState(session: DemoSession, now: number) {
    const localPlayer = getLocalPlayer(session);
    if (session.racePhase !== "active" || localPlayer?.racePhase !== "active") {
      return;
    }

    if (session.pendingQuestion && now > session.pendingQuestion.expiresAtMs) {
      this.expireQuestion(session, now);
    }

    if (session.pendingDecision && now > session.pendingDecision.expiresAtMs) {
      session.pendingDecision = null;
      useGameStore.getState().clearDecision();
      this.applyTemporaryDelta(session.localPlayerId, 5, 2200);
      session.nextEventAtMs = now + 3600;
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
    if (session.eventCount % 3 === 0) {
      this.openDecision(session, now);
      return;
    }

    this.openQuestion(session, now, false);
  }

  private openQuestion(session: DemoSession, now: number, highwayChallenge: boolean) {
    if (getLocalPlayer(session)?.racePhase !== "active") {
      return;
    }

    const base = buildArithmeticQuestion(highwayChallenge, session.roomSettings.questionTimeLimitSeconds);
    const questionId = buildQuestionId();
    const expiresAtMs = now + base.timeLimitMs;
    const message: QuestionMessage = {
      roomId: session.roomId,
      targetPlayerId: session.localPlayerId,
      questionId,
      prompt: base.prompt,
      difficulty: base.difficulty,
      timeLimitMs: base.timeLimitMs,
      expiresAtMs,
      highwayChallenge: base.highwayChallenge
    };

    session.pendingQuestion = {
      questionId,
      prompt: base.prompt,
      answer: base.answer,
      expiresAtMs,
      timeLimitMs: base.timeLimitMs,
      highwayChallenge: base.highwayChallenge,
      difficulty: base.difficulty
    };
    session.nextEventAtMs = expiresAtMs + 3200;
    useGameStore.getState().applyQuestion(message);
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

  private expireQuestion(session: DemoSession, now: number) {
    session.pendingQuestion = null;
    useGameStore.getState().clearQuestion();
    useGameStore.getState().applyAnswerFeedback(
      buildFeedback(session.roomId, session.localPlayerId, false, false)
    );
    this.applyTemporaryDelta(session.localPlayerId, -6, 2200);
    session.nextEventAtMs = now + 3200;
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
    session.nextEventAtMs = startAtMs + 4000;
    for (const player of session.players) {
      player.racePhase = "active";
    }
    this.lastTickAtMs = startAtMs;
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();
  }

  private finishRace(session: DemoSession, winner: DemoPlayerState, finishedAtMs: number) {
    session.racePhase = "finish";
    session.raceStartingAtMs = 0;
    session.raceStopped = true;
    session.raceStoppedAtMs = finishedAtMs;
    session.winnerPlayerId = winner.playerId;
    session.pendingQuestion = null;
    session.pendingDecision = null;
    for (const player of session.players) {
      if (player.racePhase === "active" || player.racePhase === "starting") {
        player.racePhase = "finish";
      }
      if (player.playerId !== winner.playerId) {
        player.speedMps = 0;
      }
    }
    useGameStore.getState().clearQuestion();
    useGameStore.getState().clearDecision();
  }
}
