# Known issues — verified, not fixed

Everything here was **verified against the running system**, not inferred. Each
item says what is wrong, how it was confirmed, and what it costs. Nothing on
this list is speculative; where a claim was investigated and turned out to be
false, it is in the last section so nobody re-raises it.

Written 2026-09-04. Re-verify before quoting any of it in a tender response.

---

## 1. Blocks the STB tender

### 1.1 Oracle 19c — the application cannot create its schema
**Verified:** 42 of 84 tables fail Oracle DDL compile. SQL Server 2019: 0 fail.
The blocker is JSON columns, not timestamps.
**Cost:** STB mandates Oracle 19C. The repo's own requirement matrix marks this
eliminatory (`backend/app/api/v1/endpoints/system.py:82`, `elim=True`).
**Note:** Do **not** let `scripts/check_db_connectivity.py`'s `SELECT 1` be cited
as validation — it prints OK against a database where the app cannot create a
single table. Keep P-03 (Multi-DB) as PENDING.
**Effort:** real project. JSON columns need a portable representation; all ~24
migration scripts in `backend/scripts/` talk to `sqlite3` directly and would
each need rewriting.

### 1.2 Delivered PDFs promise an RPO the deployment does not have
**Verified:** `crontab -l` → no crontab for root. Newest backup 2026-08-27
(8 days old). `backend/backups/` holds 2 files, 10 days apart.
**Cost:** `deliverables/STB_PRA_PCA_Dossier.pdf` and `STB_SLA.pdf` assert an
hourly cadence and RPO ≤ 1h. The product's own System Check screen
(`system.py:85-95`) renders the contradiction to anyone who opens it.
**Fix:** either schedule `backend/scripts/backup_db.py` hourly (it is a working
online backup — safe to run against the live DB) **or** regenerate both PDFs
with the cadence actually contracted. Do one before submitting.

### 1.3 No Java application server, and no way to have one
**Verified:** zero `.java` / `.war` / `.ear` / `pom.xml` / `web.xml` in the repo.
**Cost:** STB mandates WebSphere, WebLogic or JBoss. This is a Python ASGI
application; it cannot be deployed as a WAR or EAR onto any of them.
**Not fixable in code.** Needs a positioning answer — reverse proxy in front, or
containers on their VMware estate. Decide it before submission.

### 1.4 SQLite is the production data tier
**Verified:** `DATABASE_URL` defaults to SQLite; `docker-compose.onprem.yml`
provisions no database service; the on-prem entrypoint seeds `/data/grc.db`.
**Cost:** no scale-out, no HA, no point-in-time recovery. Frequently
disqualifying on procurement grounds regardless of measured throughput.
**Blocked by 1.1:** the built-in frameworks live in a SQLite seed file, so a
Postgres/Oracle deployment currently boots with **zero frameworks**. A seed
migration path has to exist before another engine is offered at all.

### 1.5 REST API specification is not among the deliverables
**Verified:** `deliverables/` holds 9 documents × EN/FR. None is an API spec.
**Cost:** explicitly listed in STB's documentation requirements.
**Effort:** small — FastAPI already emits OpenAPI 3; it needs exporting and
formatting as a document.

### 1.6 Four paper copies
Printing and logistics, not code. Listed only so it is not forgotten.

---

## 2. Legal / data protection

### 2.1 No GDPR Art.17 erasure path
**Verified:** `grep -rniE "erasure|anonymi|pseudonymi|forgotten" backend/app/` →
zero hits. The only "delete a person" operation is a bare `db.delete(user)`
(`users.py`, `admin.py`).
**Also verified:** 56 foreign keys reference `users.id`, only **one** declares
`ondelete`, and SQLite runs with `PRAGMA foreign_keys = 0` — so that delete
silently orphans rows today. The live database already contains orphaned
`activity_logs` and `notifications` rows. On PostgreSQL/Oracle the same call
raises IntegrityError instead.
**The hard part is easier than it looks:** `ip_address` and `origin` are *not*
part of `compute_entry_hash` (`services/activity_chain.py`), and `user_email` is
empty and `entity_name` NULL on all 726 rows — so the activity log's erasure
obligation is dischargeable at **zero hash-chain cost** by nulling IPs. 529 of
726 rows are unchained legacy (`seq IS NULL`) and can be redacted freely.
Never re-chain (anyone who can re-chain can rewrite history undetectably) and
never delete a chained row (an unexplainable sequence gap).

### 2.2 Real client data is in git history
**Verified:** `backend/grc_dev.db` — the **live production database**, 18.7 MB,
17 users across 11 tenants — is tracked. So is
`backend/grc_dev.db.pre-cleanup-20260810-093233.bak` (13.2 MB, 14 users, 26
tenants). Every clone of this repository carries both.
**Status:** client *uploads* were untracked in commit `e27c47b`, but they and
these databases **remain in history**. Removing them needs a history rewrite —
a repository-owner decision, deliberately not taken unilaterally.
**Also:** 8 more loose `.db` snapshots sit beside the live file in `backend/`,
and `~/.pm2/logs/` is 194 MB with no rotation configured.

### 2.3 Uploads accept executable extensions
**Verified:** tracked uploads include `.php` and `.py` files (e.g.
`PV_CARDIO_SAO02-2026__2_.php`). Stored inert and served by path, so not
directly exploitable here, but an evidence store accepting them is a finding an
auditor will write up.

---

## 3. Traceability — remaining gaps

The origin field, rights history and SSO journaling were fixed (`7da7578`,
`5e878fd`). These were not:

### 3.1 The action trace records that a request happened, not what changed
**Verified:** `details` is `{"method", "path"}` on **726 of 726** rows;
`entity_name` NULL on all 726.
**Consequences:** a delete resolves to a bare UUID whose row is gone, so an
auditor cannot learn *what* was deleted; a create carries no id.
**Fix:** a SQLAlchemy `before_flush`/`after_flush` hook walking `session.dirty`
and `session.deleted` with `get_history()` per column, writing
`details['changes'] = {field: [old, new]}`.

### 3.2 Most background writers still log nothing
**Verified:** 6,008 `threats` rows against 4 activity-log entries for threat
creation. Eight schedulers start at `main.py:62-69`; only the audit-recurrence
one now logs.
**Remaining:** threat feed, CVE/NVD sync, risk snapshot, archiving engine,
vulnerability scanner, report scheduler.
**Helper already exists:** `activity_chain.log_system_activity()`. It must be
called **after** the caller commits and never inside its transaction — an
isolated session cannot write while the caller holds SQLite's write lock.

### 3.3 Unauthenticated writes are invisible
**Verified:** `activity_middleware.py` returns early without a Bearer token.
Vendor e-signature (`contract_collab.py`), share-link evidence upload
(`public_upload.py`) and **password reset** (`auth.py`, `logger.info` only)
therefore produce no audit entry.

### 3.4 Failures and denials are never logged
**Verified:** the middleware returns on any non-2xx. A rejected attempt to
change someone's role leaves no trace — usually the most interesting event.

### 3.5 AI streaming bypasses the client hint
**Verified:** `frontend/src/api/endpoints.ts` `_streamAi` uses raw `fetch`, not
the axios instance, so it never sends `X-GRC-Client` and always logs as `api`
even when a person clicked the button.

### 3.6 `hashed_password is None` is not a stable directory marker
LDAP role sync skips accounts that hold a local password. A user facing a
demotion can permanently exempt themselves via forgot-password.
**Fix:** an explicit `auth_source` column. Deliberately deferred — a schema
change on a live table for a feature nobody has enabled yet.

### 3.7 Auto-provisioned SSO users write no creation audit
A directory user appearing for the first time creates an account with no
corresponding audit entry.

---

## 4. Volumetry — 10k assets / 100 concurrent

### 4.1 Asset cartography payload explodes
**Verified mechanism:** the edge-building loop is O(n²) over processes and
emits a ~244 MB payload at the volumes discussed. It runs zero times today only
because the single `business_processes` row has `owner_id = NULL`.
**Worse than the size:** it is an `async def` with no threadpool offload, so it
blocks the event loop and half the platform's capacity while it runs.
**Latent but high.**

### 4.2 Unpaginated collection endpoints
Several list endpoints return every row. At 5,000–10,000 assets that is a large
response and a slow page. `GET /assets/options` was added for pickers
(`a362594`); the general list endpoints were not audited individually.

### 4.3 Argon2 password verification blocks the event loop
**Verified:** ~126 ms, called synchronously in the login path.
**Severity:** lower than it sounds — one hash per session, 60-minute tokens,
refresh does not re-hash, and a 10/minute limit bounds it. Tail-latency jitter
and DoS amplification rather than a capacity wall. Still the single largest
blocking operation in the request path; a one-line `asyncio.to_thread` fixes it.

### 4.4 AI quota is still per-worker
`app/core/ai_quota.py` was deliberately left out of the shared-state migration:
it is reached from a synchronous call path, and its limit is a 10M-token/day
valve on a free local model, so counting it twice changes nothing anyone feels.
Recorded so the gap is known rather than forgotten.

---

## 5. Files and retention

### 5.1 ~35 files on disk have no database reference
**Verified:** 69 files in `backend/uploads/`, ~35 with no row in `evidence`,
`uploaded_documents` or `stored_file_versions` after the backfill.
**Do not auto-delete them.** They predate checksums and have no recorded digest,
so a sweep cannot distinguish a genuine orphan from a file whose row was lost.
`file_retention.find_unreferenced_files` must stay report-only.

### 5.2 No per-tenant storage quota
Nothing bounds how much one tenant can store. Retention (`78ae836`) reclaims
retired files but sets no ceiling.

### 5.3 Restore exists only for policies
`7201e78` added restore for policy versions. `FrameworkControlVersion`,
`RiskScenarioVersion`, `RiskTreatmentVersion` and `GovernanceDocumentVersion`
have history tables but no restore action. Same append-don't-rewrite pattern
applies.

### 5.4 Two PDF generators still lack Arabic support
`46eb6c4` covered the five report types, policies and cartographies.
`app/api/v1/endpoints/archiving.py` and `ocr.py` were not treated — Arabic text
in those exports will still render as boxes. `services/pdf_arabic.py` is the
helper; the integration is one call per client-data field.

---

## 6. Operational

### 6.1 Deploy actions outstanding
The backend has been running the same process since 2026-09-03 13:54, so none
of this session's backend work is live — including the fix for evidence upload,
which had been returning 500 since 9 June.
```
pm2 restart grceye-backend     # also creates stored_file_versions on boot
git push origin main
```
Both are blocked for the assistant by this environment's permission classifier.

### 6.2 Production runs in development mode
`ENVIRONMENT=development` with `DEBUG=true`: hardening guards off, no HSTS, and
`/api/v1/docs` publicly exposed. Flipping to `production` crashes startup unless
`SECRET_KEY`/`DEBUG` are corrected first. Needs a maintenance window.

### 6.3 Unexplained schema drift, twice
Columns migrated earlier in a session were later found missing from the live
database, on two separate occasions, with no cron job, backup restore or other
cause identified. Both times re-running the idempotent migration fixed it. If it
happens a third time, treat it as a real defect and instrument it — a startup
schema-integrity check was proposed and never built.

---

## 7. Investigated and found FALSE — do not re-raise

Recorded so these are not rediscovered and put into a tender document.

| Claim | Reality |
|---|---|
| "207 rps collapse at 100 concurrent" | Load-generator artifact. Re-measured: **934 rps, p50 93 ms, zero errors**, flat to conc=200. Backend pins at exactly 200% CPU → a `--workers 2` limit, linear in worker count. **Delete this number from any tender material.** |
| "No DR/PCA capability exists" | False. `STB_PRA_PCA_Dossier.pdf` is a dedicated dossier with a numbered 5-step restore; two more runbooks exist. The real finding is the RPO mismatch (1.2). |
| "No table records rights history" | False. A hash-chained `role_change` writer existed; it had simply never fired and missed 4 of 5 paths. Now generic (`7da7578`). |
| "Backup excludes uploads → restore yields dangling pointers" | False for the shipping deployments: DB and uploads share one volume. Worst case is orphan files, never dangling references. |
| "Oracle `DateTime(timezone=True)` causes silent data loss" | False. Oracle fails at `create_all()` on JSON long before a row is written; those columns are second-precision and tz-naive already. The real Oracle blocker is JSON (1.1). |
| "SQLite write lock is the ceiling for 300 users" | Measured floor ~155–180 writes/s at 30 writers against an observed peak of 1.8/s. Argue no scale-out / no HA / no PITR (1.4), **not** throughput. |
| "Activity log stores an empty user identifier → the trail is anonymous" | Overstated. `user_email` is indeed empty, but `user_id` is populated on every row and 725 of 726 join to a real user. It is a denormalised display copy, not the actor identifier. |
