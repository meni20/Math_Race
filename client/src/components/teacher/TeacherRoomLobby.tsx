import { useMemo } from "react";
import type { TeacherPlayerView, TeacherRoomSnapshot } from "./teacherTypes";
import { buildJoinLink, buildQrCells } from "./teacherUtils";
import { TeacherPlayerList } from "./TeacherPlayerList";

interface TeacherRoomLobbyProps {
  snapshot: TeacherRoomSnapshot;
  canStart: boolean;
  onRemove: (playerId: string) => void;
  onStart: () => void;
}

export function TeacherRoomLobby({ snapshot, canStart, onRemove, onStart }: TeacherRoomLobbyProps) {
  const joinLink = buildJoinLink(snapshot.roomId);
  const qrCells = useMemo(() => buildQrCells(joinLink), [joinLink]);
  const players: TeacherPlayerView[] = snapshot.players;
  const copyRoomCode = () => {
    void navigator.clipboard?.writeText(snapshot.roomId);
  };
  const copyJoinLink = () => {
    void navigator.clipboard?.writeText(joinLink);
  };

  return (
    <section className="grid flex-1 gap-5 py-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-lg border border-white/10 bg-white/6 p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-100/70">Room code</p>
        <p className="mt-2 text-5xl font-black tracking-[0.12em] text-white">{snapshot.roomId}</p>
        <div className="mt-5 grid h-44 w-44 grid-cols-9 gap-1 rounded-lg bg-white p-3">
          {qrCells.map((filled, index) => (
            <span key={`${snapshot.roomId}-${index}`} className={filled ? "rounded-sm bg-slate-950" : "rounded-sm bg-white"} />
          ))}
        </div>
        <label className="mt-4 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Join URL</span>
          <input
            readOnly
            className="w-full rounded-lg border border-white/10 bg-slate-950/36 px-3 py-2 text-sm text-cyan-50 outline-none"
            value={joinLink}
          />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyRoomCode}
            className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/10"
          >
            Copy Code
          </button>
          <button
            type="button"
            onClick={copyJoinLink}
            className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/10"
          >
            Copy Link
          </button>
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            className="rounded-full border border-emerald-200/35 bg-emerald-400/14 px-5 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-50 transition hover:bg-emerald-400/22 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Start Race
          </button>
        </div>
      </div>

      <TeacherPlayerList
        players={players}
        maxPlayers={snapshot.roomSettings.maxPlayers}
        canManage={snapshot.racePhase === "lobby"}
        onRemove={onRemove}
      />
    </section>
  );
}
