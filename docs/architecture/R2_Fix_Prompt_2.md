# Prompt 2 — close the remaining R2 gaps and the bugs found in review and live testing

> Paste everything below this line into Claude Code (or another coding agent) opened at the repo
> root, or tell it: *"Read docs/architecture/R2_Fix_Prompt_2.md and follow it, phase A only."*
> Run one phase per session and review it before starting the next.

---

## Your task

You are working in the GRCEye repository: a FastAPI + SQLAlchemy backend in `backend/` and a
React 18 + TypeScript + Vite SPA in `frontend/`. Read `CLAUDE.md` first.

A first R2 pass is already on `main` (commits `401b0cb..2e2399c`). It was then:
- re-checked by code review;
- tested with `selftest_r2_lifecycle.py` (112/112) and `selftest_compliance_merge.py` (34/34);
- **clicked through on grceye.com** with a test account.

The results are in `docs/architecture/R2_Lifecycle_Fix_List.md`, sections **"Re-check after the
fixes"** and **"Live browser test on grceye.com"**. Read both before you start. **Line numbers
there may have drifted, so re-locate each symbol before editing.**

**Goal:** make all six R2 areas Strong in the **UI**, and fix the bugs listed below. The six areas
are risks, controls, evidence, policies, audits and third parties. Strong means each one can be
created, maintained and closed or retired in the product. Today Policies (periodic review) and
Audits (the detail page never loads) block it. Prefer small, targeted fixes. Don't refactor
unrelated code.

## Hard rules (production safety, non-negotiable)

1. **Branch.** Run `git status` first. Create `fix/r2-followups` from `main`, and commit locally at
   the end of each phase. **Do not push, merge or deploy.**
2. **Never touch live services or real data.**
   - Don't run `pm2 restart` or `npm run build`, and don't start or stop anything on :3000, :4000
     or :8000.
   - Never write to any real `grc_dev.db`.
   - If this machine is the production server (check `pm2 ls` and the listeners on those ports)
     and a Vite dev server serves this folder, work in a separate git worktree.
3. **Migrations are manual.** A new column needs an **idempotent** script in `backend/scripts/`:
   - check before `ALTER`, dry-run by default, `--apply` to write;
   - takes `--db`, and works on SQLite and PostgreSQL;
   - follow the pattern of `scripts/migrate_r2_lifecycle.py`; you may extend it.

   New tables auto-create. List every script to run in production, in order, in your final report.
4. **No new dependencies** unless unavoidable. AI only through the existing Ollama provider.
5. Where an item says **ASK**, stop and ask the user before implementing it. It's a product decision.

## Patterns every change must follow

These are the same as the first prompt (`docs/architecture/R2_Fix_Prompt.md`, "Patterns"):

- **Tenancy and roles.** Every query is filtered by `tenant_id`. Writes use `require_roles(...)`,
  and scoped roles go through `services/perimeter.py`. Hide UI actions the backend would refuse
  with 403. Keep `Layout.tsx` nav roles and `App.tsx` `ROUTE_ROLES` in sync.
- **Four-eyes.** Use the pattern in `security_exceptions.py`.
- **Commit before returning** on write endpoints. Log business events with `log_activity`.
- **i18n.** Every new string in **en, fr and ar**: frontend in `src/i18n/sweep/r2_lifecycle.ts` or
  a new sweep file, backend in the endpoint `_msg`/`_t` tables or `core/locales/messages_*.json`.
  Check RTL.
- **UI conventions.** Use the existing modal, badge and confirm-dialog conventions.

## Test setup (no real database here)

**Build a disposable test database** in the session scratchpad:

1. Create it from the current models:
   ```
   DATABASE_URL=sqlite+aiosqlite:///<abs scratch path>/t.db ENABLE_TRANSLATION_WORKER=0 python -m app.startup
   ```
   This creates the tables, the demo tenant and the demo logins.
2. Copy `frameworks` and `framework_controls` (common columns) from the read-only
   `release/seed/grc_seed.db`.
3. Run `GRC_DB_PATH=<t.db> python -m scripts.seed_demo_tenant_users --tenant demo --password demo123 --apply`
   for the role accounts.
4. Create one assessment through the API (in-process `httpx.ASGITransport`), as the selftests do.

**Copying a database:** use the SQLite **backup API**, not `cp`, so the `-wal` file isn't lost.

**Every phase ends with these checks:**
- Backend: `python -m py_compile` on each changed file. Then on the test DB:
  `scripts/selftest_r2_lifecycle.py` and `scripts/selftest_compliance_merge.py`, both still green,
  extended with checks for what you changed.
- Frontend: `npx tsc --noEmit -p frontend` and `npm run lint --prefix frontend`. `node_modules` is
  installed; add no new warnings.

---

## Phase A — Block Strong (do first)

**A-1 Audit detail page never loads (one line; already broken before R2, since `d565c20`).**
- The route is `audits/:auditId` (`App.tsx`, the `<AuditDetailPage />` route), but
  `AuditDetailPage.tsx` reads `useParams<{ id: string }>()`. So `auditId` is `""`, `loadAudit()`
  returns early, and the spinner never stops.
- Fix it to `const { auditId = "" } = useParams<{ auditId: string }>();`. Keep the `RoleRoute
  path="/audits/:id"` key consistent with `ROUTE_ROLES`.
- **Prevent recurrence:** add a small static check (a vitest test or `frontend/scripts/check-route-params.mjs`
  wired into `npm run lint` or `test`):
  - for every `<Route path="…:param…" element={<Page/>}>`, the page's `useParams<{…}>` keys must
    include each `:param`;
  - run it over all routes and fix any other mismatch it finds.
- *Done when:* opening an audit from AuditsPage and from RecommendationsPage shows the audit, and
  findings, recommendations, report and delete all work.

**A-2 (was R-1) Policy periodic review in the UI.**
- Today nothing sets or moves `next_review_date`. The New Policy form sends only
  `review_frequency_months`, the backend never computes the date, there is no details edit form,
  and nobody can record that a review happened.
- Implement:
  - **Auto date:** on the transition to `published`, and on every later re-publish, set
    `next_review_date = today + review_frequency_months`. Keep a value the user set explicitly.
  - **Mark as reviewed:** a CISO/policy_manager action on a published policy, with a required
    comment.
    - It records `last_reviewed_at`, `last_reviewed_by_id` and the comment. These are new columns
      (migration script), or a review-history table if you prefer; justify the choice.
    - It moves `next_review_date` forward by the frequency.
    - It is logged in the activity log.
    - It is shown on the Overview tab, with a history.
    - "Review led to changes" is the existing new-version flow; keep that path.
  - **Edit details:** a form in PoliciesPage for title, description, category, owner, review
    frequency, next review date, effective/expiration dates and scope. It uses `PATCH
    /policies/{id}` without touching `status`.
  - **Reminders:** the review-due reminder in `notification_generator.py` stops repeating once a
    review is recorded.
- *Done when:* a policy created and published in the UI gets a review date, shows "review due"
  when it passes, and can be marked reviewed. The date moves forward and the reminder stops. All
  of it appears in the activity log.

## Phase B — Fix before deploying

**B-1 (D-1) Deleting a draft assessment returns 500. Confirmed in production.**
- Every new assessment now has `ControlAssessment` rows. The relationship has no cascade and
  `assessment_id` is NOT NULL, so the delete fails with an IntegrityError.
- Fix: in the delete route, for a draft with **no human work**, delete its rows, gaps and evidence
  first. That means no `status_source='human'`, no evidence and no action items. Evidence file
  versions must be retired, not orphaned.
- Otherwise refuse with a clear 409, "This assessment has recorded work — archive it instead", in
  en, fr and ar.
- Never 500. Show the refusal in the UI.

**B-2 (D-2) `scripts/backfill_control_status_source.py` misses human decisions made through the
action plan.**
- Also mark as human the controls closed or reopened through `/compliance/action-plan/…` (activity
  log paths) and controls whose status came from a person-closed action item.
- Show the counts per source in the dry-run output.

**B-3 (D-3) `ai_suggested_at` is 32 characters in a `VARCHAR(30)` column.**
- PostgreSQL would fail the whole analysis. Widen it to 40 in the model and in the migration
  script. On PostgreSQL, add an idempotent `ALTER COLUMN … TYPE VARCHAR(40)` step. SQLite needs
  nothing.
- Check the other new `VARCHAR(20/30)` timestamp columns the same way.

## Phase C — Major workflow gaps

**C-1 Risk acceptances.**
- (a) **Expiry sync.** Expiry currently runs only when someone opens Exceptions & Waivers. Run the
  same sync in the daily notification check. It must be idempotent: there are 2 workers, so it
  will run twice.
- (b) **Withdraw.** Let the requester **withdraw** their own *pending* acceptance (new status
  `withdrawn`, reason required, logged). Today a pending request can only be cleared by another
  person, so a single-user tenant is stuck with it.

**C-2 Policies.**
- **Attestations need an approved version.** Allow them only when the current version is approved
  and the policy is approved or published (409 otherwise), and refuse acknowledgement on retired
  policies.
- **No duplicates.** Re-sending to a user who already has a pending attestation for the same
  version must not create a duplicate.
- **Auditors:** **ASK** whether auditors should attest.
  - If yes: add My Policies to the auditor portal.
  - If no: exclude auditors from "Send to all users", and stop their reminders.
- **Activity log:** record version approval.
- **Errors:** show approve and restore errors on the History tab, not only on the Content tab.
- **Buttons:** hide "Add version" and "Send attestation" from roles the backend refuses.

**C-3 Vendors.**
- **Send to vendor.** After the CISO approves a contract it leaves the queue, so **Send to vendor**
  can never be reached. Keep approved, not-yet-sent contracts visible in a "Ready to send" section
  of ContractReviewPage, or keep the selection after approving.
- **Stale score.** After an AI analysis is approved, reload the vendor list and detail so the new
  score shows straight away.
- **Duplicate guards:**
  - a contract upload that succeeds while the expiry update fails must not allow a second upload
    of the same file;
  - onboarding that fails after the vendor was created must not create a second vendor on retry.
- **Messages:** the delete-refusal messages should point to **Offboard**, not "set status to
  inactive".
- **Alerts:** contract-expiry alerts skip offboarded vendors.
- **AI unavailable (424):** show a clear, translated message with a Retry button.
  - **ASK** whether onboarding may continue **without** the AI prescreen, saving the answers with
    no score. Today an Ollama outage blocks creating vendors.

**C-4 Compliance.**
- **Gap buttons:** hide accept, reject and bulk on GapReportTab for roles the backend refuses (it
  is CISO-only), or widen the backend consistently; pick one and justify it.
- **Visibility toggle:** the response must include `valid_until`, or the UI must merge instead of
  replacing the evidence object, so the expiry badge stays.
- **Mixed roles:** a user who is `control_owner` **and** an organisation-wide role is today
  unrestricted on rows. **ASK** which should win, then enforce it consistently.
- **Evidence:** allow deleting your own evidence, matching who can upload it. Allow editing
  `valid_until` after upload.
- **Recovery list:** show the Deleted files button to compliance_manager too, because the backend
  already allows it.

**C-5 Scenarios.**
- **Mirror risk.** Creating a scenario adds a matching risk to the register, and deleting the
  scenario leaves it behind as an orphan. Find the link: the scenario's register-entry id, or the
  risk's scenario link.
  - On delete, remove the mirror if it has no other links (treatments, acceptances, audit links).
  - Otherwise close it with an automatic reason: "Scenario deleted".
  - Add a backfill that lists existing orphans (dry-run) and closes them on `--apply`.
- **History.** A scenario edit that re-scores the linked risk must save a risk version first, so
  the History diff credits the right change.

## Phase D — Usability and minor items

- **Scenario table:** the Edit, Delete and History actions are off-screen at 1440 px. Make the
  actions column sticky on the right, or move the actions into a row menu.
- **Control status dropdown:** it shows "Compliant" while a row is Not Started (default value
  `implemented`). Add a "Not started" placeholder so it shows the real status, and don't save
  until the user picks one.
- **Gap text:** the manual-evaluation text says "assessed as not compliant" for a *partially*
  compliant control. Make it status-aware in en, fr and ar.
- **Risk edit form:**
  - optional fields (owner, residual, target, review date, scope) must be clearable; send explicit
    `null` and accept it in the backend;
  - don't default a missing likelihood/impact to 3×3 or a missing category to "Technical" on edit.
- **Risk treatment page:**
  - hide New and Supersede from roles that get 403;
  - supersede must not wipe owner, start date, complexity, actual cost or delay justification.
    Keep values the form doesn't show.
- **Activity log for uploads:** evidence upload and document upload must commit before returning.
  Today the activity-log write times out and the audit entry is lost; this was already the case
  before R2.
- **Dashboards (ASK):** the Risk and Governance dashboard widgets show "Restricted view" (403) to
  the tenant owner. Confirm whether that is intended before changing anything.

## Phase E — Documentation and final check

1. **Knowledge base:** update `frontend/src/kb/{en,fr,ar}.ts` for policy review and Mark as
   reviewed, acceptance withdraw, Send to vendor, and assessment delete vs archive.
2. **Fix list:** tick the boxes in `docs/architecture/R2_Lifecycle_Fix_List.md`, and add a short
   "Follow-ups done" section.
3. **R2 walkthrough on the test DB, through the API and then the UI if you can run it:**
   - **Risks:** create → re-score → treat → accept → withdraw/approve/revoke → close → reopen →
     delete.
   - **Policies:** draft → review → approve by a second person → publish (review date set) →
     attest (approved version only) → acknowledge → mark reviewed → retire.
   - **Audits:** create → **open the detail page** → finding → recommendation → action → report.
   - **Third parties:** onboard → reassess → new contract → CISO approve → **send to vendor** →
     offboard → delete.
   - **Compliance:** new assessment → manual status → evidence with expiry → AI re-run keeps human
     work → delete a draft (works or gives a clear 409) → archive.
4. **Final report**, for each item:
   - done, partial, skipped, or waiting for an ASK answer;
   - files changed;
   - how it was verified;
   - the **production run-book** in order: migration and backfill scripts (dry-run first), backend
     restart, frontend rebuild/reload, and what to check afterwards.

   Then tell the user they can ask Claude to **re-run the live browser test** on the
   `elite@grceye.com` test tenant once this is deployed.
