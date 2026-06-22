import { useState } from "react";
import { useLanguage } from "../../i18n";
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
  const { language } = useLanguage();
  const labels = language === "en" ? {
    leaderboard: "Leaderboard",
    students: "Students",
    events: "Events"
  } : {
    leaderboard: "מובילים",
    students: "תלמידים",
    events: "אירועים"
  };
  const view = buildTeacherDashboardView(snapshot, events);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<TeacherDetailsTab>("leaderboard");
  const showResults = snapshot.racePhase === "finish" || snapshot.raceStopped;

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
          <DetailsButton label={labels.leaderboard} onClick={() => openDetails("leaderboard")} />
          <DetailsButton label={labels.students} onClick={() => openDetails("students")} />
          <DetailsButton label={labels.events} onClick={() => openDetails("events")} />
        </div>
      </div>

      {showResults ? <TeacherResultsSummary snapshot={snapshot} players={view.leaderboard} /> : null}

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

function formatAverageTime(ms?: number) {
  return ms && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "-";
}

function routeLabel(routeMode: string | undefined, language: "he" | "en") {
  if (routeMode === "HIGHWAY") {
    return language === "en" ? "Highway" : "אוטוסטרדה";
  }
  if (routeMode === "DIRT_ROAD") {
    return language === "en" ? "Dirt road" : "דרך עפר";
  }
  return language === "en" ? "Regular" : "רגיל";
}

function TeacherResultsSummary({ snapshot, players }: { snapshot: TeacherRoomSnapshot; players: ReturnType<typeof buildTeacherDashboardView>["players"] }) {
  const { language } = useLanguage();
  const labels = language === "en" ? {
    title: "Race results",
    winner: "Winner",
    fastest: "Fastest average answer",
    mostMistakes: "Most mistakes",
    bestStreak: "Best streak",
    routes: "Routes",
    noData: "No data yet",
    mistakes: "mistakes",
    streak: "streak"
  } : {
    title: "לוח תוצאות",
    winner: "מנצח",
    fastest: "ענה הכי מהר",
    mostMistakes: "הכי הרבה טעויות",
    bestStreak: "הרצף הכי טוב",
    routes: "מסלולים",
    noData: "אין נתונים עדיין",
    mistakes: "טעויות",
    streak: "רצף"
  };
  const activePlayers = players.filter((player) => player.status !== "REMOVED" && player.status !== "KICKED");
  const winner = activePlayers.find((player) => player.playerId === snapshot.winnerPlayerId) ?? activePlayers[0];
  const fastest = [...activePlayers]
    .filter((player) => (player.averageAnswerTimeMs ?? 0) > 0)
    .sort((left, right) => (left.averageAnswerTimeMs ?? Number.POSITIVE_INFINITY) - (right.averageAnswerTimeMs ?? Number.POSITIVE_INFINITY))[0];
  const mostMistakes = [...activePlayers].sort((left, right) => (
    (right.wrongAnswers + right.timeoutAnswers) - (left.wrongAnswers + left.timeoutAnswers)
  ))[0];
  const bestStreak = [...activePlayers].sort((left, right) => (right.streak ?? 0) - (left.streak ?? 0))[0];
  const highwayPlayers = activePlayers.filter((player) => player.routeMode === "HIGHWAY");
  const dirtPlayers = activePlayers.filter((player) => player.routeMode === "DIRT_ROAD");
  const routeSummary = [
    `${routeLabel("HIGHWAY", language)}: ${highwayPlayers.length ? highwayPlayers.map((player) => player.name).join(", ") : labels.noData}`,
    `${routeLabel("DIRT_ROAD", language)}: ${dirtPlayers.length ? dirtPlayers.map((player) => player.name).join(", ") : labels.noData}`
  ];

  return (
    <section className="rounded-lg border border-cyan-100/15 bg-cyan-300/8 p-4 shadow-[0_18px_50px_rgba(2,8,23,0.24)]">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/75">{labels.title}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <ResultCard label={labels.winner} value={winner?.name ?? labels.noData} detail={winner ? `${winner.score}/${winner.targetScore}` : "-"} />
        <ResultCard label={labels.fastest} value={fastest?.name ?? labels.noData} detail={formatAverageTime(fastest?.averageAnswerTimeMs)} />
        <ResultCard
          label={labels.mostMistakes}
          value={mostMistakes?.name ?? labels.noData}
          detail={mostMistakes ? `${mostMistakes.wrongAnswers + mostMistakes.timeoutAnswers} ${labels.mistakes}` : "-"}
        />
        <ResultCard label={labels.bestStreak} value={bestStreak?.name ?? labels.noData} detail={bestStreak ? `${bestStreak.streak ?? 0} ${labels.streak}` : "-"} />
      </div>
      <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2 text-sm text-slate-100">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100/65">{labels.routes}</p>
        <div className="mt-1 grid gap-1 md:grid-cols-2">
          {routeSummary.map((entry) => <p key={entry}>{entry}</p>)}
        </div>
      </div>
    </section>
  );
}

function ResultCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/34 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100/65">{label}</p>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-300">{detail}</p>
    </div>
  );
}
