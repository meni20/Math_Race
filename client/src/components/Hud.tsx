import { useMemo } from "react";
import { useGameStore } from "../game/store/useGameStore";
import {
  getDistanceToFinishMeters,
  getPlayerRaceDistanceMeters,
  isPlayerOnFinalLap
} from "../game/utils/renderMotion";
import { useRenderedPlayers } from "../game/utils/useRenderedPlayers";

function toKmh(speedMps: number) {
  return Math.round(speedMps * 3.6);
}

function formatClock(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatDistance(meters: number) {
  const safeMeters = Math.max(0, meters);
  if (safeMeters >= 1000) {
    return `${(safeMeters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(safeMeters)} m`;
}

export function Hud() {
  const racePhase = useGameStore((state) => state.racePhase);
  const latestTick = useGameStore((state) => state.latestTick);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const feedback = useGameStore((state) => state.answerFeedback);
  const raceStartedAtMs = useGameStore((state) => state.raceStartedAtMs);
  const raceFinishedAtMs = useGameStore((state) => state.raceFinishedAtMs);
  const { nowMs, players, localPlayer } = useRenderedPlayers();

  const displayedLap = localPlayer
    ? Math.min(totalLaps, localPlayer.finished ? totalLaps : localPlayer.lap + 1)
    : 1;
  const distanceToFinishGateMeters = getDistanceToFinishMeters(localPlayer, trackLengthMeters, totalLaps);
  const lapsRemainingToFinish = localPlayer
    ? Math.max(0, Math.ceil(distanceToFinishGateMeters / Math.max(1, trackLengthMeters)) - 1)
    : Math.max(0, totalLaps - 1);
  const finalLapActive = isPlayerOnFinalLap(localPlayer, trackLengthMeters, totalLaps);
  const raceElapsedMs = raceStartedAtMs
    ? Math.max(0, (raceFinishedAtMs ?? nowMs) - raceStartedAtMs)
    : 0;
  const standings = useMemo(() => {
    return Object.values(players)
      .sort((a, b) => {
        return (
          getPlayerRaceDistanceMeters(b, trackLengthMeters, totalLaps)
          - getPlayerRaceDistanceMeters(a, trackLengthMeters, totalLaps)
        );
      })
      .slice(0, 4);
  }, [players, totalLaps, trackLengthMeters]);

  if (racePhase === "lobby" || racePhase === "starting") {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-4 p-4">
      <section className="rounded-2xl border border-cyan-300/25 bg-slate-900/70 p-4 backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">Speed</p>
        <p className="text-3xl font-bold leading-none text-cyan-100">
          {localPlayer ? toKmh(localPlayer.speedMps) : 0}
          <span className="ml-1 text-sm text-cyan-200/80">km/h</span>
        </p>
        <p className="mt-2 text-xs text-slate-300">Lap {displayedLap}/{totalLaps}</p>
        <p className="text-xs text-amber-200/90">
          {localPlayer?.finished
            ? "Finish gate crossed"
            : finalLapActive
              ? `Finish gate: ${formatDistance(distanceToFinishGateMeters)}`
              : `Finish gate opens in ${lapsRemainingToFinish} lap${lapsRemainingToFinish === 1 ? "" : "s"}`}
        </p>
        <p className="text-xs text-slate-400">Tick #{latestTick}</p>
        <p className="mt-1 text-xs text-cyan-200/85">Race {formatClock(raceElapsedMs)}</p>
      </section>

      <section className="min-w-56 rounded-2xl border border-amber-300/35 bg-slate-950/72 p-4 backdrop-blur-xl">
        <p className="mb-2 text-xs uppercase tracking-[0.16em] text-amber-200/90">Standings</p>
        <ul className="space-y-1 text-sm">
          {standings.map((player, index) => (
            <li key={player.playerId} className="flex items-center justify-between text-slate-100">
              <span>
                {index + 1}. {player.displayName}
              </span>
              <span className="text-xs text-amber-200">L{Math.min(totalLaps, player.lap + 1)}</span>
            </li>
          ))}
        </ul>
      </section>

      {feedback && nowMs - feedback.receivedAtMs < 1200 ? (
        <section
          className={`rounded-2xl border px-4 py-3 text-sm font-semibold backdrop-blur-xl ${
            feedback.correct
              ? "border-emerald-300/50 bg-emerald-400/25 text-emerald-100"
              : "border-rose-300/50 bg-rose-500/25 text-rose-100"
          }`}
        >
          {feedback.accepted
            ? feedback.correct
              ? "Correct answer: BOOST engaged"
              : "Wrong answer: speed penalty"
            : "Answer missed timing window, new question issued"}
        </section>
      ) : null}
    </div>
  );
}
