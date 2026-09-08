"""Daily trend-snapshot scheduler for vulnerabilities, threats and governance.

STB tender gap: objectif 2 asks for « tendances historiques » on the
vulnerabilities dashboard, objectif 3 for « tendances » on threats, objectif 6
for a « mise à jour mensuelle » of the governance dashboard — and the product
had exactly one time series, ``risk_snapshots``. Everywhere else a chart could
only bucket ``created_at`` by month, which is *intake volume*: a register where
twenty findings were opened and twenty closed reads identically to one where
twenty were opened and nothing was fixed.

This module is the direct sibling of ``app.services.risk_snapshot_scheduler``
and deliberately copies its shape rather than inventing a second pattern:

* one row per (tenant, metric, UTC calendar day) in ``trend_snapshots``;
* an hourly poll that writes at most once per tenant/metric/day, so a tenant
  created at 14:00 catches up within the hour instead of waiting for a fixed
  midnight cron;
* **the INSERT itself is the claim**. There is no Celery worker, no beat and no
  Redis here, and PM2 runs 2 uvicorn workers, so *both* run this loop. Any
  "have I already done today?" flag kept in memory is per-worker and therefore
  worthless. The UniqueConstraint on (tenant_id, metric_key, snapshot_date) is
  what makes the second worker's commit fail with IntegrityError, which is
  caught here and read as "somebody else already wrote it".

The read side (``snapshot_series``) lives in this module too, next to the
collectors, so the JSON payload shape has exactly one owner: the three
``/trend`` endpoints must produce the same keys in their intake-derived
fallback as the scheduler writes, and splitting those across files is how the
two drift apart.
"""
import asyncio
import logging
import os
from datetime import date, datetime

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant
from app.models.threat import Threat, CATEGORY_TO_TYPE
from app.models.vulnerability import Vulnerability
from app.models.policy import Policy, PolicyAttestation
from app.models.governance import (
    RaciAssignment, GovernanceDocument, GovernanceDocumentVersion, GovernanceCommittee,
)
from app.models.trend_snapshot import (
    TrendSnapshot, TREND_METRIC_KEYS, month_end,
    METRIC_VULNERABILITIES, METRIC_THREATS, METRIC_GOVERNANCE,
)

logger = logging.getLogger(__name__)

POLL_SECONDS = 3600  # hourly poll; writes at most once per tenant/metric per UTC day

# A vulnerability that no longer needs work. Everything else — including
# pending_validation and validated, which are queue states, not resolutions —
# counts as still open. Spelled out here rather than "status == open" because
# VulnStatus has eight members and three of them mean "open in practice".
CLOSED_VULN_STATUSES = frozenset({"mitigated", "accepted", "closed", "false_positive"})


def _label(value) -> str:
    """Group key as a plain string — enum .value, never 'VulnSeverity.HIGH'."""
    if value is None:
        return "unspecified"
    return str(getattr(value, "value", value))


# ── Collectors: one per metric, each returning (total, counts payload) ────────
#
# Every collector is pure aggregation over already-existing tables and is used
# by BOTH the scheduler (to write today's row) and, indirectly, by the /trend
# endpoints (whose fallback must emit the same keys).

async def collect_vulnerabilities(db: AsyncSession, tenant_id: str) -> tuple[int, dict]:
    """Vulnerability posture: how many are on the books, and how bad they are.

    ``total`` is every vulnerability the tenant holds; ``open`` is the ones
    still requiring work, which is the number that actually shows whether the
    remediation effort is winning.
    """
    by_severity: dict[str, int] = {}
    for severity, n in (await db.execute(
        select(Vulnerability.severity, func.count())
        .where(Vulnerability.tenant_id == tenant_id)
        .group_by(Vulnerability.severity)
    )).all():
        by_severity[_label(severity)] = int(n)

    by_status: dict[str, int] = {}
    for status, n in (await db.execute(
        select(Vulnerability.status, func.count())
        .where(Vulnerability.tenant_id == tenant_id)
        .group_by(Vulnerability.status)
    )).all():
        by_status[_label(status)] = int(n)

    total = sum(by_status.values())
    open_count = sum(n for st, n in by_status.items() if st not in CLOSED_VULN_STATUSES)
    return total, {"by_severity": by_severity, "by_status": by_status, "open": open_count}


async def collect_threats(db: AsyncSession, tenant_id: str) -> tuple[int, dict]:
    """Threat-register posture for one tenant.

    Built-in threats are deliberately excluded. They are one shared, read-only
    catalogue (729 rows on this installation, identical for every tenant), so
    including them would add the same large constant to every point of every
    tenant's series and bury the movement the trend exists to show.

    ``by_type`` resolves the same way ``threat_registry.effective_type`` does —
    the stated type when there is one, otherwise the family the category
    implies — so the series matches what the register screen displays. It is
    computed from a GROUP BY (category, threat_type) rather than by loading
    every row, which matters at 500+ threats per tenant.
    """
    by_category: dict[str, int] = {}
    by_type: dict[str, int] = {}
    register_total = 0
    for category, threat_type, n in (await db.execute(
        select(Threat.category, Threat.threat_type, func.count())
        .where(
            Threat.tenant_id == tenant_id,
            Threat.is_builtin == False,  # noqa: E712
            Threat.is_pending == False,  # noqa: E712
        )
        .group_by(Threat.category, Threat.threat_type)
    )).all():
        n = int(n)
        register_total += n
        cat = _label(category)
        by_category[cat] = by_category.get(cat, 0) + n
        effective = threat_type or CATEGORY_TO_TYPE.get(cat)
        key = _label(effective)
        by_type[key] = by_type.get(key, 0) + n

    by_profile_status: dict[str, int] = {}
    for status, n in (await db.execute(
        select(Threat.profile_status, func.count())
        .where(
            Threat.tenant_id == tenant_id,
            Threat.is_builtin == False,  # noqa: E712
            Threat.is_pending == False,  # noqa: E712
        )
        .group_by(Threat.profile_status)
    )).all():
        by_profile_status[_label(status)] = int(n)

    pending = int((await db.execute(
        select(func.count()).select_from(Threat).where(
            Threat.tenant_id == tenant_id, Threat.is_pending == True,  # noqa: E712
        )
    )).scalar() or 0)

    # next_review_due is an ISO date *string* (project convention), so a plain
    # string comparison is the correct chronological one. The is_pending filter
    # has to be here too: every other figure in this payload (register_total,
    # by_category, by_type, by_profile_status) excludes threats still queued for
    # approval, so without it a tenant sitting on overdue *pending* submissions
    # could report review_overdue > total — a breakdown larger than the thing it
    # breaks down, which reads as a broken number rather than a finding. It also
    # matches GET /threats?review_overdue=true, whose query excludes pending, so
    # the chart and the screen count the same rows.
    today_iso = date.today().isoformat()
    review_overdue = int((await db.execute(
        select(func.count()).select_from(Threat).where(
            Threat.tenant_id == tenant_id,
            Threat.is_builtin == False,  # noqa: E712
            Threat.is_pending == False,  # noqa: E712
            Threat.next_review_due.isnot(None),
            Threat.next_review_due < today_iso,
        )
    )).scalar() or 0)

    # The shared read-only catalogue, recorded so the two numbers can be
    # reconciled rather than silently disagreeing: GET /threats lists built-ins
    # *and* the tenant's own, so the Threat Library screen shows
    # register_total + builtin_catalogue rows while the trend plots only the
    # tenant's own. Excluded from `total` on purpose (see the docstring); kept
    # in the payload so a reader can see exactly where the difference comes from.
    builtin_catalogue = int((await db.execute(
        select(func.count()).select_from(Threat).where(
            Threat.is_builtin == True,  # noqa: E712
            Threat.is_pending == False,  # noqa: E712
        )
    )).scalar() or 0)

    return register_total, {
        "by_category": by_category,
        "by_type": by_type,
        "by_profile_status": by_profile_status,
        "pending": pending,
        "review_overdue": review_overdue,
        "builtin_catalogue": builtin_catalogue,
    }


async def collect_governance(db: AsyncSession, tenant_id: str) -> tuple[int, dict]:
    """Governance posture: the artefacts and the bodies that own them.

    ``total`` is the count of governance artefacts under management (policies +
    repository documents) — the headline the objectif 6 dashboard leads with.
    The breakdown mirrors GET /dashboards/governance (policies by status,
    attestations by status, committees) plus the repository counts, so the
    monthly series and the live dashboard are reading the same things.
    """
    policies_by_status: dict[str, int] = {}
    for status, n in (await db.execute(
        select(Policy.status, func.count())
        .where(Policy.tenant_id == tenant_id)
        .group_by(Policy.status)
    )).all():
        policies_by_status[_label(status)] = int(n)
    policies_total = sum(policies_by_status.values())

    # PolicyAttestation carries no tenant_id — scope it through its policy.
    attestations_by_status: dict[str, int] = {}
    for status, n in (await db.execute(
        select(PolicyAttestation.status, func.count())
        .join(Policy, PolicyAttestation.policy_id == Policy.id)
        .where(Policy.tenant_id == tenant_id)
        .group_by(PolicyAttestation.status)
    )).all():
        attestations_by_status[_label(status)] = int(n)

    documents_total = int((await db.execute(
        select(func.count()).select_from(GovernanceDocument)
        .where(GovernanceDocument.tenant_id == tenant_id)
    )).scalar() or 0)
    # Versions carry no tenant_id either — same join-through-the-owner rule.
    document_versions_total = int((await db.execute(
        select(func.count()).select_from(GovernanceDocumentVersion)
        .join(GovernanceDocument, GovernanceDocumentVersion.document_id == GovernanceDocument.id)
        .where(GovernanceDocument.tenant_id == tenant_id)
    )).scalar() or 0)
    raci_total = int((await db.execute(
        select(func.count()).select_from(RaciAssignment)
        .where(RaciAssignment.tenant_id == tenant_id)
    )).scalar() or 0)
    committees_total = int((await db.execute(
        select(func.count()).select_from(GovernanceCommittee)
        .where(GovernanceCommittee.tenant_id == tenant_id)
    )).scalar() or 0)

    return policies_total + documents_total, {
        "policies_total": policies_total,
        "policies_by_status": policies_by_status,
        "attestations_by_status": attestations_by_status,
        "documents_total": documents_total,
        "document_versions_total": document_versions_total,
        "raci_total": raci_total,
        "committees_total": committees_total,
    }


COLLECTORS = {
    METRIC_VULNERABILITIES: collect_vulnerabilities,
    METRIC_THREATS: collect_threats,
    METRIC_GOVERNANCE: collect_governance,
}


# ── Read side ────────────────────────────────────────────────────────────────

async def snapshot_series(
    db: AsyncSession, tenant_id: str, metric_key: str, buckets: list[tuple[int, int]]
) -> list[dict] | None:
    """Monthly points from the stored history, or ``None`` if there is none yet.

    Each bucket takes the last snapshot written on or before that month's end,
    whether or not that snapshot falls inside the requested window — a
    point-in-time reading, not a sum of the month's activity, and not one that
    forgets what it measured the month before the chart starts. A month before
    the FIRST snapshot ever written carries no value at all (``total: None``)
    rather than a zero: "we were not measuring yet" and "we had none" are
    different claims, and a bank reading a chart cannot tell them apart from a
    plotted 0. Every point that carries a value also carries the ``as_of`` date
    it was read from, so a carried-forward reading is visibly stale.

    Returns None — meaning "fall back to the intake-derived proxy" — when the
    tenant has no rows for this metric at all, and ALSO when the table itself is
    missing. ``trend_snapshots`` is created by ``create_all()`` at the next
    process restart, so between this deploy and that restart every query
    against it raises OperationalError; unhandled that is a 500, and this SPA
    hard-redirects to /service-down on any 5xx, i.e. it would eject the user
    out of the application instead of showing a chart. Same guard as
    endpoints/frameworks.py and endpoints/compliance.py.
    """
    if not buckets:
        return None
    earliest = f"{buckets[0][0]:04d}-{buckets[0][1]:02d}-01"
    try:
        rows = list((await db.execute(
            select(TrendSnapshot.snapshot_date, TrendSnapshot.total, TrendSnapshot.counts)
            .where(
                TrendSnapshot.tenant_id == tenant_id,
                TrendSnapshot.metric_key == metric_key,
                TrendSnapshot.snapshot_date >= earliest,
            )
            .order_by(TrendSnapshot.snapshot_date.asc())
        )).all())
        # The newest reading from BEFORE the window, if there is one. Without
        # this the series was not the point-in-time reading it claims to be: it
        # was "the last snapshot on or before each month's end **that also falls
        # inside the requested window**". A tenant measured up to March and then
        # not again (backend down, scheduler switched off, a long weekend on a
        # box that is not always up) asking for the last 6 months got April..
        # August as `total: null` — "we were not measuring yet" — when in fact
        # the platform HAD a measurement for those dates and knew what it was.
        # A gap that says "unknown" where the answer is known is the same class
        # of lie as inventing a number. The carried-forward point always ships
        # its `as_of`, so a stale reading is visibly stale rather than passed
        # off as current.
        seed = (await db.execute(
            select(TrendSnapshot.snapshot_date, TrendSnapshot.total, TrendSnapshot.counts)
            .where(
                TrendSnapshot.tenant_id == tenant_id,
                TrendSnapshot.metric_key == metric_key,
                TrendSnapshot.snapshot_date < earliest,
            )
            .order_by(TrendSnapshot.snapshot_date.desc())
            .limit(1)
        )).first()
    except (OperationalError, ProgrammingError):
        # Table not created yet (pending restart) — degrade, never 5xx.
        await db.rollback()
        logger.warning("trend_snapshots not available yet; falling back to intake volume")
        return None
    if not rows and seed is None:
        return None

    series: list[dict] = []
    last: tuple | None = tuple(seed) if seed is not None else None
    idx = 0
    for (yy, mm) in buckets:
        cutoff = month_end(yy, mm)
        while idx < len(rows) and rows[idx][0] <= cutoff:
            last = rows[idx]
            idx += 1
        series.append({
            "month": datetime(yy, mm, 1).strftime("%b"),
            "period": f"{yy:04d}-{mm:02d}",
            "as_of": last[0] if last else None,
            "total": int(last[1] or 0) if last else None,
            "counts": (last[2] if isinstance(last[2], dict) else {}) if last else {},
        })
    return series


def unavailable_series(buckets: list[tuple[int, int]]) -> list[dict]:
    """A series of "we could not read this" points — every total ``None``.

    For the case where even the intake-derived fallback cannot be read (a source
    table missing on a database that has not been restarted since the model was
    added, a driver-level failure). The alternative that was in place — swallow
    the error and emit ``0`` for every month — publishes "nothing was created in
    any of the last six months" as a fact when the truth is "the question could
    not be answered". That is a fabricated figure in exactly the sense the
    tender review calls out, and a bank that later finds out the platform was
    guessing stops trusting every other number on the page.

    ``None`` totals are already the contract for "no reading for this month"
    (see ``snapshot_series``), so a chart that renders gaps needs no new
    handling; the envelope's ``source`` says which of the two situations it is.
    """
    return [
        {
            "month": datetime(yy, mm, 1).strftime("%b"),
            "period": f"{yy:04d}-{mm:02d}",
            "as_of": None,
            "total": None,
            "counts": {},
        }
        for (yy, mm) in buckets
    ]


# ── Write side ───────────────────────────────────────────────────────────────

async def _snapshot_metric(
    db: AsyncSession, tenant_id: str, metric_key: str, today: str
) -> bool:
    """Write today's row for one tenant/metric unless it already exists."""
    existing = (await db.execute(
        select(TrendSnapshot.id).where(
            TrendSnapshot.tenant_id == tenant_id,
            TrendSnapshot.metric_key == metric_key,
            TrendSnapshot.snapshot_date == today,
        )
    )).scalar_one_or_none()
    if existing:
        return False

    total, counts = await COLLECTORS[metric_key](db, tenant_id)
    db.add(TrendSnapshot(
        tenant_id=tenant_id, metric_key=metric_key, snapshot_date=today,
        total=total, counts=counts,
    ))
    try:
        await db.commit()
        return True
    except IntegrityError:
        # The other uvicorn worker beat us to this (tenant, metric, day). The
        # UniqueConstraint is the real claim; back off quietly.
        await db.rollback()
        return False


async def run_daily_snapshot(db: AsyncSession) -> dict:
    """Ensure every tenant has today's row for every metric."""
    today = datetime.utcnow().date().isoformat()
    tenant_ids = list((await db.execute(select(Tenant.id))).scalars().all())

    written = 0
    unavailable: str | None = None
    for tenant_id in tenant_ids:
        if unavailable:
            break
        for metric_key in TREND_METRIC_KEYS:
            try:
                if await _snapshot_metric(db, tenant_id, metric_key, today):
                    written += 1
            except (OperationalError, ProgrammingError) as exc:
                # trend_snapshots (or a source table) not created yet — the loop
                # keeps polling hourly and starts recording once the process has
                # restarted. A missing table is missing for EVERY tenant, so the
                # tick stops here instead of re-failing 3 x <tenants> times and
                # writing that many identical warnings into the production log
                # every hour (the docstring promised once per tick; the code did
                # not). A transient lock lands here too under SQLite, and losing
                # one hourly tick to it costs nothing — the next tick rewrites
                # the same day's row.
                await db.rollback()
                unavailable = f"{metric_key}: {exc.__class__.__name__}"
                break
            except Exception as exc:  # noqa: BLE001 — one tenant must not kill the loop
                await db.rollback()
                # With the traceback: a series that silently stops being written
                # leaves a hole nothing later can reconstruct.
                logger.exception(
                    "Trend snapshot: failed for tenant %s metric %s: %s", tenant_id, metric_key, exc
                )

    if unavailable:
        logger.warning(
            "Trend snapshot: source or snapshot table unavailable while collecting "
            "metric %s — pending restart? "
            "Tick abandoned after %s row(s); retrying in %ss.",
            unavailable, written, POLL_SECONDS,
        )
    return {
        "tenants": len(tenant_ids), "written": written, "snapshot_date": today,
        "unavailable": unavailable,
    }


async def start_trend_snapshot_scheduler() -> None:
    """In-process loop: hourly, ensure today's trend rows exist for every tenant.

    Disabled with ENABLE_TREND_SNAPSHOT_SCHEDULER=0 (same env-flag convention as
    the other in-process schedulers). Safe under 2 workers — see the module
    docstring for the UniqueConstraint-as-claim rationale.
    """
    if os.getenv("ENABLE_TREND_SNAPSHOT_SCHEDULER", "1") == "0":
        logger.info("Trend snapshot scheduler disabled via ENABLE_TREND_SNAPSHOT_SCHEDULER=0")
        return
    logger.info("Trend snapshot scheduler started (poll every %ss)", POLL_SECONDS)
    # 60s, staggered behind the risk snapshot scheduler's 45s, so the two are
    # not writing on the same tick during a cold start.
    await asyncio.sleep(60)

    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_daily_snapshot(db)
            if result["written"]:
                logger.info("Trend snapshot scheduler tick: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.exception("Trend snapshot scheduler tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
