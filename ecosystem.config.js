module.exports = {
  apps: [
    {
      name: "grceye-gateway",
      script: "gateway.js",
      cwd: "/root/Desktop/GRC",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        GATEWAY_PORT: 4000,
      },
    },
  ],
};
