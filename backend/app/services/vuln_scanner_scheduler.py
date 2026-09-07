"""Scanner-connector auto-sync scheduler (Elite Pack, RFP module 3).

RFP gap: each ScannerConnector carries a weekly schedule (`schedule_enabled`,
`interval_hours`, default 168) but nothing ever reads it — sync only happens
when a user clicks "Sync now" (`POST /connectors/{cid}/sync`, which calls
`app.services.scanner_connectors.sync_connector`). This module is the missing
background loop that actually honors the schedule.

Same in-process asyncio pattern as the other two background schedulers wired
into the app lifespan (`app.services.threat_scheduler.start_threat_scheduler`,
`app.services.report_scheduler.start_report_scheduler`):

- `start_vuln_scanner_scheduler` is a long-running coroutine started with
  `asyncio.create_task(...)` in `app.main`'s lifespan and cancelled on shutdown.
- `run_due_syncs` claims each due connector with an optimistic UPDATE
  conditioned on its current `last_sync_at` — the exact "claim" idea used by
  `app.services.report_scheduler.run_due_schedules` — so that with 2 uvicorn
  workers (CLAUDE.md: prod runs 2 workers) exactly one of them wins the sync
  for a given connector/tick and the other sees rowcount 0 and skips. Without
  this, both workers' loops would fire the same due connector at the same
  tick and double-sync it.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.scanner_connector import ScannerConnector
from app.models.scan_journal import SCAN_STATUS_FAILED
from app.services.scanner_connectors import sync_connector

logger = logging.getLogger(__name__)

POLL_SECONDS = 3600  # hourly poll — interval_hours is the finer-grained cadence


async def _alert_sync_failure(db, conn, reason: str) -> None:
    """Raise an alert when an automated import fails.

    A scheduled sync that silently stops is worse than no sync: the
    vulnerability register still looks current while nothing has refreshed it,
    and nobody finds out until someone happens to read the journal. The client
    asks for an alert on an unreachable tool or an unreadable format, so the
    people who watch the register are told rather than the log file.

    Best-effort — alerting must never break the sync loop that is already
    handling a failure.
    """
    try:
        from app.models.notification import NotificationType
        from app.services.notification_generator import (
            create_notification, get_recipients_for_tenant,
        )

        detail = (reason or "unknown error").strip()[:300]
        for user in await get_recipients_for_tenant(db, conn.tenant_id):
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.SYSTEM,
                title=f"Vulnerability scan import failed: {conn.name}",
                message=(
                    f"The scheduled import from {conn.tool} connector '{conn.name}' did not "
                    f"complete: {detail}. The vulnerability register has not been refreshed "
                    f"from this tool — check the connector and re-run the sync."
                ),
                entity_id=conn.id,
                entity_type="scanner_connector",
                link="/vulnerabilities",
                severity="high",
            )
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("could not raise a sync-failure alert for connector %s", conn.id)


async def _due_connectors(db: AsyncSession) -> list[ScannerConnector]:
    """Enabled, schedule_enabled connectors whose interval_hours has elapsed
    since last_sync_at (or that have never synced)."""
    rows = (await db.execute(
        select(ScannerConnector).where(
            ScannerConnector.enabled == True,  # noqa: E712
            ScannerConnector.schedule_enabled == True,  # noqa: E712
        )
    )).scalars().all()

    now = datetime.utcnow()
    due = []
    for conn in rows:
        if conn.last_sync_at is None:
            due.append(conn)
            continue
        interval = max(1, int(conn.interval_hours or 168))
        if now - conn.last_sync_at >= timedelta(hours=interval):
            due.append(conn)
    return due


async def run_due_syncs(db: AsyncSession) -> dict:
    """Sync every scanner connector whose schedule is due, claiming each
    connector atomically so a concurrent worker's tick can't double-sync it."""
    due = await _due_connectors(db)

    synced = 0
    failed = 0
    for conn in due:
        prev_last_sync = conn.last_sync_at
        claim_stamp = datetime.utcnow()
        # Optimistic claim: only the runner whose UPDATE still matches the old
        # last_sync_at wins; everyone else gets rowcount 0 and skips this tick.
        # sync_connector() below overwrites last_sync_at again with the real
        # completion time once the pull finishes.
        claim = await db.execute(
            update(ScannerConnector)
            .where(ScannerConnector.id == conn.id, ScannerConnector.last_sync_at == prev_last_sync)
            .values(last_sync_at=claim_stamp)
        )
        await db.commit()
        if claim.rowcount != 1:
            continue

        await db.refresh(conn)
        try:
            journal = await sync_connector(db, conn, created_by_id=None)
            if journal.status == SCAN_STATUS_FAILED:
                failed += 1
                await _alert_sync_failure(db, conn, journal.error or "the scan tool reported a failure")
            else:
                synced += 1
        except Exception as exc:  # noqa: BLE001 — sync_connector shouldn't raise, but never kill the loop
            logger.error("Vuln scanner scheduler: sync failed for connector %s (%s): %s", conn.id, conn.name, exc)
            failed += 1
            await _alert_sync_failure(db, conn, str(exc))

    return {
        "due": len(due), "synced": synced, "failed": failed,
        "checked_at": datetime.utcnow().isoformat(timespec="seconds"),
    }


async def start_vuln_scanner_scheduler() -> None:
    """In-process loop: every POLL_SECONDS, sync any scanner connector whose
    schedule_enabled + interval_hours cadence is due.

    Disabled with ENABLE_VULN_SCANNER_SCHEDULER=0 (same env-flag convention as
    ENABLE_REPORT_SCHEDULER in report_scheduler.py). Safe under multiple
    workers because run_due_syncs claims each connector's tick atomically.
    """
    if os.getenv("ENABLE_VULN_SCANNER_SCHEDULER", "1") == "0":
        logger.info("Vuln scanner scheduler disabled via ENABLE_VULN_SCANNER_SCHEDULER=0")
        return
    logger.info("Vuln scanner scheduler started (poll every %ss)", POLL_SECONDS)
    await asyncio.sleep(90)  # let the app finish booting first

    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_due_syncs(db)
            if result["due"]:
                logger.info("Vuln scanner scheduler tick: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.error("Vuln scanner scheduler tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
