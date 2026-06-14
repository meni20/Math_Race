import type { RaceQuestionPrivate, RaceQuestionPublic } from "./questionTypes";

export function serializePublicQuestion(question: RaceQuestionPrivate): RaceQuestionPublic {
  return {
    id: question.id,
    kind: question.kind,
    routeMode: question.routeMode,
    difficulty: question.difficulty,
    operation: question.operation,
    prompt: question.prompt,
    choices: question.choices,
    timeLimitSeconds: question.timeLimitSeconds,
    createdAtMs: question.createdAtMs,
    expiresAtMs: question.expiresAtMs
  };
}
