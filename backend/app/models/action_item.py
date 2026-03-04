"""Action item model — remediation tasks created from gap recommendations."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum
from app.core.database import Base


class ActionItemStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ActionItemPriority(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ActionItem(Base):
    """
    A remediation task created when a compliance gap recommendation is accepted.
    Tracks owner, due date, and status through to resolution.
    """
    __tablename__ = "action_items"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    assessment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_assessments.id"), nullable=True, index=True
    )
    gap_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_gaps.id"), nullable=True
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    priority: Mapped[ActionItemPriority] = mapped_column(
        SAEnum(ActionItemPriority), default=ActionItemPriority.MEDIUM
    )
    status: Mapped[ActionItemStatus] = mapped_column(
        SAEnum(ActionItemStatus), default=ActionItemStatus.OPEN
    )
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    assessment: Mapped["ComplianceAssessment"] = relationship(
        "ComplianceAssessment", foreign_keys=[assessment_id]
    )
