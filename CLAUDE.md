# GRC SaaS Platform — Claude Development Guide

## Quick Start

This is a **full-stack GRC (Governance, Risk & Compliance) SaaS platform** with FastAPI backend + React frontend.

### Running the App

```bash
# Terminal 1: Backend (port 8000)
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend (port 4000)
cd frontend
npm install
npm run dev -- --port 4000
```

**Login at http://localhost:4000 with:**
- Admin: `admin@demo.com` / `demo123`
- User: `ciso@demo.com` / `demo123`
- Auditor: `auditor@demo.com` / `demo123`
- Super Admin: `superadmin@platform.com` / `super123`

---

## Architecture

### Tech Stack
- **Backend**: FastAPI (Python 3.12+) + SQLAlchemy ORM + SQLite (dev)
- **Frontend**: React 18 + TypeScript + Tailwind CSS + shadcn/ui
- **Database**: SQLite for dev, PostgreSQL for prod
- **i18n**: react-i18next (en, fr, ar locales)
- **Auth**: JWT + role-based access control

### Key Directories

```
backend/
  app/
    core/          # Config, database, security, seed data
    models/        # SQLAlchemy ORM models
    api/v1/
      endpoints/   # Route handlers (risks, compliance, audits, etc)
    frameworks/    # YAML loader for compliance frameworks
    workers/       # Celery tasks (not active in dev)

frontend/
  src/
    pages/         # Page components (Dashboard, Risks, Compliance, etc)
    components/    # Reusable UI (Layout, forms, tables, etc)
    api/           # HTTP client + endpoint functions
    types/         # TypeScript interfaces
    store/         # Auth state management
    locales/       # i18n translation files (en.ts, fr.ts, ar.ts)
    context/       # React context (FrameworkContext)

frameworks/        # YAML files for 8 compliance frameworks (ISO 27001, SOC 2, NIST, GDPR, etc)
  iso/
  nist/
  gdpr/
  ...
```

---

## User Roles & Access

| Role | Org | Access | Portal |
|------|-----|--------|--------|
| `super_admin` | Platform Owner | All users across all tenants, manage frameworks | `/super-admin` |
| `admin` | Company Owner | Full app access + manage auditors | `/dashboard` (full nav) + `/company-admin` |
| `user` | Company Staff | Full app access (dashboard, risks, compliance, etc) | `/dashboard` (full nav) |
| `auditor` | Company Auditor | Only assigned audits + company documents | `/auditor/portal` |

### Route Guards
- Auditors cannot access `/dashboard`, `/doc-generator`, etc → redirects to `/auditor/portal`
- Super admin cannot access main app → redirects to `/super-admin`
- All other roles get full navigation

---

## Key Features

### 1. **Risk Management** (`/risks`)
- Register risks by category (technical, operational, strategic)
- Assign severity + probability
- Track treatment plans
- Mock data: 1 example risk (when backend offline)

### 2. **Compliance Assessments** (`/compliance`)
- Upload policy docs + auto-analyze with AI (Ollama)
- Assess controls: Compliant / Partial / Gap / N/A
- **Justifications** — add text explanation + file attachment for each control
- **Override status** — manually change control status with reason
- **Gap Report** — AI-identified gaps + remediation steps
- **Cross-Framework** — run analysis to see which frameworks you already cover (ISO, NIST, SOC 2, etc)

### 3. **Policy Generator** (`/policy-generator`)
- AI generates security policy documents (Information Security Policy, Access Control Policy, etc)
- Select target frameworks + pick specific controls
- Customizable org details (industry, size, jurisdiction)
- Auto-populates from framework selection on Frameworks page

### 4. **Frameworks** (`/frameworks`)
- Browse 8+ built-in frameworks (ISO 27001, SOC 2, NIST CSF, GDPR, HIPAA, PCI DSS, CIS Controls, etc)
- **Click any framework card** → side drawer shows all controls grouped by category
- Checkbox select controls → **"Use in Doc Generator"** button pre-populates doc generator
- View control IDs, titles, descriptions, tags

### 5. **Super Admin Panel** (`/super-admin`)
- **Users Tab**: Manage all users across all tenants. Change roles (user/auditor only). Toggle active/inactive
- **Access Control Tab**: Enable/disable modules per tenant
- **Frameworks Tab**: Upload custom frameworks as PDF
- **Settings Tab**: Profile, Security, Notifications, Platform Info

### 6. **Company Admin Panel** (`/company-admin`)
- Create auditors by name, email, password
- Toggle auditor active/inactive
- Delete auditors
- View stats: total, active, inactive

### 7. **Auditor Portal** (`/auditor/portal`)
- Show assigned audit assessments with progress bars
- Company documents list (all published policies)
- Stats: assignments, controls reviewed, pending

---

## Data Flow Examples

### Example 1: Running Compliance Analysis
1. User uploads policy document to assessment
2. **"Analyze"** button → calls `POST /compliance/assessments/{id}/analyze`
3. Backend extracts text + runs Ollama AI against 118+ controls
4. Creates `ControlAssessment` records with status + confidence
5. Computes `cross_framework_summary` (which frameworks are covered)
6. Frontend reloads assessment → displays Results tab with control cards
7. User can justify/override each control status

### Example 2: Policy Generation
1. User clicks framework card → control picker modal opens
2. Selects 5 controls → "Use in Doc Generator"
3. `sessionStorage` captures selected controls + framework
4. Frontend pre-fills doc generator form
5. User fills in org details → AI generates policy document
6. Selected controls appear in AI prompt as context

### Example 3: Cross-Framework Discovery
1. User completes ISO 27001 compliance assessment
2. Opens Cross-Framework tab → **"Run Analysis"** button
3. Backend computes which other frameworks are covered based on mapped controls
4. Shows: "SOC 2: 75%", "NIST CSF: 62%", "GDPR: 81%" with recommendations
5. User sees "Ready to certify" badge for frameworks ≥75% covered

---

## Important Notes for Future Devs

### Frontend i18n
- **All pages have been wired for translations** using react-i18next
- Locale files: `frontend/src/locales/en.ts`, `fr.ts`, `ar.ts` (473 keys each)
- Use `const { t } = useTranslation()` in components → `t("key.path")`
- Language switcher in top right of all pages

### Mock Data
- Removed heavy mock data — **each page shows only 1 example item** when backend is offline
- Risks: 1 risk, Audits: 1 audit, Policies: 1 policy, Vendors: 1 vendor
- Cross-framework: shows "Run Analysis" button when empty

### Backend Database
- SQLite for dev (file: `backend/grc.db`)
- Frameworks loaded on startup from YAML files in `/frameworks`
- Crosswalk mappings (`mapped_controls`) come from YAML → stored in DB
- `_compute_cross_framework_coverage()` aggregates coverage from control assessments

### Frameworks YAML Structure
```yaml
# frameworks/iso/iso-27001-2022.yaml
controls:
  - control_id: "A.5.1"
    title: "Information Security Policies"
    description: "..."
    category: "Policies and procedures"
    mapped_controls:
      - framework: "SOC 2"
        control: "CC6.1"
      - framework: "NIST CSF"
        control: "PR.AC-1"
```

### Auth Model
- JWT tokens stored in localStorage
- `useAuthStore()` hook for React components
- `authSession` object for imperative access
- Super admin bypasses role checks in `require_roles()` decorator

### Common Patterns

**Protected Routes:**
```tsx
// Auditors only → /auditor/portal
// Super admin only → /super-admin
// Everyone else → /dashboard
```

**API Calls with Error Fallback:**
```tsx
try {
  const data = await api.fetch()
} catch {
  // Shows mock data or empty state
}
```

**Component Props Pattern:**
```tsx
<Card
  data={data}
  onUpdate={handler}
  isLoading={loading}
  className="..."
/>
```

---

## Database Models

### Core
- `User` — email, role (super_admin/admin/user/auditor), tenant_id, first/last name
- `Tenant` — organization name, slug, enabled_modules
- `Framework` — name, short_name, version, control_count, is_builtin
- `FrameworkControl` — control_id, title, description, category, mapped_controls (JSON)

### Compliance
- `ComplianceAssessment` — framework_id, status, compliance_score, control_assessments, gaps
- `ControlAssessment` — assessment_id, control_id, status, notes, ai_confidence, justification
- `ComplianceGap` — control_id, gap_description, severity, remediation_steps

### Audit
- `AuditAssignment` — auditor_id, assessment_id, status, controls_verified
- `AuditChecklist` — task_id, audit_id, is_completed

### Other
- `Policy` — title, policy_type, status, version, tenant_id
- `Vendor` — name, industry, risk_tier, questionnaire responses
- `UploadedDocument` — assessment_id, file_name, extracted_text

---

## Common Debugging

### Frontend: Nothing shows after button click
- Check browser console (F12) for errors
- Check network tab — did API call succeed?
- If backend offline, does component have mock data fallback?
- Check sessionStorage for cross-framework control data

### Backend: Analysis takes forever
- Ollama might be slow or not running
- Check logs: `uvicorn app.main:app --reload`
- For dev: analysis is synchronous, may take 1–5 minutes

### Framework controls not showing in cross-framework
- Frameworks must be loaded on startup: check logs for "Loaded X controls from Y frameworks"
- YAML files must have `mapped_controls` field
- Run analysis: `POST /compliance/assessments/{id}/analyze`

### Auditor can't see company documents
- Check `policiesApi.list()` endpoint returns tenant-filtered results
- Auditor should see all policies for their tenant

---

## Next Steps for New Features

1. **Add new page?** Create `frontend/src/pages/NewPage.tsx` + add route in `App.tsx`
2. **Add new API endpoint?** Create new file in `backend/app/api/v1/endpoints/` + register in router
3. **Add new data model?** Define in `backend/app/models/` + run Alembic migration (or create table on startup)
4. **Add new i18n keys?** Add to all three locales (`en.ts`, `fr.ts`, `ar.ts`) + use `t("key")`
5. **Add role permissions?** Update `require_roles()` in endpoint + `PrivateRoute` in frontend

---

## Useful Commands

```bash
# Backend
uvicorn app.main:app --reload          # Start with hot reload
python -c "from app.frameworks.loader import load_all_frameworks; import asyncio; ..." # Reload frameworks

# Frontend
npm run dev                             # Start dev server
npm run build                           # Production build
npm run type-check                      # Check TypeScript errors

# Git
git log --oneline -10                   # Recent commits
git status                              # What changed
```

---

## Project Stats

- **Backend**: ~2,500 lines (FastAPI + SQLAlchemy)
- **Frontend**: ~15,000+ lines (React + TypeScript)
- **Frameworks**: 8 built-in frameworks (ISO 27001, SOC 2, NIST, GDPR, HIPAA, PCI DSS, CIS, NIS2, etc)
- **Controls**: 800+ total controls across all frameworks
- **Languages**: English, French, Arabic (i18n complete)

---

## Contact / Questions

- Check the codebase comments (marked with `//` or `"""`)
- Read existing similar features for patterns
- Use git log to see how features were built

Happy coding! 🚀
