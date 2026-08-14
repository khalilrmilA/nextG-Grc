"""User sessions — one row per successful login, revocable for 'Active Sessions'.

The access/refresh tokens carry the session id as a `sid` claim; get_current_user
rejects a token whose session has been revoked (fail-open, so it can never lock users
out). Distinct from login_events (immutable history) — this is live, revocable state.
"""
from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, ForeignKey

from app.core.database import Base


class UserSession(Base):
    __tablename__ = "user_sessions"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    device: Mapped[str | None] = mapped_column(String(255), nullable=True)      # e.g. "Chrome on Windows"
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
