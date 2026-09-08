"""Subscription Management — plan tiers, limits, and billing info."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User, UserRole
from app.models.subscription import (
    Subscription,
    SubscriptionTier,
    TIER_LIMITS,
    togglable_features,
)

router = APIRouter()

# The only two values Subscription.billing_cycle is ever meant to hold (see the
# model's own comment and the frontend's Subscription type).
_BILLING_CYCLES = {"monthly", "annual"}


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
        try:
            sub.tier = SubscriptionTier(body.tier)
        except ValueError:
            # SubscriptionTier._missing_ returns None for anything unknown, so the
            # bare constructor raised ValueError and the request 500'd.
            raise HTTPException(422, f"Invalid tier: {body.tier}")
    if body.billing_cycle:
        if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.CISO):
            raise HTTPException(403, "Insufficient permissions")
        # Free-text before: billing_cycle is a String(20) the UI renders as one of
        # two values, so anything else was stored and then displayed verbatim.
        if body.billing_cycle not in _BILLING_CYCLES:
            raise HTTPException(422, f"Invalid billing_cycle: {body.billing_cycle}")
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


class EntitlementsOut(BaseModel):
    """What the signed-in tenant may actually use."""
    tier: str
    # feature key -> allowed. Computed with the SAME has_feature() that
    # require_feature enforces with, so the two cannot disagree.
    features: dict[str, bool]
    # Numeric quotas (max_vendors, max_frameworks, ...). Shown, never toggled.
    limits: dict


@router.get("/current/entitlements", response_model=EntitlementsOut)
async def get_entitlements(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """The feature map the dashboard gates its navigation on.

    This exists because the frontend previously had no entitlement source at
    all: every module was rendered for every tenant, and a blocked one only
    revealed itself as a 402 after the user clicked it. Hiding it needs the
    same answer the gate gives, which is why this calls has_feature rather than
    reading sub.limits. They are not equivalent: limits is the merged tier map,
    while has_feature also applies Elite god mode and lets an explicit override
    win over it. Gating the UI on limits would hide features an Elite tenant is
    entitled to.

    Super admins are not tenant-scoped and bypass require_feature entirely, so
    they get everything enabled here too. Reporting anything else would hide
    parts of the platform from the person administering it.
    """
    keys = [k for k, _ in togglable_features()]

    if current_user.role == UserRole.SUPER_ADMIN:
        return EntitlementsOut(
            tier="super_admin",
            features={k: True for k in keys},
            limits=TIER_LIMITS[SubscriptionTier.ENTERPRISE],
        )

    r = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    sub = r.scalar_one_or_none()

    if not sub:
        # No subscription row: fall back to Starter rather than unlocking
        # everything. Failing open here would defeat the gate for any tenant
        # whose row is missing.
        base = TIER_LIMITS[SubscriptionTier.STARTER]
        return EntitlementsOut(
            tier=SubscriptionTier.STARTER.value,
            features={k: bool(base.get(k, False)) for k in keys},
            limits=base,
        )

    return EntitlementsOut(
        tier=sub.tier.value,
        features={k: sub.has_feature(k) for k in keys},
        limits=sub.limits,
    )
