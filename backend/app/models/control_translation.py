"""Requirement translations — STB, référentiel en français et en arabe.

Measured on the live database: 0 of 4 537 control titles contain a French accent
or an Arabic character, and no translation mechanism exists. The interface is
translated; the *content* is not — and for a Tunisian bank the requirements
themselves are what gets read.

Translations cannot be columns on framework_controls: built-in controls are shared
across tenants, and a translation is per-language, not per-row. get_framework_controls
resolves the caller's language through get_request_language and falls back to the
original text, so an untranslated framework behaves exactly as it does today.

New table — created by create_all() on restart.
"""
from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

SUPPORTED_LANGS = ("en", "fr", "ar")


class ControlTranslation(Base):
    """A requirement's title/description/guidance in one language."""

    __tablename__ = "control_translations"
    __table_args__ = (
        # One translation per (control, language). Without this, a re-run of the
        # seed script would silently double every row.
        UniqueConstraint("control_id", "lang", name="uq_control_translation_lang"),
    )

    control_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=False, index=True
    )
    lang: Mapped[str] = mapped_column(String(5), nullable=False)

    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    guidance: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Where the text came from: 'human', 'ai', or an importer's name. An auditor
    # is entitled to know a requirement was machine-translated.
    source: Mapped[str | None] = mapped_column(String(30), nullable=True)
