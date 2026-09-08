"""Auditor↔auditee exchange and finding history — STB objectifs 5 and 7.

Objectif 5 requires « Possibilité de commenter et échanger avec les audités » — a
two-party conversation, which a single free-text notes field is not. Objectif 7
requires following a recommendation « jusqu'à leur clôture effective », which needs
the transitions to be recorded, not just the current status.

  AuditComment              a threaded remark, on an audit, a finding or a
                            checklist line; `is_internal` keeps the audit team's
                            own notes out of the auditee's view
  AuditFindingStatusEvent   an append-only ledger of every status change

New tables — created by create_all() on restart.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuditComment(Base):
    """One message in an auditor↔auditee thread."""

    __tablename__ = "audit_comments"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    # Exactly one of these three anchors the comment. Kept as separate nullable
    # columns rather than a polymorphic (type, id) pair so the database can index
    # each thread directly and a stray id cannot point at the wrong table.
    audit_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=True, index=True
    )
    finding_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audit_findings.id"), nullable=True, index=True
    )
    control_assessment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("control_assessments.id"), nullable=True, index=True
    )

    # Threading: a reply carries its parent, so the UI renders a conversation
    # rather than a flat log.
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audit_comments.id"), nullable=True
    )

    author_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # True = visible only to the audit team. The auditee sees a thread only when
    # this is False, which is what makes the exchange safe to open up.
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AuditFindingStatusEvent(Base):
    """Append-only record of a finding moving from one status to another."""

    __tablename__ = "audit_finding_status_events"

    finding_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audit_findings.id"), nullable=False, index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    to_status: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # True when the transition was computed from the progress of linked action
    # items rather than chosen by a person — « mise à jour automatique du statut
    # selon les actions entreprises » has to be distinguishable from a manual call.
    is_automatic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    actor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Base.created_at uses SQLite's CURRENT_TIMESTAMP, which has 1-second
    # resolution; two transitions in the same second would tie and make the
    # timeline ambiguous. Same fix as VulnerabilityImpactHistory.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
