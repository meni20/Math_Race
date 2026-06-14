import type { QuestionResultType, RaceQuestionPrivate, ScoreResult } from "./questionTypes";

export function scoreAnswer(question: RaceQuestionPrivate, resultType: QuestionResultType): ScoreResult {
  const pointsDelta = resultType === "CORRECT"
    ? question.pointsCorrect
    : resultType === "WRONG"
      ? question.pointsWrong
      : question.pointsTimeout;

  return {
    pointsDelta,
    progressDelta: pointsDelta,
    feedback: resultType === "CORRECT" ? "correct" : resultType === "WRONG" ? "wrong" : "timeout"
  };
}
