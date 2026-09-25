"""TOTP multi-factor authentication endpoints, available to every user.

Enrollment issues a TOTP secret + otpauth URI; verification confirms the
device. ``pyotp`` is imported lazily so a missing dependency degrades only
MFA rather than breaking app startup.
"""
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.user import User
from app.models.mfa_device import MfaDevice
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add
from app.api.v1.dependencies.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

ISSUER = "GRCeye"


async def _log_mfa_event(db: AsyncSession, user: User, action: str) -> None:
    """Record a change to a user's second factor in the hash-chained audit trail.

    Enabling or (especially) disabling MFA is a security-relevant act with no
    other durable trace: mfa_disable deletes the row outright, and the generic
    ActivityLogMiddleware only sees {POST, /api/v1/mfa/disable} and derives the
    meaningless action "create" from it. The verbs follow the ones already in
    the log for entitlement events ("delegation_granted", "custom_role_created").

    Best-effort and written AFTER the caller commits — chain_and_add commits, so
    logging first would publish a change that is still pending.
    """
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            user_email=user.email,
            action=action,
            entity_type="user",
            entity_id=user.id,
            entity_name=f"{user.first_name} {user.last_name}".strip(),
            details={"subject_user_id": user.id, "source": "self_service"},
            origin="api",
        ))
    except Exception:  # noqa: BLE001 — the MFA change is already committed
        logger.warning("%s audit entry not recorded for user %s", action, user.id)


def _pyotp():
    try:
        import pyotp  # noqa: WPS433 (lazy import by design)
        return pyotp
    except ModuleNotFoundError:  # pragma: no cover - dep not installed
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="MFA support is not installed on this server (pyotp missing).",
        )


class EnrollResponse(BaseModel):
    secret: str
    otpauth_uri: str


class VerifyRequest(BaseModel):
    code: str


class CodeRequest(BaseModel):
    # Required only when the account already has a CONFIRMED device.
    code: str | None = None


class StatusResponse(BaseModel):
    enabled: bool
    confirmed: bool


async def _device_for(user_id: str, db: AsyncSession) -> MfaDevice | None:
    result = await db.execute(select(MfaDevice).where(MfaDevice.user_id == user_id))
    return result.scalar_one_or_none()


def _require_current_code(device: MfaDevice | None, body: CodeRequest | None) -> None:
    """Removing or replacing a CONFIRMED second factor needs a code from it.

    Without this, anyone holding a live session (a stolen token, an unlocked
    browser) could switch the second factor off with one POST — the very thing
    MFA exists to stop. An unconfirmed enrollment protects nothing yet, so
    cancelling it needs no code.
    """
    if device is None or not device.confirmed:
        return
    code = ((body.code if body else None) or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Enter a current code from your authenticator app to continue.")
    if not _pyotp().totp.TOTP(device.secret).verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")


@router.get("/status", response_model=StatusResponse)
async def mfa_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    device = await _device_for(current_user.id, db)
    return StatusResponse(enabled=device is not None, confirmed=bool(device and device.confirmed))


@router.post("/enroll", response_model=EnrollResponse)
@limiter.limit("10/minute")
async def mfa_enroll(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    body: CodeRequest | None = None,
):
    """Start (or restart) enrollment: issue a fresh unconfirmed TOTP secret."""
    pyotp = _pyotp()
    secret = pyotp.random_base32()
    device = await _device_for(current_user.id, db)
    _require_current_code(device, body)
    # Re-enrolling over a confirmed device clears `confirmed`, and login() only
    # challenges on a confirmed device — so this call, on its own, turns the
    # account's second factor OFF until the new secret is verified. That is a
    # security event and needs the same trace as an explicit disable.
    was_confirmed = bool(device is not None and device.confirmed)
    if device is None:
        device = MfaDevice(user_id=current_user.id, secret=secret, confirmed=False)
        db.add(device)
    else:
        device.secret = secret
        device.confirmed = False
    await db.commit()
    if was_confirmed:
        await _log_mfa_event(db, current_user, "mfa_reset")
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=current_user.email, issuer_name=ISSUER)
    return EnrollResponse(secret=secret, otpauth_uri=uri)


@router.post("/verify", response_model=StatusResponse)
async def mfa_verify(
    body: VerifyRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Confirm enrollment by validating a code from the authenticator app."""
    pyotp = _pyotp()
    device = await _device_for(current_user.id, db)
    if device is None:
        raise HTTPException(status_code=404, detail="No MFA enrollment in progress. Enroll first.")
    if not pyotp.totp.TOTP(device.secret).verify(body.code.strip(), valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")
    newly_enabled = not device.confirmed
    device.confirmed = True
    device.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    if newly_enabled:
        await _log_mfa_event(db, current_user, "mfa_enabled")
    return StatusResponse(enabled=True, confirmed=True)


@router.post("/disable", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/minute")
async def mfa_disable(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    body: CodeRequest | None = None,
):
    device = await _device_for(current_user.id, db)
    _require_current_code(device, body)
    if device is not None:
        was_confirmed = bool(device.confirmed)
        await db.delete(device)
        await db.commit()
        # The device row is gone; this entry is the only surviving record that
        # the account ever had a second factor and that it was turned off.
        await _log_mfa_event(db, current_user, "mfa_disabled" if was_confirmed else "mfa_enrollment_cancelled")
    return None
