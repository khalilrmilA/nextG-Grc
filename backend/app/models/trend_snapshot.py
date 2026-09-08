"""Daily point-in-time snapshots for the modules that had no history at all.

STB tender gap: objectif 2 asks for « tendances historiques » on the
vulnerabilities dashboard, objectif 3 for « tendances » on threats, and
objectif 6 for a « mise à jour mensuelle » of the governance dashboard. The
product had exactly ONE time series — ``risk_snapshots`` (see
app/models/risk_snapshot.py) — so every other module could only ever show a
"today" number, or bucket ``created_at`` by month, which measures *intake
volume* and not the balance actually carried at a point in time. A register
where twenty findings were opened and twenty closed in the same month looks
identical to one where twenty were opened and none closed.

This is the same design as ``RiskSnapshot``, generalised: one table instead of
three near-identical ones. A row is (tenant, metric, UTC day) -> a headline
``total`` plus a JSON ``counts`` payload whose shape is owned by
app/services/trend_snapshot_scheduler.py (the writer) and read back by the
three ``/trend`` endpoints (vulnerabilities.py, threats.py, governance.py).

Why one table with a JSON payload rather than typed columns per module: the
three metrics group by different things (severity/status, category/profile
state, policy status/document counts) and those groupings will keep changing
as the tender's dashboards evolve. Typed columns would mean a hand-written
``ALTER`` migration script for every new breakdown — alembic is dead in this
repo — whereas a JSON payload absorbs it. The headline ``total`` stays a real
column so the common "is the number going up or down" series can be plotted
without decoding anything.

The UNIQUE (tenant_id, metric_key, snapshot_date) is load-bearing: it is what
makes a re-run a no-op and, more importantly, it is the *claim* that keeps the
two uvicorn workers from both writing today's row (an in-memory "already did
it" flag cannot work across processes — see the scheduler's docstring).

New table: created by ``create_all()`` at the next restart, so no hand-written
migration is needed — but ALSO not present until that restart happens, which
is why every reader wraps its query in the OperationalError/ProgrammingError
guard this codebase already uses in frameworks.py and compliance.py.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, JSON, ForeignKey, UniqueConstraint
from app.core.database import Base


# The metrics this table carries, one per tender objective that asked for a
# history. Kept as plain strings (not a DB enum) for the same portability
# reason as the rest of the schema — SQLite/PostgreSQL/Oracle/SQL Server.
METRIC_VULNERABILITIES = "vulnerabilities"
METRIC_THREATS = "threats"
METRIC_GOVERNANCE = "governance"

TREND_METRIC_KEYS: tuple[str, ...] = (
    METRIC_VULNERABILITIES,
    METRIC_THREATS,
    METRIC_GOVERNANCE,
)


class TrendSnapshot(Base):
    """One tenant's counts for one metric, as of one UTC calendar day."""
    __tablename__ = "trend_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "metric_key", "snapshot_date",
            name="uq_trend_snapshot_tenant_metric_date",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    # One of TREND_METRIC_KEYS. Indexed because every read filters on
    # (tenant_id, metric_key) and then orders by snapshot_date.
    metric_key: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # ISO 'YYYY-MM-DD', UTC — the calendar day this snapshot represents. Stored
    # as text, like every other date string in this schema, so it sorts and
    # compares lexicographically exactly as it does chronologically.
    snapshot_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)

    # The headline figure for the metric (what the sparkline plots). What it
    # counts is metric-specific and documented next to each collector in
    # app/services/trend_snapshot_scheduler.py.
    total: Mapped[int] = mapped_column(Integer, default=0)
    # The breakdown: {"by_severity": {...}, "by_status": {...}, ...}. Never
    # None in a row this application writes, but readers still coerce — a row
    # written by a script that bypassed the ORM default would otherwise take a
    # whole response down with it (the same NULL-JSON guard ThreatOut and
    # VulnOut carry).
    counts: Mapped[dict] = mapped_column(JSON, default=dict)


def month_buckets(months: int, *, now=None) -> list[tuple[int, int]]:
    """The last ``months`` (year, month) pairs, oldest first, ending on today.

    Shared by the three ``/trend`` endpoints so their x-axis is built one way
    only; identical to the bucket loop dashboard.py's /risk-trend already uses.
    """
    from datetime import datetime

    now = now or datetime.utcnow()
    buckets: list[tuple[int, int]] = []
    y, m = now.year, now.month
    for _ in range(max(1, months)):
        buckets.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    buckets.reverse()
    return buckets


def month_end(year: int, month: int) -> str:
    """ISO date of the last day of a month — the cut-off a monthly point uses."""
    import calendar

    return f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"
