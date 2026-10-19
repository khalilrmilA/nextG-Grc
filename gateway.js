#!/usr/bin/env node
/**
 * Unified gateway for grceye.com — the load balancer forwards to this port (4000),
 * so this process must serve the whole site, not just the dashboard:
 *
 *   /app, /app/*, /login, /register  -> frontend/dist          (dashboard SPA, static build)
 *   /assets/*                         -> frontend/dist/assets   (dashboard's hashed JS/CSS)
 *   /api/*                            -> http://127.0.0.1:8000  (FastAPI backend)
 *   everything else                   -> http://127.0.0.1:3000  (marketing Next.js, proxied)
 *
 * Marketing owns locale detection/redirects (middleware.ts) and its own public/
 * assets (logo.png, favicon, robots.txt, ...) — so any root-level path not
 * explicitly claimed above falls through to it, same precedence marketing's own
 * next.config.js rewrites already used when it sat on the load-balanced port.
 *
 * No dependencies. Managed by pm2 (see ecosystem.config.js).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DASH_DIST = path.join(ROOT, "frontend", "dist");
const DASH_INDEX = path.join(DASH_DIST, "index.html");

const MARKETING = { host: "127.0.0.1", port: 3000 };
const BACKEND = { host: "127.0.0.1", port: 8000 };

// Marketing's own page roots (mirrors MARKETING_PAGE_ROOTS in marketing/middleware.ts).
// Anything else is one of the dashboard SPA's ~60 client-side routes (/dashboard,
// /settings, /risks, ...) reached by a hard navigation (refresh, bookmark, typed URL —
// normal in-app navigation is client-side and never hits this server). Those must be
// served from the static build directly, NOT proxied to marketing: marketing's own
// fallback rewrite (for anything it doesn't recognize) points right back to this
// gateway, so treating an unrecognized path as "must be marketing" here would bounce
// the request between the two forever instead of 404ing cleanly.
// KEEP IN SYNC with MARKETING_PAGE_ROOTS in marketing/middleware.ts, with ONE
// deliberate exception: "docs". marketing/middleware.ts lists "docs" too (so a
// standalone `next dev` of the marketing app, with no gateway in front of it,
// still locale-redirects /docs correctly), but it must stay OUT of this set.
// /docs is real documentation rendered by the dashboard SPA (App.tsx has
// matching /:locale/docs routes), not a Next page — adding it here would
// route it to marketing, whose own fallback rewrite points right back at this
// gateway, i.e. exactly the bounce loop the paragraph above warns about.
// Leaving it out here means isMarketingPath() below already returns false for
// it, so it falls into the normal "serve from the static build" branch; see
// isDocsPath()/serveDashboard() for how it still gets to be indexable there
// despite that branch existing to keep the rest of the dashboard OUT of
// search results.
const MARKETING_PAGE_ROOTS = new Set([
  "", "contact", "frameworks", "news", "blog", "changelog", "faq", "how-it-works", "solutions", "features-landing",
  "about", "privacy", "terms", "security", "pricing",
]);
const LOCALES = new Set(["en", "fr", "ar"]);

/** /docs, /en/docs, /fr/docs, /ar/docs (and their sub-pages) — the one part of
 *  the dashboard SPA build that's public documentation rather than
 *  authenticated app, so it's the one exception to the noindex tag every
 *  other static-build response gets in serveDashboard(). */
function isDocsPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const first = LOCALES.has(segments[0]) ? segments[1] : segments[0];
  return first === "docs";
}

// Root-level files that are always the marketing app's, never the dashboard's.
const MARKETING_OWNED_FILES = new Set([
  "/sitemap.xml", "/robots.txt", "/site.webmanifest", "/og-image.png",
]);

function isMarketingPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  // Marketing pages are served under /en/..., /fr/..., /ar/... — skip a locale segment.
  const first = LOCALES.has(segments[0]) ? segments[1] : segments[0];
  return MARKETING_PAGE_ROOTS.has(first || "");
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".webp": "image/webp", ".txt": "text/plain", ".xml": "application/xml",
  ".webmanifest": "application/manifest+json", ".pdf": "application/pdf",
};

function proxy(req, res, target) {
  // Same-origin from the browser's point of view, so drop Origin: an upstream
  // CORS allowlist scoped to its old direct port must not veto the request.
  const headers = { ...req.headers, host: `${target.host}:${target.port}` };
  delete headers.origin;
  const peer = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
  headers["x-forwarded-for"] = req.headers["x-forwarded-for"]
    ? `${req.headers["x-forwarded-for"]}, ${peer}`
    : peer;
  const up = http.request(
    { host: target.host, port: target.port, path: req.url, method: req.method, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    }
  );
  up.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream ${target.host}:${target.port} unavailable`);
  });
  req.pipe(up);
}

function serveDashboard(res, urlPath) {
  const clean = urlPath.split("?")[0];
  let filePath = path.normalize(path.join(DASH_DIST, clean));
  if (!filePath.startsWith(DASH_DIST)) {
    res.writeHead(403);
    return res.end();
  }
  const indexable = isDocsPath(clean);
  fs.stat(filePath, (err, st) => {
    if (err || st.isDirectory()) filePath = DASH_INDEX;
    const ext = path.extname(filePath).toLowerCase();
    const isHashedAsset = path.dirname(filePath) === path.join(DASH_DIST, "assets");
    const stream = fs.createReadStream(filePath);
    stream.on("open", () => {
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        "x-content-type-options": "nosniff",
        // Everything served from here is either the private dashboard SPA or an
        // unrecognized URL falling back to its index.html — never public content.
        // Without this, any nonexistent URL is a soft 404: it answers 200 with the
        // SPA shell and the shell's own <title>, so a crawler sees unlimited
        // distinct URLs that all look like the same page. robots.txt already
        // disallows the known app routes; this covers the ones no list predicts.
        // /docs is the one real exception — see isDocsPath().
        ...(indexable ? {} : { "x-robots-tag": "noindex, nofollow" }),
        "cache-control": isHashedAsset
          ? "public, max-age=31536000, immutable"
          : "no-store, no-cache, must-revalidate, max-age=0",
      });
      stream.pipe(res);
    });
    stream.on("error", () => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
  });
}

function handler(req, res) {
  const u = req.url || "/";

  // Next's Image Optimization API is enabled by default and answers 200 here even
  // though the marketing site uses zero next/image components — so it is pure
  // attack surface, and the version we run is affected by an unauthenticated RCE
  // through it (AVIF handling) plus several DoS advisories. Nothing legitimate
  // requests this path, so refuse it outright rather than relying only on the
  // framework upgrade.
  if (u === "/_next/image" || u.startsWith("/_next/image?")) {
    res.writeHead(404, { "content-type": "text/plain", "x-robots-tag": "noindex" });
    return res.end("not found");
  }

  if (u === "/api" || u.startsWith("/api/")) return proxy(req, res, BACKEND);

  if (u.startsWith("/assets/")) return serveDashboard(res, u);

  if (u === "/login" || u === "/register") return serveDashboard(res, "/");

  if (u === "/app" || u.startsWith("/app/")) {
    const sub = u === "/app" ? "/" : u.slice("/app".length);
    return serveDashboard(res, sub || "/");
  }

  const pathname = u.split("?")[0];

  // SEO artifacts are owned by the marketing app and must never be answered from
  // the dashboard build, which still carries its own stale pre-marketing copies:
  // frontend/dist/sitemap.xml listed 14 unprefixed URLs that all 307-redirect,
  // while Next generates 75 correct locale-prefixed ones with hreflang. Because
  // the static-file branch below checks the dashboard dist first, that stale pair
  // was what Google actually received. Claim them for marketing explicitly rather
  // than relying on the files being absent from dist.
  if (MARKETING_OWNED_FILES.has(pathname)) return proxy(req, res, MARKETING);

  if (/\.[a-zA-Z0-9]+$/.test(pathname)) {
    // Static file. The dashboard has its own root-level public/ assets (logos, icons -
    // e.g. logowhite.png) copied into frontend/dist alongside its hashed /assets/*
    // bundle, distinct from marketing's own public/ (favicon.ico, robots.txt,
    // sitemap.xml, apple-icon.png, ...). Serve it from whichever one actually has the
    // file; marketing is the default since most root-level static files are its own.
    const candidate = path.normalize(path.join(DASH_DIST, pathname));
    if (candidate.startsWith(DASH_DIST) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return serveDashboard(res, pathname);
    }
    return proxy(req, res, MARKETING);
  }

  if (!isMarketingPath(pathname)) {
    // Dashboard SPA route reached without the /app prefix (/dashboard, /settings, ...).
    return serveDashboard(res, pathname);
  }

  return proxy(req, res, MARKETING);
}

const PORT = process.env.GATEWAY_PORT || 4000;
http.createServer(handler).listen(PORT, "0.0.0.0", () => {
  console.log(`gateway on http://0.0.0.0:${PORT}  (marketing: :3000, dashboard: frontend/dist, api: :8000)`);
});
