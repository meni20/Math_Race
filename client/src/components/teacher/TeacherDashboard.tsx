import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { gameSocket } from "../../game/network/gameSocket";
import { isDemoTransportConfigured } from "../../game/network/transportConfig";
import { useGameStore } from "../../game/store/useGameStore";
import type { PlayerSnapshot } from "../../game/types/messages";
import { DEFAULT_CAR_ID } from "../../game/utils/carSelection";
import { normalizePlayerId, normalizeRoomId } from "../../game/utils/gameIds";
import { MAX_ROOM_PLAYERS, normalizeRoomSettings } from "../../game/utils/roomSettings";

type TeacherView = "create" | "lobby" | "live" | "results";
type Difficulty = "EASY" | "MEDIUM" | "HARD";
type QuestionType = "ADDITION" | "SUBTRACTION" | "MULTIPLICATION" | "DIVISION" | "MIXED";
type ParticipantStatus = "WAITING" | "APPROVED" | "REJECTED" | "CONNECTED";
type DashboardPlayerStatus = "WAITING" | "ACTIVE" | "ANSWERING" | "DECISION_EVENT" | "FINISHED" | "DISCONNECTED";
type RaceEventType = "TURBO" | "BREAKDOWN" | "OVERTAKE" | "HIGHWAY" | "DIRT";

interface TeacherRaceConfig {
  title: string;
  classGroup: string;
  roomCode: string;
  maxPlayers: number;
  difficulty: Difficulty;
  questionTypes: QuestionType[];
  questionTimeLimitSec: number;
  trackLength: number;
  requiresApproval: boolean;
}

interface RacePlayerStats {
  playerId: string;
  name: string;
  carId: string;
  position: number;
  progressPercent: number;
  rank: number;
  correctAnswers: number;
  wrongAnswers: number;
  streak: number;
  bestStreak: number;
  averageAnswerTimeMs: number;
  currentStatus: DashboardPlayerStatus;
  lastEvent?: {
    type: RaceEventType;
    message: string;
    createdAt: string;
  };
}

interface TeacherEvent {
  id: string;
  type: string;
  playerId?: string;
  message: string;
  createdAt: string;
}

const DEFAULT_CONFIG: TeacherRaceConfig = {
  title: "Math Race - Grade 4",
  classGroup: "Grade 4",
  roomCode: "",
  maxPlayers: MAX_ROOM_PLAYERS,
  difficulty: "MEDIUM",
  questionTypes: ["ADDITION", "MULTIPLICATION"],
  questionTimeLimitSec: 20,
  trackLength: 1000,
  requiresApproval: true
};

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  ADDITION: "Addition",
  SUBTRACTION: "Subtraction",
  MULTIPLICATION: "Multiplication",
  DIVISION: "Division",
  MIXED: "Mixed"
};

function buildRandomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.floor(Math.random() * 1_000_000_000).toString(36).slice(0, 8)}`;
}

function buildRoomCode() {
  return normalizeRoomId(`class-${Math.random().toString(36).slice(2, 8)}`);
}

function buildJoinLink(roomCode: string) {
  if (typeof window === "undefined") {
    return roomCode;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", roomCode);
  return url.toString();
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getRaceProgress(player: PlayerSnapshot, trackLengthMeters: number, totalLaps: number) {
  const safeTrackLength = Math.max(1, trackLengthMeters);
  const safeTotalLaps = Math.max(1, totalLaps);
  const completedDistance = (Math.max(0, player.lap) * safeTrackLength) + Math.max(0, player.positionMeters);
  return Math.max(0, Math.min(100, (completedDistance / (safeTrackLength * safeTotalLaps)) * 100));
}

function getPlayerStatus(player: PlayerSnapshot): DashboardPlayerStatus {
  if (player.finished || player.racePhase === "finish") {
    return "FINISHED";
  }
  if (player.racePhase === "active") {
    return "ACTIVE";
  }
  return "WAITING";
}

function buildStats(
  players: PlayerSnapshot[],
  trackLengthMeters: number,
  totalLaps: number,
  participantStatuses: Record<string, ParticipantStatus>,
  teacherPlayerId: string,
  events: TeacherEvent[]
) {
  const eventByPlayer = new Map<string, TeacherEvent>();
  for (const event of events) {
    if (event.playerId && !eventByPlayer.has(event.playerId)) {
      eventByPlayer.set(event.playerId, event);
    }
  }

  return players
    .filter((player) => player.playerId !== teacherPlayerId)
    .map((player, index): RacePlayerStats => {
      const status = participantStatuses[player.playerId] ?? "CONNECTED";
      const latestEvent = eventByPlayer.get(player.playerId);
      return {
        playerId: player.playerId,
        name: player.displayName,
        carId: player.carId ?? DEFAULT_CAR_ID,
        position: player.positionMeters,
        progressPercent: getRaceProgress(player, trackLengthMeters, totalLaps),
        rank: index + 1,
        correctAnswers: 0,
        wrongAnswers: 0,
        streak: 0,
        bestStreak: 0,
        averageAnswerTimeMs: 0,
        currentStatus: status === "REJECTED" ? "DISCONNECTED" : getPlayerStatus(player),
        lastEvent: latestEvent
          ? {
              type: latestEvent.type === "OVERTAKE" ? "OVERTAKE" : "TURBO",
              message: latestEvent.message,
              createdAt: latestEvent.createdAt
            }
          : undefined
      };
    });
}

function buildQrCells(value: string) {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = ((seed << 5) - seed + value.charCodeAt(index)) | 0;
  }
  return Array.from({ length: 81 }, (_, index) => {
    const borderCell = index < 9 || index >= 72 || index % 9 === 0 || index % 9 === 8;
    if (borderCell) {
      return true;
    }
    const next = Math.sin(seed + index * 17.13) * 10000;
    return (next - Math.floor(next)) > 0.5;
  });
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/6 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/70">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

export function TeacherDashboard() {
  const connection = useGameStore((state) => state.connection);
  const roomId = useGameStore((state) => state.roomId);
  const playerId = useGameStore((state) => state.playerId);
  const playerIds = useGameStore((state) => state.playerIds);
  const playersById = useGameStore((state) => state.players);
  const roomSettings = useGameStore((state) => state.roomSettings);
  const racePhase = useGameStore((state) => state.racePhase);
  const raceStopped = useGameStore((state) => state.raceStopped);
  const trackLengthMeters = useGameStore((state) => state.trackLengthMeters);
  const totalLaps = useGameStore((state) => state.totalLaps);
  const prepareJoin = useGameStore((state) => state.prepareJoin);

  const [view, setView] = useState<TeacherView>("create");
  const [config, setConfig] = useState<TeacherRaceConfig>(DEFAULT_CONFIG);
  const [activeRace, setActiveRace] = useState<TeacherRaceConfig | null>(null);
  const [participantStatuses, setParticipantStatuses] = useState<Record<string, ParticipantStatus>>({});
  const [registrationLocked, setRegistrationLocked] = useState(false);
  const [events, setEvents] = useState<TeacherEvent[]>([]);
  const [settingsApplied, setSettingsApplied] = useState(false);
  const teacherPlayerIdRef = useRef(normalizePlayerId(buildRandomId("teacher")));
  const previousRanksRef = useRef<Record<string, number>>({});

  const orderedPlayers = useMemo(() => {
    return playerIds
      .map((currentPlayerId) => playersById[currentPlayerId])
      .filter((player): player is PlayerSnapshot => Boolean(player));
  }, [playerIds, playersById]);

  const stats = useMemo(
    () => buildStats(
      orderedPlayers,
      trackLengthMeters,
      totalLaps,
      participantStatuses,
      teacherPlayerIdRef.current,
      events
    ),
    [events, orderedPlayers, participantStatuses, totalLaps, trackLengthMeters]
  );

  const visibleStudentCount = stats.filter((player) => participantStatuses[player.playerId] !== "REJECTED").length;
  const approvedStudentCount = stats.filter((player) => participantStatuses[player.playerId] === "APPROVED").length;
  const canStartTeacherRace = connection === "connected" && approvedStudentCount > 0 && approvedStudentCount === visibleStudentCount;
  const connectedLabel = connection === "connected" ? "Connected" : connection === "connecting" ? "Connecting" : "Offline";
  const joinLink = activeRace ? buildJoinLink(activeRace.roomCode) : "";
  const qrCells = useMemo(() => buildQrCells(joinLink || activeRace?.roomCode || "teacher"), [activeRace?.roomCode, joinLink]);
  const classAccuracy = stats.length > 0
    ? Math.round((stats.reduce((sum, player) => sum + player.correctAnswers, 0) / Math.max(1, stats.reduce((sum, player) => sum + player.correctAnswers + player.wrongAnswers, 0))) * 100)
    : 0;

  useEffect(() => {
    if (!activeRace || settingsApplied || connection !== "connected" || roomId !== activeRace.roomCode) {
      return;
    }

    gameSocket.updateRoomSettings(normalizeRoomSettings(activeRace.roomCode, {
      raceName: activeRace.title,
      maxPlayers: activeRace.maxPlayers,
      raceDurationSeconds: 180,
      questionTimeLimitSeconds: activeRace.questionTimeLimitSec
    }));
    setSettingsApplied(true);
  }, [activeRace, connection, roomId, settingsApplied]);

  useEffect(() => {
    if (!activeRace) {
      return;
    }

    setParticipantStatuses((current) => {
      let changed = false;
      const next = { ...current };
      for (const player of orderedPlayers) {
        if (player.playerId === teacherPlayerIdRef.current || next[player.playerId]) {
          continue;
        }
        next[player.playerId] = activeRace.requiresApproval ? "WAITING" : "APPROVED";
        changed = true;
      }
      return changed ? next : current;
    });
  }, [activeRace, orderedPlayers]);

  useEffect(() => {
    if (!activeRace) {
      return;
    }

    const previousRanks = previousRanksRef.current;
    const nextRanks: Record<string, number> = {};
    const nextEvents: TeacherEvent[] = [];

    for (const player of stats) {
      nextRanks[player.playerId] = player.rank;
      if (!previousRanks[player.playerId]) {
        nextEvents.push({
          id: buildRandomId("event"),
          type: "PLAYER_JOINED",
          playerId: player.playerId,
          message: `${player.name} joined the lobby`,
          createdAt: new Date().toISOString()
        });
      } else if (previousRanks[player.playerId] > player.rank && racePhase === "active") {
        nextEvents.push({
          id: buildRandomId("event"),
          type: "OVERTAKE",
          playerId: player.playerId,
          message: `${player.name} moved up to #${player.rank}`,
          createdAt: new Date().toISOString()
        });
      }
    }

    previousRanksRef.current = nextRanks;
    if (nextEvents.length > 0) {
      setEvents((current) => [...nextEvents, ...current].slice(0, 30));
    }
  }, [activeRace, racePhase, stats]);

  useEffect(() => {
    if (!activeRace) {
      return;
    }
    if (racePhase === "active" && view === "lobby") {
      setEvents((current) => [{
        id: buildRandomId("event"),
        type: "RACE_STARTED",
        message: "Race started",
        createdAt: new Date().toISOString()
      }, ...current].slice(0, 30));
      setView("live");
    }
    if ((racePhase === "finish" || raceStopped) && view !== "results") {
      setEvents((current) => [{
        id: buildRandomId("event"),
        type: "RACE_FINISHED",
        message: "Race finished",
        createdAt: new Date().toISOString()
      }, ...current].slice(0, 30));
      setView("results");
    }
  }, [activeRace, racePhase, raceStopped, view]);

  const updateQuestionType = (questionType: QuestionType) => {
    setConfig((current) => {
      const exists = current.questionTypes.includes(questionType);
      const nextTypes = exists
        ? current.questionTypes.filter((item) => item !== questionType)
        : [...current.questionTypes, questionType];
      return {
        ...current,
        questionTypes: nextTypes.length > 0 ? nextTypes : [questionType]
      };
    });
  };

  const createRace = (event: FormEvent) => {
    event.preventDefault();
    if (connection === "connecting") {
      return;
    }

    const roomCode = buildRoomCode();
    const teacherPlayerId = teacherPlayerIdRef.current;
    const nextRace = {
      ...config,
      roomCode,
      maxPlayers: Math.max(2, Math.min(MAX_ROOM_PLAYERS, config.maxPlayers)),
      title: config.title.trim() || DEFAULT_CONFIG.title,
      classGroup: config.classGroup.trim() || DEFAULT_CONFIG.classGroup
    };

    setActiveRace(nextRace);
    setConfig(nextRace);
    setParticipantStatuses({});
    setRegistrationLocked(false);
    setEvents([{
      id: buildRandomId("event"),
      type: "RACE_CREATED",
      message: `${nextRace.title} created`,
      createdAt: new Date().toISOString()
    }]);
    previousRanksRef.current = {};
    setSettingsApplied(false);
    prepareJoin(roomCode, "Teacher Host", teacherPlayerId);
    void gameSocket.connect({
      roomId: roomCode,
      displayName: "Teacher Host",
      playerId: teacherPlayerId,
      carId: DEFAULT_CAR_ID
    });
    setView("lobby");
  };

  const approveStudent = (studentId: string) => {
    setParticipantStatuses((current) => ({ ...current, [studentId]: "APPROVED" }));
    const student = stats.find((item) => item.playerId === studentId);
    setEvents((current) => [{
      id: buildRandomId("event"),
      type: "PLAYER_APPROVED",
      playerId: studentId,
      message: `${student?.name ?? "Student"} approved`,
      createdAt: new Date().toISOString()
    }, ...current].slice(0, 30));
  };

  const rejectStudent = (studentId: string) => {
    setParticipantStatuses((current) => ({ ...current, [studentId]: "REJECTED" }));
    const student = stats.find((item) => item.playerId === studentId);
    setEvents((current) => [{
      id: buildRandomId("event"),
      type: "PLAYER_REMOVED",
      playerId: studentId,
      message: `${student?.name ?? "Student"} removed from teacher roster`,
      createdAt: new Date().toISOString()
    }, ...current].slice(0, 30));
  };

  const startRace = () => {
    if (!canStartTeacherRace) {
      return;
    }
    void gameSocket.startRace();
  };

  const endRace = () => {
    void gameSocket.returnToLobby();
    setView("results");
  };

  const leaveDashboard = () => {
    void gameSocket.leaveRoom();
    setActiveRace(null);
    setParticipantStatuses({});
    setEvents([]);
    setRegistrationLocked(false);
    setSettingsApplied(false);
    setView("create");
  };

  return (
    <section className="pointer-events-auto absolute inset-0 z-40 overflow-y-auto bg-slate-950/94 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/70">Teacher Dashboard</p>
            <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">{activeRace?.title ?? "Create Race Room"}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeRace ? (
              <span className="rounded-full border border-cyan-100/20 bg-cyan-100/10 px-4 py-2 text-sm font-bold text-cyan-50">
                {activeRace.roomCode}
              </span>
            ) : null}
            <span className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-200">
              {connectedLabel}
            </span>
            {activeRace ? (
              <>
                <button
                  type="button"
                  onClick={startRace}
                  disabled={view !== "lobby" || !canStartTeacherRace}
                  className="rounded-full border border-emerald-200/35 bg-emerald-400/14 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-50 transition hover:bg-emerald-400/22 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Start
                </button>
                <button
                  type="button"
                  onClick={endRace}
                  disabled={view === "create"}
                  className="rounded-full border border-rose-200/30 bg-rose-500/12 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  End
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={leaveDashboard}
              className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/10"
            >
              Exit
            </button>
          </div>
        </header>

        {view === "create" ? (
          <form className="grid flex-1 gap-5 py-6 lg:grid-cols-[1.05fr_0.95fr]" onSubmit={createRace}>
            <section className="rounded-lg border border-white/10 bg-white/6 p-5">
              <h2 className="text-lg font-black text-white">Open a Race</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Race name</span>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
                    value={config.title}
                    onChange={(event) => setConfig((current) => ({ ...current, title: event.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Class / group</span>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
                    value={config.classGroup}
                    onChange={(event) => setConfig((current) => ({ ...current, classGroup: event.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Max players</span>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
                    value={config.maxPlayers}
                    onChange={(event) => setConfig((current) => ({ ...current, maxPlayers: Number(event.target.value) }))}
                  >
                    {Array.from({ length: MAX_ROOM_PLAYERS - 1 }, (_, index) => index + 2).map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Difficulty</span>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
                    value={config.difficulty}
                    onChange={(event) => setConfig((current) => ({ ...current, difficulty: event.target.value as Difficulty }))}
                  >
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Question time</span>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
                    value={config.questionTimeLimitSec}
                    onChange={(event) => setConfig((current) => ({ ...current, questionTimeLimitSec: Number(event.target.value) }))}
                  >
                    {[5, 8, 10, 12, 15, 20].map((value) => (
                      <option key={value} value={value}>{value}s</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Track length</span>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40"
                    value={config.trackLength}
                    onChange={(event) => setConfig((current) => ({ ...current, trackLength: Number(event.target.value) }))}
                  >
                    {[800, 1000, 1500, 3000].map((value) => (
                      <option key={value} value={value}>{value}m</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2.5">
                  <span className="text-sm font-semibold text-slate-100">Require approval</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-cyan-300"
                    checked={config.requiresApproval}
                    onChange={(event) => setConfig((current) => ({ ...current, requiresApproval: event.target.checked }))}
                  />
                </label>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/70">Practice topic</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((questionType) => (
                    <button
                      key={questionType}
                      type="button"
                      onClick={() => updateQuestionType(questionType)}
                      className={`rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] transition ${
                        config.questionTypes.includes(questionType)
                          ? "border-cyan-100/45 bg-cyan-100/14 text-cyan-50"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {QUESTION_TYPE_LABELS[questionType]}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={connection === "connecting"}
                className="mt-6 w-full rounded-lg border border-cyan-100/35 bg-cyan-300/14 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/22 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create Room
              </button>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/6 p-5">
              <h2 className="text-lg font-black text-white">Configuration Preview</h2>
              <div className="mt-5 grid gap-3">
                <StatCard label="Players" value={`2-${config.maxPlayers}`} />
                <StatCard label="Difficulty" value={config.difficulty} />
                <StatCard label="Question time" value={`${config.questionTimeLimitSec}s`} />
                <StatCard label="Runtime" value={isDemoTransportConfigured() ? "Demo" : "Connected backend"} />
              </div>
            </section>
          </form>
        ) : null}

        {view === "lobby" && activeRace ? (
          <section className="grid flex-1 gap-5 py-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-lg border border-white/10 bg-white/6 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-100/70">Room code</p>
              <p className="mt-2 text-5xl font-black tracking-[0.12em] text-white">{activeRace.roomCode}</p>
              <div className="mt-5 grid h-44 w-44 grid-cols-9 gap-1 rounded-lg bg-white p-3">
                {qrCells.map((filled, index) => (
                  <span key={`${activeRace.roomCode}-${index}`} className={filled ? "rounded-sm bg-slate-950" : "rounded-sm bg-white"} />
                ))}
              </div>
              <p className="mt-4 break-all rounded-lg border border-white/10 bg-slate-950/36 px-3 py-2 text-sm text-cyan-50">{joinLink}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRegistrationLocked((current) => !current)}
                  className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/10"
                >
                  {registrationLocked ? "Open Registration" : "Lock Registration"}
                </button>
                <button
                  type="button"
                  onClick={startRace}
                  disabled={!canStartTeacherRace}
                  className="rounded-full border border-emerald-200/35 bg-emerald-400/14 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-emerald-50 transition hover:bg-emerald-400/22 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Start Race
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/6 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-white">Students</h2>
                <span className="text-sm font-semibold text-cyan-100">{visibleStudentCount}/{activeRace.maxPlayers}</span>
              </div>
              <div className="mt-4 grid gap-3">
                {stats.length === 0 ? (
                  <p className="rounded-lg border border-white/10 bg-slate-950/30 px-4 py-6 text-center text-sm text-slate-300">Waiting for students to join.</p>
                ) : stats.map((student) => {
                  const status = participantStatuses[student.playerId] ?? "CONNECTED";
                  return (
                    <div key={student.playerId} className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/28 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <p className="font-bold text-white">{student.name}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.12em] text-cyan-100/70">{status}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => approveStudent(student.playerId)}
                          className="rounded-full border border-emerald-200/30 bg-emerald-400/12 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-emerald-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectStudent(student.playerId)}
                          className="rounded-full border border-rose-200/30 bg-rose-500/12 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-rose-100"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {view === "live" && activeRace ? (
          <section className="grid flex-1 gap-5 py-6 xl:grid-cols-[1fr_24rem]">
            <div className="rounded-lg border border-white/10 bg-white/6 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-black text-white">Main Race View</h2>
                <span className="text-sm font-bold text-cyan-100">{roomSettings.raceName}</span>
              </div>
              <div className="mt-5 grid gap-3">
                {stats.map((player) => (
                  <div key={player.playerId} className="rounded-lg border border-white/10 bg-slate-950/32 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-white">#{player.rank} {player.name}</p>
                        <p className="text-xs uppercase tracking-[0.12em] text-cyan-100/70">{player.currentStatus}</p>
                      </div>
                      <p className="text-sm font-black text-white">{Math.round(player.progressPercent)}%</p>
                    </div>
                    <div className="h-4 overflow-hidden rounded-full bg-slate-900">
                      <div className="h-full rounded-full bg-cyan-300 transition-all duration-300" style={{ width: `${player.progressPercent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="grid gap-4">
              <div className="rounded-lg border border-white/10 bg-white/6 p-4">
                <h2 className="text-lg font-black text-white">Leaderboard</h2>
                <div className="mt-3 grid gap-2">
                  {stats.map((player) => (
                    <div key={player.playerId} className="flex items-center justify-between rounded-lg bg-slate-950/30 px-3 py-2">
                      <span className="font-semibold text-slate-100">#{player.rank} {player.name}</span>
                      <span className="text-sm text-cyan-100">{Math.round(player.progressPercent)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/6 p-4">
                <h2 className="text-lg font-black text-white">Player Stats</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatCard label="Answered" value={stats.reduce((sum, player) => sum + player.correctAnswers + player.wrongAnswers, 0)} />
                  <StatCard label="Accuracy" value={`${classAccuracy}%`} />
                  <StatCard label="Avg time" value="-" />
                  <StatCard label="Players" value={stats.length} />
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/6 p-4">
                <h2 className="text-lg font-black text-white">Live Events</h2>
                <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1">
                  {events.map((event) => (
                    <div key={event.id} className="rounded-lg bg-slate-950/34 px-3 py-2">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-100/70">{event.type} - {formatTime(event.createdAt)}</p>
                      <p className="mt-1 text-sm text-slate-100">{event.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        ) : null}

        {view === "results" && activeRace ? (
          <section className="grid flex-1 gap-5 py-6 lg:grid-cols-[1fr_22rem]">
            <div className="rounded-lg border border-white/10 bg-white/6 p-5">
              <h2 className="text-lg font-black text-white">Final Ranking</h2>
              <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/8 text-xs uppercase tracking-[0.12em] text-cyan-100/75">
                    <tr>
                      <th className="px-3 py-2">Rank</th>
                      <th className="px-3 py-2">Student</th>
                      <th className="px-3 py-2">Progress</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((player) => (
                      <tr key={player.playerId} className="border-t border-white/10">
                        <td className="px-3 py-3 font-black text-white">#{player.rank}</td>
                        <td className="px-3 py-3 text-slate-100">{player.name}</td>
                        <td className="px-3 py-3 text-cyan-100">{Math.round(player.progressPercent)}%</td>
                        <td className="px-3 py-3 text-slate-300">{player.currentStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="grid content-start gap-3">
              <StatCard label="Students" value={stats.length} />
              <StatCard label="Class accuracy" value={`${classAccuracy}%`} />
              <StatCard label="Questions" value={stats.reduce((sum, player) => sum + player.correctAnswers + player.wrongAnswers, 0)} />
              <button
                type="button"
                onClick={leaveDashboard}
                className="rounded-lg border border-cyan-100/35 bg-cyan-300/14 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/22"
              >
                New Race
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
