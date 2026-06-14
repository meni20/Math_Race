import type { AnswerValidationResult, RaceQuestionPrivate } from "./questionTypes";

const INTEGER_PATTERN = /^[+-]?\d+$/;

export function validateAnswer(
  question: RaceQuestionPrivate,
  submittedAnswer: unknown,
  nowMs: number
): AnswerValidationResult {
  const normalized = String(submittedAnswer ?? "").trim();
  const expired = nowMs > question.expiresAtMs;

  if (expired) {
    return {
      resultType: "TIMEOUT",
      correct: false,
      submittedAnswer: normalized,
      expectedAnswer: question.correctAnswer
    };
  }

  if (!normalized || !INTEGER_PATTERN.test(normalized)) {
    return {
      resultType: "WRONG",
      correct: false,
      submittedAnswer: normalized,
      expectedAnswer: question.correctAnswer
    };
  }

  const parsedAnswer = Number.parseInt(normalized, 10);
  const accepted = question.acceptedAnswers.some((answer) => {
    const candidate = String(answer).trim();
    return INTEGER_PATTERN.test(candidate) && Number.parseInt(candidate, 10) === parsedAnswer;
  });

  return {
    resultType: accepted ? "CORRECT" : "WRONG",
    correct: accepted,
    submittedAnswer: normalized,
    expectedAnswer: question.correctAnswer
  };
}
