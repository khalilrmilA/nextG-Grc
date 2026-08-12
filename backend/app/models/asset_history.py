"""Asset CIA valuation history (Elite Pack, RFP module 2).

One row per change to an asset's C/I/A valuation, preserving the old and new
grids with author + timestamp for full traceability.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, JSON, ForeignKey, Text
from app.core.database import Base


class AssetValuationHistory(Base):
    __tablename__ = "asset_valuation_history"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False, index=True)
    changed_by_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    old_cia: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_cia: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
