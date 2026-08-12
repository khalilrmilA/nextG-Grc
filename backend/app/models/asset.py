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
    asset_class: Mapped[str | None] = mapped_column(String(20), nullable=True)
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
    lifecycle_state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    acquired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_of_life_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Tags
    tags: Mapped[list] = mapped_column(JSON, default=list)

    # Metadata from integration (auto-discovered)
    integration_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="assets")
