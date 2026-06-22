import type { FormEvent } from "react";
import { LanguageToggle } from "../LanguageToggle";
import { useLanguage } from "../../i18n";
import type { TeacherRaceConfig } from "./teacherTypes";
import { TRACK_THEME_LABELS } from "./teacherUtils";

interface TeacherCreateRacePanelProps {
  config: TeacherRaceConfig;
  connecting: boolean;
  disabledReason?: string;
  onConfigChange: (config: TeacherRaceConfig) => void;
  onCreate: () => void;
}

const EN_TRACK_LABELS: Record<string, string> = {
  "sunny-forest": "Sunny Forest",
  "snow-peak": "Snow Peak",
  "fun-world": "Fun World",
  grand_prix: "Grand Prix Stadium"
};

export function TeacherCreateRacePanel({ config, connecting, disabledReason, onConfigChange, onCreate }: TeacherCreateRacePanelProps) {
  const { language } = useLanguage();
  const labels = language === "en" ? {
    title: "Create race room",
    raceName: "Race name",
    classGroup: "Class / group",
    roomCode: "Room code",
    roomCodePlaceholder: "Generated automatically",
    map: "Map / track",
    difficulty: "Difficulty",
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
    targetScore: "Target points to win",
    creating: "Creating room...",
    create: "Create room"
  } : {
    title: "יצירת חדר מרוץ",
    raceName: "שם המרוץ",
    classGroup: "כיתה / קבוצה",
    roomCode: "קוד חדר",
    roomCodePlaceholder: "נוצר אוטומטית",
    map: "מפה / מסלול",
    difficulty: "רמה",
    easy: "קל",
    medium: "בינוני",
    hard: "קשה",
    targetScore: "נקודות יעד לניצחון",
    creating: "יוצר חדר...",
    create: "צור חדר"
  };
  const trackLabels = language === "en" ? EN_TRACK_LABELS : TRACK_THEME_LABELS;
  const update = (patch: Partial<TeacherRaceConfig>) => onConfigChange({ ...config, ...patch });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate();
  };

  return (
    <form className="w-[min(94vw,42rem)]" onSubmit={submit}>
      <section className="w-full rounded-2xl border border-white/14 bg-slate-950/88 p-5 shadow-[0_34px_100px_rgba(2,8,23,0.55)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-white">{labels.title}</h2>
          <LanguageToggle />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">{labels.raceName}</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.raceName}
              onChange={(event) => update({ raceName: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">{labels.classGroup}</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.classGroup}
              onChange={(event) => update({ classGroup: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">{labels.roomCode}</span>
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm uppercase tracking-[0.08em] text-white outline-none focus:border-cyan-100/40"
              value={config.roomCode}
              onChange={(event) => update({ roomCode: event.target.value })}
              placeholder={labels.roomCodePlaceholder}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">{labels.map}</span>
            <select
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.trackTheme}
              onChange={(event) => update({ trackTheme: event.target.value as TeacherRaceConfig["trackTheme"] })}
            >
              {Object.entries(trackLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">{labels.difficulty}</span>
            <select
              className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
              value={config.difficulty}
              onChange={(event) => update({ difficulty: event.target.value as TeacherRaceConfig["difficulty"] })}
            >
              <option value="EASY">{labels.easy}</option>
              <option value="MEDIUM">{labels.medium}</option>
              <option value="HARD">{labels.hard}</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">{labels.targetScore}</span>
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
          {connecting ? labels.creating : labels.create}
        </button>
        {disabledReason ? (
          <p className="mt-3 rounded-lg border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{disabledReason}</p>
        ) : null}
      </section>
    </form>
  );
}
