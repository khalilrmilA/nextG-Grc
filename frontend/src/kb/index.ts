import type { KbArticle } from "./types";
import { kbEn } from "./en";
import { kbFr } from "./fr";
import { kbAr } from "./ar";

// Per-language article sets. A language without its own set falls back to English.
const BY_LANG: Record<string, KbArticle[]> = { en: kbEn, fr: kbFr, ar: kbAr };

export function articlesFor(lang: string): KbArticle[] {
  return BY_LANG[(lang || "en").split("-")[0]] ?? kbEn;
}

/** The KB article id documenting a given app path, or null when there is none. */
export function kbArticleForPath(pathname: string): string | null {
  const seg = pathname.replace(/^\/+/, "").split("/")[0];
  const hit = kbEn.find(a => a.route.replace(/^\//, "") === seg);
  return hit ? hit.id : null;
}
