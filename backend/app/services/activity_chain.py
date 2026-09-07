"""Tamper-evident hash chain for the activity log.

Each entry stores a per-tenant monotonic `seq`, the `prev_hash` of the previous
chained entry, and its own `entry_hash = sha256(seq | prev_hash | immutable fields)`.
Any edit/deletion/reorder breaks the recomputed chain at the tampered point.

Concurrency: the activity middleware writes from independent sessions across two
uvicorn workers, so appends race. A UNIQUE(tenant_id, seq) index lets exactly one
writer win each seq; losers get an IntegrityError and retry against the new tail.
"""
import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.activity_log import ActivityLog

logger = logging.getLogger(__name__)

_MAX_RETRIES = 8


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _canonical_ts(dt: datetime | None) -> str:
    """Backend-stable timestamp for hashing.

    The created_at column is DateTime(timezone=True): SQLite round-trips it naive but
    Postgres/Oracle/MSSQL return it tz-aware, so raw isoformat() would differ between
    write and verify and falsely flag tampering. Normalize to naive-UTC at SECOND
    precision (no sub-second round-trip differences across drivers) for a stable hash.
    """
    if dt is None:
        return ""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def compute_entry_hash(entry: ActivityLog, prev_hash: str) -> str:
    """Deterministic SHA-256 over the entry's immutable fields + the chain link."""
    created = _canonical_ts(getattr(entry, "created_at", None))
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

    for attempt in range(_MAX_RETRIES):
        prev_seq, prev_hash = await _tail(db, entry.tenant_id)
        entry.seq = prev_seq + 1
        entry.prev_hash = prev_hash
        entry.entry_hash = compute_entry_hash(entry, prev_hash)
        db.add(entry)
        try:
            await db.commit()
            return entry
        except (IntegrityError, OperationalError):
            # IntegrityError: another writer took this seq. OperationalError: SQLite
            # "database is locked". Either way, roll back and retry against a fresh tail.
            await db.rollback()
            await asyncio.sleep(0.02 * (attempt + 1))  # brief backoff to let the winner commit
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


# ── System / batch actor ─────────────────────────────────────────────────────
# STB requires operations to declare their origin as manuel, batch or API. The
# middleware classifies HTTP traffic, but background work never reached the log
# at all: the threat feed has written 6,000+ rows against 4 audit entries, so
# "who changed this" had no answer for anything a scheduler did.
#
# ActivityLog.user_id is NOT NULL with a foreign key, so a batch entry needs a
# real actor. Rather than relax that column on a live table (and lean on
# SQLite's foreign keys being off, which would not survive the move to Oracle),
# batch work is attributed to one platform-wide system account. It cannot log
# in — no password, is_active False — and each entry still carries the tenant
# the change belonged to.

# users.tenant_id is NOT NULL, so the actor is per tenant rather than one global
# row — which also keeps the account inside the tenant whose data it touched,
# instead of introducing a cross-tenant principal.
def system_actor_email(tenant_id: str) -> str:
    return f"system+{tenant_id}@grceye.local"


SYSTEM_ACTOR_EMAIL_PATTERN = "system+%@grceye.local"


def is_system_actor(email: str | None) -> bool:
    """True for the automated-task principal, which is never a real person."""
    e = (email or "").lower()
    return e.startswith("system+") and e.endswith("@grceye.local")


_system_actor_ids: dict[str, str] = {}


async def get_system_actor_id(tenant_id: str) -> str | None:
    """Id of this tenant's system account, creating it once if absent.

    Uses its OWN session on purpose. Taking the caller's would mean a failure
    here — a lost seq race, a locked database — could roll back the very
    operation being logged.
    """
    cached = _system_actor_ids.get(tenant_id)
    if cached:
        return cached
    from app.models.user import User, UserRole

    email = system_actor_email(tenant_id)
    try:
        async with AsyncSessionLocal() as sdb:
            existing = (await sdb.execute(
                select(User).where(User.email == email)
            )).scalar_one_or_none()
            if existing is None:
                existing = User(
                    tenant_id=tenant_id,
                    email=email,
                    first_name="System",
                    last_name="(automated tasks)",
                    role=UserRole.VIEWER,
                    is_active=False,       # never a login
                    is_verified=True,
                    hashed_password=None,
                )
                sdb.add(existing)
                await sdb.flush()
                await sdb.commit()
            _system_actor_ids[tenant_id] = existing.id
            return existing.id
    except Exception:  # noqa: BLE001 — logging must never break the job it describes
        logger.warning("could not resolve the system audit actor for tenant %s", tenant_id)
        return None


async def log_system_activity(
    *,
    tenant_id: str,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    entity_name: str | None = None,
    details: dict | None = None,
    origin: str = "batch",
) -> None:
    """Record a background mutation in the tenant's hash-chained audit trail.

    Writes through an isolated session, like _journal_login does. The caller's
    session usually holds an uncommitted business row, and chain_and_add
    commits — so sharing it would either publish that row early or, on failure,
    roll it back and leave a chained entry describing something that no longer
    exists. A falsified audit trail is worse than a missing entry.
    """
    actor_id = await get_system_actor_id(tenant_id)
    if not actor_id:
        return
    try:
        async with AsyncSessionLocal() as adb:
            await chain_and_add(adb, ActivityLog(
                tenant_id=tenant_id,
                user_id=actor_id,
                user_email="",
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_name=entity_name,
                details=details or {},
                ip_address=None,
                origin=origin,
            ))
    except Exception as exc:  # noqa: BLE001
        # A stale cached id (the row was deleted) must not poison every later
        # write for the life of the worker.
        _system_actor_ids.pop(tenant_id, None)
        logger.warning("system activity log write failed: %s", exc)
