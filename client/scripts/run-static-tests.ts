import { test } from "vitest";

const testModules = [
  "../src/components/FinishOverlay.test.tsx",
  "../src/components/teacher/TeacherRaceLane.test.ts",
  "../src/game/network/demoRace.test.ts",
  "../src/game/network/firebaseClassroom.test.ts",
  "../src/game/questions/questionEngine.test.ts",
  "../src/game/results/raceResults.test.ts",
  "../src/game/store/useGameStore.test.ts",
  "../src/game/utils/renderMotion.test.ts",
  "../src/game/utils/soloLane.test.ts"
];

test("all frontend static test modules pass", { timeout: 15_000 }, async () => {
  for (const testModule of testModules) {
    await import(testModule);
  }
});
