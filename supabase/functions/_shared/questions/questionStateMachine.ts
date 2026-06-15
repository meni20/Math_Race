import { generateArithmeticQuestion, generateWordProblem } from "./questionEngine.ts";
import {
  DIRT_ROAD_STEPS,
  ROUTE_CHOICE_STREAK,
  ROUTE_CHOICE_TIME_LIMIT_SECONDS
} from "./scoringConfig.ts";
import type {
  Difficulty,
  PlayerQuestionState,
  QuestionResultType,
  RaceQuestionPrivate,
  RouteChoicePrompt,
  RouteMode
} from "./questionTypes.ts";

type AdvanceResult = {
  state: PlayerQuestionState;
  nextQuestion?: RaceQuestionPrivate;
  routeChoice?: RouteChoicePrompt;
  events: string[];
};

const NORMAL_OPERATION_SEQUENCE = ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"] as const;
const DIFFICULTY_ORDER: Difficulty[] = ["EASY", "MEDIUM", "HARD"];

function randomId(prefix: string) {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUUID ? randomUUID() : `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createInitialPlayerQuestionState(): PlayerQuestionState {
  return {
    routeMode: "NORMAL",
    streak: 0,
    routeStep: 0,
    routeStepsTotal: 0,
    answeredQuestionIds: []
  };
}

export function normalizePlayerQuestionState(state: Partial<PlayerQuestionState> | null | undefined): PlayerQuestionState {
  const routeMode = state?.routeMode === "ROUTE_CHOICE"
    || state?.routeMode === "DIRT_ROAD"
    || state?.routeMode === "HIGHWAY"
    || state?.routeMode === "NORMAL"
    ? state.routeMode
    : "NORMAL";
  return {
    routeMode,
    streak: Math.max(0, Math.trunc(state?.streak ?? 0)),
    routeStep: Math.max(0, Math.trunc(state?.routeStep ?? 0)),
    routeStepsTotal: Math.max(0, Math.trunc(state?.routeStepsTotal ?? 0)),
    currentQuestion: state?.currentQuestion,
    answeredQuestionIds: Array.isArray(state?.answeredQuestionIds) ? state.answeredQuestionIds.slice(-50) : []
  };
}

export function hasAnsweredQuestion(state: PlayerQuestionState, questionId: string) {
  return state.answeredQuestionIds.includes(questionId);
}

export function markQuestionAnswered(state: PlayerQuestionState, questionId: string): PlayerQuestionState {
  if (hasAnsweredQuestion(state, questionId)) {
    return state;
  }
  return {
    ...state,
    answeredQuestionIds: [...state.answeredQuestionIds, questionId].slice(-50)
  };
}

export function createRouteChoicePrompt(nowMs: number, id = randomId("route")): RouteChoicePrompt {
  return {
    id,
    prompt: "בחרו מסלול: כביש מהיר או דרך עפר.",
    options: ["HIGHWAY", "DIRT_ROAD"],
    createdAtMs: nowMs,
    expiresAtMs: nowMs + (ROUTE_CHOICE_TIME_LIMIT_SECONDS * 1000)
  };
}

function capDifficulty(difficulty: Difficulty, configuredDifficulty?: Difficulty): Difficulty {
  if (!configuredDifficulty) {
    return difficulty;
  }
  const difficultyIndex = DIFFICULTY_ORDER.indexOf(difficulty);
  const capIndex = DIFFICULTY_ORDER.indexOf(configuredDifficulty);
  return DIFFICULTY_ORDER[Math.min(difficultyIndex, capIndex)] ?? difficulty;
}

function getNormalQuestionPlan(state: PlayerQuestionState, configuredDifficulty?: Difficulty) {
  const step = Math.min(NORMAL_OPERATION_SEQUENCE.length - 1, Math.floor(state.streak / 2));
  const operation = NORMAL_OPERATION_SEQUENCE[step];
  const progressionDifficulty: Difficulty = step <= 1 ? "EASY" : step === 2 ? "MEDIUM" : "HARD";
  return {
    difficulty: capDifficulty(progressionDifficulty, configuredDifficulty),
    operation
  };
}

function generateNormalQuestion(state: PlayerQuestionState, nowMs: number, configuredDifficulty?: Difficulty) {
  const plan = getNormalQuestionPlan(state, configuredDifficulty);
  return generateArithmeticQuestion({
    difficulty: plan.difficulty,
    operation: plan.operation,
    routeMode: "NORMAL",
    nowMs
  });
}

function withCurrentQuestion(state: PlayerQuestionState, question: RaceQuestionPrivate): AdvanceResult {
  return {
    state: {
      ...state,
      currentQuestion: question
    },
    nextQuestion: question,
    events: []
  };
}

export function ensureNextPrompt(stateInput: PlayerQuestionState, nowMs: number, difficulty?: Difficulty): AdvanceResult {
  const state = normalizePlayerQuestionState(stateInput);
  if (state.currentQuestion && nowMs <= state.currentQuestion.expiresAtMs) {
    return withCurrentQuestion(state, state.currentQuestion);
  }
  if (state.routeMode === "ROUTE_CHOICE") {
    return {
      state: { ...state, currentQuestion: undefined },
      routeChoice: createRouteChoicePrompt(nowMs),
      events: ["ROUTE_CHOICE_UNLOCKED"]
    };
  }
  if (state.routeMode === "HIGHWAY") {
    return withCurrentQuestion(state, generateWordProblem({
      difficulty: "HARD",
      operation: "MIXED",
      routeMode: "HIGHWAY",
      nowMs
    }));
  }
  if (state.routeMode === "DIRT_ROAD") {
    return withCurrentQuestion(state, generateArithmeticQuestion({
      difficulty: "EASY",
      operation: "MIXED",
      routeMode: "DIRT_ROAD",
      nowMs
    }));
  }
  return withCurrentQuestion(state, generateNormalQuestion(state, nowMs, difficulty));
}

export function advanceQuestionStateAfterAnswer(
  stateInput: PlayerQuestionState,
  question: RaceQuestionPrivate,
  resultType: QuestionResultType,
  nowMs: number,
  difficulty?: Difficulty
): AdvanceResult {
  const answeredState = markQuestionAnswered(normalizePlayerQuestionState(stateInput), question.id);
  const events: string[] = [];

  if (question.routeMode === "HIGHWAY") {
    events.push(resultType === "CORRECT" ? "HIGHWAY_SUCCESS" : "HIGHWAY_FAILED");
    const state = {
      ...answeredState,
      routeMode: "NORMAL" as const,
      streak: 0,
      routeStep: 0,
      routeStepsTotal: 0,
      currentQuestion: undefined
    };
    const next = generateNormalQuestion(state, nowMs, difficulty);
    return {
      state: { ...state, currentQuestion: next },
      nextQuestion: next,
      events
    };
  }

  if (question.routeMode === "DIRT_ROAD") {
    const nextStep = answeredState.routeStep + 1;
    if (nextStep >= DIRT_ROAD_STEPS) {
      events.push("DIRT_ROAD_COMPLETED");
      const state = {
        ...answeredState,
        routeMode: "NORMAL" as const,
        streak: 0,
        routeStep: 0,
        routeStepsTotal: 0,
        currentQuestion: undefined
      };
      const next = generateNormalQuestion(state, nowMs, difficulty);
      return {
        state: { ...state, currentQuestion: next },
        nextQuestion: next,
        events
      };
    }
    const state = {
      ...answeredState,
      routeMode: "DIRT_ROAD" as const,
      routeStep: nextStep,
      routeStepsTotal: DIRT_ROAD_STEPS,
      currentQuestion: undefined
    };
    const next = generateArithmeticQuestion({
      difficulty: "EASY",
      operation: "MIXED",
      routeMode: "DIRT_ROAD",
      nowMs
    });
    return {
      state: { ...state, currentQuestion: next },
      nextQuestion: next,
      events
    };
  }

  const nextStreak = resultType === "CORRECT" ? answeredState.streak + 1 : 0;
  if (nextStreak >= ROUTE_CHOICE_STREAK) {
    const routeChoice = createRouteChoicePrompt(nowMs);
    return {
      state: {
        ...answeredState,
        routeMode: "ROUTE_CHOICE",
        streak: nextStreak,
        routeStep: 0,
        routeStepsTotal: 0,
        currentQuestion: undefined
      },
      routeChoice,
      events: ["ROUTE_CHOICE_UNLOCKED"]
    };
  }

  const state = {
    ...answeredState,
    routeMode: "NORMAL" as const,
    streak: nextStreak,
    routeStep: 0,
    routeStepsTotal: 0,
    currentQuestion: undefined
  };
  const next = generateNormalQuestion(state, nowMs, difficulty);
  return {
    state: { ...state, currentQuestion: next },
    nextQuestion: next,
    events
  };
}

export function chooseRoute(
  stateInput: PlayerQuestionState,
  routeMode: Extract<RouteMode, "DIRT_ROAD" | "HIGHWAY">,
  nowMs: number
): AdvanceResult {
  const normalized = normalizePlayerQuestionState(stateInput);
  const state = {
    ...normalized,
    routeMode,
    routeStep: 0,
    routeStepsTotal: routeMode === "DIRT_ROAD" ? DIRT_ROAD_STEPS : 1,
    currentQuestion: undefined
  };
  const next = routeMode === "HIGHWAY"
    ? generateWordProblem({ difficulty: "HARD", operation: "MIXED", routeMode: "HIGHWAY", nowMs })
    : generateArithmeticQuestion({ difficulty: "EASY", operation: "MIXED", routeMode: "DIRT_ROAD", nowMs });
  return {
    state: { ...state, currentQuestion: next },
    nextQuestion: next,
    events: []
  };
}
