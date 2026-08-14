"""Activity Log model — tracks all user actions for audit trail."""
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, ForeignKey, JSON, Integer, Index
from app.core.database import Base


class ActivityLog(Base):
    """Immutable audit trail of user actions, hash-chained for tamper evidence."""
    __tablename__ = "activity_logs"

    # Per-tenant monotonic sequence + hash chain make the trail tamper-evident:
    # a unique (tenant_id, seq) also serializes concurrent writers so the chain
    # never forks. Legacy rows written before this feature carry seq=NULL and are
    # reported as "unchained" by the verify endpoint (NULLs are distinct in SQLite,
    # so they don't collide with the unique index).
    __table_args__ = (
        Index("ix_activity_chain_tenant_seq", "tenant_id", "seq", unique=True),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # create, update, delete, login, export, import
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # risk, vendor, audit, policy, etc.
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    entity_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # Changed fields, old/new values
    ip_address: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Tamper-evidence chain (per tenant).
    seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entry_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
