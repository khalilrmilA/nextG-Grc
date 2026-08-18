"""Daily point-in-time risk-count snapshots (Elite Pack, RFP gap fix).

RFP gap: "il s'agit d'un volume d'entrée réel plutôt qu'un historique complet
du solde de risques (aucune table d'historisation)." Before this table,
GET /dashboard/risk-trend (dashboard.py) could only bucket Risk.created_at by
month — a real signal, but an *intake-volume* proxy, not a true point-in-time
"how many open risks did we have, by severity, on this date" series.

One row per tenant per UTC day, written by
app.services.risk_snapshot_scheduler. New table — created by create_all() on
restart, no manual ALTER migration needed (CLAUDE.md: only new *columns* on
existing tables need a hand-written migration script).
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint
from app.core.database import Base


class RiskSnapshot(Base):
    """One tenant's open-risk counts by severity, as of one UTC calendar day."""
    __tablename__ = "risk_snapshots"
    __table_args__ = (
        UniqueConstraint("tenant_id", "snapshot_date", name="uq_risk_snapshot_tenant_date"),
    )

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    # ISO 'YYYY-MM-DD', UTC — the calendar day this snapshot represents.
    snapshot_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)

    total_open: Mapped[int] = mapped_column(Integer, default=0)
    critical: Mapped[int] = mapped_column(Integer, default=0)
    high: Mapped[int] = mapped_column(Integer, default=0)
    medium: Mapped[int] = mapped_column(Integer, default=0)
    low: Mapped[int] = mapped_column(Integer, default=0)
