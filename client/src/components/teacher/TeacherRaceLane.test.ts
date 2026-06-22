import { getTeacherCarLeftPercent } from "./TeacherRaceLane";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTeacherRaceLaneTests() {
  assert(getTeacherCarLeftPercent(0) === "0%", "Teacher car starts at zero progress.");
  assert(getTeacherCarLeftPercent(42.5) === "42.5%", "Teacher car position follows live progress.");
  assert(getTeacherCarLeftPercent(140) === "100%", "Teacher car position is capped at the finish.");
  assert(getTeacherCarLeftPercent(-10) === "0%", "Teacher car position cannot move before the start.");
}

runTeacherRaceLaneTests();
