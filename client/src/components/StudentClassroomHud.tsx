import { useLanguage } from "../i18n";

interface StudentClassroomHudProps {
  roomCode: string;
  currentStudents: number;
  maxStudents: number;
  playerName: string;
  position: number | null;
  score: number;
  targetScore: number;
  status?: string;
  onLeave: () => void;
}

function statusLabel(status: string | undefined, language: "he" | "en") {
  if (!status) {
    return "";
  }
  if (language === "en") {
    if (status === "WAITING") {
      return "Waiting";
    }
    if (status === "STARTING") {
      return "Starting";
    }
    if (status === "RACING" || status === "ACTIVE") {
      return "Racing";
    }
    if (status === "FINISHED") {
      return "Finished";
    }
    return status;
  }
  if (status === "WAITING") {
    return "ממתין";
  }
  if (status === "STARTING") {
    return "מתחיל";
  }
  if (status === "RACING" || status === "ACTIVE") {
    return "במרוץ";
  }
  if (status === "FINISHED") {
    return "הסתיים";
  }
  return status;
}

export function StudentClassroomHud({
  roomCode,
  currentStudents,
  maxStudents,
  playerName,
  position,
  score,
  targetScore,
  status,
  onLeave
}: StudentClassroomHudProps) {
  const { language } = useLanguage();
  const labels = language === "en" ? {
    room: "Room",
    students: "Students",
    position: "Position",
    score: "Score",
    leave: "Leave"
  } : {
    room: "חדר",
    students: "תלמידים",
    position: "מיקום",
    score: "ניקוד",
    leave: "יציאה"
  };

  return (
    <>
      <section className="pointer-events-auto absolute left-3 top-3 z-30 rounded-lg border border-white/12 bg-slate-950/58 px-3 py-2 shadow-[0_14px_34px_rgba(2,8,23,0.3)] backdrop-blur-xl sm:left-5 sm:top-5 sm:px-4 sm:py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100/70">{labels.room}: {roomCode}</p>
        <p className="mt-1 text-xs font-bold text-slate-100">{labels.students}: {currentStudents}/{maxStudents}</p>
        {status ? <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-100/85">{statusLabel(status, language)}</p> : null}
      </section>

      <section className="pointer-events-auto absolute right-3 top-3 z-30 flex items-center gap-2 rounded-lg border border-white/12 bg-slate-950/58 px-3 py-2 shadow-[0_14px_34px_rgba(2,8,23,0.3)] backdrop-blur-xl sm:right-5 sm:top-5 sm:gap-3 sm:px-4 sm:py-3">
        <div className="min-w-0 text-right">
          <p className="max-w-32 truncate text-sm font-black text-white sm:max-w-48">{playerName}</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/75">{labels.position}: {position ? `#${position}` : "-"}</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-100/85">{labels.score}: {score} / {targetScore}</p>
        </div>
        <button
          type="button"
          onClick={onLeave}
          className="rounded-full border border-rose-200/30 bg-rose-500/12 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20"
        >
          {labels.leave}
        </button>
      </section>
    </>
  );
}
