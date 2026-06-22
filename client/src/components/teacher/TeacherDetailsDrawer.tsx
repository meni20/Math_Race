import { useLanguage } from "../../i18n";
import type { TeacherEvent, TeacherPlayerView } from "./teacherTypes";
import { TeacherLeaderboard } from "./TeacherLeaderboard";
import { TeacherPlayerList } from "./TeacherPlayerList";

export type TeacherDetailsTab = "leaderboard" | "students" | "events";

interface TeacherDetailsDrawerProps {
  open: boolean;
  tab: TeacherDetailsTab;
  players: TeacherPlayerView[];
  leaderboard: TeacherPlayerView[];
  events: TeacherEvent[];
  maxPlayers: number;
  onTabChange: (tab: TeacherDetailsTab) => void;
  onClose: () => void;
  onRemove: (playerId: string) => void;
}

function buildLabels(language: "he" | "en") {
  return language === "en" ? {
    closeDetails: "Close details",
    raceDetails: "Race details",
    close: "Close",
    leaderboard: "Leaderboard",
    students: "Students",
    events: "Events",
    liveEvents: "Live events",
    noEvents: "Events will appear as students join, answer, and change rank."
  } : {
    closeDetails: "סגור פרטים",
    raceDetails: "פרטי המרוץ",
    close: "סגור",
    leaderboard: "מובילים",
    students: "תלמידים",
    events: "אירועים",
    liveEvents: "אירועים חיים",
    noEvents: "אירועים יופיעו כשתלמידים יצטרפו, יענו וישנו מיקום."
  };
}

function tabLabel(tab: TeacherDetailsTab, labels: ReturnType<typeof buildLabels>) {
  if (tab === "students") {
    return labels.students;
  }
  if (tab === "events") {
    return labels.liveEvents;
  }
  return labels.leaderboard;
}

export function TeacherDetailsDrawer({
  open,
  tab,
  players,
  leaderboard,
  events,
  maxPlayers,
  onTabChange,
  onClose,
  onRemove
}: TeacherDetailsDrawerProps) {
  const { language } = useLanguage();
  const labels = buildLabels(language);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-sm">
      <button type="button" aria-label={labels.closeDetails} className="absolute inset-0 cursor-default" onClick={onClose} />
      <aside className="absolute right-0 top-0 z-10 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950 p-4 shadow-[-20px_0_60px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/70">{labels.raceDetails}</p>
            <h2 className="text-xl font-black text-white">{tabLabel(tab, labels)}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 bg-white/6 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white transition hover:bg-white/10">
            {labels.close}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <TabButton label={labels.leaderboard} active={tab === "leaderboard"} onClick={() => onTabChange("leaderboard")} />
          <TabButton label={labels.students} active={tab === "students"} onClick={() => onTabChange("students")} />
          <TabButton label={labels.events} active={tab === "events"} onClick={() => onTabChange("events")} />
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {tab === "leaderboard" ? <TeacherLeaderboard players={leaderboard} /> : null}
          {tab === "students" ? (
            <TeacherPlayerList
              players={players}
              maxPlayers={maxPlayers}
              canManage={false}
              onRemove={onRemove}
            />
          ) : null}
          {tab === "events" ? <EventsPanel events={events} labels={labels} /> : null}
        </div>
      </aside>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] transition ${
        active
          ? "border-cyan-100/35 bg-cyan-300/12 text-cyan-50"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/[0.09]"
      }`}
    >
      {label}
    </button>
  );
}

function EventsPanel({ events, labels }: { events: TeacherEvent[]; labels: ReturnType<typeof buildLabels> }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-white">{labels.liveEvents}</h2>
        <span className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-200">
          {events.length}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {events.length === 0 ? (
          <p className="rounded-lg bg-slate-950/28 px-3 py-3 text-sm text-slate-300">{labels.noEvents}</p>
        ) : events.map((event) => (
          <div key={event.id} className="rounded-lg border border-white/10 bg-slate-950/34 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-100/70">{event.type}</p>
              <time className="text-[10px] text-slate-400">{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </div>
            <p className="mt-1 text-sm text-slate-100">{event.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
