"""Archive record + retention (Elite Pack) — RFP module 17.

A point-in-time JSON snapshot of any entity with an optional retention deadline,
so records can be consulted without restoring and purged once retention lapses.
New table — created by create_all() on restart.
"""
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, JSON, DateTime, ForeignKey
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
