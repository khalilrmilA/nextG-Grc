"""Risk-treatment version snapshots (Elite Pack) — RFP module 8, M8.2 gap fix.

Mirrors RiskScenarioVersion (app/models/scenario_version.py): a point-in-time
snapshot of a treatment plan's fields, archived whenever the plan is
"superseded" by a new submission via POST /risk-treatment/{risk_id}/supersede
(app/api/v1/endpoints/risk_treatment.py). RiskTreatment.risk_id stays
unique=True (one live plan per risk, per the deferred-constraint decision
documented on that model) — this table is what gives that one live row a
version history instead of silently overwriting the prior plan's values.
New table — created by create_all() on restart.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, JSON, ForeignKey, Text
from app.core.database import Base


class RiskTreatmentVersion(Base):
    __tablename__ = "risk_treatment_versions"

    risk_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("risks.id"), nullable=False, index=True
    )
    treatment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("risk_treatments.id"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
