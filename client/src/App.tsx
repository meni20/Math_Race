import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { AdminDashboardHome } from "./components/AdminDashboardHome";
import { AuthPage } from "./components/AuthPage";
import { DecisionOverlay } from "./components/DecisionOverlay";
import { FinishOverlay } from "./components/FinishOverlay";
import { Hud } from "./components/Hud";
import { LanguageToggle } from "./components/LanguageToggle";
import { LobbyPanel } from "./components/LobbyPanel";
import { QuestionOverlay } from "./components/QuestionOverlay";
import { RaceResultsPage } from "./components/RaceResultsPage";
import { ThemeToggle } from "./components/ThemeToggle";
import { TeacherDashboard } from "./components/teacher/TeacherDashboard";
import { getClassroomAdapterInfo, getClassroomRoomService } from "./game/network/classroomRooms";
import { gameSocket } from "./game/network/gameSocket";
import { navigateToRaceResults, saveRaceResults } from "./game/results/raceResults";
import { getConfiguredGameTransport } from "./game/network/transportConfig";
import { MenuScene, RaceScene } from "./game/scene/RaceScene";
import { useGameStore } from "./game/store/useGameStore";
import { normalizePlayerId, normalizeRoomId } from "./game/utils/gameIds";
import { useRenderedPlayersUi } from "./game/utils/useRenderedPlayers";
import { useLanguage } from "./i18n";
import { useTheme } from "./theme";

function parseBoolean(value: string | null) {
  if (!value) {
    return false;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function DebugOverlay() {
  const connection = useGameStore((state) => state.connection);
  const roomId = useGameStore((state) => state.roomId);
  const playerId = useGameStore((state) => state.playerId);
  const racePhase = useGameStore((state) => state.racePhase);
  const { playerIds, localPlayer } = useRenderedPlayersUi();

  return (
    <section className="pointer-events-none absolute right-4 top-4 z-30 rounded-xl border border-lime-300/45 bg-slate-950/78 px-3 py-2 text-xs text-lime-100 backdrop-blur">
      <p>חיבור: {connection}</p>
      <p>חדר: {roomId || "-"}</p>
      <p>שחקן: {playerId || "-"}</p>
      <p>שלב: {racePhase}</p>
      <p>שחקנים: {playerIds.length}</p>
      <p>שחקן מקומי: {localPlayer ? "כן" : "לא"}</p>
      <p>מסלול: {localPlayer?.laneIndex ?? "-"}</p>
      <p>מיקום: {localPlayer?.positionMeters ?? "-"}</p>
      <p>מהירות: {localPlayer?.speedMps ?? "-"}</p>
    </section>
  );
}

function App() {
  const autoJoinAttemptedRef = useRef(false);
  const { direction, language } = useLanguage();
  const { theme } = useTheme();
  const { user, loading: authLoading, canAccessTeacher } = useAuth();
  const [locationKey, setLocationKey] = useState(() => `${window.location.pathname}${window.location.search}${window.location.hash}`);
  const prepareJoin = useGameStore((state) => state.prepareJoin);
  const connection = useGameStore((state) => state.connection);
  const racePhase = useGameStore((state) => state.racePhase);
  const raceStopped = useGameStore((state) => state.raceStopped);
  const roomId = useGameStore((state) => state.roomId);
  const players = useGameStore((state) => state.players);
  const roomSettings = useGameStore((state) => state.roomSettings);
  const raceStartedAtMs = useGameStore((state) => state.raceStartedAtMs);
  const raceFinishedAtMs = useGameStore((state) => state.raceFinishedAtMs);

  useEffect(() => {
    const handleLocationChange = () => {
      setLocationKey(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    };
    const handleBeforeUnload = () => {
      void gameSocket.disconnect(false);
    };

    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (autoJoinAttemptedRef.current || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (isTeacherRoute(window.location.pathname, params) || isAuthRoute(window.location.pathname) || getResultsSessionId(window.location.pathname)) {
      return;
    }
    if (!parseBoolean(params.get("autojoin"))) {
      if (getConfiguredGameTransport() !== "websocket") {
        return;
      }

      const persistedSession = gameSocket.getPersistedWebsocketSession();
      if (!persistedSession) {
        return;
      }

      autoJoinAttemptedRef.current = true;
      prepareJoin(persistedSession.roomId, persistedSession.displayName, persistedSession.playerId);
      gameSocket.connect(persistedSession);
      return;
    }

    const requestedRoomId = params.get("room")?.trim();
    if (!requestedRoomId) {
      return;
    }
    const roomId = normalizeRoomId(requestedRoomId);
    const persistedSession = gameSocket.getPersistedWebsocketSession();
    const canResumePersisted = persistedSession?.roomId === roomId;
    const displayName = params.get("name")?.trim() || (canResumePersisted ? persistedSession.displayName : "נהג בדיקה");
    const playerId = normalizePlayerId(params.get("player")?.trim() || (canResumePersisted ? persistedSession.playerId : "p-debug-1"));

    autoJoinAttemptedRef.current = true;
    const runAutoJoin = async () => {
      if (getClassroomAdapterInfo().mode === "supabase") {
        const room = await getClassroomRoomService().getRoomByCode(roomId).catch(() => null);
        if (!room) {
          useGameStore.getState().setConnection("error", "החדר לא נמצא או אינו זמין.");
          return;
        }
        if (room.status === "DELETED" || room.deletedAt) {
          useGameStore.getState().setConnection("error", "החדר הזה כבר לא זמין.");
          return;
        }
        if (room.status === "CLOSED" || room.closedAt) {
          useGameStore.getState().setConnection("error", "החדר נסגר על ידי המורה.");
          return;
        }
        if (room.status === "FINISHED" || room.endedAt) {
          useGameStore.getState().setConnection("error", "המרוץ הזה הסתיים.");
          return;
        }
        if (!room.isListed || room.isLocked) {
          useGameStore.getState().setConnection("error", "החדר אינו זמין כרגע.");
          return;
        }
        if (room.currentPlayers >= room.maxPlayers) {
          useGameStore.getState().setConnection("error", "החדר מלא.");
          return;
        }
        if (room.status !== "WAITING" && !(room.status === "RACING" && room.allowMidGameJoin)) {
          useGameStore.getState().setConnection("error", "אי אפשר להצטרף לחדר כרגע.");
          return;
        }
      }

      prepareJoin(roomId, displayName, playerId);
      gameSocket.connect({ roomId, displayName, playerId });
    };
    void runAutoJoin();
  }, [locationKey, prepareJoin]);

  useEffect(() => {
    const finished = racePhase === "finish" || raceStopped;
    const finalPlayers = Object.values(players);
    if (!finished || !roomId || finalPlayers.length === 0 || getResultsSessionId(window.location.pathname)) {
      return;
    }
    const saved = saveRaceResults({
      sessionId: roomId,
      roomSettings,
      raceStartedAtMs,
      raceFinishedAtMs: raceFinishedAtMs ?? Date.now(),
      players: finalPlayers
    });
    if (saved) {
      navigateToRaceResults(roomId);
    }
  }, [players, raceFinishedAtMs, racePhase, raceStartedAtMs, raceStopped, roomId, roomSettings]);

  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const resultsSessionId = getResultsSessionId(pathname);
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const authRoute = isAuthRoute(pathname);
  const teacherRoute = isTeacherRoute(pathname, params);
  const showMenuScene = connection === "idle" || connection === "connecting" || connection === "error";
  const showDebugOverlay = typeof window !== "undefined"
    ? parseBoolean(new URLSearchParams(window.location.search).get("debug"))
    : false;
  const showTeacherDashboard = teacherRoute && canAccessTeacher;
  const showResults = racePhase === "finish" || raceStopped;
  const showPermissionDenied = teacherRoute && !authLoading && Boolean(user) && !canAccessTeacher;
  const showAuthPage = authRoute || (teacherRoute && !authLoading && !user);
  const showAdminHome = user?.role === "admin"
    && !teacherRoute
    && !parseBoolean(params.get("adminGame"))
    && !showAuthPage
    && !showPermissionDenied
    && showMenuScene;
  const showLandingLanguageToggle = showMenuScene && !showAdminHome && !showTeacherDashboard && !showAuthPage && !showPermissionDenied;
  const showThemeToggle = !showTeacherDashboard
    && !showAdminHome
    && !showResults
    && racePhase !== "active"
    && racePhase !== "starting"
    && (showMenuScene || showAuthPage || showPermissionDenied || racePhase === "lobby");
  const lightUiClass = theme === "light" && showThemeToggle ? "theme-light-ui" : "";

  if (resultsSessionId) {
    return <RaceResultsPage sessionId={resultsSessionId} />;
  }

  return (
    <main dir={direction} lang={language} className={`relative h-screen w-screen overflow-hidden bg-[linear-gradient(145deg,#071a38_0%,#082342_42%,#020817_100%)] text-slate-100 ${lightUiClass}`}>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,23,0.58)_0%,rgba(2,8,23,0.34)_28%,rgba(2,8,23,0)_62%),linear-gradient(180deg,rgba(148,203,213,0.05),rgba(2,8,23,0.18))]" />
      {showLandingLanguageToggle ? (
      <div className="pointer-events-auto absolute right-5 top-28 z-[70] flex items-start gap-2">
        <LanguageToggle />
      </div>
      ) : null}
      {showThemeToggle ? (
        <div className="pointer-events-auto fixed bottom-5 right-5 z-[90]">
          <ThemeToggle />
        </div>
      ) : null}
      {showAuthPage ? <AuthPage /> : null}
      {showPermissionDenied ? <PermissionDenied /> : null}
      {showAuthPage || showPermissionDenied ? null : (
        <>
      {showAdminHome ? <AdminDashboardHome /> : null}
      {showAdminHome ? null : (showMenuScene ? <MenuScene /> : <RaceScene />)}
      {showAdminHome || showTeacherDashboard || showResults ? null : <LobbyPanel />}
      {showAdminHome || showTeacherDashboard || showResults ? null : <Hud />}
      {showAdminHome || showTeacherDashboard || showResults ? null : <QuestionOverlay />}
      {showAdminHome || showTeacherDashboard || showResults ? null : <DecisionOverlay />}
      {showAdminHome || showTeacherDashboard ? null : <FinishOverlay />}
      {showAdminHome || showTeacherDashboard ? null : (showDebugOverlay ? <DebugOverlay /> : null)}
      {showTeacherDashboard ? <TeacherDashboard /> : null}
        </>
      )}
    </main>
  );
}

function isAuthRoute(pathname: string) {
  return pathname === "/login" || pathname === "/auth";
}

function getResultsSessionId(pathname: string) {
  const match = pathname.match(/^\/race-results\/([^/]+)\/?$/);
  if (!match) {
    return "";
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function isTeacherRoute(pathname: string, params: URLSearchParams) {
  return pathname === "/teacher" || parseBoolean(params.get("teacher"));
}

function navigateHome() {
  window.history.pushState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function PermissionDenied() {
  const { t } = useLanguage();
  return (
    <section className="pointer-events-auto relative z-20 flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-white/14 bg-slate-950/82 p-6 text-center shadow-[0_28px_90px_rgba(2,8,23,0.52)] backdrop-blur-xl">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-rose-100/80">{t("permissionDenied")}</p>
        <h1 className="mt-2 text-2xl font-black text-white">{t("permissionDenied")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">{t("permissionDeniedBody")}</p>
        <button
          type="button"
          onClick={navigateHome}
          className="mt-5 rounded-md border border-cyan-100/30 bg-cyan-300/14 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/22"
        >
          {t("goHome")}
        </button>
      </div>
    </section>
  );
}

export default App;
