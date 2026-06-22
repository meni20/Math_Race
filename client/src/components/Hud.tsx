import { useMemo } from "react";
import { useGameStore } from "../game/store/useGameStore";
import { getCarMetadata } from "../game/utils/carMetadata";
import {
  getDistanceToFinishMeters,
  getPlayerRaceDistanceMeters,
  isPlayerOnFinalLap
} from "../game/utils/renderMotion";
import { useRenderedPlayersUi } from "../game/utils/useRenderedPlayers";

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

function Speedometer({ speedKmh, accentColor }: { speedKmh: number; accentColor: string }) {
  const cappedSpeed = Math.max(0, Math.min(260, speedKmh));
  const needleRotation = -132 + (cappedSpeed / 260) * 264;
  const ticks = useMemo(() => Array.from({ length: 9 }, (_, index) => index), []);

  return (
    <section className="pointer-events-none absolute bottom-5 left-5 z-20 h-44 w-44 rounded-full border border-white/14 bg-slate-950/58 shadow-[0_16px_38px_rgba(2,8,23,0.32)]">
      <div
        className="absolute inset-3 rounded-full border"
        style={{
          borderColor: `${accentColor}55`,
          boxShadow: `0 0 28px ${accentColor}33, inset 0 0 28px rgba(255,255,255,0.05)`
        }}
      />
      <div className="absolute inset-5 rounded-full border border-white/10 bg-slate-950/20" />
      {ticks.map((tick) => {
        const angle = -132 + tick * 33;
        return (
          <span
            key={`speed-tick-${tick}`}
            className="absolute left-1/2 top-1/2 h-8 w-0.5 origin-[50%_4.75rem] rounded-full bg-white/45"
            style={{ transform: `translate(-50%, -4.75rem) rotate(${angle}deg)` }}
          />
        );
      })}
      <div
        className="absolute left-1/2 top-1/2 h-1.5 w-[4.6rem] origin-[0.32rem_50%] rounded-full transition-transform duration-150"
        style={{
          background: `linear-gradient(90deg, ${accentColor}, rgba(255,255,255,0.92))`,
          boxShadow: `0 0 18px ${accentColor}`,
          transform: `translate(-0.32rem, -50%) rotate(${needleRotation}deg)`
        }}
      />
      <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-slate-950 shadow-[0_0_18px_rgba(255,255,255,0.35)]" />
      <div className="absolute inset-x-0 bottom-9 text-center">
        <p className="text-3xl font-black leading-none text-slate-50">{speedKmh}</p>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: accentColor }}>
          KM/H
        </p>
      </div>
    </section>
  );
}

export function Hud() {
  const connection = useGameStore((state) => state.connection);
  const roomId = useGameStore((state) => state.roomId);
  const playerId = useGameStore((state) => state.playerId);
  const racePhase = useGameStore((state) => state.racePhase);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const feedback = useGameStore((state) => state.answerFeedback);
  const raceStartedAtMs = useGameStore((state) => state.raceStartedAtMs);
  const raceFinishedAtMs = useGameStore((state) => state.raceFinishedAtMs);
  const roomSettings = useGameStore((state) => state.roomSettings);
  const selectedCarId = useGameStore((state) => state.selectedCarId);
  const sessionMode = useGameStore((state) => state.sessionMode);
  const roomCreatorPlayerId = useGameStore((state) => state.roomCreatorPlayerId);
  const { nowMs, playerIds, players, localPlayer } = useRenderedPlayersUi();
  const localCar = getCarMetadata(localPlayer?.carId ?? selectedCarId);
  const localSpeedKmh = localPlayer ? toKmh(localPlayer.speedMps) : 0;
  const localScore = Math.max(0, Math.trunc(localPlayer?.score ?? 0));
  const targetScore = Math.max(1, Math.trunc(roomSettings.targetScore ?? trackLengthMeters));
  const isClassroomSession = sessionMode === "shared" && roomCreatorPlayerId === "";
  const raceElapsedMs = !isClassroomSession && raceStartedAtMs
    ? Math.max(0, (raceFinishedAtMs ?? nowMs) - raceStartedAtMs)
    : 0;
  const distanceToFinishMeters = !isClassroomSession
    ? getDistanceToFinishMeters(localPlayer, trackLengthMeters, totalLaps)
    : 0;
  const lapsRemainingToFinish = !isClassroomSession
    ? localPlayer
      ? Math.max(0, Math.ceil(distanceToFinishMeters / Math.max(1, trackLengthMeters)) - 1)
      : Math.max(0, totalLaps - 1)
    : 0;
  const finalLapActive = !isClassroomSession && isPlayerOnFinalLap(localPlayer, trackLengthMeters, totalLaps);
  const standings = useMemo(() => {
    return playerIds
      .map((currentPlayerId) => players[currentPlayerId])
      .filter((player): player is NonNullable<typeof player> => Boolean(player))
      .sort((a, b) => {
        if (racePhase === "lobby" || racePhase === "starting") {
          return a.laneIndex - b.laneIndex;
        }
        const scoreDelta = Math.max(0, Math.trunc(b.score ?? 0)) - Math.max(0, Math.trunc(a.score ?? 0));
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return (
          getPlayerRaceDistanceMeters(b, trackLengthMeters, totalLaps)
          - getPlayerRaceDistanceMeters(a, trackLengthMeters, totalLaps)
        );
      })
      .slice(0, 4);
  }, [playerIds, players, racePhase, totalLaps, trackLengthMeters]);

  if (connection !== "connected" || !roomId || racePhase !== "active") {
    return null;
  }

  return (
    <>
      {!isClassroomSession ? (
        <>
          <section className="pointer-events-none absolute left-5 top-5 z-20 w-[min(82vw,17rem)] rounded-2xl border border-white/12 bg-slate-950/58 p-3 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-100/80">שחקנים: {playerIds.length}/{roomSettings.maxPlayers}</p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-200">
                {racePhase}
              </span>
            </div>
            <ul className="space-y-1.5 text-sm">
              {standings.map((player, index) => (
                <li
                  key={player.playerId}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-2.5 py-2 ${
                    player.playerId === playerId
                      ? "border-cyan-100/25 bg-cyan-100/12 text-cyan-50"
                      : "border-white/8 bg-white/5 text-slate-100"
                  }`}
                >
                  <span className="min-w-0 truncate font-semibold">
                    {index + 1}. {player.playerId === playerId ? "אתה" : player.displayName}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-300">
                    {Math.max(0, Math.trunc(player.score ?? 0))} נק'
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="pointer-events-auto absolute right-5 top-5 z-20 flex max-w-[min(90vw,24rem)] items-center gap-3 rounded-full border border-white/12 bg-slate-950/58 py-2 pl-3 pr-4 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full border text-base font-black uppercase text-slate-50"
              style={{
                borderColor: `${localCar.accentColor}88`,
                background: `${localCar.accentColor}22`,
                boxShadow: `0 0 24px ${localCar.accentColor}33`
              }}
            >
              {(localPlayer?.displayName || "N").slice(0, 1)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-[0.14em] text-slate-100">חדר: {roomId}</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: localCar.accentColor }}>
                רכב: {localCar.name}
              </p>
              <p className="mt-0.5 truncate text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-100/85">
                ניקוד: {localScore} / {targetScore}
              </p>
            </div>
          </section>
        </>
      ) : null}

      <Speedometer speedKmh={localSpeedKmh} accentColor={localCar.accentColor} />

      {!isClassroomSession ? (
        <section className="pointer-events-none absolute bottom-5 right-5 z-20 rounded-2xl border border-white/12 bg-slate-950/58 px-4 py-3 text-right text-xs text-slate-200 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
          <p className="font-semibold text-slate-50">ניקוד {localScore}/{targetScore}</p>
          {sessionMode === "solo" ? (
            <p className="mt-1 text-amber-100/90">{localPlayer?.finished ? "הגעת ליעד" : `עוד ${Math.max(0, targetScore - localScore)} נק' לסיום`}</p>
          ) : (
            <p className="mt-1 text-amber-100/90">
              {localPlayer?.finished
                ? "הגעת ליעד הניקוד"
                : finalLapActive
                  ? `סיום: ${formatDistance(distanceToFinishMeters)}`
                  : `נפתח בעוד ${lapsRemainingToFinish} הקפות`}
            </p>
          )}
          <p className="mt-1 text-cyan-100/80">זמן מרוץ {formatClock(raceElapsedMs)}</p>
        </section>
      ) : null}

      {feedback && nowMs - feedback.receivedAtMs < 1200 ? (
        <section
          className={`pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-[0_14px_34px_rgba(2,8,23,0.3)] ${
            feedback.resultType === "TIMEOUT" || feedback.feedback === "timeout"
              ? "border-amber-300/50 bg-amber-400/25 text-amber-100"
              : feedback.correct
              ? "border-emerald-300/50 bg-emerald-400/25 text-emerald-100"
              : "border-rose-300/50 bg-rose-500/25 text-rose-100"
          }`}
        >
          {feedback.accepted
            ? feedback.resultType === "TIMEOUT" || feedback.feedback === "timeout"
              ? "נגמר הזמן"
              : feedback.correct
              ? "תשובה נכונה: הבוסט הופעל"
              : "תשובה לא נכונה: האטה"
            : "התשובה הגיעה מאוחר מדי, נשלחה שאלה חדשה"}
        </section>
      ) : null}
    </>
  );
}
