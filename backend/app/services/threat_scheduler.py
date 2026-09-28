"""
Auto threat feed scheduler — asyncio background task.
Runs every INTERVAL_HOURS, fetches CISA KEV + SANS ISC + opensourcemalware.com
and files the results in each tenant's threat *watch* — not the threat register.
CVE advisories additionally flag the shared CVE catalogue as actively exploited.
See app/models/threat_watch.py for why the register was the wrong destination.
"""
import asyncio
import hashlib
import logging
import os
import tempfile
import time
from pathlib import Path

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant
from app.models.notification import NotificationType
from app.services.threat_feeds import fetch_all_threat_feeds, stable_ref
from app.services.threat_watch_ingest import apply_kev_flags, ingest_for_tenant, watch_key
from app.services.notification_generator import get_recipients_for_tenant, create_notification, notification_exists

logger = logging.getLogger(__name__)

INTERVAL_HOURS = 24   # change to e.g. 6 for more frequent fetches

# Cross-worker claim for the NETWORK leg of a cycle. Prod runs 2 uvicorn workers,
# both of which wake 120 s after boot and every INTERVAL_HOURS after that, so both
# hit CISA KEV, SANS ISC and opensourcemalware.com on every cycle — twice the
# outbound requests and twice the OSM API quota, before a single row exists for a
# row-level claim (the pattern audit_recurrence_scheduler uses) to condition on.
# There is no platform-level table to claim in and no reachable Redis, so the claim
# is a flock'd file in the OS temp dir, which both workers of a single deployment
# share. Every failure mode falls through to "run the cycle", i.e. exactly today's
# behaviour: a claim that cannot be taken must never silence the feed.
_CLAIM_PATH = Path(tempfile.gettempdir()) / (
    "grceye-threatfeed-%s.claim" % hashlib.sha256(
        str(getattr(settings, "DATABASE_URL", "")).encode()
    ).hexdigest()[:12]   # keyed by database: two deployments on one box don't collide
)


def _claim_cycle(min_interval_s: float) -> bool:
    """True if THIS worker may run the feed cycle now.

    Records the start of the cycle, not its outcome: a worker that claims and then
    fails loses the cycle rather than letting the other worker re-fetch the same
    feeds seconds later. At a 24 h cadence a missed cycle costs a day of watch items.
    """
    try:
        import fcntl   # POSIX only — on Windows dev there is one worker anyway
    except ImportError:
        return True
    try:
        fd = os.open(_CLAIM_PATH, os.O_RDWR | os.O_CREAT, 0o600)
    except OSError:
        return True   # unwritable temp dir: keep the old both-workers behaviour
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return False   # the other worker is inside the claim right now
        try:
            raw = os.read(fd, 64).decode("ascii", "ignore").strip()
            last = float(raw) if raw else 0.0
        except (OSError, ValueError):
            last = 0.0
        now = time.time()
        # A negative delta means the recorded claim is in the FUTURE — the host clock
        # stepped backwards (NTP correction, VM restore). Treating that as "too soon"
        # would silence the feed until wall-clock caught up, which contradicts this
        # function's own rule that every abnormal case falls through to running.
        elapsed = now - last
        if 0 <= elapsed < min_interval_s:
            return False
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            os.ftruncate(fd, 0)
            os.write(fd, str(now).encode("ascii"))
        except OSError:
            return True   # could not record the claim — run rather than skip
        return True
    finally:
        try:
            os.close(fd)   # releases the flock
        except OSError:
            pass


async def _run_once() -> int:
    """Run one feed cycle for all tenants. Returns total watch items created."""
    raw = await fetch_all_threat_feeds()
    if not raw:
        logger.warning("Threat scheduler: no items fetched from any feed")
        return 0

    # Alert on genuinely critical intelligence only. Previously every
    # critical-severity feed item also became a pending threat; now it is a
    # watch entry, and the alert points there. Resolved once, in feed order, so
    # the per-tenant cap below always keeps the same ten items.
    critical_items = [
        (watch_key(it), it) for it in raw
        if (it.get("severity") or "").lower() == "critical"
    ]

    total_created = 0

    async with AsyncSessionLocal() as db:
        # Ids and slugs, not ORM instances: the per-tenant rollback below expires
        # every loaded instance, and reading an expired attribute from an
        # AsyncSession outside a greenlet raises — so one bad tenant would take
        # out every tenant queued behind it. Same shape as
        # risk_snapshot_scheduler's select(Tenant.id).
        tenants = (await db.execute(select(Tenant.id, Tenant.slug))).all()

        for tenant_id, slug in tenants:
            # Skip platform-owner pseudo-tenant
            if (slug or "") in ("platform", "platform-owner"):
                continue

            try:
                # De-duplication is the unique (tenant, source, ref) index on the
                # watch table, not a pre-read of the register: a pre-check cannot
                # fix a race between the two uvicorn workers.
                summary = await ingest_for_tenant(db, tenant_id, raw)

                # Alert only on the items THIS run actually filed. That insert is
                # the claim: with both uvicorn workers running this loop, exactly
                # one of them wins a given (tenant, source, ref), so exactly one
                # of them alerts on it — notification_exists is a read-then-write
                # check and cannot settle that race on its own. It also stops a
                # KEV entry re-alerting every 7 days for as long as it stays in
                # the feed, which the dedup window alone allowed.
                new_critical = [
                    it for key, it in critical_items if key in summary["created_refs"]
                ]
                if new_critical:
                    recipients = await get_recipients_for_tenant(db, tenant_id)
                    for item in new_critical[:10]:   # a feed spike must not become a mailstorm
                        marker = stable_ref(item)
                        name = item.get("name", "")
                        source = item.get("source", "a feed")
                        for user in recipients:
                            if await notification_exists(
                                db, user.id, NotificationType.THREAT_CRITICAL, marker, within_days=7
                            ):
                                continue
                            await create_notification(
                                db,
                                user=user,
                                notif_type=NotificationType.THREAT_CRITICAL,
                                title=f"Critical threat intelligence: {name[:60]}",
                                message=(
                                    f"'{name}' was reported by {source} "
                                    f"and is waiting in the threat watch."
                                ),
                                entity_id=marker,
                                entity_type="threat_watch",
                                link="/threats?tab=watch",
                                severity="critical",
                                # The stored strings stay the fallback and the
                                # e-mail body; the client renders the key triple
                                # in the reader's language. Same shape as
                                # audits.py's _notify — the feed item's own name
                                # and source are data, so they stay untranslated.
                                title_key="notifications.threat_critical.title",
                                message_key="notifications.threat_critical.message",
                                params={"name": name, "source": source},
                            )

                # Commit per tenant. The whole cycle used to run in one
                # transaction committed at the end, so one tenant's failure
                # discarded every other tenant's ingestion — and it held
                # SQLite's single write lock for the entire cycle, which the
                # second worker's identical cycle then blocked on.
                await db.commit()
                # Counted only once the rows are durable — the rollback below
                # discards this tenant's inserts, so counting before the commit
                # made the cycle log claim work that no longer exists.
                total_created += summary["created"]
            except Exception as exc:   # noqa: BLE001 — one tenant must not lose the rest
                await db.rollback()
                logger.exception("Threat scheduler: tenant %s failed: %s", tenant_id, exc)

        try:
            flagged = await apply_kev_flags(db, raw)
            if flagged:
                logger.info("Threat watch: flagged %d CVE(s) as actively exploited", flagged)
            await db.commit()
        except Exception as exc:   # noqa: BLE001 — the watch entries are already durable
            await db.rollback()
            logger.exception("Threat scheduler: KEV flagging failed: %s", exc)

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
            if not _claim_cycle(INTERVAL_HOURS * 3600 * 0.9):
                logger.info("Threat scheduler: cycle already claimed by another worker, skipping")
                await asyncio.sleep(INTERVAL_HOURS * 3600)
                continue
            logger.info("Threat scheduler: running feed fetch...")
            created = await _run_once()
            # It files watch items, not pending threats — the old wording
            # survived the move to the watch table and misreads the log.
            logger.info("Threat scheduler: filed %d new threat-watch item(s)", created)
            if created:
                # Machine translation of what just arrived is the job of the
                # translation worker (singleton across uvicorn workers); wake it
                # if it runs in this process, otherwise its next cycle finds the
                # new rows. Rows already translated are reused by text hash.
                from app.services.translation_worker import nudge
                nudge()
        except asyncio.CancelledError:
            raise
        except Exception as exc:   # noqa: BLE001 — never let the loop die
            # With the traceback: a scheduler that quietly stops doing anything
            # is the failure mode nobody notices for weeks.
            logger.exception("Threat scheduler error: %s", exc)

        await asyncio.sleep(INTERVAL_HOURS * 3600)
