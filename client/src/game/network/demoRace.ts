import { useGameStore } from "../store/useGameStore";
import type {
  AnswerFeedbackMessage,
  ConnectPayload,
  DecisionChoiceRequest,
  DecisionPointMessage,
  GameStateUpdateMessage,
  PlayerSnapshot,
  QuestionMessage,
  RoomJoinedMessage
} from "../types/messages";

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
  trackLengthMeters: number;
  totalLaps: number;
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

function createAiPlayers(roomId: string, localPlayerId: string) {
  const names = roomId.startsWith("solo-")
    ? ["Byte Rider", "Circuit Fox"]
    : ["Byte Rider", "Circuit Fox", "Vector Nova"];

  return names.map((displayName, index) => ({
    playerId: `${localPlayerId}-ai-${index + 1}`,
    displayName,
    laneIndex: Math.min(3, index + 1),
    positionMeters: 0,
    speedMps: 0,
    lap: 0,
    finished: false,
    baseSpeedMps: 26.6 + index * 1.15,
    aiPhase: (index + 1) * 1.35,
    aiVariance: 2 + index * 0.45,
    temporaryDeltaMps: 0,
    temporaryDeltaEndsAtMs: 0
  }));
}

function buildJoinMessage(payload: ConnectPayload): RoomJoinedMessage {
  return {
    roomId: payload.roomId,
    targetPlayerId: payload.playerId,
    displayName: payload.displayName,
    trackLengthMeters: DEMO_TRACK_LENGTH_METERS,
    totalLaps: DEMO_TOTAL_LAPS,
    baseSpeedMps: 28
  };
}

function buildArithmeticQuestion(highwayChallenge: boolean): Omit<QuestionMessage, "roomId" | "targetPlayerId" | "questionId" | "expiresAtMs"> & { answer: number } {
  if (highwayChallenge) {
    const left = 5 + Math.floor(Math.random() * 6);
    const right = 6 + Math.floor(Math.random() * 5);
    const offset = 8 + Math.floor(Math.random() * 15);
    return {
      prompt: `${left} x ${right} + ${offset}`,
      answer: (left * right) + offset,
      difficulty: 3,
      timeLimitMs: 9000,
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
      timeLimitMs: 7000,
      highwayChallenge: false
    };
  }

  const left = 3 + Math.floor(Math.random() * 7);
  const right = 2 + Math.floor(Math.random() * 8);
  return {
    prompt: `${left} x ${right}`,
    answer: left * right,
    difficulty: 2,
    timeLimitMs: 7500,
    highwayChallenge: false
  };
}

function buildStateMessage(session: DemoSession): GameStateUpdateMessage {
  return {
    roomId: session.roomId,
    serverTimeMs: Date.now(),
    tick: session.tick,
    raceStartedAtMs: session.raceStartedAtMs,
    raceStopped: session.raceStopped,
    raceStoppedAtMs: session.raceStoppedAtMs,
    winnerPlayerId: session.winnerPlayerId,
    players: session.players.map<PlayerSnapshot>((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      laneIndex: player.laneIndex,
      positionMeters: player.positionMeters,
      speedMps: player.speedMps,
      lap: player.lap,
      finished: player.finished
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
        baseSpeedMps: 28,
        aiPhase: 0,
        aiVariance: 0,
        temporaryDeltaMps: 0,
        temporaryDeltaEndsAtMs: 0
      };

      this.session = {
        roomId: payload.roomId,
        localPlayerId: payload.playerId,
        trackLengthMeters: DEMO_TRACK_LENGTH_METERS,
        totalLaps: DEMO_TOTAL_LAPS,
        raceStartedAtMs: now,
        raceStopped: false,
        raceStoppedAtMs: 0,
        winnerPlayerId: null,
        tick: 0,
        players: [localPlayer, ...createAiPlayers(payload.roomId, payload.playerId)],
        nextEventAtMs: now + 4000,
        eventCount: 0,
        pendingQuestion: null,
        pendingDecision: null
      };

      this.lastTickAtMs = now;
      useGameStore.getState().applyJoin(buildJoinMessage(payload));
      useGameStore.getState().applyStateUpdate(buildStateMessage(this.session));

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

  private tick(token: number) {
    if (token !== this.sessionToken || !this.session) {
      return;
    }

    const session = this.session;
    const now = Date.now();
    const deltaSeconds = Math.max(0.04, Math.min(0.18, (now - this.lastTickAtMs) / 1000));
    this.lastTickAtMs = now;

    if (!session.raceStopped) {
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
      session.raceStopped = true;
      session.raceStoppedAtMs = now;
      session.winnerPlayerId = raceWinner.playerId;
      session.pendingQuestion = null;
      session.pendingDecision = null;
      useGameStore.getState().clearQuestion();
      useGameStore.getState().clearDecision();
    }
  }

  private processPendingState(session: DemoSession, now: number) {
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
    const base = buildArithmeticQuestion(highwayChallenge);
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
}
