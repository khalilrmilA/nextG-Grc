"""
Auto threat feed scheduler — asyncio background task.
Runs every INTERVAL_HOURS, fetches CISA KEV + SANS ISC + opensourcemalware.com
and files the results in each tenant's threat *watch* — not the threat register.
CVE advisories additionally flag the shared CVE catalogue as actively exploited.
See app/models/threat_watch.py for why the register was the wrong destination.
"""
import asyncio
import logging
import os

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant
from app.models.notification import NotificationType
from app.services.threat_feeds import fetch_all_threat_feeds, stable_ref
from app.services.threat_watch_ingest import apply_kev_flags, ingest_for_tenant
from app.services.notification_generator import get_recipients_for_tenant, create_notification, notification_exists

logger = logging.getLogger(__name__)

INTERVAL_HOURS = 24   # change to e.g. 6 for more frequent fetches


async def _run_once() -> int:
    """Run one feed cycle for all tenants. Returns total threats created."""
    raw = await fetch_all_threat_feeds()
    if not raw:
        logger.warning("Threat scheduler: no items fetched from any feed")
        return 0

    total_created = 0

    async with AsyncSessionLocal() as db:
        tenants_result = await db.execute(select(Tenant))
        tenants = tenants_result.scalars().all()

        for tenant in tenants:
            # Skip platform-owner pseudo-tenant
            if getattr(tenant, "slug", "") in ("platform", "platform-owner"):
                continue

            # De-duplication is the unique (tenant, source, ref) index on the
            # watch table, not a pre-read of the register: a pre-check cannot
            # fix a race between the two uvicorn workers.
            summary = await ingest_for_tenant(db, tenant.id, raw)
            total_created += summary["created"]

            # Alert on genuinely critical intelligence only. Previously every
            # critical-severity feed item also became a pending threat; now it
            # is a watch entry, and the alert points there.
            critical = [
                it for it in raw
                if (it.get("severity") or "").lower() == "critical"
            ]
            if critical:
                recipients = await get_recipients_for_tenant(db, tenant.id)
                for item in critical[:10]:   # a feed spike must not become a mailstorm
                    marker = stable_ref(item)
                    for user in recipients:
                        if await notification_exists(
                            db, user.id, NotificationType.THREAT_CRITICAL, marker, within_days=7
                        ):
                            continue
                        await create_notification(
                            db,
                            user=user,
                            notif_type=NotificationType.THREAT_CRITICAL,
                            title=f"Critical threat intelligence: {item.get('name', '')[:60]}",
                            message=(
                                f"'{item.get('name', '')}' was reported by {item.get('source', 'a feed')} "
                                f"and is waiting in the threat watch."
                            ),
                            entity_id=marker,
                            entity_type="threat_watch",
                            link="/threats?tab=watch",
                            severity="critical",
                        )

        flagged = await apply_kev_flags(db, raw)
        if flagged:
            logger.info("Threat watch: flagged %d CVE(s) as actively exploited", flagged)

        await db.commit()

    return total_created


async def start_threat_scheduler() -> None:
    """
    Long-running background coroutine.
    Wait 2 min after startup, then fetch every INTERVAL_HOURS hours.
    Cancel this task on shutdown (handled in lifespan).

    Disable with ENABLE_THREAT_SCHEDULER=0, matching the other five schedulers.
    This feed reaches the public internet, so an air-gapped deployment (and the
    virtual appliance, which ships with every feed off) needs a way to stop it
    retrying forever against a network that is not there.
    """
    if os.getenv("ENABLE_THREAT_SCHEDULER", "1") == "0":
        logger.info("Threat scheduler disabled via ENABLE_THREAT_SCHEDULER=0")
        return

    logger.info(
        "Threat scheduler started — first run in 2 min, then every %dh", INTERVAL_HOURS
    )
    await asyncio.sleep(120)   # let the app finish booting first

    while True:
        try:
            logger.info("Threat scheduler: running feed fetch...")
            created = await _run_once()
            logger.info("Threat scheduler: created %d pending threats", created)
        except Exception as exc:
            logger.error("Threat scheduler error: %s", exc)

        await asyncio.sleep(INTERVAL_HOURS * 3600)
