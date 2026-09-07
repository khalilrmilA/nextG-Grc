"""Cryptographic seals over purged ranges of the audit trail.

The retention rule ("les traces sont conservées selon la durée prévue par les
règles de l'entreprise") and the tamper-evidence rule are in direct conflict if
retention is implemented as a plain delete: the activity log is a hash chain, so
removing entries breaks it, and ``GET /activity-log/verify`` would then report
tampering on a purge the platform performed itself. An organisation that
exercised its own retention policy would be unable to prove its audit trail was
intact — which is the opposite of what both rules are for.

A seal resolves that. Before a range is purged it is summarised: how many
entries, which sequence numbers, the period they covered, the hash of the last
one, and a digest over every entry hash in the range. Verification then walks
*across* the seal instead of stopping at the gap — the surviving entry after a
sealed range must still carry the sealed range's last hash as its ``prev_hash``,
so the chain remains provable end to end with the removed entries accounted for
rather than merely missing.

The digest is what makes a restore checkable: replay the entries from backup,
recompute the digest, and it either matches the seal or the restored set is not
what was purged.

Seals are themselves chained to one another, so a seal cannot be quietly
removed to hide that a purge happened.
"""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuditLogSeal(Base):
    __tablename__ = "audit_log_seals"

    __table_args__ = (
        Index("ix_seal_tenant_range", "tenant_id", "from_seq"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    # The chain range this seal stands in for.
    from_seq: Mapped[int] = mapped_column(Integer, nullable=False)
    to_seq: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_count: Mapped[int] = mapped_column(Integer, nullable=False)

    # The period those entries covered, so a reader can tell what was removed
    # without decoding sequence numbers.
    period_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # The chain links the seal has to preserve. `last_entry_hash` is what the
    # first surviving entry's prev_hash must equal for the chain to hold.
    first_prev_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    last_entry_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # SHA-256 over the purged entries' hashes, in sequence order. Lets a restore
    # from backup be checked against what was actually sealed.
    entries_digest: Mapped[str] = mapped_column(String(64), nullable=False)

    # Why the organisation exercised its retention policy, and on whose authority.
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sealed_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sealed_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Seals are chained to each other, so removing one to hide a purge shows up.
    prev_seal_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    seal_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
