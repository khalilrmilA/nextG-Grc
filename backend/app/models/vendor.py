"""Third-Party Risk Management (TPRM) models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON, Float
from app.core.database import Base


class VendorRiskTier(str, enum.Enum):
    CRITICAL = "critical"   # Access to core systems / sensitive data
    HIGH = "high"           # Access to some systems
    MEDIUM = "medium"       # Limited access
    LOW = "low"             # No system access


class VendorStatus(str, enum.Enum):
    ACTIVE = "active"
    UNDER_REVIEW = "under_review"
    ONBOARDING = "onboarding"
    OFFBOARDING = "offboarding"
    INACTIVE = "inactive"


class AssessmentQuestionType(str, enum.Enum):
    YES_NO = "yes_no"
    MULTIPLE_CHOICE = "multiple_choice"
    TEXT = "text"
    FILE_UPLOAD = "file_upload"
    DATE = "date"


class Vendor(Base):
    """A third-party vendor or supplier."""
    __tablename__ = "vendors"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    country: Mapped[str | None] = mapped_column(String(10), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    risk_tier: Mapped[VendorRiskTier] = mapped_column(
        SAEnum(VendorRiskTier, values_callable=lambda x: [e.value for e in x]), default=VendorRiskTier.MEDIUM
    )
    status: Mapped[VendorStatus] = mapped_column(
        SAEnum(VendorStatus, values_callable=lambda x: [e.value for e in x]), default=VendorStatus.ACTIVE
    )

    # Vendor manager
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Services / data they have access to
    services_provided: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_access_types: Mapped[list] = mapped_column(JSON, default=list)
    has_data_processing_agreement: Mapped[bool] = mapped_column(Boolean, default=False)
    contract_expiry: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Risk score (computed from assessments)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Contact
    primary_contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    primary_contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Tags
    tags: Mapped[list] = mapped_column(JSON, default=list)

    # Offboarding — set by POST /vendors/{id}/offboard (scripts/migrate_r2_lifecycle.py).
    # The relationship's end is a decision with a date and a reason, not a bare status flip.
    offboarded_at: Mapped[str | None] = mapped_column(String(20), nullable=True)
    offboarding_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    offboarded_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="vendors")
    assessments: Mapped[list["VendorAssessment"]] = relationship(
        "VendorAssessment", back_populates="vendor"
    )
    contracts: Mapped[list["VendorContract"]] = relationship(
        "VendorContract", back_populates="vendor"
    )
    risks: Mapped[list["VendorRisk"]] = relationship(
        "VendorRisk", back_populates="vendor"
    )


class VendorAssessment(Base):
    """A security assessment questionnaire sent to a vendor."""
    __tablename__ = "vendor_assessments"

    vendor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("vendors.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    sent_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Questions and answers stored as JSONB
    questions: Mapped[list] = mapped_column(JSON, default=list)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)

    # Score
    assessment_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    findings: Mapped[list] = mapped_column(JSON, default=list)

    # History of the vendor's risk evaluations (scripts/migrate_r2_lifecycle.py).
    # kind: "prescreen" (questionnaire + AI insights) | "ai_analysis" (web-search report).
    kind: Mapped[str | None] = mapped_column(String(30), nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Structured AI output (strengths, concerns, red flags, recommendations …).
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    assessed_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    approved_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # 40: a timezone-aware isoformat() is 32 characters (follow-up B-3).
    approved_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # The value written to vendor.risk_score when this assessment was approved
    # (the prescreen flow stores it on the register's 1–40 scale).
    applied_risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="assessments")


class ContractValidationStatus(str, enum.Enum):
    """Validation workflow states for contracts."""
    PENDING_AI = "pending_ai"              # Just uploaded, waiting for AI
    AI_REVIEWED = "ai_reviewed"            # AI review complete, waiting for CISO
    PENDING_CISO = "pending_ciso"          # Under CISO review
    APPROVED = "approved"                  # CISO approved
    REJECTED = "rejected"                  # CISO rejected
    SENT_TO_VENDOR = "sent_to_vendor"      # Sent back to vendor after approval


class VendorContract(Base):
    """Contract document associated with a vendor."""
    __tablename__ = "vendor_contracts"

    vendor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("vendors.id"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_size: Mapped[int] = mapped_column(nullable=True)
    # SHA-256 of the uploaded bytes — see services/file_integrity.py.
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_review: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, completed, error

    # Validation workflow fields
    validation_status: Mapped[str] = mapped_column(
        String(50), default=ContractValidationStatus.PENDING_AI.value
    )
    ciso_reviewer_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    ciso_comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    ciso_reviewed_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sent_to_vendor_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    version: Mapped[int] = mapped_column(default=1)

    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="contracts")


class VendorRisk(Base):
    """A specific risk associated with a vendor."""
    __tablename__ = "vendor_risks"

    vendor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("vendors.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), default="medium")
    status: Mapped[str] = mapped_column(String(50), default="open")
    mitigation: Mapped[str | None] = mapped_column(Text, nullable=True)

    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="risks")
