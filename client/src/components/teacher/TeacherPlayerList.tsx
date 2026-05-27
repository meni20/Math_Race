import type { TeacherPlayerView } from "./teacherTypes";
import { TeacherCarIcon } from "./TeacherCarIcon";

interface TeacherPlayerListProps {
  players: TeacherPlayerView[];
  maxPlayers: number;
  canManage: boolean;
  onRemove: (playerId: string) => void;
}

export function TeacherPlayerList({ players, maxPlayers, canManage, onRemove }: TeacherPlayerListProps) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-white">Students</h2>
        <span className="text-sm font-semibold text-cyan-100">{players.length}/{maxPlayers}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {players.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-slate-950/30 px-4 py-6 text-center text-sm text-slate-300">Waiting for students to join.</p>
        ) : players.map((player) => {
          const disconnected = player.status === "DISCONNECTED" || player.connected === false;
          return (
            <div key={player.playerId} className={`rounded-lg border p-3 ${disconnected ? "border-slate-500/20 bg-slate-800/22 opacity-65" : "border-white/10 bg-slate-950/28"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-white">{player.name}</p>
                  <p className="mt-1 truncate text-xs text-slate-300">{player.carName ?? "Selected car"}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100/70">{player.status}</p>
                  <p className="mt-1 text-xs font-bold text-emerald-100">{player.score} / {player.targetScore} pts | {Math.round(player.progressPercent)}%</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300">
                    #{player.rank} | C:{player.correctAnswers} W:{player.wrongAnswers} T:{player.timeoutAnswers ?? 0} | streak {player.streak ?? 0}
                  </p>
                </div>
                <TeacherCarIcon carId={player.carId} label={player.carName} className="h-9 w-16 shrink-0" />
              </div>
              {canManage ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onRemove(player.playerId)}
                    className="rounded-full border border-rose-200/30 bg-rose-500/12 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-rose-100 transition hover:bg-rose-500/20"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
