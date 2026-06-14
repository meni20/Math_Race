import type { TeacherPlayerView } from "./teacherTypes";
import { TeacherRaceLane } from "./TeacherRaceLane";

interface TeacherLaneRaceViewProps {
  players: TeacherPlayerView[];
  laneCount?: number;
}

export function TeacherLaneRaceView({ players, laneCount = 8 }: TeacherLaneRaceViewProps) {
  const lanes = Array.from({ length: laneCount }, (_, index) => ({
    laneNumber: index + 1,
    player: players[index]
  }));

  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/44 p-3 shadow-[0_18px_50px_rgba(2,8,23,0.24)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/70">מסלולי מרוץ חיים</p>
          <h2 className="text-lg font-black text-white">מסלול הכיתה</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-200">
          {players.length}/{laneCount} פעילים
        </span>
      </div>

      <div className="grid gap-2">
        {lanes.map((lane) => (
          <TeacherRaceLane key={lane.laneNumber} laneNumber={lane.laneNumber} player={lane.player} />
        ))}
      </div>
    </section>
  );
}
