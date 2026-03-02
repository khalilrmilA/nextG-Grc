# GRC Platform

A full-featured **Governance, Risk & Compliance (GRC) SaaS platform** built for security and compliance teams. Manage risks, run multi-framework compliance assessments, plan audits, draft policies, assess vendors — all with AI assistance powered by a local Ollama LLM.

---

## Table of Contents

1. [What We Built — Session by Session](#what-we-built--session-by-session)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Modules & Features](#modules--features)
6. [AI Features](#ai-features)
7. [API Reference](#api-reference)
8. [Data Models](#data-models)
9. [How to Run — Development](#how-to-run--development)
10. [How to Run — Docker](#how-to-run--docker)
11. [Demo Credentials](#demo-credentials)
12. [Environment Variables](#environment-variables)
13. [SaaS Pricing Tiers](#saas-pricing-tiers)
14. [Roadmap](#roadmap)

---

## What We Built — Session by Session

### Session 1 — Foundation & Scaffold
- Created the full project skeleton: `backend/`, `frontend/`, `frameworks/`, `infrastructure/`
- Designed and implemented **all 11 SQLAlchemy ORM models**: Tenant, User, Framework, Control, Risk, ComplianceAssessment, ControlAssessment, Audit, Policy, Vendor, Asset
- Set up **FastAPI** with async SQLAlchemy, JWT auth, CORS, GZip middleware, Sentry, structlog
- Configured **Pydantic Settings** with `.env` support (SQLite for dev, PostgreSQL for prod)
- Created **Alembic** migration setup
- Set up **Celery + Redis** for background task processing
- Created **Docker Compose** with: PostgreSQL+pgvector, Redis, Backend API, Frontend, Keycloak, Celery worker+beat, Flower
- Created **GitHub Actions CI pipeline**
- Built a full **YAML framework loader** for loading compliance frameworks (ISO 27001 YAML with cross-walk mappings to NIST CSF, SOC 2, etc.)
- Seeded demo data: Acme Corp tenant, admin + CISO users, ISO 27001 framework with all controls

### Session 2 — Backend API Endpoints
Implemented fully working REST API endpoints:
- **`/auth`** — login, token refresh, logout (JWT-based)
- **`/frameworks`** — list, get detail, create custom framework, add/update/delete controls and requirements
- **`/risks`** — full CRUD: create risk, list with filters, update status, delete; risk heat map data
- **`/compliance`** — create/list/detail assessments; upload documents (PDF/DOCX/TXT); run AI batch analysis; manual control status override; cross-framework coverage computation
- **`/dashboard`** — aggregated stats: compliance scores, risk counts by severity, upcoming audits, recent activity
- **`/ai`** — 6 AI streaming endpoints (see [AI Features](#ai-features))
- **`/notifications`** — create/list/mark-read notifications

### Session 3 — Frontend Core UI
Built the React + TypeScript + Tailwind frontend:
- **Landing page** — marketing page with pricing tiers
- **Login / Register** pages with JWT authentication
- **Sidebar navigation** with all modules
- **Dashboard** — live stats cards, risk heat map preview, compliance score bars, upcoming audits timeline
- **Risks page** — interactive heat map, risk register table with severity badges, Add Risk modal (with real API), Risk Detail modal
- **Compliance page** — assessment list, framework selector, New Assessment modal
- **Assessment Detail page** — 3 tabs: Upload & Analyze / Results / Cross-Framework coverage
- **Frameworks page** — catalog of known frameworks, custom frameworks from DB, delete
- **Custom Framework Builder** — form to create frameworks with sections, controls, and requirements
- **Audits page** — audit list with status tracking, New Audit modal, Audit Detail modal
- **Policies page** — policy list, draft/versioning, status badges
- **Vendors page** — vendor risk register, tier/DPA tracking, Add Vendor modal, Vendor Detail modal
- **Settings page** — Profile, Security, Notifications, Appearance tabs
- **Appearance tab** — Theme (light/dark/system), Sidebar style (dark/light/branded), Density (compact/default/comfortable), Accent color — all applied globally via Zustand store + CSS variables
- **AI Assistant** — floating chat panel (bottom-right), streams GRC-aware responses from Ollama

### Session 4 — Auth Fix & Integration
Diagnosed and fixed several integration issues:
- Fixed token flow: Login → JWT saved in `grc_user_v2` localStorage key → `client.ts` reads from same key
- Fixed Vite proxy (port 4000, `strictPort: true`, proxy `/api` → `localhost:8000`) to eliminate CORS issues
- Fixed `AIAssistant.tsx` hardcoded URL — now uses env var + auth token
- Rewrote `FrameworksPage` to fetch real data from backend (replaced all static hardcoded data)
- Fixed `UserRole.ADMIN` → `UserRole.TENANT_ADMIN` in compliance endpoint (7 occurrences)

### Session 5 — AI Features (4 new capabilities)
Added 4 specialized AI features powered by Ollama streaming SSE:
1. **Risk AI Analysis** (`RiskAIPanel.tsx`) — treatment options, likelihood/impact scoring, ISO 27001 controls, KRIs — embedded in Risk Detail modal
2. **Evidence Analyzer** — upload PDF/DOCX, AI maps content to framework controls with Compliant/Partial/Gap verdicts — integrated in Assessment Detail page
3. **AI Audit Program Generator** (`AuditPlanModal.tsx`) — full audit plan with test steps, evidence requirements, fieldwork schedule — launched from Audit Detail modal
4. **Vendor AI Risk Assessment** (`VendorAIModal.tsx`) — questionnaire-based risk scoring across 6 security domains with contract clause recommendations — launched from Vendor Detail modal

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React)                       │
│  Vite Dev Server :4000  →  proxy /api → localhost:8000  │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP / SSE
┌────────────────────▼────────────────────────────────────┐
│              FastAPI Backend :8000                       │
│  JWT Auth · SQLAlchemy (async) · Pydantic · structlog   │
└──────┬──────────────────────┬──────────────────────────┘
       │                      │
┌──────▼──────┐     ┌─────────▼──────────────────────────┐
│  SQLite     │     │        Ollama :11434                │
│  (dev DB)   │     │  deepseek-v3.1:671b-cloud          │
│  PostgreSQL │     │  Streaming SSE AI responses         │
│  (prod)     │     └────────────────────────────────────┘
└─────────────┘
       │
┌──────▼──────────────────────────────────────────────────┐
│  Celery Workers (background tasks)                       │
│  Redis broker · compliance scoring · evidence tasks      │
└─────────────────────────────────────────────────────────┘
```

### Multi-tenancy
Every database record carries a `tenant_id` foreign key. API endpoints automatically scope all queries to the authenticated user's tenant — tenants are fully isolated.

### AI Streaming Architecture
All AI endpoints return **Server-Sent Events (SSE)**. The backend streams tokens from Ollama as `data: {"token": "..."}` lines. The frontend reads the stream chunk-by-chunk and appends tokens to the UI in real time. `data: [DONE]` signals end of stream.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | FastAPI 0.115 + Python 3.12 |
| ORM | SQLAlchemy 2.0 (async) + aiosqlite / asyncpg |
| Migrations | Alembic |
| Auth | JWT (HS256) + bcrypt password hashing |
| Task Queue | Celery 5 + Redis 7 |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS 3 |
| State | Zustand (auth + appearance stores) |
| HTTP Client | Axios (REST) + fetch (SSE streaming) |
| AI / LLM | Ollama (local) — deepseek-v3.1:671b-cloud |
| Database (dev) | SQLite via aiosqlite |
| Database (prod) | PostgreSQL 16 + pgvector |
| Cache | Redis 7 |
| SSO (prod) | Keycloak 26 (OIDC / SAML 2.0) |
| Storage (prod) | AWS S3 |
| Monitoring | Sentry + Flower (Celery) |
| CI | GitHub Actions |
| Containers | Docker + Docker Compose |

---

## Project Structure

```
d:/GRC/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app factory
│   │   ├── startup.py                 # DB seed on first run
│   │   ├── core/
│   │   │   ├── config.py              # Pydantic Settings (all env vars)
│   │   │   ├── database.py            # Async SQLAlchemy engine + session
│   │   │   └── security.py            # JWT creation/verification + bcrypt
│   │   ├── models/
│   │   │   ├── tenant.py              # Tenant, PlanTier enum
│   │   │   ├── user.py                # User, UserRole enum
│   │   │   ├── framework.py           # Framework, FrameworkControl, ControlRequirement
│   │   │   ├── risk.py                # Risk, RiskStatus, ControlRiskLink
│   │   │   ├── compliance.py          # ComplianceAssessment, ControlAssessment,
│   │   │   │                          #   ComplianceGap, UploadedDocument
│   │   │   ├── audit.py               # Audit, AuditFinding, Evidence
│   │   │   ├── policy.py              # Policy, PolicyVersion, PolicyAttestation
│   │   │   ├── vendor.py              # Vendor, VendorAssessment, VendorControl
│   │   │   ├── asset.py               # Asset, AssetRiskLink
│   │   │   ├── subscription.py        # Subscription, Invoice, UsageRecord
│   │   │   └── notification.py        # Notification
│   │   ├── api/v1/
│   │   │   ├── router.py              # Aggregates all endpoint routers
│   │   │   └── endpoints/
│   │   │       ├── auth.py            # POST /auth/login, /auth/refresh
│   │   │       ├── frameworks.py      # GET/POST/DELETE /frameworks + controls
│   │   │       ├── risks.py           # Full CRUD /risks
│   │   │       ├── compliance.py      # Assessments, upload, analyze
│   │   │       ├── audits.py          # Audit stubs
│   │   │       ├── policies.py        # Policy stubs
│   │   │       ├── vendors.py         # Vendor stubs
│   │   │       ├── dashboard.py       # Aggregated stats
│   │   │       ├── ai.py              # 6 AI streaming endpoints
│   │   │       └── notifications.py   # Notification CRUD
│   │   ├── frameworks/
│   │   │   └── loader.py              # YAML → DB framework loader
│   │   └── workers/
│   │       ├── celery_app.py          # Celery app factory
│   │       └── tasks/
│   │           ├── compliance_scoring.py
│   │           ├── evidence.py
│   │           ├── notifications.py
│   │           └── vendor_assessments.py
│   ├── alembic/                       # DB migration files
│   └── pyproject.toml                 # Python dependencies
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # React Router routes
│   │   ├── main.tsx                   # Entry point
│   │   ├── api/
│   │   │   ├── client.ts              # Axios client + JWT auto-refresh
│   │   │   └── endpoints.ts           # All typed API functions
│   │   ├── store/
│   │   │   ├── auth.ts                # Auth state (Zustand)
│   │   │   └── appearance.ts          # Theme/density/accent (Zustand)
│   │   ├── types/
│   │   │   └── index.ts               # All TypeScript interfaces
│   │   ├── lib/
│   │   │   └── sse.ts                 # SSE stream reader utilities
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx        # Marketing / pricing page
│   │   │   ├── LoginPage.tsx          # JWT login + quick-login buttons
│   │   │   ├── RegisterPage.tsx       # New account registration
│   │   │   ├── DashboardPage.tsx      # Stats, heat map, compliance bars
│   │   │   ├── RisksPage.tsx          # Risk register + heat map + AI panel
│   │   │   ├── CompliancePage.tsx     # Assessment list
│   │   │   ├── AssessmentDetailPage.tsx  # Upload/Analyze/Results/Cross-FW
│   │   │   ├── FrameworksPage.tsx     # Framework catalog + custom frameworks
│   │   │   ├── CustomFrameworkPage.tsx   # Build a custom framework
│   │   │   ├── AuditsPage.tsx         # Audit list + AI audit plan
│   │   │   ├── PoliciesPage.tsx       # Policy library
│   │   │   ├── VendorsPage.tsx        # Vendor register + AI risk assessment
│   │   │   ├── SettingsPage.tsx       # Profile/Security/Appearance settings
│   │   │   ├── CheatSheetPage.tsx     # GRC framework quick reference
│   │   │   └── HelpPage.tsx           # Help & documentation
│   │   └── components/
│   │       ├── layout/
│   │       │   └── Layout.tsx         # Sidebar + header shell
│   │       ├── ai/
│   │       │   ├── AIAssistant.tsx    # Floating GRC chat panel
│   │       │   ├── RiskAIPanel.tsx    # Collapsible AI risk analysis
│   │       │   ├── AuditPlanModal.tsx # Full-screen AI audit program
│   │       │   └── VendorAIModal.tsx  # AI vendor risk assessment
│   │       └── features/
│   │           └── compliance/
│   │               └── PolicyGeneratorModal.tsx  # AI policy drafting
│   ├── .env                           # VITE_API_URL=/api/v1
│   ├── vite.config.ts                 # Port 4000, proxy /api → :8000
│   └── package.json
│
├── frameworks/
│   └── iso/
│       └── iso-27001-2022.yaml        # ISO 27001:2022 with cross-walk mappings
│
├── infrastructure/
│   └── docker/
│       ├── Dockerfile.backend
│       ├── Dockerfile.frontend
│       └── postgres/init.sql
│
├── .github/
│   └── workflows/ci.yml               # GitHub Actions CI
│
└── docker-compose.yml                 # Full dev stack
```

---

## Modules & Features

### Dashboard
- Live KPI cards: open risks, compliance score, active audits, open findings
- Risk heat map (5×5 likelihood × impact)
- Per-framework compliance score bars
- Upcoming audit timeline
- Recent activity feed

### Risk Management (`/risks`)
- Interactive 5×5 risk heat map — click a cell to filter by score
- Risk register table with severity color-coding (Critical / High / Medium / Low)
- Add Risk form: title, description, category, likelihood/impact sliders, tags
- Risk detail modal: full metadata + **AI treatment analysis panel** (collapsible, streams in real time)
- Filters: search, severity, status

### Compliance Management (`/compliance`)
- Create assessments against any loaded framework
- **Assessment Detail page** — 3 tabs:
  - **Upload & Analyze**: drag-and-drop PDF/DOCX/TXT upload; "Run AI Analysis" triggers batch LLM analysis of all controls
  - **Results**: compliance score donut, per-control status (Compliant / Partial / Gap), AI confidence score, gap descriptions, "Generate Policy" button per gap
  - **Cross-Framework**: shows which controls in other frameworks are automatically covered by your compliance evidence (e.g., "Your ISO 27001 doc covers 12 NIST CSF controls")
- Manual status override per control
- Policy Generator modal: streams a complete ready-to-adopt policy document for any gap

### Framework Management (`/frameworks`)
- Catalog view of 8+ built-in frameworks (ISO 27001, SOC 2, NIST CSF, GDPR, HIPAA, PCI DSS, NIST 800-53, CIS Controls)
- View and delete custom frameworks created by your tenant
- **Custom Framework Builder** (`/frameworks/custom/new`): add metadata (name, version, issuing body, regions), add controls (ID, title, category, description, guidance, tags), add requirements (text + must/should/may level)

### Audit Management (`/audits`)
- Audit register with status tracking (Planning → Fieldwork → Review → Reporting → Closed)
- Findings counter per audit (Critical / High / Medium / Low / Observation)
- New Audit form: title, framework, type (Internal/External/Certification), dates, lead auditor, objective, scope
- Audit detail modal with all metadata
- **"Generate AI Audit Program" button** — opens a full-screen streaming modal with: executive summary, audit methodology, per-control test procedure tables (Control ID | Test Objective | Test Procedure | Evidence Required | Sample Size), fieldwork schedule, reporting template
- Download the generated audit program as a `.md` file

### Policy Management (`/policies`)
- Policy library with version tracking
- Status badges (Draft / Review / Approved / Archived)
- Policy editor (WIP — AI generator accessible from Compliance gaps)

### Vendor Risk Management (`/vendors`)
- Vendor register with risk tier (Critical / High / Medium / Low) and status
- Risk score (1–40), DPA tracking, contract expiry monitoring
- DPA missing alert displayed in detail modal
- Add Vendor form with all metadata
- **"AI Risk Assessment" button** — opens the AI vendor modal:
  - Pre-filled 10-question security questionnaire (editable before running)
  - Streams scored report: overall risk score (X/10), risk tier, domain scores table (Access Control, Data Protection, Incident Response, BCP, Compliance, Third-Party), critical findings, recommended contract/DPA clauses, monitoring frequency

### Settings
- **Profile**: name, email, role, org info
- **Security**: change password, MFA toggle, active sessions, API key management
- **Notifications**: granular email + in-app notification toggles per event type
- **Appearance**:
  - Theme: Light / Dark / System
  - Sidebar style: Dark / Light / Branded (gradient)
  - Density: Compact / Default / Comfortable (affects table row padding globally via CSS variables)
  - Accent color: 8 color options (Blue / Indigo / Purple / Rose / Orange / Teal / Green / Slate)

---

## AI Features

All AI features stream responses in real time via **Server-Sent Events** from a local Ollama instance. No data leaves your infrastructure.

### 1. GRC Chat Assistant
- Floating panel (bottom-right corner, available on all pages)
- Knows: ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, NIST CSF, NIST 800-53, CIS Controls
- Can draft policies, explain controls, interpret regulations, guide risk treatment
- Endpoint: `POST /api/v1/ai/chat`

### 2. Risk AI Analysis
- Where: Risk Detail modal → collapsible "AI Risk Analysis" panel (auto-opens on first click)
- Output: Risk summary paragraph, suggested likelihood/impact scores with justification, 3 treatment options (Mitigate / Transfer / Accept) with effort + effectiveness ratings and implementation steps, relevant ISO 27001 controls, Key Risk Indicators (KRIs) to monitor
- Endpoint: `POST /api/v1/ai/analyze-risk`

### 3. Evidence Analyzer
- Where: Assessment Detail page → Upload & Analyze tab → "Run AI Analysis" button
- Input: extracted text from uploaded PDF/DOCX/TXT document + list of framework controls
- Output: overall coverage summary, per-control compliance verdict table (Compliant / Partial / Gap / N/A + confidence level), top gaps identified, recommended next steps
- Endpoint: `POST /api/v1/ai/analyze-evidence`

### 4. AI Audit Program Generator
- Where: Audit Detail modal → "Generate AI Audit Program" button
- Output: executive summary, audit methodology, per-control-area test procedure tables, fieldwork schedule (phases + duration + resources), reporting & findings template
- Can download as `.md`, copy to clipboard, or regenerate
- Endpoint: `POST /api/v1/ai/generate-audit-plan`

### 5. AI Policy Generator
- Where: Assessment Results tab → "Generate Policy" button per gap control
- Input: control identifier, title, gap description, existing documentation context
- Output: complete ready-to-adopt policy document (purpose, scope, policy statements using "must/shall" language, step-by-step procedures, roles & responsibilities, review cycle)
- Endpoint: `POST /api/v1/ai/generate-policy`

### 6. Vendor AI Risk Assessment
- Where: Vendor Detail modal → "AI Risk Assessment" button
- Input: vendor name, industry, services, plus 10-question security questionnaire (editable before running)
- Output: overall risk score (X/10), risk tier, executive summary, domain scores table with traffic-light indicators, critical findings + remediation steps, recommended contract/DPA clauses, monitoring schedule
- Endpoint: `POST /api/v1/ai/analyze-vendor`

---

## API Reference

**Base URL:** `http://localhost:8000/api/v1`
**Interactive Swagger UI:** `http://localhost:8000/api/v1/docs`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Get JWT access + refresh tokens |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/dashboard/stats` | Aggregated platform statistics |
| GET | `/risks` | List risks (filterable by status, severity, category) |
| POST | `/risks` | Create risk |
| PATCH | `/risks/{id}` | Update risk |
| DELETE | `/risks/{id}` | Delete risk |
| GET | `/frameworks` | List frameworks for tenant |
| POST | `/frameworks` | Create custom framework |
| DELETE | `/frameworks/{id}` | Delete custom framework |
| POST | `/frameworks/{id}/controls` | Add control to custom framework |
| PATCH | `/frameworks/{id}/controls/{cid}` | Update control |
| DELETE | `/frameworks/{id}/controls/{cid}` | Delete control |
| POST | `/compliance/assessments` | Create compliance assessment |
| GET | `/compliance/assessments` | List assessments (paginated) |
| GET | `/compliance/assessments/{id}` | Full detail with results |
| POST | `/compliance/assessments/{id}/documents` | Upload document (multipart/form-data) |
| POST | `/compliance/assessments/{id}/analyze` | Run AI batch analysis |
| PATCH | `/compliance/control-assessments/{id}` | Manually update control status |
| POST | `/ai/chat` | Stream GRC chat response (SSE) |
| POST | `/ai/analyze-risk` | Stream risk analysis (SSE) |
| POST | `/ai/analyze-evidence` | Stream evidence analysis (SSE) |
| POST | `/ai/generate-audit-plan` | Stream audit program (SSE) |
| POST | `/ai/generate-policy` | Stream policy document (SSE) |
| POST | `/ai/analyze-vendor` | Stream vendor risk report (SSE) |
| GET | `/ai/models` | List available Ollama models |
| GET | `/ai/health` | Check Ollama connectivity |
| GET | `/notifications` | List notifications |
| PATCH | `/notifications/{id}/read` | Mark notification as read |

---

## Data Models

### Entity Relationships

```
Tenant ──< User
Tenant ──< Framework ──< FrameworkControl ──< ControlRequirement
Tenant ──< Risk
Tenant ──< ComplianceAssessment ──< ControlAssessment
                                 ──< ComplianceGap
                                 ──< UploadedDocument
Tenant ──< Audit ──< AuditFinding ──< Evidence
Tenant ──< Policy ──< PolicyVersion ──< PolicyAttestation
Tenant ──< Vendor ──< VendorAssessment
Tenant ──< Asset
Tenant ──< Subscription
```

### Key Enums

| Model | Field | Values |
|-------|-------|--------|
| User | role | `TENANT_ADMIN`, `CISO`, `COMPLIANCE_MANAGER`, `AUDITOR`, `RISK_MANAGER`, `ANALYST`, `READ_ONLY` |
| Risk | status | `identified`, `assessed`, `treatment_planned`, `treatment_in_progress`, `treated`, `accepted`, `closed` |
| ControlAssessment | status | `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `PARTIALLY_IMPLEMENTED`, `NOT_IMPLEMENTED`, `NOT_APPLICABLE` |
| FrameworkControl | category | `TECHNICAL`, `ORGANIZATIONAL`, `PEOPLE`, `PHYSICAL`, `GOVERNANCE` |
| Audit | status | `planning`, `fieldwork`, `review`, `reporting`, `closed` |
| Policy | status | `draft`, `review`, `approved`, `archived` |
| Vendor | tier | `critical`, `high`, `medium`, `low` |

---

## How to Run — Development

### Prerequisites

- Python 3.12 or higher
- Node.js 20 or higher
- [Ollama](https://ollama.ai) installed (for AI features)

### Step 1 — Install and start Ollama

```bash
# Download Ollama from https://ollama.ai and install it

# Pull a model (choose one):
ollama pull deepseek-r1:1.5b           # small, fast — good for development
ollama pull deepseek-v3.1:671b-cloud   # production quality (requires Ollama cloud routing)
ollama pull llama3.2:3b                # alternative: Meta Llama

# Verify Ollama is running:
curl http://localhost:11434/api/tags
```

### Step 2 — Start the Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install fastapi "uvicorn[standard]" sqlalchemy aiosqlite pydantic-settings \
    "python-jose[cryptography]" "passlib[bcrypt]" httpx structlog \
    python-multipart pypdf python-docx alembic pydantic

# Seed the database (creates grc_dev.db with demo data)
python -c "import asyncio; from startup import run_startup; asyncio.run(run_startup())"
# OR just start the server — startup.py runs automatically:

# Start the API server
uvicorn app.main:app --reload --port 8000
```

Backend is now running at: **http://localhost:8000**
API docs (Swagger): **http://localhost:8000/api/v1/docs**

### Step 3 — Start the Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start Vite dev server
npm run dev
```

Frontend is now running at: **http://localhost:4000**

> The Vite config automatically proxies all `/api` requests to `localhost:8000`, so no CORS issues.

### Step 4 — Verify everything works

1. Open **http://localhost:4000**
2. Click the **"Login as Admin"** quick button (or enter `admin@demo.com` / `demo123`)
3. You should land on the Dashboard with live data
4. Open the AI chat panel (bottom-right corner) and type: `What is ISO 27001?`
5. Check AI connectivity: **http://localhost:8000/api/v1/ai/health**

---

## How to Run — Docker

Runs the full production-like stack: PostgreSQL, Redis, Backend, Frontend, Keycloak, Celery workers, Flower.

### Prerequisites

- Docker Desktop installed and running

### Start all services

```bash
# From the project root (d:/GRC):
docker compose up --build

# Detached mode (runs in background):
docker compose up --build -d

# View logs:
docker compose logs -f backend
docker compose logs -f frontend
```

### Service URLs when using Docker

| Service | URL | Credentials |
|---------|-----|-------------|
| Frontend | http://localhost:3000 | admin@demo.com / demo123 |
| Backend API | http://localhost:8000 | — |
| API Docs (Swagger) | http://localhost:8000/api/v1/docs | — |
| Keycloak Admin | http://localhost:8080 | admin / admin |
| Flower (Celery monitor) | http://localhost:5555 | — |
| PostgreSQL | localhost:5432 | grc / grc_dev_password |

### Stop all services

```bash
# Stop containers (keeps data):
docker compose down

# Stop and delete all data (fresh start):
docker compose down -v
```

### Important notes for Docker
- AI features require **Ollama running on the host machine** (not inside Docker). Make sure `ollama serve` is running before starting containers.
- In Docker mode the backend connects to **PostgreSQL** instead of SQLite.
- The frontend in Docker runs on port **3000** (not 4000 like in local dev).

---

## Demo Credentials

| Email | Password | Role | Description |
|-------|----------|------|-------------|
| `admin@demo.com` | `demo123` | Tenant Admin | Full access — can manage frameworks, users, settings |
| `ciso@demo.com` | `demo123` | CISO | Full access to all security/compliance modules |

Both accounts belong to the **Acme Corp (Demo)** tenant which has pre-seeded:
- ISO 27001:2022 framework with all 93 controls loaded
- 7 demo risks with various severities and categories
- 1 sample compliance assessment

---

## Environment Variables

### Backend — `backend/.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./grc_dev.db` | Database connection string |
| `SECRET_KEY` | `change-me-in-production` | JWT signing secret — **change this in production** |
| `ENVIRONMENT` | `development` | `development` / `staging` / `production` |
| `ALLOWED_ORIGINS` | `["http://localhost:3000","http://localhost:4000"]` | CORS allowed origins |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_CHAT_MODEL` | `deepseek-v3.1:671b-cloud` | LLM model used for all AI features |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | JWT access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | JWT refresh token lifetime |
| `ANTHROPIC_API_KEY` | `` | Optional: Claude API key (future use) |
| `STRIPE_SECRET_KEY` | `` | Optional: Stripe for billing |
| `SENTRY_DSN` | `` | Optional: Sentry error tracking |
| `AWS_ACCESS_KEY_ID` | `` | Optional: AWS S3 for file storage |
| `S3_BUCKET_EVIDENCE` | `grc-evidence` | S3 bucket for evidence files |
| `UPLOADS_DIR` | `uploads` | Local directory for uploaded files (dev) |
| `MAX_UPLOAD_SIZE_MB` | `10` | Maximum file upload size |

### Frontend — `frontend/.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `/api/v1` | API base URL — use `/api/v1` to go through Vite proxy |
| `VITE_APP_NAME` | `GRC Platform` | Application display name |
| `VITE_APP_VERSION` | `0.1.0` | Application version |

---

## SaaS Pricing Tiers

The platform is designed as a multi-tenant SaaS product with three tiers:

| Tier | Price | Frameworks | Admins | AI Features | Support |
|------|-------|-----------|--------|------------|---------|
| **Starter** | ~$6,000–15,000/yr | 3 | 10 | Basic GRC chat | Email |
| **Professional** | ~$20,000–60,000/yr | 10 | 50 | All 6 AI features | Priority email + Slack |
| **Enterprise** | ~$80,000–250,000+/yr | Unlimited | Unlimited | All AI + custom models, white-label, SSO | Dedicated CSM + SLA |

---

## Roadmap

### Near Term
- [ ] Connect Audits and Policies pages to real backend CRUD (currently showing demo data)
- [ ] Evidence file gallery per assessment
- [ ] Risk treatment plan tracking (tasks, owners, due dates)
- [ ] PDF export for audit reports and compliance summaries
- [ ] Email notifications via SMTP

### Medium Term
- [ ] Keycloak SSO integration (OIDC / SAML 2.0)
- [ ] Alembic auto-migrations for schema evolution
- [ ] PostgreSQL as primary database (replacing SQLite dev default)
- [ ] pgvector semantic search across controls and policies
- [ ] Continuous monitoring: scheduled re-assessment triggers
- [ ] Integrations: Jira, ServiceNow, Slack, Microsoft Teams

### Long Term
- [ ] AWS S3 for evidence file storage
- [ ] Stripe billing integration
- [ ] White-label / custom domain support
- [ ] Mobile app (React Native)
- [ ] SOC 2 Type II certification for the platform itself

---

*Built with FastAPI + React + Tailwind CSS + Ollama (local LLM)*
