import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import fr from "./locales/fr";
import ar from "./locales/ar";
import { eliteEn, eliteFr, eliteAr } from "./eliteLocales";
import { gapEn, gapFr, gapAr } from "./locales/gapfills";
import { menuEn, menuFr, menuAr } from "./menuLocales";
import { fixFr, fixAr } from "./fixLocales";
import g1_admin_account from "./sweep/g1_admin_account";
import g2_vendors from "./sweep/g2_vendors";
import g3_compliance from "./sweep/g3_compliance";
import g4_risk_gov from "./sweep/g4_risk_gov";
import g5_audit_docs from "./sweep/g5_audit_docs";
import g6_security_shell from "./sweep/g6_security_shell";
import g7_exports from "./sweep/g7_exports";


export type Language = "en" | "fr" | "ar";
export const LANGUAGES: { code: Language; label: string; nativeLabel: string; rtl: boolean }[] = [
  { code: "en", label: "English",  nativeLabel: "English",  rtl: false },
  { code: "fr", label: "French",   nativeLabel: "Français", rtl: false },
  { code: "ar", label: "Arabic",   nativeLabel: "العربية",  rtl: true  },
];

const LS_KEY = "grc_lang";

export function getSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem(LS_KEY) as Language | null;
    if (saved && ["en", "fr", "ar"].includes(saved)) return saved;
  } catch { /* ignore */ }
  // Auto-detect from browser
  const browserLang = navigator.language.split("-")[0];
  if (browserLang === "fr") return "fr";
  if (browserLang === "ar") return "ar";
  return "en";
}

export function saveLanguage(lang: Language) {
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch { /* ignore */ }
}

/** Apply RTL direction to <html> element */
export function applyDirection(lang: Language) {
  const isRtl = lang === "ar";
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  document.documentElement.lang = lang;
}

const savedLang = getSavedLanguage();

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      ar: { translation: ar },
    },
    lng: savedLang,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

// Merge the Elite Pack translations into each language (deep merge, overwrite).
i18n.addResourceBundle("en", "translation", eliteEn, true, true);
i18n.addResourceBundle("fr", "translation", eliteFr, true, true);
i18n.addResourceBundle("ar", "translation", eliteAr, true, true);
i18n.addResourceBundle("en", "translation", menuEn, true, true);
i18n.addResourceBundle("fr", "translation", menuFr, true, true);
i18n.addResourceBundle("ar", "translation", menuAr, true, true);

// Gap-fill recently-added feature strings (deep merge, NON-destructive — only fills keys
// still missing from the locale files, never overwrites an existing translation).
i18n.addResourceBundle("en", "translation", gapEn, true, false);
i18n.addResourceBundle("fr", "translation", gapFr, true, false);
i18n.addResourceBundle("ar", "translation", gapAr, true, false);

// 2026-09-25 fixes — non-destructive, like the gap-fills.
i18n.addResourceBundle("fr", "translation", fixFr, true, false);
i18n.addResourceBundle("ar", "translation", fixAr, true, false);

// i18n sweep bundles (one per screen group) — non-destructive: existing strings win.
for (const b of [g1_admin_account, g2_vendors, g3_compliance, g4_risk_gov, g5_audit_docs, g6_security_shell, g7_exports]) {
  i18n.addResourceBundle("en", "translation", b.en, true, false);
  i18n.addResourceBundle("fr", "translation", b.fr, true, false);
  i18n.addResourceBundle("ar", "translation", b.ar, true, false);
}

// Arabic has six plural forms (zero/one/two/few/many/other). A key translated with
// only English-style _one/_other would fall back to ENGLISH for counts 0, 2 and
// 3–99, so fill every missing Arabic form from the key's own _other (or _one).
function fillArabicPlurals(node: Record<string, unknown>) {
  const forms = ["zero", "one", "two", "few", "many", "other"];
  const bases = new Set<string>();
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object" && !Array.isArray(v)) fillArabicPlurals(v as Record<string, unknown>);
    const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(k);
    if (m && typeof v === "string") bases.add(m[1]);
  }
  for (const b of bases) {
    const src = (node[`${b}_other`] ?? node[`${b}_many`] ?? node[`${b}_one`]) as string | undefined;
    if (typeof src !== "string") continue;
    for (const f of forms) if (node[`${b}_${f}`] === undefined) node[`${b}_${f}`] = f === "one" && typeof node[b] === "string" ? node[b] : src;
  }
}
const arBundle = i18n.getResourceBundle("ar", "translation");
if (arBundle) {
  fillArabicPlurals(arBundle);
  // getResourceBundle may hand back a copy — write the filled forms back.
  i18n.addResourceBundle("ar", "translation", arBundle, true, true);
}

// Apply direction immediately on load
applyDirection(savedLang);

export { i18n };
export default i18n;
