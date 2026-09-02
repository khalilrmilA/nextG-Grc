"""
License phone-home scheduler — asyncio background task.

Periodically asks the vendor's licence server (grceye.com) whether this
appliance's activated key is still active, and expires it locally if the
server explicitly says "revoked". This is the appliance side of super
admin's Licenses tab "Revoke" button.

Fail-open by design: only an explicit "revoked" answer changes anything.
"active", "not_found", a network error, a timeout, or a malformed response
are all logged and otherwise ignored — a connectivity blip must never lock a
client out. See services/license_client.py's module docstring for the same
principle stated from the transport side.

True no-op unless BOTH this build enforces licensing AND a licence server is
configured (see start_license_phone_home) — an air-gapped deployment (the
default; see firstboot.sh, which also sets ENABLE_LICENSE_PHONE_HOME=0) never
reaches this code, matching the other schedulers' ENABLE_* convention.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.licensing import enforcement_enabled, invalidate_license_cache
from app.models.license import LicenseActivation
from app.services.license_client import LicenseServerError, verify_license_status

logger = logging.getLogger(__name__)


async def _run_once() -> None:
    """Check the current activation once. Mutates the DB only on revocation."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(LicenseActivation).order_by(LicenseActivation.activated_at.desc()).limit(1)
        )
        activation = result.scalars().first()
        if activation is None:
            return  # nothing activated yet — nothing to check

        try:
            status = await verify_license_status(activation.license_key)
        except LicenseServerError as exc:
            logger.warning("License phone-home: could not check in (%s) — leaving license as-is", exc)
            return

        if status != "revoked":
            logger.info("License phone-home: check-in ok (status=%s)", status)
            return

        logger.warning("License phone-home: license %s was revoked by the license server — expiring locally",
                        activation.lid)
        activation.expires_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        await db.commit()
        invalidate_license_cache()


async def start_license_phone_home() -> None:
    """
    Long-running background coroutine.
    Wait 2 min after startup, then check in every INTERVAL_HOURS hours.
    Cancel this task on shutdown (handled in lifespan).

    Disable with ENABLE_LICENSE_PHONE_HOME=0, matching the other schedulers.
    Also a no-op whenever this isn't a licensed build or no LICENSE_SERVER_URL
    is configured — the two conditions under which there is anything to check.
    """
    if os.getenv("ENABLE_LICENSE_PHONE_HOME", "1") == "0":
        logger.info("License phone-home disabled via ENABLE_LICENSE_PHONE_HOME=0")
        return
    if not (enforcement_enabled() and settings.LICENSE_SERVER_URL):
        return

    interval_hours = settings.LICENSE_PHONE_HOME_INTERVAL_HOURS
    logger.info(
        "License phone-home started — first check in 2 min, then every %dh", interval_hours
    )
    await asyncio.sleep(120)

    while True:
        try:
            await _run_once()
        except Exception as exc:
            logger.error("License phone-home error: %s", exc)

        await asyncio.sleep(interval_hours * 3600)
