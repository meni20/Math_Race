import { useEffect, useRef } from "react";
import { DecisionOverlay } from "./components/DecisionOverlay";
import { FinishOverlay } from "./components/FinishOverlay";
import { Hud } from "./components/Hud";
import { LobbyPanel } from "./components/LobbyPanel";
import { QuestionOverlay } from "./components/QuestionOverlay";
import { gameSocket } from "./game/network/gameSocket";
import { RaceScene } from "./game/scene/RaceScene";
import { useGameStore } from "./game/store/useGameStore";

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
  const playerIds = useGameStore((state) => state.playerIds);
  const players = useGameStore((state) => state.players);
  const localPlayer = playerId ? players[playerId] : undefined;

  return (
    <section className="pointer-events-none absolute right-4 top-4 z-30 rounded-xl border border-lime-300/45 bg-slate-950/78 px-3 py-2 text-xs text-lime-100 backdrop-blur">
      <p>connection: {connection}</p>
      <p>room: {roomId || "-"}</p>
      <p>player: {playerId || "-"}</p>
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
    if (!parseBoolean(params.get("autojoin"))) {
      return;
    }

    const roomId = params.get("room")?.trim() || "arena-1";
    const displayName = params.get("name")?.trim() || "Debug Racer";
    const playerId = params.get("player")?.trim() || "p-debug-1";

    autoJoinAttemptedRef.current = true;
    prepareJoin(roomId, displayName, playerId);
    gameSocket.connect({ roomId, displayName, playerId });
  }, [prepareJoin]);

  const showDebugOverlay = typeof window !== "undefined"
    ? parseBoolean(new URLSearchParams(window.location.search).get("debug"))
    : false;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-asphalt-900 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(40,246,255,0.15),transparent_45%),radial-gradient(circle_at_80%_15%,rgba(255,84,104,0.15),transparent_42%),radial-gradient(circle_at_50%_100%,rgba(255,197,67,0.08),transparent_45%)]" />
      <RaceScene />
      <LobbyPanel />
      <Hud />
      <QuestionOverlay />
      <DecisionOverlay />
      <FinishOverlay />
      {showDebugOverlay ? <DebugOverlay /> : null}
    </main>
  );
}

export default App;
