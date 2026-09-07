# Known issues — verified, not fixed

Everything here was **verified against the running system**, not inferred. Each
item says what is wrong, how it was confirmed, and what it costs. Nothing on
this list is speculative; where a claim was investigated and turned out to be
false, it is in the last section so nobody re-raises it.

Written 2026-09-04. Re-verify before quoting any of it in a tender response.

## Index — what to do, in order

Effort is engineering effort only. "Blocked" means it cannot start until
someone outside this repo answers a question.

### Do before the tender is submitted
| # | Item | Effort | Note |
|---|---|---|---|
| 1.2 | Fix the RPO contradiction in the delivered PDFs | hours | Schedule the backup **or** regenerate the two PDFs. Your own System Check screen shows the mismatch today. |
| 1.5 | Export the REST API specification as a deliverable | hours | FastAPI already emits OpenAPI 3 |
| 9.5 | Training plan is 2 pages; regenerate to STB's 4-profile structure | hours | Documentation only |
| 1.1 | Oracle 19c — 42/84 tables fail to create | project | Eliminatory. Decide whether to bid it |
| 1.3 | WebSphere / WebLogic / JBoss | none (commercial) | Cannot be built. Needs a positioning answer |
| 8.5 | Tariffs, G-Cloud/N-Cloud hosting, 3-year warranty | none (commercial) | Contractual |

### Highest value for the effort
| # | Item | Effort | Why |
|---|---|---|---|
| 8.2 | Per-tenant label overrides | small | Explicit requirement, visible in a demo, tenant settings blob already exists to hold it |
| 4.3 | `asyncio.to_thread` around Argon2 | one line | Largest blocking call in the request path |
| 5.4 | Arabic in the last two PDF generators | small | Helper exists; one call per client-data field |
| 5.3 | Restore for the other version tables | small | Same append-don't-rewrite pattern as policies |
| 3.5 | Send `X-GRC-Client` from `_streamAi` | small | Closes a hole in the origin field just built |

### Real gaps, larger builds
| # | Item | Effort | Note |
|---|---|---|---|
| 2.1 | GDPR Art.17 erasure | large | 56 FKs, 1 `ondelete`, FKs off in SQLite. Log side is free — IP is not hashed |
| 8.3 | Named / concurrent / unlimited licence models | moderate | Concurrent licensing has nothing to count against it; `user_sessions` already holds the data |
| 8.1 | Per-table column and field preferences | moderate | Dashboard-layout model is the template |
| 10.1 | Custom roles with their own permission set | large | 13 fixed roles today; Groups bundle built-ins. Scope the cheap path first |
| 3.1 | Field-level before/after in the action trace | moderate | SQLAlchemy flush hook |
| 3.2 | Remaining schedulers still log nothing | moderate | Helper exists — call it **after** the caller commits |
| 4.1 | Asset cartography O(n²) + blocks the event loop | moderate | Latent; zero-impact today only because a row has a NULL owner |
| 12.1 | ~~Threat pending queue~~ | done | Feeds now land in the threat watch, not the register |
| 11.1 | CAPEC catalog (ids are bridged, names are not) | small | Near-copy of `mitre_cwe_sync.py`; only if STB asks for attack-pattern search |

### Decide, then act
| # | Item | Blocked on |
|---|---|---|
| 2.2 | Live DB + snapshot are in git history | Repository owner — needs a history rewrite |
| 8.4 / GED | CMIS or vendor connector | STB naming their GED product |
| 6.2 | Production runs in development mode | A maintenance window |
| 5.1 | ~35 unreferenced files on disk | Judgement — **never auto-delete**, they predate checksums |

### Standing
| # | Item |
|---|---|
| 6.1 | `pm2 restart grceye-backend` — none of the recent backend work is live, including the evidence-upload fix |
| 11.2 | One-off `POST /cve/sync?days=1&refresh_days=120` to heal the 1,969 CVEs ingested before NVD analysed them |
| 6.3 | Watch for a third occurrence of the schema drift; instrument it if it recurs |

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

---

## 8. Ergonomics, archiving, licensing, hosting (added 2026-09-04)

Audited against the requirements on interface, archiving, licence models,
hosting and maintenance. Most of this block is already met — only the items
below are not.

### 8.1 Screen personalization is dashboard-only — **GAP**
**Required:** personalisation of screens covering *champs, positions,
visibilité*.
**Verified:** `dashboard_layouts` stores an ordered
`[{"id": widget, "visible": bool}]` per user per dashboard, so **positions and
visibility are covered for dashboard widgets**. There is no per-table column or
field preference anywhere — searched for `column_prefs`, `visible_columns`,
`field_config`, `column_config` across backend and frontend: no matches.
**Cost:** a user cannot choose which columns appear on the Risks, Assets or
Compliance tables, nor reorder or hide fields on a form. That is the larger half
of what the requirement asks for.
**Effort:** moderate. The dashboard-layout model is a good template — a
per-user, per-table JSON preference plus a column-picker on the shared table
component would cover it without touching each page.

### 8.2 Labels cannot be adapted to the bank's vocabulary — **GAP**
**Required:** *l'adaptation des libellés aux besoins de la banque*.
**Verified:** no override mechanism exists — searched for `custom_label`,
`label_override`, `terminology`, `custom_terms`: no matches. Text comes from
`frontend/src/i18n/locales/{en,fr,ar}.ts`, which are build-time files. A bank
that calls a "vendor" a *prestataire* or a "risk owner" a *pilote de risque*
cannot change that without editing source and rebuilding.
**Effort:** small-to-moderate, and it is a genuine differentiator. A per-tenant
`label_overrides` JSON consulted by the i18n layer at runtime would do it; the
tenant settings blob already exists to hold it.

### 8.3 Licence models are not modelled — **GAP**
**Required:** named-user, concurrent-user, and unlimited-global licences, with a
clear tariff structure.
**Verified:** `models/license.py` carries a `plan` string and issue/expiry
dates. Seat limits live separately in `models/subscription.py`
(`max_admin_users`: 10 / 50 / -1). Searched the licence model and service for
`named`, `concurrent`, `unlimited`, `seat`: no matches.
**What that means:** `max_admin_users` is the closest thing to a *named-user*
licence and it is **enforced nowhere** (confirmed in the earlier audit).
**Concurrent-user licensing does not exist at all** — nothing counts or caps
simultaneous sessions, even though `user_sessions` already holds the data that
would make it measurable.
**Cost:** if STB chooses the concurrent model, there is nothing to enforce or
report against it.

### 8.4 GED integration — **GAP** (also listed at 1.x scope)
**Required here again:** *l'intégration avec la GED existante*, this time for
archived data specifically.
**Verified:** no CMIS, SharePoint, Alfresco or Nuxeo connector exists;
`.dockerignore` and the storage layer treat `uploads/` as local disk only.
**Blocked:** needs STB to name the product. CMIS is the vendor-neutral standard
and one adapter would cover Alfresco, Nuxeo and SharePoint.

### 8.5 Not code — carry into the commercial response
- **Tariff structure** (clear, transparent, detailed) — commercial.
- **Hosting on G-Cloud / N-Cloud** — the app runs on-premise
  (`docker-compose.onprem.yml`) and in public cloud (the current SaaS), so the
  capability is there; hosting *in a compliant local datacentre* is a
  deployment and contractual commitment, not a code property.
- **3-year warranty; corrective / evolutive / preventive maintenance** —
  contractual.

### 8.6 Verified as MET — do not treat these as gaps
| Requirement | Evidence |
|---|---|
| Response time < 2s for common operations | Measured 12 common endpoints, 5 runs each: worst case **325 ms**, median ≤ 137 ms, none over budget. Server-side only (excludes network and browser render), but the headroom is ~6x. |
| Archivage automatique selon règles configurables | `archiving/rules` create/list/delete, evaluated by `archiving_engine` |
| Consultation sans restauration manuelle | `GET /archiving/{id}` returns the JSON snapshot directly |
| Paramétrage des durées de conservation | `ArchivingRule.retention_days` → `ArchiveRecord.retention_until` + `POST /purge-expired` |
| Export PDF / Excel / CSV | All three verified working: csv 436 B/10 ms, xlsx 5.4 KB/39 ms, pdf 2.4 KB/34 ms; invalid format rejected 400 |
| Homogénéité graphique | Single shared component set and Tailwind config across all modules |
| Navigation claire et cohérente | One sidebar taxonomy, 4 groups, role-gated per item |

---

## 9. Habilitations and training (added 2026-09-04)

The eight roles STB names all exist and are enforced. The gaps are in what the
*Administrateur* role is required to manage, and in how far the *Propriétaire
métier* role actually reaches.

### 9.1 Délégations — **BUILT** (pending verification)
**Required:** the Administrateur manages *les délégations*.
**Verified:** no delegation model, endpoint or column exists anywhere —
searched `delegat*` across models and endpoints; the only hits are unrelated
prose in a docstring and a comment.
**Cost:** there is no way to hand someone else your authority for a holiday or
an absence, and no record that it happened. In a bank this is a routine
operational need, not an edge case.
**Effort:** moderate. Needs a delegation record (from, to, scope, start, end),
resolution inside `get_effective_roles`, automatic expiry, and an audit entry at
grant and revoke.

### 9.2 Revues d'habilitations — **BUILT** (pending verification)
**Required:** the Administrateur manages *les revues d'habilitations* — periodic
access recertification.
**Verified:** nothing exists — searched `access_review`, `recertif`,
`entitlement_review`, `attestation_campaign`: no matches. `PolicyAttestation`
is unrelated (it attests to reading a policy, not to holding an entitlement).
**Cost:** this is a named ISO 27001 / SOC 2 control and a standing audit
question. A GRC platform that cannot recertify its *own* access is an awkward
finding.
**Effort:** moderate, and the pieces exist. A campaign over
`get_effective_roles` output, per-user approve/revoke decisions, and the
hash-chained log to record them. The rights-change audit built in `7da7578`
already produces the "what changed since the last review" half.

### 9.3 Propriétaire métier is only half implemented — **BUILT** (pending verification)
**Required:** *qualification des actifs, validation des risques et des plans de
traitement sur son périmètre métier*.
**Verified:** `BUSINESS_OWNER` is granted on 4 endpoints — three in `assets.py`
(asset qualification, which matches) and one in `data_io.py`. No risk or
treatment-plan endpoint grants it. Confirmed by test: a business owner reads
risks (200) but cannot act on them (403).
**Cost:** two of the three responsibilities in the role definition are not
implemented.

### 9.4 No "périmètre métier" scoping — **BUILT** (pending verification)
**Verified:** access is tenant-wide. There is no per-owner, per-scope or
per-perimeter restriction on assets or risks — searched for owner-scoped
filtering in `assets.py` and `risks.py`: none.
**Cost:** a business owner sees and (where permitted) acts on the entire
tenant's data, not their own scope. Every role definition in this requirement
block is scoped by responsibility; the implementation is scoped only by tenant.
**Note:** this is the structural half of 9.3 — worth designing once, since
Responsable Risques and Analyste sécurité have the same "on their perimeter"
character.

### 9.5 Training plan is thin against what is asked — **PARTIAL**
**Verified:** `deliverables/STB_Training_Plan{,_FR}.pdf` exists in both
languages, but is **2 pages / ~4,900 characters**. It mentions hours,
installation, exploitation, sauvegarde and restauration, and names Direction,
auditeurs, support and escalade — but does not mention *paramétrage*, and does
not use STB's own four-profile taxonomy (Administrateurs techniques (DSI, RSSI
adjoint) / Utilisateurs fonctionnels / Direction et décideurs / Équipe support).
**Required and not evidently covered:** hours per business profile, the training
materials and tools, detailed session content per profile, the five named
technical sessions (architecture, server installation, exploitation, workstation
install transfer, application configuration transfer), and the 20 working days
of go-live assistance.
**Effort:** documentation only — regenerate from
`scripts/generate_stb_deliverables.py` against STB's structure.

### 9.6 `READ_ONLY_ROLES` is dead code — cosmetic
`models/user.py:45` defines it; nothing imports it. The behaviour is correct and
enforced — `dependencies/auth.py:76,84` block writes for VIEWER and EXECUTIVE
explicitly — so this is a tidy-up, not a hole. Noted only so nobody reads the
unused constant as the enforcement and "simplifies" the real checks away.

### 9.7 Verified as MET — do not treat these as gaps
| Requirement | Evidence |
|---|---|
| All 8 STB roles exist | `super_admin, tenant_admin, risk_manager, business_owner, security_analyst, ciso, auditor, executive` all in `UserRole` (13 defined in total) |
| Roles are actually enforced | Endpoint gate counts: CISO 110, tenant_admin 26, risk_manager 17, super_admin 16, auditor 13, security_analyst 10, business_owner 4 |
| Direction Générale = strategic read-only | Tested: dashboard 200, risks 200, create-risk **403**. Zero `require_roles(EXECUTIVE)` gates is correct by design — it reads through open endpoints and is write-blocked globally |
| Habilitations are traçables | Rights changes now write a before/after entry to the hash-chained log across admin, group and LDAP paths (`7da7578`, `5e878fd`) |
| Assistance corrective / évolutive / préventive | Contractual, not code |

---

## 10. Accounts, authentication, sessions (added 2026-09-04)

Audited against the account-creation, login and session requirements. Almost
all of it is already implemented and was verified by running it. **Two items
believed to be missing are in fact present** — recorded below with the evidence,
because assuming a gap that isn't there costs as much in a tender as missing one
that is.

### 10.1 Custom roles — **BUILT** (composition model; see note)
**Required:** role management adapted to the organisation.
**Verified:** `UserRole` is a fixed enum of 13 values. Groups
(`models/group.py`) bundle **existing** roles onto members — `roles` is a JSON
list of built-in role names — but there is no way to define a NEW role, and no
permission or capability model anywhere: authorisation is role-name based
throughout (`require_roles`).
**So:** an organisation can name a group freely and combine built-in roles into
it, which covers a good part of the need. What it cannot do is define a role
with its own permission set.
**Built:** the composition model — a tenant defines a role in its own
vocabulary ("Analyste Conformité STB") that resolves to a set of built-in roles,
expanded in `get_effective_roles` so every `require_roles` check honours it
unchanged. Composed roles are restricted to ASSIGNABLE_ROLES, so a custom role
cannot mint an administrator.

**Still not possible, deliberately:** a role with a genuinely bespoke permission
set. That needs ~377 routes moved from role-name checks to capability checks,
which would put every existing authorisation decision at risk for a requirement
the composition model already answers in practice. Revisit only if the client
asks for permissions the built-in roles cannot express between them.

### 10.2 Verified as MET — including two believed missing
| Requirement | Evidence |
|---|---|
| **Lockout after failed logins, paramétrable** | **Present and working.** Measured: 5 wrong passwords → 401 each, 6th → **423 Locked**; the correct password is then still refused (423) and `locked_until` is set. Defaults are 5 attempts / 15 minutes and are **tenant-configurable** — `resolve_security_settings()` overlays `Tenant.settings["security"]`, exposed by `GET`/`PATCH /tenants/current/security` |
| **MFA via the app, not email** | TOTP with `pyotp` verified against an enrolled device (`auth.py`), redeemed at `POST /auth/mfa-login`. No email-code path exists |
| New-device sign-in alerts to user **and** admin | `notification_generator.check_new_device_login` notifies the user (severity high) **and** every CISO/admin recipient in the tenant, excluding the user |
| Password-reset notice with cancel instructions | The reset email states "If you did not request this, you can safely ignore this email" |
| Professional email domain enforced | `users.py` rejects a mismatch against `Tenant.domain` when the tenant has one configured; tenants without a fixed domain are not blocked |
| Role required at account creation | `POST /users/create` requires a role |
| Temporary password expiring at first login | `must_change_password` set at creation, cleared on first password change |
| Enable / disable an account at any time | Verified: a deactivated account cannot log in (401) |
| Secure sessions, logout, session revocation | `user_sessions` with device/IP/user-agent; refresh-token revocation is now cross-worker (`4a440c4`) |

---

## 11. CVE knowledge base and impact scoring (added 2026-09-07)

Audited against the vulnerability-knowledge-base and impact-evaluation
requirements. Most was already built; the defects found are fixed and are
recorded here only where something is still outstanding.

### 11.1 CAPEC is bridged, not catalogued
**Required:** the knowledge base may draw on CVE **or** CWE **or** CAPEC.
**Built:** CVE (NVD, daily) and CWE (MITRE, 969 weaknesses, 30-day staleness
check). Each weakness carries MITRE's `Related_Attack_Patterns`, so a CVE sheet
shows the CAPEC ids it relates to and links out to cwe.mitre.org.
**Not built:** a local CAPEC catalog — the ids show as codes, not names, and
cannot be searched or filtered on. MITRE publishes CAPEC in the same shape as
CWE (`capec_latest.xml.zip`), so this is a near-copy of
`services/mitre_cwe_sync.py` plus one model. Effort: small.
**Why deferred:** the requirement reads "CVE ou CWE ou CAPEC", and CVE+CWE with
a CAPEC bridge answers it. Build it if STB asks for attack-pattern search
specifically.

### 11.2 One-off catch-up for the historic hollow entries
NVD publishes a CVE on reservation and analyses it days later. The old sync only
ever walked the *publication* window, so anything ingested before its analysis
landed stayed permanently score-less: **1,969 of 8,404 entries (23%)** had no
CVSS, no vector and no CWE, and never would have.

`ee2f...`/this commit adds the refresh pass, which fixes it **going forward** —
measured on a copy: one 7-day refresh healed 270 of them and populated tagged
reference links on 3,211 CVEs. The historic backlog still needs one wide pass,
which is an operator action, not code:
```
POST /api/v1/cve/sync?days=1&refresh_days=120
```
That walks 120 days of NVD analysis updates (NVD's maximum window) against
entries already held. It is bounded at 10 pages of 2,000 per pass, so it may
need running more than once; the response reports truncation explicitly.

### 11.3 Treatment priority does not read the vulnerability impact score
**Required:** "l'impact sert de base pour le calcul de la priorité dans le plan
de traitement des risques".
**Met, at the risk level:** `_derive_treatment_priority` derives the plan's
priority from `risk.severity`, which is likelihood x **impact** — so impact does
drive treatment priority today.
**Not connected:** the 0-100 composite vulnerability impact score is a finer
measure and feeds nothing downstream. The chain now exists to carry it
(vulnerability -> scenario -> risk -> treatment) and the scenario link screen
shows the score's equivalent level on the tenant's own scale, but a human still
transfers it.
**Deliberate.** Writing a computed score into a scenario's `current_impact`
would overwrite an assessor's judgement with an automatic one, and the two are
different claims — the composite rates one vulnerability on one asset, the
scenario's impact rates a whole threat chain. Revisit only if STB asks for the
propagation to be automatic, and then make it a suggestion the assessor accepts.

### 11.4 Verified as MET
| Requirement | Evidence |
|---|---|
| Daily sync with official sources | In-process loop, 6-hourly wake, 20h staleness gate; NVD publication + analysis-refresh passes, MITRE CWE on a 30-day gate. Both passes now paginate — the previous single 500-row request silently dropped the surplus on any day NVD published more than 500 CVEs, which is most weekdays |
| Pertinent / non pertinent / à surveiller | `CveAnnotation.relevance`, per tenant, plus a synthetic `untriaged` filter for the triage queue |
| Internal comments and links to affected assets | `notes` + `linked_asset_ids` on the annotation, edited from the CVE sheet |
| Advanced search: flaw type, criticality, attack vector, publication date | All four, and the flaw-type filter accepts a weakness **name** ("cross-site scripting") as well as a code. Two defects fixed: the relevance filter ran *after* `OFFSET/LIMIT` so it only searched one page of an 8,000-row catalog, and `CWE-79` also matched `CWE-798` |
| Detailed sheet: description, criticality, attack vector, known workarounds, links to fixes | `GET /cve/{id}` — description, CVSS decoded metric by metric, MITRE's weakness text with its published `Potential_Mitigations`, and NVD references carrying their Patch / Mitigation / Vendor Advisory / Exploit tags |
| Pertinent CVEs surfaced in a dashboard | `dashboards.py::_cve_summary`, rendered by `AnalyticsPage` |
| Impact from CVSS + operational context + asset value | `compute_impact_score`: 60% CVSS, 40% asset business value, scaled by a context weight (internet_facing 1.5 -> test 0.6) |
| Manual override with documented justification | `POST /{id}/impact` returns 400 without one |
| Impact tied to one or more risk scenarios | `GET`/`PUT /vulnerabilities/{id}/risk-scenarios`, writing through to `RiskScenario.vulnerability_ids` so there is one source of truth. Gated identically to `PATCH /risk-scenarios/{id}` |
| Every score change historised with date, author, reason | `VulnerabilityImpactHistory`, now also snapshotting the scenario set the score was judged against |

---

## 12. Threat register and threat profiling (added 2026-09-07)

Audited against the threat-register and threat-profiling requirements. The
profiling fields existed but had never been used — **0 of 6,030 threats had a
profile or a linked asset**, and built-in threats could not be profiled at all.

### 12.1 The pending queue was unmanageable — **FIXED**
The feed was writing every item into the register as a candidate threat: 4,515
pending, the oldest from 2026-04-14, across 11 tenants. Composition told the
real story — 45% malicious package URLs, 31% SANS diary entries **including
podcast episodes**, 20% CVE advisories. Nobody can write "origine probable,
objectifs, vecteurs d'attaque" for a podcast episode.

The requirement asks for the register to be *fed* by a continuous watch, not to
*be* the watch. Feeds now land in `threat_watch_items`, each item classified,
and a person promotes only what genuinely describes a new kind of threat.
Register and pending queue both stay flat across a sync — verified.

**Remaining:** 618 feed-shaped threats are already *approved* in the register
(someone used "Approve all" before this change). They are left alone because
deleting validated content is the tenant's call, not a migration's. They can be
removed from the Threat Library one at a time, or with a follow-up script if
STB wants them gone in bulk.

### 12.2 The scheduler still writes nothing to the activity chain
Feed-created threats now write to `threat_history` with a null actor, but the
scheduler remains one of the background writers that never touches the
hash-chained activity log (§3.2). Same fix as the others: call the helper
**after** the caller commits.

### 12.3 The seeded starter register is a starting point, not an assessment
The register held **four** authored threats across all 11 tenants, and nothing
environmental, physical, human-error or regulatory — the categories the
requirement names. `scripts/seed_threat_register.py` adds 38 banking threat
types across the four families, worded from EBIOS RM / ISO 27005 annex C /
ENISA and adapted to retail banking, in French.

No probability or severity is set on any of them: those are the organisation's
judgement. Each has to be adopted, completed and validated by STB before it
means anything. Confirm the wording with them rather than presenting it as
delivered content.

### 12.4 CATEGORY_TO_TYPE is a mapping, not an assessment
The four required families are derived from the existing nine-value category
when a profile does not state one. The API marks a derived value as derived and
the screen labels it, so nothing presents a guess as a judgement — but the
mapping itself (supply chain → operational, insider → organisational) is a
reasonable reading, not a standard. Confirm it with STB rather than assuming it.

### 12.5 Verified as MET
| Requirement | Evidence |
|---|---|
| Threats linked to assets **and** exploitable vulnerabilities | `linked_asset_ids` / `linked_vulnerability_ids`, now validated against the tenant — a forged or typo'd id is refused with 422 instead of stored |
| Continuous update from an integrated watch | CISA KEV (CERT), SANS ISC (RSS) and opensourcemalware (sector) on a 24h scheduler, plus a manual fetch — filed in the **watch**, promoted into the register by a person |
| CISA KEV reaches something that can act on it | A KEV advisory now marks the CVE knowledge-base entry as actively exploited, with CISA's required action and due date, and `GET /cve?known_exploited=true` filters on it. Verified: 9 CVEs flagged, 4 of them below CVSS 9 — which is the point, since active exploitation outranks a higher theoretical score |
| Classification by type and by likelihood | The four families as a first-class field with filters, alongside the probability and severity scales |
| New threats validated before integration | Every new threat now starts pending; the opt-out that let API-created threats skip it is gone |
| Change history per threat (add / update / delete) | `threat_history`, with before/after per field. A deletion is recorded **before** the row goes and keeps the reference and name, so it survives the threat |
| Complete profile, signed off by a security lead | Sign-off is its own act, gated to CISO / risk manager, and refuses an incomplete profile naming what is missing. It used to be a side effect of any save, gated only by the Elite flag |
| Minimum documentation | description, occurrence scenario, origin, attack vectors, probability, severity — enforced at validation, surfaced as `profile_missing` |
| Probability scale (rare → quasiment certain) | Exact five levels, validated |
| Severity scale (mineur → critique) | Exact five levels, validated |
| Periodic revision | A cadence (default 12 months), a due date set on validation and review, an overdue filter, and reminders at 14/7/0 days and while overdue — capped at 30 days, matching the risk and asset checks |
| All modifications historised | Editing a validated profile returns it to draft and records why, through either edit path |

### 12.6 Fixed along the way — the feed was duplicating itself
Both uvicorn workers run the feed scheduler, read the same "already known" set
and commit independently (the split-brain in `multi-worker-state-split-brain`,
now with evidence). Measured: **213 duplicate rows**.

The fix is a unique index, and choosing its key needed the data rather than an
assumption. Name alone rejects genuinely distinct threats — CISA publishes
CVE-2026-25089 and CVE-2026-39808 under the identical title "Fortinet
FortiSandbox OS Command Injection Vulnerability". Reference alone is worse
(1,416 false collisions) because feed items without their own identifier were
numbered by position in the batch, so `AUTO-SANS-2` had been given to **48
different threats across 396 rows**. `(tenant_id, ref_id, name)` leaves 213, and
those are real repeats. Feed references are now derived from the item's identity
instead, so they mean the same thing on every run.

**Not durable until the backend restarts.** The running process is on the old
code and will keep producing duplicates; with the index now in place it will hit
an IntegrityError and skip that feed cycle instead (logged, self-limiting).

