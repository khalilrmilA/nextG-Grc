"""Custom Risk Matrix — configurable probability/impact scales.
Inspired by CISO Assistant: JSON-based, not hardcoded 5x5.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey, JSON, Boolean
from app.core.database import Base


class RiskMatrix(Base):
    """A reusable risk matrix configuration."""
    __tablename__ = "risk_matrices"

    tenant_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=True)  # null = global
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)

    # Matrix definition as JSON
    # Structure:
    # {
    #   "probability": {
    #     "count": 5,
    #     "labels": ["Very Low", "Low", "Medium", "High", "Very High"],
    #     "descriptions": ["<1% chance", "1-10%", "10-50%", "50-90%", ">90%"]
    #   },
    #   "impact": {
    #     "count": 5,
    #     "labels": ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"],
    #     "descriptions": ["<$10K", "$10K-$100K", "$100K-$1M", "$1M-$10M", ">$10M"]
    #   },
    #   "risk_levels": [
    #     {"name": "low", "color": "#22c55e", "min_score": 1, "max_score": 6},
    #     {"name": "medium", "color": "#eab308", "min_score": 7, "max_score": 12},
    #     {"name": "high", "color": "#f97316", "min_score": 13, "max_score": 18},
    #     {"name": "critical", "color": "#ef4444", "min_score": 19, "max_score": 25}
    #   ],
    #   "grid": [[1,2,3,4,5],[2,4,6,8,10],[3,6,9,12,15],[4,8,12,16,20],[5,10,15,20,25]]
    # }
    definition: Mapped[dict] = mapped_column(JSON, nullable=False)
