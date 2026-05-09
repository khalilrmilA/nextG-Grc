/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/app", destination: "http://localhost:4000/" },
      { source: "/app/:path*", destination: "http://localhost:4000/:path*" },
      { source: "/login", destination: "http://localhost:4000/login" },
      { source: "/register", destination: "http://localhost:4000/register" },
    ];
  },
};

module.exports = nextConfig;
