import type { PlayerSnapshot, RoomSettings } from "../types/messages";
import { readLocalClassroomRoom } from "../network/localClassroom";

const RESULTS_KEY_PREFIX = "math-race.results.";

export interface RaceResultPlayer {
  playerId: string;
  name: string;
  score: number;
  correctAnswers: number;
  wrongAnswers: number;
  timeoutAnswers: number;
  averageAnswerTimeMs: number | null;
  routeMode: string;
  sourceOrder: number;
}

export interface RaceResultsSnapshot {
  sessionId: string;
  raceName: string;
  raceStartedAtMs: number;
  raceFinishedAtMs: number;
  winnerPlayerId: string;
  viewerPlayerId: string;
  savedAtMs: number;
  players: RaceResultPlayer[];
}

export interface SaveRaceResultsInput {
  sessionId: string;
  roomSettings?: Pick<RoomSettings, "raceName">;
  raceStartedAtMs?: number;
  raceFinishedAtMs?: number;
  winnerPlayerId?: string | null;
  viewerPlayerId?: string | null;
  players: Array<Partial<PlayerSnapshot> & { playerId: string; displayName?: string; name?: string }>;
}

function safeCount(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value ?? 0)) : 0;
}

function normalizePlayer(
  player: SaveRaceResultsInput["players"][number],
  sourceOrder: number
): RaceResultPlayer {
  const averageAnswerTimeMs = Number.isFinite(player.averageAnswerTimeMs) && (player.averageAnswerTimeMs ?? 0) > 0
    ? Math.max(1, Math.trunc(player.averageAnswerTimeMs ?? 0))
    : null;
  return {
    playerId: player.playerId,
    name: player.displayName?.trim() || player.name?.trim() || "נהג ללא שם",
    score: safeCount(player.score),
    correctAnswers: safeCount(player.correctAnswers),
    wrongAnswers: safeCount(player.wrongAnswers),
    timeoutAnswers: safeCount(player.timeoutAnswers),
    averageAnswerTimeMs,
    routeMode: typeof player.routeMode === "string" ? player.routeMode : "",
    sourceOrder
  };
}

export function rankRaceResults(players: RaceResultPlayer[]) {
  return [...players].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    const leftTime = left.averageAnswerTimeMs ?? Number.POSITIVE_INFINITY;
    const rightTime = right.averageAnswerTimeMs ?? Number.POSITIVE_INFINITY;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.sourceOrder - right.sourceOrder;
  });
}

export function saveRaceResults(input: SaveRaceResultsInput) {
  if (typeof window === "undefined" || !input.sessionId || input.players.length === 0) {
    return null;
  }
  const snapshot: RaceResultsSnapshot = {
    sessionId: input.sessionId,
    raceName: input.roomSettings?.raceName?.trim() || "מרוץ מתמטיקה",
    raceStartedAtMs: Math.max(0, input.raceStartedAtMs ?? 0),
    raceFinishedAtMs: Math.max(0, input.raceFinishedAtMs ?? Date.now()),
    winnerPlayerId: input.winnerPlayerId?.trim() || "",
    viewerPlayerId: input.viewerPlayerId?.trim() || "",
    savedAtMs: Date.now(),
    players: rankRaceResults(input.players.map(normalizePlayer))
  };
  window.localStorage.setItem(`${RESULTS_KEY_PREFIX}${input.sessionId}`, JSON.stringify(snapshot));
  return snapshot;
}

export function loadRaceResults(sessionId: string): RaceResultsSnapshot | null {
  if (typeof window === "undefined" || !sessionId) {
    return null;
  }
  const raw = window.localStorage.getItem(`${RESULTS_KEY_PREFIX}${sessionId}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RaceResultsSnapshot;
      if (parsed.sessionId === sessionId && Array.isArray(parsed.players)) {
        return {
          ...parsed,
          winnerPlayerId: parsed.winnerPlayerId ?? "",
          viewerPlayerId: parsed.viewerPlayerId ?? "",
          players: rankRaceResults(parsed.players)
        };
      }
    } catch {
      // Fall through to the persisted classroom room snapshot.
    }
  }

  const room = readLocalClassroomRoom(sessionId);
  if (!room || Object.keys(room.players).length === 0) {
    return null;
  }
  return saveRaceResults({
    sessionId,
    roomSettings: room.roomSettings,
    raceStartedAtMs: room.raceStartedAtMs,
    raceFinishedAtMs: room.raceStoppedAtMs || room.endedAtMs,
    winnerPlayerId: room.winnerPlayerId,
    players: Object.values(room.players)
  });
}

export function navigateToRaceResults(sessionId: string) {
  const target = `/race-results/${encodeURIComponent(sessionId)}`;
  if (window.location.pathname === target) {
    return;
  }
  window.history.pushState(null, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
