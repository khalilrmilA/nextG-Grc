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
    "locale", "timezone", "data_retention_days", "ai", "compliance", "security",
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


class SecuritySettingsOut(BaseModel):
    max_failed_logins: int
    lockout_minutes: int


class SecuritySettingsUpdate(BaseModel):
    max_failed_logins: int | None = None
    lockout_minutes: int | None = None


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

@router.get("/current/security", response_model=SecuritySettingsOut)
async def get_security_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Effective brute-force lockout thresholds for this tenant — a tenant override
    (Tenant.settings['security']) layered on the platform defaults, satisfying the
    RFP's 'paramétrable' (admin-configurable) lockout requirement. Admin-only."""
    from app.api.v1.endpoints.auth import resolve_security_settings
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    return SecuritySettingsOut(**resolve_security_settings(t.settings))


@router.patch("/current/security", response_model=SecuritySettingsOut)
async def update_security_settings(
    body: SecuritySettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Set a per-tenant override for the brute-force lockout threshold/window. Either
    field may be omitted to leave it unchanged; omitting both is a no-op read. Values
    below 1 are rejected — the login flow (auth.py) reads these back on every failed
    login via resolve_security_settings()."""
    from app.api.v1.endpoints.auth import resolve_security_settings
    if body.max_failed_logins is not None and body.max_failed_logins < 1:
        raise HTTPException(422, "max_failed_logins must be at least 1")
    if body.lockout_minutes is not None and body.lockout_minutes < 1:
        raise HTTPException(422, "lockout_minutes must be at least 1")

    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")

    existing = dict(t.settings or {})
    security = dict(existing.get("security") or {})
    if body.max_failed_logins is not None:
        security["max_failed_logins"] = body.max_failed_logins
    if body.lockout_minutes is not None:
        security["lockout_minutes"] = body.lockout_minutes
    existing["security"] = security
    t.settings = existing
    await db.commit(); await db.refresh(t)
    return SecuritySettingsOut(**resolve_security_settings(t.settings))


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
