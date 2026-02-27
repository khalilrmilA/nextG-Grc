# GRC Platform

A modern, full-featured **Governance, Risk & Compliance (GRC) SaaS platform** — inspired by CISO Assistant and designed to compete with enterprise solutions like Vanta, Drata, Hyperproof, and OneTrust.

## What It Does

- Check compliance against ISO 27001, SOC 2, NIST, GDPR, HIPAA, PCI DSS, and 50+ frameworks
- Map a single control to multiple frameworks simultaneously (cross-walk engine)
- Manage risks with qualitative/quantitative scoring and heat maps
- Run audits with evidence collection, findings management, and auditor portals
- Manage policies with versioning, approval workflows, and employee attestation
- Assess vendor/third-party risk (TPRM)
- Monitor compliance posture in real time via integrations
- Multi-tenant SaaS with Starter / Professional / Enterprise tiers

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React/TS)                  │
│              Tailwind CSS + shadcn/ui                    │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API (HTTPS)
┌──────────────────────▼──────────────────────────────────┐
│               Backend API (FastAPI / Python)             │
│          Multi-tenant | JWT Auth | RBAC                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  Risk    │ │Compliance│ │  Audit   │ │  Policy  │  │
│  │ Module   │ │ Module   │ │ Module   │ │ Module   │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  TPRM    │ │Dashboard │ │Framework │ │   AI     │  │
│  │ Module   │ │ Module   │ │ Engine   │ │ Copilot  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└──────────┬──────────────┬────────────────┬─────────────┘
           │              │                │
  ┌────────▼──────┐  ┌───▼────┐   ┌──────▼──────┐
  │  PostgreSQL   │  │ Redis  │   │  Celery     │
  │  (RLS multi-  │  │ Cache  │   │  Workers    │
  │   tenancy)    │  │ Queue  │   │(Integrations│
  └───────────────┘  └────────┘   │  Evidence) │
                                  └─────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12+, FastAPI |
| ORM | SQLAlchemy 2.0 + Alembic |
| Frontend | React 18, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui |
| Database | PostgreSQL 16 (Row-Level Security) |
| Caching | Redis 7 |
| Task Queue | Celery 5 |
| Auth | Keycloak (SSO, SAML, OIDC, MFA) |
| File Storage | AWS S3 |
| AI | Anthropic Claude API |
| Containers | Docker + Docker Compose |
| Orchestration | Kubernetes (production) |

## SaaS Tiers

| Feature | Starter | Professional | Enterprise |
|---|---|---|---|
| Price (annual) | ~$6K–$15K | ~$20K–$60K | ~$80K–$250K |
| Frameworks | 3 | 10 | Unlimited |
| Admin Users | 10 | 50 | Unlimited |
| Integrations | 25 | 75+ | 150+ |
| Risk Module | Basic | Full | Full + Quantitative |
| Audit Module | - | Full | Full |
| TPRM | 25 vendors | 100 vendors | Unlimited |
| AI Copilot | - | - | Yes |
| Trust Center | - | Yes | Yes |
| SSO/SAML | - | - | Yes |
| White-label | - | - | Yes |
| SLA | 99.5% | 99.9% | 99.99% |

## Supported Frameworks

### Phase 1 (MVP)
- ISO 27001:2022 / ISO 27002:2022
- SOC 2 Type I & II
- NIST CSF 2.0
- NIST SP 800-53 Rev 5
- GDPR
- HIPAA
- PCI DSS 4.0
- CIS Controls v8

### Phase 2
- NIST SP 800-171 Rev 3 / CMMC v2
- NIS2 / DORA (EU)
- FedRAMP / CCPA
- NIST AI RMF / EU AI Act

### Phase 3 (Regional)
- TISAX, BSI IT-Grundschutz, Cyber Essentials, Essential Eight
- SAMA, DPDPA, PDPA, LGPD
- ISO 22301, ISO 31000

---

## Project Structure

```
grc-platform/
├── backend/                    # FastAPI Python backend
│   ├── app/
│   │   ├── api/v1/             # API routes (versioned)
│   │   ├── core/               # Config, security, database
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── services/           # Business logic layer
│   │   ├── repositories/       # Database access layer
│   │   ├── workers/            # Celery async tasks
│   │   ├── integrations/       # Third-party connectors
│   │   └── frameworks/         # Framework loading engine
│   ├── tests/
│   ├── alembic/                # Database migrations
│   └── pyproject.toml
│
├── frontend/                   # React TypeScript frontend
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Route-level page components
│   │   ├── features/           # Feature-specific components
│   │   ├── hooks/              # Custom React hooks
│   │   ├── store/              # Zustand state management
│   │   ├── api/                # API client (Axios/React Query)
│   │   └── types/              # TypeScript type definitions
│   └── package.json
│
├── frameworks/                 # YAML compliance framework definitions
│   ├── iso/iso-27001-2022.yaml
│   ├── nist/nist-csf-2.0.yaml
│   ├── soc2/soc2-type2.yaml
│   ├── gdpr/gdpr.yaml
│   └── ...
│
├── infrastructure/
│   ├── docker/                 # Dockerfiles
│   ├── k8s/                    # Kubernetes manifests
│   ├── terraform/              # AWS infrastructure as code
│   └── scripts/                # Deployment scripts
│
└── docs/
    ├── architecture/           # Architecture decision records (ADRs)
    ├── api/                    # OpenAPI documentation
    └── user-guide/             # End-user documentation
```

---

## Quick Start (Development)

```bash
# Clone and start with Docker Compose
git clone https://github.com/your-org/grc-platform
cd grc-platform

# Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Start all services
docker-compose up -d

# Apply database migrations
docker-compose exec backend alembic upgrade head

# Load framework definitions
docker-compose exec backend python -m app.cli load-frameworks

# Access
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
# Keycloak: http://localhost:8080
```

---

## Development Roadmap

### Phase 1 — MVP (Months 1–9)
- [ ] Core data model (tenants, users, assets, controls, risks, evidence)
- [ ] Framework engine (YAML loader, control mapping, cross-walk)
- [ ] Risk module (register, scoring, heat map, treatment)
- [ ] Compliance module (assessments, evidence, posture dashboard)
- [ ] Audit module (planning, fieldwork, findings)
- [ ] Policy module (templates, versioning, attestation)
- [ ] Basic TPRM (vendor questionnaires)
- [ ] Billing & subscription management (Stripe)
- [ ] 8 core frameworks loaded

### Phase 2 — Growth (Months 9–18)
- [ ] AI Copilot (Claude API - policy drafting, gap analysis)
- [ ] Continuous control monitoring (20+ integrations)
- [ ] Full TPRM module with continuous monitoring
- [ ] Trust center (customer-facing compliance portal)
- [ ] Financial risk quantification (FAIR model)
- [ ] Regulatory change alerts
- [ ] 30+ frameworks

### Phase 3 — Enterprise (Months 18–36)
- [ ] 100+ frameworks
- [ ] ESG module
- [ ] Business continuity module
- [ ] Self-hosted enterprise deployment
- [ ] White-label options
- [ ] Integration marketplace
- [ ] SOC 2 Type II certification for platform itself
#   G R C  
 