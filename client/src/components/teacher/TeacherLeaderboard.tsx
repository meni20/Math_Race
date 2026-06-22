import { useLanguage } from "../../i18n";
import type { TeacherPlayerView } from "./teacherTypes";
import { TeacherCarIcon } from "./TeacherCarIcon";

export function TeacherLeaderboard({ players }: { players: TeacherPlayerView[] }) {
  const { language } = useLanguage();
  const labels = language === "en" ? {
    title: "Leaderboard",
    empty: "No students yet."
  } : {
    title: "לוח מובילים",
    empty: "עדיין אין תלמידים."
  };

  return (
    <section className="rounded-lg border border-white/10 bg-white/6 p-4">
      <h2 className="text-lg font-black text-white">{labels.title}</h2>
      <div className="mt-3 grid gap-2">
        {players.length === 0 ? (
          <p className="rounded-lg bg-slate-950/28 px-3 py-3 text-sm text-slate-300">{labels.empty}</p>
        ) : players.map((player) => (
          <div key={player.playerId} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 rounded-lg bg-slate-950/30 px-3 py-2">
            <span className="text-sm font-black text-white">#{player.rank}</span>
            <TeacherCarIcon carId={player.carId} label={player.carName} className="h-7 w-14" />
            <span className="min-w-0 truncate text-sm font-semibold text-slate-100">{player.name}</span>
            <span className="text-sm font-bold text-cyan-100">{Math.round(player.progressPercent)}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
