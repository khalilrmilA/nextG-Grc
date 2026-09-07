"""Threat watch — what the feeds bring in, before it is anything else.

The feeds were writing straight into the threat register, and the register is
not what they produce. Measured on the live register: of 4,515 items awaiting a
security lead's validation, 45% were malicious package URLs, 31% were SANS
diary entries (including podcast episodes) and 20% were CVE advisories. Nobody
can write "origine probable, objectifs, vecteurs d'attaque, facteurs
aggravants" for a podcast episode.

The requirement asks for the register to be *fed* by a continuous watch, not to
*be* the watch. A threat register holds threat types — "fraude interne aux
virements", "indisponibilité du datacenter" — perhaps a few dozen, each with a
profile. A genuinely new threat type appears a few times a year; the feeds
produce a few hundred items a week.

So the feeds land here instead, and each item goes where it belongs:

* a CVE advisory enriches the CVE knowledge base (CISA KEV means *actively
  exploited*, which is the single most actionable thing that feed carries);
* a malicious package is supply-chain intelligence to read, not a threat type;
* a daily diary entry is news.

Anything that genuinely describes a new kind of threat can be promoted into the
register from here, which creates an ordinary pending threat and leaves a
pointer back to the item it came from.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# What a feed item actually is. The source tells us reliably, so this is a
# classification rather than a guess.
WATCH_KINDS = (
    "cve",             # a specific vulnerability advisory (CISA KEV)
    "malicious_package",  # a poisoned package or repository (supply chain)
    "advisory",        # a vendor or CERT advisory
    "news",            # a diary entry, podcast, digest — read it, do not file it
)

WATCH_STATUSES = ("new", "reviewed", "dismissed", "promoted")


class ThreatWatchItem(Base):
    __tablename__ = "threat_watch_items"

    __table_args__ = (
        # One item per tenant per source reference. The feed scheduler runs in
        # both uvicorn workers, so the same de-duplication problem that hit the
        # register applies here — solved the same way, in the database.
        Index("ix_watch_tenant_source_ref", "tenant_id", "source", "ref", unique=True),
        Index("ix_watch_tenant_status", "tenant_id", "status", "published_at"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="news", index=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False)
    # The feed's own identifier where it has one (a CVE id), otherwise derived
    # from the item so it means the same thing on every run.
    ref: Mapped[str] = mapped_column(String(80), nullable=False)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # new | reviewed | dismissed | promoted
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new", index=True)
    reviewed_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Set when the item was judged to describe a genuinely new kind of threat
    # and was promoted into the register.
    promoted_threat_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Whatever else the feed gave us, kept rather than discarded so a later
    # classifier can do better without re-fetching.
    extra: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
