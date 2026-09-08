"""Report distribution log — STB objectif 6, « validation … avant diffusion ».

The requirement makes diffusion a controlled act that follows approval. Recording
who received which version, and when, is also what lets objectif 8 answer « qui a
reçu ce rapport ? » — a question the activity log alone cannot answer, because a
scheduled e-mail has no HTTP request behind it.

A row is written only when the audit's report_status is `approved`; the endpoint
refuses otherwise, which is what makes the control real rather than advisory.

New table — created by create_all() on restart.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ReportDistribution(Base):
    """One act of sending an approved report to someone."""

    __tablename__ = "report_distributions"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    audit_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=True, index=True
    )

    # Free-form so the same table serves the scheduled reports, which are not
    # tied to an engagement.
    report_kind: Mapped[str] = mapped_column(String(40), nullable=False, default="audit")

    # Snapshot of what was sent. The file may later be superseded; the log must
    # still say what the recipient actually received.
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    report_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    channel: Mapped[str] = mapped_column(String(20), nullable=False, default="email")
    recipients: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    distributed_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    distributed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
