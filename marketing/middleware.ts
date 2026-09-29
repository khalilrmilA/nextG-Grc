import { NextRequest, NextResponse } from "next/server";

const LOCALES = ["en", "fr", "ar"] as const;
const DEFAULT_LOCALE = "en";
const LOCALE_COOKIE = "grceye_lang";

// The marketing site's own page roots — the ONLY paths that should ever get a
// locale prefix. Everything else (the dashboard SPA's ~60 client-side routes
// like /dashboard, /settings, /risks, ... plus /app, /login, /register, /api,
// static assets) is proxied straight to the Vite app via next.config.js's
// fallback rewrite and must never be locale-prefixed — a locale-prefixed SPA
// path 404s against Next's own routing on any hard navigation, since Next has
// no page at e.g. /en/dashboard (see incident: /dashboard -> /en/dashboard
// 404 on refresh/bookmark/typed URL).
//
// This used to be a bypass-list of known SPA/infra paths instead of an
// allow-list of marketing pages, which is why a route the list didn't
// mention (here, plain /dashboard) silently broke. The marketing page set is
// small and stable, so allow-listing it is the safer list to maintain as the
// SPA grows.
const MARKETING_PAGE_ROOTS = [
  "contact", "frameworks", "news", "blog", "changelog", "faq", "how-it-works", "solutions", "features-landing",
  // Company + legal pages. These were previously absent, so the footer's links
  // to them fell through to the SPA proxy: /en/terms answered 200 with the Vite
  // shell and bare /terms answered 500.
  "about", "privacy", "terms", "security",
  // /docs is the one root here that isn't a Next page — it's public
  // documentation rendered by the Vite SPA (proxied via next.config.js's
  // fallback rewrite, same as the dashboard). It still belongs in this list,
  // not the "everything else" bucket below: App.tsx (frontend) was given
  // matching /:locale/docs routes specifically so this path is safe to
  // locale-prefix and won't 404 on a hard navigation the way /en/dashboard
  // would (see the comment above on why that's normally unsafe).
  "docs",
];

function hasLocalePrefix(pathname: string): boolean {
  return LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
}

function isMarketingPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const firstSegment = pathname.split("/")[1] || "";
  return MARKETING_PAGE_ROOTS.includes(firstSegment);
}

/** Strip a leading /en, /fr or /ar so the remainder can be matched as a page path. */
function stripLocale(pathname: string): string {
  for (const l of LOCALES) {
    if (pathname === `/${l}`) return "/";
    if (pathname.startsWith(`/${l}/`)) return pathname.slice(l.length + 1);
  }
  return pathname;
}

/**
 * Mark a response as noindex. Used for anything that is not a real marketing
 * page: the catch-all fallback rewrite in next.config.js proxies every unknown
 * URL to the Vite SPA, which answers 200 with its shell rather than a 404. That
 * made every nonexistent URL a soft 404 — unlimited distinct URLs all returning
 * 200 with the same <title>, burning crawl budget and splitting brand signals.
 * A response header is the safe fix: it cannot break routing the way narrowing
 * the fallback could, and it covers URLs no allow-list would have predicted.
 */
function noindex(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

function detectLocale(req: NextRequest): string {
  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && (LOCALES as readonly string[]).includes(cookieLocale)) return cookieLocale;

  const acceptLanguage = req.headers.get("accept-language") || "";
  for (const part of acceptLanguage.split(",")) {
    const tag = part.trim().split(";")[0].split("-")[0].toLowerCase();
    if ((LOCALES as readonly string[]).includes(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/_next" || pathname.startsWith("/_next/")) {
    // Next.js internals (HMR, telemetry, ...) not already excluded by the matcher.
    return NextResponse.next();
  }
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) {
    // Static file (favicon.ico, robots.txt, logo.png, ...) — never localize.
    return NextResponse.next();
  }
  if (hasLocalePrefix(pathname)) {
    // Already localized. Still check the path *behind* the locale: /en/faq is a
    // real page, but /en/anything-else falls through to the SPA proxy and comes
    // back 200 with the Vite shell, so it must not be indexed.
    return isMarketingPath(stripLocale(pathname))
      ? NextResponse.next()
      : noindex(NextResponse.next());
  }
  if (!isMarketingPath(pathname)) {
    // Dashboard SPA route (or /app, /login, /register, /api, ...) — leave it
    // untouched so next.config.js's rewrites (explicit ones, then the
    // catch-all fallback) can proxy it to the Vite app, but keep it out of the
    // index.
    return noindex(NextResponse.next());
  }

  const locale = detectLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  // The bare root must answer 200 directly (not a 307) — the load balancer
  // health-checks "/" and a redirect there gets the target marked unhealthy,
  // which fails root traffic over to the dashboard app instead. Rewrite
  // (serve /en's content at the "/" URL) rather than redirect for this one
  // path; every other unprefixed marketing path still gets the visible locale redirect.
  if (pathname === "/") {
    const res = NextResponse.rewrite(url);
    // This one URL serves three different languages off Accept-Language and the
    // locale cookie, but Next stamps the rewritten page with
    // `Cache-Control: s-maxage=31536000` and a Vary that lists neither. Any shared
    // cache in front of this — the load balancer, a CDN, a corporate proxy — is
    // therefore free to store whichever language it saw first and serve it to
    // everyone for a year, Googlebot included. Declare what the response varies
    // on, and keep shared caches from storing it at all: the page is SSG-backed
    // and cheap to re-render, so there is nothing to gain by caching it publicly.
    res.headers.set("Vary", "Accept-Language, Cookie");
    res.headers.set("Cache-Control", "private, no-cache, must-revalidate");
    return res;
  }
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
