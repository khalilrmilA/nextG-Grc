"""Scan import journal (Elite Pack, RFP module 3).

One row per scanner-import run (Nessus / Qualys / OpenVAS). Records the tool,
timing, outcome, how many vulnerability rows were created, and any error so a
security referent has an auditable ingestion trail. This is a NEW table, so it
is auto-created by ``Base.metadata.create_all`` on startup — no migration.
"""
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey, Integer, DateTime
from app.core.database import Base

# Journal run states (kept as plain strings on the column for portability).
SCAN_STATUS_RUNNING = "running"
SCAN_STATUS_COMPLETED = "completed"
SCAN_STATUS_FAILED = "failed"


class ScanJournal(Base):
    """Audit record of a single scanner-import run."""
    __tablename__ = "scan_journals"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    tool: Mapped[str] = mapped_column(String(50), nullable=False)  # nessus, qualys, openvas, csv
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=SCAN_STATUS_RUNNING)
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    matched_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)   # findings matched to an asset
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)   # deduped / skipped
    parsed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)    # total findings parsed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
