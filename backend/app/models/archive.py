"""Archive record + retention (Elite Pack) — RFP module 17.

A point-in-time JSON snapshot of any entity with an optional retention deadline,
so records can be consulted without restoring and purged once retention lapses.
New tables — created by create_all() on restart.
"""
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, JSON, DateTime, ForeignKey, Boolean, Integer
from app.core.database import Base


class ArchiveRecord(Base):
    __tablename__ = "archive_records"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    archived_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ArchivingRule(Base):
    """Auto-archiving rule (Elite Pack) — RFP module 17 gap-fix.

    Periodically evaluated by the archiving scheduler (app.services.archiving_engine):
    every enabled rule is matched against the live rows of its `entity_type`, and any
    row satisfying `criteria` that hasn't already been archived gets snapshotted via
    the same creation path as a manual ``POST /archiving`` call. New table — created
    by create_all() on restart.
    """
    __tablename__ = "archiving_rules"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Simple DSL: one or more "field OP value" clauses joined by " AND ", e.g.
    # "status=closed AND age_days>365". See archiving_engine.parse_criteria().
    criteria: Mapped[str] = mapped_column(String(300), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Scheduler bookkeeping — next_run_at doubles as the optimistic-claim key so
    # exactly one of the (2) uvicorn workers evaluates a given tick.
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_result: Mapped[str | None] = mapped_column(String(200), nullable=True)
