# Prompt — close the BM-01 R2 gaps (full GRC lifecycle)

> Paste everything below this line into Claude Code (or another coding agent) opened at the repo
> root, or tell it: *"Read docs/architecture/R2_Fix_Prompt.md and follow it."*
> Recommended: run one phase per session and review each phase before starting the next.

---

## Your task

You are working in the GRCEye repository: a FastAPI + SQLAlchemy backend in `backend/` and a
React 18 + TypeScript + Vite SPA in `frontend/`. Read `CLAUDE.md` first. This working copy is the
**live production server for grceye.com** and holds real client data.

Goal: make every one of the six GRC areas work **end to end inside the app**: create, maintain,
and close or retire. The six areas are risks, controls, evidence, policies, audits and third
parties. That is the bar for requirement **R2 = Strong** in the BM-01 benchmark. Today only Audits
meet it.

Almost every gap is **UI wiring over a backend route that already exists**. Prefer wiring and small
fixes over new modules. The full gap list, with file:line references verified on 2026-10-18, is
`docs/architecture/R2_Lifecycle_Fix_List.md`. Tick its boxes as you finish items. **Line numbers
may have drifted, so re-locate each symbol before editing.**

## Hard rules (production safety, non-negotiable)

1. **Branch.**
   - Run `git status` first. If the R3 Arabic-font changes are still uncommitted (`backend/app/assets/`,
     `pdf_arabic.py`, `ocr.py`, `pyproject.toml`, `build ova/scripts/25-protect-app.sh`), **stop and
     ask the user** whether to commit them first. Never mix them into R2 commits.
   - Then create `feat/r2-lifecycle` from `main`.
   - Commit locally at the end of each phase. **Do not push, merge or deploy.**
2. **Never touch the live services.**
   - Do not run `pm2 restart`.
   - Do not start, stop or rebuild the dashboard on :4000.
   - Do not run `npm run build`.
   - If a Vite dev server on :4000 is serving *this* folder, every frontend edit hot-reloads into
     production. Check with `Get-NetTCPConnection -LocalPort 4000`. If it is running, do all
     frontend work in a separate git worktree.
3. **Never write to `backend/grc_dev.db`.** It is real data with no backups. Test only against a copy
   (see "Test instance").
4. **Migrations are manual.** Alembic is dead.
   - A new column on an existing table needs an **idempotent** script in `backend/scripts/`. It
     checks `PRAGMA table_info` before each `ALTER TABLE … ADD COLUMN`, works on SQLite and
     PostgreSQL, and takes `--db` with a dry-run default.
   - New tables auto-create via `create_all()`.
   - List every script the user must run in production, in order, in your final report.
5. **No new dependencies** unless unavoidable, and if one is, say why. AI goes through the existing
   Ollama provider, never the Anthropic API.
6. **Don't fix unrelated things.** Note anything else you find in the final report instead.

## Patterns every change must follow

- **Tenancy and auth.**
  - Every query is filtered by `tenant_id` (`get_tenant_id`).
  - Writes use `require_roles(...)`. `tenant_admin` and `super_admin` auto-pass.
  - Scoped roles use `app/services/perimeter.py` (`is_perimeter_scoped`, `owns`,
    `assert_in_perimeter`).
  - The backend is the source of truth: hide UI buttons for roles that would get a 403.
- **Routes.** If you add or widen a page's access, keep `Layout.tsx` nav `roles` and `ROUTE_ROLES`
  in `App.tsx` in sync.
- **Four-eyes.** Copy the pattern in `security_exceptions.py` (`approve_exception`): requester or
  author ≠ approver gives a localized 403, and the state is checked before the transition (409).
- **Commit before returning.** On write endpoints, `await db.commit()` before returning; see the
  comment in `create_risk`. The ActivityLogMiddleware otherwise deadlocks SQLite.
- **Activity log.** Business events (close, reopen, offboard, approve, acknowledge, delete) must
  appear in the activity log. Check whether the middleware already covers the route; otherwise call
  `log_activity` (`activity_log.py`).
- **i18n.** Every new UI string needs **en, fr and ar** keys (`frontend/src/i18n/locales/{en,fr,ar}.ts`
  or the matching `i18n/sweep/*` file). Backend user-facing errors use the endpoint's existing
  `_msg`/`_t` tables in en/fr/ar. Check new screens in Arabic (RTL) mode.
- **UI conventions.**
  - Page wrapper: `p-8 max-w-7xl space-y-6`.
  - Modals: `fixed inset-0 z-50 bg-black/40 backdrop-blur-sm`.
  - Badges: `rounded-full px-2.5 py-0.5 text-xs font-semibold`.
  - A destructive action needs a confirm dialog, plus a reason where the backend asks for one.
- **Celery.** Any Celery `.delay()` goes in `try/except` (no Redis in dev).

## Test instance (never test against :8000)

1. Copy `backend/grc_dev.db` and `backend/uploads/` into the session scratchpad.
2. On the **copy only**, remove outbound integrations so test actions can't reach real clients:
   ```sql
   UPDATE tenants SET settings = json_remove(settings, '$.webhooks');
   ```
   Also check `tenants.settings` for other outbound targets (Slack, Teams, SIEM) and remove them.
3. Start a second backend from `backend/` on **:8001** with these env vars, which override
   `.env.local`:
   - `DATABASE_URL=sqlite+aiosqlite:///<abs path to copy>` and `UPLOADS_DIR=<abs path to uploads copy>`
   - `SMTP_HOST=127.0.0.1` and `SMTP_PORT=1`
   - Every scheduler off (`=0`): `ENABLE_THREAT_SCHEDULER`, `ENABLE_REPORT_SCHEDULER`,
     `ENABLE_CVE_AUTOSYNC`, `ENABLE_CWE_SYNC`, `ENABLE_VULN_SCANNER_SCHEDULER`,
     `ENABLE_AUDIT_RECURRENCE_SCHEDULER`, `ENABLE_ARCHIVING_SCHEDULER`,
     `ENABLE_FILE_RETENTION_SCHEDULER`, `ENABLE_RISK_SNAPSHOT_SCHEDULER`,
     `ENABLE_TREND_SNAPSHOT_SCHEDULER`, `ENABLE_NOTIFICATION_SCHEDULER`,
     `ENABLE_LICENSE_PHONE_HOME`, `ENABLE_TRANSLATION_WORKER`
4. Confirm in the startup log that no scheduler started.
5. Exercise the API with curl or httpx against :8001, using demo accounts from `CLAUDE.md` that exist
   in the copy. If you click through the UI, run a second Vite on another port with its `/api`
   proxy pointed at :8001. **Don't edit `vite.config.ts` for this; use a temporary config file.**

**Checks for every phase:**
- Backend: `python -m py_compile` on each changed file, then the relevant `backend/scripts/selftest_*.py`.
  For any non-trivial backend logic, add a new `selftest_<topic>.py` in the same style.
- Frontend: `npx tsc --noEmit -p frontend` and `npm run lint --prefix frontend`. Record the lint
  baseline first, and only make sure you add no new warnings.

---

## Phase 1 — Quick bugs

**1.1 Risk status chosen at creation is dropped.**
- `RiskCreate` (`risks.py`) has no `status`, yet `RisksPage.tsx` sends it.
- Add `status: RiskStatus | None = None`. Reject `closed` at creation with 422, because closing goes
  through PATCH and its reopen rules.
- In `create_risk`, drop the key when it is None so the model default still applies.
  `Risk(**body.model_dump())` would otherwise write NULL.
- *Done when:* creating a risk with status `assessed` returns `assessed`, and omitting it returns the
  default.

**1.2 Treatment justification.**
- `_require_justification` (`risk_treatment.py`) requires a justification for **every** option, but
  `RiskTreatmentPage.tsx` shows and validates the field only for `accept`. That makes `mitigate`,
  `transfer` and `avoid` fail with 422.
- Show the field for all options in both the create form and the supersede form, and validate it
  the same way. Use the label "Justification", or keep "Acceptance justification" for accept.
- *Done when:* each of the four options saves from the UI.

## Phase 2 — Risks

**2.1 Edit, re-assess, close, reopen and delete.**
- Wire `risksApi.update` and `risksApi.delete` (`endpoints.ts`, currently unused) into `RisksPage`.
- Add an **Edit** action, reusing the create form, for: title, description, category, owner,
  likelihood/impact, residual and target likelihood/impact, next review date, tags, linked
  controls, and org entity / business process.
- Status changes go through the same form. When moving **from** `closed`, show a required
  `reopen_reason` box; the backend enforces it.
- PATCH allows CISO, risk_manager and business_owner, with perimeter checks for scoped roles.
  **Delete** is CISO-only and needs a confirm dialog.
- Check that `RiskResponse` returns `org_entity_id` and `business_process_id` so the edit form can
  pre-fill them. Add them if they are missing.

**2.2 History.**
- Add `endpoints.ts` wrappers for `GET /risks/{id}/versions`, `/lifecycle` and `/versions/diff`.
- Add a **History** tab to the risk detail panel: who changed what, when, and the diff.

**2.3 Risk scenarios.**
- Wire `riskScenariosApi.update` and `riskScenariosApi.delete` into `RiskScenariosPage`: an edit
  modal that re-scores current and target probability/impact and links, and a delete with confirm.
- Check whether the create schema drops `linked_incident_ids`. Fix it if so.

**2.4 Risk acceptances.** The `RiskAcceptance` model has `risk_ids` and `risk_scenario_ids` (JSON)
and status `pending/approved/rejected/expired`.
- In the `SecurityExceptionsPage` create form, add a picker for the risks and scenarios being
  accepted.
- Add `PATCH /security/acceptances/{aid}/reject` (CISO, reason required) and a revoke action.
  Revoke could map to `expired` with a reason, or add `revoked` if you prefer; justify the choice.
- Enforce four-eyes on acceptance approve and reject if it is missing.
- On approve, set each linked `Risk.status` to `accepted`. On revoke or expiry, return it to its
  previous status, or to `assessed` if the previous status is unknown.

## Phase 3 — Third parties

**3.1 Vendor maintenance.**
- Add `vendorsApi.update` and `vendorsApi.delete`. They don't exist in `endpoints.ts` yet; the
  backend has `PATCH /vendors/{id}` and `DELETE /vendors/{id}`.
- Note that PATCH takes the full `VendorCreateRequest`. Prefer adding a partial `VendorUpdate`
  schema (all optional, applied with `exclude_unset=True`). If you keep the full schema, the UI
  must send the whole object.
- In `VendorsPage`, add an **Edit** action covering profile, risk tier, status, contract expiry and
  contact details.
- Add **Offboard**: a status change from `VendorStatus` (`models/vendor.py`). It needs a date and
  a reason. If those have no column, add one via an idempotent script.
- Add **Delete** with confirm. The backend already preserves approved and signed contracts.
- Roles: `vendor_manager` and CISO.

**3.2 New contract for an existing vendor.**
- `uploadContract` is only called from the new-vendor wizard. Add **Upload contract** to the vendor
  detail view. It must enter the same AI review → CISO review → send-to-vendor flow.
- After a renewal, the user must be able to update `contract_expiry`, because it drives the 90/60/30/7/0-day
  alerts.

**3.3 Assessment history.**
- Prescreen answers are dropped at save, and approve-analysis overwrites `vendor.description` every
  run. `VendorAssessment` and `VendorRisk` exist as models but are never used.
- Persist every prescreen and AI analysis as a `VendorAssessment` row: answers, score, narrative,
  who and when. Add any missing columns via script.
- Add an **Assessments** tab with the history and a **Reassess** action that runs the prescreen
  for an existing vendor.
- Keep `vendor.risk_score` pointing at the latest approved assessment.

## Phase 4 — Policies

**4.1 Acknowledgement.**
- `policiesApi.acknowledgeAttestation` has no caller. Also, `/policies` in `ROUTE_ROLES` excludes
  most roles, so ordinary employees can't even reach the page.
- Add `GET /policies/my-attestations`: the current user's attestations with the policy title,
  current version and due date. Check first that it doesn't already exist.
- Add a page or panel reachable by **every** authenticated role, for example `/my-policies` or a
  dashboard card. It lists pending attestations, shows the current version's content and offers an
  **I have read and accept** button.
- `PoliciesPage` already shows acknowledged status. Make sure it refreshes.

**4.2 Four-eyes on version approval.**
- `approve_version` (`policies.py`) has no check. Reject the request when
  `version.authored_by_id == user.id`, with a localized 403.
- Restore creates a new version authored by the restorer, so it also needs another approver.
- Add **Approve version** to the `PoliciesPage` versions panel; today it is reachable only from the
  Doc Generator.

**4.3 Status workflow.**
- `PolicyUpdate.status` is a free string today. Validate it against `PolicyStatus`
  (`draft → in_review → approved → published → retired`) and enforce allowed transitions in
  `update_policy`.
- `approved` and `published` require the current version to be approved by someone other than its
  author. Show the allowed next steps as buttons in the UI.

**4.4 Reminders.**
- In the notification deadline checker (`notification_generator.py` / "Check Deadlines"), add:
  - policy review due (`next_review_date`);
  - pending attestations past `due_date`.

## Phase 5 — Controls and evidence

**5.1 AI re-run must merge, not replace. This is the biggest item.**
- In `compliance.py`, the "Clear previous results" block of the analysis task deletes and recreates
  every `ControlAssessment` the AI re-judges, and the evidence rows with them.
- Change it to **update rows in place**:
  - Add a marker for human-set values. Read the `ControlAssessment` model first. If no field fits,
    add `status_source` (`ai`/`human`) via an idempotent script.
  - Set the marker to `human` in `update_control_assessment` and to `ai` in the analysis.
  - The AI **never overwrites** a human-set status, owner, notes, N/A justification or auditor
    verdict. Store its opinion in a separate field (e.g. `ai_suggested_status` plus
    `ai_confidence`). Show it as "AI suggests X" with an **Accept** button.
  - Evidence rows stay attached; **no deletes** in a re-run.
  - Gaps may be recomputed, but keep the existing action-item re-linking.
- Extract the merge into a pure function and cover it with
  `backend/scripts/selftest_compliance_merge.py`, so it is testable without Ollama. Cases:
  - human row kept;
  - AI row updated;
  - new control created;
  - evidence untouched;
  - missing verdict preserved.
- Before a re-run, the UI states how many human-reviewed controls will be kept.

**5.2 Control rows from day one.**
- `POST /compliance/assessments` creates no `ControlAssessment` rows. Appliance tenants and
  frameworks added later therefore need an AI run before anyone can assess by hand.
- When a **new** assessment is created (not when an existing one is returned), create one
  `NOT_STARTED` row per framework control, including `status_key` as the analysis code sets it.
  Mirror the registration code in `auth.py`.
- Add `backend/scripts/backfill_control_assessments.py` (idempotent, dry-run default) for existing
  assessments that have zero rows.

**5.3 Control owners self-assess.**
- `update_control_assessment` and `upload_control_evidence` are CISO-only.
- Allow `compliance_manager` tenant-wide, and `control_owner` only on rows where
  `ControlAssessment.owner_id == user.id`, enforced with perimeter/`owns`.
- `create_assessment` and `analyze` stay with CISO and compliance_manager.
- Align `ROUTE_ROLES`, and hide controls the user can't act on.

**5.4 Evidence validity.**
- The Evidence model has `valid_from` and `valid_until`, but they are unused.
- Add **Valid until** to the evidence upload forms, and show *expired* / *expires in N days* badges.
- In the deadline checker, notify at 30, 7 and 0 days before expiry.
- Flag a control whose only evidence has expired.

**5.5 Recovery list.**
- `complianceApi.listDeletedFiles` and `downloadFileVersion` have no caller. Add a CISO-only
  **Deleted files** panel: list them and download a version. Its natural home is next to
  `FileHistoryModal`.

**5.6 (Optional, beyond the Strong bar) Applied-control roll-up.**
- In `AssessmentDetailPage`, for each requirement, show the applied controls that implement it, via
  `AppliedControl.framework_control_ids`, with their status and progress.
- Show it as information or a suggestion only. Never change a requirement's status automatically.

## Phase 6 — Audit caveat

**6.1** `ActionItem.finding_id` is never written, so the finding progress roll-up and the audit
report's action-plan section are empty.
- Find where action items are created from findings or recommendations and set `finding_id` there.
- Add an idempotent backfill script that links existing items through their recommendation's
  `finding_id`.
- *Done when:* a generated audit report shows the action-plan section.

## Phase 7 — Documentation and final check

1. The in-app knowledge base (`frontend/src/kb/en.ts`, plus fr and ar) documents no edit, close,
   offboard or acknowledge flows. Add them, and fix the "choose a status" text if it changed.
2. Tick the boxes in `docs/architecture/R2_Lifecycle_Fix_List.md`.
3. **R2 walkthrough on the test instance.** For each area, show create → maintain → close/retire
   done **in the UI** with the role that should do it:
   - **Risks:** create → edit and re-score → treat → accept → close → reopen with a reason.
   - **Controls and evidence:** new assessment has rows → owner self-assesses → evidence with expiry
     → AI re-run keeps human work.
   - **Policies:** draft → in review → approved by a second person → published → employee
     acknowledges → retired.
   - **Audits:** unchanged, plus the action-plan section filled.
   - **Third parties:** onboard → reassess → new contract → edit tier → offboard.
4. **Final report.** For every item:
   - done, partial or skipped, and why;
   - files changed;
   - how it was verified;
   - the **production run-book** in order: scripts to run (dry-run first), then
     `pm2 restart grceye-backend`, then frontend reload steps, then what to check afterwards.

   Do not deploy. Stop and wait for the user's review.
