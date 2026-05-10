"use client";
import { useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import { LANGUAGES, useI18n } from "../i18n";

interface Props {
  compact?: boolean;
}

export default function LanguageSwitcher({ compact = false }: Props) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const current = LANGUAGES.find(l => l.code === lang) ?? LANGUAGES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700 hover:shadow-sm transition-all font-semibold ${
          compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
        }`}
        aria-label={t("public.nav.switch_language")}
        title={t("public.nav.switch_language")}
      >
        <span className="text-base leading-none" aria-hidden>{current.flag}</span>
        <Globe className={`flex-shrink-0 ${compact ? "w-3.5 h-3.5" : "w-4 h-4"}`} />
        <span className="uppercase tracking-wide">{current.code}</span>
      </button>

      {open && (
        <div className="absolute right-0 rtl:right-auto rtl:left-0 top-[calc(100%+6px)] w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-[80] overflow-hidden py-1">
          {LANGUAGES.map(l => (
            <button
              key={l.code}
              type="button"
              onClick={() => { setLang(l.code); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                l.code === lang
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span className="text-base leading-none" aria-hidden>{l.flag}</span>
              <span>{l.nativeLabel}</span>
              {l.rtl && (
                <span className="ml-auto rtl:ml-0 rtl:mr-auto text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">RTL</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
