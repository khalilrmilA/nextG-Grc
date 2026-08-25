"use client";
import { createContext, useContext } from "react";
import { useRouter, usePathname } from "next/navigation";
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
const LOCALE_SEGMENT = /^\/(en|fr|ar)(?=\/|$)/;

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

/**
 * `lang` is the source of truth for locale — it comes from the URL's [locale]
 * segment (set server-side in app/[locale]/layout.tsx), NOT localStorage. This
 * lets Google crawl/index /en, /fr and /ar as distinct, correctly-rendered
 * pages instead of every visitor (including crawlers) landing on client-side-
 * switched English content.
 */
export function I18nProvider({ lang, children }: { lang: Language; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  function setLang(l: Language) {
    if (l === lang) return;
    // Remember the choice so a future bare-domain visit (no /xx prefix) can be
    // redirected straight to it by middleware, without re-detecting from headers.
    try { document.cookie = `${LS_KEY}=${l}; path=/; max-age=31536000; samesite=lax`; } catch { /* noop */ }
    const rest = (pathname || "/").replace(LOCALE_SEGMENT, "");
    router.push(`/${l}${rest}`);
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
