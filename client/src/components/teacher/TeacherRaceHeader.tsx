import { useLanguage } from "../../i18n";
import type { TeacherRoomSnapshot } from "./teacherTypes";

interface TeacherRaceHeaderProps {
  title: string;
  snapshot: TeacherRoomSnapshot | null;
  targetLabel: string;
  playerCount: number;
  canStart: boolean;
  canEnd: boolean;
  onStart: () => void;
  onEnd: () => void;
  onNewRoom: () => void;
  onOpenRooms: () => void;
}

function phaseLabel(snapshot: TeacherRoomSnapshot | null, language: "he" | "en") {
  if (!snapshot) {
    return language === "en" ? "Setup" : "הגדרה";
  }
  if (snapshot.lifecycleStatus === "CLOSED") {
    return language === "en" ? "Closed" : "סגור";
  }
  if (snapshot.lifecycleStatus === "DELETED") {
    return language === "en" ? "Deleted" : "נמחק";
  }
  if (snapshot.racePhase === "active") {
    return language === "en" ? "Racing" : "במרוץ";
  }
  if (snapshot.racePhase === "starting") {
    return language === "en" ? "Starting" : "מתחיל";
  }
  if (snapshot.racePhase === "finish") {
    return language === "en" ? "Finished" : "הסתיים";
  }
  return language === "en" ? "Waiting" : "ממתין";
}

export function TeacherRaceHeader({
  title,
  snapshot,
  targetLabel,
  playerCount,
  canStart,
  canEnd,
  onStart,
  onEnd,
  onNewRoom,
  onOpenRooms
}: TeacherRaceHeaderProps) {
  const { language } = useLanguage();
  const labels = language === "en" ? {
    dashboard: "Teacher dashboard",
    room: "Room",
    status: "Status",
    target: "Target",
    students: "Students",
    connection: "Connection",
    localDev: "Local dev",
    rooms: "Rooms",
    studentMode: "Student mode",
    newRoom: "New",
    start: "Start",
    end: "End",
    closeView: "Close view"
  } : {
    dashboard: "לוח מורה",
    room: "חדר",
    status: "סטטוס",
    target: "יעד",
    students: "תלמידים",
    connection: "חיבור",
    localDev: "פיתוח מקומי",
    rooms: "חדרים",
    studentMode: "מצב תלמיד",
    newRoom: "חדש",
    start: "התחל",
    end: "סיים",
    closeView: "סגור תצוגה"
  };
  const maxPlayers = snapshot?.roomSettings.maxPlayers ?? 8;
  return (
    <header className="rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/70">{labels.dashboard}</p>
          <h1 className="mt-0.5 truncate text-xl font-black text-white sm:text-2xl">{title}</h1>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {snapshot ? <HeaderPill label={labels.room} value={snapshot.roomId} tone="cyan" /> : null}
          <HeaderPill label={labels.status} value={phaseLabel(snapshot, language)} />
          <HeaderPill label={labels.target} value={targetLabel} />
          <HeaderPill label={labels.students} value={`${playerCount}/${maxPlayers}`} />
          <button type="button" onClick={onOpenRooms} className="rounded-full border border-white/12 bg-white/[0.07] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/[0.12]">
            {labels.rooms}
          </button>
          <button type="button" onClick={onNewRoom} className="rounded-full border border-white/12 bg-white/[0.07] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/[0.12]">
            {labels.newRoom}
          </button>
          {snapshot ? (
            <>
              <button
                type="button"
                onClick={onStart}
                disabled={!canStart}
                className="rounded-full border border-emerald-200/35 bg-emerald-400/14 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-50 transition hover:bg-emerald-400/22 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {labels.start}
              </button>
              <button
                type="button"
                onClick={onEnd}
                disabled={!canEnd}
                className="rounded-full border border-rose-200/30 bg-rose-500/12 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {labels.end}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function HeaderPill({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "cyan" | "emerald" }) {
  const toneClass = tone === "cyan"
    ? "border-cyan-100/20 bg-cyan-100/10 text-cyan-50"
    : tone === "emerald"
      ? "border-emerald-100/15 bg-emerald-300/10 text-emerald-100"
      : "border-white/10 bg-white/6 text-slate-200";
  return (
    <span className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] ${toneClass}`}>
      <span className="opacity-70">{label}</span> {value}
    </span>
  );
}
