import { useEffect, useMemo, useRef, useState } from "react";
import { TeacherCreateRacePanel } from "./TeacherCreateRacePanel";
import { TeacherGameClient } from "./teacherGameClient";
import { TeacherLiveRaceDashboard } from "./TeacherLiveRaceDashboard";
import { TeacherRaceHeader } from "./TeacherRaceHeader";
import { TeacherRoomsDrawer } from "./TeacherRoomsDrawer";
import { TeacherRoomLobby } from "./TeacherRoomLobby";
import { ThemeToggle } from "../ThemeToggle";
import type { TeacherDashboardView, TeacherEvent, TeacherRaceConfig, TeacherRoomSnapshot, TeacherRoomSummary } from "./teacherTypes";
import { DEFAULT_TEACHER_CONFIG, buildRandomId, normalizeTeacherConfig } from "./teacherUtils";
import { archiveStaleClassroomRooms, getClassroomAdapterInfo } from "../../game/network/classroomRooms";
import { getActiveSyncDebugState } from "../../game/sync/syncLifecycle";
import { navigateToRaceResults, saveRaceResults } from "../../game/results/raceResults";
import { useLanguage } from "../../i18n";
import { useTheme } from "../../theme";

type TeacherConnectionStatus = "idle" | "connecting" | "connected" | "error";

interface TeacherDashboardProps {
  embedded?: boolean;
  suppressInitialCreate?: boolean;
  onRequestClose?: () => void;
}

export function TeacherDashboard({
  embedded = false,
  suppressInitialCreate = false,
  onRequestClose
}: TeacherDashboardProps = {}) {
  const { t, language } = useLanguage();
  const { theme } = useTheme();
  const clientRef = useRef<TeacherGameClient | null>(null);
  const previousRanksRef = useRef<Record<string, number>>({});
  const navigatedResultsRef = useRef("");
  const previousPlayersRef = useRef<Record<string, {
    rank: number;
    status: string;
    correctAnswers: number;
    wrongAnswers: number;
    streak: number;
    progressPercent: number;
  }>>({});
  const [connection, setConnection] = useState<TeacherConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [view, setView] = useState<TeacherDashboardView>(suppressInitialCreate ? "overview" : "create");
  const [config, setConfig] = useState<TeacherRaceConfig>(DEFAULT_TEACHER_CONFIG);
  const [snapshot, setSnapshot] = useState<TeacherRoomSnapshot | null>(null);
  const [rooms, setRooms] = useState<TeacherRoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [lastClassroomError, setLastClassroomError] = useState("");
  const [archivingStaleRooms, setArchivingStaleRooms] = useState(false);
  const [events, setEvents] = useState<TeacherEvent[]>([]);
  const [debugTick, setDebugTick] = useState(0);
  const [roomsDrawerOpen, setRoomsDrawerOpen] = useState(false);
  const adapterInfo = useMemo(() => getClassroomAdapterInfo(), []);
  const classroomInfoMessage = connectionMessage === "Local classroom dev mode" ? "" : connectionMessage;

  useEffect(() => {
    const client = new TeacherGameClient();
    clientRef.current = client;
    client.onConnection((status, message) => {
      setConnection(status);
      setConnectionMessage(message ?? "");
    });
    client.onSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });
    return () => {
      void client.disconnect();
      clientRef.current = null;
    };
  }, []);

  const refreshRooms = () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    setRoomsLoading(true);
    void client.listRooms()
      .then(setRooms)
      .catch((error) => {
        const message = error instanceof Error ? error.message : "לא ניתן לטעון חדרים.";
        setLastClassroomError(message);
        setConnectionMessage(message);
      })
      .finally(() => setRoomsLoading(false));
  };

  useEffect(() => {
    refreshRooms();
    const intervalId = window.setInterval(refreshRooms, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }
    const intervalId = window.setInterval(() => setDebugTick((value) => value + 1), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (snapshot.lifecycleStatus === "CLOSED" || snapshot.lifecycleStatus === "DELETED") {
      setView("closed");
      return;
    }
    if (snapshot.racePhase === "active" || snapshot.racePhase === "starting") {
      setView("live");
    } else if (snapshot.racePhase === "finish") {
      setView("results");
    } else if (view !== "create") {
      setView("lobby");
    }
  }, [snapshot, view]);

  useEffect(() => {
    if (!snapshot || snapshot.players.length === 0 || navigatedResultsRef.current === snapshot.roomId) {
      return;
    }
    const finished = snapshot.lifecycleStatus === "FINISHED" || snapshot.racePhase === "finish" || snapshot.raceStopped;
    if (!finished) {
      return;
    }
    const saved = saveRaceResults({
      sessionId: snapshot.roomId,
      roomSettings: snapshot.roomSettings,
      raceStartedAtMs: snapshot.raceStartedAtMs,
      raceFinishedAtMs: snapshot.raceStoppedAtMs || Date.now(),
      winnerPlayerId: snapshot.winnerPlayerId,
      players: snapshot.players.map((player) => ({
        playerId: player.playerId,
        name: player.name,
        score: player.score,
        correctAnswers: player.correctAnswers,
        wrongAnswers: player.wrongAnswers,
        timeoutAnswers: player.timeoutAnswers,
        averageAnswerTimeMs: player.averageAnswerTimeMs,
        routeMode: player.routeMode
      }))
    });
    if (saved) {
      navigatedResultsRef.current = snapshot.roomId;
      navigateToRaceResults(snapshot.roomId);
    }
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const previousRanks = previousRanksRef.current;
    const previousPlayers = previousPlayersRef.current;
    const nextRanks: Record<string, number> = {};
    const nextPlayers: typeof previousPlayers = {};
    const nextEvents: TeacherEvent[] = [];
    for (const player of snapshot.players) {
      const previous = previousPlayers[player.playerId];
      nextRanks[player.playerId] = player.rank;
      nextPlayers[player.playerId] = {
        rank: player.rank,
        status: player.status,
        correctAnswers: player.correctAnswers,
        wrongAnswers: player.wrongAnswers,
        streak: player.streak ?? 0,
        progressPercent: player.progressPercent
      };
      if (!previous) {
        nextEvents.push({
          id: buildRandomId("event"),
          type: "JOINED",
          playerId: player.playerId,
          message: `${player.name} הצטרף עם ${player.carName ?? "רכב"}.`,
          createdAt: new Date().toISOString()
        });
      } else {
        if (previous.status !== "RACING" && player.status === "RACING") {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "RACING",
            playerId: player.playerId,
            message: `${player.name} נכנס למרוץ.`,
            createdAt: new Date().toISOString()
          });
        }
        if (previous.status !== "FINISHED" && player.status === "FINISHED") {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "FINISHED",
            playerId: player.playerId,
            message: `${player.name} סיים את המרוץ.`,
            createdAt: new Date().toISOString()
          });
        }
        if (player.correctAnswers > previous.correctAnswers) {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "CORRECT_ANSWER",
            playerId: player.playerId,
            message: `${player.name} ענה נכון${(player.streak ?? 0) > 1 ? ` (רצף ${player.streak})` : ""}.`,
            createdAt: new Date().toISOString()
          });
        }
        if (player.wrongAnswers > previous.wrongAnswers) {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "WRONG_ANSWER",
            playerId: player.playerId,
            message: `${player.name} טעה בשאלה.`,
            createdAt: new Date().toISOString()
          });
        }
      }
      if (previousRanks[player.playerId] > player.rank && snapshot.racePhase === "active") {
        nextEvents.push({
          id: buildRandomId("event"),
          type: "OVERTAKE",
          playerId: player.playerId,
          message: `${player.name} עלה למקום ${player.rank}.`,
          createdAt: new Date().toISOString()
        });
      }
    }
    previousRanksRef.current = nextRanks;
    previousPlayersRef.current = nextPlayers;
    if (nextEvents.length > 0) {
      setEvents((current) => [...nextEvents, ...current].slice(0, 30));
    }
  }, [snapshot]);

  const activePlayers = useMemo(
    () => snapshot?.players.filter((player) => player.status !== "REMOVED" && player.status !== "KICKED") ?? [],
    [snapshot?.players]
  );
  const roomIsTerminal = snapshot?.lifecycleStatus === "CLOSED" || snapshot?.lifecycleStatus === "DELETED";
  const hasStartableStudents = activePlayers.length > 0;
  const canStart = Boolean(snapshot && !roomIsTerminal && snapshot.racePhase === "lobby" && hasStartableStudents);
  const canEnd = Boolean(snapshot && !roomIsTerminal && snapshot.racePhase !== "finish");
  const pointsSuffix = language === "en" ? "pts" : "נק'";
  const targetLabel = snapshot ? `${snapshot.roomSettings.targetScore} ${pointsSuffix}` : `${config.targetScore} ${pointsSuffix}`;

  const createRace = async () => {
    if (adapterInfo.mode === "unavailable") {
      setLastClassroomError(adapterInfo.message);
      setConnection("error");
      setConnectionMessage(adapterInfo.message);
      return;
    }
    const nextConfig = normalizeTeacherConfig(config);
    setConfig(nextConfig);
    previousRanksRef.current = {};
    previousPlayersRef.current = {};
    setEvents([]);
    setCreatingRoom(true);
    setLastClassroomError("");
    try {
      const nextSnapshot = await clientRef.current?.createRoom(nextConfig);
      if (nextSnapshot) {
        setView("lobby");
      } else {
        setView("create");
      }
      refreshRooms();
    } catch (error) {
      const message = error instanceof Error ? error.message : "לא ניתן ליצור חדר.";
      setLastClassroomError(message);
      setConnection("error");
      setConnectionMessage(message);
      setView("create");
    } finally {
      setCreatingRoom(false);
    }
  };

  const removePlayer = (playerId: string) => {
    const playerName = snapshot?.players.find((player) => player.playerId === playerId)?.name ?? "תלמיד";
    void clientRef.current?.removePlayer(playerId);
    setEvents((current) => [{
      id: buildRandomId("event"),
      type: "REMOVED",
      playerId,
      message: `${playerName} הוסר מהחדר.`,
      createdAt: new Date().toISOString()
    }, ...current].slice(0, 30));
  };

  const startRace = () => {
    if (!canStart) {
      return;
    }
    setEvents((current) => [{
      id: buildRandomId("event"),
      type: "STARTED",
      message: "המרוץ התחיל.",
      createdAt: new Date().toISOString()
    }, ...current].slice(0, 30));
    void clientRef.current?.startRace().then(refreshRooms).catch((error) => {
      const message = error instanceof Error ? error.message : "לא ניתן להתחיל את המרוץ.";
      setLastClassroomError(message);
      setConnectionMessage(message);
    });
  };

  const endRace = () => {
    if (!canEnd) {
      return;
    }
    void clientRef.current?.returnToLobby().then(refreshRooms).catch((error) => {
      const message = error instanceof Error ? error.message : "לא ניתן לסיים את המרוץ.";
      setLastClassroomError(message);
      setConnectionMessage(message);
    });
    setEvents((current) => [{
      id: buildRandomId("event"),
      type: "ENDED",
      message: "המרוץ הסתיים.",
      createdAt: new Date().toISOString()
    }, ...current].slice(0, 30));
  };

  const resetDashboard = () => {
    void clientRef.current?.disconnect().then(refreshRooms);
    setSnapshot(null);
    setEvents([]);
    previousRanksRef.current = {};
    previousPlayersRef.current = {};
    setView(suppressInitialCreate ? "overview" : "create");
  };

  const openRoom = (roomCode: string) => {
    previousRanksRef.current = {};
    previousPlayersRef.current = {};
    setEvents([]);
    setView("lobby");
    void clientRef.current?.openRoom(roomCode).catch((error) => {
      const message = error instanceof Error ? error.message : "לא ניתן לפתוח חדר.";
      setLastClassroomError(message);
      setConnectionMessage(message);
      setView("create");
    });
  };

  const closeCurrentView = () => {
    void clientRef.current?.disconnect();
    setSnapshot(null);
    setEvents([]);
    previousRanksRef.current = {};
    previousPlayersRef.current = {};
    setView(suppressInitialCreate ? "overview" : "create");
  };

  const goToStudentMode = () => {
    if (embedded && onRequestClose) {
      onRequestClose();
      return;
    }
    void clientRef.current?.disconnect();
    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const deleteRoom = (roomCode: string) => {
    if (!window.confirm(t("deleteRoomConfirm"))) {
      return;
    }
    void clientRef.current?.deleteRoom(roomCode).then(() => {
      setRooms((current) => current.filter((room) => room.roomCode !== roomCode));
      if (snapshot?.roomId === roomCode) {
        setSnapshot(null);
        setView("create");
      }
      refreshRooms();
    }).catch((error) => {
        const message = error instanceof Error ? error.message : t("deleteRoomFailed");
      setLastClassroomError(message);
      setConnectionMessage(message);
    });
  };

  const archiveStaleRooms = () => {
    if (archivingStaleRooms) {
      return;
    }
    setArchivingStaleRooms(true);
    void archiveStaleClassroomRooms({
      teacherSessionId: clientRef.current?.getTeacherSessionId() ?? "",
      thresholdHours: 24,
      excludeRoomCode: snapshot?.roomId
    }).then((result) => {
      setConnectionMessage(`הועברו לארכיון ${result.archivedCount} חדרים ישנים מעל ${result.thresholdHours} שעות.`);
      setLastClassroomError("");
      refreshRooms();
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "לא ניתן להעביר חדרים ישנים לארכיון.";
      setLastClassroomError(message);
      setConnectionMessage(message);
    }).finally(() => {
      setArchivingStaleRooms(false);
    });
  };

  const connectedLabel = connection === "connected"
    ? (language === "en" ? "Connected" : "מחובר")
    : connection === "connecting"
      ? (language === "en" ? "Connecting" : "מתחבר")
      : connection === "error"
        ? (language === "en" ? "Limited" : "מוגבל")
        : (language === "en" ? "Not connected" : "לא מחובר");
  const showThemeToggle = !embedded && view !== "live";
  const lightUiClass = theme === "light" && showThemeToggle ? "theme-light-ui" : "";
  const shellClass = embedded
    ? "relative h-full overflow-y-auto rounded-lg bg-slate-950 text-slate-100"
    : `absolute inset-0 z-40 overflow-y-auto text-slate-100 ${view === "create" ? "pointer-events-none bg-transparent" : "pointer-events-auto bg-slate-950"}`;

  return (
    <section className={`${shellClass} ${lightUiClass}`}>
      {showThemeToggle ? (
        <div className="pointer-events-auto fixed bottom-5 right-5 z-[90]">
          <ThemeToggle />
        </div>
      ) : null}
      <div className="mx-auto flex min-h-screen w-full max-w-[96rem] flex-col px-3 py-3 sm:px-5 lg:px-6">
        {view !== "create" ? (
        <TeacherRaceHeader
          title={snapshot?.roomSettings.raceName ?? config.raceName}
          snapshot={snapshot}
          targetLabel={targetLabel}
          playerCount={activePlayers.length}
          canStart={canStart}
          canEnd={canEnd}
          onStart={startRace}
          onEnd={endRace}
          onNewRoom={resetDashboard}
          onOpenRooms={() => setRoomsDrawerOpen(true)}
        />
        ) : null}

        {view !== "create" && classroomInfoMessage ? (
          <p className="mt-3 rounded-lg border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{classroomInfoMessage}</p>
        ) : null}
        {view !== "create" && import.meta.env.DEV ? (
          <details className="mt-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300">
            <summary className="cursor-pointer font-bold uppercase tracking-[0.12em] text-cyan-100/75">
              אבחון פיתוח
            </summary>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {(() => {
                const liveDebug = clientRef.current?.getLiveDebugState();
                const syncDebug = getActiveSyncDebugState();
                return (
                  <>
                    <span>ערוץ מורה: {liveDebug?.transportState ?? "לא פעיל"}</span>
                    <span>SSE מחובר: {liveDebug?.sseConnected ? "כן" : "לא"}</span>
                    <span>SSE תקין: {liveDebug?.sseHealthy ? "כן" : "לא"}</span>
                    <span>גיבוי דגימה פעיל: {liveDebug?.teacherPollingActive ? "כן" : "לא"}</span>
                    <span>מרווח גיבוי: {liveDebug?.fallbackIntervalMs ?? 0}ms</span>
                    <span>אירוע SSE אחרון: {liveDebug?.lastSseEventType || "אין"}</span>
                    <span>הודעות SSE: {liveDebug?.sseMessageCount ?? 0}</span>
                    <span>SSE אחרון: {liveDebug?.lastSseEventAtMs ? new Date(liveDebug.lastSseEventAtMs).toLocaleTimeString() : "אף פעם"}</span>
                    <span>דגימה אחרונה: {liveDebug?.lastTeacherPollAtMs ? new Date(liveDebug.lastTeacherPollAtMs).toLocaleTimeString() : "אף פעם"}</span>
                    <span>סיבת עצירה: {liveDebug?.stopReason || "אין"}</span>
                    <span>טיימרי מורה: {liveDebug?.activeTeacherTimers ?? 0}</span>
                    <span>teacher-room-events ב-60 שניות אחרונות: {syncDebug.requestCountsLast60s.teacherRoomEvents}</span>
                    <span>teacher-sync-room ב-60 שניות אחרונות: {syncDebug.requestCountsLast60s.teacherSyncRoom}</span>
                    <span>חסימות teacher-sync-room ב-60 שניות אחרונות: {syncDebug.requestCountsLast60s.teacherSyncRoomBlocked}</span>
                    <span>list-teacher-rooms ב-60 שניות אחרונות: {syncDebug.requestCountsLast60s.listTeacherRooms}</span>
                    <span>טיימרי דגימה פעילים: {syncDebug.activePollingTimersCount}</span>
                  </>
                );
              })()}
              <span>מתאם כיתה: {adapterInfo.mode}</span>
              <span>Supabase מוגדר: {adapterInfo.supabaseConfigured ? "כן" : "לא"}</span>
              <span>פעימת דיבאג: {debugTick}</span>
              <span>חדר נבחר: {snapshot?.roomId ?? "אין"}</span>
              <span>סטטוס נבחר: {snapshot?.lifecycleStatus ?? "אין"}</span>
              <span>טיימרי סנכרון פעילים: {getActiveSyncDebugState().activeTimerCount}</span>
              {lastClassroomError ? <span className="text-amber-100">שגיאה אחרונה: {lastClassroomError}</span> : null}
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={archiveStaleRooms}
                disabled={archivingStaleRooms}
                className="rounded-md border border-amber-200/30 bg-amber-300/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {archivingStaleRooms ? "מעביר לארכיון..." : "העבר חדרי כיתה ישנים לארכיון"}
              </button>
            </div>
          </details>
        ) : null}

        <main className="mt-3 min-w-0 flex-1">
          {view === "overview" ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-[0_18px_50px_rgba(2,8,23,0.24)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/70">Teacher dashboard</p>
                  <h2 className="mt-1 text-2xl font-black text-white">{t("rooms")}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                    {language === "en"
                      ? "Embedded teacher overview for admins. Open an existing room from the list below, or use Create room from the admin quick actions."
                      : "תצוגת לוח מורה בתוך מסך האדמין. אפשר לפתוח חדר קיים מהרשימה, ויצירת חדר נשארת בכפתור יצירת חדר במסך האדמין."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refreshRooms}
                  disabled={roomsLoading}
                  className="rounded-full border border-cyan-100/25 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {roomsLoading ? t("refreshing") : (language === "en" ? "Refresh" : "רענון")}
                </button>
              </div>
              {lastClassroomError ? (
                <p className="mt-4 rounded-lg border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{lastClassroomError}</p>
              ) : null}
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-cyan-100/15 bg-slate-950/34 p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100/70">{t("activeRooms")}</p>
                  <p className="mt-2 text-3xl font-black text-white">{rooms.filter((room) => room.status === "WAITING" || room.status === "CREATED" || room.status === "DRAFT").length}</p>
                </div>
                <div className="rounded-lg border border-emerald-100/15 bg-slate-950/34 p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-100/70">{t("runningRooms")}</p>
                  <p className="mt-2 text-3xl font-black text-white">{rooms.filter((room) => room.status === "RACING").length}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/34 p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-300">{t("savedRooms")}</p>
                  <p className="mt-2 text-3xl font-black text-white">{rooms.length}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                {rooms.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-cyan-100/20 bg-slate-950/28 px-4 py-8 text-center text-sm font-bold text-slate-300">{t("noRooms")}</p>
                ) : rooms.slice(0, 8).map((room) => (
                  <button
                    key={room.id || room.roomCode}
                    type="button"
                    onClick={() => openRoom(room.roomCode)}
                    className="rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 text-start transition hover:border-cyan-100/35 hover:bg-cyan-300/10"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-black text-white">{room.raceName}</span>
                      <span className="rounded-full border border-cyan-100/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-cyan-100">{room.status}</span>
                    </span>
                    <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
                      {room.roomCode} · {room.currentPlayers}/{room.maxPlayers} {t("students")}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {view === "create" ? (
            <div
              className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-md"
              onMouseDown={goToStudentMode}
            >
              <div onMouseDown={(event) => event.stopPropagation()}>
              <TeacherCreateRacePanel
                config={config}
                connecting={creatingRoom || connection === "connecting"}
                disabledReason={adapterInfo.mode === "unavailable" ? adapterInfo.message : undefined}
                onConfigChange={setConfig}
                onCreate={createRace}
              />
              </div>
            </div>
          ) : null}

          {view === "lobby" && snapshot ? (
            <TeacherRoomLobby
              snapshot={snapshot}
              canStart={canStart}
              onRemove={removePlayer}
              onStart={startRace}
            />
          ) : null}

          {(view === "live" || view === "results") && snapshot ? (
            <TeacherLiveRaceDashboard
              snapshot={snapshot}
              events={events}
              onRemove={removePlayer}
            />
          ) : null}

          {view === "closed" && snapshot ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.035] px-5 py-6">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/70">חדר קודם</p>
              <h2 className="mt-2 text-2xl font-black text-white">{snapshot.roomSettings.raceName}</h2>
              <p className="mt-2 text-sm text-slate-300">
                חדר {snapshot.roomId} סגור או לא פעיל. הסנכרון החי הופסק ותלמידים לא יכולים להצטרף.
              </p>
            </section>
          ) : null}
        </main>

        <TeacherRoomsDrawer
          open={roomsDrawerOpen}
          rooms={rooms}
          selectedRoomCode={snapshot?.roomId}
          loading={roomsLoading}
          onClose={() => setRoomsDrawerOpen(false)}
          onNewRoom={resetDashboard}
          onOpenRoom={openRoom}
          onDeleteRoom={deleteRoom}
        />
      </div>
    </section>
  );
}
