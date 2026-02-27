"""
Seed the demo account: admin@demo.com / demo123
Run once: python seed_demo.py
"""
import asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select

# Force SQLite
import os
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./grc_dev.db")

from app.core.database import Base
from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus

ENGINE_URL = "sqlite+aiosqlite:///./grc_dev.db"

engine = create_async_engine(ENGINE_URL, connect_args={"check_same_thread": False})
Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def seed():
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ Tables created")

    async with Session() as db:
        # Check if already seeded
        existing = await db.execute(select(User).where(User.email == "admin@demo.com"))
        if existing.scalar_one_or_none():
            print("✓ Demo user already exists — login: admin@demo.com / demo123")
            return

        # Create tenant
        tenant = Tenant(
            name="Acme Corp",
            slug="acme-corp",
            country="US",
            industry="Technology",
        )
        db.add(tenant)
        await db.flush()

        # Create subscription (active trial)
        subscription = Subscription(
            tenant_id=tenant.id,
            tier=SubscriptionTier.STARTER,
            status=SubscriptionStatus.TRIALING,
            trial_ends_at=(datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
        )
        db.add(subscription)

        # Create admin user
        user = User(
            tenant_id=tenant.id,
            email="admin@demo.com",
            hashed_password=hash_password("demo123"),
            first_name="Admin",
            last_name="User",
            role=UserRole.TENANT_ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        print("✓ Demo user created")
        print("  Email:    admin@demo.com")
        print("  Password: demo123")
        print("  Org:      Acme Corp")

    await engine.dispose()


asyncio.run(seed())
