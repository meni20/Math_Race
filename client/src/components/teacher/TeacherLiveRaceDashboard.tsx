import { useState } from "react";
import type { TeacherEvent, TeacherRoomSnapshot } from "./teacherTypes";
import { buildTeacherDashboardView } from "./teacherDashboardView";
import { TeacherDetailsDrawer, type TeacherDetailsTab } from "./TeacherDetailsDrawer";
import { TeacherLaneRaceView } from "./TeacherLaneRaceView";
import { TeacherStatsBar } from "./TeacherStatsBar";

interface TeacherLiveRaceDashboardProps {
  snapshot: TeacherRoomSnapshot;
  events: TeacherEvent[];
  onRemove: (playerId: string) => void;
}

export function TeacherLiveRaceDashboard({ snapshot, events, onRemove }: TeacherLiveRaceDashboardProps) {
  const view = buildTeacherDashboardView(snapshot, events);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<TeacherDetailsTab>("leaderboard");

  const openDetails = (tab: TeacherDetailsTab) => {
    setDetailsTab(tab);
    setDetailsOpen(true);
  };

  return (
    <section className="grid gap-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <TeacherStatsBar stats={view.stats} />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <DetailsButton label="מובילים" onClick={() => openDetails("leaderboard")} />
          <DetailsButton label="תלמידים" onClick={() => openDetails("students")} />
          <DetailsButton label="אירועים" onClick={() => openDetails("events")} />
        </div>
      </div>

      <TeacherLaneRaceView players={view.players} />

      <TeacherDetailsDrawer
        open={detailsOpen}
        tab={detailsTab}
        players={view.players}
        leaderboard={view.leaderboard}
        events={view.events}
        maxPlayers={snapshot.roomSettings.maxPlayers}
        onTabChange={setDetailsTab}
        onClose={() => setDetailsOpen(false)}
        onRemove={onRemove}
      />
    </section>
  );
}

function DetailsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border border-white/12 bg-white/[0.07] px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/[0.12]">
      {label}
    </button>
  );
}
