/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a deploy build into a staging folder (NEXT_DIST_DIR=.next-staging) while the
  // live server keeps serving .next, then swap — `next build` wipes its distDir first.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [
      // Canonical: redirect www → non-www so canonical URL is always grceye.com
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.grceye.com" }],
        destination: "https://grceye.com/:path*",
        permanent: true,
      },
      // Retired 2026-10-19: the article implied in-product Monte Carlo
      // quantification, which the platform does not offer. Keep old links alive.
      {
        source: "/:locale(en|fr|ar)/blog/automated-risk-management-monte-carlo-quantification",
        destination: "/:locale/blog",
        permanent: true,
      },
      {
        source: "/blog/automated-risk-management-monte-carlo-quantification",
        destination: "/en/blog",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      afterFiles: [
        // Backend API → FastAPI on port 8000
        { source: "/api/:path*", destination: "http://localhost:8000/api/:path*" },
        // Auth + dashboard → Vite app on port 4000
        { source: "/app", destination: "http://localhost:4000/" },
        { source: "/app/:path*", destination: "http://localhost:4000/:path*" },
        { source: "/login", destination: "http://localhost:4000/login" },
        { source: "/register", destination: "http://localhost:4000/register" },
        // Vite static assets used by the dashboard
        { source: "/assets/:path*", destination: "http://localhost:4000/assets/:path*" },
        { source: "/src/:path*",    destination: "http://localhost:4000/src/:path*" },
        // Vite dev-server magic paths (HMR client, pre-bundled deps, plugins)
        { source: "/@vite/:path*",         destination: "http://localhost:4000/@vite/:path*" },
        { source: "/@react-refresh",       destination: "http://localhost:4000/@react-refresh" },
        { source: "/@fs/:path*",           destination: "http://localhost:4000/@fs/:path*" },
        { source: "/node_modules/:path*",  destination: "http://localhost:4000/node_modules/:path*" },
      ],
      // Everything else that isn't a marketing page (see MARKETING_PAGE_ROOTS in
      // middleware.ts) is one of the dashboard SPA's ~60 client-side routes
      // (/dashboard, /settings, /risks, ...). Those only ever got here via a hard
      // navigation — a refresh, a bookmark, a typed URL — since normal in-app
      // navigation is client-side and never reaches the server. Proxy the whole
      // thing to Vite instead of enumerating every route, so new SPA pages don't
      // need a matching rewrite added here to survive a refresh.
      fallback: [
        { source: "/:path*", destination: "http://localhost:4000/:path*" },
      ],
    };
  },
};

module.exports = nextConfig;
