"""Risk Scenario — links threats, vulnerabilities, assets, and controls in a chain.
Inspired by CISO Assistant's data model: threat -> vulnerability -> asset -> control.
"""
import enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey, JSON, Float, Integer
from app.core.database import Base


class ScenarioTreatment(str, enum.Enum):
    MITIGATE = "mitigate"
    ACCEPT = "accept"
    TRANSFER = "transfer"
    AVOID = "avoid"
    UNTREATED = "untreated"

class StrengthOfKnowledge(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    VERY_LOW = "very_low"


class RiskScenario(Base):
    """A risk scenario linking threats to assets via vulnerabilities, mitigated by controls."""
    __tablename__ = "risk_scenarios"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    risk_assessment_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)  # parent assessment

    # Core info
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    treatment: Mapped[ScenarioTreatment] = mapped_column(
        String(50), default=ScenarioTreatment.UNTREATED.value
    )
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Linked entities (the chain: threat -> vuln -> asset -> control)
    threat_ids: Mapped[list] = mapped_column(JSON, default=list)      # linked Threat IDs
    vulnerability_ids: Mapped[list] = mapped_column(JSON, default=list)  # linked Vulnerability IDs
    asset_ids: Mapped[list] = mapped_column(JSON, default=list)        # linked Asset IDs
    applied_control_ids: Mapped[list] = mapped_column(JSON, default=list)  # controls mitigating this scenario

    # Current risk level (inherent — before controls)
    current_probability: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5 (or custom scale)
    current_impact: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_risk_level: Mapped[str | None] = mapped_column(String(20), nullable=True)  # computed: low/medium/high/critical

    # Target risk level (residual — after controls applied)
    target_probability: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_impact: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_risk_level: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Qualitative assessment
    strength_of_knowledge: Mapped[str] = mapped_column(
        String(20), default=StrengthOfKnowledge.MEDIUM.value
    )
    existing_controls_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Threat actor info
    threat_actor: Mapped[str | None] = mapped_column(String(100), nullable=True)  # nation_state, cybercriminal, insider, hacktivist

    # Financial quantification
    estimated_loss_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_loss_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_loss_likely: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Owner
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
