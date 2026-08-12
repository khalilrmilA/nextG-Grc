"""Saved custom-report templates (Elite Pack advanced reporting).

A template captures a dataset + the columns and filters to render, so a report
can be re-run or scheduled. New table — created by create_all() on restart.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, JSON, ForeignKey
from app.core.database import Base


class ReportTemplate(Base):
    __tablename__ = "report_templates"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    dataset: Mapped[str] = mapped_column(String(50), nullable=False)
    columns: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    filters: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
