import type { QuestionResultType, RouteMode } from "./questionTypes.ts";

export const ROUTE_CHOICE_STREAK = 8;
export const DIRT_ROAD_STEPS = 5;
export const ROUTE_CHOICE_TIME_LIMIT_SECONDS = 10;

export const SCORING_CONFIG: Record<RouteMode, Record<QuestionResultType, number>> = {
  NORMAL: {
    CORRECT: 20,
    WRONG: -10,
    TIMEOUT: -5
  },
  DIRT_ROAD: {
    CORRECT: 25,
    WRONG: -5,
    TIMEOUT: -5
  },
  HIGHWAY: {
    CORRECT: 200,
    WRONG: -70,
    TIMEOUT: -40
  }
};
