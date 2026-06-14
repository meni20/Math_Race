import { useEffect, useMemo, useRef, useState } from "react";
import { TeacherCreateRacePanel } from "./TeacherCreateRacePanel";
import { TeacherGameClient } from "./teacherGameClient";
import { TeacherLiveRaceDashboard } from "./TeacherLiveRaceDashboard";
import { TeacherRaceHeader } from "./TeacherRaceHeader";
import { TeacherRoomsDrawer } from "./TeacherRoomsDrawer";
import { TeacherRoomLobby } from "./TeacherRoomLobby";
import type { TeacherDashboardView, TeacherEvent, TeacherRaceConfig, TeacherRoomSnapshot, TeacherRoomSummary } from "./teacherTypes";
import { DEFAULT_TEACHER_CONFIG, buildRandomId, normalizeTeacherConfig } from "./teacherUtils";
import { archiveStaleClassroomRooms, getClassroomAdapterInfo } from "../../game/network/classroomRooms";
import { getActiveSyncDebugState } from "../../game/sync/syncLifecycle";

type TeacherConnectionStatus = "idle" | "connecting" | "connected" | "error";

export function TeacherDashboard() {
  const clientRef = useRef<TeacherGameClient | null>(null);
  const previousRanksRef = useRef<Record<string, number>>({});
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
  const [view, setView] = useState<TeacherDashboardView>("create");
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
        const message = error instanceof Error ? error.message : "Unable to load rooms.";
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
          message: `${player.name} joined with ${player.carName ?? "a car"}.`,
          createdAt: new Date().toISOString()
        });
      } else {
        if (previous.status !== "RACING" && player.status === "RACING") {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "RACING",
            playerId: player.playerId,
            message: `${player.name} entered the race.`,
            createdAt: new Date().toISOString()
          });
        }
        if (previous.status !== "FINISHED" && player.status === "FINISHED") {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "FINISHED",
            playerId: player.playerId,
            message: `${player.name} finished the race.`,
            createdAt: new Date().toISOString()
          });
        }
        if (player.correctAnswers > previous.correctAnswers) {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "CORRECT_ANSWER",
            playerId: player.playerId,
            message: `${player.name} answered correctly${(player.streak ?? 0) > 1 ? ` (${player.streak} streak)` : ""}.`,
            createdAt: new Date().toISOString()
          });
        }
        if (player.wrongAnswers > previous.wrongAnswers) {
          nextEvents.push({
            id: buildRandomId("event"),
            type: "WRONG_ANSWER",
            playerId: player.playerId,
            message: `${player.name} missed a question.`,
            createdAt: new Date().toISOString()
          });
        }
      }
      if (previousRanks[player.playerId] > player.rank && snapshot.racePhase === "active") {
        nextEvents.push({
          id: buildRandomId("event"),
          type: "OVERTAKE",
          playerId: player.playerId,
          message: `${player.name} moved to rank ${player.rank}.`,
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
  const targetLabel = snapshot ? `${snapshot.roomSettings.targetScore ?? 500} pts` : `${config.targetScore} pts`;

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
      const message = error instanceof Error ? error.message : "Could not create room.";
      setLastClassroomError(message);
      setConnection("error");
      setConnectionMessage(message);
      setView("create");
    } finally {
      setCreatingRoom(false);
    }
  };

  const removePlayer = (playerId: string) => {
    const playerName = snapshot?.players.find((player) => player.playerId === playerId)?.name ?? "Student";
    void clientRef.current?.removePlayer(playerId);
    setEvents((current) => [{
      id: buildRandomId("event"),
      type: "REMOVED",
      playerId,
      message: `${playerName} removed from the room.`,
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
      message: "Race started.",
      createdAt: new Date().toISOString()
    }, ...current].slice(0, 30));
    void clientRef.current?.startRace().then(refreshRooms).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not start race.";
      setLastClassroomError(message);
      setConnectionMessage(message);
    });
  };

  const endRace = () => {
    void clientRef.current?.returnToLobby().then(refreshRooms).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not end race.";
      setLastClassroomError(message);
      setConnectionMessage(message);
    });
    setEvents((current) => [{
      id: buildRandomId("event"),
      type: "ENDED",
      message: "Race ended.",
      createdAt: new Date().toISOString()
    }, ...current].slice(0, 30));
  };

  const resetDashboard = () => {
    void clientRef.current?.disconnect().then(refreshRooms);
    setSnapshot(null);
    setEvents([]);
    previousRanksRef.current = {};
    previousPlayersRef.current = {};
    setView("create");
  };

  const openRoom = (roomCode: string) => {
    previousRanksRef.current = {};
    previousPlayersRef.current = {};
    setEvents([]);
    setView("lobby");
    void clientRef.current?.openRoom(roomCode).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not open room.";
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
    setView("create");
  };

  const goToStudentMode = () => {
    void clientRef.current?.disconnect();
    const url = new URL(window.location.href);
    url.searchParams.delete("teacher");
    const nextPath = `${url.pathname}${url.search}${url.hash}` || "/";
    window.history.replaceState(null, "", nextPath);
    window.location.assign(nextPath);
  };

  const deleteRoom = (roomCode: string) => {
    if (!window.confirm(`Delete room ${roomCode}? It will be hidden from students and archived from this list.`)) {
      return;
    }
    void clientRef.current?.deleteRoom(roomCode).then(() => {
      if (snapshot?.roomId === roomCode) {
        setSnapshot(null);
        setView("create");
      }
      refreshRooms();
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not delete room.";
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
      setConnectionMessage(`Archived ${result.archivedCount} stale room(s) older than ${result.thresholdHours}h.`);
      setLastClassroomError("");
      refreshRooms();
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not archive stale rooms.";
      setLastClassroomError(message);
      setConnectionMessage(message);
    }).finally(() => {
      setArchivingStaleRooms(false);
    });
  };

  const connectedLabel = connection === "connected"
    ? "Connected"
    : connection === "connecting"
      ? "Connecting"
      : connection === "error"
        ? "Limited"
        : "Offline";

  return (
    <section className="pointer-events-auto absolute inset-0 z-40 overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[96rem] flex-col px-3 py-3 sm:px-5 lg:px-6">
        <TeacherRaceHeader
          title={snapshot?.roomSettings.raceName ?? config.raceName}
          snapshot={snapshot}
          connectionLabel={connectedLabel}
          targetLabel={targetLabel}
          playerCount={activePlayers.length}
          localDev={adapterInfo.mode === "local-dev"}
          canStart={canStart}
          onStart={startRace}
          onEnd={endRace}
          onCloseRoom={closeCurrentView}
          onNewRoom={resetDashboard}
          onOpenRooms={() => setRoomsDrawerOpen(true)}
          onStudentMode={goToStudentMode}
        />

        {classroomInfoMessage ? (
          <p className="mt-3 rounded-lg border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{classroomInfoMessage}</p>
        ) : null}
        {import.meta.env.DEV ? (
          <details className="mt-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300">
            <summary className="cursor-pointer font-bold uppercase tracking-[0.12em] text-cyan-100/75">
              Developer diagnostics
            </summary>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {(() => {
                const liveDebug = clientRef.current?.getLiveDebugState();
                const syncDebug = getActiveSyncDebugState();
                return (
                  <>
                    <span>Teacher transport: {liveDebug?.transportState ?? "idle"}</span>
                    <span>SSE connected: {liveDebug?.sseConnected ? "true" : "false"}</span>
                    <span>Polling fallback active: {liveDebug?.teacherPollingActive ? "true" : "false"}</span>
                    <span>Fallback interval: {liveDebug?.fallbackIntervalMs ?? 0}ms</span>
                    <span>Last SSE event: {liveDebug?.lastSseEventType || "none"}</span>
                    <span>SSE messages: {liveDebug?.sseMessageCount ?? 0}</span>
                    <span>Last SSE: {liveDebug?.lastSseEventAtMs ? new Date(liveDebug.lastSseEventAtMs).toLocaleTimeString() : "never"}</span>
                    <span>Last poll: {liveDebug?.lastTeacherPollAtMs ? new Date(liveDebug.lastTeacherPollAtMs).toLocaleTimeString() : "never"}</span>
                    <span>Stop reason: {liveDebug?.stopReason || "none"}</span>
                    <span>Teacher timers: {liveDebug?.activeTeacherTimers ?? 0}</span>
                    <span>teacher-room-events last 60s: {syncDebug.requestCountsLast60s.teacherRoomEvents}</span>
                    <span>teacher-sync-room last 60s: {syncDebug.requestCountsLast60s.teacherSyncRoom}</span>
                    <span>blocked teacher-sync-room last 60s: {syncDebug.requestCountsLast60s.teacherSyncRoomBlocked}</span>
                    <span>list-teacher-rooms last 60s: {syncDebug.requestCountsLast60s.listTeacherRooms}</span>
                  </>
                );
              })()}
              <span>Classroom adapter: {adapterInfo.mode}</span>
              <span>Supabase configured: {adapterInfo.supabaseConfigured ? "true" : "false"}</span>
              <span>Debug tick: {debugTick}</span>
              <span>Selected room: {snapshot?.roomId ?? "none"}</span>
              <span>Selected status: {snapshot?.lifecycleStatus ?? "none"}</span>
              <span>Active sync timers: {getActiveSyncDebugState().activeTimerCount}</span>
              {lastClassroomError ? <span className="text-amber-100">Last error: {lastClassroomError}</span> : null}
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={archiveStaleRooms}
                disabled={archivingStaleRooms}
                className="rounded-md border border-amber-200/30 bg-amber-300/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {archivingStaleRooms ? "Archiving..." : "Archive stale classroom rooms"}
              </button>
            </div>
          </details>
        ) : null}

        <main className="mt-3 min-w-0 flex-1">
          {view === "create" ? (
            <TeacherCreateRacePanel
              config={config}
              connecting={creatingRoom || connection === "connecting"}
              disabledReason={adapterInfo.mode === "unavailable" ? adapterInfo.message : undefined}
              onConfigChange={setConfig}
              onCreate={createRace}
            />
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
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/70">Previous Room</p>
              <h2 className="mt-2 text-2xl font-black text-white">{snapshot.roomSettings.raceName}</h2>
              <p className="mt-2 text-sm text-slate-300">
                Room {snapshot.roomId} is {snapshot.lifecycleStatus.toLowerCase()}. Live sync has stopped and students can no longer join.
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
