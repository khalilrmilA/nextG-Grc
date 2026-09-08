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


async def _alert_sync_failure(
    db, *, tenant_id: str, connector_id: str, name: str, tool: str, reason: str
) -> None:
    """Raise an alert when an automated import fails.

    A scheduled sync that silently stops is worse than no sync: the
    vulnerability register still looks current while nothing has refreshed it,
    and nobody finds out until someone happens to read the journal. The client
    asks for an alert on an unreachable tool or an unreadable format, so the
    people who watch the register are told rather than the log file.

    Best-effort — alerting must never break the sync loop that is already
    handling a failure.

    Takes the connector's fields rather than the ORM object: the caller may have
    rolled the session back before getting here, which expires every loaded
    instance, and re-reading an expired attribute from an AsyncSession outside a
    greenlet raises instead of alerting.
    """
    try:
        from app.models.notification import NotificationType
        from app.services.notification_generator import (
            create_notification, get_recipients_for_tenant,
        )

        detail = (reason or "unknown error").strip()[:300]
        for user in await get_recipients_for_tenant(db, tenant_id):
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.SYSTEM,
                title=f"Vulnerability scan import failed: {name}",
                message=(
                    f"The scheduled import from {tool} connector '{name}' did not "
                    f"complete: {detail}. The vulnerability register has not been refreshed "
                    f"from this tool — check the connector and re-run the sync."
                ),
                entity_id=connector_id,
                entity_type="scanner_connector",
                link="/vulnerabilities",
                severity="high",
                # The stored strings stay the fallback and the e-mail body; the
                # client renders the key triple in the reader's language (same
                # shape as audits.py's _notify). The connector name, the tool and
                # the tool's own error text are data, so they stay as they are.
                title_key="notifications.scan_import_failed.title",
                message_key="notifications.scan_import_failed.message",
                params={"name": name, "tool": tool, "detail": detail},
            )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        # With the reason: an alert that cannot be raised is the second silent
        # failure in a row, and "could not raise" alone says nothing about why.
        logger.warning(
            "could not raise a sync-failure alert for connector %s: %s", connector_id, exc
        )


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
    # The queue is plain values, not ORM instances: a failure below rolls the
    # session back, which expires every loaded instance, and reading an expired
    # attribute from an AsyncSession outside a greenlet raises — so one broken
    # connector would take out every connector queued behind it.
    queue = [(conn.id, conn.last_sync_at) for conn in due]

    synced = 0
    failed = 0
    for conn_id, prev_last_sync in queue:
        claim_stamp = datetime.utcnow()
        # Optimistic claim: only the runner whose UPDATE still matches the old
        # last_sync_at wins; everyone else gets rowcount 0 and skips this tick.
        # sync_connector() below overwrites last_sync_at again with the real
        # completion time once the pull finishes.
        claim = await db.execute(
            update(ScannerConnector)
            .where(ScannerConnector.id == conn_id, ScannerConnector.last_sync_at == prev_last_sync)
            .values(last_sync_at=claim_stamp)
        )
        await db.commit()
        if claim.rowcount != 1:
            continue

        conn = await db.get(ScannerConnector, conn_id)
        if conn is None:   # deleted between the listing and the claim
            continue
        await db.refresh(conn)
        # Identity read out before the sync: the failure path below rolls the
        # session back, which expires the instance, and the alert still has to
        # be able to say which connector broke.
        ident = {
            "tenant_id": conn.tenant_id, "connector_id": conn.id,
            "name": conn.name, "tool": conn.tool,
        }
        try:
            journal = await sync_connector(db, conn, created_by_id=None)
            if journal.status == SCAN_STATUS_FAILED:
                failed += 1
                await _alert_sync_failure(
                    db, reason=journal.error or "the scan tool reported a failure", **ident
                )
            else:
                synced += 1
        except Exception as exc:  # noqa: BLE001 — sync_connector shouldn't raise, but never kill the loop
            logger.exception(
                "Vuln scanner scheduler: sync failed for connector %s (%s): %s",
                ident["connector_id"], ident["name"], exc,
            )
            failed += 1
            # Rollback first. sync_connector only journals the failures it
            # catches itself; anything escaping it (an ingest error, a locked
            # database) leaves this session mid-transaction, and every later
            # statement on it raises — which silently swallowed the alert AND
            # aborted the claim UPDATE for every remaining due connector, tick
            # after tick.
            await db.rollback()
            await _alert_sync_failure(db, reason=str(exc), **ident)

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
            logger.exception("Vuln scanner scheduler tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
