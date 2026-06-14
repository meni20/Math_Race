import type { FormEvent } from "react";
import type { TeacherRaceConfig } from "./teacherTypes";
import { TRACK_THEME_LABELS } from "./teacherUtils";

interface TeacherCreateRacePanelProps {
  config: TeacherRaceConfig;
  connecting: boolean;
  disabledReason?: string;
  onConfigChange: (config: TeacherRaceConfig) => void;
  onCreate: () => void;
}

export function TeacherCreateRacePanel({ config, connecting, disabledReason, onConfigChange, onCreate }: TeacherCreateRacePanelProps) {
  const update = (patch: Partial<TeacherRaceConfig>) => onConfigChange({ ...config, ...patch });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate();
  };

  return (
    <form className="flex flex-1 py-6" onSubmit={submit}>
      <section className="w-full rounded-lg border border-white/10 bg-white/6 p-5">
        <h2 className="text-lg font-black text-white">יצירת חדר מרוץ</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">שם המרוץ</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.raceName}
              onChange={(event) => update({ raceName: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">כיתה / קבוצה</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.classGroup}
              onChange={(event) => update({ classGroup: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">קוד חדר</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm uppercase tracking-[0.08em] text-white outline-none focus:border-cyan-100/40"
              value={config.roomCode}
              onChange={(event) => update({ roomCode: event.target.value })}
              placeholder="נוצר אוטומטית"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">מפה / מסלול</span>
            <select
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.trackTheme}
              onChange={(event) => update({ trackTheme: event.target.value as TeacherRaceConfig["trackTheme"] })}
            >
              {Object.entries(TRACK_THEME_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">רמה</span>
            <select
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.difficulty}
              onChange={(event) => update({ difficulty: event.target.value as TeacherRaceConfig["difficulty"] })}
            >
              <option value="EASY">קל</option>
              <option value="MEDIUM">בינוני</option>
              <option value="HARD">קשה</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">נקודות יעד לניצחון</span>
            <input
              type="number"
              inputMode="numeric"
              min={50}
              max={10000}
              step={1}
              placeholder="300"
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.targetScore}
              onChange={(event) => update({ targetScore: Math.trunc(Number(event.target.value) || 300) })}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={connecting || Boolean(disabledReason)}
          className="mt-6 w-full rounded-lg border border-cyan-100/35 bg-cyan-300/14 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/22 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {connecting ? "יוצר חדר..." : "צור חדר"}
        </button>
        {disabledReason ? (
          <p className="mt-3 rounded-lg border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{disabledReason}</p>
        ) : null}
      </section>
    </form>
  );
}
