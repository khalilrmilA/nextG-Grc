# R2 — Full GRC lifecycle: fix list

Verified against the code on 2026-10-18 (commit `98020b3`, local main = remote main).
Today R2 is **Partial**: Audits are Strong, the other five areas are Partial. When all six
are Strong, R2 scores 1 and the BM-01 share goes from 63% to **69%**.

Most items are UI wiring: the backend route already exists, often with its role checks,
but no screen calls it.

Size: **S** = small (hours to a couple of days), **M** = medium (about a week or more).

---

## 1. Quick bugs (do first)

- [x] **S — Risk status chosen at creation is dropped.** *(R2 phase 1: `closed` refused with 422; verified on test copy)*
  The form sends `status` ([RisksPage.tsx:200](../../frontend/src/pages/RisksPage.tsx#L200)), but
  `RiskCreate` has no `status` field ([risks.py:123](../../backend/app/api/v1/endpoints/risks.py#L123)).
  Add `status: RiskStatus | None = None` to `RiskCreate` and apply it in `create_risk`.
- [x] **S — "Mitigate" treatment fails with 422.** *(R2 phase 1: field shown + validated for all options in create and supersede)*
  The backend requires a justification for **every** option
  ([risk_treatment.py:248](../../backend/app/api/v1/endpoints/risk_treatment.py#L248)). The form shows
  the field and validates it only for `accept`
  ([RiskTreatmentPage.tsx:162](../../frontend/src/pages/RiskTreatmentPage.tsx#L162), ~L510 and ~L595
  for supersede). Show it for every option and validate it the same way.

## 2. Risks

- [x] **S — Edit, re-assess, close, reopen and delete a risk from the UI.** *(R2 phase 2: RisksPage edit form + delete confirm; `RiskResponse` now returns org entity / process; close/reopen logged)*
  `risksApi.update` / `risksApi.delete` exist but nothing calls them
  ([endpoints.ts:420-422](../../frontend/src/api/endpoints.ts#L420-L422)).
  - The backend PATCH ([risks.py:348](../../backend/app/api/v1/endpoints/risks.py#L348)) already takes
    likelihood/impact, residual, target, owner, status, review date and scope.
  - It requires `reopen_reason` when a risk leaves `closed`.
  - DELETE ([risks.py:435](../../backend/app/api/v1/endpoints/risks.py#L435)) is CISO-only.
- [x] **S — Show risk history.** *(R2 phase 2: History tab with per-edit diff)* `/versions`, `/lifecycle` and `/versions/diff`
  ([risks.py:602-645](../../backend/app/api/v1/endpoints/risks.py#L602-L645)) have no frontend wrapper.
- [x] **S — Edit and delete risk scenarios.** *(R2 phase 2: confirmed `linked_incident_ids` was dropped at create — fixed)* `riskScenariosApi.update` / `.delete` exist with no caller
  ([endpoints.ts:2415-2416](../../frontend/src/api/endpoints.ts#L2415-L2416)).
  Create also drops `linked_incident_ids` (from the scorecard: re-check).
- [x] **S — Risk acceptance ↔ risk.** *(R2 phase 2: picker, reject + revoke routes, risk status sync incl. expiry; needs `migrate_r2_lifecycle`)* From the scorecard (re-check): an acceptance is not linked to
  its risk or scenario in the UI, there is no reject/revoke route, and approving does not update
  `Risk.status`.

## 3. Third parties (vendors)

- [x] **S — Edit, re-tier, change status / offboard, and delete a vendor.** *(R2 phase 3: partial `VendorUpdateRequest`; `POST /vendors/{id}/offboard` with date + reason; delete with confirm)* The backend has PATCH and
  DELETE ([vendors.py:760](../../backend/app/api/v1/endpoints/vendors.py#L760),
  [:803](../../backend/app/api/v1/endpoints/vendors.py#L803)). Add `vendorsApi.update` / `.delete`
  (they don't exist yet in [endpoints.ts](../../frontend/src/api/endpoints.ts#L1517)) and an edit
  screen. This also makes `contract_expiry` editable after a renewal, and that field drives the
  expiry alerts.
- [x] **S — Upload a new contract for an existing vendor.** *(R2 phase 3: Upload contract in the detail view, optional new expiry)* `uploadContract` is called only from the
  new-vendor wizard. Add it to the vendor detail view.
- [x] **M — Keep assessment history.** *(R2 phase 3: prescreen + approved AI analysis stored as `VendorAssessment`; Assessments tab + Reassess)* Prescreen answers are dropped at save. Approve-analysis
  overwrites `vendor.description` each run. `VendorAssessment` / `VendorRisk` are model-only.

## 4. Policies

- [x] **S — Employees acknowledge a policy.** *(R2 phase 4: `GET /policies/my-attestations` + My Policies page for every role)* `policiesApi.acknowledgeAttestation`
  ([endpoints.ts:1493](../../frontend/src/api/endpoints.ts#L1493)) has no caller.
  PoliciesPage already *displays* acknowledged status. Add a "policies to acknowledge" view for the
  assigned user.
- [x] **S — Author must not approve their own version (four-eyes).** *(R2 phase 4: also after restore; Approve version in PoliciesPage history)*
  `approve_version` ([policies.py:606](../../backend/app/api/v1/endpoints/policies.py#L606)) has no
  author ≠ approver check. Copy the pattern from
  [security_exceptions.py:205](../../backend/app/api/v1/endpoints/security_exceptions.py#L205).
  Version approval is currently reachable only from the Doc Generator; add it to PoliciesPage too.
- [x] **M — Controlled status flow and reminders.** *(R2 phase 4: transitions enforced, approved/published need a non-author version approval; review-due + overdue-acknowledgement reminders)* Status transitions are free today. Add review and
  attestation reminders (the notification deadline checker is the natural place).

## 5. Controls & evidence (compliance)

- [x] **M — AI re-run must merge, not replace (biggest item).** *(R2 phase 5: `services/compliance_merge.py`, `status_source` + `ai_suggested_*`, Accept in UI; `selftest_compliance_merge.py` runs the real task with a fake AI result)*
  [compliance.py:2645-2697](../../backend/app/api/v1/endpoints/compliance.py#L2645-L2697) deletes and
  recreates every control assessment the AI re-judges, including the evidence rows. That loses the
  manual status, owner, notes, N/A justification and auditor verdict.
  - Action items already survive.
  - File bytes are retired to the recovery list.
  - Fix: update existing rows in place, never overwrite a human-set value without confirmation, and
    keep the evidence attached.
- [x] **S — Create the control rows when an assessment is created.** *(R2 phase 5 + `scripts/backfill_control_assessments.py`)* `POST /compliance/assessments`
  creates no `ControlAssessment` rows, so appliance tenants and later-added frameworks need an AI run
  before anyone can assess by hand. Create one `NOT_STARTED` row per control, as registration does
  ([auth.py:642-652](../../backend/app/api/v1/endpoints/auth.py#L642-L652)).
- [x] **M — Let control owners self-assess.** *(R2 phase 5: reads + update/evidence open to compliance_manager tenant-wide and control_owner on owned rows; create/analyze CISO + compliance_manager)* These write routes are CISO-only:
  - create assessment ([compliance.py:1651](../../backend/app/api/v1/endpoints/compliance.py#L1651))
  - upload document ([:2346](../../backend/app/api/v1/endpoints/compliance.py#L2346))
  - analyze ([:2858](../../backend/app/api/v1/endpoints/compliance.py#L2858))
  - update control ([:2941](../../backend/app/api/v1/endpoints/compliance.py#L2941))
  - upload evidence ([:3671](../../backend/app/api/v1/endpoints/compliance.py#L3671))

  Allow owner-scoped writes (`services/perimeter.py`) and align `ROUTE_ROLES`.
- [x] **M — Evidence validity.** *(R2 phase 5: valid until on upload, badges, expired-only flag, 30/7/0-day reminders)* `valid_until` is unused. Add expiry plus renewal reminders.
- [x] **S — Recovery list UI.** *(R2 phase 5: Deleted files panel via FileHistoryModal, CISO)* `complianceApi.listDeletedFiles` has no caller.
- [x] **M — Roll applied controls up into requirement status.** *(R2 phase 5, optional item: shown per requirement as information only — status never changed automatically)* The `framework_control_ids` and
  evidence links on applied controls are backend-only; compliance never reads them.

## 6. Audits (already Strong; caveat only)

- [x] **S — `ActionItem.finding_id` is never written** *(R2 phase 6: no code path created finding-linked actions at all — added `recommendation_id`/`finding_id` to POST /compliance/action-plan, Add action on Recommendations, `scripts/backfill_action_item_findings.py`; report action-plan section verified)*, so the finding progress roll-up and the
  report's action-plan section are empty.

---

## Before shipping (this repo is the live grceye.com server)

- A backend change needs `pm2 restart grceye-backend`. There is no hot-reload, and there are 2 workers.
- A new **column** (e.g. a policy author field) needs a hand-written, idempotent `ALTER` script in
  `backend/scripts/`. Alembic is not used. New tables are auto-created.
- Snapshot `backend/grc_dev.db` before testing anything that writes. It holds real data and has no
  backups.
- Keep the role arrays in `Layout.tsx` and `ROUTE_ROLES` in `App.tsx` in sync if you widen access.

---

## R2 implementation — production run-book (branch `feat/r2-lifecycle`, not deployed)

All scripts are idempotent, dry-run by default (`--apply` writes), take `--db <sqlite path | async URL>`
and work on SQLite and PostgreSQL. From `backend/`:

1. Snapshot the database first (no scheduled backups exist):
   `python3 -c "import sqlite3; s=sqlite3.connect('file:grc_dev.db?mode=ro', uri=True); d=sqlite3.connect('grc_dev_pre_r2.db'); s.backup(d)"`
2. `venv/bin/python -m scripts.migrate_r2_lifecycle` → then `--apply` (22 columns on 6 tables).
   **Before** restarting the backend: the models already declare these columns.
3. `venv/bin/python -m scripts.backfill_control_status_source` → `--apply` (marks rows a person set;
   2 on the 2026-10-18 snapshot). Run before any AI re-run on the new code.
4. `venv/bin/python -m scripts.backfill_control_assessments` → `--apply` (1456 rows / 24 assessments
   on the snapshot).
5. `venv/bin/python -m scripts.backfill_action_item_findings` → `--apply` (0 on the snapshot).
6. `pm2 restart grceye-backend`, then `cd frontend && npm run build` (the gateway serves `frontend/dist`).

Tests: `scripts/selftest_r2_lifecycle.py` (103 checks) and `scripts/selftest_compliance_merge.py`
(34 checks) on a migrated snapshot copy.

---

## Re-check after the fixes (2026-10-18, main @ `2e2399c`)

This was an independent review: 4 code reviews (one per area), plus both selftests run on a fresh
database. The database was built from the current models, the demo tenant, 77 frameworks and the
demo role accounts.

- `selftest_r2_lifecycle`: **112 passed, 0 failed**.
- `selftest_compliance_merge`: **34 passed, 0 failed**.
- `migrate_r2_lifecycle`: 22 columns added, and idempotent when re-run.

| Area | Verdict |
|---|---|
| Risks | ✅ Strong |
| Third parties | ✅ Strong |
| Controls | ✅ Strong |
| Evidence | ✅ Strong |
| Audits | ✅ Strong |
| Policies | 🟡 Partial: the periodic **review** step is API-only |

**R2 is still Partial (5 of 6 areas Strong).** Fixing item R-1 makes it Strong, which takes the
BM-01 share to 69%.

### Needed for Strong

- [ ] **R-1 (S) — Policy periodic review in the UI.**
  - No screen sets or moves `next_review_date`. The New policy form sends only
    `review_frequency_months` (PoliciesPage.tsx ~L93-99). The only `policiesApi.update` call
    changes the status (~L1153). The backend never computes the date (policies.py ~L395-402).
  - So the review-due reminder never fires for policies created in the UI, and nobody can record
    that a review was done. Title, description and owner can't be edited either.
  - Fix:
    - On publish, set `next_review_date = today + review_frequency_months`.
    - Add **Mark as reviewed**, which records who and when and moves the date forward.
    - Add an **Edit details** form: title, description, owner, frequency and next review date.

### Fix before deploying (bugs, not rating)

- [ ] **D-1 (S, regression) — Deleting a draft assessment fails with 500.**
  - Every new assessment now has rows, but the relationship has no delete cascade and
    `control_assessments.assessment_id` is NOT NULL.
  - Reproduced on the test copy: `IntegrityError … NOT NULL constraint failed`.
  - In production, a 5xx sends the SPA to `/service-down`.
  - Fix: delete the draft's rows (and their gaps and evidence, retiring file versions) before the
    assessment, or refuse with a 409 and offer Archive.
  - Look at: compliance.py delete route ~L2150; models/compliance.py ~L99-101.
- [ ] **D-2 (S) — `backfill_control_status_source.py` misses rows closed or reopened through the
  action plan.**
  - Those rows keep their `ai_confidence`, and the request path is `/action-plan/…`, not
    `/control-assessments/`.
  - The first AI re-run in production would then overwrite those closures.
  - Fix: also match action-plan close/reopen activity entries, or controls whose action items were
    closed by a person.
- [ ] **D-3 (S) — `ai_suggested_at` is 32 characters** (`2026-10-18T19:10:48.975189+00:00`) in a
  VARCHAR(30) column.
  - SQLite ignores the limit, but PostgreSQL rejects it, which would fail the whole analysis.
  - Fix: widen the column to 40 in both the model and the migration script.

### Worth fixing (major, not blocking)

- [ ] An expired risk acceptance syncs `Risk.status` only when someone opens Exceptions & Waivers
  (security_exceptions.py ~L351). Until then the risk stays "accepted". Run the sync in the daily
  notification check.
- [ ] Policies:
  - Auditors receive attestations, but their portal has no My Policies page.
  - Attestations can be sent on an unapproved version, and acknowledged on a retired policy.
  - "Attest all" creates duplicate pending rows.
- [ ] Vendors:
  - After the CISO approves a contract it leaves the queue, so **Send to vendor** is never reachable
    (ContractReviewPage.tsx ~L69-70; this was already broken before R2).
  - After approving an AI analysis, the vendor list keeps the old score until the page is reloaded.
- [ ] Compliance:
  - The gap accept/reject buttons show to roles the backend refuses (403).
  - The visibility toggle response drops `valid_until`, so the badge disappears until reload.
  - A user who is both control_owner and an organisation-wide role is not limited to their own rows.

### Minor (from the reviews)

- Risk edit can't clear optional fields (owner, review date, residual), and saves 3×3 or
  "Technical" when values are empty.
- Vendor contract upload can create duplicate versions after a partial failure; delete-refusal
  messages say "set to inactive", but Edit now refuses that (use Offboard); expiry alerts still fire
  for offboarded vendors.
- Policy version approval is not in the activity log; errors on the History tab are invisible.
- Evidence upload and document upload never commit before returning, so the activity log entry
  times out and is lost. This was already the case before R2.

Not verified here: `tsc` and `eslint`, because `frontend/node_modules` isn't installed on this
machine. UI flows were checked by code tracing and API tests, not by clicking.

---

## Live browser test on grceye.com (2026-10-18, test tenant "Elite Pack Demo")

Each step was clicked in a real Chrome browser with the test account. Everything created was
labelled `[R2 test]` and removed afterwards, except one pending acceptance (see below).

| Area | Live result |
|---|---|
| Risks | ✅ Create with a status, re-score (16→8), close, reopen refused without a reason, reopen with a reason, History tab, treatment "Mitigate", scenario create/edit/delete, acceptance linked to the risk (requester sees "Awaiting another approver"), delete |
| Third parties | ✅ Onboard with the AI prescreen, edit and re-tier, new contract → AI review → CISO queue, reassess (2 assessments, one "Current"), offboard with date and reason, delete |
| Controls | ✅ 16 rows "Not Started" right after creation, manual status, owner and justification saved |
| Evidence | ✅ Upload with "valid until" ("Expires in 18 days" badge), delete, shown in **Deleted files** |
| Policies | 🟡 Draft → In Review; the author sees no Approve button and the API refuses it with 403 (four-eyes); publishing an unapproved version is refused (409); attestation → **My Policies** → "I have read and accept" → Acknowledged; retire; delete. **No way to set or record a periodic review (R-1).** |
| Audits | ❌ **The audit detail page never loads** (see A-1). You can create an audit, but findings, recommendations, the report and delete can't be reached. |

**Verdict in the live UI: R2 is still Partial.** Risks, third parties, controls and evidence are
Strong. Fixing **R-1** (policy review) and **A-1** (audit page) makes all six Strong.

### New from the live test

- [ ] **A-1 (S, blocks Strong; already broken before R2, since `d565c20`, 2026-09-08)** — The audit
  detail page spins forever.
  - The route is `audits/:auditId` (App.tsx ~L273), but the page reads `useParams<{ id }>()`
    (AuditDetailPage.tsx ~L426). So `auditId` is empty, `loadAudit()` returns early and
    `/api/v1/audits/{id}` is never called.
  - Every link to it is affected: AuditsPage rows and RecommendationsPage.
  - Fix: `const { auditId = "" } = useParams<{ auditId: string }>();`
- [ ] **D-1 confirmed in production:** `DELETE /compliance/assessments/{draft}` returns **500**. The
  test assessment had to be archived instead.
- [ ] **(S) Deleting a scenario leaves its mirror risk in the register.** Creating a scenario adds a
  matching "[name]" risk to the register; deleting the scenario doesn't remove or close it.
- [ ] **(S) Scenario table:** the Edit/Delete/History buttons are off-screen at 1440 px; users must
  scroll sideways.
- [ ] **(S) Attestations go out on unapproved versions.** This is confirmed live: a version
  "Awaiting approval" was sent and acknowledged.
- [ ] **(S) A pending risk acceptance can't be withdrawn by its requester**, and there is no delete.
  A single-user tenant can never clear it. Left in the test tenant:
  `[R2 test] Accept VPN risk until patch window`. It needs a second user to reject it.
- [ ] Minor:
  - The control status dropdown shows "Compliant" while a row is Not Started (its default value is
    `implemented`).
  - The gap text says "assessed as not compliant" for a *partially* compliant control.
  - The Risk/Governance dashboard widgets show "Restricted view" (403) to the account owner.
  - The AI prescreen failed once with 424 (transient); the retry worked.
