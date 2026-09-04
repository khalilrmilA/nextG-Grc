"""Cryptographic integrity for stored files.

The activity log is already tamper-evident (see ``activity_chain.py``), but the
files it refers to were not: evidence, contracts and other uploads were written
to disk and only ever identified by path, so nothing could show that the PDF an
auditor downloads today is byte-for-byte the one that was uploaded. Anyone with
filesystem access — or a bad restore, a truncated write, a sync tool — could
change it invisibly.

This records a SHA-256 at upload and re-checks it on read, which is what
"non-altération des données à toutes les étapes du traitement" and "conformité
des données reçues par rapport aux données émises" ask for: the digest is taken
from the exact bytes received, and every later read is compared against it.

Digests are computed by streaming, so verifying a large file (or sweeping a
whole tenant's uploads) never loads one into memory.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

# Status values returned by verify_file().
OK = "ok"                    # digest recorded and matches the bytes on disk
MODIFIED = "modified"        # digest recorded and does NOT match — tampering or corruption
MISSING = "missing"          # a path is recorded but nothing is there any more
UNREADABLE = "unreadable"    # the file is there but cannot be read (permissions, I/O error)
UNRECORDED = "unrecorded"    # stored before checksums existed; nothing to compare against

_CHUNK = 1024 * 1024  # 1 MiB


def _utcnow() -> datetime:
    """Naive UTC, matching how the rest of the app stores timestamps."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def sha256_bytes(data: bytes) -> str:
    """Digest of an in-memory upload, taken from the bytes actually received."""
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path) -> str | None:
    """Digest of a file on disk, streamed. None when it can't be read."""
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            while chunk := handle.read(_CHUNK):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def verify_file(path: str | Path, expected_sha256: str | None) -> tuple[str, str | None]:
    """Compare a stored file against its recorded digest.

    Returns ``(status, actual_digest)``. A file with no recorded digest is
    reported as :data:`UNRECORDED` rather than as a failure — records written
    before checksums existed are not evidence of tampering, and conflating the
    two would make an integrity report cry wolf on every legacy row.

    A file that exists but cannot be read is :data:`UNREADABLE`, kept distinct
    from :data:`MISSING`: "someone deleted the evidence" and "the service
    account lost read permission" need very different responses, and reporting
    a permissions fault as a deletion sends an administrator hunting for the
    wrong problem.
    """
    p = Path(path)
    if not p.is_file():
        return MISSING, None
    actual = sha256_file(p)
    if actual is None:
        return UNREADABLE, None
    if not expected_sha256:
        return UNRECORDED, actual
    return (OK if actual == expected_sha256 else MODIFIED), actual


# ── Version history ──────────────────────────────────────────────────────────
# Deleting evidence used to unlink the file, so the bytes an audit conclusion
# rested on were gone permanently and silently. These helpers keep every
# version of every stored file, so an earlier one can be retrieved and a
# deleted one recovered. See app/models/stored_file_version.py.

EVIDENCE = "evidence"
DOCUMENT = "document"
CONTRACT = "contract"

CURRENT = "current"
SUPERSEDED = "superseded"
DELETED = "deleted"


async def record_version(
    db: AsyncSession,
    *,
    tenant_id: str,
    entity_type: str,
    entity_id: str,
    parent_type: str,
    parent_id: str,
    file_path: str,
    file_name: str | None = None,
    file_sha256: str | None = None,
    file_size_bytes: int | None = None,
    content_type: str | None = None,
    uploaded_by_id: str | None = None,
    is_absolute_path: bool = False,
    note: str | None = None,
):
    """Record a newly stored file as the current version for its parent.

    Versions are numbered per PARENT (the control assessment, assessment or
    vendor the file hangs off), not per file record. Every upload mints a fresh
    evidence/document/contract row with a new id, so numbering per file id
    would make everything "version 1" forever and supersede nothing — the
    history has to belong to the thing files are attached to over time.

    The previous current version is marked superseded rather than removed: its
    bytes stay on disk, which is what makes "show me what was attached before"
    answerable. The caller commits.
    """
    from app.models.stored_file_version import StoredFileVersion

    next_number = (await db.execute(
        select(func.coalesce(func.max(StoredFileVersion.version_number), 0) + 1)
        .where(
            StoredFileVersion.parent_type == parent_type,
            StoredFileVersion.parent_id == parent_id,
        )
    )).scalar_one()

    await db.execute(
        update(StoredFileVersion)
        .where(
            StoredFileVersion.parent_type == parent_type,
            StoredFileVersion.parent_id == parent_id,
            StoredFileVersion.status == CURRENT,
        )
        .values(status=SUPERSEDED, retired_at=_utcnow())
    )

    version = StoredFileVersion(
        tenant_id=tenant_id,
        entity_type=entity_type,
        entity_id=entity_id,
        parent_type=parent_type,
        parent_id=parent_id,
        version_number=next_number,
        file_name=file_name,
        file_path=file_path,
        is_absolute_path=is_absolute_path,
        file_sha256=file_sha256,
        file_size_bytes=file_size_bytes,
        content_type=content_type,
        uploaded_by_id=uploaded_by_id,
        status=CURRENT,
        note=note,
    )
    db.add(version)
    return version


async def retire_versions(
    db: AsyncSession, *, entity_type: str, entity_id: str, note: str | None = None
) -> int:
    """Mark an entity's file versions deleted, keeping the bytes on disk.

    Called instead of unlinking when the owning record is deleted, so the file
    remains recoverable. Returns how many versions were retired.
    """
    from app.models.stored_file_version import StoredFileVersion

    rows = (await db.execute(
        select(StoredFileVersion).where(
            StoredFileVersion.entity_type == entity_type,
            StoredFileVersion.entity_id == entity_id,
            StoredFileVersion.status != DELETED,
        )
    )).scalars().all()
    for row in rows:
        row.status = DELETED
        if row.retired_at is None:
            row.retired_at = _utcnow()
        if note:
            # Append, never overwrite: the original note ("Uploaded via share
            # link") is part of the provenance this table exists to preserve.
            row.note = f"{row.note} | {note}" if row.note else note
    return len(rows)
