"""Scheduled reports — recurring PDF report generation + email delivery (Elite Pack)."""
import enum
from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, ForeignKey, JSON, DateTime, Integer, Enum as SAEnum

from app.core.database import Base


class ReportFrequency(str, enum.Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class ReportSchedule(Base):
    """A recurring delivery of one of the built-in PDF reports to a list of emails."""
    __tablename__ = "report_schedules"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # one of: executive | risk | compliance | vendor | audit
    report_type: Mapped[str] = mapped_column(String(50), nullable=False)
    frequency: Mapped[ReportFrequency] = mapped_column(
        SAEnum(ReportFrequency, values_callable=lambda x: [e.value for e in x]),
        nullable=False, default=ReportFrequency.WEEKLY,
    )
    recipients: Mapped[list] = mapped_column(JSON, default=list)  # list[str] of email addresses

    # Cadence knobs (all UTC).
    hour: Mapped[int] = mapped_column(Integer, default=7)          # hour-of-day to send
    day_of_week: Mapped[int] = mapped_column(Integer, default=0)   # 0=Mon .. 6=Sun (weekly)
    day_of_month: Mapped[int] = mapped_column(Integer, default=1)  # 1..28 (monthly, clamped)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Runtime bookkeeping — next_run_at doubles as the optimistic-claim token so the
    # two uvicorn workers (or a Celery beat) never double-send the same run.
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_status: Mapped[str | None] = mapped_column(String(255), nullable=True)
