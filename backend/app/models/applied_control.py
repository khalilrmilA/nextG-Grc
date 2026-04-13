"""Applied Controls — actionable controls with cost, effort, progress, and tracking.
Inspired by CISO Assistant: controls that are actually implemented, not just references.
"""
import enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey, JSON, Float, Integer
from app.core.database import Base


class ControlStatus(str, enum.Enum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    IMPLEMENTED = "implemented"
    NOT_APPLICABLE = "not_applicable"
    DEPRECATED = "deprecated"

class ControlEffort(str, enum.Enum):
    VERY_LOW = "very_low"    # < 1 day
    LOW = "low"              # 1-3 days
    MEDIUM = "medium"        # 1-2 weeks
    HIGH = "high"            # 2-4 weeks
    VERY_HIGH = "very_high"  # > 1 month

class CSFFunction(str, enum.Enum):
    GOVERN = "govern"
    IDENTIFY = "identify"
    PROTECT = "protect"
    DETECT = "detect"
    RESPOND = "respond"
    RECOVER = "recover"


class AppliedControl(Base):
    """An actual control implemented in the organization."""
    __tablename__ = "applied_controls"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    # Identity
    ref_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    csf_function: Mapped[str | None] = mapped_column(String(20), nullable=True)  # NIST CSF function

    # Implementation tracking
    status: Mapped[str] = mapped_column(String(50), default=ControlStatus.PLANNED.value)
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0-100 percentage
    eta: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Expected completion
    expiration: Mapped[str | None] = mapped_column(String(20), nullable=True)  # When control expires/needs renewal

    # Cost & effort
    effort: Mapped[str | None] = mapped_column(String(20), nullable=True)  # ControlEffort value
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)  # Implementation cost ($)
    recurring_cost: Mapped[float | None] = mapped_column(Float, nullable=True)  # Annual recurring cost ($)

    # Links
    reference_control_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # Framework control it implements
    framework_control_ids: Mapped[list] = mapped_column(JSON, default=list)  # Multiple framework controls
    evidence_ids: Mapped[list] = mapped_column(JSON, default=list)  # Evidence proving this control
    risk_scenario_ids: Mapped[list] = mapped_column(JSON, default=list)  # Scenarios this control mitigates
    vulnerability_ids: Mapped[list] = mapped_column(JSON, default=list)  # Vulnerabilities this control fixes

    # Ownership
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)  # URL to external tool/doc
    tags: Mapped[list] = mapped_column(JSON, default=list)
