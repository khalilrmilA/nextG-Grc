"""
Tenant model — represents a customer organization.
Multi-tenancy is enforced at the Row Level Security (RLS) level in PostgreSQL.
"""
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, JSON
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(String(10), nullable=True)  # ISO 3166-1

    # Framework selection (set during registration)
    primary_framework_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    selected_framework_ids: Mapped[list] = mapped_column(JSON, default=list)
    org_size: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "1-50","51-200","201-1000","1000+"

    # Feature flags per tenant (from subscription tier)
    features: Mapped[dict] = mapped_column(JSON, default=dict)

    # Settings
    settings: Mapped[dict] = mapped_column(JSON, default=dict)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    users: Mapped[list["User"]] = relationship("User", back_populates="tenant")
    subscription: Mapped["Subscription | None"] = relationship(
        "Subscription", back_populates="tenant", uselist=False
    )
    risks: Mapped[list["Risk"]] = relationship("Risk", back_populates="tenant")
    compliance_assessments: Mapped[list["ComplianceAssessment"]] = relationship(
        "ComplianceAssessment", back_populates="tenant"
    )
    audits: Mapped[list["Audit"]] = relationship("Audit", back_populates="tenant")
    policies: Mapped[list["Policy"]] = relationship("Policy", back_populates="tenant")
    vendors: Mapped[list["Vendor"]] = relationship("Vendor", back_populates="tenant")
    assets: Mapped[list["Asset"]] = relationship("Asset", back_populates="tenant")
    ai_access_requests: Mapped[list["AiAccessRequest"]] = relationship("AiAccessRequest", back_populates="tenant")
    ai_usage_quotas: Mapped[list["AiUsageQuota"]] = relationship("AiUsageQuota", back_populates="tenant")
    api_tokens: Mapped[list["ApiToken"]] = relationship("ApiToken", back_populates="tenant")
