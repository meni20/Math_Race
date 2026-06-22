import { useLanguage } from "../../i18n";
import type { TeacherDashboardStats } from "./teacherDashboardView";

interface TeacherStatsBarProps {
  stats: TeacherDashboardStats;
}

export function TeacherStatsBar({ stats }: TeacherStatsBarProps) {
  const { language } = useLanguage();
  const labels = language === "en" ? {
    accuracy: "Accuracy",
    answers: "Answers",
    averageTime: "Average time",
    students: "Students",
    events: "Events",
    leader: "Leader"
  } : {
    accuracy: "דיוק",
    answers: "תשובות",
    averageTime: "זמן ממוצע",
    students: "תלמידים",
    events: "אירועים",
    leader: "מוביל"
  };
  const accuracy = stats.classAccuracy === null ? "-" : `${stats.classAccuracy}%`;
  const averageResponse = stats.averageResponseTimeMs ? `${(stats.averageResponseTimeMs / 1000).toFixed(1)}s` : "-";

  return (
    <section className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.045] p-2 sm:grid-cols-2 lg:grid-cols-4">
      <StatPill label={labels.accuracy} value={accuracy} />
      <StatPill label={labels.answers} value={stats.totalAnswers} />
      <StatPill label={labels.averageTime} value={averageResponse} />
      <StatPill label={labels.students} value={stats.totalStudents} />
    </section>
  );
}

function StatPill({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-md border border-white/10 bg-slate-950/28 px-3 py-2 ${wide ? "lg:col-span-1" : ""}`}>
      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-cyan-100/65">{label}</p>
      <p className="mt-0.5 truncate text-base font-black text-white">{value}</p>
    </div>
  );
}
