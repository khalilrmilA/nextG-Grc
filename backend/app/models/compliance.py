"""Compliance management models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON, Float, Integer, DateTime
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
        SAEnum(AssessmentStatus, values_callable=lambda x: [e.value for e in x]), default=AssessmentStatus.DRAFT
    )
    lead_assessor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Scope definition
    scope_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    in_scope_assets: Mapped[list] = mapped_column(JSON, default=list)

    # --- STB objectif 2: "des processus, départements ou systèmes" -----------
    # Compliance could previously only be evaluated for a (tenant, framework)
    # pair — none of the three nouns the requirement names was expressible.
    # scope_type says which one this assessment covers; the matching id column
    # carries it. 'tenant' preserves today's organisation-wide behaviour and is
    # what every existing assessment is.
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False, default="tenant")
    org_entity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("org_entities.id"), nullable=True, index=True
    )
    business_process_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("business_processes.id"), nullable=True, index=True
    )

    # The customisable conformity grid this assessment is graded on. Null = the
    # legacy ControlStatus enum and the hard-coded score formula, so all 51
    # existing assessments keep the scores they already show.
    scale_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_scales.id"), nullable=True
    )

    # Dates
    assessment_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    assessment_end: Mapped[str | None] = mapped_column(String(20), nullable=True)
    next_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Overall score (computed)
    compliance_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # AI analysis job status: idle | running | completed | failed
    ai_analysis_status: Mapped[str] = mapped_column(String(20), default="idle", nullable=False, server_default="idle")
    ai_analysis_error: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        SAEnum(ControlStatus, values_callable=lambda x: [e.value for e in x]), default=ControlStatus.NOT_STARTED
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

    # --- STB objectif 2: grille personnalisable ------------------------------
    # When the assessment uses a custom scale, the verdict is a key from that
    # scale. `status` keeps carrying the nearest legacy enum value so every
    # existing query, score and export keeps working untouched.
    status_key: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # --- STB objectif 5: the auditor's own verdict ---------------------------
    # Kept separate from `status`, which is the owner's self-assessment. The
    # auditor portal previously smuggled its verdict into
    # not_applicable_justification as regex-parsed text.
    auditor_verdict: Mapped[str | None] = mapped_column(String(40), nullable=True)
    auditor_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    auditor_verdict_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    auditor_verdict_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- R2: human work survives an AI re-run (scripts/migrate_r2_lifecycle.py) ---
    # Who set `status` last: "human" (a person, incl. accepting the AI's
    # suggestion) or "ai" (the analysis). NULL on rows that predate the marker
    # (scripts/backfill_control_status_source.py recovers human edits from the
    # activity log). The analysis never overwrites a human-set row; it records its
    # opinion in ai_suggested_* instead.
    status_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    ai_suggested_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    ai_suggested_status_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    ai_suggested_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_suggested_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

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
        SAEnum(EvidenceType, values_callable=lambda x: [e.value for e in x]), default=EvidenceType.DOCUMENT
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

    # Local file path (relative to UPLOADS_DIR)
    file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # SHA-256 of the bytes received at upload, so a later read can prove the
    # file was not altered on disk (see services/file_integrity.py). NULL on
    # rows stored before checksums existed — reported as "unrecorded", never
    # as tampering.
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Auditor can see this file
    is_visible_to_auditor: Mapped[bool] = mapped_column(Boolean, default=True)

    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Cross-framework sharing: if set, this record is an auto-shared copy of the source evidence
    shared_from_evidence_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True
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

    # Recommendation workflow
    recommendation_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/accepted/rejected
    is_certification_blocker: Mapped[bool] = mapped_column(Boolean, default=False)
    remediation_priority: Mapped[int] = mapped_column(Integer, default=50)  # 1-100
    action_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

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
    # SHA-256 of the uploaded bytes — see services/file_integrity.py.
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Document intelligence fields
    document_type_key: Mapped[str | None] = mapped_column(String(100), nullable=True)  # matches MandatoryDocument.document_type_key
    clause_refs: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["4.3", "6.1.3"]
    ai_analysis_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    is_visible_to_auditor: Mapped[bool] = mapped_column(Boolean, default=True)

    assessment: Mapped["ComplianceAssessment"] = relationship(
        "ComplianceAssessment", back_populates="uploaded_documents"
    )
