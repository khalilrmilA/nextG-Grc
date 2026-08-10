#!/bin/sh
# GRC on-prem backend entrypoint.
# First boot: seeds /data/grc.db from the clean seed database baked into the
# image, then execs the container command (uvicorn by default, celery for the
# worker service). NO --reload in production.
set -eu

if [ ! -f /data/grc.db ]; then
    echo "[entrypoint] No database found — seeding /data/grc.db from clean seed"
    cp /seed/grc_seed.db /data/grc.db
fi

mkdir -p /data/uploads

# Respect values already provided via env_file / environment.
export DATABASE_URL="${DATABASE_URL:-sqlite+aiosqlite:////data/grc.db}"
export UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"

cd /srv

if [ "$#" -eq 0 ]; then
    set -- uvicorn app.main:app --host 0.0.0.0 --port 8000
fi

exec "$@"
