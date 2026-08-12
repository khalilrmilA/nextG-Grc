"""Risk-scenario version snapshots (Elite Pack) — RFP module 5.

A point-in-time snapshot of a scenario's key fields, enabling a change timeline
and version-to-version diffs. New table — created by create_all() on restart.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, JSON, ForeignKey
from app.core.database import Base


class RiskScenarioVersion(Base):
    __tablename__ = "risk_scenario_versions"

    scenario_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("risk_scenarios.id"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    change_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    author_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
