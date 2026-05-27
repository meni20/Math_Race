import type { TeacherDashboardStats } from "./teacherDashboardView";

interface TeacherRaceStatsProps {
  stats: TeacherDashboardStats;
}

export function TeacherRaceStats({ stats }: TeacherRaceStatsProps) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <StatCard label="Class accuracy" value={stats.classAccuracy === null ? "-" : `${stats.classAccuracy}%`} />
      <StatCard label="Total answers" value={stats.totalAnswers} />
      <StatCard label="Avg response" value={stats.averageResponseTimeMs ? `${(stats.averageResponseTimeMs / 1000).toFixed(1)}s` : "-"} />
      <StatCard label="Students" value={stats.totalStudents} />
      <StatCard label="Live events" value={stats.liveEventsCount} />
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.065] px-4 py-3 shadow-[0_12px_30px_rgba(2,8,23,0.18)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/70">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
