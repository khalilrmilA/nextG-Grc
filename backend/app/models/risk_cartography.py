from sqlalchemy import String, Text, ForeignKey, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class RiskCartography(Base):
    """Tenant-owned, independently-configured risk cartography saved by the CISO."""
    __tablename__ = "risk_cartographies"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    # Independent grid configuration — not tied to the global risk matrix
    # {
    #   "grid_rows": 5,
    #   "grid_cols": 5,
    #   "likelihood_labels": ["Rare", "Unlikely", "Possible", "Likely", "Almost Certain"],
    #   "impact_labels": ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"],
    #   "risk_levels": [
    #     {"name": "Low",      "color": "#22c55e", "min_score": 1,  "max_score": 5 },
    #     {"name": "Medium",   "color": "#eab308", "min_score": 6,  "max_score": 12},
    #     {"name": "High",     "color": "#f97316", "min_score": 13, "max_score": 18},
    #     {"name": "Critical", "color": "#ef4444", "min_score": 19, "max_score": 25}
    #   ]
    # }
    definition: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Manual overrides: { "risk_id": {"likelihood": X, "impact": Y} }
    # Risks absent from this dict use their native register values
    risk_positions: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
