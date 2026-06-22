import { useLanguage } from "../i18n";
import { useTheme } from "../theme";

export function ThemeToggle() {
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const nextLabel = theme === "dark" ? t("themeLight") : t("themeDark");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle-button inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/72 px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 shadow-[0_16px_38px_rgba(2,8,23,0.3)] backdrop-blur-xl transition hover:border-cyan-100/45 hover:bg-cyan-300/12"
      aria-label={nextLabel}
      title={nextLabel}
    >
      <span aria-hidden="true" className="inline-block align-[-1px]">
        {theme === "dark" ? "☀" : "☾"}
      </span>
      {nextLabel}
    </button>
  );
}
