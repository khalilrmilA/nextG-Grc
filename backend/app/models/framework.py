"""
Framework models — the core of the GRC platform.
Frameworks are defined as YAML files and loaded into the database.
A single control can map to requirements across multiple frameworks (cross-walk).
"""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON, Integer
from app.core.database import Base


class FrameworkStatus(str, enum.Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    DRAFT = "draft"


class ControlCategory(str, enum.Enum):
    IDENTIFY = "identify"
    PROTECT = "protect"
    DETECT = "detect"
    RESPOND = "respond"
    RECOVER = "recover"
    GOVERNANCE = "governance"
    ORGANIZATIONAL = "organizational"
    TECHNICAL = "technical"
    PHYSICAL = "physical"


class Framework(Base):
    """A compliance/regulatory framework (e.g. ISO 27001:2022, NIST CSF 2.0)."""
    __tablename__ = "frameworks"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    short_name: Mapped[str] = mapped_column(String(50), nullable=False)  # "ISO27001"
    version: Mapped[str] = mapped_column(String(50), nullable=False)    # "2022"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    issuing_body: Mapped[str | None] = mapped_column(String(255), nullable=True)
    applicable_regions: Mapped[list] = mapped_column(JSON, default=list)  # ["global", "EU"]
    applicable_industries: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[FrameworkStatus] = mapped_column(
        SAEnum(FrameworkStatus), default=FrameworkStatus.ACTIVE
    )
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=True)  # False = custom tenant framework

    # Tenant-specific custom frameworks
    tenant_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=True, index=True
    )

    # Relationships
    controls: Mapped[list["FrameworkControl"]] = relationship(
        "FrameworkControl", back_populates="framework"
    )


class FrameworkControl(Base):
    """
    A control within a framework (e.g. ISO 27001 A.8.1, NIST CSF PR.AC-1).
    Controls are the atomic unit of compliance work.
    """
    __tablename__ = "framework_controls"

    framework_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("frameworks.id"), nullable=False, index=True
    )
    control_id: Mapped[str] = mapped_column(String(50), nullable=False)  # "A.8.1", "PR.AC-1"
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    guidance: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[ControlCategory | None] = mapped_column(
        SAEnum(ControlCategory), nullable=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # Cross-framework mapping: list of {framework_short_name, control_id} dicts
    # e.g. [{"framework": "NIST_CSF", "control": "PR.AC-1"}, ...]
    mapped_controls: Mapped[list] = mapped_column(JSON, default=list)

    # Tags for filtering and search
    tags: Mapped[list] = mapped_column(JSON, default=list)

    # Relationships
    framework: Mapped["Framework"] = relationship("Framework", back_populates="controls")
    requirements: Mapped[list["ControlRequirement"]] = relationship(
        "ControlRequirement", back_populates="control"
    )
    assessments: Mapped[list["ControlAssessment"]] = relationship(
        "ControlAssessment", back_populates="control"
    )


class ControlRequirement(Base):
    """
    Specific implementation requirements for a control.
    A control may have multiple requirements (e.g. 'must', 'should', 'may').
    """
    __tablename__ = "control_requirements"

    control_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=False
    )
    requirement_text: Mapped[str] = mapped_column(Text, nullable=False)
    requirement_level: Mapped[str] = mapped_column(
        String(20), default="must"  # "must", "should", "may"
    )

    control: Mapped["FrameworkControl"] = relationship(
        "FrameworkControl", back_populates="requirements"
    )
