import { isSoloRoomId } from "./gameIds";
import { getSoloLaneOffsets, getSoloLocalCenteredLaneX } from "./soloLane";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertOffsets(actual: number[], expected: number[], message: string) {
  assert(actual.length === expected.length, `${message}: expected ${expected.length} offsets.`);
  for (let index = 0; index < expected.length; index += 1) {
    assert(actual[index] === expected[index], `${message}: offset ${index} expected ${expected[index]} got ${actual[index]}.`);
  }
}

export function runSoloLaneTests() {
  assertOffsets(getSoloLaneOffsets(2), [-4, 4], "Solo 2-racer lane offsets");
  assertOffsets(getSoloLaneOffsets(3), [-6, 0, 6], "Solo 3-racer lane offsets");
  assertOffsets(getSoloLaneOffsets(4), [-9, -3, 3, 9], "Solo 4-racer lane offsets");
  assert(getSoloLocalCenteredLaneX(0, 3, 0) === 0, "Solo local-centered rendering puts local lane 0 at visual center.");
  assert(getSoloLocalCenteredLaneX(1, 3, 0) === -6, "Solo local-centered rendering keeps first bot separated.");
  assert(getSoloLocalCenteredLaneX(2, 3, 0) === 6, "Solo local-centered rendering keeps second bot separated.");
  assert(getSoloLocalCenteredLaneX(0, 4, 0) === 0, "Solo 4-racer local lane stays centered.");
  assert(getSoloLocalCenteredLaneX(1, 4, 0) === -9, "Solo 4-racer bot lane 1 is separated.");
  assert(getSoloLocalCenteredLaneX(2, 4, 0) === -3, "Solo 4-racer bot lane 2 is separated.");
  assert(getSoloLocalCenteredLaneX(3, 4, 0) === 6, "Solo 4-racer bot lane 3 is separated.");
  assert(isSoloRoomId("SOLO-P-123"), "Uppercase Solo room ids are detected.");
  assert(isSoloRoomId("solo-p-123"), "Lowercase Solo room ids are detected.");
}

runSoloLaneTests();
