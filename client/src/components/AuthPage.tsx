import { FormEvent, useMemo, useState } from "react";
import { useAuth } from "../auth";
import type { UserRole } from "../game/network/authClient";
import { useLanguage } from "../i18n";

const ROLES: UserRole[] = ["student", "teacher", "admin"];

function navigateHome() {
  window.history.pushState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function AuthPage() {
  const { t } = useLanguage();
  const { login, register, loading, error, clearError } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("student");
  const [localMessage, setLocalMessage] = useState("");

  const title = mode === "login" ? t("loginTitle") : t("createUserTitle");
  const subtitle = mode === "login" ? t("loginSubtitle") : t("createUserSubtitle");
  const message = localMessage || error;
  const canSubmit = useMemo(() => username.trim().length > 0 && password.length >= 6, [password.length, username]);

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setLocalMessage("");
    clearError();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalMessage("");
    clearError();
    if (!username.trim()) {
      setLocalMessage(t("usernameRequired"));
      return;
    }
    if (password.length < 6) {
      setLocalMessage(t("passwordRequired"));
      return;
    }
    const action = mode === "login"
      ? login(username, password)
      : register(username, password, role);
    void action
      .then((nextUser) => {
        if (nextUser) {
          navigateHome();
        }
      })
      .catch((submitError) => {
        setLocalMessage(submitError instanceof Error ? submitError.message : t("authGenericError"));
      });
  };

  return (
    <section className="pointer-events-auto relative z-20 flex min-h-screen w-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.16),transparent_28%),radial-gradient(circle_at_76%_28%,rgba(248,113,113,0.11),transparent_24%),linear-gradient(145deg,#071a38_0%,#0b1830_48%,#020617_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,rgba(15,23,42,0),rgba(15,23,42,0.9))]" />

      <div className="relative w-full max-w-md rounded-lg border border-white/14 bg-slate-950/78 p-5 shadow-[0_28px_90px_rgba(2,8,23,0.52)] backdrop-blur-xl sm:p-6">
        <div className="mb-5 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/70">{t("gameTitle")}</p>
          <h1 className="mt-2 text-3xl font-black text-white">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">{subtitle}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${mode === "login" ? "border-cyan-100/40 bg-cyan-300/16 text-cyan-50" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
          >
            {t("login")}
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${mode === "register" ? "border-cyan-100/40 bg-cyan-300/16 text-cyan-50" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
          >
            {t("register")}
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/75">{t("username")}</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-slate-950/58 px-3 py-3 text-sm text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-cyan-100/45 focus:ring-2 focus:ring-cyan-100/10"
              autoComplete="username"
              placeholder="racer01"
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/75">{t("password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-slate-950/58 px-3 py-3 text-sm text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-cyan-100/45 focus:ring-2 focus:ring-cyan-100/10"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
            />
          </label>
          {mode === "register" ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/75">{t("role")}</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                className="w-full rounded-md border border-white/10 bg-slate-950/58 px-3 py-3 text-sm text-slate-50 outline-none transition focus:border-cyan-100/45 focus:ring-2 focus:ring-cyan-100/10"
              >
                {ROLES.map((roleOption) => (
                  <option key={roleOption} value={roleOption}>{t(roleOption)}</option>
                ))}
              </select>
            </label>
          ) : null}
          {message ? (
            <p className="mt-4 rounded-md border border-amber-200/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{message}</p>
          ) : null}
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="mt-5 w-full rounded-md border border-cyan-100/35 bg-cyan-300/16 px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-300/24 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {mode === "register" ? t("register") : t("login")}
          </button>
        </form>

        <button
          type="button"
          onClick={navigateHome}
          className="mt-3 w-full rounded-md border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-200 transition hover:bg-white/10"
        >
          {t("back")}
        </button>
      </div>
    </section>
  );
}
