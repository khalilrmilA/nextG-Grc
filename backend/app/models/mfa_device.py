"""TOTP multi-factor authentication device (Elite Pack).

One row per user holding their TOTP shared secret. ``confirmed`` flips true only
after the user verifies a code from their authenticator during enrollment.
"""
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import DateTime, String, Boolean, ForeignKey
from app.core.database import Base


class MfaDevice(Base):
    __tablename__ = "mfa_devices"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True, unique=True
    )
    secret: Mapped[str] = mapped_column(String(64), nullable=False)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
