"""Threat Library — preloaded catalog of cybersecurity threats."""
import enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, JSON, Boolean
from app.core.database import Base


class ThreatCategory(str, enum.Enum):
    CYBER_ATTACK = "cyber_attack"
    SOCIAL_ENGINEERING = "social_engineering"
    INSIDER_THREAT = "insider_threat"
    PHYSICAL = "physical"
    NATURAL_DISASTER = "natural_disaster"
    SUPPLY_CHAIN = "supply_chain"
    TECHNICAL_FAILURE = "technical_failure"
    HUMAN_ERROR = "human_error"
    LEGAL_REGULATORY = "legal_regulatory"


class Threat(Base):
    """A catalogued threat that can be linked to risk scenarios."""
    __tablename__ = "threats"

    ref_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[ThreatCategory] = mapped_column(
        String(50), default=ThreatCategory.CYBER_ATTACK.value
    )
    typical_threat_actors: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["nation_state", "cybercriminal", "insider"]
    typical_attack_vectors: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["email", "network", "physical"]
    affected_assets: Mapped[list] = mapped_column(JSON, default=list)  # asset types typically affected
    mitre_ids: Mapped[list] = mapped_column(JSON, default=list)  # MITRE ATT&CK technique IDs
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=True)
    is_pending: Mapped[bool] = mapped_column(Boolean, default=False)  # awaiting approval after AI fetch
    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # null = global/builtin

    # Threat profile (Elite Pack, RFP module 4)
    origin: Mapped[str | None] = mapped_column(String(20), nullable=True)  # internal | external
    objectives: Mapped[str | None] = mapped_column(Text, nullable=True)
    aggravating_factors: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurrence_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_frequency: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mode_operatoire: Mapped[str | None] = mapped_column(Text, nullable=True)
    # rare | peu_probable | possible | probable | quasiment_certain
    probability_level: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # mineur | notable | fort | tres_fort | critique
    severity_level: Mapped[str | None] = mapped_column(String(30), nullable=True)
    last_reviewed_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reviewed_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    linked_asset_ids: Mapped[list] = mapped_column(JSON, default=list)
    linked_vulnerability_ids: Mapped[list] = mapped_column(JSON, default=list)
