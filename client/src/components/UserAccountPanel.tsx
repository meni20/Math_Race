import { useState } from "react";
import { useAuth } from "../auth";
import { useLanguage } from "../i18n";

function navigateToLogin() {
  window.history.pushState(null, "", "/login");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function UserAccountPanel() {
  const { t } = useLanguage();
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const onClick = () => {
    if (!user && !loading) {
      navigateToLogin();
      return;
    }
    setOpen((current) => !current);
  };

  const onLogout = () => {
    void logout().then(() => {
      setOpen(false);
      navigateToLogin();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className="rounded-full border border-white/15 bg-slate-950/72 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-50 shadow-[0_12px_30px_rgba(2,8,23,0.28)] backdrop-blur-xl transition hover:border-cyan-100/45 hover:bg-cyan-300/12"
        aria-label={user ? t("account") : t("login")}
        title={user ? t("account") : t("login")}
      >
        {loading ? t("loading") : user ? `${user.username} · ${t(user.role)}` : t("login")}
      </button>
      {open && user ? (
        <section className="absolute left-0 mt-2 w-64 rounded-lg border border-white/12 bg-slate-950/92 p-3 text-sm text-slate-100 shadow-[0_20px_52px_rgba(2,8,23,0.38)] backdrop-blur-xl">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100/70">{t("signedInAs")}</p>
          <p className="mt-1 truncate font-bold text-white">{user.username}</p>
          <p className="text-xs text-slate-300">{t(user.role)}</p>
          <button
            type="button"
            onClick={onLogout}
            disabled={loading}
            className="mt-3 w-full rounded-md border border-rose-200/25 bg-rose-500/12 px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("logout")}
          </button>
        </section>
      ) : null}
    </div>
  );
}
