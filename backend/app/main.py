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

    # Start background schedulers (threat feed every 24h; scheduled reports every 5m)
    _scheduler_task = asyncio.create_task(start_threat_scheduler())
    _report_task = asyncio.create_task(start_report_scheduler())

    yield

    # Graceful shutdown — cancel the background tasks
    _scheduler_task.cancel()
    _report_task.cancel()
    for _task in (_scheduler_task, _report_task):
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
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
        docs_url=f"{settings.API_V1_PREFIX}/docs",
        redoc_url=f"{settings.API_V1_PREFIX}/redoc",
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
