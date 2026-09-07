"""Change history for the applied-controls register.

"Les modifications (ajouts, mises à jour, suppressions) sont historisées pour
assurer la traçabilité", and separately "toute modification du statut d'un
contrôle fait l'objet d'une traçabilité complète". Neither had anything behind
it: the generic activity log records that a request happened, not which field
moved from what to what (TODO-KNOWN-ISSUES §3.1).

Same shape as :class:`app.models.threat_history.ThreatHistory`, deliberately —
two registers with two different history formats would be two things for an
auditor to learn.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

CONTROL_ACTIONS = (
    "created",
    "updated",
    "status_changed",     # operational status: planned -> active -> retired ...
    "validated",          # signed off by a security referent
    "rejected",
    "evaluated",          # an effectiveness evaluation was recorded
    "deleted",
)


class AppliedControlHistory(Base):
    __tablename__ = "applied_control_history"

    __table_args__ = (
        Index("ix_ac_history_control", "tenant_id", "applied_control_id", "created_at"),
    )

    # Not a ForeignKey: the row has to outlive the control being deleted, which
    # is exactly the case "suppressions sont historisées" is asking about.
    applied_control_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    # Denormalised so a deleted control is still identifiable in its own history.
    control_ref_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    control_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    action: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # {"field": {"from": ..., "to": ...}} — only fields that actually changed.
    changes: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Microsecond precision: SQLite's CURRENT_TIMESTAMP resolves to the second,
    # and an edit immediately followed by a validation would tie, making
    # "newest first" ambiguous.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
