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

    # Target (desired future state after planned treatment) — mirrors RiskScenario.
    target_likelihood: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_impact: Mapped[float | None] = mapped_column(Float, nullable=True)

    @property
    def target_risk_score(self) -> float | None:
        if self.target_likelihood and self.target_impact:
            return self.target_likelihood * self.target_impact
        return None

    # Which risk matrix drives this risk's scoring (null = the tenant's default / builtin 5x5).
    risk_matrix_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    severity: Mapped[RiskSeverity | None] = mapped_column(
        SAEnum(RiskSeverity, values_callable=lambda x: [e.value for e in x]), nullable=True
    )

    # Risk appetite threshold (Elite Pack): residual/inherent score above this is
    # "over appetite" and should be flagged for treatment.
    appetite_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)

    @property
    def over_appetite(self) -> bool | None:
        if self.appetite_threshold is None:
            return None
        score = self.residual_risk_score if self.residual_risk_score is not None else self.inherent_risk_score
        if score is None:
            return None
        return score > self.appetite_threshold

    @property
    def target_over_appetite(self) -> bool | None:
        """RFP rule: the TARGET (post-treatment-plan) score must also clear appetite.

        A residual score can look fine today while the *planned* end-state still
        breaches appetite — this flags that case separately from `over_appetite`.
        """
        if self.appetite_threshold is None or self.target_risk_score is None:
            return None
        return self.target_risk_score > self.appetite_threshold

    # Reopen justification (RFP rule): required when a closed risk transitions back
    # to any other status. Persisted on the row since there is no per-request hook
    # into the activity-log middleware to carry structured before/after detail.
    reopen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Target-validation gate (Elite Pack, RFP gap fix): the RFP requires the TARGET
    # (post-treatment) score to be usable as the treatment plan's "final validation
    # criterion", plus traceability of the calculation/hypotheses behind it. Set by
    # POST /risks/{id}/validate-target (risks.py) — that endpoint refuses to stamp
    # target_validated_at while target_over_appetite is still true. New columns —
    # see backend/scripts/migrate_add_treatment_scenario_links.py.
    target_validated_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    target_calculation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    """Risk treatment plan for a specific risk.

    NOTE (RFP gap fix, deferred sub-point): the RFP asks for more than one
    treatment plan per risk, which would mean dropping the `unique=True` below.
    SQLite has no `ALTER TABLE ... DROP CONSTRAINT` — a inline column `UNIQUE`
    becomes part of the table's CREATE-TABLE DDL (an internal
    `sqlite_autoindex_risk_treatments_*`), so removing it safely requires a
    full table rebuild (create new table, copy rows, drop+rename) on a
    database backing live production data. That rebuild is deliberately NOT
    done here — see backend/app/api/v1/endpoints/risk_treatment.py's module
    docstring / this session's commit message for the full reasoning. The
    `linked_scenario_ids` column directly below IS implemented (plain
    additive column, safe on SQLite).
    """
    __tablename__ = "risk_treatments"

    risk_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("risks.id"), nullable=False, unique=True
    )

    # Direct association to the risk scenario(s) this plan addresses (Elite Pack,
    # RFP gap fix: "pas d'association directe du plan à un ou plusieurs scénarios
    # de risque"). A plan may span more than one scenario chain for the same risk.
    # Tenant-scoped IDOR-checked on write — see risk_treatment.py's
    # _assert_scenarios_in_tenant. New column — see
    # backend/scripts/migrate_add_treatment_scenario_links.py.
    linked_scenario_ids: Mapped[list] = mapped_column(JSON, default=list)
    treatment_option: Mapped[RiskTreatmentOption] = mapped_column(
        SAEnum(RiskTreatmentOption, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    progress_percentage: Mapped[int] = mapped_column(Integer, default=0)

    # Planning (Elite Pack): estimated cost + start of the treatment schedule.
    estimated_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Actual cost incurred so far (Elite Pack, RFP gap fix): compared against
    # estimated_cost to detect budget overruns. Distinct from estimated_cost above —
    # left null until someone actually records spend.
    actual_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Auto-derived priority (RFP gap fix): critical/high/medium/low, mirroring
    # ActionItemPriority's tiering (see compliance.py's gap.remediation_priority ->
    # ActionItemPriority mapping). Derived from the linked risk's severity/score at
    # treatment create/update time — see risk_treatment.py's _derive_treatment_priority.
    # Plain string (not an enum) per the RFP gap spec; nullable so pre-existing rows
    # from before this migration don't need a backfill to stay valid.
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # If "transfer" — name of insurer or third party
    transfer_to: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # If "accept" — justification required
    acceptance_justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    risk: Mapped["Risk"] = relationship("Risk", back_populates="treatment")
