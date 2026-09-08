"""Customisable audit grids — STB objectif 5, « une grille d'évaluation personnalisable ».

Today the auditor's checklist is always the controls of the audit's framework, on a
fixed conformity enum. The tender requires the *grid* itself to be configurable:
its rows (what is checked) and its scale (what verdicts may be given).

Three tables, mirroring how risk_matrix.py models a configurable scale:
  AuditGrid          the grid, owning its verdict scale as JSON
  AuditGridItem      one row to be assessed
  AuditGridResponse  the auditor's verdict on one row, for one audit

An audit points at its grid through audits.grid_id. When it is null the checklist
falls back to today's framework-controls behaviour, so existing engagements keep
working untouched.

New tables — created by create_all() on restart.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# The default scale is exactly the three levels the tender names for compliance
# evaluation, plus « non applicable », which every real grid needs.
DEFAULT_GRID_LEVELS = [
    {"key": "conforme", "label_fr": "Conforme", "label_en": "Compliant",
     "label_ar": "مطابق", "color": "#0ca30c", "weight": 1.0, "is_gap": False},
    {"key": "partiellement_conforme", "label_fr": "Partiellement conforme",
     "label_en": "Partially compliant", "label_ar": "مطابق جزئيًا",
     "color": "#fab219", "weight": 0.5, "is_gap": True},
    {"key": "non_conforme", "label_fr": "Non conforme", "label_en": "Non-compliant",
     "label_ar": "غير مطابق", "color": "#d03b3b", "weight": 0.0, "is_gap": True},
    {"key": "non_applicable", "label_fr": "Non applicable", "label_en": "Not applicable",
     "label_ar": "لا ينطبق", "color": "#77807f", "weight": None, "is_gap": False},
]


class AuditGrid(Base):
    """A reusable evaluation grid an auditor works through."""

    __tablename__ = "audit_grids"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Where the rows came from, when the grid was seeded from a framework rather
    # than typed by hand. Kept for provenance; the items are copies, so editing
    # the grid never mutates the shared built-in framework.
    source_framework_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("frameworks.id"), nullable=True
    )

    # The verdict scale. Same shape as DEFAULT_GRID_LEVELS above; a null value
    # means "use the default", so a grid is usable the moment it is created.
    levels: Mapped[list | None] = mapped_column(JSON, nullable=True)

    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )


class AuditGridItem(Base):
    """One line of a grid: the question or requirement the auditor assesses."""

    __tablename__ = "audit_grid_items"

    grid_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audit_grids.id"), nullable=False, index=True
    )
    ref_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    guidance: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Grouping within the grid (« domaine »), free text so a grid can follow the
    # client's own structure rather than a framework's categories.
    section: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Set when the row was copied from a framework control, so a verdict can be
    # carried back to the compliance assessment.
    control_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=True
    )
    is_mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class AuditGridResponse(Base):
    """The auditor's verdict on one grid item, for one audit."""

    __tablename__ = "audit_grid_responses"

    audit_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=False, index=True
    )
    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audit_grid_items.id"), nullable=False, index=True
    )

    # A key from the grid's `levels`, validated server-side against that grid
    # rather than against a hard-coded enum — that is what makes the scale
    # genuinely personnalisable.
    verdict: Mapped[str | None] = mapped_column(String(40), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    answered_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    answered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
