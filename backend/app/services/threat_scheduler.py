"""
Auto threat feed scheduler — asyncio background task.
Runs every INTERVAL_HOURS, fetches CISA KEV + SANS ISC + opensourcemalware.com
and creates pending_approval threats for every active tenant.
"""
import asyncio
import logging
import os

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.database import AsyncSessionLocal
from app.models.threat import Threat, ThreatCategory
from app.models.tenant import Tenant
from app.models.notification import NotificationType
from app.services.threat_feeds import fetch_all_threat_feeds, stable_ref
from app.services.notification_generator import get_recipients_for_tenant, create_notification, notification_exists
from app.services import threat_registry as registry

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

            # Existing ref_ids and names for this tenant (avoid duplicates)
            ex_refs = await db.execute(
                select(Threat.ref_id).where(
                    (Threat.is_builtin == True) | (Threat.tenant_id == tenant.id)  # noqa: E712
                )
            )
            ref_set = {r[0].lower() for r in ex_refs.all() if r[0]}

            ex_names = await db.execute(
                select(Threat.name).where(
                    (Threat.is_builtin == True) | (Threat.tenant_id == tenant.id)  # noqa: E712
                )
            )
            name_set = {r[0].lower() for r in ex_names.all()}

            new_items = [
                it for it in raw
                if it["name"].lower() not in name_set
                and (not it["ref_id"] or it["ref_id"].lower() not in ref_set)
            ]

            critical_threats: list[Threat] = []
            created_here = 0
            for item in new_items:
                ref = stable_ref(item)
                threat = Threat(
                    ref_id=ref,
                    name=item["name"],
                    description=item.get("description") or None,
                    category=item.get("category", ThreatCategory.CYBER_ATTACK.value),
                    typical_threat_actors=item.get("typical_threat_actors", []),
                    typical_attack_vectors=[],
                    affected_assets=[],
                    mitre_ids=[],
                    is_builtin=False,
                    is_pending=True,
                    tenant_id=tenant.id,
                )
                # Two uvicorn workers run this loop, read the same name set and
                # commit independently, which is how the register accumulated
                # 250 duplicate rows. The unique (tenant_id, name) constraint is
                # the actual fix; a savepoint per insert keeps one collision
                # from aborting the rest of the tenant's batch.
                try:
                    async with db.begin_nested():
                        db.add(threat)
                        await db.flush()
                except IntegrityError:
                    continue
                registry.record(db, threat, "created", actor=None,
                                note=f"Ingested automatically from the {item.get('source', 'threat')} "
                                     f"feed; awaiting validation.")
                created_here += 1
                if (item.get("severity") or "").lower() == "critical":
                    critical_threats.append(threat)
            total_created += created_here

            # Fan out critical-threat alerts to this tenant's CISO/admins.
            if critical_threats:
                recipients = await get_recipients_for_tenant(db, tenant.id)
                for threat in critical_threats:
                    for user in recipients:
                        if not await notification_exists(
                            db, user.id, NotificationType.THREAT_CRITICAL, threat.id, within_days=7
                        ):
                            await create_notification(
                                db,
                                user=user,
                                notif_type=NotificationType.THREAT_CRITICAL,
                                title=f"Critical threat detected: {threat.name[:60]}",
                                message=(
                                    f"A new critical-severity threat '{threat.name}' was added to the threat "
                                    f"feed and is pending approval."
                                ),
                                entity_id=threat.id,
                                entity_type="threat",
                                link=f"/threats?highlight={threat.id}",
                                severity="critical",
                            )

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
