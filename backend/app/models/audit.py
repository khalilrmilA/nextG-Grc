"""Audit management models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON
from app.core.database import Base


class AuditType(str, enum.Enum):
    INTERNAL = "internal"
    EXTERNAL = "external"
    REGULATORY = "regulatory"
    CERTIFICATION = "certification"


class AuditStatus(str, enum.Enum):
    PLANNING = "planning"
    FIELDWORK = "fieldwork"
    REVIEW = "review"
    REPORTING = "reporting"
    CLOSED = "closed"


class FindingSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    OBSERVATION = "observation"


class FindingStatus(str, enum.Enum):
    OPEN = "open"
    IN_REMEDIATION = "in_remediation"
    REMEDIATED = "remediated"
    ACCEPTED = "accepted"
    CLOSED = "closed"


class Audit(Base):
    """An audit engagement."""
    __tablename__ = "audits"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_type: Mapped[AuditType] = mapped_column(SAEnum(AuditType), nullable=False)
    status: Mapped[AuditStatus] = mapped_column(
        SAEnum(AuditStatus), default=AuditStatus.PLANNING
    )

    # Auditor
    lead_auditor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Framework being audited
    framework_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("frameworks.id"), nullable=True
    )

    # Dates
    planned_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    planned_end: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actual_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actual_end: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Scope
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    in_scope_systems: Mapped[list] = mapped_column(JSON, default=list)

    # Report
    report_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    executive_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="audits")
    findings: Mapped[list["AuditFinding"]] = relationship(
        "AuditFinding", back_populates="audit"
    )
    evidence: Mapped[list["AuditEvidence"]] = relationship(
        "AuditEvidence", back_populates="audit"
    )


class AuditFinding(Base):
    """A finding identified during an audit."""
    __tablename__ = "audit_findings"

    audit_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[FindingSeverity] = mapped_column(
        SAEnum(FindingSeverity), nullable=False
    )
    status: Mapped[FindingStatus] = mapped_column(
        SAEnum(FindingStatus), default=FindingStatus.OPEN
    )

    # Linked control
    control_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=True
    )

    # Owner
    remediation_owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)
    management_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    remediation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    audit: Mapped["Audit"] = relationship("Audit", back_populates="findings")


class AuditEvidence(Base):
    """Evidence collected during an audit."""
    __tablename__ = "audit_evidence"

    audit_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    audit: Mapped["Audit"] = relationship("Audit", back_populates="evidence")
