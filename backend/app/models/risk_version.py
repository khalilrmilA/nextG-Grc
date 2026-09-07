"""Point-in-time versions of a risk, and the lifecycle transitions between them.

Two requirement blocks land on the same mechanism:

* "Chaque transition d'étape est automatiquement enregistrée avec horodatage et
  utilisateur" — the lifecycle (identified → assessed → treatment planned →
  treated → closed) had the statuses but recorded nothing when one moved. The
  justification demanded for reopening a closed risk was validated and then
  discarded, so the one place the rule insists on a reason kept none.
* "Permet d'archiver automatiquement toutes les versions d'un risque… les
  anciennes versions sont accessibles uniquement en lecture seule… les écarts
  entre deux versions sont visualisables" — there was no per-risk history at
  all. ``risk_snapshots`` counts open risks by severity per day; it says nothing
  about how any individual risk changed.

A version records the state *before* a change, so version N and the live row
bracket the Nth edit. Read-only by construction: nothing in the API updates or
deletes a row in this table.

``transition_from`` / ``transition_to`` are denormalised out of the snapshot so
a lifecycle history can be read without decoding every version body — the
question "when was this risk closed, and by whom" should not require a diff.
"""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RiskVersion(Base):
    __tablename__ = "risk_versions"

    __table_args__ = (
        Index("ix_risk_version_risk", "tenant_id", "risk_id", "version_number"),
    )

    # Not a ForeignKey: the history has to outlive the risk it describes.
    risk_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Denormalised so a deleted risk stays identifiable in its own history.
    risk_title: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Set only when this version records a lifecycle move.
    transition_from: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    transition_to: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)

    # Why. Carries the mandatory reopen justification when a closed risk is
    # reopened, and whatever reason the caller gave otherwise.
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    author_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    author_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Microsecond precision: SQLite's CURRENT_TIMESTAMP resolves to the second,
    # and two edits in quick succession would tie, making "newest first"
    # ambiguous — the same reason the other history tables override it.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
