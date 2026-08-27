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
  "contact", "frameworks", "news", "blog", "faq", "how-it-works", "solutions", "features-landing",
];

function hasLocalePrefix(pathname: string): boolean {
  return LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
}

function isMarketingPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const firstSegment = pathname.split("/")[1] || "";
  return MARKETING_PAGE_ROOTS.includes(firstSegment);
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
    return NextResponse.next();
  }
  if (!isMarketingPath(pathname)) {
    // Dashboard SPA route (or /app, /login, /register, /api, ...) — leave it
    // untouched so next.config.js's rewrites (explicit ones, then the
    // catch-all fallback) can proxy it to the Vite app.
    return NextResponse.next();
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
    return NextResponse.rewrite(url);
  }
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
