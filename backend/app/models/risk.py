"""Risk management models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Float, ForeignKey, Enum as SAEnum, JSON, Integer
from app.core.database import Base


class RiskStatus(str, enum.Enum):
    IDENTIFIED = "identified"
    ASSESSED = "assessed"
    TREATMENT_PLANNED = "treatment_planned"
    TREATMENT_IN_PROGRESS = "treatment_in_progress"
    TREATED = "treated"
    ACCEPTED = "accepted"
    CLOSED = "closed"


class RiskTreatmentOption(str, enum.Enum):
    MITIGATE = "mitigate"
    ACCEPT = "accept"
    TRANSFER = "transfer"
    AVOID = "avoid"


class RiskSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class Risk(Base):
    """A risk in the risk register."""
    __tablename__ = "risks"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_category: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Risk owner
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    status: Mapped[RiskStatus] = mapped_column(
        SAEnum(RiskStatus, values_callable=lambda x: [e.value for e in x]), default=RiskStatus.IDENTIFIED
    )

    # Scoring (qualitative: 1-5 scale)
    likelihood: Mapped[float | None] = mapped_column(Float, nullable=True)
    impact: Mapped[float | None] = mapped_column(Float, nullable=True)

    @property
    def inherent_risk_score(self) -> float | None:
        if self.likelihood and self.impact:
            return self.likelihood * self.impact
        return None

    # After controls applied
    residual_likelihood: Mapped[float | None] = mapped_column(Float, nullable=True)
    residual_impact: Mapped[float | None] = mapped_column(Float, nullable=True)

    @property
    def residual_risk_score(self) -> float | None:
        if self.residual_likelihood and self.residual_impact:
            return self.residual_likelihood * self.residual_impact
        return None

    severity: Mapped[RiskSeverity | None] = mapped_column(
        SAEnum(RiskSeverity, values_callable=lambda x: [e.value for e in x]), nullable=True
    )

    # Linked framework controls
    linked_controls: Mapped[list] = mapped_column(JSON, default=list)

    # Linked assets
    linked_assets: Mapped[list] = mapped_column(JSON, default=list)

    # Review scheduling
    next_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_reviewed_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Tags
    tags: Mapped[list] = mapped_column(JSON, default=list)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="risks")
    treatment: Mapped["RiskTreatment | None"] = relationship(
        "RiskTreatment", back_populates="risk", uselist=False
    )
    assessments: Mapped[list["RiskAssessment"]] = relationship(
        "RiskAssessment", back_populates="risk"
    )


class RiskAssessment(Base):
    """A point-in-time assessment of a risk (tracks history)."""
    __tablename__ = "risk_assessments"

    risk_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("risks.id"), nullable=False, index=True
    )
    assessed_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    likelihood: Mapped[float] = mapped_column(Float, nullable=False)
    impact: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    risk: Mapped["Risk"] = relationship("Risk", back_populates="assessments")


class RiskTreatment(Base):
    """Risk treatment plan for a specific risk."""
    __tablename__ = "risk_treatments"

    risk_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("risks.id"), nullable=False, unique=True
    )
    treatment_option: Mapped[RiskTreatmentOption] = mapped_column(
        SAEnum(RiskTreatmentOption, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    progress_percentage: Mapped[int] = mapped_column(Integer, default=0)

    # If "transfer" — name of insurer or third party
    transfer_to: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # If "accept" — justification required
    acceptance_justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    risk: Mapped["Risk"] = relationship("Risk", back_populates="treatment")
