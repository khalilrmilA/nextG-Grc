"""Policy management models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON, Integer
from app.core.database import Base


class PolicyStatus(str, enum.Enum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    PUBLISHED = "published"
    RETIRED = "retired"


class AttestationStatus(str, enum.Enum):
    PENDING = "pending"
    ACKNOWLEDGED = "acknowledged"
    DECLINED = "declined"
    EXPIRED = "expired"


class Policy(Base):
    """A policy document (e.g. Information Security Policy, Acceptable Use Policy)."""
    __tablename__ = "policies"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    policy_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Who owns this policy
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    status: Mapped[PolicyStatus] = mapped_column(
        SAEnum(PolicyStatus, values_callable=lambda x: [e.value for e in x]), default=PolicyStatus.DRAFT
    )

    # Linked framework controls this policy satisfies
    linked_controls: Mapped[list] = mapped_column(JSON, default=list)

    # Review schedule
    review_frequency_months: Mapped[int] = mapped_column(Integer, default=12)
    next_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # R2 follow-up A-2: True when a person set next_review_date by hand — a
    # publish then keeps it instead of computing today + frequency.
    next_review_date_manual: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    # The latest periodic review ("mark as reviewed"); the full trail is in policy_reviews.
    last_reviewed_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    last_reviewed_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    last_review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Governance lifecycle dates (RFP gap: "date de mise en vigueur" / "date d'expiration"
    # distinct from the review cycle). ISO date strings, matching this codebase's
    # date-as-string convention (see next_review_date above, Risk.next_review_date, etc).
    effective_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    expiration_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Structured linkage to the org model (RFP gap: policy -> process/entity/department).
    business_process_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("business_processes.id"), nullable=True
    )
    org_entity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("org_entities.id"), nullable=True
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="policies")
    versions: Mapped[list["PolicyVersion"]] = relationship(
        "PolicyVersion", back_populates="policy", order_by="PolicyVersion.version_number"
    )
    attestations: Mapped[list["PolicyAttestation"]] = relationship(
        "PolicyAttestation", back_populates="policy"
    )

    @property
    def current_version(self) -> "PolicyVersion | None":
        published = [v for v in self.versions if v.is_current]
        return published[0] if published else None


class PolicyVersion(Base):
    """A versioned snapshot of a policy document."""
    __tablename__ = "policy_versions"

    policy_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("policies.id"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    content: Mapped[str] = mapped_column(Text, nullable=False)  # HTML/Markdown content
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

    authored_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    approved_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    approved_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # S3 key for the PDF export
    pdf_s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)

    policy: Mapped["Policy"] = relationship("Policy", back_populates="versions")


class PolicyReview(Base):
    """One periodic review of a published policy (R2 follow-up A-2).

    The reviewer confirms the text is still fit for purpose, says why in a
    comment, and the next review date moves forward by the policy's frequency.
    """
    __tablename__ = "policy_reviews"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    policy_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("policies.id"), nullable=False, index=True
    )
    reviewed_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[str] = mapped_column(String(30), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    # The date that was due when the review happened, and the one it set.
    previous_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    next_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)


class PolicyAttestation(Base):
    """
    An attestation request sent to a user to acknowledge a policy.
    Tracks whether employees have read and acknowledged policies.
    """
    __tablename__ = "policy_attestations"

    policy_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("policies.id"), nullable=False, index=True
    )
    policy_version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("policy_versions.id"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    status: Mapped[AttestationStatus] = mapped_column(
        SAEnum(AttestationStatus, values_callable=lambda x: [e.value for e in x]), default=AttestationStatus.PENDING
    )
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    acknowledged_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(50), nullable=True)

    policy: Mapped["Policy"] = relationship("Policy", back_populates="attestations")
