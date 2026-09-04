"""
GRC Platform — FastAPI Application Entry Point
"""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import structlog
import sentry_sdk

from app.core.config import settings, is_production
from app.core.database import engine, Base, AsyncSessionLocal
from app.api.v1.router import api_router
from app.core.seed_mandatory_docs import seed_mandatory_documents
from app.services.threat_scheduler import start_threat_scheduler
from app.services.report_scheduler import start_report_scheduler
from app.services.nvd_sync import start_cve_auto_sync
from app.services.vuln_scanner_scheduler import start_vuln_scanner_scheduler
from app.services.audit_recurrence_scheduler import start_audit_recurrence_scheduler
from app.services.archiving_engine import start_archiving_scheduler
from app.services.file_retention import start_file_retention_scheduler
from app.services.risk_snapshot_scheduler import start_risk_snapshot_scheduler
from app.services.license_phone_home import start_license_phone_home
from app.core.activity_middleware import ActivityLogMiddleware
from app.core.license_middleware import LicenseEnforcementMiddleware
from app.core.security_middleware import SecurityHeadersMiddleware
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup and shutdown events."""
    logger.info("Starting GRC Platform", version=settings.APP_VERSION, env=settings.ENVIRONMENT)

    # Create all tables (dev / SQLite mode — no-op if already exist)
    async with engine.begin() as conn:
        import app.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

    # Seed reference data
    async with AsyncSessionLocal() as db:
        await seed_mandatory_documents(db)

    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENVIRONMENT,
            traces_sample_rate=0.1 if settings.ENVIRONMENT == "production" else 1.0,
        )

    # Start background schedulers (threat feed 24h; scheduled reports 5m; CVE sync daily;
    # scanner-connector auto-sync hourly poll / per-connector interval_hours cadence;
    # audit recurrence hourly poll — spawns the next cycle of a closed recurring audit;
    # archiving rules 5m poll — auto-archives records matching an enabled ArchivingRule;
    # risk snapshot hourly poll — writes at most one open-risk-by-severity row per
    # tenant per UTC day, feeding GET /dashboard/risk-trend's real history series;
    # license phone-home 12h poll — asks the vendor license server whether this
    # appliance's activated key was revoked; no-op unless licensed + LICENSE_SERVER_URL set)
    _scheduler_task = asyncio.create_task(start_threat_scheduler())
    _report_task = asyncio.create_task(start_report_scheduler())
    _cve_task = asyncio.create_task(start_cve_auto_sync())
    _vuln_scanner_task = asyncio.create_task(start_vuln_scanner_scheduler())
    _audit_recurrence_task = asyncio.create_task(start_audit_recurrence_scheduler())
    _archiving_task = asyncio.create_task(start_archiving_scheduler())
    _file_retention_task = asyncio.create_task(start_file_retention_scheduler())
    _risk_snapshot_task = asyncio.create_task(start_risk_snapshot_scheduler())
    _license_phone_home_task = asyncio.create_task(start_license_phone_home())

    yield

    # Graceful shutdown — cancel the background tasks
    _scheduler_task.cancel()
    _report_task.cancel()
    _cve_task.cancel()
    _vuln_scanner_task.cancel()
    _audit_recurrence_task.cancel()
    _archiving_task.cancel()
    _risk_snapshot_task.cancel()
    _license_phone_home_task.cancel()
    for _task in (_scheduler_task, _report_task, _cve_task, _vuln_scanner_task, _audit_recurrence_task, _archiving_task, _risk_snapshot_task, _license_phone_home_task):
        try:
            await _task
        except asyncio.CancelledError:
            pass
    logger.info("Background schedulers cancelled — shutting down")

    logger.info("Shutting down GRC Platform")
    await engine.dispose()


def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="GRC SaaS Platform API — Governance, Risk & Compliance",
        # Hide the interactive API docs + schema in production (exposed only in dev/staging).
        openapi_url=None if is_production() else f"{settings.API_V1_PREFIX}/openapi.json",
        docs_url=None if is_production() else f"{settings.API_V1_PREFIX}/docs",
        redoc_url=None if is_production() else f"{settings.API_V1_PREFIX}/redoc",
        lifespan=lifespan,
    )

    # Rate limiter (slowapi) — register before routes so route decorators see it.
    application.state.limiter = limiter
    application.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

    # Middleware — CORSMiddleware must be added last (outermost layer)
    application.add_middleware(GZipMiddleware, minimum_size=1000)
    application.add_middleware(ActivityLogMiddleware)
    application.add_middleware(SecurityHeadersMiddleware, is_production=is_production())
    # License enforcement — always registered; no-op unless enforcement is enabled
    application.add_middleware(LicenseEnforcementMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept", "Origin"],
        max_age=600,
    )

    # Routes
    application.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @application.get("/health")
    async def health_check():
        return {"status": "healthy", "version": settings.APP_VERSION}

    return application


app = create_application()
