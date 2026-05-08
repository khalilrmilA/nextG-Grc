"""Subscription Management — plan tiers, limits, and billing info."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus, TIER_LIMITS

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class SubscriptionOut(BaseModel):
    id: str; tenant_id: str; tier: str; status: str
    billing_cycle: str; amount_cents: int | None; currency: str
    trial_ends_at: str | None; current_period_start: str | None
    current_period_end: str | None; canceled_at: str | None
    limits: dict
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class SubscriptionUpdate(BaseModel):
    tier: str | None = None
    billing_cycle: str | None = None

class PlanInfo(BaseModel):
    tier: str
    name: str
    features: dict


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/plans", response_model=list[PlanInfo])
async def list_plans():
    """List all available subscription plans with features."""
    return [
        PlanInfo(tier=tier.value, name=tier.value.title(), features=TIER_LIMITS[tier])
        for tier in SubscriptionTier
    ]

@router.get("/current", response_model=SubscriptionOut)
async def get_current_subscription(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    sub = r.scalar_one_or_none()
    if not sub: raise HTTPException(404, "No subscription found")
    out = SubscriptionOut.model_validate(sub)
    out.limits = sub.limits
    return out

@router.patch("/current", response_model=SubscriptionOut)
async def update_subscription(
    body: SubscriptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Update subscription billing cycle. Tier changes are RESTRICTED to
    super_admin: tier mutation belongs to the billing system, not user
    self-service (otherwise any user could escalate to enterprise tier)."""
    r = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    sub = r.scalar_one_or_none()
    if not sub: raise HTTPException(404, "No subscription found")
    if body.tier:
        if current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(403, "Only platform admins can change subscription tier")
        sub.tier = SubscriptionTier(body.tier)
    if body.billing_cycle:
        if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN):
            raise HTTPException(403, "Insufficient permissions")
        sub.billing_cycle = body.billing_cycle
    await db.commit(); await db.refresh(sub)
    out = SubscriptionOut.model_validate(sub)
    out.limits = sub.limits
    return out

@router.get("/current/limits")
async def get_limits(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    sub = r.scalar_one_or_none()
    if not sub:
        return TIER_LIMITS[SubscriptionTier.STARTER]
    return sub.limits
