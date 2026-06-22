import { useLanguage } from "../i18n";

export function LanguageToggle() {
  const { language, toggleLanguage, t } = useLanguage();
  const label = language === "he" ? "Switch to English" : "עבור לעברית";

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className="rounded-full border border-white/15 bg-slate-950/72 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-50 shadow-[0_12px_30px_rgba(2,8,23,0.28)] backdrop-blur-xl transition hover:border-cyan-100/45 hover:bg-cyan-300/12"
      aria-label={label}
      title={label}
    >
      {t("languageToggle")}
    </button>
  );
}
