import { FormEvent, useEffect, useMemo, useState } from "react";
import type { TrackTheme } from "../game/types/messages";
import { gameSocket } from "../game/network/gameSocket";
import { isDemoTransportConfigured } from "../game/network/transportConfig";
import { useGameStore } from "../game/store/useGameStore";
import { GARAGE_CARS } from "../game/utils/carCatalog";
import { normalizeRoomId } from "../game/utils/gameIds";
import {
  areRoomSettingsEqual,
  formatDurationLabel,
  normalizeRoomSettings
} from "../game/utils/roomSettings";

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

const TRACK_THEME_OPTIONS: Array<{ id: TrackTheme; value: TrackTheme; name: string; label: string; thumbnail: string; previewClass: string }> = [
  {
    id: "sunny-forest",
    value: "sunny-forest",
    name: "Sunny Forest",
    label: "Sunny Forest",
    thumbnail: "/assets/maps/sunny_forest_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_24%_28%,rgba(255,232,132,0.72),transparent_18%),linear-gradient(145deg,#8adf7e_0%,#2e8f57_42%,#18412f_100%)]"
  },
  {
    id: "snow-peak",
    value: "snow-peak",
    name: "Snow Peak",
    label: "Snow Peak",
    thumbnail: "/assets/maps/snow_peak_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_72%_18%,rgba(255,255,255,0.9),transparent_16%),linear-gradient(145deg,#eef8ff_0%,#9cc4e6_44%,#324f76_100%)]"
  },
  {
    id: "fun-world",
    value: "fun-world",
    name: "Fun World",
    label: "Fun World",
    thumbnail: "/assets/maps/fun_world_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_24%_24%,rgba(255,179,226,0.82),transparent_18%),radial-gradient(circle_at_78%_34%,rgba(255,232,102,0.72),transparent_20%),linear-gradient(145deg,#7347ff_0%,#30d0ff_48%,#ff78c4_100%)]"
  },
  {
    id: "grand_prix",
    value: "grand_prix",
    name: "Grand Prix Stadium",
    label: "Grand Prix Stadium",
    thumbnail: "/assets/maps/stadium_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_50%_16%,rgba(255,255,255,0.92),transparent_12%),radial-gradient(circle_at_18%_66%,rgba(250,204,21,0.46),transparent_19%),radial-gradient(circle_at_82%_66%,rgba(56,189,248,0.42),transparent_19%),linear-gradient(145deg,#1f2937_0%,#475569_42%,#111827_100%)]"
  }
];

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
  const roomCreatorPlayerId = useGameStore((state) => state.roomCreatorPlayerId);
  const roomSettings = useGameStore((state) => state.roomSettings);
  const trackTheme = useGameStore((state) => state.trackTheme);
  const selectedCarId = useGameStore((state) => state.selectedCarId);
  const changeEnvironment = useGameStore((state) => state.changeEnvironment);
  const selectCar = useGameStore((state) => state.selectCar);
  const prepareJoin = useGameStore((state) => state.prepareJoin);

  const [roomInput, setRoomInput] = useState(roomId || "arena-1");
  const [nameInput, setNameInput] = useState(displayName || "Neon Racer");
  const [roomSettingsDraft, setRoomSettingsDraft] = useState(roomSettings);
  const [nowMs, setNowMs] = useState(Date.now());
  const [joinBoxOpen, setJoinBoxOpen] = useState(false);
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setRoomSettingsDraft(roomSettings);
  }, [
    roomId,
    roomSettings.raceName,
    roomSettings.maxPlayers,
    roomSettings.raceDurationSeconds,
    roomSettings.questionTimeLimitSeconds
  ]);

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
      return "border-emerald-200/15 bg-white/8 text-emerald-100";
    }
    if (connection === "connecting") {
      return "border-amber-200/15 bg-white/8 text-amber-100";
    }
    if (connection === "error") {
      return "border-red-200/15 bg-white/8 text-red-100";
    }
    return "border-cyan-100/10 bg-white/8 text-slate-200";
  }, [connection]);
  const badgeDotClass = useMemo(() => {
    if (connection === "connected") {
      return "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.65)]";
    }
    if (connection === "connecting") {
      return "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.65)]";
    }
    if (connection === "error") {
      return "bg-red-300 shadow-[0_0_10px_rgba(252,165,165,0.65)]";
    }
    return "bg-cyan-100/70 shadow-[0_0_10px_rgba(207,250,254,0.45)]";
  }, [connection]);

  const roster = useMemo(() => {
    return playerIds
      .map((currentPlayerId) => players[currentPlayerId])
      .filter((player): player is NonNullable<typeof player> => Boolean(player));
  }, [playerIds, players]);
  const creatorDisplayName = useMemo(() => {
    if (roomCreatorPlayerId === playerId) {
      return "You";
    }
    return roster.find((player) => player.playerId === roomCreatorPlayerId)?.displayName ?? "Waiting";
  }, [playerId, roomCreatorPlayerId, roster]);

  const minimumMaxPlayers = isSharedSession && demoMode
    ? 2
    : Math.max(2, Math.min(4, roster.length || 2));
  const normalizedRoomSettingsDraft = useMemo(
    () => normalizeRoomSettings(roomId, roomSettingsDraft, minimumMaxPlayers),
    [minimumMaxPlayers, roomId, roomSettingsDraft]
  );
  const isRoomCreator = isSharedSession && playerId === roomCreatorPlayerId;
  const canEditRoomSettings = isRoomCreator && racePhase === "lobby" && roomRacePhase === "lobby";
  const showRoomSettingsEditor = canEditRoomSettings;
  const roomSettingsDirty = !areRoomSettingsEqual(normalizedRoomSettingsDraft, roomSettings);
  const currentTrackIndex = Math.max(0, TRACK_THEME_OPTIONS.findIndex((option) => option.value === trackTheme));
  const currentTrack = TRACK_THEME_OPTIONS[currentTrackIndex] ?? TRACK_THEME_OPTIONS[0];
  const selectedCarIndex = Math.max(0, GARAGE_CARS.findIndex((car) => car.id === selectedCarId));

  const onJoin = (event: FormEvent) => {
    event.preventDefault();
    if (connecting || !nameInput.trim()) {
      return;
    }

    const normalizedRoomId = normalizeRoomId(roomInput.trim() || "arena-1");
    if (!normalizedRoomId) {
      return;
    }
    const nextPlayerId = playerId || buildPlayerId();
    prepareJoin(normalizedRoomId, nameInput, nextPlayerId);
    gameSocket.connect({
      roomId: normalizedRoomId,
      displayName: nameInput.trim(),
      playerId: nextPlayerId,
      carId: selectedCarId
    });
    setJoinBoxOpen(false);
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
      playerId: nextPlayerId,
      carId: selectedCarId
    });
  };

  const onStartRace = () => {
    if (!connected || racePhase !== "lobby") {
      return;
    }
    gameSocket.startRace();
  };

  const onSaveRoomSettings = () => {
    if (!canEditRoomSettings) {
      return;
    }
    gameSocket.updateRoomSettings(normalizedRoomSettingsDraft);
  };
  const cycleTrackTheme = (direction: -1 | 1) => {
    const nextIndex = (currentTrackIndex + direction + TRACK_THEME_OPTIONS.length) % TRACK_THEME_OPTIONS.length;
    changeEnvironment(TRACK_THEME_OPTIONS[nextIndex].value);
  };
  const cycleGarageCar = (direction: -1 | 1) => {
    const total = GARAGE_CARS.length;
    const nextIndex = (selectedCarIndex + direction + total) % total;
    selectCar(GARAGE_CARS[nextIndex].id);
  };

  const allPlayersInLobby = roster.length > 0 && roster.every((player) => player.racePhase === "lobby");
  const canStartRace = racePhase === "lobby" && (!isSharedSession || (roomRacePhase === "lobby" && allPlayersInLobby));

  if (isActiveRace) {
    return (
      <section className="pointer-events-auto absolute left-1/2 top-5 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-slate-950/58 px-3 py-2 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-100/80">{roomId}</span>
        <button
          type="button"
          onClick={onExitRace}
          className="rounded-full border border-rose-200/30 bg-rose-500/14 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/22"
        >
          {isSharedSession ? "Exit to Lobby" : "Exit"}
        </button>
      </section>
    );
  }

  if (inRoomLobbyFlow) {
    const countdownMs = Math.max(0, raceStartingAtMs - nowMs);

    return (
      <>
        {settingsOpen && showRoomSettingsEditor ? (
          <section className="pointer-events-auto absolute bottom-28 left-1/2 z-30 w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl border border-white/14 bg-slate-950/72 p-4 shadow-[0_18px_46px_rgba(2,8,23,0.38)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-100/75">Race Settings</p>
                <p className="mt-1 text-sm font-semibold text-slate-50">{roomSettings.raceName}</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">Race Name</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-cyan-100/35 focus:ring-2 focus:ring-cyan-100/10"
                  value={roomSettingsDraft.raceName}
                  onChange={(event) => setRoomSettingsDraft((current) => ({ ...current, raceName: event.target.value }))}
                  placeholder="Classroom Race"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">Max Players</span>
                <select
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-cyan-100/35"
                  value={normalizedRoomSettingsDraft.maxPlayers}
                  onChange={(event) => setRoomSettingsDraft((current) => ({ ...current, maxPlayers: Number(event.target.value) }))}
                >
                  {Array.from({ length: 5 - minimumMaxPlayers }, (_, index) => minimumMaxPlayers + index).map((value) => (
                    <option key={`max-${value}`} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">Race Duration</span>
                <select
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-cyan-100/35"
                  value={normalizedRoomSettingsDraft.raceDurationSeconds}
                  onChange={(event) => setRoomSettingsDraft((current) => ({ ...current, raceDurationSeconds: Number(event.target.value) }))}
                >
                  {[60, 120, 180, 300].map((value) => (
                    <option key={`duration-${value}`} value={value}>{formatDurationLabel(value)}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">Question Time</span>
                <select
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-cyan-100/35"
                  value={normalizedRoomSettingsDraft.questionTimeLimitSeconds}
                  onChange={(event) => setRoomSettingsDraft((current) => ({ ...current, questionTimeLimitSeconds: Number(event.target.value) }))}
                >
                  {[5, 8, 10, 12, 15].map((value) => (
                    <option key={`question-time-${value}`} value={value}>{value}s</option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
                <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">Map</p>
                <p className="mt-1 font-semibold">{currentTrack.name}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onSaveRoomSettings}
              disabled={!roomSettingsDirty}
              className="mt-3 w-full rounded-xl border border-cyan-100/30 bg-cyan-100/12 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-100/18 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Settings
            </button>
          </section>
        ) : null}

        <section className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/14 bg-slate-950/58 p-2 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
          {showRoomSettingsEditor ? (
            <button
              type="button"
              aria-label="Settings"
              onClick={() => setSettingsOpen((current) => !current)}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xl text-slate-100 transition hover:border-cyan-100/35 hover:bg-cyan-100/10"
            >
              ⚙
            </button>
          ) : null}
          <button
            type="button"
            onClick={onStartRace}
            disabled={!canStartRace}
            className="rounded-full border border-cyan-100/30 bg-cyan-100/12 px-7 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-50 transition hover:border-cyan-100/55 hover:bg-cyan-100/18 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {racePhase === "starting" ? `Starting ${formatCountdown(countdownMs)}s` : "Start Race"}
          </button>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="rounded-full border border-rose-200/30 bg-rose-500/12 px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20"
          >
            Exit
          </button>
        </section>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMapModalOpen(true)}
        className="pointer-events-auto absolute left-5 top-5 z-20 rounded-full border border-white/12 bg-slate-950/30 px-5 py-3 text-xs font-bold uppercase tracking-[0.16em] text-cyan-50 shadow-[0_18px_46px_rgba(2,8,23,0.28)] backdrop-blur-xl transition hover:border-cyan-100/40 hover:bg-cyan-300/10"
      >
        Maps
      </button>

      <button
        type="button"
        aria-label="Previous car"
        onClick={() => cycleGarageCar(-1)}
        className="pointer-events-auto absolute left-4 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-slate-950/58 text-2xl font-light text-cyan-50 shadow-[0_14px_34px_rgba(2,8,23,0.28)] transition hover:border-cyan-100/45 hover:bg-cyan-300/12"
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next car"
        onClick={() => cycleGarageCar(1)}
        className="pointer-events-auto absolute right-4 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-slate-950/58 text-2xl font-light text-cyan-50 shadow-[0_14px_34px_rgba(2,8,23,0.28)] transition hover:border-cyan-100/45 hover:bg-cyan-300/12"
      >
        ›
      </button>

      <div
        className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-slate-950/10 px-4 transition-opacity duration-300 ${
          mapModalOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          className={`pointer-events-auto w-[min(90vw,34rem)] rounded-3xl border border-white/14 bg-white/10 p-4 shadow-[0_30px_90px_rgba(2,8,23,0.42)] backdrop-blur-[15px] transition-all duration-300 ${
            mapModalOpen ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-50/80">Map Selection</p>
            <button
              type="button"
              onClick={() => setMapModalOpen(false)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-slate-950/28 p-3">
            <button
              type="button"
              aria-label="Previous map"
              onClick={() => cycleTrackTheme(-1)}
              className="absolute left-5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-slate-950/38 text-2xl font-light text-cyan-50 backdrop-blur-xl transition hover:bg-cyan-300/14"
            >
              ‹
            </button>
            <div
              key={currentTrack.value}
              className={`h-64 rounded-xl shadow-[inset_0_0_55px_rgba(255,255,255,0.16)] transition-all duration-500 ${currentTrack.previewClass}`}
            >
              <div className="flex h-full items-end justify-between p-5">
                <div className="h-16 w-24 rounded-t-full border-t border-white/35 bg-white/16 backdrop-blur-sm" />
                <div className="h-24 w-16 rounded-t-full border-t border-white/35 bg-slate-950/18 backdrop-blur-sm" />
                <div className="h-12 w-28 rounded-t-full border-t border-white/35 bg-white/14 backdrop-blur-sm" />
              </div>
            </div>
            <button
              type="button"
              aria-label="Next map"
              onClick={() => cycleTrackTheme(1)}
              className="absolute right-5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-slate-950/38 text-2xl font-light text-cyan-50 backdrop-blur-xl transition hover:bg-cyan-300/14"
            >
              ›
            </button>
          </div>

          <p className="mt-4 text-center text-xl font-bold tracking-[0.08em] text-slate-50">{currentTrack.name}</p>
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-6 z-20 translate-x-[-32%] text-center sm:top-8">
        <h1 className="text-3xl font-black uppercase tracking-[0.24em] text-cyan-50 drop-shadow-[0_0_18px_rgba(103,232,249,0.28)] sm:text-5xl">
          MATH RACING
        </h1>
      </div>

      <div className="pointer-events-auto absolute right-5 top-5 z-20 flex items-center gap-3 rounded-full border border-white/12 bg-slate-950/30 py-2 pl-3 pr-4 shadow-[0_18px_46px_rgba(2,8,23,0.28)] backdrop-blur-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-cyan-100/35 bg-cyan-300/15 text-base font-black uppercase text-cyan-50 shadow-[0_0_24px_rgba(103,232,249,0.22)]">
          {(nameInput.trim() || "N").slice(0, 1)}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Username</p>
          <input
            className="mt-0.5 w-32 bg-transparent text-sm font-semibold text-slate-50 outline-none placeholder:text-slate-300/55"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder="Neon Racer"
          />
        </div>
        <span className={`hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase sm:inline-flex ${badgeClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${badgeDotClass} animate-pulse`} />
          {connection}
        </span>
      </div>

      <div className="pointer-events-auto absolute bottom-8 left-8 z-20 flex w-[min(78vw,15rem)] flex-col gap-3">
        {joinBoxOpen ? (
          <form
            className="rounded-2xl border border-white/12 bg-slate-950/38 p-3 shadow-[0_18px_50px_rgba(2,8,23,0.32)] backdrop-blur-xl"
            onSubmit={onJoin}
          >
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
                Lobby Name/Number
              </span>
              <input
                className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-50 outline-none transition placeholder:text-slate-300/55 focus:border-cyan-100/35 focus:bg-slate-950/55 focus:ring-2 focus:ring-cyan-100/10"
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value)}
                placeholder="Arena-1"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setJoinBoxOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={connecting}
                className="rounded-xl border border-teal-100/30 bg-teal-400/14 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-teal-50 transition hover:border-teal-100/55 hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Join
              </button>
            </div>
          </form>
        ) : null}

        <button
          type="button"
          onClick={() => setJoinBoxOpen((current) => !current)}
          disabled={connecting}
          className="rounded-2xl border border-teal-100/30 bg-slate-950/34 px-5 py-3 text-left text-sm font-bold uppercase tracking-[0.12em] text-teal-50 shadow-[0_18px_46px_rgba(2,8,23,0.3)] backdrop-blur-xl transition hover:border-teal-100/55 hover:bg-teal-400/14 hover:shadow-[0_0_20px_rgba(45,212,191,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {demoMode ? "Join Lobby" : "Join Room"}
        </button>
        <button
          type="button"
          onClick={onPlaySolo}
          disabled={connecting}
          className="rounded-2xl border border-cyan-100/25 bg-cyan-100/10 px-5 py-3 text-left text-sm font-bold uppercase tracking-[0.12em] text-cyan-50 shadow-[0_18px_46px_rgba(2,8,23,0.3)] backdrop-blur-xl transition hover:border-cyan-100/50 hover:bg-cyan-100/16 hover:shadow-[0_0_20px_rgba(165,243,252,0.16)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Play Solo
        </button>
        {connection === "error" && connectionErrorMessage ? (
          <p className="rounded-xl border border-rose-400/45 bg-rose-500/12 px-3 py-2 text-xs text-rose-100 backdrop-blur-xl">
            {connectionErrorMessage}
          </p>
        ) : null}
      </div>

      <p className="pointer-events-none absolute bottom-8 left-1/2 z-20 w-[min(86vw,32rem)] -translate-x-1/2 text-center text-xs leading-5 text-slate-100/80 sm:text-sm">
        Join a room to enter the pre-race lobby, stage the cars, and start when the room is ready.
      </p>
    </>
  );
}
