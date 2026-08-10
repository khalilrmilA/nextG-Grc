# GRC SaaS Platform — Claude Development Guide

## Quick Start

Full-stack GRC (Governance, Risk & Compliance) SaaS platform: FastAPI backend + React frontend.

### First-time setup on a new machine (Windows)

```powershell
# Installs Python 3.12 + Node LTS + Ollama (via winget), creates the venv,
# installs all backend + frontend deps, and writes the .env files.
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# Then start both servers (each in its own window):
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

### Manual / day-to-day start

```bash
# Terminal 1: Backend (port 8000)
cd backend && python -m uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend (port 4000)
cd frontend && npm run dev -- --port 4000
```

**Login:** `admin@demo.com` / `demo123` | `ciso@demo.com` / `demo123` | `auditor@demo.com` / `demo123` | `superadmin@platform.com` / `super123`

---

## ⚠️ Production reality & gotchas — READ BEFORE WORKING

This working copy **is the live production server for grceye.com** (real client data). Load-bearing facts the rest of this doc doesn't capture (full detail + evidence in the Obsidian memory vault at `~/Desktop/Claude-Memory` / `MEMORY.md`):

- **Serving topology is 3 tiers**: browser → **marketing Next.js (:3000, the public front door)** → proxies to the **Vite dashboard (:4000)** and **FastAPI (:8000)**. The dashboard lives at `grceye.com/app`.
- **PM2 runs only backend + marketing.** The **frontend is a bare Vite process on :4000, NOT in PM2** → never casually `npm run build` or restart it (no supervisor brings it back). Backend code change = `pm2 restart grceye-backend` (2 workers, no hot-reload).
- **Prod runs in `development` mode** (`.env.local`: `ENVIRONMENT=development`, `DEBUG=true`) → hardening guards off, no HSTS, and `/api/v1/docs` is publicly exposed. Flipping to `production` crashes startup unless `SECRET_KEY`/`DEBUG` are fixed first.
- **2 uvicorn workers ⇒ per-worker in-memory state**: JWT revocation, rate limits, license/AI-quota caches, and the threat scheduler are all split-brained (revocation unreliable, limits ~2×, feed double-fires). Put shared state in Redis + guard singletons.
- **The Ed25519 license SIGNING key lives in `backend/.env.local` here** — grceye.com is the license-minting authority; treat that file as crown-jewel.
- **Migrations are manual**: alembic is dead (no revisions). New *columns* = a hand-written idempotent `ALTER` script in `backend/scripts/`; new *tables* auto-create via `create_all()`.
- **Traps**: frontend `plan` is cosmetic (always enterprise); `roles` JSON is ignored by backend authz (only scalar `role` + admin auto-pass); SettingsPage user-mgmt is mock data; uploads cap at **2 MB**; a 5xx/network error hard-redirects the SPA to `/service-down`.
- **DB is `backend/grc_dev.db`** (git-tracked, real data) — never mutate in place; snapshot read-only first. No scheduled backups exist.

---

## Architecture

- **Backend**: FastAPI (Python 3.12+) + SQLAlchemy ORM + SQLite (dev) / PostgreSQL (prod)
- **Frontend**: React 18 + TypeScript + Tailwind CSS + shadcn/ui
- **AI**: Ollama (local, `http://localhost:11434`, model `gpt-oss:120b-cloud`) — NOT Anthropic API
- **i18n**: react-i18next (en, fr, ar with full RTL support)
- **Auth**: JWT + role-based access control
- **Reports**: ReportLab PDF generation

---

## Platform Stats

| Metric | Count |
|--------|-------|
| **Frontend Pages** | 38 |
| **Backend API Routes** | 190 |
| **Backend Modules** | 29 |
| **Data Models** | 28+ |
| **Frameworks** | 76 built-in (each can be forked into a tenant-owned editable copy) |
| **Languages** | 3 (EN, FR, AR) |

---

## Backend Structure

```
backend/
  app/
    core/           # Config, database, security, seed data
    models/         # 28+ SQLAlchemy ORM models
    api/v1/
      endpoints/    # 29 route handler files
      dependencies/ # Auth helpers (get_current_user, get_tenant_id)
    services/       # report_generator, notification_generator, email_service
    frameworks/     # YAML loader for compliance frameworks
    templates/      # Email templates (Jinja2)
```

### All API Endpoint Files (29)

| File | Prefix | Purpose |
|------|--------|---------|
| `auth.py` | `/auth` | Login, register, refresh, profile |
| `ai.py` | `/ai` | AI streaming, policy generation, vendor analysis |
| `ai_access.py` | `/ai-access` | AI quota management (currently disabled) |
| `risks.py` | `/risks` | Risk CRUD, heatmap, **Monte Carlo quantification** |
| `risk_scenarios.py` | `/risk-scenarios` | Threat→Vuln→Asset→Control chains |
| `risk_matrices.py` | `/risk-matrices` | Custom probability/impact scales (JSON) |
| `compliance.py` | `/compliance` | Assessments, controls, gaps, cross-framework |
| `frameworks.py` | `/frameworks` | List/CRUD frameworks, **custom builder with AI**, **clone built-in → editable tenant copy** (`POST /{id}/clone`), update metadata (`PATCH /{id}`) |
| `audits.py` | `/audits` | Full audit lifecycle + findings CRUD |
| `policies.py` | `/policies` | Policy CRUD + versioning + attestations |
| `vendors.py` | `/vendors` | TPRM: vendors, contracts, cartography, prescreen AI |
| `assets.py` | `/assets` | IT asset inventory + stats |
| `incidents.py` | `/incidents` | Security incident tracking + stats |
| `vulnerabilities.py` | `/vulnerabilities` | CVE tracking, CVSS, remediation |
| `threats.py` | `/threats` | Threat library (builtin + custom) |
| `applied_controls.py` | `/applied-controls` | Controls with cost/effort/progress tracking |
| `security_exceptions.py` | `/security` | Security exceptions + risk acceptances |
| `trust_center.py` | `/trust-center` | Public compliance page (no auth for public) |
| `regulatory.py` | `/regulatory` | Regulatory change tracking |
| `notifications.py` | `/notifications` | In-app alerts + deadline checker |
| `reports.py` | `/reports` | 5 PDF report types (weekly) |
| `data_io.py` | `/data` | CSV export (6 modules) + import (3 modules) |
| `activity_log.py` | `/activity-log` | Audit trail of all user actions |
| `webhooks.py` | `/webhooks` | Outbound webhook management + test |
| `dashboard.py` | `/dashboard` | KPIs, framework overview |
| `users.py` | `/users` | User management |
| `tenants.py` | `/tenants` | Tenant settings + modules |
| `subscriptions.py` | `/subscriptions` | Plans, limits, billing |
| `admin.py` | `/admin` | Super admin operations |
| `auditor_portal.py` | `/auditor-portal` | Auditor-specific views |

### All Data Models (28+)

| Model | Table | Key Fields |
|-------|-------|------------|
| `User` | users | email, role, tenant_id, is_active |
| `Tenant` | tenants | name, slug, features, settings, selected_framework_ids |
| `Framework` | frameworks | name, short_name, version, is_builtin |
| `FrameworkControl` | framework_controls | control_id, title, category, mapped_controls |
| `Risk` | risks | title, likelihood, impact, severity, next_review_date |
| `RiskScenario` | risk_scenarios | threat_ids, vulnerability_ids, asset_ids, applied_control_ids, current/target probability/impact |
| `RiskMatrix` | risk_matrices | JSON definition (configurable scales) |
| `ComplianceAssessment` | compliance_assessments | framework_id, status, compliance_score |
| `ControlAssessment` | control_assessments | status, ai_confidence, justification |
| `ComplianceGap` | compliance_gaps | control_id, severity, remediation_steps |
| `Audit` | audits | title, audit_type, status, lead_auditor_id |
| `AuditFinding` | audit_findings | severity, status, remediation_owner_id |
| `Policy` | policies | title, status, linked_controls, review_frequency |
| `PolicyVersion` | policy_versions | version_number, content, is_current |
| `PolicyAttestation` | policy_attestations | user_id, status, acknowledged_at |
| `Vendor` | vendors | name, risk_tier, risk_score, contract_expiry |
| `VendorContract` | vendor_contracts | file_name, ai_review, validation_status (workflow) |
| `Asset` | assets | asset_type, criticality, RTO/RPO/MTD, security_objectives |
| `Incident` | incidents | category, severity, status, financial_impact, breach_notification |
| `Vulnerability` | vulnerabilities | ref_id (CVE), cvss_score, severity, status |
| `Threat` | threats | ref_id, category, mitre_ids, is_builtin |
| `AppliedControl` | applied_controls | status, progress%, cost, effort, eta, expiration |
| `SecurityException` | security_exceptions | justification, approval workflow, expiration |
| `RiskAcceptance` | risk_acceptances | justification, approver, expiration |
| `RegulatoryUpdate` | regulatory_updates | source, impact, deadline, affected_frameworks |
| `Notification` | notifications | type, status, title, message |
| `ActivityLog` | activity_logs | user_id, action, entity_type, details |
| `Subscription` | subscriptions | tier, status, limits |

---

## Frontend Structure

```
frontend/src/
  pages/            # 38 page components
  components/       # Reusable UI (layout, modals, vendor, notifications)
  api/              # HTTP client (endpoints.ts) with 15+ API objects
  types/            # TypeScript interfaces
  store/            # Zustand auth state
  locales/          # i18n (en.ts, fr.ts, ar.ts)
  context/          # FrameworkContext
```

### All Pages (38) with Routes

| Page | Route | Sidebar Group |
|------|-------|---------------|
| DashboardPage | `/dashboard` | Core |
| RisksPage | `/risks` | Core |
| RiskScenariosPage | `/risk-scenarios` | Core |
| CompliancePage | `/compliance` | Core |
| AssessmentDetailPage | `/compliance/:id` | Core |
| RemediationPlannerPage | `/compliance/.../remediation-plan` | Core |
| TraceabilityPage | `/compliance/:id/traceability` | Core |
| FrameworksPage | `/frameworks` | Core |
| CustomFrameworkPage | `/frameworks/custom/new` | Core |
| FrameworkBuilderPage | `/frameworks/builder` | Core |
| EditFrameworkPage | `/frameworks/:id/edit` | Core (entered via Customize / Edit buttons) |
| IncidentsPage | `/incidents` | Security |
| VulnerabilitiesPage | `/vulnerabilities` | Security |
| ThreatLibraryPage | `/threats` | Security |
| AppliedControlsPage | `/applied-controls` | Security |
| SecurityExceptionsPage | `/security-exceptions` | Security |
| AuditsPage | `/audits` | Operations |
| PoliciesPage | `/policies` | Operations |
| PolicyGeneratorPage | `/policy-generator` | Operations |
| VendorsPage | `/vendors` | Operations |
| ContractReviewPage | `/vendors/contract-review` | Operations |
| ReportsPage | `/reports` | Operations |
| RegulatoryUpdatesPage | `/regulatory` | Governance |
| TrustCenterConfigPage | `/trust-center` | Governance |
| RiskQuantificationPage | `/risk-quantification` | Governance |
| ActivityLogPage | `/activity-log` | Governance |
| WebhooksPage | `/webhooks` | Governance |
| SettingsPage | `/settings` | Footer |
| HelpPage | `/help` | Footer |
| CheatSheetPage | `/cheat` | — |
| LoginPage | `/login` | Auth |
| RegisterPage | `/register` | Auth |
| LandingPage | `/landing` | Public |
| SuperAdminPage | `/super-admin` | Admin |
| CompanyAdminPage | `/company-admin` | Admin |
| AuditorPortalPage | `/auditor/portal` | Auditor |
| AuditChecklistPage | `/auditor/portal/:id` | Auditor |
| AuditReportPage | `/auditor/portal/:id/report` | Auditor |

### Sidebar Navigation (4 groups)

```
CORE:       Dashboard, Risk Register, Risk Scenarios, Compliance, Frameworks
SECURITY:   Incidents, Vulnerabilities, Threat Library, Applied Controls, Exceptions & Waivers
OPERATIONS: Audits, Policies, Doc Generator, 3rd Parties (TPRM), Reports
GOVERNANCE: Regulatory Updates, Trust Center, Risk Quantification, Activity Log, Webhooks
```

---

## User Roles & Access

| Role | Portal | Access |
|------|--------|--------|
| `super_admin` | `/super-admin` | Platform-wide user/tenant management |
| `tenant_admin` | `/dashboard` + `/company-admin` | Full app + auditor management |
| `ciso` | `/dashboard` | Full app + notifications for reviews |
| `user` | `/dashboard` | Full app access |
| `auditor` | `/auditor/portal` | Assigned audits + company documents only |

---

## Key Features

### Risk Management
- Risk register with likelihood x impact scoring (5x5 heatmap)
- **Risk Scenarios**: Threat → Vulnerability → Asset → Control chains
- **Risk Quantification**: Monte Carlo simulation (10K iterations), ALE/SLE/P90/P95
- **Custom Risk Matrices**: JSON-configurable scales (3x3, 5x5, custom)
- **Risk Acceptance**: Formal approval workflow with justification + expiry

### Compliance
- Multi-framework assessments (76 built-in frameworks)
- AI-powered control analysis (batch Ollama processing)
- Cross-framework coverage analysis
- Gap identification with remediation steps
- Evidence upload with justification per control

### Framework Customization
- **Customize** button on every built-in framework card → forks it into a tenant-owned, fully editable copy (`POST /frameworks/{id}/clone` copies metadata + all controls + parent/child links + requirements)
- **Edit Framework** page (`/frameworks/:id/edit`) — rename framework, edit/delete any control inline, add brand-new custom controls
- Built-in frameworks remain read-only and shared across tenants — only the tenant's clone is mutable
- Backend enforces ownership: `PATCH/DELETE /frameworks/{id}` returns 403 on built-in or another tenant's framework

### 3rd Party Risk (TPRM)
- Vendor CRUD with risk tiers (critical/high/medium/low)
- **Contract upload** → AI review → **CISO approval workflow** → Send to vendor
- **Risk Cartography**: 6-dimension heatmap per vendor
- **AI Prescreen Questionnaire**: 15 questions analyzed by AI before saving
- Contract versioning and validation status tracking

### Security
- **Incident Management**: 10 categories, 6 statuses, timeline, breach notification
- **Vulnerability Management**: CVE tracking, CVSS scores, remediation tracking
- **Threat Library**: Preloaded catalog with MITRE ATT&CK IDs
- **Applied Controls**: Cost, effort, progress %, ETA, expiration tracking
- **Security Exceptions**: Formal waivers with approval/reject + compensating controls

### Governance
- **Regulatory Change Tracking**: Monitor regulation updates with deadlines
- **Trust Center**: Public-facing compliance page (configurable)
- **Activity Log**: Full audit trail of all user actions
- **Webhooks**: 20+ event types, test ping, outbound notifications
- **Weekly PDF Reports**: 5 types (Executive, Risk, Compliance, Vendor, Audit)

### Document Generator
- 29 document types in 4 categories (Foundation, Security, Procedures, Plans)
- AI-powered with Ollama streaming
- Organization context: industry, size, country, frameworks
- Control picker from any framework
- **Save as Draft / Approve & Save** → creates Policy record with version

### Data Import/Export
- CSV export: risks, vendors, assets, audits, policies, compliance
- CSV import: risks, vendors, assets (with error reporting)

### Notifications
- In-app notification bell with unread count
- **Check Deadlines** button scans for:
  - Contract expiry (90/60/30/7/0 days)
  - Risk review overdue
  - Contracts pending CISO review
  - Compliance gaps (critical/high)
- Email service (SMTP) with templates for all alert types

---

## Important Dev Notes

### AI Integration
- **ALWAYS use Ollama** (http://localhost:11434), NEVER Anthropic API
- Model: `gpt-oss:120b-cloud` (config.py default; NOT overridden by any env file — change it in config.py, not `.env`)
- AI access gate is **disabled** (AiGate just passes children through)
- Config: `OLLAMA_BASE_URL`, `OLLAMA_CHAT_MODEL` in `backend/app/core/config.py`

### Known Patterns
- All endpoints use `get_current_user` + `get_tenant_id` for multi-tenant isolation
- Pydantic response schemas use `model_config = {"from_attributes": True}`
- Frontend API client in `frontend/src/api/endpoints.ts` with 15+ API objects
- Pages use `p-8 max-w-7xl space-y-6` wrapper for consistent layout
- Modals use `fixed inset-0 z-50 bg-black/40 backdrop-blur-sm`
- Status badges use `rounded-full px-2.5 py-0.5 text-xs font-semibold`

### Database
- SQLite for dev: `backend/grc_dev.db`
- Tables auto-created on startup via `Base.metadata.create_all()`
- New columns on existing tables need manual `ALTER TABLE` migration

### RTL Support (Arabic)
- `dir="rtl"` set on `<html>` via `applyDirection()` in `i18n/index.ts`
- CSS rules in `frontend/src/index.css` handle sidebar flip, margin/padding, text alignment
- Do NOT use blanket `.flex { flex-direction: row-reverse }` — it breaks layouts

### Frameworks
- 76 frameworks loaded in DB (ISO, NIST, SOC2, GDPR, PCI, HIPAA, DORA, NIS2, AI Act, MITRE ATT&CK, etc.)
- YAML files in `frameworks/` directory (11 files, rest loaded via seed/API)
- Cross-walk mappings via `mapped_controls` JSON field

---

## Useful Commands

```bash
# One-shot setup on a new Windows machine (installs Python, Node, Ollama, all deps)
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# Start both servers in two new windows
powershell -ExecutionPolicy Bypass -File .\start.ps1

# Backend
cd backend && python -m uvicorn app.main:app --reload --port 8000
python -m py_compile app/api/v1/endpoints/FILE.py   # Check syntax

# Frontend
cd frontend && npm run dev -- --port 4000
cd frontend && npm run build                         # Production build

# API Docs (interactive)
http://localhost:8000/docs

# Test endpoints
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"demo123"}'
```

## Setup Files at Project Root

| File | Purpose |
|------|---------|
| `setup.ps1` | One-shot installer for a new Windows machine. Idempotent — safe to re-run. |
| `start.ps1` | Launches backend (8000) and frontend (4000) in two new PowerShell windows. |
| `backend/requirements.txt` | pip-installable mirror of `pyproject.toml` so Poetry isn't required for local dev. |

### Dev gotchas worth knowing

- **Pydantic-settings env file priority** — in `backend/app/core/config.py` the order is `(.env, .env.dev, .env.local)` where **later files override earlier**. So `.env.local` always wins. Don't reverse this order.
- **Celery `.delay()` calls in API endpoints must be wrapped in `try/except`** — the dev environment doesn't run Redis, so an unwrapped `.delay()` returns 500. Pattern used in `frameworks.py`:
  ```python
  try:
      notify_framework_updated.delay(fw.id, fw.name)
  except Exception:
      pass
  ```
- **PowerShell execution policy** — the user must run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, otherwise `npm.ps1` (and other npm-installed scripts) won't execute.
- **Stale PATH after winget installs** — newly installed binaries (Python, Node) won't be visible in PowerShell windows opened *before* the install. Either close/reopen the terminal or refresh PATH manually:
  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  ```
