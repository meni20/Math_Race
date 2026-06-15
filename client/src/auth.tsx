import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createUser, getCurrentUser, loginUser, logoutUser, type AuthUser, type UserRole } from "./game/network/authClient";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string;
  canAccessTeacher: boolean;
  login: (username: string, password: string) => Promise<AuthUser | null>;
  register: (username: string, password: string, role: UserRole) => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshUser = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextUser = await getCurrentUser();
      setUser(nextUser);
      return nextUser;
    } catch (currentError) {
      const message = currentError instanceof Error ? currentError.message : "Cannot load current user.";
      setError(message);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const nextUser = await loginUser(username, password);
      setUser(nextUser);
      return nextUser;
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Cannot log in.";
      setError(message);
      throw loginError;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (username: string, password: string, role: UserRole) => {
    setLoading(true);
    setError("");
    try {
      const nextUser = await createUser(username, password, role);
      setUser(nextUser);
      return nextUser;
    } catch (registerError) {
      const message = registerError instanceof Error ? registerError.message : "Cannot create user.";
      setError(message);
      throw registerError;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await logoutUser();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    error,
    canAccessTeacher: user?.role === "teacher" || user?.role === "admin",
    login,
    register,
    logout,
    refreshUser,
    clearError: () => setError("")
  }), [error, loading, login, logout, refreshUser, register, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
