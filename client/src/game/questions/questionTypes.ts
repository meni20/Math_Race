export type QuestionKind =
  | "ARITHMETIC"
  | "WORD_PROBLEM"
  | "ROUTE_CHOICE";

export type Operation =
  | "ADD"
  | "SUBTRACT"
  | "MULTIPLY"
  | "DIVIDE"
  | "MIXED";

export type Difficulty =
  | "EASY"
  | "MEDIUM"
  | "HARD";

export type RouteMode =
  | "NORMAL"
  | "DIRT_ROAD"
  | "HIGHWAY";

export type PlayerQuestionRouteMode = RouteMode | "ROUTE_CHOICE";

export type QuestionResultType =
  | "CORRECT"
  | "WRONG"
  | "TIMEOUT";

export type RaceQuestionPrivate = {
  id: string;
  kind: QuestionKind;
  routeMode: RouteMode;
  difficulty: Difficulty;
  operation?: Operation;
  prompt: string;
  correctAnswer: number;
  acceptedAnswers: string[];
  timeLimitSeconds: number;
  pointsCorrect: number;
  pointsWrong: number;
  pointsTimeout: number;
  createdAtMs: number;
  expiresAtMs: number;
};

export type RaceQuestionPublic = {
  id: string;
  kind: QuestionKind;
  routeMode: RouteMode;
  difficulty: Difficulty;
  operation?: Operation;
  prompt: string;
  timeLimitSeconds: number;
  createdAtMs: number;
  expiresAtMs: number;
};

export type PlayerQuestionState = {
  routeMode: PlayerQuestionRouteMode;
  streak: number;
  routeStep: number;
  routeStepsTotal: number;
  currentQuestion?: RaceQuestionPrivate;
  answeredQuestionIds: string[];
};

export type AnswerValidationResult = {
  resultType: QuestionResultType;
  correct: boolean;
  submittedAnswer: string;
  expectedAnswer: number;
};

export type ScoreResult = {
  pointsDelta: number;
  progressDelta: number;
  feedback: "correct" | "wrong" | "timeout";
};

export type RouteChoicePrompt = {
  id: string;
  prompt: string;
  options: Array<"HIGHWAY" | "DIRT_ROAD">;
  createdAtMs: number;
  expiresAtMs: number;
};

export type Rng = () => number;
