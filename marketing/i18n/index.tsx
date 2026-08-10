"use client";
import { createContext, useContext, useEffect, useState } from "react";
import en from "./locales/en";
import fr from "./locales/fr";
import ar from "./locales/ar";

export type Language = "en" | "fr" | "ar";

export const LANGUAGES: { code: Language; label: string; nativeLabel: string; rtl: boolean; flag: string }[] = [
  { code: "en", label: "English", nativeLabel: "English",  rtl: false, flag: "🇬🇧" },
  { code: "fr", label: "French",  nativeLabel: "Français", rtl: false, flag: "🇫🇷" },
  { code: "ar", label: "Arabic",  nativeLabel: "العربية",  rtl: true,  flag: "🇸🇦" },
];

const RESOURCES: Record<Language, Record<string, unknown>> = { en, fr, ar };
const LS_KEY = "grceye_lang";

/** Look up a dotted key like "public.nav.features" in a nested object. */
function lookup(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Replace {{name}} placeholders with values from `vars`. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ""));
}

interface I18nCtx {
  lang: Language;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLang: (l: Language) => void;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Always render initial pass with EN to match the server-rendered HTML and
  // avoid hydration mismatches. We hydrate the saved/browser language after mount.
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    let saved: Language | null = null;
    try { saved = (localStorage.getItem(LS_KEY) as Language | null); } catch { /* noop */ }
    let initial: Language = "en";
    if (saved && (saved === "en" || saved === "fr" || saved === "ar")) {
      initial = saved;
    } else if (typeof navigator !== "undefined") {
      const b = navigator.language.split("-")[0];
      if (b === "fr") initial = "fr";
      else if (b === "ar") initial = "ar";
    }
    if (initial !== "en") setLangState(initial);
  }, []);

  // Sync <html lang> and <html dir> with active language.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  function setLang(l: Language) {
    setLangState(l);
    try { localStorage.setItem(LS_KEY, l); } catch { /* noop */ }
  }

  function t(key: string, vars?: Record<string, string | number>): string {
    const fromActive = lookup(RESOURCES[lang], key);
    if (fromActive !== undefined) return interpolate(fromActive, vars);
    const fallback = lookup(RESOURCES.en, key);
    if (fallback !== undefined) return interpolate(fallback, vars);
    return key;
  }

  return <Ctx.Provider value={{ lang, t, setLang }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) {
    // Outside the provider (e.g. in a server component): return a sensible fallback
    // so calls don't crash; UI will just show the EN string.
    return {
      lang: "en" as Language,
      setLang: () => { /* noop */ },
      t: (key: string, vars?: Record<string, string | number>) => {
        const s = lookup(RESOURCES.en, key);
        return s !== undefined ? interpolate(s, vars) : key;
      },
    };
  }
  return v;
}
