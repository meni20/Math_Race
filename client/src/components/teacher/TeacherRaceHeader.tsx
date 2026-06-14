import type { TeacherRoomSnapshot } from "./teacherTypes";

interface TeacherRaceHeaderProps {
  title: string;
  snapshot: TeacherRoomSnapshot | null;
  connectionLabel: string;
  targetLabel: string;
  playerCount: number;
  localDev: boolean;
  canStart: boolean;
  onStart: () => void;
  onEnd: () => void;
  onCloseRoom: () => void;
  onNewRoom: () => void;
  onOpenRooms: () => void;
  onStudentMode: () => void;
}

function phaseLabel(snapshot: TeacherRoomSnapshot | null) {
  if (!snapshot) {
    return "Setup";
  }
  if (snapshot.lifecycleStatus === "CLOSED") {
    return "Closed";
  }
  if (snapshot.lifecycleStatus === "DELETED") {
    return "Deleted";
  }
  if (snapshot.racePhase === "active") {
    return "Racing";
  }
  if (snapshot.racePhase === "starting") {
    return "Starting";
  }
  if (snapshot.racePhase === "finish") {
    return "Finished";
  }
  return "Waiting";
}

export function TeacherRaceHeader({
  title,
  snapshot,
  connectionLabel,
  targetLabel,
  playerCount,
  localDev,
  canStart,
  onStart,
  onEnd,
  onCloseRoom,
  onNewRoom,
  onOpenRooms,
  onStudentMode
}: TeacherRaceHeaderProps) {
  const maxPlayers = snapshot?.roomSettings.maxPlayers ?? 8;
  const roomIsTerminal = snapshot?.lifecycleStatus === "CLOSED" || snapshot?.lifecycleStatus === "DELETED";

  return (
    <header className="rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/70">Teacher Dashboard</p>
          <h1 className="mt-0.5 truncate text-xl font-black text-white sm:text-2xl">{title}</h1>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {snapshot ? <HeaderPill label="Room" value={snapshot.roomId} tone="cyan" /> : null}
          <HeaderPill label="Status" value={phaseLabel(snapshot)} />
          <HeaderPill label="Target" value={targetLabel} />
          <HeaderPill label="Students" value={`${playerCount}/${maxPlayers}`} />
          <HeaderPill label="Link" value={connectionLabel} />
          {localDev ? (
            <span className="rounded-full border border-cyan-100/15 bg-cyan-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">
              Local Dev
            </span>
          ) : null}
          <button type="button" onClick={onOpenRooms} className="rounded-full border border-white/12 bg-white/[0.07] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/[0.12]">
            Rooms
          </button>
          <button type="button" onClick={onStudentMode} className="rounded-full border border-cyan-100/20 bg-cyan-300/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/16">
            Student Mode
          </button>
          <button type="button" onClick={onNewRoom} className="rounded-full border border-white/12 bg-white/[0.07] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/[0.12]">
            New
          </button>
          {snapshot ? (
            <>
              <button
                type="button"
                onClick={onStart}
                disabled={!canStart}
                className="rounded-full border border-emerald-200/35 bg-emerald-400/14 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-50 transition hover:bg-emerald-400/22 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Start
              </button>
              <button
                type="button"
                onClick={onEnd}
                disabled={roomIsTerminal}
                className="rounded-full border border-rose-200/30 bg-rose-500/12 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-45"
              >
                End
              </button>
              <button
                type="button"
                onClick={onCloseRoom}
                disabled={roomIsTerminal}
                className="rounded-full border border-amber-200/25 bg-amber-300/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-amber-100 transition hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Close View
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
