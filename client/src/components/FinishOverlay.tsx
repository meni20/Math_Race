import { useMemo } from "react";
import { gameSocket } from "../game/network/gameSocket";
import { useGameStore } from "../game/store/useGameStore";

function formatDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatMeters(meters: number) {
  return `${Math.round(Math.max(0, meters))} m`;
}

function toOrdinal(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${value}st`;
  }
  if (mod10 === 2 && mod100 !== 12) {
    return `${value}nd`;
  }
  if (mod10 === 3 && mod100 !== 13) {
    return `${value}rd`;
  }
  return `${value}th`;
}

export function FinishOverlay() {
  const roomId = useGameStore((state) => state.roomId);
  const playerId = useGameStore((state) => state.playerId);
  const displayName = useGameStore((state) => state.displayName);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const players = useGameStore((state) => state.players);
  const raceStartedAtMs = useGameStore((state) => state.raceStartedAtMs);
  const raceFinishedAtMs = useGameStore((state) => state.raceFinishedAtMs);
  const racePlacement = useGameStore((state) => state.racePlacement);
  const raceStopped = useGameStore((state) => state.raceStopped);
  const winnerPlayerId = useGameStore((state) => state.winnerPlayerId);
  const prepareJoin = useGameStore((state) => state.prepareJoin);

  const localPlayer = players[playerId];
  const winnerName = winnerPlayerId && players[winnerPlayerId] ? players[winnerPlayerId].displayName : undefined;

  const standings = useMemo(() => {
    return Object.values(players)
      .sort((a, b) => {
        if (a.lap !== b.lap) {
          return b.lap - a.lap;
        }
        return b.positionMeters - a.positionMeters;
      });
  }, [players]);

  if (!raceStopped || !localPlayer || !raceFinishedAtMs || raceStartedAtMs <= 0) {
    return null;
  }

  const elapsedMs = Math.max(0, raceFinishedAtMs - raceStartedAtMs);

  const handleRaceAgain = () => {
    if (!roomId || !playerId) {
      return;
    }
    const safeDisplayName = displayName || "Neon Racer";
    prepareJoin(roomId, safeDisplayName, playerId);
    gameSocket.connect({
      roomId,
      playerId,
      displayName: safeDisplayName
    });
  };

  return (
    <section className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-slate-950/52 backdrop-blur-sm">
      <div className="w-[min(94vw,42rem)] rounded-3xl border border-cyan-200/45 bg-[linear-gradient(145deg,rgba(11,25,57,0.95),rgba(14,9,35,0.92))] p-6 shadow-[0_0_35px_rgba(40,246,255,0.25)]">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/85">Race Complete</p>
        <h2 className="mt-2 text-3xl font-black tracking-[0.04em] text-cyan-50">
          {racePlacement ? `${toOrdinal(racePlacement)} Place` : "Results"}
        </h2>
        {winnerName ? <p className="mt-1 text-sm text-emerald-200/90">Winner: {winnerName}</p> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-1">
          <div className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.15em] text-cyan-200/85">Final Time</p>
            <p className="mt-1 text-2xl font-bold text-cyan-50">{formatDuration(elapsedMs)}</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-200/90">
          Race stopped when the finish line was reached.
        </p>

        <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-[0.15em] text-amber-200/85">Results Table</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm text-slate-100">
              <thead className="text-xs uppercase tracking-[0.12em] text-cyan-200/80">
                <tr>
                  <th className="pb-2">#</th>
                  <th className="pb-2">Driver</th>
                  <th className="pb-2">Lap</th>
                  <th className="pb-2">Position</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((player, index) => {
                  const isWinner = winnerPlayerId === player.playerId;
                  return (
                    <tr key={player.playerId} className={isWinner ? "text-emerald-200" : "text-slate-100"}>
                      <td className="py-1.5 pr-2">{index + 1}</td>
                      <td className="py-1.5 pr-2">{player.displayName}</td>
                      <td className="py-1.5 pr-2">L{Math.min(totalLaps, player.lap + 1)}</td>
                      <td className="py-1.5 pr-2">{formatMeters(player.positionMeters)}</td>
                      <td className="py-1.5 pr-2">{isWinner ? "Winner" : "Stopped"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleRaceAgain}
            className="rounded-xl border border-cyan-200/60 bg-cyan-400/25 px-5 py-2 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/35"
          >
            Race Again
          </button>
        </div>
      </div>
    </section>
  );
}
