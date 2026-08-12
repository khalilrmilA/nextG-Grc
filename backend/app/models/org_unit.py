"""Organizational entities & business processes (Elite Pack, RFP module 2).

Backbone for the asset cartography: assets link to the business processes they
support and the organizational entities that own them. Both are tenant-scoped.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, ForeignKey, Text
from app.core.database import Base


class OrgEntity(Base):
    __tablename__ = "org_entities"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("org_entities.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class BusinessProcess(Base):
    __tablename__ = "business_processes"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("org_entities.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
