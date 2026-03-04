import { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, type Language, saveLanguage, applyDirection } from "../i18n";
import { Globe } from "lucide-react";

interface Props {
  compact?: boolean; // show only flag/code, no label
}

export default function LanguageSwitcher({ compact = false }: Props) {
  const { i18n } = useTranslation();
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="Switch language"
      >
        <Globe className="w-4 h-4 flex-shrink-0" />
        {!compact && (
          <span className="hidden sm:inline">{current.nativeLabel}</span>
        )}
        {compact && (
          <span className="text-xs font-bold uppercase">{current.code}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-44 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden py-1">
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
              <span className="text-base leading-none">
                {lang.code === "en" ? "🇬🇧" : lang.code === "fr" ? "🇫🇷" : "🇸🇦"}
              </span>
              <span>{lang.nativeLabel}</span>
              {lang.rtl && (
                <span className="ml-auto text-xs text-gray-400">RTL</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
