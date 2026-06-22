import { useLanguage } from "../../i18n";
import type { TeacherPlayerView } from "./teacherTypes";
import { TeacherCarIcon } from "./TeacherCarIcon";

interface TeacherRaceLaneProps {
  laneNumber: number;
  player?: TeacherPlayerView;
}

function clampProgress(progressPercent: number) {
  return Math.max(0, Math.min(100, progressPercent));
}

export function getTeacherCarLeftPercent(progressPercent: number) {
  return `${clampProgress(progressPercent)}%`;
}

function statusTone(status: TeacherPlayerView["status"]) {
  if (status === "RACING") {
    return "text-emerald-100";
  }
  if (status === "JOINED") {
    return "text-cyan-100";
  }
  if (status === "FINISHED") {
    return "text-violet-100";
  }
  return "text-slate-300";
}

function statusLabel(status: TeacherPlayerView["status"], language: "he" | "en") {
  if (language === "en") {
    if (status === "RACING") {
      return "Racing";
    }
    if (status === "JOINED") {
      return "Joined";
    }
    if (status === "FINISHED") {
      return "Finished";
    }
    if (status === "DISCONNECTED") {
      return "Disconnected";
    }
    if (status === "REMOVED" || status === "KICKED") {
      return "Removed";
    }
    return status;
  }
  if (status === "RACING") {
    return "במרוץ";
  }
  if (status === "JOINED") {
    return "הצטרף";
  }
  if (status === "FINISHED") {
    return "סיים";
  }
  if (status === "DISCONNECTED") {
    return "מנותק";
  }
  if (status === "REMOVED" || status === "KICKED") {
    return "הוסר";
  }
  return status;
}

function routeLabel(routeMode: string | undefined, language: "he" | "en") {
  if (language === "en") {
    if (routeMode === "HIGHWAY") {
      return "Highway";
    }
    if (routeMode === "DIRT_ROAD") {
      return "Dirt road";
    }
    return "Regular";
  }
  if (routeMode === "HIGHWAY") {
    return "כביש מהיר";
  }
  if (routeMode === "DIRT_ROAD") {
    return "דרך עפר";
  }
  return "רגיל";
}

export function TeacherRaceLane({ laneNumber, player }: TeacherRaceLaneProps) {
  const { language } = useLanguage();
  const labels = language === "en" ? {
    lane: "Lane",
    waiting: "Waiting for student",
    empty: "Empty",
    selectedCar: "Selected car",
    correct: "Correct",
    wrong: "Wrong",
    timeout: "Timeout",
    streak: "Streak",
    start: "Start",
    finish: "Target"
  } : {
    lane: "מסלול",
    waiting: "ממתין לתלמיד",
    empty: "ריק",
    selectedCar: "רכב נבחר",
    correct: "נכון",
    wrong: "טעות",
    timeout: "זמן",
    streak: "רצף",
    start: "התחלה",
    finish: "יעד"
  };

  if (!player) {
    return (
      <article className="grid min-h-12 grid-cols-[7rem_minmax(0,1fr)_4rem] items-center gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 opacity-70">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{labels.lane} {laneNumber}</p>
          <p className="truncate text-xs text-slate-500">{labels.waiting}</p>
        </div>
        <Track progress={0} inactive labels={labels} />
        <p className="text-right text-xs font-bold text-slate-600">{labels.empty}</p>
      </article>
    );
  }

  const progress = clampProgress(player.progressPercent);
  const disconnected = player.status === "DISCONNECTED" || player.connected === false;

  return (
    <article className={`grid min-h-[68px] grid-cols-[16rem_minmax(0,1fr)_5rem] items-center gap-3 rounded-md border px-3 py-2 shadow-[0_6px_18px_rgba(2,8,23,0.16)] max-lg:grid-cols-1 ${disconnected ? "border-slate-500/20 bg-slate-800/22 opacity-65" : "border-cyan-100/16 bg-white/[0.055]"}`}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-100/28 bg-cyan-100/12 text-xs font-black text-cyan-50">
            {laneNumber}
          </span>
          <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.1em] text-cyan-100/65">{labels.lane} {laneNumber}</span>
          <span className="rounded-full border border-white/10 bg-slate-950/30 px-2 py-0.5 text-[10px] font-black text-white">#{player.rank}</span>
          <p className="min-w-0 truncate text-sm font-black text-white">{player.name}</p>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold">
          <span className="max-w-28 truncate text-slate-300">{player.carName ?? labels.selectedCar}</span>
          <span className={`uppercase ${statusTone(player.status)}`}>{statusLabel(player.status, language)}</span>
          <span className="text-emerald-100">{labels.correct}:{player.correctAnswers}</span>
          <span className="text-rose-100">{labels.wrong}:{player.wrongAnswers}</span>
          <span className="text-amber-100">{labels.timeout}:{player.timeoutAnswers ?? 0}</span>
          <span className="text-cyan-100">{labels.streak}:{player.streak ?? 0}</span>
          <span className="text-violet-100">{routeLabel(player.routeMode, language)}</span>
        </div>
      </div>

      <Track progress={progress} player={player} inactive={disconnected} labels={labels} />

      <div className="text-right max-lg:text-left">
        <p className="text-sm font-black text-cyan-100">{player.score} / {player.targetScore}</p>
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-300">{Math.round(progress)}%</p>
      </div>
    </article>
  );
}

function Track({
  progress,
  player,
  inactive = false,
  labels
}: {
  progress: number;
  player?: TeacherPlayerView;
  inactive?: boolean;
  labels: { start: string; finish: string };
}) {
  const boundedProgress = clampProgress(progress);

  return (
    <div dir="ltr" className="relative h-9 min-w-0">
      <span className={`absolute left-0 top-1/2 z-10 h-8 w-0.5 -translate-y-1/2 rounded-full ${inactive ? "bg-slate-600" : "bg-emerald-200"}`} />
      <span className={`absolute right-0 top-1/2 z-10 h-8 w-0.5 -translate-y-1/2 rounded-full ${inactive ? "bg-slate-600" : "bg-rose-200"}`} />
      <span className={`absolute left-1 top-0 text-[8px] font-black uppercase tracking-[0.12em] ${inactive ? "text-slate-600" : "text-emerald-100/85"}`}>{labels.start}</span>
      <span className={`absolute right-1 top-0 text-[8px] font-black uppercase tracking-[0.12em] ${inactive ? "text-slate-600" : "text-rose-100/85"}`}>{labels.finish}</span>
      <div className={`absolute left-6 right-6 top-1/2 h-2 -translate-y-1/2 rounded-full ${inactive ? "bg-slate-800/65" : "bg-slate-950/80"}`}>
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${inactive ? "bg-slate-700" : "bg-cyan-300/75"}`} style={{ width: `${boundedProgress}%` }} />
      </div>
      <div className={`absolute left-6 right-6 top-1/2 h-px -translate-y-1/2 ${inactive ? "bg-slate-600/35" : "bg-white/18"}`} />
      {player ? (
        <div className="absolute left-6 right-6 top-1/2 z-20 -translate-y-1/2">
          <div
            className="absolute top-1/2 w-11 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-700 ease-out"
            style={{ left: getTeacherCarLeftPercent(boundedProgress) }}
          >
            <TeacherCarIcon carId={player.carId} label={player.carName} className="drop-shadow-[0_7px_12px_rgba(0,0,0,0.4)]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
