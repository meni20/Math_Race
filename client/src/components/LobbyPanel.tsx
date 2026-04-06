import { FormEvent, useMemo, useState } from "react";
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

export function LobbyPanel() {
  const connection = useGameStore((state) => state.connection);
  const roomId = useGameStore((state) => state.roomId);
  const displayName = useGameStore((state) => state.displayName);
  const playerId = useGameStore((state) => state.playerId);
  const prepareJoin = useGameStore((state) => state.prepareJoin);

  const [roomInput, setRoomInput] = useState(roomId || "arena-1");
  const [nameInput, setNameInput] = useState(displayName || "Neon Racer");
  const connecting = connection === "connecting";
  const connected = connection === "connected";
  const demoMode = isDemoTransportConfigured();

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

  const onDisconnect = () => {
    gameSocket.disconnect(false);
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
            {connected ? "Restart Race" : demoMode ? "Start Race" : "Join Race"}
          </button>
          <button
            type="button"
            onClick={onPlaySolo}
            disabled={connecting}
            className="rounded-lg border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Play Solo
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            className="col-span-2 rounded-lg border border-rose-300/45 bg-rose-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/25"
          >
            Exit
          </button>
        </div>
      </form>

      <p className="mt-3 text-xs text-slate-300/90">
        {demoMode
          ? "Hosted demo mode is active on this site. Join Race and Play Solo both start an in-browser race with AI rivals."
          : "Play Solo uses a private room bound to your player ID. Join Race keeps normal shared-room multiplayer."}
      </p>
    </section>
  );
}
