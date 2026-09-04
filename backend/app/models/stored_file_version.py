"""Version history for stored files (evidence, checklist documents, contracts).

The content-versioning tables (PolicyVersion, FrameworkControlVersion, …) keep
the history of records the user edits in the app. This is their counterpart for
the files themselves: every uploaded file gets a row, so an auditor can see what
was attached to a control over time, retrieve an earlier version, and — this is
the part that used to be impossible — get back a file that was deleted.

Deleting evidence previously called ``unlink()`` on the file: the bytes were
gone, permanently and silently. For a GRC platform that is the wrong default.
Evidence is the thing an audit conclusion rests on, so a delete now retires the
version (``status="deleted"``) and leaves the bytes on disk to be restored or
inspected.

Rows are keyed by (entity_type, entity_id) rather than a foreign key, because
the history has to outlive the record it belonged to — the whole point is that
it still exists after the Evidence row is gone.
"""
from datetime import datetime

from sqlalchemy import String, Integer, Text, Index, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StoredFileVersion(Base):
    """One stored version of one file."""
    __tablename__ = "stored_file_versions"

    __table_args__ = (
        Index("ix_file_versions_entity", "tenant_id", "entity_type", "entity_id"),
        Index("ix_file_versions_parent", "tenant_id", "parent_type", "parent_id"),
        # Two uploads racing for the same parent must not both claim a version
        # number; the loser retries against the new tail.
        Index("ix_file_versions_seq", "parent_type", "parent_id", "version_number", unique=True),
        Index("ix_file_versions_purge", "status", "retired_at"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # The file record this row describes: "evidence" | "document" | "contract".
    # Deliberately a plain string, not a FK — these rows survive the deletion of
    # the record they describe, which is the entire point.
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # What the file is ATTACHED to — a control assessment, an assessment, a
    # vendor. This is what makes a history: every upload mints a brand-new
    # evidence/document/contract row with its own id, so numbering versions per
    # entity_id would give every file "version 1" forever and never supersede
    # anything. Versions belong to the thing files are attached to over time.
    parent_type: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    parent_id: Mapped[str] = mapped_column(String(36), nullable=False, default="", index=True)

    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    file_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Relative to UPLOADS_DIR, except contracts which store an absolute path
    # (see is_absolute_path) — kept as stored so the file can always be found.
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    is_absolute_path: Mapped[bool] = mapped_column(default=False)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # current    — the version the live record points at
    # superseded — replaced by a newer upload, bytes retained
    # deleted    — the owning record was deleted, bytes retained for recovery
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="current", index=True)

    uploaded_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # When this version stopped being current — the clock a retention policy
    # counts from. updated_at cannot serve: any later write moves it.
    retired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Exempt from every purge regardless of policy: a file under legal hold or
    # tied to an open audit must outlive retention.
    legal_hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
