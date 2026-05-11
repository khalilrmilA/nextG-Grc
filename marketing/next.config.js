/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Canonical: redirect www → non-www so canonical URL is always grceye.com
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.grceye.com" }],
        destination: "https://grceye.com/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
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
    ];
  },
};

module.exports = nextConfig;
