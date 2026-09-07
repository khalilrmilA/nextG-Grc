"""Change history for the threat register.

Both threat requirements ask for the same thing in almost the same words — "un
historique des modifications est conservé pour chaque menace (ajout, mise à
jour, suppression)" and "toutes les modifications sont historisées afin de
garantir une traçabilité complète" — and neither had anything behind it. The
generic activity log records that a request happened, not which field moved
from what to what (see TODO-KNOWN-ISSUES.md §3.1), so a threat's own history
has to carry the values.

One row per change, immutable, holding a before/after map of only the fields
that actually moved. A deletion is recorded here *before* the row goes, which
is the whole point: after the threat is gone, this is the only remaining
evidence that it ever existed and who removed it.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# What happened. Kept as plain strings rather than an enum so a new action can
# be recorded without a migration on a history table that must never lose rows.
THREAT_ACTIONS = (
    "created",           # added to the register (pending validation)
    "approved",          # validated into the register
    "rejected",          # refused at intake, never integrated
    "updated",           # descriptive fields edited
    "profile_updated",   # threat profile edited
    "profile_validated", # profile signed off by a security lead
    "reviewed",          # periodic review carried out, no change needed
    "adopted",           # a built-in catalogue entry copied into the register
    "deleted",           # removed from the register
)


class ThreatHistory(Base):
    __tablename__ = "threat_history"

    __table_args__ = (
        Index("ix_threat_history_threat", "tenant_id", "threat_id", "created_at"),
    )

    # Not a ForeignKey: the row has to survive the threat being deleted, which
    # is precisely the case the requirement cares about.
    threat_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    # Denormalised so a deleted threat is still identifiable in its own history.
    threat_ref_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    threat_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    action: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # {"field": {"from": ..., "to": ...}} — only fields that actually changed.
    changes: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Python-side default at microsecond precision: SQLite's CURRENT_TIMESTAMP
    # resolves to the second, and an edit immediately followed by a validation
    # would tie and make "newest first" ambiguous — the same reason
    # VulnerabilityImpactHistory overrides it.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
