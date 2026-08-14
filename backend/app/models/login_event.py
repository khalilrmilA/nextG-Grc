"""Login journaling — persists every authentication attempt (success + failure).

Distinct from ActivityLog (which the middleware skips for /auth/login): this records
failures that have no authenticated context (bad password, locked, unknown user) so a
security reviewer can see the full authentication picture, not just successful writes.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean
from app.core.database import Base


class LoginEvent(Base):
    """A single authentication attempt."""
    __tablename__ = "login_events"

    # tenant_id / user_id are nullable because a failed attempt may not resolve to a user.
    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(String(50), nullable=True)  # ok|bad_password|locked|no_user|disabled
    ip_address: Mapped[str | None] = mapped_column(String(50), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
