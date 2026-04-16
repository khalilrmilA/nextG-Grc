"""Contract Collaboration models — real-time negotiation between CISO and vendor."""
from __future__ import annotations
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ContractCollaboration(Base):
    """Working session where both parties negotiate contract terms in real-time."""
    __tablename__ = "contract_collaborations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), index=True)
    contract_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendor_contracts.id"), index=True)
    vendor_name: Mapped[str] = mapped_column(String(500), default="")

    # Collaboration state
    status: Mapped[str] = mapped_column(String(50), default="active")
    # active | agreed | closed

    # Working contract draft (editable by both parties)
    contract_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # AI-generated fix suggestions — JSON: list of {id, clause, severity, issue, fix, status}
    # severity: critical | high | medium | low
    # status: open | accepted | rejected
    ai_suggestions: Mapped[str | None] = mapped_column(Text, nullable=True)

    # AI-generated action plan — JSON: list of {id, priority, action, responsible, deadline, done}
    action_plan: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Vendor access (share link — no login required)
    share_token: Mapped[str] = mapped_column(String(36), unique=True, index=True,
                                              default=lambda: str(uuid4()))
    share_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    vendor_email: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Agreement
    # Plan finalization — set when CISO locks the plan with specific deadline dates
    plan_finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    agreed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    agreed_by_internal: Mapped[bool] = mapped_column(default=False)
    agreed_by_vendor: Mapped[bool] = mapped_column(default=False)

    # Digital signing
    agreement_document: Mapped[str | None] = mapped_column(Text, nullable=True)
    ciso_signed_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ciso_signature: Mapped[str | None] = mapped_column(String(500), nullable=True)
    vendor_signed_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vendor_signature: Mapped[str | None] = mapped_column(String(500), nullable=True)
    signed_contract_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class ContractMessage(Base):
    """Chat message in a contract collaboration session."""
    __tablename__ = "contract_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    collaboration_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("contract_collaborations.id"), index=True
    )
    sender_type: Mapped[str] = mapped_column(String(20))   # "internal" | "vendor"
    sender_name: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
