"""TOTP multi-factor authentication endpoints, available to every user.

Enrollment issues a TOTP secret + otpauth URI; verification confirms the
device. ``pyotp`` is imported lazily so a missing dependency degrades only
MFA rather than breaking app startup.
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.mfa_device import MfaDevice
from app.api.v1.dependencies.auth import get_current_user

router = APIRouter()

ISSUER = "GRCeye"


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


class StatusResponse(BaseModel):
    enabled: bool
    confirmed: bool


async def _device_for(user_id: str, db: AsyncSession) -> MfaDevice | None:
    result = await db.execute(select(MfaDevice).where(MfaDevice.user_id == user_id))
    return result.scalar_one_or_none()


@router.get("/status", response_model=StatusResponse)
async def mfa_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    device = await _device_for(current_user.id, db)
    return StatusResponse(enabled=device is not None, confirmed=bool(device and device.confirmed))


@router.post("/enroll", response_model=EnrollResponse)
async def mfa_enroll(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Start (or restart) enrollment: issue a fresh unconfirmed TOTP secret."""
    pyotp = _pyotp()
    secret = pyotp.random_base32()
    device = await _device_for(current_user.id, db)
    if device is None:
        device = MfaDevice(user_id=current_user.id, secret=secret, confirmed=False)
        db.add(device)
    else:
        device.secret = secret
        device.confirmed = False
    await db.commit()
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
    device.confirmed = True
    device.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    return StatusResponse(enabled=True, confirmed=True)


@router.post("/disable", status_code=status.HTTP_204_NO_CONTENT)
async def mfa_disable(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    device = await _device_for(current_user.id, db)
    if device is not None:
        await db.delete(device)
        await db.commit()
    return None
