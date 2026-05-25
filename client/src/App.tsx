import { useEffect, useRef } from "react";
import { DecisionOverlay } from "./components/DecisionOverlay";
import { FinishOverlay } from "./components/FinishOverlay";
import { Hud } from "./components/Hud";
import { LobbyPanel } from "./components/LobbyPanel";
import { QuestionOverlay } from "./components/QuestionOverlay";
import { TeacherDashboard } from "./components/teacher/TeacherDashboard";
import { gameSocket } from "./game/network/gameSocket";
import { getConfiguredGameTransport } from "./game/network/transportConfig";
import { MenuScene, RaceScene } from "./game/scene/RaceScene";
import { useGameStore } from "./game/store/useGameStore";
import { normalizePlayerId, normalizeRoomId } from "./game/utils/gameIds";
import { useRenderedPlayers } from "./game/utils/useRenderedPlayers";

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
  const { playerIds, localPlayer } = useRenderedPlayers();

  return (
    <section className="pointer-events-none absolute right-4 top-4 z-30 rounded-xl border border-lime-300/45 bg-slate-950/78 px-3 py-2 text-xs text-lime-100 backdrop-blur">
      <p>connection: {connection}</p>
      <p>room: {roomId || "-"}</p>
      <p>player: {playerId || "-"}</p>
      <p>phase: {racePhase}</p>
      <p>players: {playerIds.length}</p>
      <p>local present: {localPlayer ? "yes" : "no"}</p>
      <p>lane: {localPlayer?.laneIndex ?? "-"}</p>
      <p>position: {localPlayer?.positionMeters ?? "-"}</p>
      <p>speed: {localPlayer?.speedMps ?? "-"}</p>
    </section>
  );
}

function App() {
  const autoJoinAttemptedRef = useRef(false);
  const prepareJoin = useGameStore((state) => state.prepareJoin);
  const connection = useGameStore((state) => state.connection);
  const racePhase = useGameStore((state) => state.racePhase);
  const raceStopped = useGameStore((state) => state.raceStopped);

  useEffect(() => {
    const handleBeforeUnload = () => {
      void gameSocket.disconnect(false);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (autoJoinAttemptedRef.current || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (parseBoolean(params.get("teacher"))) {
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

    const roomId = normalizeRoomId(params.get("room")?.trim() || "arena-1");
    const displayName = params.get("name")?.trim() || "Debug Racer";
    const playerId = normalizePlayerId(params.get("player")?.trim() || "p-debug-1");

    autoJoinAttemptedRef.current = true;
    prepareJoin(roomId, displayName, playerId);
    gameSocket.connect({ roomId, displayName, playerId });
  }, [prepareJoin]);

  const showMenuScene = connection === "idle" || connection === "connecting" || connection === "error";
  const showDebugOverlay = typeof window !== "undefined"
    ? parseBoolean(new URLSearchParams(window.location.search).get("debug"))
    : false;
  const showTeacherDashboard = typeof window !== "undefined"
    ? parseBoolean(new URLSearchParams(window.location.search).get("teacher"))
    : false;
  const showResults = racePhase === "finish" || raceStopped;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[linear-gradient(145deg,#071a38_0%,#082342_42%,#020817_100%)] text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,23,0.58)_0%,rgba(2,8,23,0.34)_28%,rgba(2,8,23,0)_62%),linear-gradient(180deg,rgba(148,203,213,0.05),rgba(2,8,23,0.18))]" />
      {showTeacherDashboard ? null : (showMenuScene ? <MenuScene /> : <RaceScene />)}
      {showTeacherDashboard || showResults ? null : <LobbyPanel />}
      {showTeacherDashboard || showResults ? null : <Hud />}
      {showTeacherDashboard || showResults ? null : <QuestionOverlay />}
      {showTeacherDashboard || showResults ? null : <DecisionOverlay />}
      {showTeacherDashboard ? null : <FinishOverlay />}
      {showTeacherDashboard ? null : (showDebugOverlay ? <DebugOverlay /> : null)}
      {showTeacherDashboard ? <TeacherDashboard /> : null}
    </main>
  );
}

export default App;
