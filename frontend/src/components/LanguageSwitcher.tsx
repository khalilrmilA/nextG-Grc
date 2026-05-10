import { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, type Language, saveLanguage, applyDirection } from "../i18n";
import { Globe } from "lucide-react";

interface Props {
  compact?: boolean; // show only flag/code, no label
}

export default function LanguageSwitcher({ compact = false }: Props) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  function switchTo(code: Language) {
    i18n.changeLanguage(code);
    saveLanguage(code);
    applyDirection(code);
    setOpen(false);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const flagFor = (code: string) => code === "en" ? "🇬🇧" : code === "fr" ? "🇫🇷" : "🇸🇦";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700 hover:shadow-sm transition-all font-semibold ${
          compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
        }`}
        aria-label={t("public.nav.switch_language")}
        title={t("public.nav.switch_language")}
      >
        <span className="text-base leading-none" aria-hidden>{flagFor(current.code)}</span>
        <Globe className={`flex-shrink-0 ${compact ? "w-3.5 h-3.5" : "w-4 h-4"}`} />
        <span className="uppercase tracking-wide">{current.code}</span>
      </button>

      {open && (
        <div className="absolute right-0 rtl:right-auto rtl:left-0 top-[calc(100%+6px)] w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden py-1">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => switchTo(lang.code)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                lang.code === i18n.language
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span className="text-base leading-none" aria-hidden>{flagFor(lang.code)}</span>
              <span>{lang.nativeLabel}</span>
              {lang.rtl && (
                <span className="ml-auto rtl:ml-0 rtl:mr-auto text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">RTL</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
