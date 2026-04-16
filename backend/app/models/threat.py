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
