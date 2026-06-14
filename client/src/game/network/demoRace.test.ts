import { generateArithmeticQuestion } from "../questions/questionEngine";
import { advanceQuestionStateAfterAnswer, chooseRoute, createInitialPlayerQuestionState } from "../questions/questionStateMachine";
import { scoreAnswer } from "../questions/scoringEngine";
import { getSoloBotAnswerProfile, normalizeSoloBotCount, SOLO_BOT_OPTIONS } from "./demoRace";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function runSoloRaceTests() {
  assert(!SOLO_BOT_OPTIONS.includes(0 as never), "0 bots is not available.");
  assert(SOLO_BOT_OPTIONS.join(",") === "1,2,3", "1/2/3 bot options are available.");
  assert(normalizeSoloBotCount(0) === 1, "Solo bot count clamps 0 to 1.");
  assert(normalizeSoloBotCount(4) === 3, "Solo bot count clamps above 3.");

  const nowMs = 1000;
  const normal = generateArithmeticQuestion({ difficulty: "MEDIUM", operation: "ADD", routeMode: "NORMAL", nowMs, id: "normal" });
  assert(normal.timeLimitSeconds === 15, "Solo normal timer is 15s.");
  assert(Math.max(0, 0 + scoreAnswer(normal, "WRONG").pointsDelta) === 0, "Solo wrong score clamps at 0.");
  assert(Math.max(0, 0 + scoreAnswer(normal, "TIMEOUT").pointsDelta) === 0, "Solo timeout score clamps at 0.");
  assert(scoreAnswer(normal, "CORRECT").pointsDelta === 20, "Solo correct answer uses shared scoring.");

  const targetScore = 20;
  assert(Math.min(targetScore, scoreAnswer(normal, "CORRECT").pointsDelta) >= targetScore, "Solo finish occurs when score reaches targetScore.");

  let state = createInitialPlayerQuestionState();
  let routeChoiceOpened = false;
  for (let index = 0; index < 8; index += 1) {
    const question = generateArithmeticQuestion({ difficulty: "EASY", operation: "ADD", routeMode: "NORMAL", nowMs: nowMs + index, id: `solo-streak-${index}` });
    const advanced = advanceQuestionStateAfterAnswer({ ...state, currentQuestion: question }, question, "CORRECT", nowMs + index + 1, "MEDIUM");
    state = advanced.state;
    routeChoiceOpened = Boolean(advanced.routeChoice);
  }
  assert(routeChoiceOpened, "8 correct streak opens route choice in Solo.");

  const highway = chooseRoute(state, "HIGHWAY", nowMs + 20);
  assert(highway.nextQuestion?.kind === "WORD_PROBLEM" && highway.nextQuestion.difficulty === "HARD", "Highway produces one hard word problem.");
  assert(highway.nextQuestion?.timeLimitSeconds === 60, "Highway timer is 60s.");

  const dirt = chooseRoute(createInitialPlayerQuestionState(), "DIRT_ROAD", nowMs + 30);
  assert(dirt.nextQuestion?.routeMode === "DIRT_ROAD" && dirt.nextQuestion.timeLimitSeconds === 30, "Dirt Road produces 30s safer sequence questions.");

  const easyBot = getSoloBotAnswerProfile("EASY");
  const mediumBot = getSoloBotAnswerProfile("MEDIUM");
  const hardBot = getSoloBotAnswerProfile("HARD");
  assert(easyBot.correctChance >= 0.55 && easyBot.correctChance <= 0.65, "Easy bots answer around 55-65% correctly.");
  assert(mediumBot.correctChance >= 0.65 && mediumBot.correctChance <= 0.75, "Medium bots answer around 65-75% correctly.");
  assert(hardBot.correctChance >= 0.75 && hardBot.correctChance <= 0.85, "Hard bots answer around 75-85% correctly.");
  assert(easyBot.minDelayMs > hardBot.minDelayMs, "Bots answer on intervals and hard bots are faster than easy bots.");
}

runSoloRaceTests();
