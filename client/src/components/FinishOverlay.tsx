import { useMemo } from "react";
import { gameSocket } from "../game/network/gameSocket";
import { useGameStore } from "../game/store/useGameStore";
import { getPlayerRaceDistanceMeters } from "../game/utils/renderMotion";
import { useRenderedPlayers } from "../game/utils/useRenderedPlayers";
import { isSoloRoomId } from "../game/utils/gameIds";
// בדיקה אחרונהההה!!!!!!!!!
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
  return `${Math.round(Math.max(0, meters))} מ'`;
}

function placementLabel(value: number) {
  return `מקום ${value}`;
}

export function isSoloFinishSession(sessionMode: string, roomId: string | null | undefined) {
  return sessionMode === "solo" || isSoloRoomId(roomId);
}

export const SOLO_FINISH_RESULT_COLUMNS = ["#", "נהג", "ניקוד", "נכונות", "טעויות", "זמן", "סטטוס"] as const;

export function FinishOverlay() {
  const playerId = useGameStore((state) => state.playerId);
  const sessionMode = useGameStore((state) => state.sessionMode);
  const roomId = useGameStore((state) => state.roomId);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const raceStartedAtMs = useGameStore((state) => state.raceStartedAtMs);
  const raceFinishedAtMs = useGameStore((state) => state.raceFinishedAtMs);
  const racePlacement = useGameStore((state) => state.racePlacement);
  const raceStopped = useGameStore((state) => state.raceStopped);
  const winnerPlayerId = useGameStore((state) => state.winnerPlayerId);
  const roomCreatorPlayerId = useGameStore((state) => state.roomCreatorPlayerId);
  const { players } = useRenderedPlayers();
  const isClassroomSession = sessionMode === "shared" && roomCreatorPlayerId === "";
  const isSoloSession = isSoloFinishSession(sessionMode, roomId);
  const scoreResultSession = isSoloSession || isClassroomSession;

  const localPlayer = playerId ? players[playerId] : undefined;
  const winnerName = winnerPlayerId && players[winnerPlayerId] ? players[winnerPlayerId].displayName : undefined;

  const standings = useMemo(() => {
    return Object.values(players)
      .filter((player) => player.racePhase !== "lobby" || player.finished)
      .sort((a, b) => {
        const scoreDelta = Math.max(0, Math.trunc(b.score ?? 0)) - Math.max(0, Math.trunc(a.score ?? 0));
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        if (scoreResultSession) {
          const correctDelta = Math.max(0, Math.trunc(b.correctAnswers ?? 0)) - Math.max(0, Math.trunc(a.correctAnswers ?? 0));
          if (correctDelta !== 0) {
            return correctDelta;
          }
          const wrongDelta = Math.max(0, Math.trunc(a.wrongAnswers ?? 0)) - Math.max(0, Math.trunc(b.wrongAnswers ?? 0));
          if (wrongDelta !== 0) {
            return wrongDelta;
          }
          return Math.max(0, Math.trunc(a.timeoutAnswers ?? 0)) - Math.max(0, Math.trunc(b.timeoutAnswers ?? 0));
        }
        return (
          getPlayerRaceDistanceMeters(b, trackLengthMeters, totalLaps)
          - getPlayerRaceDistanceMeters(a, trackLengthMeters, totalLaps)
        );
      });
  }, [players, scoreResultSession, totalLaps, trackLengthMeters]);

  if (!raceStopped || !localPlayer || !raceFinishedAtMs || raceStartedAtMs <= 0) {
    return null;
  }

  const elapsedMs = Math.max(0, raceFinishedAtMs - raceStartedAtMs);

  const handleReturn = () => {
    if (isClassroomSession) {
      void gameSocket.leaveRoom();
      return;
    }
    if (sessionMode === "shared") {
      gameSocket.returnToLobby();
      return;
    }
    void gameSocket.leaveRoom();
  };

  return (
    <section className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-slate-950/68">
      <div className="w-[min(94vw,42rem)] rounded-3xl border border-cyan-200/45 bg-[linear-gradient(145deg,rgba(11,25,57,0.95),rgba(14,9,35,0.92))] p-6 shadow-[0_0_35px_rgba(40,246,255,0.25)]">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/85">המרוץ הסתיים</p>
        <h2 className="mt-2 text-3xl font-black tracking-[0.04em] text-cyan-50">
          {racePlacement ? placementLabel(racePlacement) : "תוצאות"}
        </h2>
        {winnerName ? <p className="mt-1 text-sm text-emerald-200/90">מנצח: {winnerName}</p> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-1">
          <div className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.15em] text-cyan-200/85">זמן סופי</p>
            <p className="mt-1 text-2xl font-bold text-cyan-50">{formatDuration(elapsedMs)}</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-200/90">
          המרוץ נעצר כששחקן הגיע לניקוד היעד.
        </p>

        <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-[0.15em] text-amber-200/85">טבלת תוצאות</p>
          <div className="mt-2 overflow-x-auto">
            {isSoloSession ? (
              <table className="w-full min-w-[34rem] text-left text-sm text-slate-100">
                <thead className="text-xs uppercase tracking-[0.12em] text-cyan-200/80">
                  <tr>
                    {SOLO_FINISH_RESULT_COLUMNS.map((column) => (
                      <th key={column} className="pb-2">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((player, index) => {
                    const isWinner = winnerPlayerId === player.playerId;
                    return (
                      <tr key={player.playerId} className={isWinner ? "text-emerald-200" : "text-slate-100"}>
                        <td className="py-1.5 pr-2">{index + 1}</td>
                        <td className="py-1.5 pr-2">{player.displayName}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.score ?? 0))}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.correctAnswers ?? 0))}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.wrongAnswers ?? 0))}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.timeoutAnswers ?? 0))}</td>
                        <td className="py-1.5 pr-2">{isWinner ? "מנצח" : "נעצר"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : isClassroomSession ? (
              <table className="w-full min-w-[34rem] text-left text-sm text-slate-100">
                <thead className="text-xs uppercase tracking-[0.12em] text-cyan-200/80">
                  <tr>
                    {SOLO_FINISH_RESULT_COLUMNS.map((column) => (
                      <th key={column} className="pb-2">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((player, index) => {
                    const isWinner = winnerPlayerId === player.playerId;
                    return (
                      <tr key={player.playerId} className={isWinner ? "text-emerald-200" : "text-slate-100"}>
                        <td className="py-1.5 pr-2">{index + 1}</td>
                        <td className="py-1.5 pr-2">{player.displayName}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.score ?? 0))}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.correctAnswers ?? 0))}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.wrongAnswers ?? 0))}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.timeoutAnswers ?? 0))}</td>
                        <td className="py-1.5 pr-2">{isWinner ? "מנצח" : "נעצר"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[28rem] text-left text-sm text-slate-100">
                <thead className="text-xs uppercase tracking-[0.12em] text-cyan-200/80">
                  <tr>
                    <th className="pb-2">#</th>
                    <th className="pb-2">נהג</th>
                    <th className="pb-2">ניקוד</th>
                    <th className="pb-2">התקדמות</th>
                    <th className="pb-2">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((player, index) => {
                    const isWinner = winnerPlayerId === player.playerId;
                    return (
                      <tr key={player.playerId} className={isWinner ? "text-emerald-200" : "text-slate-100"}>
                        <td className="py-1.5 pr-2">{index + 1}</td>
                        <td className="py-1.5 pr-2">{player.displayName}</td>
                        <td className="py-1.5 pr-2">{Math.max(0, Math.trunc(player.score ?? 0))}</td>
                        <td className="py-1.5 pr-2">{formatMeters(player.positionMeters)}</td>
                        <td className="py-1.5 pr-2">{isWinner ? "מנצח" : "נעצר"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleReturn}
            className="rounded-xl border border-cyan-200/60 bg-cyan-400/25 px-5 py-2 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/35"
          >
            {sessionMode === "shared" ? "חזרה ללובי" : "חזרה ללובי האישי"}
          </button>
        </div>
      </div>
    </section>
  );
}
