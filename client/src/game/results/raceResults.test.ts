import { loadRaceResults, rankRaceResults, saveRaceResults, type RaceResultPlayer } from "./raceResults";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function player(playerId: string, score: number, time: number | null, sourceOrder: number): RaceResultPlayer {
  return {
    playerId,
    name: playerId,
    score,
    correctAnswers: 0,
    wrongAnswers: 0,
    timeoutAnswers: 0,
    averageAnswerTimeMs: time,
    routeMode: "",
    routeStats: {},
    totalDistanceMeters: score,
    totalRaceTimeMs: null,
    averageSpeedMps: null,
    maxSpeedMps: null,
    sourceOrder
  };
}

export function runRaceResultsTests() {
  const ranked = rankRaceResults([
    player("stable-first", 80, null, 0),
    player("faster", 80, 1200, 1),
    player("winner", 100, 5000, 2),
    player("stable-second", 80, null, 3)
  ]);
  assert(ranked[0].playerId === "winner", "Higher score ranks first.");
  assert(ranked[1].playerId === "faster", "Faster answer time breaks a score tie.");
  assert(ranked[2].playerId === "stable-first", "Missing/equal times preserve source order.");
  assert(ranked[3].playerId === "stable-second", "Stable order is preserved for the remaining tie.");

  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  } satisfies Storage;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage }
  });

  const saved = saveRaceResults({
    sessionId: "refresh-test",
    roomSettings: { raceName: "Refresh race" },
    players: [
      { playerId: "second", displayName: "Second", score: 40, averageAnswerTimeMs: 900 },
      { playerId: "first", displayName: "First", score: 50, averageAnswerTimeMs: 1400, routeStats: { HIGHWAY: 1, DIRT_ROAD: 2 }, maxSpeedMps: 25 }
    ]
  });
  assert(saved?.players[0].playerId === "first", "Saved results are ranked before navigation.");
  const reloaded = loadRaceResults("refresh-test");
  assert(reloaded?.raceName === "Refresh race", "Saved results survive a route refresh.");
  assert(reloaded?.players[0].playerId === "first", "Reloaded results preserve the final ranking.");
  assert(reloaded?.players[0].routeStats.DIRT_ROAD === 2, "Reloaded results preserve per-route history.");
  assert(reloaded?.players[0].maxSpeedMps === 25, "Reloaded results preserve maximum speed.");

  Reflect.deleteProperty(globalThis, "window");
}

runRaceResultsTests();
