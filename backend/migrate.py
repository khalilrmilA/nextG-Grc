"""
Apply schema changes (add new tables / columns) without dropping existing data.
Safe to run multiple times — uses CREATE TABLE IF NOT EXISTS via SQLAlchemy.

Run: python migrate.py
"""
import asyncio
import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./grc_dev.db")

from sqlalchemy.ext.asyncio import create_async_engine

# Import all models so Base.metadata is populated
from app.core.database import Base
from app.models import (  # noqa: F401
    tenant, user, framework, compliance, risk, asset, audit, policy, vendor, subscription, notification
)

ENGINE_URL = os.environ["DATABASE_URL"]
engine = create_async_engine(ENGINE_URL, connect_args={"check_same_thread": False})


async def migrate():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("OK: All tables created / already exist")
    await engine.dispose()


asyncio.run(migrate())
