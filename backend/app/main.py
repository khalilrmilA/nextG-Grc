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

from app.core.config import settings
from app.core.database import engine, Base, AsyncSessionLocal
from app.api.v1.router import api_router
from app.core.seed_mandatory_docs import seed_mandatory_documents
from app.services.threat_scheduler import start_threat_scheduler
from app.core.activity_middleware import ActivityLogMiddleware

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

    # Start background threat feed scheduler (runs every 24h automatically)
    _scheduler_task = asyncio.create_task(start_threat_scheduler())

    yield

    # Graceful shutdown — cancel the background task
    _scheduler_task.cancel()
    try:
        await _scheduler_task
    except asyncio.CancelledError:
        logger.info("Threat scheduler cancelled — shutting down")
        raise

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

    # Middleware — CORSMiddleware must be added last (outermost layer)
    application.add_middleware(GZipMiddleware, minimum_size=1000)
    application.add_middleware(ActivityLogMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routes
    application.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @application.get("/health")
    async def health_check():
        return {"status": "healthy", "version": settings.APP_VERSION}

    return application


app = create_application()
