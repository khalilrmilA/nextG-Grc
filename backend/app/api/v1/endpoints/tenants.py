"""Tenant Management — organization settings, modules, and configuration."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.tenant import Tenant

# Sub-keys allowed inside tenant.settings (whitelist — anything else is dropped).
_SETTINGS_ALLOWED_KEYS = {
    "trust_center", "webhooks", "branding", "notifications", "appearance",
    "locale", "timezone", "data_retention_days", "ai", "compliance",
}

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class TenantOut(BaseModel):
    id: str; name: str; slug: str; domain: str | None; logo_url: str | None
    industry: str | None; country: str | None; primary_framework_id: str | None
    selected_framework_ids: list; org_size: str | None
    features: dict; settings: dict; is_active: bool
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class TenantUpdate(BaseModel):
    name: str | None = None
    logo_url: str | None = None
    industry: str | None = None
    country: str | None = None
    org_size: str | None = None
    primary_framework_id: str | None = None
    selected_framework_ids: list[str] | None = None
    features: dict | None = None
    settings: dict | None = None


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/current", response_model=TenantOut)
async def get_current_tenant(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    return TenantOut.model_validate(t)

@router.patch("/current", response_model=TenantOut)
async def update_current_tenant(
    body: TenantUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    for f in ["name", "logo_url", "industry", "country", "org_size", "primary_framework_id", "selected_framework_ids", "features"]:
        v = getattr(body, f, None)
        if v is not None: setattr(t, f, v)
    # Settings: merge whitelisted sub-keys into existing dict (never replace wholesale).
    if body.settings is not None:
        existing = dict(t.settings or {})
        for key, value in body.settings.items():
            if key in _SETTINGS_ALLOWED_KEYS:
                existing[key] = value
        t.settings = existing
    await db.commit(); await db.refresh(t)
    return TenantOut.model_validate(t)

@router.get("/current/modules")
async def get_enabled_modules(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    features = t.features or {}
    keys = ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "assets", "reports", "ai"]
    # Elite Pack = god mode: every module enabled regardless of tenant.features toggles.
    from app.models.subscription import Subscription
    sub = (await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))).scalar_one_or_none()
    if sub and sub.tier.value == "elite":
        return {"modules": {k: True for k in keys}}
    return {"modules": {k: (True if k == "dashboard" else features.get(k, True)) for k in keys}}
