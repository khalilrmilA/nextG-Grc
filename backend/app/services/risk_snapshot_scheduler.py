"""Daily risk-count snapshot scheduler (Elite Pack, RFP gap fix).

RFP gap: "il s'agit d'un volume d'entrée réel plutôt qu'un historique complet
du solde de risques (aucune table d'historisation)." dashboard.py's
get_risk_trend previously only had Risk.created_at to bucket by month — an
intake-volume proxy, not a point-in-time open-risk-count history. This
scheduler appends one RiskSnapshot row per tenant per UTC day with the
then-current open-risk counts by severity, so a real "was the open risk count
going up or down" series accumulates over time. get_risk_trend prefers this
table once it has any rows for a tenant, falling back to the intake-volume
proxy until then (fresh deploy / no snapshots yet) — see dashboard.py.

Same in-process asyncio pattern as the other background schedulers wired into
the app lifespan. Race-safety differs slightly from the "claim a due row"
schedulers (report_scheduler, vuln_scanner_scheduler, audit_recurrence_scheduler)
since this one *creates* new rows rather than updating existing ones: it
relies on RiskSnapshot's (tenant_id, snapshot_date) UniqueConstraint — the
INSERT itself is the atomic claim. If a concurrent worker already wrote
today's snapshot for a tenant, this worker's commit raises IntegrityError,
which is caught and treated as "someone else already did it" — so with 2
uvicorn workers at most one snapshot per tenant per day is ever written.
"""
import asyncio
import logging
import os
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant
from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.risk_snapshot import RiskSnapshot

logger = logging.getLogger(__name__)

POLL_SECONDS = 3600  # hourly poll; only ever actually writes once per tenant per UTC day


async def _snapshot_tenant(db: AsyncSession, tenant_id: str, today: str) -> bool:
    """Write today's open-risk-by-severity snapshot for one tenant, unless it
    already exists. Returns True if a new row was written."""
    existing = (await db.execute(
        select(RiskSnapshot.id).where(
            RiskSnapshot.tenant_id == tenant_id, RiskSnapshot.snapshot_date == today
        )
    )).scalar_one_or_none()
    if existing:
        return False

    counts_result = await db.execute(
        select(Risk.severity, func.count(Risk.id))
        .where(Risk.tenant_id == tenant_id, Risk.status != RiskStatus.CLOSED)
        .group_by(Risk.severity)
    )
    by_severity: dict[str, int] = {}
    for severity, n in counts_result.all():
        sev = severity.value if hasattr(severity, "value") else str(severity)
        by_severity[sev] = int(n)

    snap = RiskSnapshot(
        tenant_id=tenant_id, snapshot_date=today,
        total_open=sum(by_severity.values()),
        critical=by_severity.get(RiskSeverity.CRITICAL.value, 0),
        high=by_severity.get(RiskSeverity.HIGH.value, 0),
        medium=by_severity.get(RiskSeverity.MEDIUM.value, 0),
        low=by_severity.get(RiskSeverity.LOW.value, 0),
    )
    db.add(snap)
    try:
        await db.commit()
        return True
    except IntegrityError:
        # A concurrent worker beat us to today's row for this tenant — the
        # UniqueConstraint is the real claim here; back off quietly.
        await db.rollback()
        return False


async def run_daily_snapshot(db: AsyncSession) -> dict:
    """Write today's risk snapshot for every tenant that doesn't have one yet."""
    today = datetime.utcnow().date().isoformat()
    tenant_ids = list((await db.execute(select(Tenant.id))).scalars().all())

    written = 0
    for tenant_id in tenant_ids:
        try:
            if await _snapshot_tenant(db, tenant_id, today):
                written += 1
        except Exception as exc:  # noqa: BLE001 — never let one tenant's failure kill the loop
            await db.rollback()
            # With the traceback, like the loop handler below: a snapshot that
            # silently stops being written leaves a hole in the open-risk series
            # that nothing later can reconstruct.
            logger.exception("Risk snapshot: failed for tenant %s: %s", tenant_id, exc)

    return {"tenants": len(tenant_ids), "written": written, "snapshot_date": today}


async def start_risk_snapshot_scheduler() -> None:
    """In-process loop: every POLL_SECONDS, ensure every tenant has today's
    risk snapshot row. Actually writes at most once per tenant per UTC day —
    the hourly poll just means a newly created tenant (or a missed period)
    catches up within the hour instead of waiting for a fixed midnight cron.

    Disabled with ENABLE_RISK_SNAPSHOT_SCHEDULER=0 (same env-flag convention
    as the other in-process schedulers). Safe under multiple workers — see
    module docstring for the UniqueConstraint-as-claim rationale.
    """
    if os.getenv("ENABLE_RISK_SNAPSHOT_SCHEDULER", "1") == "0":
        logger.info("Risk snapshot scheduler disabled via ENABLE_RISK_SNAPSHOT_SCHEDULER=0")
        return
    logger.info("Risk snapshot scheduler started (poll every %ss)", POLL_SECONDS)
    await asyncio.sleep(45)  # let the app finish booting first

    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_daily_snapshot(db)
            if result["written"]:
                logger.info("Risk snapshot scheduler tick: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.exception("Risk snapshot scheduler tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
