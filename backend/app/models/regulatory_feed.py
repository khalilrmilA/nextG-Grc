"""Tenant-configurable regulatory sources — STB objectif 1, « suivi des modifications ».

Regulatory watch today reads four hard-coded sources, all US/UK. A Tunisian bank
watches the BCT, the JORT and the ANSI, and cannot add them. The requirement is
« Suivi des modifications réglementaires avec historique », which presupposes the
organisation chooses what it is watching.

RegulatoryUpdateVersion gives the « historique » half: a snapshot per modification,
so an update's wording can be compared over time rather than silently overwritten.

New tables — created by create_all() on restart.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

FEED_KINDS = ("rss", "atom", "json", "manual")


class RegulatoryFeed(Base):
    """A source of regulatory updates the organisation chose to watch."""

    __tablename__ = "regulatory_feeds"

    # null = built-in source offered to every tenant.
    tenant_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="rss")

    # ISO country / regulator hints, so an update can be matched to the
    # frameworks the tenant declared applicable.
    jurisdiction: Mapped[str | None] = mapped_column(String(60), nullable=True)
    issuing_body: Mapped[str | None] = mapped_column(String(200), nullable=True)
    language: Mapped[str | None] = mapped_column(String(5), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    last_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )


class RegulatoryUpdateVersion(Base):
    """An immutable snapshot of a regulatory update, taken before each change."""

    __tablename__ = "regulatory_update_versions"

    update_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("regulatory_updates.id"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # The whole row as it stood, rather than named columns: the update schema has
    # changed twice already, and a history that cannot represent old shapes is
    # worse than none. Same approach as RiskVersion.snapshot.
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    author_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
