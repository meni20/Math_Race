import type { GeneratedQuestionRecord } from "./contracts.ts";

interface QuestionTemplate {
  pattern: string;
  operandFactory: () => [number, number, number];
  evaluator: (a: number, b: number, c: number) => number;
  timeLimitMs: number;
  boostMultiplier: number;
}

function randomInt(minInclusive: number, maxInclusive: number) {
  return minInclusive + Math.floor(Math.random() * ((maxInclusive - minInclusive) + 1));
}

function buildChoices(correctAnswer: number) {
  const choices = new Set<string>([String(correctAnswer)]);
  for (const offset of [1, -1, 2, -2, 3, -3, 5, -5, 10, -10]) {
    if (choices.size >= 4) {
      break;
    }
    const candidate = correctAnswer + offset;
    if (candidate >= 0 && candidate !== correctAnswer) {
      choices.add(String(candidate));
    }
  }
  while (choices.size < 4) {
    const candidate = Math.max(0, correctAnswer + randomInt(-8, 8));
    if (candidate !== correctAnswer) {
      choices.add(String(candidate));
    }
  }
  return [...choices].sort(() => Math.random() - 0.5);
}

const EASY_TEMPLATES: QuestionTemplate[] = [
  {
    pattern: "{a} + {b}",
    operandFactory: () => [randomInt(3, 30), randomInt(2, 20), 0],
    evaluator: (a, b) => a + b,
    timeLimitMs: 9000,
    boostMultiplier: 1
  },
  {
    pattern: "{a} - {b}",
    operandFactory: () => {
      const b = randomInt(2, 16);
      const a = randomInt(b + 3, b + 30);
      return [a, b, 0];
    },
    evaluator: (a, b) => a - b,
    timeLimitMs: 9000,
    boostMultiplier: 1.05
  }
];

const MEDIUM_TEMPLATES: QuestionTemplate[] = [
  {
    pattern: "{a} * {b}",
    operandFactory: () => [randomInt(4, 14), randomInt(3, 12), 0],
    evaluator: (a, b) => a * b,
    timeLimitMs: 8000,
    boostMultiplier: 1.2
  },
  {
    pattern: "({a} * {b}) + {c}",
    operandFactory: () => [randomInt(4, 11), randomInt(3, 10), randomInt(5, 45)],
    evaluator: (a, b, c) => (a * b) + c,
    timeLimitMs: 8000,
    boostMultiplier: 1.25
  }
];

const HARD_TEMPLATES: QuestionTemplate[] = [
  {
    pattern: "({a} * {b}) - {c}",
    operandFactory: () => [randomInt(7, 17), randomInt(6, 16), randomInt(10, 90)],
    evaluator: (a, b, c) => (a * b) - c,
    timeLimitMs: 7000,
    boostMultiplier: 1.4
  },
  {
    pattern: "({a} + {b}) * {c}",
    operandFactory: () => [randomInt(10, 40), randomInt(10, 35), randomInt(4, 10)],
    evaluator: (a, b, c) => (a + b) * c,
    timeLimitMs: 7000,
    boostMultiplier: 1.45
  }
];

export function generateQuestion(difficulty: number): GeneratedQuestionRecord {
  const boundedDifficulty = Math.max(1, Math.min(3, Math.trunc(difficulty || 1)));
  const pool = boundedDifficulty === 1
    ? EASY_TEMPLATES
    : boundedDifficulty === 2
      ? MEDIUM_TEMPLATES
      : HARD_TEMPLATES;
  const template = pool[Math.floor(Math.random() * pool.length)];
  const [a, b, c] = template.operandFactory();
  const prompt = template.pattern
    .replace("{a}", String(a))
    .replace("{b}", String(b))
    .replace("{c}", String(c));
  const correctAnswer = template.evaluator(a, b, c);

  return {
    questionId: crypto.randomUUID(),
    prompt,
    correctAnswer: String(correctAnswer),
    choices: buildChoices(correctAnswer),
    difficulty: boundedDifficulty,
    timeLimitMs: template.timeLimitMs,
    boostMultiplier: template.boostMultiplier
  };
}
