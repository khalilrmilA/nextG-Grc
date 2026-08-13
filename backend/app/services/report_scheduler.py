"""Scheduled-report engine (Elite Pack).

Generates one of the built-in PDF reports on a recurring cadence and emails it to a
list of recipients. Designed to actually fire in the production topology, which runs
uvicorn under pm2 with NO Redis/Celery-beat:

- `run_due_schedules` claims each due schedule with an optimistic UPDATE conditioned
  on its current `next_run_at`, so even with 2 uvicorn workers (or a Celery beat also
  running) exactly one runner delivers a given occurrence — no double-send.
- `start_report_scheduler` is an in-process asyncio loop launched from the app lifespan;
  `generate_scheduled_reports` (Celery task) calls the same claim path when beat exists.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.report_schedule import ReportSchedule, ReportFrequency
from app.models.tenant import Tenant
from app.services.report_generator import generate_report, REPORT_GENERATORS
from app.services.email_service import send_report_email

logger = logging.getLogger(__name__)

REPORT_TYPES = set(REPORT_GENERATORS.keys())  # executive, risk, compliance, vendor, audit
POLL_SECONDS = 300  # in-process loop cadence


def compute_next_run(schedule: ReportSchedule, now: datetime) -> datetime:
    """Next UTC datetime this schedule should fire, strictly after `now` (naive UTC)."""
    hour = int(schedule.hour or 0) % 24
    if schedule.frequency == ReportFrequency.DAILY:
        candidate = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate
    if schedule.frequency == ReportFrequency.WEEKLY:
        target_dow = int(schedule.day_of_week or 0) % 7
        candidate = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        days_ahead = (target_dow - candidate.weekday()) % 7
        candidate += timedelta(days=days_ahead)
        if candidate <= now:
            candidate += timedelta(days=7)
        return candidate
    # MONTHLY — clamp day to 28 so every month is valid.
    dom = min(max(int(schedule.day_of_month or 1), 1), 28)
    candidate = now.replace(day=dom, hour=hour, minute=0, second=0, microsecond=0)
    if candidate <= now:
        month = 1 if candidate.month == 12 else candidate.month + 1
        year = candidate.year + (1 if candidate.month == 12 else 0)
        candidate = candidate.replace(year=year, month=month)
    return candidate


async def _deliver(db: AsyncSession, schedule: ReportSchedule) -> tuple[bool, str]:
    """Generate the report and email it to every recipient. Returns (ok, status)."""
    if schedule.report_type not in REPORT_TYPES:
        return False, f"unknown report_type {schedule.report_type}"
    recipients = [r for r in (schedule.recipients or []) if r]
    if not recipients:
        return False, "no recipients"

    tenant = (await db.execute(select(Tenant).where(Tenant.id == schedule.tenant_id))).scalar_one_or_none()
    tenant_name = getattr(tenant, "name", None) or "Organization"

    try:
        pdf_bytes = await generate_report(schedule.report_type, db, schedule.tenant_id, tenant_name)
    except Exception as exc:  # noqa: BLE001 — report failure, don't crash the loop
        logger.error("Scheduled report generation failed (%s): %s", schedule.id, exc)
        return False, f"generation error: {exc}"[:250]

    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    filename = f"{schedule.report_type}-report-{stamp}.pdf"
    subject = f"[{tenant_name}] {schedule.report_type.title()} report — {stamp}"
    sent = 0
    for email in recipients:
        if await send_report_email(to_email=email, subject=subject, pdf_bytes=pdf_bytes,
                                   filename=filename, body_text=f"Your scheduled {schedule.report_type} report is attached."):
            sent += 1
    return (sent > 0), f"sent {sent}/{len(recipients)} at {datetime.utcnow().isoformat(timespec='seconds')}"


async def run_schedule_now(db: AsyncSession, schedule: ReportSchedule) -> tuple[bool, str]:
    """Deliver a schedule immediately (manual 'run now') without touching its cadence."""
    ok, status = await _deliver(db, schedule)
    schedule.last_run_at = datetime.utcnow()
    schedule.last_status = status
    await db.commit()
    return ok, status


async def run_due_schedules(db: AsyncSession) -> dict:
    """Deliver every schedule whose next_run_at has passed, claiming each atomically."""
    now = datetime.utcnow()
    rows = (await db.execute(
        select(ReportSchedule).where(
            ReportSchedule.enabled == True,  # noqa: E712
            ReportSchedule.next_run_at.isnot(None),
            ReportSchedule.next_run_at <= now,
        )
    )).scalars().all()

    delivered = 0
    for sched in rows:
        prev_next = sched.next_run_at
        new_next = compute_next_run(sched, now)
        # Optimistic claim: only the runner whose UPDATE still matches the old
        # next_run_at wins; everyone else gets rowcount 0 and skips.
        claim = await db.execute(
            update(ReportSchedule)
            .where(ReportSchedule.id == sched.id, ReportSchedule.next_run_at == prev_next)
            .values(next_run_at=new_next)
        )
        await db.commit()
        if claim.rowcount != 1:
            continue
        await db.refresh(sched)
        ok, status = await _deliver(db, sched)
        sched.last_run_at = now
        sched.last_status = status
        await db.commit()
        if ok:
            delivered += 1

    return {"due": len(rows), "delivered": delivered, "checked_at": now.isoformat(timespec="seconds")}


async def start_report_scheduler() -> None:
    """In-process loop: every POLL_SECONDS, deliver any due schedules.

    Disabled with ENABLE_REPORT_SCHEDULER=0. Safe under multiple workers because
    run_due_schedules claims each occurrence atomically.
    """
    if os.getenv("ENABLE_REPORT_SCHEDULER", "1") == "0":
        logger.info("Report scheduler disabled via ENABLE_REPORT_SCHEDULER=0")
        return
    logger.info("Report scheduler started (poll every %ss)", POLL_SECONDS)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_due_schedules(db)
            if result["delivered"]:
                logger.info("Scheduled reports delivered: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.error("Report scheduler tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
