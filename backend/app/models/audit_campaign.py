"""Audit campaigns — STB objectif 4, « créer, planifier et gérer les campagnes d'audit ».

The tender asks for campaigns, not just audits: a plan for a period ("Plan d'audit
2026"), with a cadence (annuelle, semestrielle, ponctuelle), inside which individual
engagements sit. Today `audits` is a flat list with a per-audit `recurrence`, so
there is nothing to answer « montrez-moi le plan d'audit annuel ».

An engagement points here through the audits.campaign_id column added by
scripts/migrate_add_stb_audit_columns.py. A campaign is deliberately NOT the owner
of the perimeter: each audit carries its own processus/entités/systèmes, because a
single campaign routinely spans several perimeters.

New table — created by create_all() on restart; no ALTER needed.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# « Possibilité de planification annuelle, semestrielle, ponctuelle » — the three
# the requirement names, plus quarterly, which every bank audit plan we have seen
# actually uses. `ponctuelle` is the one-off campaign.
CAMPAIGN_CADENCES = ("ponctuelle", "trimestrielle", "semestrielle", "annuelle")

CAMPAIGN_STATUSES = ("draft", "planned", "in_progress", "completed", "cancelled")


class AuditCampaign(Base):
    """A planned programme of audits for a period."""

    __tablename__ = "audit_campaigns"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    cadence: Mapped[str] = mapped_column(String(20), nullable=False, default="ponctuelle")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    # The period the campaign covers. Stored as ISO date strings to match the
    # convention already used by audits.planned_start / planned_end.
    period_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    period_end: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Who owns the plan (typically the head of internal audit).
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Set once the stakeholders have been told the plan exists, so the
    # notification check does not re-announce the same campaign every day.
    stakeholders_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
