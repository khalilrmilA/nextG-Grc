import { NextRequest, NextResponse } from "next/server";

const LOCALES = ["en", "fr", "ar"] as const;
const DEFAULT_LOCALE = "en";
const LOCALE_COOKIE = "grceye_lang";

// Paths that must never get a locale prefix: the dashboard SPA rewrite target
// (/app), the auth routes proxied straight to the Vite app (/login, /register),
// the API proxy, and anything that looks like a static file (has a dot, e.g.
// /favicon.ico, /robots.txt, /sitemap.xml, /logo.png).
const BYPASS_PREFIXES = ["/app", "/login", "/register", "/api", "/_next", "/assets", "/src"];

function hasLocalePrefix(pathname: string): boolean {
  return LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
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

  if (BYPASS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) {
    // Static file (favicon.ico, robots.txt, logo.png, ...) — never localize.
    return NextResponse.next();
  }
  if (hasLocalePrefix(pathname)) {
    return NextResponse.next();
  }

  const locale = detectLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  // The bare root must answer 200 directly (not a 307) — the load balancer
  // health-checks "/" and a redirect there gets the target marked unhealthy,
  // which fails root traffic over to the dashboard app instead. Rewrite
  // (serve /en's content at the "/" URL) rather than redirect for this one
  // path; every other unprefixed path still gets the visible locale redirect.
  if (pathname === "/") {
    return NextResponse.rewrite(url);
  }
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
