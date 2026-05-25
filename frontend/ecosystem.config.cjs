module.exports = {
  apps: [
    {
      name: "grceye-frontend",
      script: "node_modules/.bin/vite",
      args: "preview --port 4000 --host 0.0.0.0",
      cwd: "/root/Desktop/GRC/frontend",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
