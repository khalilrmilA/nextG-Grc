"""Recurring audit campaign scheduler (Elite Pack, RFP gap fix).

RFP gap: "Pas de récurrence automatique des campagnes (planification par dates
libres, sans génération périodique)." Audit.recurrence ("annual" |
"semi_annual") marks a campaign as recurring, but nothing previously acted on
it — when the current cycle reached AuditStatus.CLOSED, the next cycle's
Audit row had to be created by hand with new planned_start/planned_end dates.

Same in-process asyncio + optimistic-claim pattern as the other background
schedulers wired into the app lifespan (`app.services.report_scheduler`,
`app.services.vuln_scanner_scheduler`):

- `start_audit_recurrence_scheduler` is a long-running coroutine started with
  `asyncio.create_task(...)` in `app.main`'s lifespan and cancelled on shutdown.
- `run_due_recurrences` claims each closed+recurring audit whose next cycle
  hasn't been spawned yet with an optimistic UPDATE conditioned on
  `recurrence_spawned_at IS NULL` — the exact "claim" idea used by
  `report_scheduler.run_due_schedules` (conditioned on `next_run_at`) and
  `vuln_scanner_scheduler.run_due_syncs` (conditioned on `last_sync_at`) — so
  that with 2 uvicorn workers (CLAUDE.md: prod runs 2 workers) exactly one of
  them wins the spawn for a given audit and the other sees rowcount 0 and skips.
"""
import asyncio
import calendar
import logging
import os
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.audit import Audit, AuditStatus
from app.services.activity_chain import log_system_activity

logger = logging.getLogger(__name__)

POLL_SECONDS = 3600  # hourly poll is plenty for a cadence measured in months

# recurrence value -> months to offset the next cycle's dates by. Values not
# present here (None, "none", or anything unrecognized) are treated as a
# one-off (ponctuelle) audit and never auto-spawn a successor.
RECURRENCE_MONTHS = {
    "annual": 12,
    "semi_annual": 6,
}


def _add_months(date_str: str | None, months: int) -> str | None:
    """Shift an ISO 'YYYY-MM-DD' date string forward by `months`, clamping the
    day for shorter target months (e.g. 2026-01-31 + 1 month -> 2026-02-28)."""
    if not date_str:
        return None
    try:
        y, m, d = (int(p) for p in date_str.split("-")[:3])
    except (ValueError, AttributeError):
        return None
    total = (m - 1) + months
    new_year = y + total // 12
    new_month = total % 12 + 1
    last_day = calendar.monthrange(new_year, new_month)[1]
    new_day = min(d, last_day)
    return f"{new_year:04d}-{new_month:02d}-{new_day:02d}"


async def _due_audits(db: AsyncSession) -> list[Audit]:
    """Closed, recurring audits whose next cycle hasn't been spawned yet."""
    rows = (await db.execute(
        select(Audit).where(
            Audit.status == AuditStatus.CLOSED,
            Audit.recurrence.in_(list(RECURRENCE_MONTHS.keys())),
            Audit.recurrence_spawned_at.is_(None),
        )
    )).scalars().all()
    return list(rows)


async def _spawn_next_cycle(db: AsyncSession, audit: Audit) -> Audit | None:
    """Create the next cycle's Audit row, offset by the recurrence interval,
    carrying forward scope/type/framework/owner from the closed campaign."""
    months = RECURRENCE_MONTHS.get(audit.recurrence)
    if not months:
        return None

    today = datetime.utcnow().date().isoformat()
    base_start = audit.planned_start or audit.actual_start or today
    base_end = audit.planned_end or audit.actual_end or base_start
    next_start = _add_months(base_start, months) or base_start
    next_end = _add_months(base_end, months) or next_start

    successor = Audit(
        tenant_id=audit.tenant_id,
        title=audit.title,
        description=audit.description,
        audit_type=audit.audit_type,
        status=AuditStatus.PLANNING,
        lead_auditor_id=audit.lead_auditor_id,
        framework_id=audit.framework_id,
        planned_start=next_start,
        planned_end=next_end,
        scope=audit.scope,
        in_scope_systems=list(audit.in_scope_systems or []),
        recurrence=audit.recurrence,  # keep the chain going for future cycles
    )
    db.add(successor)
    await db.flush()
    return successor


async def run_due_recurrences(db: AsyncSession) -> dict:
    """Spawn the next cycle for every closed, recurring audit that hasn't had
    one spawned yet, claiming each atomically so a concurrent worker's tick
    can't double-spawn it."""
    due = await _due_audits(db)

    spawned = 0
    for audit in due:
        claim_stamp = datetime.utcnow().isoformat()
        # Optimistic claim: only the runner whose UPDATE still matches
        # recurrence_spawned_at IS NULL wins; everyone else gets rowcount 0
        # and skips — the same idea as report_scheduler's next_run_at claim.
        claim = await db.execute(
            update(Audit)
            .where(Audit.id == audit.id, Audit.recurrence_spawned_at.is_(None))
            .values(recurrence_spawned_at=claim_stamp)
        )
        await db.commit()
        if claim.rowcount != 1:
            continue

        await db.refresh(audit)
        try:
            successor = await _spawn_next_cycle(db, audit)
            await db.commit()
            if successor:
                spawned += 1
                # Logged only once the successor is durable, and from its own
                # session. Writing it inside the transaction above would block
                # on SQLite's single-writer lock (the caller still holds it
                # after flush), and a failure there could take the audit with
                # it — a scheduler creating a record is exactly the "batch"
                # origin STB asks to see, but not at the price of the record.
                await log_system_activity(
                    tenant_id=successor.tenant_id,
                    action="create",
                    entity_type="audit",
                    entity_id=successor.id,
                    entity_name=successor.title,
                    details={
                        "reason": "recurrence",
                        "spawned_from_audit_id": audit.id,
                        "recurrence": str(audit.recurrence),
                    },
                )
                logger.info(
                    "Audit recurrence: spawned next cycle %s (%s -> %s) from closed audit %s (%s)",
                    successor.id, successor.planned_start, successor.planned_end, audit.id, audit.recurrence,
                )
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            await db.rollback()
            logger.error("Audit recurrence: failed to spawn next cycle for audit %s: %s", audit.id, exc)

    return {"due": len(due), "spawned": spawned, "checked_at": datetime.utcnow().isoformat(timespec="seconds")}


async def start_audit_recurrence_scheduler() -> None:
    """In-process loop: every POLL_SECONDS, spawn the next cycle for any closed
    recurring audit campaign that hasn't had one spawned yet.

    Disabled with ENABLE_AUDIT_RECURRENCE_SCHEDULER=0 (same env-flag convention
    as ENABLE_REPORT_SCHEDULER / ENABLE_VULN_SCANNER_SCHEDULER). Safe under
    multiple workers because run_due_recurrences claims each spawn atomically.
    """
    if os.getenv("ENABLE_AUDIT_RECURRENCE_SCHEDULER", "1") == "0":
        logger.info("Audit recurrence scheduler disabled via ENABLE_AUDIT_RECURRENCE_SCHEDULER=0")
        return
    logger.info("Audit recurrence scheduler started (poll every %ss)", POLL_SECONDS)
    await asyncio.sleep(60)  # let the app finish booting first

    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_due_recurrences(db)
            if result["spawned"]:
                logger.info("Audit recurrence scheduler tick: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.error("Audit recurrence scheduler tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
