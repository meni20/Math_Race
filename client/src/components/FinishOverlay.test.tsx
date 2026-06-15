import { isSoloFinishSession, SOLO_FINISH_RESULT_COLUMNS } from "./FinishOverlay";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function runFinishOverlayStaticTests() {
  assert(isSoloFinishSession("personal", "SOLO-P-123"), "Solo finish detection accepts uppercase Solo room ids.");
  assert(isSoloFinishSession("personal", "solo-p-123"), "Solo finish detection accepts lowercase Solo room ids.");
  assert(isSoloFinishSession("solo", ""), "Solo finish detection accepts sessionMode solo.");
  assert(SOLO_FINISH_RESULT_COLUMNS.includes("ניקוד"), "Solo result table renders score.");
  assert(SOLO_FINISH_RESULT_COLUMNS.includes("נכונות"), "Solo result table renders correct answers.");
  assert(SOLO_FINISH_RESULT_COLUMNS.includes("טעויות"), "Solo result table renders wrong answers.");
  assert(SOLO_FINISH_RESULT_COLUMNS.includes("זמן"), "Solo result table renders timeout.");
  assert(SOLO_FINISH_RESULT_COLUMNS.includes("סטטוס"), "Solo result table renders status.");
  assert(!SOLO_FINISH_RESULT_COLUMNS.includes("Progress" as never), "Solo result table does not render Progress.");
  assert(!SOLO_FINISH_RESULT_COLUMNS.includes("m" as never), "Solo result table does not render meters.");
}

runFinishOverlayStaticTests();
