import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import fr from "./locales/fr";
import ar from "./locales/ar";

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

// Apply direction immediately on load
applyDirection(savedLang);

export { i18n };
export default i18n;
