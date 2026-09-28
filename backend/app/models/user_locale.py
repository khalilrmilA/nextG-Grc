"""Per-user interface language, as last seen by the server.

The SPA keeps the chosen language (en/fr/ar) in the browser and sends it on
every request as ``Accept-Language``; nothing server-side remembered it. That is
enough for anything rendered inside a request, but not for the text the server
writes when nobody is asking — a relance e-mail at 07:00, a scheduled report —
which then fell back to the tenant locale or English even for a user who works
in Arabic all day.

A separate table rather than a column on ``users``: new tables are created by
``create_all()`` at startup, whereas a new column needs a hand-written ALTER on
the live database. One row per user; written by
``app.services.user_language.remember_request_language`` only when the language
actually changes.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserLocale(Base):
    __tablename__ = "user_locales"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    # en | fr | ar — always normalised through ai_locale.normalize_language.
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
