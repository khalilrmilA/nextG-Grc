"""Incident Management models — track security incidents and breaches."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, ForeignKey, Enum as SAEnum, JSON, Float
from app.core.database import Base


class IncidentSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class IncidentStatus(str, enum.Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    CONTAINED = "contained"
    RESOLVED = "resolved"
    CLOSED = "closed"
    POST_MORTEM = "post_mortem"

class IncidentCategory(str, enum.Enum):
    DATA_BREACH = "data_breach"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    MALWARE = "malware"
    PHISHING = "phishing"
    DOS_ATTACK = "dos_attack"
    INSIDER_THREAT = "insider_threat"
    PHYSICAL_SECURITY = "physical_security"
    SYSTEM_OUTAGE = "system_outage"
    POLICY_VIOLATION = "policy_violation"
    OTHER = "other"


class Incident(Base):
    """A security or compliance incident."""
    __tablename__ = "incidents"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[IncidentCategory] = mapped_column(SAEnum(IncidentCategory, values_callable=lambda x: [e.value for e in x]), default=IncidentCategory.OTHER)
    severity: Mapped[IncidentSeverity] = mapped_column(SAEnum(IncidentSeverity, values_callable=lambda x: [e.value for e in x]), default=IncidentSeverity.MEDIUM)
    status: Mapped[IncidentStatus] = mapped_column(SAEnum(IncidentStatus, values_callable=lambda x: [e.value for e in x]), default=IncidentStatus.OPEN)

    # Who
    reporter_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    assigned_to_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    # When
    detected_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contained_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    resolved_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Impact
    affected_systems: Mapped[list] = mapped_column(JSON, default=list)
    affected_users_count: Mapped[int | None] = mapped_column(nullable=True)
    data_types_affected: Mapped[list] = mapped_column(JSON, default=list)  # PII, PHI, PCI, etc.
    business_impact: Mapped[str | None] = mapped_column(Text, nullable=True)
    financial_impact: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Response
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    containment_actions: Mapped[str | None] = mapped_column(Text, nullable=True)
    remediation_actions: Mapped[str | None] = mapped_column(Text, nullable=True)
    lessons_learned: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_mortem_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Regulatory
    breach_notification_required: Mapped[bool] = mapped_column(default=False)
    notification_sent_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    regulatory_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Linked entities
    linked_risks: Mapped[list] = mapped_column(JSON, default=list)
    linked_controls: Mapped[list] = mapped_column(JSON, default=list)
    linked_vendors: Mapped[list] = mapped_column(JSON, default=list)
    linked_vulnerabilities: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
