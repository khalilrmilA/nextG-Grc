import { SITE_URL } from "../app/constants";

export const LOCALES = ["en", "fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Build the localized path for a locale-relative page path (e.g. "/faq" -> "/fr/faq"). */
export function localePath(locale: string, path: string): string {
  const clean = path === "/" ? "" : path;
  return `/${locale}${clean}`;
}

/**
 * hreflang alternates map for a given locale-relative path, pointing at every
 * locale's version of the same page plus an x-default fallback (English) —
 * lets Google discover and index the fr/ar versions as distinct pages instead
 * of only ever seeing the client-side-switched English content.
 */
export function hreflangAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) {
    languages[locale] = `${SITE_URL}${localePath(locale, path)}`;
  }
  languages["x-default"] = `${SITE_URL}${localePath("en", path)}`;
  return languages;
}

export function canonicalUrl(locale: string, path: string): string {
  return `${SITE_URL}${localePath(locale, path)}`;
}

export const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  fr: "fr_FR",
  ar: "ar_SA",
};
