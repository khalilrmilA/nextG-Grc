"""Vendor-side license check-in (grceye.com's side of appliance phone-home).

Distinct from license.py (/license/*, singular): that file is the CLIENT
INSTALL's own status/activation endpoints, gated by a logged-in tenant admin.
This file is the VENDOR's endpoint that OTHER deployments' appliances call
into over the network, so there is no user session to authenticate against —
the license key itself, exact-matched against what was issued, is the
credential.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.licensing import parse_lid
from app.models.license import IssuedLicense

logger = logging.getLogger(__name__)

router = APIRouter()


class VerifyLicenseRequest(BaseModel):
    # Bounded because this route is unauthenticated and there is no request-size
    # middleware in front of it: parse_lid() base64-decodes whatever arrives, so
    # an unbounded string is free memory for anyone on the internet. Issued keys
    # are ~370 chars; /etc/machine-id is 32 hex.
    license_key: str = Field(..., max_length=4096)
    machine_id: str = Field(default="", max_length=128)


class VerifyLicenseResponse(BaseModel):
    status: str  # "active" | "revoked" | "not_found"


@router.post("/verify", response_model=VerifyLicenseResponse)
async def verify_license_checkin(
    body: VerifyLicenseRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Look up an issued license by the key an appliance is holding.

    No auth dependency — this is called by unattended appliances, not logged
    in users. The submitted key must exact-match what this server issued for
    that lid, which is as strong a credential check as a signature (this
    server is the signer; nobody else can produce a key it did issue).
    """
    lid = parse_lid(body.license_key)
    if lid is None:
        return VerifyLicenseResponse(status="not_found")

    result = await db.execute(select(IssuedLicense).where(IssuedLicense.lid == lid))
    issued = result.scalar_one_or_none()
    if issued is None or issued.license_key != body.license_key.strip():
        return VerifyLicenseResponse(status="not_found")

    logger.info("license check-in: lid=%s status=%s machine_id=%s",
                lid, issued.status, body.machine_id or "-")
    return VerifyLicenseResponse(status=issued.status)
