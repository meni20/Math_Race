import { useEffect, useRef } from "react";
import { DecisionOverlay } from "./components/DecisionOverlay";
import { FinishOverlay } from "./components/FinishOverlay";
import { Hud } from "./components/Hud";
import { LobbyPanel } from "./components/LobbyPanel";
import { QuestionOverlay } from "./components/QuestionOverlay";
import { gameSocket } from "./game/network/gameSocket";
import { getConfiguredGameTransport } from "./game/network/transportConfig";
import { MenuScene, RaceScene } from "./game/scene/RaceScene";
import { useGameStore } from "./game/store/useGameStore";
import { normalizePlayerId, normalizeRoomId } from "./game/utils/gameIds";

function parseBoolean(value: string | null) {
  if (!value) {
    return false;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function App() {
  const autoJoinAttemptedRef = useRef(false);
  const prepareJoin = useGameStore((state) => state.prepareJoin);
  const connection = useGameStore((state) => state.connection);

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

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[linear-gradient(145deg,#071a38_0%,#082342_42%,#020817_100%)] text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,23,0.58)_0%,rgba(2,8,23,0.34)_28%,rgba(2,8,23,0)_62%),linear-gradient(180deg,rgba(148,203,213,0.05),rgba(2,8,23,0.18))]" />
      {showMenuScene ? <MenuScene /> : <RaceScene />}
      <LobbyPanel />
      <Hud />
      <QuestionOverlay />
      <DecisionOverlay />
      <FinishOverlay />
    </main>
  );
}

export default App;
