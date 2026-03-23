"""
GRC Platform — FastAPI Application Entry Point
"""
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
from app.frameworks.loader import load_all_frameworks

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("Starting GRC Platform", version=settings.APP_VERSION, env=settings.ENVIRONMENT)

    # Create all tables (dev / SQLite mode — no-op if already exist)
    async with engine.begin() as conn:
        # Import all models so metadata is populated
        import app.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

    # Seed reference data
    async with AsyncSessionLocal() as db:
        await seed_mandatory_documents(db)
        # Load all framework YAML files with crosswalk mappings
        fws = await load_all_frameworks(db)
        logger.info(f"Loaded {sum(fws.values())} controls from {len(fws)} frameworks")

    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENVIRONMENT,
            traces_sample_rate=0.1 if settings.ENVIRONMENT == "production" else 1.0,
        )

    yield

    logger.info("Shutting down GRC Platform")
    await engine.dispose()


def create_application() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="GRC SaaS Platform API — Governance, Risk & Compliance",
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
        docs_url=f"{settings.API_V1_PREFIX}/docs",
        redoc_url=f"{settings.API_V1_PREFIX}/redoc",
        lifespan=lifespan,
    )

    # Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    # Routes
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "version": settings.APP_VERSION}

    return app


app = create_application()
