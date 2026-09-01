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

    # RFP rule: scenario -> risk-register consolidation. Auto-populated the first
    # time this scenario is created/edited; never overwritten with a different risk.
    linked_risk_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("risks.id"), nullable=True, index=True
    )

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

    # Per-scenario risk appetite (RFP gap fix, Elite Pack): mirrors Risk.appetite_threshold
    # but lets a scenario carry its own threshold independent of its linked Risk's —
    # e.g. a scenario the register hasn't caught up with yet, or one that warrants a
    # tighter bar than the consolidated risk. Gated behind the same "risk_appetite"
    # feature flag as the risk-register version (see risk_scenarios.py).
    appetite_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)

    # RFP gap fix: "la revue annuelle des scenarios n'est pas outillee" — only Risk
    # had next_review_date + review-deadline notifications. Mirrors Risk.next_review_date
    # (ISO date string) so a scenario can carry its own review schedule independent of
    # its linked Risk's. New column on an existing table — see
    # scripts/migrate_add_scenario_review_date.py. Alerting: see
    # check_scenario_review_deadlines() in notification_generator.py.
    next_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # M5.3 (Elite Pack): additional weighted prioritization criterion beyond raw
    # probability x impact. 0.0-1.0 (0 = no additional regulatory exposure, 1 = max),
    # matching the existing 0.5-1.5 bounded-multiplier convention used for
    # Vulnerability.context_weight rather than the 1-5 likelihood/impact scale — this
    # is a *weight*, not a scale position. New column on an existing table — see
    # scripts/migrate_add_scenario_priority.py.
    regulatory_exposure_weight: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Computed (recomputed on every create/update alongside current_risk_level, see
    # risk_scenarios.py's _priority_score): combines the matrix-derived current score
    # with regulatory_exposure_weight so scenarios can be ranked by more than raw
    # probability x impact. Persisted (rather than computed only at read time) so
    # GET /risk-scenarios?sort=priority can order without recomputing per request.
    priority_score: Mapped[float | None] = mapped_column(Float, nullable=True)
