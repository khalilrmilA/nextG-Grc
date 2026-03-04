"""Auditor assignment model — links auditor users to compliance assessments."""
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, ForeignKey, JSON
from app.core.database import Base


class AuditorAssignment(Base):
    """
    Assigns an auditor to a compliance assessment.
    Controls which assessments an auditor can access and what reference materials they have.
    """
    __tablename__ = "auditor_assignments"

    auditor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("compliance_assessments.id"), nullable=False, index=True
    )
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    assigned_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Reference documents provided to the auditor (list of UploadedDocument IDs)
    reference_document_ids: Mapped[list] = mapped_column(JSON, default=list)

    # Auditor notes visible only to this auditor
    auditor_notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    # Relationships
    assessment: Mapped["ComplianceAssessment"] = relationship(
        "ComplianceAssessment", foreign_keys=[assessment_id]
    )
    auditor: Mapped["User"] = relationship(
        "User", foreign_keys=[auditor_id]
    )
    assigned_by: Mapped["User"] = relationship(
        "User", foreign_keys=[assigned_by_id]
    )
