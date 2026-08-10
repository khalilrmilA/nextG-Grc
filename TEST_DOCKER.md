# Testing GRCeye in Docker on another PC

This runs the whole app (backend + frontend) in Docker so you can see it work on
any machine. It uses a **clean seed database** (built-in frameworks, no client
data) and needs **no PyArmor license and no signing keys**.

> ⚠️ This TEST build ships readable source and unlocks every feature. Use it for
> your own testing only. The real client deliverable is the obfuscated,
> license-enforced build (`Dockerfile.backend.onprem` + `build_client_release.sh`).

## What you need on the other PC
- **Docker** — Docker Desktop (Windows/Mac) or Docker Engine (Linux). Nothing else.

## Steps

1. **Copy this repo folder** to the other PC. It already includes the clean seed
   at `release/seed/grc_seed.db`. You can leave out `backend/venv/`,
   `frontend/node_modules/`, `frontend/dist/`, and `marketing/` to keep it small —
   Docker rebuilds what it needs.

2. **Open a terminal in the folder** and build + start:
   ```bash
   docker compose -f docker-compose.test.yml up --build
   ```
   First build takes a few minutes (it installs Python + Node deps inside Docker).

3. **Open the app:** http://localhost:8080

4. **Log in** with the seeded admin:
   - Email: `admin@test.local`
   - Password: `TestClient2026`

## Handy commands
```bash
# Run in the background
docker compose -f docker-compose.test.yml up --build -d

# View logs
docker compose -f docker-compose.test.yml logs -f

# Stop (data is kept in the grc_test_data volume)
docker compose -f docker-compose.test.yml down

# Stop AND wipe the database/uploads (fresh start next time)
docker compose -f docker-compose.test.yml down -v
```

## AI features (optional)
Compliance analysis, the doc generator, and contract review call an AI model.
Without one they fail gracefully; everything else works. To enable a local model:
```bash
docker compose -f docker-compose.test.yml --profile ai up --build -d
docker compose -f docker-compose.test.yml exec ai ollama pull llama3.1:8b
```
Then set `OLLAMA_CHAT_MODEL: llama3.1:8b` in `docker-compose.test.yml` (already the
default) and restart. For real speed, point `OLLAMA_BASE_URL` at a GPU box instead.

## Want to test the LICENSE LOCK too?
By default this build has enforcement **off** (the app is fully usable). To
rehearse the client experience where the app is locked until a key is entered,
use the real on-prem build instead (`Dockerfile.backend.onprem`), which bakes the
public key in and turns enforcement on — see `DEPLOYMENT_PRIVATE.md`.

## Regenerating the seed database
If you want a fresh seed (e.g. different admin email/password), on a machine with
the Python venv:
```bash
cd backend
venv/bin/python scripts/make_client_seed_db.py \
  --source grc_dev.db --out ../release/seed/grc_seed.db \
  --company "Test Client" --admin-email admin@test.local --admin-password TestClient2026
```
It reads `grc_dev.db` read-only and strips all client data — only built-in
frameworks/threats remain, plus the one admin you specify.
