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
  routeStats: Record<string, number>;
  totalDistanceMeters: number;
  totalRaceTimeMs: number | null;
  averageSpeedMps: number | null;
  maxSpeedMps: number | null;
  sourceOrder: number;
}

export interface RaceResultsSnapshot {
  sessionId: string;
  raceName: string;
  mapId: string;
  raceStartedAtMs: number;
  raceFinishedAtMs: number;
  winnerPlayerId: string;
  viewerPlayerId: string;
  savedAtMs: number;
  players: RaceResultPlayer[];
}

export interface SaveRaceResultsInput {
  sessionId: string;
  roomSettings?: Pick<RoomSettings, "raceName" | "mapId">;
  raceStartedAtMs?: number;
  raceFinishedAtMs?: number;
  winnerPlayerId?: string | null;
  viewerPlayerId?: string | null;
  players: Array<Partial<PlayerSnapshot> & { playerId: string; displayName?: string; name?: string }>;
}

export type RaceRoute = "NORMAL" | "HIGHWAY" | "DIRT_ROAD";

export function normalizeRaceRoute(routeMode: string | null | undefined): RaceRoute {
  const route = (routeMode ?? "").trim().toUpperCase();
  if (route.includes("HIGHWAY")) return "HIGHWAY";
  if (route.includes("DIRT")) return "DIRT_ROAD";
  return "NORMAL";
}

export function getRaceResultRoutes(player: Pick<RaceResultPlayer, "routeMode" | "routeStats">) {
  const routes = new Map<RaceRoute, number>();
  for (const [route, count] of Object.entries(player.routeStats ?? {})) {
    const safeRoute = normalizeRaceRoute(route);
    const safeValue = safeCount(count);
    if (safeValue > 0) {
      routes.set(safeRoute, (routes.get(safeRoute) ?? 0) + safeValue);
    }
  }

  const currentRoute = normalizeRaceRoute(player.routeMode);
  const hasCurrentRoute = Boolean(player.routeMode?.trim());
  if ((hasCurrentRoute || routes.size === 0) && !routes.has(currentRoute)) {
    routes.set(currentRoute, 1);
  }
  return [...routes.entries()].sort((left, right) => right[1] - left[1]);
}

function safeCount(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value ?? 0)) : 0;
}

function normalizePlayer(
  player: SaveRaceResultsInput["players"][number],
  sourceOrder: number,
  raceStartedAtMs: number,
  raceFinishedAtMs: number
): RaceResultPlayer {
  const averageAnswerTimeMs = Number.isFinite(player.averageAnswerTimeMs) && (player.averageAnswerTimeMs ?? 0) > 0
    ? Math.max(1, Math.trunc(player.averageAnswerTimeMs ?? 0))
    : null;
  const totalDistanceMeters = Math.max(0, player.positionMeters ?? player.score ?? 0);
  const totalRaceTimeMs = raceStartedAtMs > 0 && raceFinishedAtMs >= raceStartedAtMs
    ? raceFinishedAtMs - raceStartedAtMs
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
    routeStats: Object.fromEntries(Object.entries(player.routeStats ?? {}).map(([route, count]) => [route, safeCount(count)])),
    totalDistanceMeters,
    totalRaceTimeMs,
    averageSpeedMps: totalRaceTimeMs ? totalDistanceMeters / (totalRaceTimeMs / 1000) : null,
    maxSpeedMps: Number.isFinite(player.maxSpeedMps) ? Math.max(0, player.maxSpeedMps ?? 0) : null,
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
    mapId: input.roomSettings?.mapId ?? "",
    raceStartedAtMs: Math.max(0, input.raceStartedAtMs ?? 0),
    raceFinishedAtMs: Math.max(0, input.raceFinishedAtMs ?? Date.now()),
    winnerPlayerId: input.winnerPlayerId?.trim() || "",
    viewerPlayerId: input.viewerPlayerId?.trim() || "",
    savedAtMs: Date.now(),
    players: rankRaceResults(input.players.map((player, index) => normalizePlayer(
      player,
      index,
      Math.max(0, input.raceStartedAtMs ?? 0),
      Math.max(0, input.raceFinishedAtMs ?? Date.now())
    )))
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
          mapId: parsed.mapId ?? "",
          players: rankRaceResults(parsed.players.map((player, index) => ({
            ...player,
            routeStats: player.routeStats ?? {},
            totalDistanceMeters: Math.max(0, player.totalDistanceMeters ?? player.score ?? 0),
            totalRaceTimeMs: player.totalRaceTimeMs ?? null,
            averageSpeedMps: player.averageSpeedMps ?? null,
            maxSpeedMps: player.maxSpeedMps ?? null,
            sourceOrder: Number.isFinite(player.sourceOrder) ? player.sourceOrder : index
          })))
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
