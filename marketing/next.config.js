/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
      { source: "/src/:path*", destination: "http://localhost:4000/src/:path*" },
    ];
  },
};

module.exports = nextConfig;
