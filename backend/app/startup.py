"""
Startup script: creates database tables and seeds demo data.
Run once on first launch. Idempotent — safe to re-run.
"""
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.database import engine, Base, AsyncSessionLocal
from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[startup] Database tables created.")


async def seed_demo_data():
    async with AsyncSessionLocal() as db:
        # Check if demo tenant already exists
        result = await db.execute(select(Tenant).where(Tenant.slug == "demo"))
        if result.scalar_one_or_none():
            print("[startup] Demo data already exists, skipping seed.")
            return

        # Create demo tenant
        tenant = Tenant(
            name="Acme Corp (Demo)",
            slug="demo",
            industry="technology",
            country="US",
            is_active=True,
        )
        db.add(tenant)
        await db.flush()

        # Create subscription (active trial)
        subscription = Subscription(
            tenant_id=tenant.id,
            tier=SubscriptionTier.PROFESSIONAL,
            status=SubscriptionStatus.TRIALING,
            billing_cycle="annual",
            trial_ends_at="2026-03-15T00:00:00Z",
        )
        db.add(subscription)

        # Create admin user: admin@demo.com / demo123
        admin = User(
            tenant_id=tenant.id,
            email="admin@demo.com",
            hashed_password=hash_password("demo123"),
            first_name="Admin",
            last_name="Demo",
            role=UserRole.TENANT_ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add(admin)

        # Create CISO user
        ciso = User(
            tenant_id=tenant.id,
            email="ciso@demo.com",
            hashed_password=hash_password("demo123"),
            first_name="Sarah",
            last_name="Security",
            role=UserRole.CISO,
            is_active=True,
            is_verified=True,
        )
        db.add(ciso)

        await db.commit()
        print("[startup] Demo data seeded:")
        print("  Tenant: Acme Corp (Demo)")
        print("  Users: admin@demo.com / demo123")
        print("        ciso@demo.com / demo123")


async def run():
    await create_tables()
    await seed_demo_data()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
