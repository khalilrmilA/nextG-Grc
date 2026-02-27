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
        SAEnum(VendorRiskTier), default=VendorRiskTier.MEDIUM
    )
    status: Mapped[VendorStatus] = mapped_column(
        SAEnum(VendorStatus), default=VendorStatus.ACTIVE
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

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="vendors")
    assessments: Mapped[list["VendorAssessment"]] = relationship(
        "VendorAssessment", back_populates="vendor"
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

    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="assessments")


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
