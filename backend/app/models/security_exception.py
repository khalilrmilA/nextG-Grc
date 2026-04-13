"""Security Exceptions & Risk Acceptances — formal waivers and approvals.
Inspired by CISO Assistant: temporary waivers for non-compliance with audit trail.
"""
import enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey, JSON, Boolean
from app.core.database import Base


class ExceptionStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    REVOKED = "revoked"

class ExceptionSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class SecurityException(Base):
    """A formal waiver for a non-compliance or unmitigated risk."""
    __tablename__ = "security_exceptions"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    # Core
    ref_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    justification: Mapped[str] = mapped_column(Text, nullable=False)  # Why is this exception needed
    severity: Mapped[str] = mapped_column(String(20), default=ExceptionSeverity.MEDIUM.value)
    status: Mapped[str] = mapped_column(String(30), default=ExceptionStatus.DRAFT.value)

    # What it covers
    exception_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "risk", "control", "vulnerability", "requirement", "asset"
    related_entity_ids: Mapped[list] = mapped_column(JSON, default=list)  # IDs of covered entities
    related_entity_names: Mapped[list] = mapped_column(JSON, default=list)  # Names for display

    # Compensating controls (what ARE we doing instead)
    compensating_controls: Mapped[str | None] = mapped_column(Text, nullable=True)
    compensating_control_ids: Mapped[list] = mapped_column(JSON, default=list)

    # Approval
    requested_by_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    approver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timeline
    effective_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    expiration_date: Mapped[str] = mapped_column(String(20), nullable=False)  # MUST expire
    review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Conditions
    conditions: Mapped[str | None] = mapped_column(Text, nullable=True)  # Conditions attached to approval
    tags: Mapped[list] = mapped_column(JSON, default=list)


class RiskAcceptance(Base):
    """Formal risk acceptance with approver sign-off."""
    __tablename__ = "risk_acceptances"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    # Core
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending, approved, rejected, expired

    # What risks are being accepted
    risk_scenario_ids: Mapped[list] = mapped_column(JSON, default=list)
    risk_ids: Mapped[list] = mapped_column(JSON, default=list)  # legacy Risk IDs

    # Approval
    requested_by_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    approver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Timeline
    expiration_date: Mapped[str] = mapped_column(String(20), nullable=False)
    review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Conditions
    residual_risk_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
