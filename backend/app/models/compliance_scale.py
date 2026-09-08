"""Configurable conformity scales — STB objectif 2, « grille d'évaluation personnalisable ».

The tender names three levels — conforme, partiellement conforme, non conforme —
but requires the grid itself to be customisable, because banks routinely add
« non applicable », « à confirmer » or a five-level maturity scale. Today
ControlStatus is a hard-coded Python enum and the score formula
(implemented + 0.5 × partial) is hard-coded to match it.

Modelled on risk_matrix.py, which already solves exactly this problem for risk:
the definition is JSON, the built-in row is shared, and a tenant may own its own.

An assessment points at its scale through compliance_assessments.scale_id; when
null, the legacy enum and formula apply unchanged, so all 51 existing assessments
keep their scores.

New table — created by create_all() on restart.
"""
from sqlalchemy import JSON, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# The default the tender describes, seeded by seed_default_compliance_scale.py.
# `weight` drives the score: sum(weight) / count(scored), so a scale with five
# maturity levels scores correctly without touching the formula.
# `counts_as_gap` decides whether reaching this level opens a ComplianceGap —
# that is the hook « génération automatique de plans d'action » hangs on.
DEFAULT_SCALE_LEVELS = [
    {"key": "conforme", "label_fr": "Conforme", "label_en": "Compliant",
     "label_ar": "مطابق", "color": "#0ca30c", "weight": 1.0,
     "counts_as_gap": False, "legacy_status": "implemented"},
    {"key": "partiellement_conforme", "label_fr": "Partiellement conforme",
     "label_en": "Partially compliant", "label_ar": "مطابق جزئيًا",
     "color": "#fab219", "weight": 0.5,
     "counts_as_gap": True, "legacy_status": "partially_implemented"},
    {"key": "non_conforme", "label_fr": "Non conforme", "label_en": "Non-compliant",
     "label_ar": "غير مطابق", "color": "#d03b3b", "weight": 0.0,
     "counts_as_gap": True, "legacy_status": "not_implemented"},
    {"key": "non_applicable", "label_fr": "Non applicable", "label_en": "Not applicable",
     "label_ar": "لا ينطبق", "color": "#77807f", "weight": None,
     "counts_as_gap": False, "legacy_status": "not_applicable"},
]


class ComplianceScale(Base):
    """A reusable conformity scale an assessment is graded on."""

    __tablename__ = "compliance_scales"

    # null = built-in, shared across tenants and read-only, exactly like
    # RiskMatrix and the built-in frameworks.
    tenant_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # List of level dicts, shaped like DEFAULT_SCALE_LEVELS above.
    levels: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
