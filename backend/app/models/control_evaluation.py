"""Control effectiveness evaluation (Elite Pack, RFP module 6).

Scores an applied control on the RFP's five criteria and derives a performance
level. Each criterion is 0-2 (0=absent, 1=partial, 2=full); the sum (0-10) maps
to performant / moyennement_performant / non_performant.
"""
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import DateTime, String, Integer, ForeignKey, Text
from app.core.database import Base

PERFORMANT = "performant"
MOYENNEMENT = "moyennement_performant"
NON_PERFORMANT = "non_performant"


def derive_performance_level(total: int) -> str:
    """Map the 0-10 criteria sum to a performance level."""
    if total >= 8:
        return PERFORMANT
    if total >= 5:
        return MOYENNEMENT
    return NON_PERFORMANT


class ControlEvaluation(Base):
    __tablename__ = "control_evaluations"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    applied_control_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("applied_controls.id"), nullable=False, index=True
    )
    evaluated_by_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # RFP 5 criteria, each 0-2
    formalisme: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    type_controle: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    timing: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tracabilite: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    quatre_yeux: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    performance_level: Mapped[str] = mapped_column(String(30), nullable=False, default=NON_PERFORMANT)
    next_evaluation_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
