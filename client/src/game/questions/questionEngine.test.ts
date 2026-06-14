import { validateAnswer } from "./answerValidator";
import { generateArithmeticQuestion, generateWordProblem, WORD_PROBLEM_TEMPLATES } from "./questionEngine";
import {
  advanceQuestionStateAfterAnswer,
  chooseRoute,
  createInitialPlayerQuestionState,
  hasAnsweredQuestion
} from "./questionStateMachine";
import { scoreAnswer } from "./scoringEngine";
import { serializePublicQuestion } from "./publicQuestionSerializer";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function makeRng(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

export function runQuestionEngineTests() {
  const nowMs = 1000;

  const addition = generateArithmeticQuestion({
    difficulty: "EASY",
    operation: "ADD",
    nowMs,
    rng: makeRng([0.6, 0.2]),
    id: "add-easy"
  });
  assert(validateAnswer(addition, String(addition.correctAnswer), nowMs).correct, "Addition easy answer is correct.");

  for (let index = 0; index < 40; index += 1) {
    const subtraction = generateArithmeticQuestion({
      difficulty: "EASY",
      operation: "SUBTRACT",
      nowMs,
      rng: makeRng([index / 40, 0.99])
    });
    assert(subtraction.correctAnswer >= 0, "Subtraction easy never negative.");
  }

  const multiplication = generateArithmeticQuestion({
    difficulty: "EASY",
    operation: "MULTIPLY",
    nowMs,
    rng: makeRng([0, 0.999])
  });
  const multiplyOperands = multiplication.prompt.split(" * ").map(Number);
  assert(multiplyOperands.every((value) => value >= 2 && value <= 10), "Multiplication easy uses 2-10 table.");

  const easyDivision = generateArithmeticQuestion({
    difficulty: "EASY",
    operation: "DIVIDE",
    nowMs,
    rng: makeRng([0.8, 0.3])
  });
  const [easyDividend, easyDivisor] = easyDivision.prompt.split(" / ").map(Number);
  assert(easyDividend % easyDivisor === 0 && Number.isInteger(easyDivision.correctAnswer), "Division easy always exact integer.");

  const mediumDivision = generateArithmeticQuestion({
    difficulty: "MEDIUM",
    operation: "DIVIDE",
    nowMs,
    rng: makeRng([0.5, 0.7])
  });
  const [mediumDividend, mediumDivisor] = mediumDivision.prompt.split(" / ").map(Number);
  assert(mediumDividend <= 100 && mediumDividend % mediumDivisor === 0, "Medium division exact.");

  for (const template of WORD_PROBLEM_TEMPLATES) {
    const made = template.make(makeRng([0.5, 0.25, 0.75]));
    assert(Number.isInteger(made.correctAnswer), `Word problem template ${template.id} returns numeric answer.`);
  }

  const normal = generateArithmeticQuestion({ difficulty: "EASY", operation: "ADD", routeMode: "NORMAL", nowMs, id: "normal" });
  assert(normal.timeLimitSeconds === 15, "Normal question timer is 15 seconds.");
  assert(scoreAnswer(normal, "CORRECT").pointsDelta === 20, "Normal correct gives +20.");
  assert(scoreAnswer(normal, "WRONG").pointsDelta === -10, "Normal wrong gives -10.");
  assert(scoreAnswer(normal, "TIMEOUT").pointsDelta === -5, "Normal timeout gives -5.");

  const dirt = generateArithmeticQuestion({ difficulty: "EASY", operation: "ADD", routeMode: "DIRT_ROAD", nowMs, id: "dirt" });
  assert(dirt.timeLimitSeconds === 30, "Dirt Road question timer is 30 seconds.");
  assert(scoreAnswer(dirt, "CORRECT").pointsDelta === 25, "Dirt Road correct gives +25.");

  const highway = generateWordProblem({ difficulty: "HARD", operation: "MIXED", routeMode: "HIGHWAY", nowMs, id: "highway" });
  assert(highway.timeLimitSeconds === 60, "Highway question timer is 60 seconds.");
  assert(scoreAnswer(highway, "CORRECT").pointsDelta === 200, "Highway correct gives +200.");
  assert(scoreAnswer(highway, "WRONG").pointsDelta === -70, "Highway wrong gives -70.");

  let state = createInitialPlayerQuestionState();
  let routeChoiceOpened = false;
  for (let index = 0; index < 8; index += 1) {
    const question = generateArithmeticQuestion({ difficulty: "EASY", operation: "ADD", routeMode: "NORMAL", nowMs: nowMs + index, id: `streak-${index}` });
    const advanced = advanceQuestionStateAfterAnswer({ ...state, currentQuestion: question }, question, "CORRECT", nowMs + index + 1);
    state = advanced.state;
    routeChoiceOpened = Boolean(advanced.routeChoice);
  }
  assert(routeChoiceOpened && state.routeMode === "ROUTE_CHOICE", "Streak 8 opens route choice.");

  const highwayStart = chooseRoute(state, "HIGHWAY", nowMs + 20);
  const highwayDone = advanceQuestionStateAfterAnswer(highwayStart.state, highwayStart.nextQuestion!, "WRONG", nowMs + 21);
  assert(highwayDone.state.routeMode === "NORMAL", "Highway returns to normal after one question.");

  let dirtState = chooseRoute(createInitialPlayerQuestionState(), "DIRT_ROAD", nowMs + 30).state;
  for (let index = 0; index < 5; index += 1) {
    const question = dirtState.currentQuestion!;
    const advanced = advanceQuestionStateAfterAnswer(dirtState, question, "CORRECT", nowMs + 31 + index);
    dirtState = advanced.state;
  }
  assert(dirtState.routeMode === "NORMAL", "Dirt Road returns to normal after 5 questions.");

  const duplicateState = advanceQuestionStateAfterAnswer(createInitialPlayerQuestionState(), normal, "CORRECT", nowMs + 50).state;
  assert(hasAnsweredQuestion(duplicateState, normal.id), "Duplicate answer does not score twice guard marks answered question.");
  assert(hasAnsweredQuestion(advanceQuestionStateAfterAnswer(duplicateState, normal, "CORRECT", nowMs + 51).state, normal.id), "Timeout does not apply twice guard preserves answered question.");

  const publicQuestion = serializePublicQuestion(highway);
  assert(!("correctAnswer" in publicQuestion) && !("acceptedAnswers" in publicQuestion), "Classroom public question does not contain correctAnswer.");
}

runQuestionEngineTests();
