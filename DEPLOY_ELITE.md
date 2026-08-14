# Deploy the Elite Pack to production (grceye.com)

All Elite Pack code is committed on `feat/elite-pack-rfp` and verified (35/35 E2E
checks pass on a throwaway copy). These are the **operational** steps to make it
live. They touch the live DB + pm2, so they are gated behind your permission —
run them yourself, or allow the commands for this session.

Prod topology (pm2): `grceye-backend` = uvicorn :8000 (2 workers) · `grceye-frontend`
= `vite preview` serving `frontend/dist` :4000 · `grceye-marketing` = Next.js :3000
(proxies /app→:4000, /api→:8000). The frontend build uses `.env.local`
(`VITE_API_URL=/api/v1`, relative → proxied), so a plain `npm run build` is correct.

```bash
cd /root/Desktop/GRC

# 1) BACKUP the live DB (git-tracked, real client data) — do not skip
cp backend/grc_dev.db backend/grc_dev.db.pre-elite-$(date +%Y%m%d-%H%M%S)

# 2) Backend deps (already in the venv; safe to re-run) + OCR OS packages
backend/venv/bin/pip install -r backend/requirements.txt
apt-get install -y tesseract-ocr tesseract-ocr-fra poppler-utils

# 3) Idempotent column migrations on the live DB
( cd backend && venv/bin/python -m scripts.deploy_elite_pack )

# 4) Restart the backend — create_all() builds the new tables on boot
pm2 restart grceye-backend

# 5) Enable the Elite Pack for the tenant(s) you want (repeat per slug)
( cd backend && venv/bin/python -m scripts.grant_elite_pack --tenant demo )

# 6) (optional) Seed realistic data + CVEs so the pages aren't empty
( cd backend && venv/bin/python -m scripts.seed_demo_data --sync-cve )

# 7) Build the frontend and restart it
( cd frontend && npm run build )
pm2 restart grceye-frontend

# 8) Verify
curl -s http://127.0.0.1:8000/api/v1/openapi.json >/dev/null && echo "backend OK"
# Browse https://grceye.com/app → login admin@demo.com / demo123 → Elite sidebar
```

## Rollback

```bash
cp backend/grc_dev.db.pre-elite-<timestamp> backend/grc_dev.db   # restore DB
git checkout main                                                # or the prior commit
pm2 restart grceye-backend
( cd frontend && npm run build ) && pm2 restart grceye-frontend
```

## Redeploy: backend polish (matrix risk scoring · scheduled reports · tamper-evident log)

The three "en cours de finalisation" items are now built (branch `feat/elite-pack-rfp`,
commits `b4c93f7`, `c898e68`, `b8ce58c`, `fbfe1b2`, `77747ad`). They are **backend-only**
— no frontend rebuild needed. The code already lives in this working tree; prod just needs
the new column migration + a backend restart (which builds the two new tables via
`create_all` and starts the in-process report scheduler).

```bash
cd /root/Desktop/GRC

# 1) Backup the live DB again (additive migration, but do not skip)
cp backend/grc_dev.db backend/grc_dev.db.pre-elite2-$(date +%Y%m%d-%H%M%S)

# 2) Idempotent migrations — adds risks.(target_likelihood,target_impact,risk_matrix_id)
#    and activity_logs.(seq,prev_hash,entry_hash)+unique index. Re-runs old ones as no-ops.
( cd backend && venv/bin/python -m scripts.deploy_elite_pack )

# 3) Restart backend — create_all builds report_schedules + login_events; report scheduler starts
pm2 restart grceye-backend

# 4) Verify (read-only)
curl -s http://127.0.0.1:8000/api/v1/openapi.json >/dev/null && echo "backend OK"
# New endpoints: /risks/{id}/appetite, /risks/heatmap/data (matrix views), /report-schedules,
# /activity-log/verify, /activity-log/login-events, /risk-matrices/{id}/default
```
Optional: `ENABLE_REPORT_SCHEDULER=0` in the backend env disables the in-process report
loop (it is inert anyway until a tenant creates a schedule with recipients).

## Notes
- Migrations are additive `ALTER TABLE … ADD COLUMN` (idempotent PRAGMA check) + new
  tables via `create_all()`. No data is dropped.
- Deploying shows the new Elite nav items to **all** tenants; non-Elite tenants get
  the 402 → "Elite Pack" upsell toast when they open a gated section.
- Arabic OCR needs `apt-get install -y tesseract-ocr-ara` (eng+fra are enough for FR).
