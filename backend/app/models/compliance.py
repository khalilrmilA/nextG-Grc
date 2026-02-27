"""Compliance management models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON, Float, Integer
from app.core.database import Base


class AssessmentStatus(str, enum.Enum):
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    UNDER_REVIEW = "under_review"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ControlStatus(str, enum.Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    IMPLEMENTED = "implemented"
    NOT_APPLICABLE = "not_applicable"
    PARTIALLY_IMPLEMENTED = "partially_implemented"
    NOT_IMPLEMENTED = "not_implemented"


class EvidenceType(str, enum.Enum):
    DOCUMENT = "document"
    SCREENSHOT = "screenshot"
    LOG = "log"
    CONFIGURATION = "configuration"
    REPORT = "report"
    ATTESTATION = "attestation"
    AUTOMATED = "automated"  # Collected via integration


class ComplianceAssessment(Base):
    """
    An assessment of an organization's compliance against a specific framework.
    E.g. "ISO 27001:2022 Assessment - Q4 2025"
    """
    __tablename__ = "compliance_assessments"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    framework_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("frameworks.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[AssessmentStatus] = mapped_column(
        SAEnum(AssessmentStatus), default=AssessmentStatus.DRAFT
    )
    lead_assessor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Scope definition
    scope_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    in_scope_assets: Mapped[list] = mapped_column(JSON, default=list)

    # Dates
    assessment_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    assessment_end: Mapped[str | None] = mapped_column(String(20), nullable=True)
    next_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Overall score (computed)
    compliance_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(
        "Tenant", back_populates="compliance_assessments"
    )
    control_assessments: Mapped[list["ControlAssessment"]] = relationship(
        "ControlAssessment", back_populates="assessment"
    )
    gaps: Mapped[list["ComplianceGap"]] = relationship(
        "ComplianceGap", back_populates="assessment"
    )
    uploaded_documents: Mapped[list["UploadedDocument"]] = relationship(
        "UploadedDocument", back_populates="assessment"
    )


class ControlAssessment(Base):
    """
    Assessment of a single control within a compliance assessment.
    Tracks implementation status, evidence, and owner.
    """
    __tablename__ = "control_assessments"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("compliance_assessments.id"), nullable=False, index=True
    )
    control_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=False
    )
    status: Mapped[ControlStatus] = mapped_column(
        SAEnum(ControlStatus), default=ControlStatus.NOT_STARTED
    )
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    implementation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # For "not_applicable" — justification required
    not_applicable_justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    # AI analysis confidence score (0.0 - 1.0)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    assessment: Mapped["ComplianceAssessment"] = relationship(
        "ComplianceAssessment", back_populates="control_assessments"
    )
    control: Mapped["FrameworkControl"] = relationship(
        "FrameworkControl", back_populates="assessments"
    )
    evidence: Mapped[list["Evidence"]] = relationship(
        "Evidence", back_populates="control_assessment"
    )


class Evidence(Base):
    """Evidence uploaded or collected for a control assessment."""
    __tablename__ = "evidence"

    control_assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("control_assessments.id"), nullable=False, index=True
    )
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_type: Mapped[EvidenceType] = mapped_column(
        SAEnum(EvidenceType), default=EvidenceType.DOCUMENT
    )

    # File storage
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(nullable=True)
    s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Automated evidence metadata
    source_integration: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_automated: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Validity
    valid_from: Mapped[str | None] = mapped_column(String(20), nullable=True)
    valid_until: Mapped[str | None] = mapped_column(String(20), nullable=True)

    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Relationships
    control_assessment: Mapped["ControlAssessment"] = relationship(
        "ControlAssessment", back_populates="evidence"
    )


class ComplianceGap(Base):
    """Identified gap in compliance — a control that is not fully implemented."""
    __tablename__ = "compliance_gaps"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("compliance_assessments.id"), nullable=False, index=True
    )
    control_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=False
    )
    gap_description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="medium")  # critical/high/medium/low
    remediation_steps: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)

    assessment: Mapped["ComplianceAssessment"] = relationship(
        "ComplianceAssessment", back_populates="gaps"
    )


class UploadedDocument(Base):
    """Document uploaded by a user for compliance analysis (pre-analysis input)."""
    __tablename__ = "uploaded_documents"

    assessment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("compliance_assessments.id"), nullable=False, index=True
    )
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)  # local path or S3 key
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    assessment: Mapped["ComplianceAssessment"] = relationship(
        "ComplianceAssessment", back_populates="uploaded_documents"
    )
