"""Async SQLAlchemy engine + session factory.

Supported databases (set via ``DATABASE_URL``):
  - SQLite (dev/on-prem):  sqlite+aiosqlite:///abs/path/grc_dev.db
  - PostgreSQL:            postgresql+asyncpg://user:pass@host:5432/grc
  - Oracle 19c:            oracle+oracledb://user:pass@host:1521/?service_name=ORCLPDB1
                           (oracledb "thin" mode — no Oracle client needed; pip install -r requirements-oracle.txt)
  - SQL Server 2019:       mssql+aioodbc://user:pass@host:1433/grc?driver=ODBC+Driver+18+for+SQL+Server
                           (needs unixODBC + msodbcsql at OS level; pip install -r requirements-mssql.txt)

Only the async driver differs per backend; the ORM models are portable. Server
backends get a connection pool + pre-ping (which matters under the 2-worker PM2
deployment, where dead connections would otherwise surface as request errors).
"""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, DateTime, func
from sqlalchemy.engine.url import make_url
from typing import AsyncGenerator
import uuid
from datetime import datetime

from app.core.config import settings

_url = make_url(settings.DATABASE_URL)
_backend = _url.get_backend_name()  # 'sqlite' | 'postgresql' | 'oracle' | 'mssql'
_is_sqlite = _backend == "sqlite"

# SQLite (aiosqlite) has no pool_size / max_overflow; server DBs get a pool + pre-ping.
_engine_kwargs: dict = {"echo": settings.DEBUG}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    _engine_kwargs["pool_size"] = settings.DATABASE_POOL_SIZE
    _engine_kwargs["max_overflow"] = settings.DATABASE_MAX_OVERFLOW
    _engine_kwargs["pool_pre_ping"] = True

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def database_backend() -> str:
    """The active DB backend name — 'sqlite' | 'postgresql' | 'oracle' | 'mssql'."""
    return _backend


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""

    # Every table has these columns
    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
