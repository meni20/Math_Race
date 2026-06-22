import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { listAdminUsers, type AdminUserSummary } from "../game/network/adminApi";
import { getClassroomRoomService, type ClassroomRoomSummary } from "../game/network/classroomRooms";
import { useLanguage } from "../i18n";
import { useTheme } from "../theme";
import { LanguageToggle } from "./LanguageToggle";
import { TeacherDashboard } from "./teacher/TeacherDashboard";
import { ThemeToggle } from "./ThemeToggle";

type AdminModal = "teacher" | "rooms" | "profile" | null;

type QuickAction = {
  id: string;
  label: string;
  detail: string;
  active: boolean;
  badge: string;
  onClick?: () => void;
};

const COPY = {
  he: {
    title: "MATH RACE ADMIN",
    subtitle: "מרכז ניהול לחדרים, משתמשים והרשאות. פעולות קיימות מחוברות, אזורים עתידיים מסומנים בבירור.",
    signedIn: "מחובר בתור",
    teacherDashboard: "לוח מורה",
    profile: "פרופיל",
    logout: "התנתקות",
    gameScreen: "מסך משחק",
    active: "פעיל",
    soon: "בקרוב",
    notConnected: "לא מחובר עדיין",
    connectedData: "נטען מהמערכת הקיימת",
    requiresEndpoint: "דורש endpoint מתאים",
    quickActions: "פעולות מהירות",
    recentActivity: "פעילות אחרונה",
    noActivity: "אין פעילות להצגה כרגע",
    userManagement: "ניהול משתמשים",
    userManagementBody: "ניהול משתמשים יתווסף לאחר חיבור endpoint מתאים.",
    userManagementEmpty: "אין משתמשים להצגה כרגע",
    loadError: "לא ניתן לטעון חדרים פעילים כרגע.",
    teacherModalTitle: "לוח מורה / ניהול חדרים",
    roomsModalTitle: "חדרים פעילים",
    roomsModalNote: "כרגע מוצגים חדרים פעילים בלבד. חדרים לא פעילים יוצגו לאחר חיבור endpoint מתאים.",
    close: "סגור",
    refresh: "רענון",
    copied: "הועתק",
    noSafeDelete: "לא קיים endpoint בטוח למחיקה מתוך אדמין",
    emptyRooms: "אין חדרים פעילים להצגה כרגע",
    selectedRoom: "פרטי חדר",
    unknownTeacher: "מורה לא ידוע",
    noParticipants: "אין נתוני משתתפים זמינים לחדר זה",
    closeDetails: "סגור פרטים",
    stats: {
      users: "משתמשים",
      students: "תלמידים",
      teachers: "מורים",
      activeRooms: "חדרים פעילים",
      races: "מרוצים"
    },
    statsDetails: {
      usersEndpoint: "ממתין לטעינת משתמשים",
      historyEndpoint: "היסטוריה תתווסף בשלב הבא",
      loadError: "שגיאה בטעינה",
      usersLoadError: "שגיאה בטעינת משתמשים",
      connectedData: "נטען מהמערכת הקיימת"
    },
    actions: {
      teacherDashboard: "לוח מורה / ניהול חדרים",
      createRoom: "יצירת חדר",
      activeRooms: "חדרים פעילים",
      logout: "התנתקות",
      users: "ניהול משתמשים",
      raceHistory: "היסטוריית מרוצים",
      questionBank: "בנק שאלות",
      stats: "סטטיסטיקות",
      permissions: "הרשאות"
    },
    details: {
      teacherDashboard: "פותח לוח מורה בתוך חלון אדמין",
      createRoom: "פותח את יצירת החדר הקיימת במסך המורה",
      activeRooms: "פותח טבלת חדרים פעילים",
      logout: "יציאה מהמשתמש הנוכחי",
      users: "דורש endpoint מתאים",
      raceHistory: "דורש מסך היסטוריה",
      questionBank: "דורש מסך בנק שאלות",
      stats: "דורש endpoint סטטיסטיקות",
      permissions: "דורש מסך הרשאות"
    },
    table: {
      raceName: "שם חדר",
      roomCode: "קוד חדר",
      joinCode: "קוד התחברות",
      status: "סטטוס",
      createdAt: "נוצר",
      teacher: "מורה",
      className: "כיתה",
      map: "מפה",
      difficulty: "רמה",
      players: "משתתפים",
      target: "יעד",
      locked: "נעול",
      listed: "מוצג",
      actions: "פעולות",
      view: "צפייה",
      copyCode: "העתק קוד",
      copyLink: "העתק קישור",
      delete: "מחיקה",
      participantName: "שם",
      playerId: "playerId",
      score: "ניקוד",
      playerStatus: "סטטוס",
      connected: "מחובר",
      yes: "כן",
      no: "לא"
    },
    userTable: {
      username: "שם משתמש",
      role: "תפקיד",
      createdAt: "נוצר",
      lastLoginAt: "כניסה אחרונה"
    },
    profileModal: {
      title: "פרופיל מנהל",
      username: "שם משתמש",
      role: "תפקיד",
      createdAt: "נוצר בתאריך",
      changePassword: "שינוי סיסמה",
      currentPassword: "סיסמה נוכחית",
      nextPassword: "סיסמה חדשה",
      save: "שמירה",
      saved: "הסיסמה עודכנה",
      required: "יש למלא סיסמה נוכחית וסיסמה חדשה באורך 6 תווים לפחות"
    }
  },
  en: {
    title: "MATH RACE ADMIN",
    subtitle: "Management hub for rooms, users, and permissions. Existing actions are connected; future areas are clearly marked.",
    signedIn: "Signed in as",
    teacherDashboard: "Teacher dashboard",
    profile: "Profile",
    logout: "Log out",
    gameScreen: "Game screen",
    active: "Active",
    soon: "Soon",
    notConnected: "Not connected yet",
    connectedData: "Loaded from existing system",
    requiresEndpoint: "Requires endpoint",
    quickActions: "Quick actions",
    recentActivity: "Recent activity",
    noActivity: "No activity to show right now",
    userManagement: "User management",
    userManagementBody: "User management will be added after a suitable admin endpoint is connected.",
    userManagementEmpty: "No users to show right now",
    loadError: "Unable to load active rooms right now.",
    teacherModalTitle: "Teacher dashboard / room management",
    roomsModalTitle: "Active rooms",
    roomsModalNote: "Only active rooms are available through the existing endpoint. Inactive rooms need a suitable endpoint.",
    close: "Close",
    refresh: "Refresh",
    copied: "Copied",
    noSafeDelete: "No safe admin delete endpoint is connected",
    emptyRooms: "No active rooms to show right now",
    selectedRoom: "Room details",
    unknownTeacher: "Unknown teacher",
    noParticipants: "No participant data is available for this room",
    closeDetails: "Close details",
    stats: {
      users: "Users",
      students: "Students",
      teachers: "Teachers",
      activeRooms: "Active rooms",
      races: "Races"
    },
    statsDetails: {
      usersEndpoint: "Waiting for user data",
      historyEndpoint: "History will be added next",
      loadError: "Loading error",
      usersLoadError: "User loading error",
      connectedData: "Loaded from existing system"
    },
    actions: {
      teacherDashboard: "Teacher dashboard / rooms",
      createRoom: "Create room",
      activeRooms: "Active rooms",
      logout: "Log out",
      users: "Manage users",
      raceHistory: "Race history",
      questionBank: "Question bank",
      stats: "Statistics",
      permissions: "Permissions"
    },
    details: {
      teacherDashboard: "Opens teacher dashboard inside admin",
      createRoom: "Opens the existing teacher room creation flow",
      activeRooms: "Opens an active rooms table",
      logout: "Sign out of this account",
      users: "Requires endpoint",
      raceHistory: "Requires history screen",
      questionBank: "Requires question bank screen",
      stats: "Requires statistics endpoint",
      permissions: "Requires permissions screen"
    },
    table: {
      raceName: "Room name",
      roomCode: "Room code",
      joinCode: "Join code",
      status: "Status",
      createdAt: "Created",
      teacher: "Teacher",
      className: "Class",
      map: "Map",
      difficulty: "Difficulty",
      players: "Players",
      target: "Target",
      locked: "Locked",
      listed: "Listed",
      actions: "Actions",
      view: "View",
      copyCode: "Copy code",
      copyLink: "Copy link",
      delete: "Delete",
      participantName: "Name",
      playerId: "playerId",
      score: "Score",
      playerStatus: "Status",
      connected: "Connected",
      yes: "Yes",
      no: "No"
    },
    userTable: {
      username: "Username",
      role: "Role",
      createdAt: "Created",
      lastLoginAt: "Last login"
    },
    profileModal: {
      title: "Admin profile",
      username: "Username",
      role: "Role",
      createdAt: "Created at",
      changePassword: "Change password",
      currentPassword: "Current password",
      nextPassword: "New password",
      save: "Save",
      saved: "Password updated",
      required: "Enter current password and a new password with at least 6 characters"
    }
  }
} as const;

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildJoinLink(room: ClassroomRoomSummary) {
  const roomParam = encodeURIComponent(room.joinCode || room.roomCode);
  return `${window.location.origin}/?room=${roomParam}`;
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function cleanDisplayString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || isUuidLike(trimmed)) {
    return "";
  }
  return trimmed;
}

function readNestedDisplayName(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return cleanDisplayString(record.name)
    || cleanDisplayString(record.username)
    || cleanDisplayString(record.email)
    || cleanDisplayString(record.displayName);
}

function getTeacherDisplayName(room: ClassroomRoomSummary, unknownTeacher: string) {
  const record = room as ClassroomRoomSummary & Record<string, unknown>;
  const directName = cleanDisplayString(record.teacherName)
    || cleanDisplayString(record.teacherUsername)
    || cleanDisplayString(record.teacherEmail)
    || cleanDisplayString(record.createdByName)
    || cleanDisplayString(record.createdByUsername)
    || cleanDisplayString(record.createdByEmail)
    || readNestedDisplayName(record.teacher)
    || readNestedDisplayName(record.createdBy);

  return directName || unknownTeacher;
}

interface RoomParticipantView {
  name: string;
  playerId: string;
  score: string | number;
  status: string;
  connected: boolean | null;
}

interface AdminStatsUser {
  role?: string | null;
}

function isAdminActiveRoom(room: ClassroomRoomSummary) {
  return ["CREATED", "DRAFT", "WAITING", "LOBBY", "RACING", "ACTIVE"].includes(String(room.status).toUpperCase());
}

function isAdminFinishedRace(room: ClassroomRoomSummary) {
  return ["FINISHED", "CLOSED"].includes(String(room.status).toUpperCase());
}

function isRole(user: AdminStatsUser, roles: string[]) {
  const role = String(user.role ?? "").trim().toLowerCase();
  return roles.includes(role);
}

function getAdminStats({ rooms, users }: { rooms: ClassroomRoomSummary[]; users?: AdminStatsUser[] | null }) {
  const hasUsers = Array.isArray(users);
  return {
    users: hasUsers ? users.length : 0,
    students: hasUsers ? users.filter((user) => isRole(user, ["student", "תלמיד"])).length : 0,
    teachers: hasUsers ? users.filter((user) => isRole(user, ["teacher", "מורה"])).length : 0,
    activeRooms: rooms.filter(isAdminActiveRoom).length,
    finishedRaces: rooms.filter(isAdminFinishedRace).length,
    hasUsers,
    hasFinishedRaceSource: rooms.some(isAdminFinishedRace)
  };
}

function getRoomParticipants(room: ClassroomRoomSummary): RoomParticipantView[] {
  const record = room as ClassroomRoomSummary & Record<string, unknown>;
  const rawParticipants = record.players ?? record.participants ?? record.studentPlayers ?? record.roster;
  if (!Array.isArray(rawParticipants)) {
    return [];
  }
  return rawParticipants.flatMap((participant): RoomParticipantView[] => {
    if (!participant || typeof participant !== "object") {
      return [];
    }
    const item = participant as Record<string, unknown>;
    return [{
      name: cleanDisplayString(item.name) || cleanDisplayString(item.username) || "-",
      playerId: cleanDisplayString(item.playerId) || cleanDisplayString(item.id) || "-",
      score: typeof item.score === "number" || typeof item.score === "string" ? item.score : "-",
      status: cleanDisplayString(item.status) || "-",
      connected: typeof item.connected === "boolean" ? item.connected : null
    }];
  });
}

function StatCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <article className="rounded-lg border border-cyan-100/15 bg-white/[0.055] px-4 py-4 shadow-[0_18px_50px_rgba(2,8,23,0.22)] backdrop-blur-xl">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/72">{label}</p>
      <p className="mt-2 text-3xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-300">{detail}</p>
    </article>
  );
}

function QuickActionButton({ action }: { action: QuickAction }) {
  const baseClass = "min-h-[5.5rem] rounded-lg border px-4 py-3 text-start transition";
  if (!action.active) {
    return (
      <button type="button" disabled className={`${baseClass} cursor-not-allowed border-white/10 bg-slate-950/32 opacity-65`} title={action.detail}>
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-black text-white">{action.label}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-300">{action.badge}</span>
        </span>
        <span className="mt-2 block text-xs font-semibold text-slate-300">{action.detail}</span>
      </button>
    );
  }

  return (
    <button type="button" onClick={action.onClick} className={`${baseClass} border-cyan-100/25 bg-cyan-300/10 hover:border-cyan-100/55 hover:bg-cyan-300/18`}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-black text-white">{action.label}</span>
        <span className="rounded-full border border-emerald-200/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-emerald-100">{action.badge}</span>
      </span>
      <span className="mt-2 block text-xs font-semibold text-cyan-100/78">{action.detail}</span>
    </button>
  );
}

export function AdminDashboardHome() {
  const { user, logout, loading, changePassword } = useAuth();
  const { language, t } = useLanguage();
  const { theme } = useTheme();
  const [activeRooms, setActiveRooms] = useState<ClassroomRoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomError, setRoomError] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminUserTotal, setAdminUserTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [modal, setModal] = useState<AdminModal>(null);
  const [selectedRoomCode, setSelectedRoomCode] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const copy = COPY[language];
  const lightUiClass = theme === "light" ? "theme-light-ui" : "";

  const refreshRooms = useCallback(() => {
    setRoomsLoading(true);
    setRoomError("");
    void getClassroomRoomService().listActiveRooms()
      .then((rooms) => {
        setActiveRooms(rooms);
        setSelectedRoomCode((current) => (
          current && rooms.some((room) => room.roomCode === current) ? current : ""
        ));
      })
      .catch(() => {
        setRoomError(COPY[language].loadError);
        setActiveRooms([]);
      })
      .finally(() => setRoomsLoading(false));
  }, [language]);

  useEffect(() => {
    refreshRooms();
  }, [refreshRooms]);

  useEffect(() => {
    if (user?.role !== "admin") {
      setAdminUsers([]);
      setAdminUserTotal(0);
      setUsersError("");
      setUsersLoading(false);
      return;
    }

    let disposed = false;
    setUsersLoading(true);
    setUsersError("");
    void listAdminUsers({ limit: 100, offset: 0 })
      .then((result) => {
        if (!disposed) {
          setAdminUsers(result.users);
          setAdminUserTotal(result.total);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setAdminUsers([]);
          setAdminUserTotal(0);
          setUsersError(error instanceof Error ? error.message : COPY[language].statsDetails.usersLoadError);
        }
      })
      .finally(() => {
        if (!disposed) {
          setUsersLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [language, user?.role]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const adminStats = useMemo(() => getAdminStats({ rooms: activeRooms, users: adminUsers }), [activeRooms, adminUsers]);
  const displayUserTotal = adminUserTotal || adminStats.users;

  const selectedRoom = useMemo(
    () => activeRooms.find((room) => room.roomCode === selectedRoomCode) ?? null,
    [activeRooms, selectedRoomCode]
  );
  const selectedRoomParticipants = useMemo(
    () => (selectedRoom ? getRoomParticipants(selectedRoom) : []),
    [selectedRoom]
  );

  const recentActivity = useMemo(() => activeRooms.slice(0, 4).map((room) => ({
    title: room.raceName || room.roomCode,
    detail: `${room.roomCode} · ${room.status} · ${room.currentPlayers}/${room.maxPlayers}`
  })), [activeRooms]);

  const onLogout = () => {
    void logout().then(() => navigate("/login"));
  };

  const copyText = (value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopyMessage(copy.copied);
    window.setTimeout(() => setCopyMessage(""), 1400);
  };

  const openRoomsModal = () => {
    refreshRooms();
    setModal("rooms");
  };

  const onChangePassword = (event: FormEvent) => {
    event.preventDefault();
    setProfileMessage("");
    if (!currentPassword || nextPassword.length < 6) {
      setProfileMessage(copy.profileModal.required);
      return;
    }
    void changePassword(currentPassword, nextPassword)
      .then(() => {
        setCurrentPassword("");
        setNextPassword("");
        setProfileMessage(copy.profileModal.saved);
      })
      .catch((error) => {
        setProfileMessage(error instanceof Error ? error.message : copy.profileModal.required);
      });
  };

  const quickActions: QuickAction[] = [
    {
      id: "teacher-dashboard",
      label: copy.actions.teacherDashboard,
      detail: copy.details.teacherDashboard,
      active: true,
      badge: copy.active,
      onClick: () => setModal("teacher")
    },
    {
      id: "create-room",
      label: copy.actions.createRoom,
      detail: copy.details.createRoom,
      active: true,
      badge: copy.active,
      onClick: () => navigate("/teacher")
    },
    {
      id: "active-rooms",
      label: copy.actions.activeRooms,
      detail: copy.details.activeRooms,
      active: true,
      badge: copy.active,
      onClick: openRoomsModal
    },
    {
      id: "logout",
      label: copy.actions.logout,
      detail: copy.details.logout,
      active: true,
      badge: copy.active,
      onClick: onLogout
    },
    { id: "users", label: copy.actions.users, detail: copy.details.users, active: false, badge: copy.soon },
    { id: "race-history", label: copy.actions.raceHistory, detail: copy.details.raceHistory, active: false, badge: copy.soon },
    { id: "question-bank", label: copy.actions.questionBank, detail: copy.details.questionBank, active: false, badge: copy.soon },
    { id: "stats", label: copy.actions.stats, detail: copy.details.stats, active: false, badge: copy.soon },
    { id: "permissions", label: copy.actions.permissions, detail: copy.details.permissions, active: false, badge: copy.soon }
  ];

  return (
    <section className={`pointer-events-auto absolute inset-0 z-40 overflow-y-auto bg-slate-950 text-slate-100 ${lightUiClass}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(34,211,238,0.14),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(168,85,247,0.12),transparent_24%),linear-gradient(145deg,#071a38_0%,#0b1024_48%,#020617_100%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[96rem] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-lg border border-white/10 bg-white/[0.055] px-4 py-4 shadow-[0_18px_50px_rgba(2,8,23,0.24)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/72">{copy.title}</p>
              <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.12em] text-white sm:text-4xl">{copy.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{copy.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => setModal("teacher")} className="rounded-full border border-cyan-100/25 bg-cyan-300/12 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/20">
                {copy.teacherDashboard}
              </button>
              <button type="button" onClick={() => setModal("profile")} className="rounded-full border border-white/15 bg-slate-950/45 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-slate-50 transition hover:border-cyan-100/35 hover:bg-cyan-300/10">
                {copy.profile}
              </button>
              <button type="button" onClick={() => navigate("/?adminGame=1")} className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/10">
                {copy.gameScreen}
              </button>
              <LanguageToggle />
              <ThemeToggle />
              <button type="button" onClick={onLogout} disabled={loading} className="rounded-full border border-rose-200/25 bg-rose-500/12 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60">
                {copy.logout}
              </button>
            </div>
          </div>
          <div className="mt-4 inline-flex rounded-full border border-cyan-100/15 bg-slate-950/34 px-4 py-2 text-sm">
            <span className="text-cyan-100/70">{copy.signedIn}</span>
            <span className="mx-2 text-white">·</span>
            <span className="font-black text-white">{user?.username ?? "-"} · {t("admin")}</span>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label={copy.stats.users} value={usersLoading ? "..." : usersError ? 0 : displayUserTotal} detail={usersError ? copy.statsDetails.usersLoadError : adminStats.hasUsers ? copy.statsDetails.connectedData : copy.statsDetails.usersEndpoint} />
          <StatCard label={copy.stats.students} value={usersLoading ? "..." : usersError ? 0 : adminStats.students} detail={usersError ? copy.statsDetails.usersLoadError : adminStats.hasUsers ? copy.statsDetails.connectedData : copy.statsDetails.usersEndpoint} />
          <StatCard label={copy.stats.teachers} value={usersLoading ? "..." : usersError ? 0 : adminStats.teachers} detail={usersError ? copy.statsDetails.usersLoadError : adminStats.hasUsers ? copy.statsDetails.connectedData : copy.statsDetails.usersEndpoint} />
          <StatCard label={copy.stats.activeRooms} value={roomsLoading ? "..." : roomError ? 0 : adminStats.activeRooms} detail={roomError ? copy.statsDetails.loadError : copy.statsDetails.connectedData} />
          <StatCard label={copy.stats.races} value={adminStats.finishedRaces} detail={adminStats.hasFinishedRaceSource ? copy.statsDetails.connectedData : copy.statsDetails.historyEndpoint} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
          <article className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.24)] backdrop-blur-xl">
            <h2 className="text-xl font-black text-white">{copy.quickActions}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {quickActions.map((action) => <QuickActionButton key={action.id} action={action} />)}
            </div>
          </article>

          <article className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.24)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white">{copy.recentActivity}</h2>
              <button type="button" onClick={refreshRooms} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10">
                {copy.refresh}
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              {recentActivity.length > 0 ? recentActivity.map((item, index) => (
                <div key={`${item.title}-${index}`} className="rounded-lg border border-white/10 bg-slate-950/36 px-3 py-3">
                  <p className="font-black text-white">{item.title}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">{item.detail}</p>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-cyan-100/20 bg-slate-950/28 px-4 py-8 text-center">
                  <p className="text-sm font-bold text-slate-300">{copy.noActivity}</p>
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.24)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-white">{copy.userManagement}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-300">
                {usersError ? copy.statsDetails.usersLoadError : copy.statsDetails.connectedData}
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-slate-950/38 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-100">
              {usersLoading ? "..." : usersError ? copy.statsDetails.usersLoadError : `${adminUsers.length} ${copy.stats.users}`}
            </span>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
            {usersLoading ? (
              <div className="px-4 py-8 text-center text-sm font-bold text-slate-300">...</div>
            ) : usersError ? (
              <div className="px-4 py-8 text-center text-sm font-bold text-amber-100">{copy.statsDetails.usersLoadError}</div>
            ) : adminUsers.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm font-bold text-slate-300">{copy.userManagementEmpty}</div>
            ) : (
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="bg-slate-950/80 text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">
                  <tr>
                    <th className="px-3 py-3 text-start">{copy.userTable.username}</th>
                    <th className="px-3 py-3 text-start">{copy.userTable.role}</th>
                    <th className="px-3 py-3 text-start">{copy.userTable.createdAt}</th>
                    <th className="px-3 py-3 text-start">{copy.userTable.lastLoginAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((adminUser) => (
                    <tr key={adminUser.id} className="border-t border-white/10 bg-white/[0.025]">
                      <td className="px-3 py-3 font-bold text-white">{adminUser.username}</td>
                      <td className="px-3 py-3 text-slate-300">{adminUser.role}</td>
                      <td className="px-3 py-3 text-slate-300">{formatDate(adminUser.createdAt)}</td>
                      <td className="px-3 py-3 text-slate-300">{formatDate(adminUser.lastLoginAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {modal === "teacher" ? (
        <AdminModalShell title={copy.teacherModalTitle} closeLabel={copy.close} onClose={() => setModal(null)} wide>
          <TeacherDashboard embedded suppressInitialCreate onRequestClose={() => setModal(null)} />
        </AdminModalShell>
      ) : null}

      {modal === "rooms" ? (
        <AdminModalShell title={copy.roomsModalTitle} closeLabel={copy.close} onClose={() => setModal(null)} wide>
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-300">{copy.roomsModalNote}</p>
              <div className="flex items-center gap-2">
                {copyMessage ? <span className="text-xs font-black uppercase tracking-[0.12em] text-emerald-100">{copyMessage}</span> : null}
                <button type="button" onClick={refreshRooms} disabled={roomsLoading} className="rounded-full border border-cyan-100/25 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-60">
                  {roomsLoading ? "..." : copy.refresh}
                </button>
              </div>
            </div>
            {selectedRoom ? (
              <section className="mb-4 rounded-lg border border-cyan-100/20 bg-cyan-300/[0.07] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.24)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/70">{copy.selectedRoom}</p>
                    <h3 className="mt-1 text-2xl font-black text-white">{selectedRoom.raceName || selectedRoom.roomCode}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-300">{selectedRoom.roomCode} · {selectedRoom.status}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => copyText(selectedRoom.joinCode || selectedRoom.roomCode)} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10">{copy.table.copyCode}</button>
                    <button type="button" onClick={() => copyText(buildJoinLink(selectedRoom))} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10">{copy.table.copyLink}</button>
                    <button type="button" disabled title={copy.noSafeDelete} className="cursor-not-allowed rounded-md border border-rose-200/15 bg-rose-500/8 px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-rose-100/55">{copy.table.delete}</button>
                    <button type="button" onClick={() => setSelectedRoomCode("")} className="rounded-md border border-cyan-100/25 bg-cyan-300/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-cyan-50 transition hover:bg-cyan-300/18">{copy.closeDetails}</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailField label={copy.table.raceName} value={selectedRoom.raceName || "-"} />
                  <DetailField label={copy.table.roomCode} value={selectedRoom.roomCode} />
                  <DetailField label={copy.table.joinCode} value={selectedRoom.joinCode || "-"} />
                  <DetailField label={copy.table.status} value={selectedRoom.status} />
                  <DetailField label={copy.table.createdAt} value={formatDate(selectedRoom.createdAt)} />
                  <DetailField label={copy.table.teacher} value={getTeacherDisplayName(selectedRoom, copy.unknownTeacher)} />
                  <DetailField label={copy.table.className} value={selectedRoom.className || "-"} />
                  <DetailField label={copy.table.map} value={selectedRoom.mapId || "-"} />
                  <DetailField label={copy.table.difficulty} value={selectedRoom.difficulty || "-"} />
                  <DetailField label={copy.table.target} value={selectedRoom.targetScore} />
                  <DetailField label={copy.table.players} value={`${selectedRoom.currentPlayers}/${selectedRoom.maxPlayers}`} />
                  <DetailField label={copy.table.locked} value={selectedRoom.isLocked ? copy.table.yes : copy.table.no} />
                  <DetailField label={copy.table.listed} value={selectedRoom.isListed ? copy.table.yes : copy.table.no} />
                </div>
                <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/30 p-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100/70">{copy.table.players}</p>
                  {selectedRoomParticipants.length > 0 ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[40rem] text-sm">
                        <thead className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
                          <tr>
                            <th className="px-2 py-2 text-start">{copy.table.participantName}</th>
                            <th className="px-2 py-2 text-start">{copy.table.playerId}</th>
                            <th className="px-2 py-2 text-start">{copy.table.score}</th>
                            <th className="px-2 py-2 text-start">{copy.table.playerStatus}</th>
                            <th className="px-2 py-2 text-start">{copy.table.connected}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRoomParticipants.map((participant) => (
                            <tr key={`${participant.playerId}-${participant.name}`} className="border-t border-white/10">
                              <td className="px-2 py-2 font-bold text-white">{participant.name}</td>
                              <td className="px-2 py-2 font-mono text-slate-300">{participant.playerId}</td>
                              <td className="px-2 py-2 text-slate-300">{participant.score}</td>
                              <td className="px-2 py-2 text-slate-300">{participant.status}</td>
                              <td className="px-2 py-2 text-slate-300">{participant.connected === null ? "-" : participant.connected ? copy.table.yes : copy.table.no}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 rounded-lg border border-dashed border-cyan-100/15 bg-slate-950/28 px-3 py-4 text-sm font-semibold text-slate-300">{copy.noParticipants}</p>
                  )}
                </div>
              </section>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10">
              {activeRooms.length === 0 ? (
                <div className="flex min-h-64 items-center justify-center px-4 py-10 text-center text-sm font-bold text-slate-300">{roomError || copy.emptyRooms}</div>
              ) : (
                <table className="min-w-[86rem] w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-950/95 text-[11px] uppercase tracking-[0.12em] text-cyan-100/75">
                    <tr>
                      <th className="px-3 py-3 text-start">{copy.table.raceName}</th>
                      <th className="px-3 py-3 text-start">{copy.table.roomCode}</th>
                      <th className="px-3 py-3 text-start">{copy.table.joinCode}</th>
                      <th className="px-3 py-3 text-start">{copy.table.status}</th>
                      <th className="px-3 py-3 text-start">{copy.table.createdAt}</th>
                      <th className="px-3 py-3 text-start">{copy.table.teacher}</th>
                      <th className="px-3 py-3 text-start">{copy.table.className}</th>
                      <th className="px-3 py-3 text-start">{copy.table.map}</th>
                      <th className="px-3 py-3 text-start">{copy.table.difficulty}</th>
                      <th className="px-3 py-3 text-start">{copy.table.players}</th>
                      <th className="px-3 py-3 text-start">{copy.table.target}</th>
                      <th className="px-3 py-3 text-start">{copy.table.locked}</th>
                      <th className="px-3 py-3 text-start">{copy.table.listed}</th>
                      <th className="px-3 py-3 text-start">{copy.table.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRooms.map((room) => (
                      <tr key={room.id || room.roomCode} className={`border-t border-white/10 align-top hover:bg-cyan-300/[0.055] ${room.roomCode === selectedRoomCode ? "bg-cyan-300/[0.085]" : "bg-white/[0.025]"}`}>
                        <td className="px-3 py-3 font-bold text-white">{room.raceName || "-"}</td>
                        <td className="px-3 py-3 font-mono text-cyan-50">{room.roomCode}</td>
                        <td className="px-3 py-3 font-mono text-cyan-50">{room.joinCode || "-"}</td>
                        <td className="px-3 py-3"><span className="rounded-full border border-cyan-100/20 bg-cyan-300/10 px-2 py-1 text-[11px] font-black text-cyan-100">{room.status}</span></td>
                        <td className="px-3 py-3 text-slate-300">{formatDate(room.createdAt)}</td>
                        <td className="px-3 py-3 text-slate-300">{getTeacherDisplayName(room, copy.unknownTeacher)}</td>
                        <td className="px-3 py-3 text-slate-300">{room.className || "-"}</td>
                        <td className="px-3 py-3 text-slate-300">{room.mapId || "-"}</td>
                        <td className="px-3 py-3 text-slate-300">{room.difficulty || "-"}</td>
                        <td className="px-3 py-3 text-slate-300">{room.currentPlayers}/{room.maxPlayers}</td>
                        <td className="px-3 py-3 text-slate-300">{room.targetScore}</td>
                        <td className="px-3 py-3 text-slate-300">{room.isLocked ? copy.table.yes : copy.table.no}</td>
                        <td className="px-3 py-3 text-slate-300">{room.isListed ? copy.table.yes : copy.table.no}</td>
                        <td className="px-3 py-3">
                          <div className="flex min-w-72 flex-wrap gap-2">
                            <button type="button" onClick={() => { setSelectedRoomCode(room.roomCode); setCopyMessage(""); }} className="rounded-md border border-cyan-100/25 bg-cyan-300/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-cyan-50 transition hover:bg-cyan-300/18">{copy.table.view}</button>
                            <button type="button" onClick={() => copyText(room.joinCode || room.roomCode)} className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10">{copy.table.copyCode}</button>
                            <button type="button" onClick={() => copyText(buildJoinLink(room))} className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10">{copy.table.copyLink}</button>
                            <button type="button" disabled title={copy.noSafeDelete} className="cursor-not-allowed rounded-md border border-rose-200/15 bg-rose-500/8 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-rose-100/55">{copy.table.delete}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </AdminModalShell>
      ) : null}

      {modal === "profile" ? (
        <AdminModalShell title={copy.profileModal.title} closeLabel={copy.close} onClose={() => setModal(null)}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-white">{user?.username ?? "-"}</h2>
              <p className="text-sm font-semibold text-cyan-100/80">{t("admin")}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 sm:grid-cols-3">
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100/65">{copy.profileModal.username}</dt>
              <dd className="mt-1 font-bold text-white">{user?.username ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100/65">{copy.profileModal.role}</dt>
              <dd className="mt-1 font-bold text-white">{t("admin")}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100/65">{copy.profileModal.createdAt}</dt>
              <dd className="mt-1 font-bold text-white">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}</dd>
            </div>
          </dl>
          <form onSubmit={onChangePassword} className="mt-5">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/70">{copy.profileModal.changePassword}</p>
            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{copy.profileModal.currentPassword}</span>
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40" />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{copy.profileModal.nextPassword}</span>
              <input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-100/40" />
            </label>
            {profileMessage ? <p className="mt-3 rounded-lg border border-cyan-100/15 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-50">{profileMessage}</p> : null}
            <button type="submit" disabled={loading} className="mt-4 w-full rounded-lg border border-cyan-100/35 bg-cyan-300/14 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/22 disabled:cursor-not-allowed disabled:opacity-60">
              {copy.profileModal.save}
            </button>
          </form>
        </AdminModalShell>
      ) : null}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100/62">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function AdminModalShell({
  title,
  closeLabel,
  onClose,
  wide = false,
  children
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/64 px-4 py-6 backdrop-blur-md" onMouseDown={onClose}>
      <section
        className={`${wide ? "h-[min(86vh,56rem)] w-[min(96vw,86rem)]" : "max-h-[88vh] w-[min(92vw,34rem)]"} overflow-hidden rounded-lg border border-white/14 bg-slate-950/94 p-4 shadow-[0_34px_100px_rgba(2,8,23,0.55)]`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <h2 className="text-xl font-black text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-100 transition hover:bg-white/10">
            X · {closeLabel}
          </button>
        </div>
        <div className="h-[calc(100%-4rem)] min-h-0 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
