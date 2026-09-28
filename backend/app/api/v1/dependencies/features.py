"""Feature-gating dependencies — Elite Pack and per-feature entitlement checks.

Usage in an endpoint::

    from app.api.v1.dependencies.features import require_feature

    @router.get("/cve")
    async def list_cve(
        current_user: User = Depends(require_feature("cve_knowledge_base")),
        tenant_id: str = Depends(get_tenant_id),
    ):
        ...

`require_feature` returns the authenticated ``User`` (like ``get_current_user``),
so it composes as a drop-in replacement for the auth dependency on gated routes.
Platform super admins bypass gating; a tenant unlocks a feature via the ELITE
tier or an explicit ``custom_limits`` override on its subscription, and a single
user can be granted the whole Elite Pack by a super admin (``User.elite_access``).
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.subscription import Subscription, SubscriptionTier, TIER_LIMITS
from app.api.v1.dependencies.auth import get_current_user


async def _tenant_subscription(tenant_id: str, db: AsyncSession) -> Subscription | None:
    result = await db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


def user_has_elite(user: User) -> bool:
    """True if this user individually holds the Elite Pack (super admin grant)."""
    return bool(getattr(user, "elite_access", False))


async def get_tenant_features(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the effective feature/limits map for the current user's tenant.

    Super admins implicitly get the full Elite map; tenants with no subscription
    row fall back to Starter defaults.
    """
    if current_user.role == UserRole.SUPER_ADMIN or user_has_elite(current_user):
        return dict(TIER_LIMITS[SubscriptionTier.ELITE])
    sub = await _tenant_subscription(current_user.tenant_id, db)
    if sub is None:
        return dict(TIER_LIMITS[SubscriptionTier.STARTER])
    return sub.limits


def require_feature(feature: str):
    """Dependency factory: HTTP 402 unless the tenant's plan unlocks ``feature``."""

    async def _require_feature(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if current_user.role == UserRole.SUPER_ADMIN or user_has_elite(current_user):
            return current_user
        sub = await _tenant_subscription(current_user.tenant_id, db)
        if not (sub and sub.has_feature(feature)):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error": "feature_not_in_plan",
                    "feature": feature,
                    "pack": "elite",
                    "message": (
                        "This capability is part of the Elite Pack. "
                        f"Upgrade the subscription to enable '{feature}'."
                    ),
                },
            )
        return current_user

    return _require_feature
