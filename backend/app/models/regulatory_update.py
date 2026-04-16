"""Regulatory Update Tracking — monitor changes to regulations and standards."""
import enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey, Enum as SAEnum, JSON, Boolean
from app.core.database import Base


class UpdateImpact(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFORMATIONAL = "informational"

class UpdateStatus(str, enum.Enum):
    PENDING_APPROVAL = "pending_approval"
    NEW = "new"
    UNDER_REVIEW = "under_review"
    ACTION_REQUIRED = "action_required"
    IMPLEMENTED = "implemented"
    NOT_APPLICABLE = "not_applicable"


class RegulatoryUpdate(Base):
    """Tracks changes to regulations, standards, and frameworks."""
    __tablename__ = "regulatory_updates"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)  # e.g. "ISO", "NIST", "EU Parliament"
    regulation_name: Mapped[str | None] = mapped_column(String(255), nullable=True)  # e.g. "GDPR", "NIS2"
    impact: Mapped[UpdateImpact] = mapped_column(SAEnum(UpdateImpact), default=UpdateImpact.MEDIUM)
    status: Mapped[UpdateStatus] = mapped_column(SAEnum(UpdateStatus), default=UpdateStatus.NEW)
    effective_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    deadline: Mapped[str | None] = mapped_column(String(20), nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    affected_frameworks: Mapped[list] = mapped_column(JSON, default=list)
    affected_controls: Mapped[list] = mapped_column(JSON, default=list)
    action_items: Mapped[list] = mapped_column(JSON, default=list)
    assigned_to_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
