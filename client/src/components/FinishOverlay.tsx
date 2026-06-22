import { useCallback, useEffect, useMemo, useState } from "react";
import { gameSocket } from "../game/network/gameSocket";
import { useGameStore } from "../game/store/useGameStore";
import type { PlayerSnapshot } from "../game/types/messages";
import { isSoloRoomId } from "../game/utils/gameIds";
import { getPlayerRaceDistanceMeters } from "../game/utils/renderMotion";
import { useRenderedPlayersUi } from "../game/utils/useRenderedPlayers";

const AUTO_RETURN_MS = 15000;

function formatDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
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

interface FinishSnapshot {
  finishedAtMs: number;
  localPlayer: PlayerSnapshot;
  placement: number | null;
  standings: PlayerSnapshot[];
  winnerName?: string;
  winnerPlayerId: string;
  raceStartedAtMs: number;
  isClassroomSession: boolean;
  isSoloSession: boolean;
  sessionMode: string;
}

function sortStandings(
  players: Record<string, PlayerSnapshot>,
  scoreResultSession: boolean,
  trackLengthMeters: number,
  totalLaps: number
) {
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
}

export function FinishOverlay() {
  const playerId = useGameStore((state) => state.playerId);
  const sessionMode = useGameStore((state) => state.sessionMode);
  const roomId = useGameStore((state) => state.roomId);
  const racePhase = useGameStore((state) => state.racePhase);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const raceStartedAtMs = useGameStore((state) => state.raceStartedAtMs);
  const raceFinishedAtMs = useGameStore((state) => state.raceFinishedAtMs);
  const racePlacement = useGameStore((state) => state.racePlacement);
  const raceStopped = useGameStore((state) => state.raceStopped);
  const winnerPlayerId = useGameStore((state) => state.winnerPlayerId);
  const roomCreatorPlayerId = useGameStore((state) => state.roomCreatorPlayerId);
  const { players } = useRenderedPlayersUi();

  const isClassroomSession = sessionMode === "shared" && roomCreatorPlayerId === "";
  const isSoloSession = isSoloFinishSession(sessionMode, roomId);
  const scoreResultSession = isSoloSession || isClassroomSession;
  const localPlayer = playerId ? players[playerId] : undefined;
  const winnerName = winnerPlayerId && players[winnerPlayerId] ? players[winnerPlayerId].displayName : undefined;
  const standings = useMemo(
    () => sortStandings(players, scoreResultSession, trackLengthMeters, totalLaps),
    [players, scoreResultSession, totalLaps, trackLengthMeters]
  );

  const [nowMs, setNowMs] = useState(Date.now());
  const [finishSnapshot, setFinishSnapshot] = useState<FinishSnapshot | null>(null);
  const finishDetected = Boolean(localPlayer && (raceStopped || racePhase === "finish" || localPlayer.finished));

  useEffect(() => {
    if (!finishDetected || !localPlayer || finishSnapshot) {
      return;
    }

    const finishIndex = standings.findIndex((player) => player.playerId === localPlayer.playerId);
    setFinishSnapshot({
      finishedAtMs: raceFinishedAtMs ?? Date.now(),
      localPlayer,
      placement: racePlacement ?? (finishIndex >= 0 ? finishIndex + 1 : null),
      standings,
      winnerName,
      winnerPlayerId,
      raceStartedAtMs,
      isClassroomSession,
      isSoloSession,
      sessionMode
    });
  }, [
    finishDetected,
    finishSnapshot,
    isClassroomSession,
    isSoloSession,
    localPlayer,
    raceFinishedAtMs,
    racePlacement,
    raceStartedAtMs,
    sessionMode,
    standings,
    winnerName,
    winnerPlayerId
  ]);

  const handleReturn = useCallback(() => {
    setFinishSnapshot(null);
    if (isClassroomSession) {
      void gameSocket.leaveRoom();
      return;
    }
    if (sessionMode === "shared") {
      gameSocket.returnToLobby();
      return;
    }
    void gameSocket.leaveRoom();
  }, [isClassroomSession, sessionMode]);

  useEffect(() => {
    if (!finishSnapshot) {
      return undefined;
    }
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 250);
    const remainingMs = Math.max(0, AUTO_RETURN_MS - (Date.now() - finishSnapshot.finishedAtMs));
    const timeoutId = window.setTimeout(handleReturn, remainingMs);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [finishSnapshot, handleReturn]);

  if (!finishSnapshot) {
    return null;
  }

  const elapsedMs = finishSnapshot.raceStartedAtMs > 0
    ? Math.max(0, finishSnapshot.finishedAtMs - finishSnapshot.raceStartedAtMs)
    : 0;
  const returnCountdownSeconds = Math.ceil(Math.max(0, AUTO_RETURN_MS - (nowMs - finishSnapshot.finishedAtMs)) / 1000);

  const renderScoreTable = () => (
    <table className="w-full min-w-[34rem] text-left text-sm text-slate-100">
      <thead className="text-xs uppercase tracking-[0.12em] text-cyan-200/80">
        <tr>
          {SOLO_FINISH_RESULT_COLUMNS.map((column) => (
            <th key={column} className="pb-2">{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {finishSnapshot.standings.map((player, index) => {
          const isWinner = finishSnapshot.winnerPlayerId === player.playerId;
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
  );

  return (
    <section className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-slate-950/68">
      <div className="w-[min(94vw,42rem)] rounded-3xl border border-cyan-200/45 bg-[linear-gradient(145deg,rgba(11,25,57,0.95),rgba(14,9,35,0.92))] p-6 shadow-[0_0_35px_rgba(40,246,255,0.25)]">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/85">המרוץ הסתיים</p>
        <h2 className="mt-2 text-3xl font-black tracking-[0.04em] text-cyan-50">
          {finishSnapshot.placement ? placementLabel(finishSnapshot.placement) : "תוצאות"}
        </h2>
        {finishSnapshot.winnerName ? <p className="mt-1 text-sm text-emerald-200/90">מנצח: {finishSnapshot.winnerName}</p> : null}

        <div className="mt-5 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3">
          <p className="text-xs uppercase tracking-[0.15em] text-cyan-200/85">זמן סופי</p>
          <p className="mt-1 text-2xl font-bold text-cyan-50">{formatDuration(elapsedMs)}</p>
        </div>

        <p className="mt-4 text-sm text-slate-200/90">
          המרוץ נעצר כששחקן הגיע לניקוד היעד.
        </p>

        <p className="mt-2 rounded-xl border border-cyan-100/20 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-50">
          חזרה אוטומטית ללובי בעוד {returnCountdownSeconds} שניות.
        </p>

        <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-[0.15em] text-amber-200/85">טבלת תוצאות</p>
          <div className="mt-2 overflow-x-auto">
            {finishSnapshot.isSoloSession || finishSnapshot.isClassroomSession ? renderScoreTable() : (
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
                  {finishSnapshot.standings.map((player, index) => {
                    const isWinner = finishSnapshot.winnerPlayerId === player.playerId;
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
            {finishSnapshot.sessionMode === "shared" ? "חזרה ללובי" : "חזרה ללובי האישי"}
          </button>
        </div>
      </div>
    </section>
  );
}
