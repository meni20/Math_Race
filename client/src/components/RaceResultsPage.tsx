import { useMemo } from "react";
import { loadRaceResults, type RaceResultPlayer } from "../game/results/raceResults";

interface RaceResultsPageProps {
  sessionId: string;
}

const PODIUM_ORDER = [1, 0, 2] as const;
const PODIUM_META = [
  { place: 1, icon: "🏆", label: "מקום ראשון", tone: "from-amber-300 to-yellow-500", height: "h-44 md:h-56" },
  { place: 2, icon: "🥈", label: "מקום שני", tone: "from-slate-200 to-slate-400", height: "h-32 md:h-44" },
  { place: 3, icon: "🥉", label: "מקום שלישי", tone: "from-orange-300 to-amber-600", height: "h-24 md:h-36" }
] as const;

function accuracy(player: RaceResultPlayer) {
  const total = player.correctAnswers + player.wrongAnswers + player.timeoutAnswers;
  return total > 0 ? Math.round((player.correctAnswers / total) * 100) : null;
}

function formatTime(milliseconds: number | null) {
  if (!milliseconds) {
    return "אין נתונים עדיין";
  }
  return `${(milliseconds / 1000).toFixed(1)} שנ׳`;
}

function routeLabel(routeMode: string) {
  const route = routeMode.toUpperCase();
  if (route.includes("HIGHWAY")) return "אוטוסטרדה";
  if (route.includes("DIRT")) return "דרך עפר";
  return routeMode.trim() || "מסלול רגיל";
}

function ExhaustConfetti() {
  const particles = useMemo(() => Array.from({ length: 42 }, (_, index) => ({
    id: index,
    color: ["#fb7185", "#facc15", "#38bdf8", "#4ade80", "#a78bfa"][index % 5],
    left: `${(index * 37) % 100}%`,
    delay: `${(index % 7) * 0.055}s`,
    drift: `${((index * 29) % 180) - 90}px`
  })), []);

  return (
    <div className="race-confetti" aria-hidden="true">
      {["left", "right"].map((side) => (
        <div key={side} className={`race-exhaust-bank race-exhaust-bank--${side}`}>
          {[0, 1, 2].map((pipe) => <span key={pipe} className="race-exhaust" />)}
        </div>
      ))}
      {particles.map((particle) => (
        <i
          key={particle.id}
          style={{
            backgroundColor: particle.color,
            left: particle.left,
            animationDelay: `calc(2.35s + ${particle.delay})`,
            "--confetti-drift": particle.drift
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function PodiumCard({ player, index }: { player: RaceResultPlayer; index: number }) {
  const meta = PODIUM_META[index];
  const playerAccuracy = accuracy(player);
  return (
    <article className={`race-podium-entry race-podium-entry--${meta.place} min-w-0`}>
      <div className="mb-3 text-center">
        <div className="text-4xl drop-shadow-md" aria-hidden="true">{meta.icon}</div>
        <h2 className="mt-2 truncate px-1 text-lg font-black text-slate-900" title={player.name}>{player.name}</h2>
        <p className="text-sm font-black text-indigo-700">{player.score} נקודות</p>
        <div className="mt-2 flex flex-wrap justify-center gap-1 text-[11px] font-bold text-slate-600">
          <span className="rounded-full bg-white/75 px-2 py-1">{formatTime(player.averageAnswerTimeMs)}</span>
          <span className="rounded-full bg-white/75 px-2 py-1">{playerAccuracy === null ? "אין דיוק" : `${playerAccuracy}% דיוק`}</span>
          <span className="rounded-full bg-white/75 px-2 py-1">{routeLabel(player.routeMode)}</span>
        </div>
      </div>
      <div className={`${meta.height} flex items-start justify-center rounded-t-3xl bg-gradient-to-b ${meta.tone} pt-4 shadow-[0_16px_35px_rgba(30,41,59,0.2)]`}>
        <span className="text-4xl font-black text-white/95 drop-shadow">{meta.place}</span>
      </div>
    </article>
  );
}

export function RaceResultsPage({ sessionId }: RaceResultsPageProps) {
  const results = useMemo(() => loadRaceResults(sessionId), [sessionId]);
  const players = results?.players ?? [];
  const fastest = players.filter((player) => player.averageAnswerTimeMs !== null)
    .sort((a, b) => (a.averageAnswerTimeMs ?? Infinity) - (b.averageAnswerTimeMs ?? Infinity))[0];
  const perfect = players.filter((player) => accuracy(player) === 100);
  const highway = players.filter((player) => player.routeMode.toUpperCase().includes("HIGHWAY"));
  const dirt = players.filter((player) => player.routeMode.toUpperCase().includes("DIRT"));

  return (
    <section dir="rtl" className="race-results-page relative z-[100] min-h-screen overflow-x-hidden bg-[#f4f7ff] px-4 py-8 text-slate-900 md:px-8">
      <div className="race-checkers absolute inset-x-0 top-0 h-5 opacity-80" />
      <div className="pointer-events-none absolute -right-28 top-20 h-72 w-72 rounded-full bg-cyan-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -left-24 top-44 h-72 w-72 rounded-full bg-fuchsia-300/25 blur-3xl" />
      <ExhaustConfetti />

      <div className="relative mx-auto max-w-7xl">
        <header className="text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-600">קו הסיום · חדר {sessionId}</p>
          <h1 className="mt-2 text-4xl font-black text-slate-950 md:text-6xl">תוצאות המרוץ</h1>
          <p className="mt-2 text-base font-bold text-slate-600">{results?.raceName ?? "מרוץ מתמטיקה"}</p>
        </header>

        {players.length === 0 ? (
          <div className="mx-auto mt-16 max-w-xl rounded-3xl border border-indigo-100 bg-white p-10 text-center shadow-xl shadow-indigo-100/60">
            <div className="text-5xl">🏁</div>
            <h2 className="mt-4 text-2xl font-black">אין נתוני תוצאות עדיין</h2>
            <p className="mt-2 text-slate-500">התוצאות יופיעו כאן מיד לאחר סיום המרוץ.</p>
          </div>
        ) : (
          <div className="mt-10 grid items-end gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="grid grid-cols-3 items-end gap-2 md:gap-5">
              {PODIUM_ORDER.map((playerIndex) => players[playerIndex] ? (
                <PodiumCard key={players[playerIndex].playerId} player={players[playerIndex]} index={playerIndex} />
              ) : <div key={playerIndex} />)}
            </div>

            <aside className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {[
                ["⚡", "מהיר הסבב", fastest ? `${fastest.name} · ${formatTime(fastest.averageAnswerTimeMs)}` : "אין נתונים עדיין"],
                ["🎯", "ענה בלי טעויות", perfect.length ? perfect.map((player) => player.name).join(", ") : "אין נתונים עדיין"],
                ["🛣️", "אוטוסטרדה", highway.length ? highway.map((player) => player.name).join(", ") : "אין נתונים עדיין"],
                ["🏜️", "דרך עפר", dirt.length ? dirt.map((player) => player.name).join(", ") : "אין נתונים עדיין"]
              ].map(([icon, label, value]) => (
                <div key={label} className="rounded-2xl border border-white bg-white/85 p-4 shadow-lg shadow-indigo-100/60 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.1em] text-indigo-600">{label}</p>
                      <p className="mt-1 break-words text-sm font-bold text-slate-700">{value}</p>
                    </div>
                  </div>
                </div>
              ))}
            </aside>
          </div>
        )}

        {players.length > 3 ? (
          <div className="mt-8 overflow-hidden rounded-3xl border border-indigo-100 bg-white/90 shadow-xl shadow-indigo-100/60">
            {players.slice(3).map((player, index) => (
              <div key={player.playerId} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                <span className="text-lg font-black text-indigo-500">{index + 4}</span>
                <span className="truncate font-black" title={player.name}>{player.name}</span>
                <span className="text-sm font-bold text-slate-600">{player.score} נק׳ · {accuracy(player) ?? "—"}%</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-8 text-center">
          <button type="button" onClick={() => { window.history.pushState(null, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); }} className="rounded-full bg-indigo-600 px-7 py-3 text-sm font-black text-white shadow-lg shadow-indigo-300 transition hover:-translate-y-0.5 hover:bg-indigo-700">
            חזרה למסך הראשי
          </button>
        </div>
      </div>
    </section>
  );
}
