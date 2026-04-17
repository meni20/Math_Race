import { FormEvent, useEffect, useMemo, useState } from "react";
import { gameSocket } from "../game/network/gameSocket";
import { isDemoTransportConfigured } from "../game/network/transportConfig";
import { useGameStore } from "../game/store/useGameStore";
import { normalizeRoomId } from "../game/utils/gameIds";

function buildPlayerId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `p-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `p-${Math.floor(Math.random() * 1_000_000_000).toString(36).slice(0, 8)}`;
}

function buildSoloRoomId(playerId: string) {
  return `solo-${playerId}`;
}

function formatCountdown(ms: number) {
  return Math.max(0, ms / 1000).toFixed(1);
}

export function LobbyPanel() {
  const connection = useGameStore((state) => state.connection);
  const connectionErrorMessage = useGameStore((state) => state.connectionErrorMessage);
  const sessionMode = useGameStore((state) => state.sessionMode);
  const roomId = useGameStore((state) => state.roomId);
  const displayName = useGameStore((state) => state.displayName);
  const playerId = useGameStore((state) => state.playerId);
  const playerIds = useGameStore((state) => state.playerIds);
  const players = useGameStore((state) => state.players);
  const roomRacePhase = useGameStore((state) => state.roomRacePhase);
  const racePhase = useGameStore((state) => state.racePhase);
  const raceStartingAtMs = useGameStore((state) => state.raceStartingAtMs);
  const prepareJoin = useGameStore((state) => state.prepareJoin);

  const [roomInput, setRoomInput] = useState(roomId || "arena-1");
  const [nameInput, setNameInput] = useState(displayName || "Neon Racer");
  const [nowMs, setNowMs] = useState(Date.now());
  const connecting = connection === "connecting";
  const connected = connection === "connected";
  const demoMode = isDemoTransportConfigured();
  const inRoomLobbyFlow = connected && sessionMode !== "personal" && (racePhase === "lobby" || racePhase === "starting");
  const isActiveRace = connected && racePhase === "active";
  const isSharedSession = sessionMode === "shared";

  useEffect(() => {
    setRoomInput(roomId || "arena-1");
  }, [roomId]);

  useEffect(() => {
    setNameInput(displayName || "Neon Racer");
  }, [displayName]);

  useEffect(() => {
    if (racePhase !== "starting") {
      setNowMs(Date.now());
      return undefined;
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(intervalId);
  }, [racePhase]);

  const badgeClass = useMemo(() => {
    if (connection === "connected") {
      return "bg-emerald-500/20 text-emerald-200";
    }
    if (connection === "connecting") {
      return "bg-amber-500/20 text-amber-200";
    }
    if (connection === "error") {
      return "bg-red-500/20 text-red-200";
    }
    return "bg-slate-700/50 text-slate-200";
  }, [connection]);

  const roster = useMemo(() => {
    return playerIds
      .map((currentPlayerId) => players[currentPlayerId])
      .filter((player): player is NonNullable<typeof player> => Boolean(player));
  }, [playerIds, players]);

  const onJoin = (event: FormEvent) => {
    event.preventDefault();
    if (connecting || !roomInput.trim() || !nameInput.trim()) {
      return;
    }

    const normalizedRoomId = normalizeRoomId(roomInput);
    if (!normalizedRoomId) {
      return;
    }
    const nextPlayerId = playerId || buildPlayerId();
    prepareJoin(normalizedRoomId, nameInput, nextPlayerId);
    gameSocket.connect({
      roomId: normalizedRoomId,
      displayName: nameInput.trim(),
      playerId: nextPlayerId
    });
  };

  const onLeaveRoom = () => {
    void gameSocket.leaveRoom();
  };

  const onExitRace = () => {
    if (isSharedSession) {
      gameSocket.returnToLobby();
      return;
    }
    void gameSocket.leaveRoom();
  };

  const onPlaySolo = () => {
    if (connecting || !nameInput.trim()) {
      return;
    }

    const nextPlayerId = playerId || buildPlayerId();
    const soloRoomId = buildSoloRoomId(nextPlayerId);
    setRoomInput(soloRoomId);
    prepareJoin(soloRoomId, nameInput, nextPlayerId);
    gameSocket.connect({
      roomId: soloRoomId,
      displayName: nameInput.trim(),
      playerId: nextPlayerId
    });
  };

  const onStartRace = () => {
    if (!connected || racePhase !== "lobby") {
      return;
    }
    gameSocket.startRace();
  };

  const allPlayersInLobby = roster.length > 0 && roster.every((player) => player.racePhase === "lobby");
  const canStartRace = racePhase === "lobby" && (!isSharedSession || (roomRacePhase === "lobby" && allPlayersInLobby));

  if (isActiveRace) {
    return (
      <section className="pointer-events-auto absolute left-4 top-4 z-20 flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-slate-950/70 px-3 py-2 backdrop-blur-xl">
        <span className="text-xs uppercase tracking-[0.16em] text-cyan-200/80">{roomId}</span>
        <button
          type="button"
          onClick={onExitRace}
          className="rounded-lg border border-rose-300/45 bg-rose-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/25"
        >
          {isSharedSession ? "Exit to Lobby" : "Exit"}
        </button>
      </section>
    );
  }

  if (inRoomLobbyFlow) {
    const countdownMs = Math.max(0, raceStartingAtMs - nowMs);
    const waitingForRoomReset = isSharedSession && racePhase === "lobby" && roomRacePhase !== "lobby";
    const statusCopy = racePhase === "starting"
      ? `Transitioning to the start line. Race begins in ${formatCountdown(countdownMs)}s.`
      : waitingForRoomReset
        ? roomRacePhase === "finish"
          ? "You are back in the shared room lobby. Waiting for the remaining drivers to return before the next race can start."
          : "You are back in the shared room lobby. Wait here while the current race finishes, or leave the room."
        : isSharedSession
          ? "Drivers are staged in the shared room lobby. Start the race when everyone is back and ready."
          : "Your solo car is staged and ready. Start whenever you want.";
    const helperCopy = demoMode
      ? "Demo mode still follows the same lobby -> starting -> race flow."
      : isSharedSession
        ? "Shared rooms can only restart once every driver in the room is back in the lobby."
        : "Solo runs return to your personal lobby when you exit the room.";
    const panelLabel = isSharedSession ? "Shared Room Lobby" : "Solo Staging";

    return (
      <section className="pointer-events-auto absolute left-4 top-4 z-20 w-[min(92vw,24rem)] rounded-3xl border border-cyan-300/28 bg-[linear-gradient(145deg,rgba(6,18,42,0.9),rgba(10,11,32,0.9))] p-5 shadow-[0_0_30px_rgba(40,246,255,0.12)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/80">{panelLabel}</p>
            <h1 className="mt-1 text-xl font-semibold text-cyan-50">{roomId}</h1>
          </div>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${badgeClass}`}>
            {connection}
          </span>
        </div>

        <p className="mt-3 text-sm text-slate-300">{statusCopy}</p>

        <div className="mt-4 rounded-2xl border border-cyan-300/18 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-cyan-200/75">Drivers</p>
          <ul className="mt-3 space-y-2 text-sm">
            {roster.map((player) => {
              const isLocal = player.playerId === playerId;
              return (
                <li
                  key={player.playerId}
                  className="flex items-center justify-between rounded-xl border border-slate-800/90 bg-slate-900/70 px-3 py-2 text-slate-100"
                >
                  <span>{player.displayName}{isLocal ? " (you)" : ""}</span>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-cyan-200/75">
                    {player.racePhase} · Lane {player.laneIndex + 1}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onStartRace}
            disabled={!canStartRace}
            className="rounded-xl border border-cyan-300/60 bg-cyan-400/25 px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {racePhase === "starting" ? "Starting..." : "Start Race"}
          </button>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="rounded-xl border border-rose-300/45 bg-rose-500/15 px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/25"
          >
            {isSharedSession ? "Leave Room" : "Exit"}
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-300/90">{helperCopy}</p>
      </section>
    );
  }

  return (
    <section className="pointer-events-auto absolute left-4 top-4 z-20 w-[min(92vw,22rem)] rounded-2xl border border-cyan-300/25 bg-slate-900/72 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-wide text-cyan-100">Math Racing Control</h1>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${badgeClass}`}>
          {connection}
        </span>
      </div>

      <form className="space-y-3" onSubmit={onJoin}>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-[0.15em] text-cyan-200/85">Room</span>
          <input
            className="w-full rounded-lg border border-cyan-400/35 bg-slate-950/80 px-3 py-2 text-sm text-cyan-100 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/40"
            value={roomInput}
            onChange={(event) => setRoomInput(event.target.value)}
            placeholder="arena-1"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-[0.15em] text-cyan-200/85">Display Name</span>
          <input
            className="w-full rounded-lg border border-cyan-400/35 bg-slate-950/80 px-3 py-2 text-sm text-cyan-100 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/40"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder="Neon Racer"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="submit"
            disabled={connecting}
            className="rounded-lg border border-cyan-300/60 bg-cyan-400/25 px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-cyan-50 shadow-neon transition hover:bg-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {demoMode ? "Join Lobby" : "Join Room"}
          </button>
          <button
            type="button"
            onClick={onPlaySolo}
            disabled={connecting}
            className="rounded-lg border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Play Solo
          </button>
        </div>
      </form>

      <p className="mt-3 text-xs text-slate-300/90">
        Join a room to enter the pre-race lobby, stage the cars, and start when the room is ready.
      </p>
      {connection === "error" && connectionErrorMessage ? (
        <p className="mt-3 rounded-lg border border-rose-400/45 bg-rose-500/12 px-3 py-2 text-xs text-rose-100">
          {connectionErrorMessage}
        </p>
      ) : null}
    </section>
  );
}
