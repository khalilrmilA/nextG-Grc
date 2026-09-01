"""License status and activation endpoints (client-install side)."""
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from app.core.database import get_db
from app.core.licensing import (
    effective_public_key,
    enforcement_enabled,
    invalidate_license_cache,
    normalize_plan,
    verify_license,
)
from app.models.license import LicenseActivation
from app.models.subscription import Subscription, SubscriptionStatus, SubscriptionTier
from app.models.user import User, UserRole
from app.api.v1.dependencies.auth import get_current_user, require_roles
from app.services.license_client import (
    LicenseServerError,
    fetch_license_key,
    server_configured,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class LicenseStatusResponse(BaseModel):
    enforcement: bool
    status: str  # "valid" | "expired" | "missing" | "invalid" | "unconfigured"
    customer_name: str | None = None
    plan: str | None = None
    expires_at: str | None = None
    days_remaining: int | None = None
    activated_at: str | None = None


class ActivateLicenseRequest(BaseModel):
    license_key: str


class ActivateOnlineRequest(BaseModel):
    activation_code: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


async def _latest_activation(db: AsyncSession) -> LicenseActivation | None:
    result = await db.execute(
        select(LicenseActivation)
        .order_by(LicenseActivation.activated_at.desc())
        .limit(1)
    )
    return result.scalars().first()


def _build_status(activation: LicenseActivation | None) -> LicenseStatusResponse:
    """Compute license status — informational even when enforcement is off."""
    enforcement = enforcement_enabled()
    public_key = effective_public_key()

    if activation is None:
        # "unconfigured" = enforcement on but no public key available.
        status = "unconfigured" if (enforcement and not public_key) else "missing"
        return LicenseStatusResponse(enforcement=enforcement, status=status)

    response = LicenseStatusResponse(
        enforcement=enforcement,
        status="invalid",
        customer_name=activation.customer_name,
        plan=normalize_plan(getattr(activation, "plan", None)),
        expires_at=activation.expires_at,
        activated_at=activation.activated_at,
    )

    if not public_key:
        response.status = "unconfigured"
        return response

    try:
        payload = verify_license(activation.license_key, public_key)
    except ValueError:
        return response  # status stays "invalid"

    now = datetime.now(timezone.utc)
    expires_at = _parse_iso(payload.get("expires_at"))
    if expires_at is None:
        return response

    response.plan = normalize_plan(payload.get("plan"))
    response.expires_at = payload.get("expires_at")
    if now >= expires_at:
        response.status = "expired"
    else:
        response.status = "valid"
        # Max whole days until expiry (floor — 0 on the last day).
        response.days_remaining = int((expires_at - now).total_seconds() // 86400)
    return response


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status", response_model=LicenseStatusResponse)
async def get_license_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
):
    """Current license status. Any authenticated user."""
    activation = await _latest_activation(db)
    return _build_status(activation)


@router.post("/activate", response_model=LicenseStatusResponse)
async def activate_license(
    body: ActivateLicenseRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
):
    """Activate a license key. Restricted to tenant_admin / super_admin."""
    if current_user.role not in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="Admin access required")

    return await _verify_and_store(db, current_user, body.license_key)


@router.post("/activate-online", response_model=LicenseStatusResponse)
async def activate_license_online(
    body: ActivateOnlineRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
):
    """Exchange an activation code for a licence key, then activate it.

    This is the only outbound connection the product makes on an administrator's
    behalf, and it is optional: when LICENSE_SERVER_URL is unset the endpoint
    returns 503 and directs the operator to offline activation. The fetched key
    is verified locally against the baked-in public key by the same code path as
    a pasted key, so reaching the server is a convenience and never an authority.
    """
    if current_user.role not in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
        raise HTTPException(status_code=403, detail="Admin access required")

    if not server_configured():
        raise HTTPException(
            status_code=503,
            detail=("No licence server is configured on this deployment. "
                    "Use offline activation and paste the licence key you were issued."),
        )

    try:
        license_key = await fetch_license_key(body.activation_code)
    except LicenseServerError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return await _verify_and_store(db, current_user, license_key)


async def _verify_and_store(
    db: AsyncSession, current_user: User, license_key: str
) -> LicenseStatusResponse:
    """Verify a licence key and record the activation. Shared by both paths."""
    public_key = effective_public_key()
    if not public_key:
        raise HTTPException(status_code=503, detail="License public key not configured")

    try:
        payload = verify_license(license_key, public_key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid license key")

    now = datetime.now(timezone.utc)
    expires_at = _parse_iso(payload.get("expires_at"))
    if expires_at is None:
        raise HTTPException(status_code=400, detail="Invalid license key")
    if now >= expires_at:
        raise HTTPException(status_code=400, detail="License key expired")

    plan = normalize_plan(payload.get("plan"))

    # Single-row table: replace any previous activation.
    await db.execute(delete(LicenseActivation))

    now_iso = _iso_z(now)
    activation = LicenseActivation(
        license_key=license_key.strip(),
        lid=payload.get("lid", ""),
        customer_name=payload.get("customer", ""),
        contact_email=payload.get("email", ""),
        plan=plan,
        issued_at=payload.get("issued_at", ""),
        expires_at=payload.get("expires_at", ""),
        activated_at=now_iso,
        activated_by=current_user.email,
        last_seen_at=now_iso,
    )
    db.add(activation)

    # Grant the licensed plan to the activating user's tenant so features unlock
    # immediately. Best-effort — a subscription hiccup must never block
    # activation, which is what the enforcement gate actually depends on.
    try:
        if current_user.tenant_id:
            sub_res = await db.execute(
                select(Subscription).where(Subscription.tenant_id == current_user.tenant_id)
            )
            sub = sub_res.scalar_one_or_none()
            if sub:
                sub.tier = SubscriptionTier(plan)
                sub.status = SubscriptionStatus.ACTIVE
    except Exception:
        logger.warning("Could not apply licensed plan %s to tenant %s",
                       plan, current_user.tenant_id)

    await db.commit()

    # Make the enforcement middleware pick up the new activation instantly.
    invalidate_license_cache()

    logger.info("License activated by %s (customer=%s, plan=%s, lid=%s)",
                current_user.email, activation.customer_name, plan, activation.lid)

    return _build_status(activation)
