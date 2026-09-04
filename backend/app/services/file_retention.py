"""Retention and purge for stored files.

Making deletes recoverable (see ``file_integrity.py``) means nothing ever
removes bytes, so without this the disk only grows and there is no answer to
"how long do you keep deleted evidence?". This is the other half: a policy that
eventually reclaims retired files, and a purge that cannot destroy a live one.

**Purging is off by default** (``FILE_RETENTION_ENABLED``). This code deletes
real client evidence; it should start only when an operator has looked at the
dry run and decided the policy is right.

Two things here are correctness conditions rather than refinements:

*"superseded" does not mean "replaced".* ``record_version`` numbers versions per
PARENT and marks the previous current row superseded — but a control assessment
holds MANY evidence files, so uploading a second, unrelated file marks the first
superseded while it stays live and downloadable. Age plus status is therefore
never sufficient grounds to delete anything.

*So every candidate is checked against the live tables first.* Five different
records can point at one path — another version row, evidence, an uploaded
document, a vendor contract, an audit report — and a share-link upload really
does point an Evidence row and an UploadedDocument at the same file. If any of
them still references it, the bytes stay.

The purge order is likewise deliberate: claim the row, then unlink, then delete
the row. Unlinking first would leave, on a crash, a version row whose file is
gone — which ``verify_file`` reports as MISSING, and MISSING is how tampering
looks in the integrity report. A crash must never manufacture that.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.stored_file_version import StoredFileVersion
from app.services import file_integrity

logger = logging.getLogger(__name__)

POLL_SECONDS = 3600

# Claimed for deletion by one worker. A row parked here after a crash is picked
# up again by resume_interrupted().
PURGING = "purging"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def resolve_path(row: StoredFileVersion) -> Path:
    """Absolute path of a stored version (contracts store absolute paths)."""
    return Path(row.file_path) if row.is_absolute_path else Path(settings.UPLOADS_DIR) / row.file_path


async def is_referenced_elsewhere(db: AsyncSession, row: StoredFileVersion) -> str | None:
    """Name the live record still pointing at this file, or None if orphaned.

    Checked against the STORED path shape rather than the resolved one, matching
    how each table stores it: evidence and documents keep a path relative to
    UPLOADS_DIR, contracts keep an absolute one.
    """
    from app.models.compliance import Evidence, UploadedDocument
    from app.models.vendor import VendorContract
    from app.models.audit import Audit

    rel = row.file_path
    absolute = str(resolve_path(row))

    other_version = (await db.execute(
        select(StoredFileVersion.id).where(
            StoredFileVersion.file_path == rel,
            StoredFileVersion.id != row.id,
            StoredFileVersion.status != PURGING,
        ).limit(1)
    )).scalar_one_or_none()
    if other_version:
        return f"stored_file_versions:{other_version}"

    for model, column, value, label in (
        (Evidence, Evidence.file_path, rel, "evidence"),
        (UploadedDocument, UploadedDocument.file_path, rel, "uploaded_documents"),
        (VendorContract, VendorContract.file_path, absolute, "vendor_contracts"),
        (Audit, Audit.report_url, absolute, "audits.report_url"),
    ):
        hit = (await db.execute(
            select(model.id).where(column == value).limit(1)
        )).scalar_one_or_none()
        if hit:
            return f"{label}:{hit}"

    return None


def effective_policy() -> dict:
    """Retention thresholds, clamped so a bad env value cannot mean 'delete now'."""
    max_days = max(1, int(settings.FILE_RETENTION_MAX_DAYS))
    return {
        "enabled": bool(settings.FILE_RETENTION_ENABLED),
        "deleted_days": min(max(1, int(settings.FILE_RETENTION_DELETED_DAYS)), max_days),
        "superseded_days": min(max(1, int(settings.FILE_RETENTION_SUPERSEDED_DAYS)), max_days),
        "superseded_keep": max(0, int(settings.FILE_RETENTION_SUPERSEDED_KEEP)),
        "max_per_run": max(1, int(settings.FILE_RETENTION_MAX_PURGE_PER_RUN)),
    }


async def select_purgeable(
    db: AsyncSession, policy: dict, tenant_id: str | None = None, limit: int | None = None
) -> list[StoredFileVersion]:
    """Versions old enough to purge, before the live-reference check.

    Age alone qualifies nothing — every row returned here is still checked by
    purge_one() against the five tables that may reference its file.
    """
    now = _utcnow()
    deleted_before = now - timedelta(days=policy["deleted_days"])
    superseded_before = now - timedelta(days=policy["superseded_days"])

    q = select(StoredFileVersion).where(
        StoredFileVersion.legal_hold == False,  # noqa: E712
        StoredFileVersion.retired_at.is_not(None),
        or_(
            (StoredFileVersion.status == file_integrity.DELETED)
            & (StoredFileVersion.retired_at < deleted_before),
            (StoredFileVersion.status == file_integrity.SUPERSEDED)
            & (StoredFileVersion.retired_at < superseded_before),
        ),
    )
    if tenant_id:
        q = q.where(StoredFileVersion.tenant_id == tenant_id)
    q = q.order_by(StoredFileVersion.retired_at).limit(limit or policy["max_per_run"])

    rows = list((await db.execute(q)).scalars().all())

    # Keep the most recent K superseded versions per parent whatever their age:
    # "we still hold the last few revisions" is usually the intent behind a
    # retention window, and age alone would eventually take the lot.
    keep = policy["superseded_keep"]
    if not keep:
        return rows

    protected: set[str] = set()
    parents = {(r.parent_type, r.parent_id) for r in rows if r.status == file_integrity.SUPERSEDED}
    for parent_type, parent_id in parents:
        recent = (await db.execute(
            select(StoredFileVersion.id)
            .where(
                StoredFileVersion.parent_type == parent_type,
                StoredFileVersion.parent_id == parent_id,
                StoredFileVersion.status == file_integrity.SUPERSEDED,
            )
            .order_by(StoredFileVersion.version_number.desc())
            .limit(keep)
        )).scalars().all()
        protected.update(recent)

    return [r for r in rows if r.id not in protected]


async def purge_one(db: AsyncSession, row: StoredFileVersion) -> dict:
    """Purge a single version. Returns what happened and why.

    Order is claim -> unlink -> delete row. A crash after the claim leaves the
    row in 'purging' for resume_interrupted() to finish; a crash between unlink
    and row-delete is the case that must not happen the other way round, since
    a row pointing at a missing file reads as tampering.
    """
    ref = await is_referenced_elsewhere(db, row)
    if ref:
        return {"id": row.id, "action": "skipped", "reason": f"still referenced by {ref}"}

    claimed = await db.execute(
        update(StoredFileVersion)
        .where(StoredFileVersion.id == row.id, StoredFileVersion.status == row.status)
        .values(status=PURGING)
    )
    await db.commit()
    if claimed.rowcount != 1:
        # Another worker took it, or it changed under us. Both mean: not ours.
        return {"id": row.id, "action": "skipped", "reason": "claimed by another worker"}

    path = resolve_path(row)
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        logger.error("file_retention: unlink failed for %s: %s", path, exc)
        await db.execute(
            update(StoredFileVersion)
            .where(StoredFileVersion.id == row.id)
            .values(status=file_integrity.DELETED)
        )
        await db.commit()
        return {"id": row.id, "action": "failed", "reason": str(exc)}

    await db.execute(
        StoredFileVersion.__table__.delete().where(StoredFileVersion.id == row.id)
    )
    await db.commit()
    logger.info("file_retention: purged version %s (%s)", row.id, row.file_name)
    return {"id": row.id, "action": "purged", "reason": ""}


async def resume_interrupted(db: AsyncSession) -> int:
    """Finish versions left in 'purging' by a crash. Their file may already be gone."""
    rows = list((await db.execute(
        select(StoredFileVersion).where(StoredFileVersion.status == PURGING)
    )).scalars().all())
    for row in rows:
        try:
            resolve_path(row).unlink(missing_ok=True)
        except OSError:
            pass
        await db.execute(
            StoredFileVersion.__table__.delete().where(StoredFileVersion.id == row.id)
        )
    if rows:
        await db.commit()
        logger.info("file_retention: resumed %d interrupted purges", len(rows))
    return len(rows)


async def preview(db: AsyncSession, tenant_id: str | None = None, limit: int = 200) -> dict:
    """Dry run: what a purge would do right now, with a reason per row.

    Nothing is claimed, unlinked or deleted here — this is the thing an operator
    reads before enabling retention at all.
    """
    policy = effective_policy()
    candidates = await select_purgeable(db, policy, tenant_id=tenant_id, limit=limit)
    would_purge, would_skip = [], []
    for row in candidates:
        ref = await is_referenced_elsewhere(db, row)
        entry = {
            "id": row.id,
            "entity_type": row.entity_type,
            "file_name": row.file_name,
            "status": row.status,
            "retired_at": row.retired_at.isoformat() if row.retired_at else None,
            "size_bytes": row.file_size_bytes,
        }
        if ref:
            would_skip.append({**entry, "reason": f"still referenced by {ref}"})
        else:
            would_purge.append(entry)
    return {
        "policy": policy,
        "would_purge": would_purge,
        "would_skip": would_skip,
        "purge_count": len(would_purge),
        "skip_count": len(would_skip),
        "reclaimable_bytes": sum(e["size_bytes"] or 0 for e in would_purge),
    }


async def run_file_retention(db: AsyncSession, tenant_id: str | None = None) -> dict:
    """Apply the policy. No-op unless FILE_RETENTION_ENABLED."""
    policy = effective_policy()
    if not policy["enabled"]:
        return {"enabled": False, "purged": 0, "skipped": 0, "failed": 0}

    resumed = await resume_interrupted(db)
    results = []
    for row in await select_purgeable(db, policy, tenant_id=tenant_id):
        results.append(await purge_one(db, row))

    return {
        "enabled": True,
        "resumed": resumed,
        "purged": sum(1 for r in results if r["action"] == "purged"),
        "skipped": sum(1 for r in results if r["action"] == "skipped"),
        "failed": sum(1 for r in results if r["action"] == "failed"),
        "details": results,
    }


async def storage_summary(db: AsyncSession, tenant_id: str) -> dict:
    """What this tenant is holding, by version status."""
    rows = (await db.execute(
        select(
            StoredFileVersion.status,
            func.count(StoredFileVersion.id),
            func.coalesce(func.sum(StoredFileVersion.file_size_bytes), 0),
        )
        .where(StoredFileVersion.tenant_id == tenant_id)
        .group_by(StoredFileVersion.status)
    )).all()
    by_status = {r[0]: {"count": r[1], "bytes": int(r[2] or 0)} for r in rows}
    return {
        "by_status": by_status,
        "total_versions": sum(v["count"] for v in by_status.values()),
        "total_bytes": sum(v["bytes"] for v in by_status.values()),
        "policy": effective_policy(),
    }


async def start_file_retention_scheduler() -> None:
    """Hourly in-process purge loop.

    In-process rather than Celery beat because this topology has no beat
    running. Safe under multiple workers: purge_one claims each row with a
    conditional UPDATE, so only one worker ever acts on a given version.
    """
    if os.getenv("ENABLE_FILE_RETENTION_SCHEDULER", "1") == "0":
        logger.info("File retention scheduler disabled via ENABLE_FILE_RETENTION_SCHEDULER=0")
        return
    if not settings.FILE_RETENTION_ENABLED:
        logger.info("File retention scheduler idle (FILE_RETENTION_ENABLED=false)")
    logger.info("File retention scheduler started (poll every %ss)", POLL_SECONDS)
    while True:
        try:
            if settings.FILE_RETENTION_ENABLED:
                async with AsyncSessionLocal() as db:
                    result = await run_file_retention(db)
                if result.get("purged") or result.get("failed"):
                    logger.info("File retention run: %s", {
                        k: v for k, v in result.items() if k != "details"
                    })
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.error("File retention tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
