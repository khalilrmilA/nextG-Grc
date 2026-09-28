"""Machine translations of system content (threat catalogue and feeds, threat
watch, regulatory feed items, built-in frameworks and their requirements, CVE
descriptions on demand), cached. See app.services.translation_sources for the
registry and app.services.translation_worker for the background loop.

History: this started with the threat feeds only.

The threat feeds (SANS ISC, CISA KEV, opensourcemalware.com) are English-only,
so a French- or Arabic-speaking user saw every auto-imported threat card in
English. The interface is translated; this content is not, and it cannot be
translated in the locale files because it arrives at runtime.

One row per (entity, language, field). ``source_hash`` is the SHA-256 of the
English text the row was translated from: when the source changes (a cleanup
pass, an edit) the hash no longer matches and the text is translated again.
Reads go by (source_hash, lang), so the same feed item filed in every tenant's
watch is translated once, not once per tenant.

Only machine-translated feed text lives here — tenant-authored content is never
machine-translated. New table — created by create_all() on restart (and by
scripts/translate_threat_feed_items.py when run before a restart).
"""
from sqlalchemy import Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ContentTranslation(Base):
    __tablename__ = "content_translations"
    __table_args__ = (
        # The two uvicorn workers and the feed scheduler can translate the same
        # entity at the same time; the constraint, not a pre-read, settles it.
        UniqueConstraint("entity_type", "entity_id", "lang", "field", name="uq_content_translation"),
        Index("ix_content_translation_hash_lang", "source_hash", "lang"),
    )

    # "threat" | "threat_watch" | "regulatory_update" | "framework" | "framework_control" | "cve"
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    lang: Mapped[str] = mapped_column(String(5), nullable=False)           # target: "en" | "fr" | "ar"
    field: Mapped[str] = mapped_column(String(40), nullable=False)         # "name" | "description" | ...
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Which model produced it — an auditor is entitled to know text was machine-translated.
    engine: Mapped[str | None] = mapped_column(String(80), nullable=True)


class ContentTranslationRequest(Base):
    """On-demand translation queue — for content too large to translate in bulk.

    The CVE knowledge base holds ~20 000 descriptions; translating all of them
    into two languages would occupy the model for days for entries nobody reads.
    Instead a CVE page served in fr/ar enqueues the entries it showed that have
    no translation yet (bounded per request), and the background worker
    (app.services.translation_worker) serves this queue before anything else.
    The unique constraint deduplicates concurrent requests from both workers.
    New table — created by create_all() on restart.
    """
    __tablename__ = "content_translation_requests"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "lang", name="uq_content_translation_request"),
    )

    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    lang: Mapped[str] = mapped_column(String(5), nullable=False)
