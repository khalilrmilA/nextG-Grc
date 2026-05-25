module.exports = {
  apps: [
    {
      name: "grceye-marketing",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      cwd: "/root/Desktop/GRC/marketing",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
