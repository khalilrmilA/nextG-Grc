"""Asset management model."""
import enum
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, ForeignKey, Enum as SAEnum, JSON, Boolean, DateTime
from app.core.database import Base


class AssetType(str, enum.Enum):
    SERVER = "server"
    WORKSTATION = "workstation"
    CLOUD_SERVICE = "cloud_service"
    APPLICATION = "application"
    DATABASE = "database"
    NETWORK_DEVICE = "network_device"
    MOBILE_DEVICE = "mobile_device"
    IOT_DEVICE = "iot_device"
    DATA = "data"
    PROCESS = "process"
    PERSON = "person"
    # Support categories the client names explicitly and that had no equivalent:
    # a physical location, a paper document, and a third party.
    SITE = "site"                          # local / premises
    PHYSICAL_DOCUMENT = "physical_document"
    SUPPLIER = "supplier"                  # fournisseur


class AssetCategory(str, enum.Enum):
    """Vocabulary for ``Asset.asset_class`` — primary or support.

    The column already existed and carried these two values as free text; this
    names them so create/update can validate against something rather than
    accepting any string.

    A primary asset is what the organisation actually cares about — a business
    process or the information itself. A support asset is what that depends on:
    equipment, premises, applications, paper records, people, suppliers. Risk
    analysis starts from the primary assets and reaches the support assets
    through their dependencies, so a flat type list cannot express it.
    """
    PRIMARY = "primary"
    SUPPORT = "support"


# Default classification for each type, used when none is given. PROCESS and
# DATA are the two primary kinds; everything else exists to support them.
DEFAULT_CATEGORY_FOR_TYPE = {
    "process": AssetCategory.PRIMARY,
    "data": AssetCategory.PRIMARY,
}


class AssetLifecycleState(str, enum.Enum):
    """The phases an asset moves through, from acquisition to disposal.

    The column was free text, so the phases the methodology names could not be
    tracked consistently — "retired", "Retired" and "retire" were three states.
    These values are chosen to keep the data already in use valid (in_use,
    maintenance, retired) while naming the two ends that were missing.
    """
    ACQUISITION = "acquisition"       # ordered / received, not yet in service
    IN_USE = "in_use"                 # exploitation
    MAINTENANCE = "maintenance"
    RETIRED = "retired"               # retrait — withdrawn from service
    DECOMMISSIONED = "decommissioned" # désaffectation — disposed of


class AssetStatus(str, enum.Enum):
    """The asset's *operational* state right now — « leur statut ».

    Distinct from :class:`AssetLifecycleState`, and deliberately sharing none of
    its values. The lifecycle answers "where is this asset in its life?"
    (acquisition -> in_use -> maintenance -> retired -> decommissioned); the
    status answers "is it delivering its service at this moment?". The two are
    genuinely independent: a server in the ``maintenance`` phase can still be
    ``operational`` (rolling patch, no outage) or ``out_of_service`` (on the
    bench), and a laptop in the ``in_use`` phase can be ``lost``. Answering both
    questions with one column — which is what the product did before this — hides
    exactly the situations a bank needs to see.

    Kept to five values on purpose: each one drives a different reaction
    (nothing / capacity watch / restore / incident containment / declaration).
    """
    OPERATIONAL = "operational"        # en service, nominal
    DEGRADED = "degraded"              # running with impaired capacity/performance
    OUT_OF_SERVICE = "out_of_service"  # hors service: stopped, in stock, or withdrawn
    QUARANTINED = "quarantined"        # isolated on purpose (incident containment)
    LOST = "lost"                      # lost or stolen — whereabouts unknown


class AssetCriticality(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Asset(Base):
    """An IT/business asset that can be in scope for compliance assessments."""
    __tablename__ = "assets"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    asset_type: Mapped[AssetType] = mapped_column(SAEnum(AssetType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    criticality: Mapped[AssetCriticality] = mapped_column(
        SAEnum(AssetCriticality, values_callable=lambda x: [e.value for e in x]), default=AssetCriticality.MEDIUM
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Location / hosting
    hosting_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # on-prem, cloud, hybrid
    cloud_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Data classification
    data_classification: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contains_pii: Mapped[bool] = mapped_column(Boolean, default=False)
    contains_phi: Mapped[bool] = mapped_column(Boolean, default=False)
    contains_pci: Mapped[bool] = mapped_column(Boolean, default=False)

    # Business value & DR objectives (inspired by CISO Assistant)
    business_value: Mapped[str | None] = mapped_column(String(50), nullable=True)  # critical, high, medium, low
    rto_seconds: Mapped[int | None] = mapped_column(nullable=True)  # Recovery Time Objective
    rpo_seconds: Mapped[int | None] = mapped_column(nullable=True)  # Recovery Point Objective
    mtd_seconds: Mapped[int | None] = mapped_column(nullable=True)  # Maximum Tolerable Downtime

    # Security objectives (JSON: {"confidentiality": 3, "integrity": 3, "availability": 4})
    security_objectives: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # ISO 27005 primary/support classification (Elite Pack).
    # 'primary' = process/information; 'support' = equipment/app/people/etc.
    # 'primary' (a business process or the information itself) or 'support'
    # (what that depends on: equipment, premises, applications, paper records,
    # people, suppliers). Validated against AssetCategory at the API boundary,
    # and defaulted from asset_type when not supplied.
    asset_class: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    # For a support asset: the primary asset id(s) it serves.
    serves_asset_ids: Mapped[list] = mapped_column(JSON, default=list)

    # Cartography links (Elite Pack).
    business_process_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("business_processes.id"), nullable=True
    )
    org_entity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("org_entities.id"), nullable=True
    )

    # Lifecycle (Elite Pack): acquisition -> in_use -> maintenance -> retired.
    # One of AssetLifecycleState, validated at the API boundary. A change is
    # written to the hash-chained activity log with its before/after, so the
    # phase history is auditable without a second table.
    lifecycle_state: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    acquired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_of_life_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Operational status (STB objectif 1, « leur statut »). The tender names the
    # status AND the lifecycle as two separate indicators; the product answered
    # both with lifecycle_state, so "is this asset actually serving?" could not
    # be asked at all. One of AssetStatus, validated at the API boundary, and
    # nullable so a row that predates the migration reads as "not declared"
    # rather than as a value nobody chose.
    #
    # index=True does NOT create the index on the live table: assets already
    # exists, so this column arrives by ALTER TABLE (scripts/migrate_add_asset_status.py)
    # and the script creates ix_assets_status itself — same as asset_class and
    # lifecycle_state, whose model-level index=True never materialised either.
    status: Mapped[str | None] = mapped_column(
        String(20), nullable=True, index=True, default=AssetStatus.OPERATIONAL.value
    )

    # Periodic review scheduling (RFP gap fix): mirrors Risk.next_review_date so
    # assets get the same mandatory-review + reminder mechanism as risks. ISO date
    # string ("YYYY-MM-DD"), same format/column type as Risk.next_review_date.
    next_review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Tags
    tags: Mapped[list] = mapped_column(JSON, default=list)

    # Metadata from integration (auto-discovered)
    integration_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="assets")
