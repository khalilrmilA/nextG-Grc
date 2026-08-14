"""Tamper-evident hash chain for the activity log.

Each entry stores a per-tenant monotonic `seq`, the `prev_hash` of the previous
chained entry, and its own `entry_hash = sha256(seq | prev_hash | immutable fields)`.
Any edit/deletion/reorder breaks the recomputed chain at the tampered point.

Concurrency: the activity middleware writes from independent sessions across two
uvicorn workers, so appends race. A UNIQUE(tenant_id, seq) index lets exactly one
writer win each seq; losers get an IntegrityError and retry against the new tail.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_log import ActivityLog

logger = logging.getLogger(__name__)

_MAX_RETRIES = 8


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def compute_entry_hash(entry: ActivityLog, prev_hash: str) -> str:
    """Deterministic SHA-256 over the entry's immutable fields + the chain link."""
    created = entry.created_at.isoformat() if getattr(entry, "created_at", None) else ""
    payload = "|".join([
        str(entry.seq or ""),
        prev_hash or "",
        entry.tenant_id or "",
        entry.user_id or "",
        entry.user_email or "",
        entry.action or "",
        entry.entity_type or "",
        entry.entity_id or "",
        entry.entity_name or "",
        created,
        json.dumps(entry.details or {}, sort_keys=True, separators=(",", ":")),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def _tail(db: AsyncSession, tenant_id: str) -> tuple[int, str]:
    """Return (last_seq, last_entry_hash) for a tenant's chain, or (0, '')."""
    row = (await db.execute(
        select(ActivityLog.seq, ActivityLog.entry_hash)
        .where(ActivityLog.tenant_id == tenant_id, ActivityLog.seq.isnot(None))
        .order_by(ActivityLog.seq.desc())
        .limit(1)
    )).first()
    if not row:
        return 0, ""
    return int(row[0] or 0), (row[1] or "")


async def chain_and_add(db: AsyncSession, entry: ActivityLog) -> ActivityLog:
    """Append `entry` to its tenant's hash chain and commit. Best-effort, never raises.

    On the (rare) event that every retry loses the seq race, the row is still recorded
    with seq=NULL (unchained) so no audit event is silently dropped.
    """
    if entry.created_at is None:
        entry.created_at = _utcnow()

    for _ in range(_MAX_RETRIES):
        prev_seq, prev_hash = await _tail(db, entry.tenant_id)
        entry.seq = prev_seq + 1
        entry.prev_hash = prev_hash
        entry.entry_hash = compute_entry_hash(entry, prev_hash)
        db.add(entry)
        try:
            await db.commit()
            return entry
        except IntegrityError:
            await db.rollback()  # another writer took this seq — retry against the new tail
            continue

    # Contention floor: record it unchained rather than lose the audit trail.
    logger.warning("activity chain: giving up on seq after retries; recording unchained")
    entry.seq = None
    entry.prev_hash = None
    entry.entry_hash = None
    db.add(entry)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        logger.warning("activity chain: unchained fallback insert failed: %s", exc)
    return entry
