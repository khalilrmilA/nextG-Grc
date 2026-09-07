"""Threat Library — preloaded catalog of cybersecurity threats."""
import enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, JSON, Boolean, Integer, Index
from app.core.database import Base


# The four families the threat register must be classifiable by. This is a
# different axis from ThreatCategory, not a replacement for it: the category
# says what the threat *is* (phishing, flood, insider), the type says which
# part of the organisation owns it. Both are asked for, so both exist.
class ThreatType(str, enum.Enum):
    OPERATIONNELLE = "operationnelle"      # day-to-day operations: process failure, human error, third-party outage
    ORGANISATIONNELLE = "organisationnelle"  # people and governance: insiders, social engineering, regulatory
    ENVIRONNEMENTALE = "environnementale"  # physical surroundings: fire, flood, power, site access
    TECHNOLOGIQUE = "technologique"        # the technology itself: cyber attack, technical failure


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


# Default type for a given category, used when a profile does not set one
# explicitly. A default is not an assessment — the profile can always override
# it, and the register shows which threats still carry the derived value.
CATEGORY_TO_TYPE: dict[str, str] = {
    ThreatCategory.CYBER_ATTACK.value: ThreatType.TECHNOLOGIQUE.value,
    ThreatCategory.TECHNICAL_FAILURE.value: ThreatType.TECHNOLOGIQUE.value,
    ThreatCategory.SOCIAL_ENGINEERING.value: ThreatType.ORGANISATIONNELLE.value,
    ThreatCategory.INSIDER_THREAT.value: ThreatType.ORGANISATIONNELLE.value,
    ThreatCategory.LEGAL_REGULATORY.value: ThreatType.ORGANISATIONNELLE.value,
    ThreatCategory.NATURAL_DISASTER.value: ThreatType.ENVIRONNEMENTALE.value,
    ThreatCategory.PHYSICAL.value: ThreatType.ENVIRONNEMENTALE.value,
    ThreatCategory.SUPPLY_CHAIN.value: ThreatType.OPERATIONNELLE.value,
    ThreatCategory.HUMAN_ERROR.value: ThreatType.OPERATIONNELLE.value,
}

# The profile fields the requirement names as the documented minimum:
# "description, scénario d'occurrence, origine et vecteurs possibles", plus the
# two normalised scales that place the threat in the criticality matrix.
REQUIRED_PROFILE_FIELDS = (
    "description",
    "occurrence_conditions",
    "origin",
    "typical_attack_vectors",
    "probability_level",
    "severity_level",
)


def missing_profile_fields(threat: "Threat") -> list[str]:
    """Which parts of the mandatory profile are still blank."""
    missing = []
    for field in REQUIRED_PROFILE_FIELDS:
        value = getattr(threat, field, None)
        if value is None or (isinstance(value, (str, list)) and not value):
            missing.append(field)
    return missing


class Threat(Base):
    """A catalogued threat that can be linked to risk scenarios."""
    __tablename__ = "threats"

    __table_args__ = (
        # A threat's identity within a tenant is its reference *and* its name,
        # not either alone. The feed scheduler runs in both uvicorn workers,
        # which read the same "already known" set and commit independently —
        # that is how the register accumulated duplicate rows, and a pre-check
        # cannot fix a race between processes.
        #
        # Both narrower keys were measured against the live register and are
        # wrong. Name alone rejects genuinely distinct threats: CISA publishes
        # CVE-2026-25089 and CVE-2026-39808 under the identical title "Fortinet
        # FortiSandbox OS Command Injection Vulnerability". Reference alone is
        # worse (1,416 false collisions) because feed items without their own
        # identifier used to be numbered by position in the batch. The pair
        # leaves 212 rows, and those are true repeats.
        #
        # Built-ins have a NULL tenant_id and SQL treats NULLs as distinct, so
        # the shared catalogue is unaffected.
        Index("ix_threat_tenant_ref_name", "tenant_id", "ref_id", "name", unique=True),
    )

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

    # --- Profile validation and periodic review (RFP module 4) ---
    # operationnelle | organisationnelle | environnementale | technologique.
    # NULL means "not stated" — the API falls back to CATEGORY_TO_TYPE and says
    # so, rather than presenting a derived value as an assessed one.
    threat_type: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)

    # draft | validated. A profile edited after validation drops back to draft:
    # a sign-off applies to what was signed off, not to whatever the record
    # says later.
    profile_status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    validated_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    validated_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Periodic revision. The requirement asks for the profile to be revisited as
    # the context, the threat watch or observed incidents evolve; a cadence with
    # a due date is what makes that checkable instead of aspirational.
    review_frequency_months: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    next_review_due: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)

    # Provenance when this row was copied out of the shared built-in catalogue.
    adopted_from_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
