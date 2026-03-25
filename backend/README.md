# GRC SaaS Platform - Backend

FastAPI-based backend for the GRC (Governance, Risk & Compliance) SaaS platform.

## Quick Start

```bash
pip install -e .
uvicorn app.main:app --reload
```

## Architecture

- FastAPI REST API
- SQLAlchemy ORM with async support
- Multi-tenant architecture
- JWT authentication
- Redis for caching/tasks
- Celery for background jobs
