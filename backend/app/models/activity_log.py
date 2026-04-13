"""Activity Log model — tracks all user actions for audit trail."""
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, ForeignKey, JSON
from app.core.database import Base


class ActivityLog(Base):
    """Immutable audit trail of user actions."""
    __tablename__ = "activity_logs"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # create, update, delete, login, export, import
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # risk, vendor, audit, policy, etc.
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    entity_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # Changed fields, old/new values
    ip_address: Mapped[str | None] = mapped_column(String(50), nullable=True)
