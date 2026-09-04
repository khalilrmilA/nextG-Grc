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
from pathlib import Path

# Status values returned by verify_file().
OK = "ok"                    # digest recorded and matches the bytes on disk
MODIFIED = "modified"        # digest recorded and does NOT match — tampering or corruption
MISSING = "missing"          # a path is recorded but nothing is there any more
UNREADABLE = "unreadable"    # the file is there but cannot be read (permissions, I/O error)
UNRECORDED = "unrecorded"    # stored before checksums existed; nothing to compare against

_CHUNK = 1024 * 1024  # 1 MiB


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
