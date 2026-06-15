import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLanguage = "he" | "en";

const STORAGE_KEY = "mathRace.language";

const STRINGS = {
  he: {
    languageToggle: "English",
    account: "משתמש",
    accountOpen: "פתח משתמש",
    accountClose: "סגור",
    login: "כניסה",
    register: "יצירת משתמש",
    logout: "יציאה",
    loading: "טוען...",
    gameTitle: "מרוץ מתמטיקה",
    loginTitle: "כניסה למרוץ",
    loginSubtitle: "התחברו כדי לשחק, להצטרף לכיתה או לנהל חדרים לפי התפקיד שלכם.",
    createUserTitle: "יצירת משתמש",
    createUserSubtitle: "צרו משתמש חדש ובחרו תפקיד. הסיסמה נשמרת כ-hash בלבד.",
    back: "חזרה",
    permissionDenied: "אין הרשאה",
    permissionDeniedBody: "רק מורה או מנהל יכולים להיכנס ללוח המורה.",
    goHome: "מסך ראשי",
    cannotConnectServer: "לא ניתן להתחבר לשרת. ודאו שה־Supabase Functions פרוסות ושהגדרות הסביבה תקינות.",
    username: "שם משתמש",
    password: "סיסמה",
    role: "תפקיד",
    teacher: "מורה",
    student: "תלמיד",
    admin: "מנהל",
    signedInAs: "מחובר בתור",
    notSignedIn: "לא מחובר",
    authUnavailable: "Supabase לא מוגדר, לכן משתמשים זמינים רק אחרי חיבור לדאטה-בייס.",
    usernameRequired: "שם משתמש לא יכול להיות ריק.",
    passwordRequired: "הסיסמה חייבת להיות באורך 6 תווים לפחות.",
    roleRequired: "יש לבחור תפקיד תקין.",
    authGenericError: "לא ניתן להשלים את הפעולה.",
    mathBoost: "בוסט מתמטי",
    highwayChallenge: "אתגר כביש מהיר",
    correct: "נכון!",
    timeout: "נגמר הזמן",
    wrong: "לא נכון",
    rooms: "חדרים",
    refreshing: "מרענן...",
    savedRooms: "שמורים",
    newRoom: "חדר חדש",
    close: "סגור",
    activeRooms: "חדרים פעילים",
    runningRooms: "חדרים רצים",
    previousRooms: "חדרים קודמים",
    noRooms: "אין חדרים",
    students: "תלמידים",
    delete: "מחק",
    deleteRoomConfirm: "האם למחוק את החדר הזה?",
    deleteRoomFailed: "לא ניתן למחוק חדר.",
    draft: "טיוטה",
    created: "נוצר",
    waiting: "ממתין",
    racing: "במרוץ",
    finished: "הסתיים",
    closed: "נסגר",
    deleted: "נמחק"
  },
  en: {
    languageToggle: "עברית",
    account: "Account",
    accountOpen: "Open account",
    accountClose: "Close",
    login: "Log in",
    register: "Create user",
    logout: "Log out",
    loading: "Loading...",
    gameTitle: "Math Race",
    loginTitle: "Race login",
    loginSubtitle: "Sign in to play, join a classroom, or manage rooms based on your role.",
    createUserTitle: "Create user",
    createUserSubtitle: "Create a new user and choose a role. Passwords are stored as hashes only.",
    back: "Back",
    permissionDenied: "No permission",
    permissionDeniedBody: "Only a teacher or admin can open the teacher dashboard.",
    goHome: "Main screen",
    cannotConnectServer: "Cannot connect to server. Make sure the Supabase Functions are deployed and the environment is configured.",
    username: "Username",
    password: "Password",
    role: "Role",
    teacher: "Teacher",
    student: "Student",
    admin: "Admin",
    signedInAs: "Signed in as",
    notSignedIn: "Not signed in",
    authUnavailable: "Supabase is not configured, so users are available only after connecting the database.",
    usernameRequired: "Username cannot be empty.",
    passwordRequired: "Password must be at least 6 characters.",
    roleRequired: "Choose a valid role.",
    authGenericError: "Could not complete the action.",
    mathBoost: "Math boost",
    highwayChallenge: "Highway challenge",
    correct: "Correct!",
    timeout: "Time is up",
    wrong: "Not correct",
    rooms: "Rooms",
    refreshing: "Refreshing...",
    savedRooms: "saved",
    newRoom: "New room",
    close: "Close",
    activeRooms: "Active rooms",
    runningRooms: "Running rooms",
    previousRooms: "Previous rooms",
    noRooms: "No rooms",
    students: "students",
    delete: "Delete",
    deleteRoomConfirm: "Are you sure you want to delete this room?",
    deleteRoomFailed: "Unable to delete room.",
    draft: "Draft",
    created: "Created",
    waiting: "Waiting",
    racing: "Racing",
    finished: "Finished",
    closed: "Closed",
    deleted: "Deleted"
  }
} as const;

type TranslationKey = keyof typeof STRINGS.he;

interface LanguageContextValue {
  language: AppLanguage;
  direction: "rtl" | "ltr";
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "he";
  }
  return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "he";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(readInitialLanguage);

  const setLanguage = (nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    }
  };

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "he" ? "rtl" : "ltr";
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    direction: language === "he" ? "rtl" : "ltr",
    setLanguage,
    toggleLanguage: () => setLanguage(language === "he" ? "en" : "he"),
    t: (key) => STRINGS[language][key] ?? STRINGS.he[key]
  }), [language]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider.");
  }
  return context;
}
