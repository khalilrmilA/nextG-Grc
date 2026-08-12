"""Organisational model — org entities + business processes (Elite Pack: asset cartography).

Part of RFP module 2 (asset cartography + org model) for the STB AO 20/2026
cyber-risk RFP. These two tenant-scoped tables give the asset -> process ->
entity graph its structural backbone:

* ``OrgEntity``       — a node in the organisation hierarchy (division, department,
                        branch, team ...). Self-referential via ``parent_id``.
* ``BusinessProcess`` — a business process operated by an org entity, owned by a
                        user, and depending on a set of assets (``asset_ids``).

New tables -> auto-created by ``Base.metadata.create_all`` on startup; no manual
migration needed, but the module must be imported so the mappers register.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey, JSON

from app.core.database import Base


class OrgEntity(Base):
    """A node in the tenant's organisation hierarchy (self-referential tree)."""
    __tablename__ = "org_entities"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Self-referential parent link (top-level entities have parent_id = NULL).
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("org_entities.id"), nullable=True, index=True
    )
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # division / department / branch / team
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional owning user (head of the entity).
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )


class BusinessProcess(Base):
    """A business process operated by an org entity, owned by a user."""
    __tablename__ = "business_processes"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    criticality: Mapped[str | None] = mapped_column(String(50), nullable=True)  # critical / high / medium / low
    # Process owner (user) — also used to infer supporting assets by shared ownership.
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    # Org entity that operates this process.
    entity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("org_entities.id"), nullable=True, index=True
    )
    # Explicit assets this process depends on (list of asset ids). Kept as JSON so
    # the link can be maintained without a join table or edits to the Asset model.
    asset_ids: Mapped[list] = mapped_column(JSON, default=list)
