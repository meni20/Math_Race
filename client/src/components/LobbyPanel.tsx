import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import type { TrackTheme } from "../game/types/messages";
import { gameSocket } from "../game/network/gameSocket";
import { StudentClassroomHud } from "./StudentClassroomHud";
import { getClassroomAdapterInfo, getClassroomRoomService, listActiveClassroomRooms, type ClassroomRoomSummary } from "../game/network/classroomRooms";
import { isDemoTransportConfigured } from "../game/network/transportConfig";
import { useGameStore } from "../game/store/useGameStore";
import { getActiveSyncDebugState, updateActiveClassroomListDebugState } from "../game/sync/syncLifecycle";
import { GARAGE_CARS } from "../game/utils/carCatalog";
import {
  areRoomSettingsEqual,
  DEFAULT_TARGET_SCORE,
  MAX_ROOM_PLAYERS,
  normalizeRoomSettings
} from "../game/utils/roomSettings";
import { useLanguage } from "../i18n";

function buildPlayerId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `p-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `p-${Math.floor(Math.random() * 1_000_000_000).toString(36).slice(0, 8)}`;
}

function buildSoloRoomId(playerId: string) {
  return `solo-${playerId}`;
}

function getInitialRoomInput() {
  if (typeof window === "undefined") {
    return "";
  }
  const roomFromUrl = new URLSearchParams(window.location.search).get("room")?.trim();
  return roomFromUrl || "";
}

function hasRoomInUrl() {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(new URLSearchParams(window.location.search).get("room")?.trim());
}

function navigateToLogin() {
  window.history.pushState(null, "", "/login");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateToTeacherDashboard() {
  window.history.pushState(null, "", "/teacher");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateToHome() {
  window.history.pushState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateToSoloSetup() {
  window.history.pushState(null, "", "/solo");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isSoloSetupRoute() {
  return typeof window !== "undefined" && window.location.pathname === "/solo";
}

interface LocalUserStats {
  wins: number;
  losses: number;
  games: number;
  level: number;
}

function readLocalUserStats(username?: string): LocalUserStats {
  const fallback = { wins: 0, losses: 0, games: 0, level: 1 };
  if (!username || typeof window === "undefined") {
    return fallback;
  }
  const keys = [
    `mathRace.userStats.${username}`,
    `mathRace.playerStats.${username}`,
    `mathRace.stats.${username}`
  ];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw) as Partial<LocalUserStats>;
      const wins = Math.max(0, Math.trunc(parsed.wins ?? 0));
      const losses = Math.max(0, Math.trunc(parsed.losses ?? 0));
      const games = Math.max(wins + losses, Math.trunc(parsed.games ?? 0));
      const level = Math.max(1, Math.trunc(parsed.level ?? Math.floor(games / 3) + 1));
      return { wins, losses, games, level };
    } catch {
      // Ignore old or malformed local stats and keep the profile usable.
    }
  }
  return fallback;
}

function formatCountdown(ms: number) {
  return Math.max(0, ms / 1000).toFixed(1);
}

function connectionLabel(status: string, language: "he" | "en") {
  if (language === "en") {
    if (status === "connected") {
      return "Connected";
    }
    if (status === "connecting") {
      return "Connecting";
    }
    if (status === "error") {
      return "Error";
    }
    return "Not connected";
  }
  if (status === "connected") {
    return "מחובר";
  }
  if (status === "connecting") {
    return "מתחבר";
  }
  if (status === "error") {
    return "שגיאה";
  }
  return "לא מחובר";
}

function classroomStatusLabel(status: string, language: "he" | "en") {
  if (language === "en") {
    if (status === "RACING") {
      return "Racing";
    }
    if (status === "WAITING") {
      return "Waiting";
    }
    if (status === "STARTING") {
      return "Starting";
    }
    if (status === "FINISHED") {
      return "Finished";
    }
    return status;
  }
  if (status === "RACING") {
    return "רץ";
  }
  if (status === "WAITING") {
    return "ממתין";
  }
  if (status === "STARTING") {
    return "מתחיל";
  }
  if (status === "FINISHED") {
    return "הסתיים";
  }
  return status;
}

const TRACK_THEME_OPTIONS: Array<{ id: TrackTheme; value: TrackTheme; name: string; label: string; thumbnail: string; previewClass: string }> = [
  {
    id: "sunny-forest",
    value: "sunny-forest",
    name: "יער שמשי",
    label: "יער שמשי",
    thumbnail: "/assets/maps/sunny_forest_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_24%_28%,rgba(255,232,132,0.72),transparent_18%),linear-gradient(145deg,#8adf7e_0%,#2e8f57_42%,#18412f_100%)]"
  },
  {
    id: "snow-peak",
    value: "snow-peak",
    name: "פסגת שלג",
    label: "פסגת שלג",
    thumbnail: "/assets/maps/snow_peak_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_72%_18%,rgba(255,255,255,0.9),transparent_16%),linear-gradient(145deg,#eef8ff_0%,#9cc4e6_44%,#324f76_100%)]"
  },
  {
    id: "fun-world",
    value: "fun-world",
    name: "עולם כיף",
    label: "עולם כיף",
    thumbnail: "/assets/maps/fun_world_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_24%_24%,rgba(255,179,226,0.82),transparent_18%),radial-gradient(circle_at_78%_34%,rgba(255,232,102,0.72),transparent_20%),linear-gradient(145deg,#7347ff_0%,#30d0ff_48%,#ff78c4_100%)]"
  },
  {
    id: "grand_prix",
    value: "grand_prix",
    name: "אצטדיון גרנד פרי",
    label: "אצטדיון גרנד פרי",
    thumbnail: "/assets/maps/stadium_preview.jpg",
    previewClass: "bg-[radial-gradient(circle_at_50%_16%,rgba(255,255,255,0.92),transparent_12%),radial-gradient(circle_at_18%_66%,rgba(250,204,21,0.46),transparent_19%),radial-gradient(circle_at_82%_66%,rgba(56,189,248,0.42),transparent_19%),linear-gradient(145deg,#1f2937_0%,#475569_42%,#111827_100%)]"
  }
];

export function LobbyPanel() {
  const { user, canAccessTeacher, loading: authLoading, logout, changePassword } = useAuth();
  const { t, language } = useLanguage();
  const labels = useMemo(() => language === "en" ? {
    defaultDriverName: "Math Racer",
    maps: "Maps",
    previousCar: "Previous car",
    nextCar: "Next car",
    mapSelection: "Map Selection",
    close: "Close",
    previousMap: "Previous map",
    nextMap: "Next map",
    roomCode: "Room code",
    cancel: "Cancel",
    join: "Join",
    activeClasses: "Active classes",
    refreshClasses: "Refresh classes",
    noActiveClasses: "No active classes available.",
    running: "Racing",
    waiting: "Waiting",
    soloSetup: "Solo setup",
    opponents: "Opponents",
    opponentSingular: "opponent",
    opponentPlural: "opponents",
    difficulty: "Difficulty",
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
    targetPoints: "Target points",
    shortRace: "short race",
    regularRace: "regular race",
    longRace: "long race",
    marathon: "marathon",
    startSolo: "Start solo",
    joinLobby: "Join lobby",
    joinRoom: "Join room",
    playSolo: "Play solo",
    joinHint: "Join a room to enter the pre-race lobby and wait for the teacher to start.",
    saveSettings: "Save settings",
    settings: "Settings",
    startingIn: "Starting in",
    secondsShort: "s",
    startRace: "Start race",
    leave: "Leave",
    classNotFound: "The room was not found or is not available.",
    roomUnavailable: "This room is no longer available.",
    roomClosed: "The room was closed by the teacher.",
    raceFinished: "This race has finished.",
    roomNotAvailable: "The room is not available right now.",
    registrationLocked: "Registration is locked.",
    roomFull: "The room is full.",
    cannotJoinNow: "Cannot join this room right now.",
    trackNames: {
      "sunny-forest": "Sunny Forest",
      "snow-peak": "Snow Peak",
      "fun-world": "Fun World",
      grand_prix: "Grand Prix Stadium"
    }
  } : {
    defaultDriverName: "נהג מתמטי",
    maps: "מפות",
    previousCar: "רכב קודם",
    nextCar: "רכב הבא",
    mapSelection: "בחירת מפה",
    close: "סגור",
    previousMap: "מפה קודמת",
    nextMap: "מפה הבאה",
    roomCode: "קוד חדר",
    cancel: "ביטול",
    join: "הצטרף",
    activeClasses: "כיתות פעילות",
    refreshClasses: "רענן כיתות",
    noActiveClasses: "אין כיתות פעילות זמינות.",
    running: "רץ",
    waiting: "ממתין",
    soloSetup: "הגדרת סולו",
    opponents: "יריבים",
    opponentSingular: "יריב",
    opponentPlural: "יריבים",
    difficulty: "רמה",
    easy: "קל",
    medium: "בינוני",
    hard: "קשה",
    targetPoints: "נקודות יעד",
    shortRace: "מרוץ קצר",
    regularRace: "מרוץ רגיל",
    longRace: "מרוץ ארוך",
    marathon: "מרתון",
    startSolo: "התחל סולו",
    joinLobby: "הצטרף ללובי",
    joinRoom: "הצטרף לחדר",
    playSolo: "משחק סולו",
    joinHint: "הצטרף לחדר כדי להיכנס ללובי לפני המרוץ ולהמתין שהמורה יתחיל.",
    saveSettings: "שמור הגדרות",
    settings: "הגדרות",
    startingIn: "מתחילים בעוד",
    secondsShort: "שנ'",
    startRace: "התחל מרוץ",
    leave: "יציאה",
    classNotFound: "החדר לא נמצא או אינו זמין.",
    roomUnavailable: "החדר הזה כבר לא זמין.",
    roomClosed: "החדר נסגר על ידי המורה.",
    raceFinished: "המרוץ הזה הסתיים.",
    roomNotAvailable: "החדר אינו זמין כרגע.",
    registrationLocked: "ההרשמה נעולה.",
    roomFull: "החדר מלא.",
    cannotJoinNow: "אי אפשר להצטרף לחדר כרגע.",
    trackNames: {
      "sunny-forest": "יער שמשי",
      "snow-peak": "פסגת שלג",
      "fun-world": "עולם כיף",
      grand_prix: "אצטדיון גרנד פרי"
    }
  }, [language]);
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

  const [roomInput, setRoomInput] = useState(roomId || getInitialRoomInput());
  const [nameInput, setNameInput] = useState(displayName || user?.username || labels.defaultDriverName);
  const [roomSettingsDraft, setRoomSettingsDraft] = useState(roomSettings);
  const [nowMs, setNowMs] = useState(Date.now());
  const [joinBoxOpen, setJoinBoxOpen] = useState(hasRoomInUrl());
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeLobbies, setActiveLobbies] = useState<ClassroomRoomSummary[]>([]);
  const [activeLobbyError, setActiveLobbyError] = useState("");
  const [soloSetupOpen, setSoloSetupOpen] = useState(isSoloSetupRoute);
  const [soloBotCount, setSoloBotCount] = useState(2);
  const [soloDifficulty, setSoloDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [soloTargetScore, setSoloTargetScore] = useState(500);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountCurrentPassword, setAccountCurrentPassword] = useState("");
  const [accountNextPassword, setAccountNextPassword] = useState("");
  const [accountStatusMessage, setAccountStatusMessage] = useState("");
  const activeListInFlightRef = useRef(false);
  const activeListGenerationRef = useRef(0);
  const joinBoxOpenRef = useRef(joinBoxOpen);
  const isClassroomSessionRef = useRef(false);
  const connecting = connection === "connecting";
  const connected = connection === "connected";
  const demoMode = isDemoTransportConfigured();
  const classroomAdapterInfo = useMemo(() => getClassroomAdapterInfo(), []);
  const inRoomLobbyFlow = connected && sessionMode !== "personal" && (racePhase === "lobby" || racePhase === "starting");
  const isActiveRace = connected && racePhase === "active";
  const isSharedSession = sessionMode === "shared";
  const isClassroomSession = isSharedSession && roomCreatorPlayerId === "";
  const shouldRefreshActiveClassrooms = joinBoxOpen && !isClassroomSession;
  const localPlayer = playerId ? players[playerId] : undefined;
  const syncDebug = import.meta.env.DEV ? getActiveSyncDebugState() : null;
  const studentSyncDebug = syncDebug?.active.find((entry) => entry.role === "student");
  const showMapButton = canAccessTeacher;
  const userStats = useMemo(() => readLocalUserStats(user?.username), [user?.username, accountMenuOpen]);
  const profileCopy = useMemo(() => language === "en" ? {
    title: "Profile",
    level: "Level",
    games: "Games",
    wins: "Wins",
    losses: "Losses",
    userDetails: "User details",
    username: "Username",
    role: "Role",
    changePassword: "Change password",
    currentPassword: "Current password",
    newPassword: "New password",
    savePassword: "Save password",
    passwordUpdated: "Password updated.",
    passwordFieldsRequired: "Fill both password fields.",
    localStatsNote: "Stats are saved locally for now.",
    map: "Map"
  } : {
    title: "פרופיל",
    level: "רמה",
    games: "משחקים",
    wins: "ניצחונות",
    losses: "הפסדים",
    userDetails: "פרטי משתמש",
    username: "שם משתמש",
    role: "תפקיד",
    changePassword: "שינוי סיסמה",
    currentPassword: "סיסמה נוכחית",
    newPassword: "סיסמה חדשה",
    savePassword: "שמור סיסמה",
    passwordUpdated: "הסיסמה עודכנה.",
    passwordFieldsRequired: "צריך למלא את שתי הסיסמאות.",
    localStatsNote: "הסטטיסטיקה נשמרת מקומית כרגע.",
    map: "מפה"
  }, [language]);

  useEffect(() => {
    if (roomId) {
      setRoomInput(roomId);
    }
  }, [roomId]);

  useEffect(() => {
    setNameInput(displayName || user?.username || labels.defaultDriverName);
  }, [displayName, labels.defaultDriverName, user?.username]);

  useEffect(() => {
    setRoomSettingsDraft(roomSettings);
  }, [
    roomId,
    roomSettings.raceName,
    roomSettings.targetScore,
    roomSettings.mapId,
    roomSettings.difficulty
  ]);

  useEffect(() => {
    if (racePhase !== "starting") {
      setNowMs(Date.now());
      return undefined;
    }

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(intervalId);
  }, [racePhase]);

  useEffect(() => {
    joinBoxOpenRef.current = joinBoxOpen;
  }, [joinBoxOpen]);

  useEffect(() => {
    const syncSoloRoute = () => {
      setSoloSetupOpen(isSoloSetupRoute());
    };
    syncSoloRoute();
    window.addEventListener("popstate", syncSoloRoute);
    return () => window.removeEventListener("popstate", syncSoloRoute);
  }, []);

  useEffect(() => {
    isClassroomSessionRef.current = isClassroomSession;
  }, [isClassroomSession]);

  const refreshActiveClassrooms = useCallback((manual = false) => {
    if (!joinBoxOpenRef.current || isClassroomSessionRef.current || activeListInFlightRef.current) {
      return Promise.resolve();
    }

    const requestGeneration = activeListGenerationRef.current;
    activeListInFlightRef.current = true;
    updateActiveClassroomListDebugState({
      panelOpen: true,
      inClassroomRoom: isClassroomSessionRef.current,
      visible: document.visibilityState === "visible",
      inFlight: true,
      pollingActive: false,
      activePollingTimers: 0,
      nextRefreshAtMs: 0
    });

    return listActiveClassroomRooms({ panelOpen: true, inClassroomRoom: isClassroomSessionRef.current, manual })
      .then((rooms) => {
        if (requestGeneration !== activeListGenerationRef.current || !joinBoxOpenRef.current || isClassroomSessionRef.current) {
          return;
        }
        setActiveLobbies(rooms);
        setActiveLobbyError("");
      })
      .catch((error) => {
        if (requestGeneration !== activeListGenerationRef.current || !joinBoxOpenRef.current || isClassroomSessionRef.current) {
          return;
        }
        setActiveLobbies([]);
        setActiveLobbyError(error instanceof Error ? error.message : labels.noActiveClasses);
      })
      .finally(() => {
        if (requestGeneration === activeListGenerationRef.current) {
          activeListInFlightRef.current = false;
          updateActiveClassroomListDebugState({
            inFlight: false,
            lastRefreshAtMs: Date.now(),
            pollingActive: false,
            activePollingTimers: 0,
            nextRefreshAtMs: 0
          });
        }
      });
  }, [labels.noActiveClasses]);

  useEffect(() => {
    if (!shouldRefreshActiveClassrooms) {
      activeListGenerationRef.current += 1;
      activeListInFlightRef.current = false;
      updateActiveClassroomListDebugState({
        panelOpen: joinBoxOpen,
        inClassroomRoom: isClassroomSession,
        visible: document.visibilityState === "visible",
        inFlight: false,
        pollingActive: false,
        activePollingTimers: 0,
        nextRefreshAtMs: 0
      });
      return undefined;
    }

    activeListGenerationRef.current += 1;
    updateActiveClassroomListDebugState({
      panelOpen: true,
      inClassroomRoom: false,
      visible: document.visibilityState === "visible",
      pollingActive: false,
      activePollingTimers: 0,
      nextRefreshAtMs: 0
    });
    void refreshActiveClassrooms(false);

    return () => {
      activeListGenerationRef.current += 1;
      activeListInFlightRef.current = false;
      updateActiveClassroomListDebugState({
        panelOpen: false,
        inClassroomRoom: isClassroomSessionRef.current,
        inFlight: false,
        pollingActive: false,
        activePollingTimers: 0,
        nextRefreshAtMs: 0
      });
    };
  }, [isClassroomSession, joinBoxOpen, refreshActiveClassrooms, shouldRefreshActiveClassrooms]);

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
  const hostPlayerId = roster[0]?.playerId ?? roomCreatorPlayerId;

  const minimumMaxPlayers = isSharedSession && demoMode
    ? 2
    : Math.max(2, Math.min(MAX_ROOM_PLAYERS, roster.length || 2));
  const normalizedRoomSettingsDraft = useMemo(
    () => normalizeRoomSettings(roomId, roomSettingsDraft, minimumMaxPlayers),
    [minimumMaxPlayers, roomId, roomSettingsDraft]
  );
  const isRoomHost = isSharedSession && playerId === hostPlayerId;
  const canEditRoomSettings = isRoomHost && racePhase === "lobby" && roomRacePhase === "lobby";
  const showRoomSettingsEditor = canEditRoomSettings;
  const roomSettingsDirty = !areRoomSettingsEqual(normalizedRoomSettingsDraft, roomSettings);
  const currentTrackIndex = Math.max(0, TRACK_THEME_OPTIONS.findIndex((option) => option.value === trackTheme));
  const currentTrack = TRACK_THEME_OPTIONS[currentTrackIndex] ?? TRACK_THEME_OPTIONS[0];
  const selectedCarIndex = Math.max(0, GARAGE_CARS.findIndex((car) => car.id === selectedCarId));
  const localRank = useMemo(() => {
    if (!playerId || roster.length === 0) {
      return null;
    }
    const ordered = [...roster].sort((left, right) => {
      const scoreDelta = Math.max(0, Math.trunc(right.score ?? 0)) - Math.max(0, Math.trunc(left.score ?? 0));
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return right.positionMeters - left.positionMeters || left.playerId.localeCompare(right.playerId);
    });
    const index = ordered.findIndex((player) => player.playerId === playerId);
    return index >= 0 ? index + 1 : null;
  }, [playerId, roster]);

  const onJoin = (event: FormEvent) => {
    event.preventDefault();
    void joinRoom(roomInput);
  };

  const joinRoom = async (roomCode: string) => {
    if (!user) {
      navigateToLogin();
      return;
    }
    if (connecting || !nameInput.trim()) {
      return;
    }
    if (classroomAdapterInfo.mode === "unavailable") {
      setActiveLobbyError(classroomAdapterInfo.message);
      setJoinBoxOpen(true);
      return;
    }

    const normalizedJoinCode = roomCode.trim().toUpperCase();
    if (!/^\d{6}$/.test(normalizedJoinCode)) {
      setActiveLobbyError(language === "en" ? "Enter the 6 digit join code." : "יש להזין קוד התחברות בן 6 ספרות.");
      setJoinBoxOpen(true);
      return;
    }
    const room = await getClassroomRoomService().getRoomByCode(normalizedJoinCode);
    if (!room) {
      setActiveLobbyError(labels.classNotFound);
      setJoinBoxOpen(true);
      return;
    }
    const resolvedRoomId = room.roomCode;
    if (room.status === "DELETED" || room.deletedAt) {
      setActiveLobbyError(labels.roomUnavailable);
      setJoinBoxOpen(true);
      return;
    }
    if (room.status === "CLOSED" || room.closedAt) {
      setActiveLobbyError(labels.roomClosed);
      setJoinBoxOpen(true);
      return;
    }
    if (room.status === "FINISHED" || room.endedAt) {
      setActiveLobbyError(labels.raceFinished);
      setJoinBoxOpen(true);
      return;
    }
    if (!room.isListed) {
      setActiveLobbyError(labels.roomNotAvailable);
      setJoinBoxOpen(true);
      return;
    }
    if (room.isLocked) {
      setActiveLobbyError(labels.registrationLocked);
      setJoinBoxOpen(true);
      return;
    }
    const persistedSession = gameSocket.getPersistedWebsocketSession();
    const isResumeAttempt = persistedSession?.roomId === resolvedRoomId;
    if (room.currentPlayers >= room.maxPlayers && !isResumeAttempt) {
      setActiveLobbyError(labels.roomFull);
      setJoinBoxOpen(true);
      return;
    }
    if (room.status !== "WAITING" && !(room.status === "RACING" && room.allowMidGameJoin)) {
      setActiveLobbyError(labels.cannotJoinNow);
      setJoinBoxOpen(true);
      return;
    }
    const nextPlayerId = isResumeAttempt ? persistedSession.playerId : (playerId || buildPlayerId());
    prepareJoin(resolvedRoomId, nameInput, nextPlayerId);
    gameSocket.connect({
      roomId: resolvedRoomId,
      displayName: nameInput.trim(),
      playerId: nextPlayerId,
      carId: selectedCarId
    });
    setJoinBoxOpen(false);
  };

  const onLeaveRoom = () => {
    void gameSocket.leaveRoom();
  };

  const onLogout = () => {
    void logout().then(() => {
      setAccountMenuOpen(false);
      setAccountCurrentPassword("");
      setAccountNextPassword("");
      setAccountStatusMessage("");
      void gameSocket.leaveRoom();
      navigateToLogin();
    });
  };

  const closeSoloSetup = useCallback(() => {
    setSoloSetupOpen(false);
    if (isSoloSetupRoute()) {
      navigateToHome();
    }
  }, []);

  const onChangePassword = (event: FormEvent) => {
    event.preventDefault();
    if (!accountCurrentPassword || !accountNextPassword) {
      setAccountStatusMessage(profileCopy.passwordFieldsRequired);
      return;
    }
    void changePassword(accountCurrentPassword, accountNextPassword)
      .then(() => {
        setAccountCurrentPassword("");
        setAccountNextPassword("");
        setAccountStatusMessage(profileCopy.passwordUpdated);
      })
      .catch((error) => {
        setAccountStatusMessage(error instanceof Error ? error.message : profileCopy.passwordFieldsRequired);
      });
  };

  const onExitRace = () => {
    if (isClassroomSession) {
      void gameSocket.leaveRoom();
      return;
    }
    if (isSharedSession) {
      gameSocket.returnToLobby();
      return;
    }
    void gameSocket.leaveRoom();
  };

  const onPlaySolo = () => {
    if (!user) {
      navigateToLogin();
      return;
    }
    setJoinBoxOpen(false);
    navigateToSoloSetup();
  };

  const startSoloRace = () => {
    if (!user) {
      navigateToLogin();
      return;
    }
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
      carId: selectedCarId,
      roomSettings: {
        raceName: language === "en" ? "Solo Race" : "מרוץ סולו",
        maxPlayers: Math.max(1, Math.min(4, soloBotCount + 1)),
        raceDurationSeconds: 180,
        questionTimeLimitSeconds: 15,
        targetScore: soloTargetScore,
        difficulty: soloDifficulty,
        operations: "MIXED"
      },
      soloBotCount
    });
    setSoloSetupOpen(false);
    if (isSoloSetupRoute()) {
      navigateToHome();
    }
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
    const nextTheme = TRACK_THEME_OPTIONS[nextIndex].value;
    changeEnvironment(nextTheme);
    setRoomSettingsDraft((current) => ({ ...current, mapId: nextTheme }));
  };
  const cycleGarageCar = (direction: -1 | 1) => {
    const total = GARAGE_CARS.length;
    const nextIndex = (selectedCarIndex + direction + total) % total;
    selectCar(GARAGE_CARS[nextIndex].id);
  };

  const allPlayersInLobby = roster.length > 0 && roster.every((player) => player.racePhase === "lobby");
  const canStartRace = racePhase === "lobby" && (!isSharedSession || (roomRacePhase === "lobby" && allPlayersInLobby));
  const classroomHudStatus = racePhase === "starting"
    ? "STARTING"
    : localPlayer?.racePhase === "lobby"
      ? "WAITING"
      : localPlayer?.racePhase?.toUpperCase();
  const classroomPlayerName = displayName || localPlayer?.displayName || "תלמיד";

  if (isActiveRace) {
    if (isClassroomSession) {
      return (
        <StudentClassroomHud
          roomCode={roomId}
          currentStudents={roster.length}
          maxStudents={roomSettings.maxPlayers}
          playerName={classroomPlayerName}
          position={localRank}
          score={Math.max(0, Math.trunc(localPlayer?.score ?? 0))}
          targetScore={Math.max(1, Math.trunc(roomSettings.targetScore ?? DEFAULT_TARGET_SCORE))}
          onLeave={onExitRace}
        />
      );
    }
    return (
      <section className="pointer-events-auto absolute left-1/2 top-5 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-slate-950/58 px-3 py-2 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-100/80">{roomId}</span>
        <button
          type="button"
          onClick={onExitRace}
          className="rounded-full border border-rose-200/30 bg-rose-500/14 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/22"
        >
          {isSharedSession ? "חזרה ללובי" : "יציאה"}
        </button>
      </section>
    );
  }

  if (inRoomLobbyFlow) {
    const countdownMs = Math.max(0, raceStartingAtMs - nowMs);

    if (isClassroomSession) {
      return (
        <StudentClassroomHud
          roomCode={roomId}
          currentStudents={roster.length}
          maxStudents={roomSettings.maxPlayers}
          playerName={classroomPlayerName}
          position={localRank}
          score={Math.max(0, Math.trunc(localPlayer?.score ?? 0))}
          targetScore={Math.max(1, Math.trunc(roomSettings.targetScore ?? DEFAULT_TARGET_SCORE))}
          status={classroomHudStatus}
          onLeave={onLeaveRoom}
        />
      );
    }

    return (
      <>
        {settingsOpen && showRoomSettingsEditor ? (
          <section className="pointer-events-auto absolute bottom-28 left-1/2 z-30 w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl border border-white/14 bg-slate-950/72 p-4 shadow-[0_18px_46px_rgba(2,8,23,0.38)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-100/75">הגדרות מרוץ</p>
                <p className="mt-1 text-sm font-semibold text-slate-50">{roomSettings.raceName}</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10"
              >
                סגור
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">שם המרוץ</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-cyan-100/35 focus:ring-2 focus:ring-cyan-100/10"
                  value={roomSettingsDraft.raceName}
                  onChange={(event) => setRoomSettingsDraft((current) => ({ ...current, raceName: event.target.value }))}
                  placeholder="מרוץ כיתתי"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">נקודות יעד</span>
                <select
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-50 outline-none transition focus:border-cyan-100/35"
                  value={normalizedRoomSettingsDraft.targetScore}
                  onChange={(event) => setRoomSettingsDraft((current) => ({ ...current, targetScore: Number(event.target.value) }))}
                >
                  <option value={300}>300 מרוץ קצר</option>
                  <option value={500}>500 מרוץ רגיל</option>
                  <option value={1000}>1000 מרוץ ארוך</option>
                  <option value={1500}>1500 אתגר</option>
                </select>
              </label>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
                <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">מפה</p>
                <p className="mt-1 font-semibold">{currentTrack.name}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onSaveRoomSettings}
              disabled={!roomSettingsDirty}
              className="mt-3 w-full rounded-xl border border-cyan-100/30 bg-cyan-100/12 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-100/18 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {labels.saveSettings}
            </button>
          </section>
        ) : null}

        <section className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/14 bg-slate-950/58 p-2 shadow-[0_14px_34px_rgba(2,8,23,0.3)]">
          {showRoomSettingsEditor ? (
            <button
              type="button"
              aria-label={labels.settings}
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
            {racePhase === "starting" ? `${labels.startingIn} ${formatCountdown(countdownMs)} ${labels.secondsShort}` : labels.startRace}
          </button>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="rounded-full border border-rose-200/30 bg-rose-500/12 px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20"
          >
            {labels.leave}
          </button>
        </section>
      </>
    );
  }

  return (
    <>
      {showMapButton ? (
        <button
          type="button"
          onClick={() => setMapModalOpen(true)}
          className="pointer-events-auto absolute left-5 top-5 z-20 rounded-full border border-white/12 bg-slate-950/30 px-5 py-3 text-xs font-bold uppercase tracking-[0.16em] text-cyan-50 shadow-[0_18px_46px_rgba(2,8,23,0.28)] backdrop-blur-xl transition hover:border-cyan-100/40 hover:bg-cyan-300/10"
        >
          {labels.maps}
        </button>
      ) : null}

      {canAccessTeacher ? (
        <button
          type="button"
          onClick={navigateToTeacherDashboard}
          className={`pointer-events-auto absolute left-5 z-20 rounded-full border border-white/12 bg-slate-950/30 px-5 py-3 text-xs font-bold uppercase tracking-[0.16em] text-cyan-50 shadow-[0_18px_46px_rgba(2,8,23,0.28)] backdrop-blur-xl transition hover:border-cyan-100/40 hover:bg-cyan-300/10 ${showMapButton ? "top-20" : "top-5"}`}
        >
          {t("teacher")}
        </button>
      ) : null}

      <button
        type="button"
        aria-label={labels.previousCar}
        onClick={() => cycleGarageCar(-1)}
        className="pointer-events-auto absolute left-4 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-slate-950/58 text-2xl font-light text-cyan-50 shadow-[0_14px_34px_rgba(2,8,23,0.28)] transition hover:border-cyan-100/45 hover:bg-cyan-300/12"
      >
        ‹
      </button>
      <button
        type="button"
        aria-label={labels.nextCar}
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
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-50/80">{labels.mapSelection}</p>
            <button
              type="button"
              onClick={() => setMapModalOpen(false)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10"
            >
              {labels.close}
            </button>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-slate-950/28 p-3">
            <button
              type="button"
              aria-label={labels.previousMap}
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
              aria-label={labels.nextMap}
              onClick={() => cycleTrackTheme(1)}
              className="absolute right-5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-slate-950/38 text-2xl font-light text-cyan-50 backdrop-blur-xl transition hover:bg-cyan-300/14"
            >
              ›
            </button>
          </div>

          <p className="mt-4 text-center text-xl font-bold tracking-[0.08em] text-slate-50">{labels.trackNames[currentTrack.value]}</p>
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-6 z-20 translate-x-[-32%] text-center sm:top-8">
        <h1 className="text-3xl font-black uppercase tracking-[0.24em] text-cyan-50 drop-shadow-[0_0_18px_rgba(103,232,249,0.28)] sm:text-5xl">
          {t("gameTitle")}
        </h1>
      </div>

      <div className="pointer-events-auto absolute right-5 top-5 z-20">
        <button
          type="button"
          onClick={() => {
            if (!user && !authLoading) {
              navigateToLogin();
              return;
            }
            setAccountMenuOpen((current) => !current);
          }}
          className="flex items-center gap-3 rounded-full border border-white/12 bg-slate-950/30 py-2 pl-3 pr-4 text-left shadow-[0_18px_46px_rgba(2,8,23,0.28)] backdrop-blur-xl transition hover:border-cyan-100/35 hover:bg-cyan-300/10"
          aria-label={user ? t("account") : t("login")}
          title={user ? t("account") : t("login")}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-cyan-100/35 bg-cyan-300/15 text-base font-black uppercase text-cyan-50 shadow-[0_0_24px_rgba(103,232,249,0.22)]">
            {(user?.username || nameInput.trim() || "N").slice(0, 1)}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">{authLoading ? t("loading") : user ? t("signedInAs") : t("notSignedIn")}</p>
            {user ? (
              <>
                <p className="mt-0.5 w-32 truncate text-sm font-semibold text-slate-50">{user.username}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100/80">{t(user.role)}</p>
              </>
            ) : (
              <p className="mt-0.5 text-sm font-bold text-cyan-50 underline decoration-cyan-100/35 underline-offset-4">
                {t("login")}
              </p>
            )}
          </div>
          <span className={`hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase sm:inline-flex ${badgeClass}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${badgeDotClass} animate-pulse`} />
            {connectionLabel(connection, language)}
          </span>
        </button>
      </div>

      {accountMenuOpen && user ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-md"
          onMouseDown={() => setAccountMenuOpen(false)}
        >
          <section
            className="w-[min(92vw,34rem)] rounded-2xl border border-white/14 bg-slate-950/88 p-5 text-slate-100 shadow-[0_34px_100px_rgba(2,8,23,0.55)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/70">{profileCopy.title}</p>
                <h2 className="mt-1 text-2xl font-black text-white">{user.username}</h2>
                <p className="text-sm font-semibold text-cyan-100/80">{t(user.role)}</p>
              </div>
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-cyan-100/35 bg-cyan-300/15 text-2xl font-black uppercase text-cyan-50">
                {user.username.slice(0, 1)}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [profileCopy.level, userStats.level],
                [profileCopy.games, userStats.games],
                [profileCopy.wins, userStats.wins],
                [profileCopy.losses, userStats.losses]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100/65">{label}</p>
                  <p className="mt-1 text-2xl font-black text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_1.25fr]">
              <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/70">{profileCopy.userDetails}</p>
                <dl className="mt-3 grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{profileCopy.username}</dt>
                    <dd className="mt-0.5 font-semibold text-white">{user.username}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{profileCopy.role}</dt>
                    <dd className="mt-0.5 font-semibold text-white">{t(user.role)}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs leading-5 text-slate-400">{profileCopy.localStatsNote}</p>
              </section>

              <form onSubmit={onChangePassword} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/70">{profileCopy.changePassword}</p>
                <label className="mt-3 block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{profileCopy.currentPassword}</span>
                  <input
                    type="password"
                    value={accountCurrentPassword}
                    onChange={(event) => setAccountCurrentPassword(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/58 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-100/35 focus:ring-2 focus:ring-cyan-100/10"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{profileCopy.newPassword}</span>
                  <input
                    type="password"
                    value={accountNextPassword}
                    onChange={(event) => setAccountNextPassword(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/58 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-100/35 focus:ring-2 focus:ring-cyan-100/10"
                  />
                </label>
                {accountStatusMessage ? (
                  <p className="mt-3 rounded-lg border border-cyan-100/15 bg-cyan-100/10 px-3 py-2 text-xs text-cyan-50">{accountStatusMessage}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="mt-3 w-full rounded-xl border border-cyan-100/30 bg-cyan-300/14 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/22 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {profileCopy.savePassword}
                </button>
              </form>
            </div>

            <button
              type="button"
              onClick={onLogout}
              disabled={authLoading}
              className="mt-4 w-full rounded-xl border border-rose-200/25 bg-rose-500/12 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("logout")}
            </button>
          </section>
        </div>
      ) : null}

      {soloSetupOpen ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-md"
          onMouseDown={closeSoloSetup}
        >
          <section
            className="w-[min(94vw,42rem)] rounded-2xl border border-white/14 bg-slate-950/88 p-5 text-slate-100 shadow-[0_34px_100px_rgba(2,8,23,0.55)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/70">{labels.soloSetup}</p>
                <h2 className="mt-1 text-2xl font-black text-white">{labels.playSolo}</h2>
              </div>
              <button
                type="button"
                onClick={closeSoloSetup}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10"
              >
                {labels.cancel}
              </button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
              <div className="grid gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/75">{labels.opponents}</span>
                  <select
                    className="w-full rounded-xl border border-white/10 bg-slate-950/58 px-3 py-3 text-sm text-slate-50 outline-none"
                    value={soloBotCount}
                    onChange={(event) => setSoloBotCount(Number(event.target.value))}
                  >
                    {[1, 2, 3].map((value) => (
                      <option key={value} value={value}>{value} {value === 1 ? labels.opponentSingular : labels.opponentPlural}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/75">{labels.difficulty}</span>
                  <select
                    className="w-full rounded-xl border border-white/10 bg-slate-950/58 px-3 py-3 text-sm text-slate-50 outline-none"
                    value={soloDifficulty}
                    onChange={(event) => setSoloDifficulty(event.target.value as "EASY" | "MEDIUM" | "HARD")}
                  >
                    <option value="EASY">{labels.easy}</option>
                    <option value="MEDIUM">{labels.medium}</option>
                    <option value="HARD">{labels.hard}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/75">{labels.targetPoints}</span>
                  <select
                    className="w-full rounded-xl border border-white/10 bg-slate-950/58 px-3 py-3 text-sm text-slate-50 outline-none"
                    value={soloTargetScore}
                    onChange={(event) => setSoloTargetScore(Number(event.target.value))}
                  >
                    <option value={300}>300 {labels.shortRace}</option>
                    <option value={500}>500 {labels.regularRace}</option>
                    <option value={1000}>1000 {labels.longRace}</option>
                    <option value={3000}>3000 {labels.marathon}</option>
                  </select>
                </label>
              </div>

              <section className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/70">{profileCopy.map}</p>
                  <p className="text-sm font-bold text-white">{labels.trackNames[currentTrack.value]}</p>
                </div>
                <div className="relative overflow-hidden rounded-xl border border-white/10 bg-slate-950/38 p-2">
                  <button
                    type="button"
                    aria-label={labels.previousMap}
                    onClick={() => cycleTrackTheme(-1)}
                    className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-slate-950/62 text-xl font-light text-cyan-50 backdrop-blur-xl transition hover:bg-cyan-300/14"
                  >
                    {"<"}
                  </button>
                  <div
                    key={currentTrack.value}
                    className={`h-52 rounded-lg shadow-[inset_0_0_55px_rgba(255,255,255,0.16)] transition-all duration-500 ${currentTrack.previewClass}`}
                  >
                    <div className="flex h-full items-end justify-between p-5">
                      <div className="h-12 w-20 rounded-t-full border-t border-white/35 bg-white/16 backdrop-blur-sm" />
                      <div className="h-20 w-14 rounded-t-full border-t border-white/35 bg-slate-950/18 backdrop-blur-sm" />
                      <div className="h-10 w-24 rounded-t-full border-t border-white/35 bg-white/14 backdrop-blur-sm" />
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={labels.nextMap}
                    onClick={() => cycleTrackTheme(1)}
                    className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/14 bg-slate-950/62 text-xl font-light text-cyan-50 backdrop-blur-xl transition hover:bg-cyan-300/14"
                  >
                    {">"}
                  </button>
                </div>
              </section>
            </div>

            <button
              type="button"
              onClick={startSoloRace}
              disabled={connecting}
              className="mt-5 w-full rounded-xl border border-cyan-100/30 bg-cyan-300/14 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/22 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {labels.startSolo}
            </button>
          </section>
        </div>
      ) : null}

      {joinBoxOpen ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/48 px-4 backdrop-blur-md"
          onPointerDown={() => setJoinBoxOpen(false)}
        >
          <div
            className="pointer-events-auto w-[min(94vw,34rem)] max-h-[82vh] overflow-y-auto rounded-2xl border border-white/12 bg-slate-950/88 p-4 shadow-[0_34px_100px_rgba(2,8,23,0.55)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <form onSubmit={onJoin}>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
                  קוד התחברות
                </span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-50 outline-none transition placeholder:text-slate-300/55 focus:border-cyan-100/35 focus:bg-slate-950/55 focus:ring-2 focus:ring-cyan-100/10"
                  value={roomInput}
                  onChange={(event) => setRoomInput(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setJoinBoxOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
                >
                  {labels.cancel}
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="rounded-xl border border-teal-100/30 bg-teal-400/14 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-teal-50 transition hover:border-teal-100/55 hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {labels.join}
                </button>
              </div>
            </form>

            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/75">{labels.activeClasses}</p>
                <button
                  type="button"
                  onClick={() => {
                    void refreshActiveClassrooms(true);
                  }}
                  aria-label={labels.refreshClasses}
                  title={labels.refreshClasses}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-sm text-slate-100 transition hover:bg-white/10"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                    <path
                      d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a5 5 0 1 1-4.9 6H5.02A7 7 0 1 0 17.65 6.35Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>
              <div className="mt-2 grid gap-1.5">
                {activeLobbyError ? (
                  <p className="rounded-xl bg-amber-300/10 px-3 py-3 text-xs text-amber-100">{activeLobbyError}</p>
                ) : activeLobbies.length === 0 ? (
                  <p className="rounded-xl bg-white/5 px-3 py-3 text-xs text-slate-300">{labels.noActiveClasses}</p>
                ) : activeLobbies.map((room) => {
                  const currentPlayers = room.currentPlayers;
                  const runningJoinable = room.status === "RACING" && room.allowMidGameJoin;
                  const joinable = (room.status === "WAITING" || runningJoinable) && room.isListed && !room.isLocked && !room.deletedAt && !room.closedAt && !room.endedAt && room.currentPlayers < room.maxPlayers;
                  return (
                    <button
                      key={room.id || room.roomCode}
                      type="button"
                      onClick={() => setRoomInput(room.joinCode ?? "")}
                      disabled={!joinable}
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className={`h-2 w-2 rounded-full ${!joinable ? "bg-slate-400" : runningJoinable ? "bg-sky-300" : "bg-emerald-300"}`} />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-100/85">{room.roomCode}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{room.status === "RACING" ? labels.running : labels.waiting}</span>
                      <span className="text-[11px] text-slate-300">{currentPlayers}/{room.maxPlayers}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-auto absolute bottom-8 left-8 z-20 flex w-[min(78vw,15rem)] flex-col gap-3">
        {false && joinBoxOpen ? (
          <div
            className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/48 px-4 backdrop-blur-md"
            onMouseDown={() => setJoinBoxOpen(false)}
          >
          <div
            className="w-[min(94vw,34rem)] max-h-[82vh] overflow-y-auto rounded-2xl border border-white/12 bg-slate-950/88 p-4 shadow-[0_34px_100px_rgba(2,8,23,0.55)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <form onSubmit={onJoin}>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
                  קוד התחברות
                </span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-slate-50 outline-none transition placeholder:text-slate-300/55 focus:border-cyan-100/35 focus:bg-slate-950/55 focus:ring-2 focus:ring-cyan-100/10"
                  value={roomInput}
                  onChange={(event) => setRoomInput(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setJoinBoxOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
                >
                  {labels.cancel}
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="rounded-xl border border-teal-100/30 bg-teal-400/14 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-teal-50 transition hover:border-teal-100/55 hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {labels.join}
                </button>
              </div>
            </form>

            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/75">{labels.activeClasses}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void refreshActiveClassrooms(true);
                  }}
                  aria-label={labels.refreshClasses}
                  title={labels.refreshClasses}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-sm text-slate-100 transition hover:bg-white/10"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                    <path
                      d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a5 5 0 1 1-4.9 6H5.02A7 7 0 1 0 17.65 6.35Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>
              <div className="mt-2 grid gap-1.5">
                {activeLobbyError ? (
                  <p className="rounded-xl bg-amber-300/10 px-3 py-3 text-xs text-amber-100">{activeLobbyError}</p>
                ) : activeLobbies.length === 0 ? (
                  <p className="rounded-xl bg-white/5 px-3 py-3 text-xs text-slate-300">{labels.noActiveClasses}</p>
                ) : activeLobbies.map((room) => {
                  const currentPlayers = room.currentPlayers;
                  const runningJoinable = room.status === "RACING" && room.allowMidGameJoin;
                  const joinable = (room.status === "WAITING" || runningJoinable) && room.isListed && !room.isLocked && !room.deletedAt && !room.closedAt && !room.endedAt && room.currentPlayers < room.maxPlayers;
                  return (
                    <button
                      key={room.id || room.roomCode}
                      type="button"
                      onClick={() => setRoomInput(room.joinCode ?? "")}
                      disabled={!joinable}
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className={`h-2 w-2 rounded-full ${!joinable ? "bg-slate-400" : runningJoinable ? "bg-sky-300" : "bg-emerald-300"}`} />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-100/85">{room.roomCode}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{room.status === "RACING" ? labels.running : labels.waiting}</span>
                      <span className="text-[11px] text-slate-300">{currentPlayers}/{room.maxPlayers}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setJoinBoxOpen((current) => !current)}
          disabled={connecting}
          className="rounded-2xl border border-teal-100/30 bg-slate-950/34 px-5 py-3 text-left text-sm font-bold uppercase tracking-[0.12em] text-teal-50 shadow-[0_18px_46px_rgba(2,8,23,0.3)] backdrop-blur-xl transition hover:border-teal-100/55 hover:bg-teal-400/14 hover:shadow-[0_0_20px_rgba(45,212,191,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {demoMode ? labels.joinLobby : labels.joinRoom}
        </button>
        <button
          type="button"
          onClick={onPlaySolo}
          disabled={connecting}
          className="rounded-2xl border border-cyan-100/25 bg-cyan-100/10 px-5 py-3 text-left text-sm font-bold uppercase tracking-[0.12em] text-cyan-50 shadow-[0_18px_46px_rgba(2,8,23,0.3)] backdrop-blur-xl transition hover:border-cyan-100/50 hover:bg-cyan-100/16 hover:shadow-[0_0_20px_rgba(165,243,252,0.16)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.playSolo}
        </button>
        {connection === "error" && connectionErrorMessage ? (
          <p className="rounded-xl border border-rose-400/45 bg-rose-500/12 px-3 py-2 text-xs text-rose-100 backdrop-blur-xl">
            {connectionErrorMessage}
          </p>
        ) : null}
        {import.meta.env.DEV ? (
          <details className="rounded-2xl border border-white/10 bg-slate-950/56 px-3 py-2 text-[10px] text-slate-300 backdrop-blur-xl">
            <summary className="cursor-pointer font-bold uppercase tracking-[0.12em] text-cyan-100/75">אבחון סנכרון</summary>
            <div className="mt-2 grid gap-1">
              <span>סנכרון תלמיד פעיל: {studentSyncDebug ? "כן" : "לא"}</span>
              <span>sync-room ב-60 שניות אחרונות: {syncDebug?.requestCountsLast60s.syncRoom ?? 0}</span>
              <span>list-active-classroom-rooms ב-60 שניות אחרונות: {syncDebug?.requestCountsLast60s.listActiveClassroomRooms ?? 0}</span>
              <span>דגימת רשימה פעילה: {syncDebug?.activeClassroomList.pollingActive ? "כן" : "לא"}</span>
              <span>בקשת רשימה פעילה באוויר: {syncDebug?.activeClassroomList.inFlight ? "כן" : "לא"}</span>
              <span>רשימה פעילה בתוך חדר: {syncDebug?.activeClassroomList.inClassroomRoom ? "כן" : "לא"}</span>
              <span>Realtime תלמיד תקין: {syncDebug?.studentRealtime.healthy ? "כן" : "לא"}</span>
              <span>גיבוי סנכרון תלמיד פעיל: {syncDebug?.studentRealtime.syncFallbackActive ? "כן" : "לא"}</span>
              <span>רשימה פעילה אחרונה: {syncDebug?.activeClassroomList.lastRefreshAtMs ? new Date(syncDebug.activeClassroomList.lastRefreshAtMs).toLocaleTimeString() : "אף פעם"}</span>
              <span>רשימה פעילה הבאה: {syncDebug?.activeClassroomList.nextRefreshAtMs ? new Date(syncDebug.activeClassroomList.nextRefreshAtMs).toLocaleTimeString() : "אין"}</span>
              <span>טיימרי דגימה פעילים: {syncDebug?.activePollingTimersCount ?? 0}</span>
              <span>מרווח נוכחי: {studentSyncDebug?.intervalMs ?? 0}ms</span>
              <span>סנכרון הבא: {studentSyncDebug?.nextSyncAtMs ? new Date(studentSyncDebug.nextSyncAtMs).toLocaleTimeString() : "אין"}</span>
              <span>חדר: {roomId || "אין"} / {roomRacePhase}</span>
              <span>משתתף: {playerId || "אין"} / {localPlayer?.racePhase ?? "אין"}</span>
              <span>עצירה אחרונה: {syncDebug?.recentStops.find((entry) => entry.role === "student")?.stopReason ?? "אין"}</span>
            </div>
          </details>
        ) : null}
      </div>

        <p className="pointer-events-none absolute bottom-8 left-1/2 z-20 w-[min(86vw,32rem)] -translate-x-1/2 text-center text-xs leading-5 text-slate-100/80 sm:text-sm">
          {labels.joinHint}
        </p>
    </>
  );
}

