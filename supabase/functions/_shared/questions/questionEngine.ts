import { SCORING_CONFIG } from "./scoringConfig.ts";
import type {
  Difficulty,
  Operation,
  RaceQuestionPrivate,
  Rng,
  RouteMode
} from "./questionTypes.ts";

type GenerateQuestionOptions = {
  difficulty: Difficulty;
  operation?: Operation;
  routeMode?: RouteMode;
  nowMs?: number;
  rng?: Rng;
  id?: string;
};

type WordProblemTemplate = {
  id: string;
  difficulty: Difficulty;
  operation: Exclude<Operation, "MIXED">;
  make: (rng: Rng) => {
    prompt: string;
    correctAnswer: number;
  };
};

function randomId() {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUUID ? randomUUID() : `q-${Math.random().toString(36).slice(2, 12)}`;
}

function boundedRandom(rng: Rng) {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : Math.random();
}

function randomInt(rng: Rng, minInclusive: number, maxInclusive: number) {
  return minInclusive + Math.floor(boundedRandom(rng) * ((maxInclusive - minInclusive) + 1));
}

function pickOperation(rng: Rng, operation?: Operation): Exclude<Operation, "MIXED"> {
  if (operation && operation !== "MIXED") {
    return operation;
  }
  const operations: Array<Exclude<Operation, "MIXED">> = ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"];
  return operations[randomInt(rng, 0, operations.length - 1)];
}

function withScoring(
  partial: Omit<RaceQuestionPrivate, "id" | "acceptedAnswers" | "pointsCorrect" | "pointsWrong" | "pointsTimeout" | "createdAtMs" | "expiresAtMs">,
  options: GenerateQuestionOptions,
  timeLimitSeconds: number
): RaceQuestionPrivate {
  const routeMode = options.routeMode ?? "NORMAL";
  const createdAtMs = options.nowMs ?? Date.now();
  const scoring = SCORING_CONFIG[routeMode];
  const resolvedTimeLimitSeconds = routeMode === "HIGHWAY"
    ? 60
    : routeMode === "DIRT_ROAD"
      ? 30
      : partial.kind === "ARITHMETIC"
        ? 15
        : timeLimitSeconds;
  return {
    ...partial,
    id: options.id ?? randomId(),
    routeMode,
    acceptedAnswers: [String(partial.correctAnswer)],
    timeLimitSeconds: resolvedTimeLimitSeconds,
    pointsCorrect: scoring.CORRECT,
    pointsWrong: scoring.WRONG,
    pointsTimeout: scoring.TIMEOUT,
    createdAtMs,
    expiresAtMs: createdAtMs + (resolvedTimeLimitSeconds * 1000)
  };
}

export function generateArithmeticQuestion(options: GenerateQuestionOptions): RaceQuestionPrivate {
  const rng = options.rng ?? Math.random;
  const difficulty = options.difficulty;
  const operation = pickOperation(rng, options.operation);

  let prompt = "";
  let correctAnswer = 0;
  let timeLimitSeconds = difficulty === "EASY" ? 10 : 15;

  if (difficulty === "EASY") {
    if (operation === "ADD") {
      const left = randomInt(rng, 0, 30);
      const right = randomInt(rng, 0, 30);
      prompt = `${left} + ${right}`;
      correctAnswer = left + right;
    } else if (operation === "SUBTRACT") {
      const left = randomInt(rng, 0, 30);
      const right = randomInt(rng, 0, left);
      prompt = `${left} - ${right}`;
      correctAnswer = left - right;
    } else if (operation === "MULTIPLY") {
      const left = randomInt(rng, 2, 10);
      const right = randomInt(rng, 2, 10);
      prompt = `${left} * ${right}`;
      correctAnswer = left * right;
      timeLimitSeconds = 12;
    } else {
      const divisor = randomInt(rng, 2, 10);
      const quotient = randomInt(rng, 2, 10);
      const dividend = divisor * quotient;
      prompt = `${dividend} / ${divisor}`;
      correctAnswer = quotient;
      timeLimitSeconds = 12;
    }
  } else if (difficulty === "MEDIUM") {
    if (operation === "ADD") {
      const left = randomInt(rng, 0, 100);
      const right = randomInt(rng, 0, 100);
      prompt = `${left} + ${right}`;
      correctAnswer = left + right;
    } else if (operation === "SUBTRACT") {
      const left = randomInt(rng, 0, 100);
      const right = randomInt(rng, 0, left);
      prompt = `${left} - ${right}`;
      correctAnswer = left - right;
    } else if (operation === "MULTIPLY") {
      const left = randomInt(rng, 10, 99);
      const right = randomInt(rng, 2, 9);
      prompt = `${left} * ${right}`;
      correctAnswer = left * right;
    } else {
      const divisor = randomInt(rng, 2, 10);
      const maxQuotient = Math.floor(100 / divisor);
      const quotient = randomInt(rng, 2, Math.max(2, maxQuotient));
      const dividend = divisor * quotient;
      prompt = `${dividend} / ${divisor}`;
      correctAnswer = quotient;
    }
  } else {
    if (operation === "MULTIPLY") {
      const left = randomInt(rng, 12, 99);
      const right = randomInt(rng, 6, 12);
      prompt = `${left} * ${right}`;
      correctAnswer = left * right;
    } else if (operation === "DIVIDE") {
      const divisor = randomInt(rng, 6, 12);
      const quotient = randomInt(rng, 8, 18);
      prompt = `${divisor * quotient} / ${divisor}`;
      correctAnswer = quotient;
    } else if (operation === "SUBTRACT") {
      const left = randomInt(rng, 100, 250);
      const right = randomInt(rng, 0, left);
      prompt = `${left} - ${right}`;
      correctAnswer = left - right;
    } else {
      const left = randomInt(rng, 75, 250);
      const right = randomInt(rng, 50, 200);
      prompt = `${left} + ${right}`;
      correctAnswer = left + right;
    }
  }

  return withScoring({
    kind: "ARITHMETIC",
    routeMode: options.routeMode ?? "NORMAL",
    difficulty,
    operation,
    prompt,
    correctAnswer,
    timeLimitSeconds
  }, options, timeLimitSeconds);
}

const WORD_PROBLEM_TEMPLATES: WordProblemTemplate[] = [
  {
    id: "easy-add-stickers",
    difficulty: "EASY",
    operation: "ADD",
    make: (rng) => {
      const first = randomInt(rng, 5, 24);
      const more = randomInt(rng, 3, 12);
      return {
        prompt: `Roni collected ${first} stickers and then got ${more} more. How many stickers does Roni have now?`,
        correctAnswer: first + more
      };
    }
  },
  {
    id: "easy-subtract-pencils",
    difficulty: "EASY",
    operation: "SUBTRACT",
    make: (rng) => {
      const total = randomInt(rng, 12, 30);
      const used = randomInt(rng, 1, total);
      return {
        prompt: `A class had ${total} pencils. ${used} pencils were used. How many pencils are left?`,
        correctAnswer: total - used
      };
    }
  },
  {
    id: "easy-multiply-apples",
    difficulty: "EASY",
    operation: "MULTIPLY",
    make: (rng) => {
      const perBox = randomInt(rng, 2, 10);
      const boxes = randomInt(rng, 2, 10);
      return {
        prompt: `Each box has ${perBox} apples. There are ${boxes} boxes. How many apples are there?`,
        correctAnswer: perBox * boxes
      };
    }
  },
  {
    id: "easy-divide-candies",
    difficulty: "EASY",
    operation: "DIVIDE",
    make: (rng) => {
      const students = randomInt(rng, 2, 10);
      const each = randomInt(rng, 2, 10);
      return {
        prompt: `${students * each} candies are shared equally between ${students} students. How many candies does each student get?`,
        correctAnswer: each
      };
    }
  },
  {
    id: "medium-two-step-books",
    difficulty: "MEDIUM",
    operation: "ADD",
    make: (rng) => {
      const shelves = randomInt(rng, 3, 8);
      const perShelf = randomInt(rng, 6, 14);
      const extra = randomInt(rng, 10, 35);
      return {
        prompt: `A library put ${perShelf} books on each of ${shelves} shelves, then added ${extra} more books. How many books are there?`,
        correctAnswer: (shelves * perShelf) + extra
      };
    }
  },
  {
    id: "medium-two-step-tickets",
    difficulty: "MEDIUM",
    operation: "SUBTRACT",
    make: (rng) => {
      const rows = randomInt(rng, 4, 9);
      const seats = randomInt(rng, 8, 15);
      const empty = randomInt(rng, 5, 24);
      return {
        prompt: `There are ${rows} rows with ${seats} seats in each row. ${empty} seats are empty. How many seats are filled?`,
        correctAnswer: (rows * seats) - empty
      };
    }
  },
  {
    id: "hard-highway-orders",
    difficulty: "HARD",
    operation: "MULTIPLY",
    make: (rng) => {
      const crates = randomInt(rng, 8, 16);
      const perCrate = randomInt(rng, 12, 24);
      const sold = randomInt(rng, 30, 90);
      const bonus = randomInt(rng, 10, 40);
      return {
        prompt: `A shop received ${crates} crates with ${perCrate} oranges in each crate, sold ${sold} oranges, then received ${bonus} more. How many oranges are in the shop now?`,
        correctAnswer: (crates * perCrate) - sold + bonus
      };
    }
  }
];

export function generateWordProblem(options: GenerateQuestionOptions): RaceQuestionPrivate {
  const rng = options.rng ?? Math.random;
  const difficulty = options.difficulty;
  const operation = options.operation && options.operation !== "MIXED" ? options.operation : undefined;
  const pool = WORD_PROBLEM_TEMPLATES.filter((template) => (
    template.difficulty === difficulty && (!operation || template.operation === operation)
  ));
  const template = pool.length > 0
    ? pool[randomInt(rng, 0, pool.length - 1)]
    : WORD_PROBLEM_TEMPLATES.find((candidate) => candidate.difficulty === difficulty) ?? WORD_PROBLEM_TEMPLATES[0];
  const made = template.make(rng);
  const timeLimitSeconds = difficulty === "EASY" ? 30 : difficulty === "MEDIUM" ? 45 : 60;

  return withScoring({
    kind: "WORD_PROBLEM",
    routeMode: options.routeMode ?? "NORMAL",
    difficulty,
    operation: template.operation,
    prompt: made.prompt,
    correctAnswer: made.correctAnswer,
    timeLimitSeconds
  }, options, timeLimitSeconds);
}

export function generateQuestion(options: GenerateQuestionOptions & { kind?: "ARITHMETIC" | "WORD_PROBLEM" }): RaceQuestionPrivate {
  return options.kind === "WORD_PROBLEM"
    ? generateWordProblem(options)
    : generateArithmeticQuestion(options);
}

export { WORD_PROBLEM_TEMPLATES };
