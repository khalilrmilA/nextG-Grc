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

- [ ] **S — Employees acknowledge a policy.** `policiesApi.acknowledgeAttestation`
  ([endpoints.ts:1493](../../frontend/src/api/endpoints.ts#L1493)) has no caller.
  PoliciesPage already *displays* acknowledged status. Add a "policies to acknowledge" view for the
  assigned user.
- [ ] **S — Author must not approve their own version (four-eyes).**
  `approve_version` ([policies.py:606](../../backend/app/api/v1/endpoints/policies.py#L606)) has no
  author ≠ approver check. Copy the pattern from
  [security_exceptions.py:205](../../backend/app/api/v1/endpoints/security_exceptions.py#L205).
  Version approval is currently reachable only from the Doc Generator; add it to PoliciesPage too.
- [ ] **M — Controlled status flow and reminders.** Status transitions are free today. Add review and
  attestation reminders (the notification deadline checker is the natural place).

## 5. Controls & evidence (compliance)

- [ ] **M — AI re-run must merge, not replace (biggest item).**
  [compliance.py:2645-2697](../../backend/app/api/v1/endpoints/compliance.py#L2645-L2697) deletes and
  recreates every control assessment the AI re-judges, including the evidence rows. That loses the
  manual status, owner, notes, N/A justification and auditor verdict.
  - Action items already survive.
  - File bytes are retired to the recovery list.
  - Fix: update existing rows in place, never overwrite a human-set value without confirmation, and
    keep the evidence attached.
- [ ] **S — Create the control rows when an assessment is created.** `POST /compliance/assessments`
  creates no `ControlAssessment` rows, so appliance tenants and later-added frameworks need an AI run
  before anyone can assess by hand. Create one `NOT_STARTED` row per control, as registration does
  ([auth.py:642-652](../../backend/app/api/v1/endpoints/auth.py#L642-L652)).
- [ ] **M — Let control owners self-assess.** These write routes are CISO-only:
  - create assessment ([compliance.py:1651](../../backend/app/api/v1/endpoints/compliance.py#L1651))
  - upload document ([:2346](../../backend/app/api/v1/endpoints/compliance.py#L2346))
  - analyze ([:2858](../../backend/app/api/v1/endpoints/compliance.py#L2858))
  - update control ([:2941](../../backend/app/api/v1/endpoints/compliance.py#L2941))
  - upload evidence ([:3671](../../backend/app/api/v1/endpoints/compliance.py#L3671))

  Allow owner-scoped writes (`services/perimeter.py`) and align `ROUTE_ROLES`.
- [ ] **M — Evidence validity.** `valid_until` is unused. Add expiry plus renewal reminders.
- [ ] **S — Recovery list UI.** `complianceApi.listDeletedFiles` has no caller.
- [ ] **M — Roll applied controls up into requirement status.** The `framework_control_ids` and
  evidence links on applied controls are backend-only; compliance never reads them.

## 6. Audits (already Strong; caveat only)

- [ ] **S — `ActionItem.finding_id` is never written**, so the finding progress roll-up and the
  report's action-plan section are empty.

---

## Before shipping (this repo is the live grceye.com server)

- A backend change needs `pm2 restart grceye-backend`. There is no hot-reload, and there are 2 workers.
- A new **column** (e.g. a policy author field) needs a hand-written, idempotent `ALTER` script in
  `backend/scripts/`. Alembic is not used. New tables are auto-created.
- Snapshot `backend/grc_dev.db` before testing anything that writes. It holds real data and has no
  backups.
- Keep the role arrays in `Layout.tsx` and `ROUTE_ROLES` in `App.tsx` in sync if you widen access.
