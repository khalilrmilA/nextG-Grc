"""CVE knowledge base (Elite Pack, RFP module 3).

CveEntry is a platform-global catalog synced from NVD. CveAnnotation holds
per-tenant triage (pertinent / non_pertinent / to_watch) + notes + asset links.
"""
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import DateTime, String, Float, Text, JSON, ForeignKey
from app.core.database import Base

RELEVANCE_VALUES = ("pertinent", "non_pertinent", "to_watch")


class CveEntry(Base):
    __tablename__ = "cve_entries"

    cve_id: Mapped[str] = mapped_column(String(30), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cvss_score: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    cvss_vector: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cwe_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_modified: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="NVD")


class CveAnnotation(Base):
    __tablename__ = "cve_annotations"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    cve_id: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    relevance: Mapped[str] = mapped_column(String(20), nullable=False, default="to_watch")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    linked_asset_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
