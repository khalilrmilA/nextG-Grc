"""Recommendations — STB objectif 7, « suivre l'état d'avancement des recommandations ».

Today a recommendation is a single free-text column on AuditFinding, so one constat
cannot carry several recommendations, none of them can have its own owner or due
date, and none can be closed independently. The tender treats recommendations as
the tracked object: « Affectation à un responsable avec dates d'échéance » and
« Tableau de bord des recommandations en attente, en cours, clôturées ».

AuditFinding.recommendation is kept and treated as a summary, so nothing existing
breaks; backfill_audit_recommendations.py lifts the legacy text into a first row.

New table — created by create_all() on restart.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# The three buckets the requirement names for the dashboard, plus the two
# terminal states an auditor actually needs.
RECOMMENDATION_STATUSES = ("pending", "in_progress", "closed", "rejected", "overdue")


class AuditRecommendation(Base):
    """One recommendation issued from an audit finding, tracked to closure."""

    __tablename__ = "audit_recommendations"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    audit_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=False, index=True
    )
    finding_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audit_findings.id"), nullable=True, index=True
    )

    ref_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Derived from the linked action items by the rollup, so the dashboard can
    # show real advancement rather than a status somebody remembered to set.
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    closure_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
