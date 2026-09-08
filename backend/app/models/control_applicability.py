"""Per-organisation requirement applicability — STB objectif 1, « et applicabilité ».

Applicability today exists only as an assessment verdict (ControlStatus.NOT_APPLICABLE),
which means it is decided again inside every assessment and cannot be stated once for
the organisation. The tender classes applicability alongside source, domaine and type:
a property of the requirement *as it applies to this organisation*, and — because
objectif 2 evaluates « des processus, départements ou systèmes » — optionally scoped
to one of those.

It cannot be a column on framework_controls: those rows are built-in and shared
across all tenants, so one bank's scoping decision would leak to every other.

New table — created by create_all() on restart.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

APPLICABILITY_VALUES = ("applicable", "not_applicable", "partially_applicable")


class ControlApplicability(Base):
    """Whether a requirement applies to this organisation, and on what perimeter."""

    __tablename__ = "control_applicability"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    control_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=False, index=True
    )

    # Null on both = the organisation-wide statement. Set one to scope the
    # decision to a département or a processus.
    org_entity_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("org_entities.id"), nullable=True
    )
    business_process_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("business_processes.id"), nullable=True
    )

    applicability: Mapped[str] = mapped_column(
        String(30), nullable=False, default="applicable"
    )
    # An auditor will ask why a requirement was excluded, so a non-applicable
    # decision is refused without one at the endpoint.
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    decided_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Applicability is a judgement that ages; a bank re-confirms it periodically.
    review_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
