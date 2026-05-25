module.exports = {
  apps: [
    {
      name: "grceye-backend",
      script: "/root/Desktop/GRC/backend/venv/bin/uvicorn",
      args: "app.main:app --host 127.0.0.1 --port 8000 --workers 2",
      cwd: "/root/Desktop/GRC/backend",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
