"""Auto-archiving rules engine (Elite Pack) — RFP module 17 gap-fix.

The manual flow (``POST /archiving``) lets a user snapshot one record on demand.
This engine adds the missing scheduled half: a tenant defines an ``ArchivingRule``
("status=closed AND age_days>365" against e.g. "incident"), and a background loop
periodically evaluates every enabled rule, auto-archiving any matching row that
hasn't already been archived — via the exact same snapshot-creation path the
manual endpoint uses (``create_archive_record``), so there is only one way an
ArchiveRecord ever gets built.

A snapshot is not a single row: ``serialize_record_with_children`` walks the
CHILD_SPECS map so archiving an audit also embeds its constats, its evidence
metadata and its recommendations under ``payload["children"]``. STB objectif 8
asks for « accès aux rapports et aux preuves archivées », and an archive that
kept only the audits row was preserving a title and a status while the findings
and the evidence it exists to prove stayed behind in tables that a later purge
or delete can empty.

Concurrency, mirrors app.services.report_scheduler: ``run_due_rules`` claims each
due rule with an optimistic UPDATE conditioned on its current ``next_run_at``, so
even with 2 uvicorn workers exactly one runner evaluates a given tick — no
duplicate archiving. As defense in depth, evaluation also skips any entity_id that
already has an ArchiveRecord for that tenant/entity_type, so even a lost claim
race can never double-archive the same row.
"""
import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.archive import ArchiveRecord, ArchivingRule
from app.models.risk import Risk
from app.models.incident import Incident
from app.models.audit import Audit, AuditEvidence, AuditFinding
from app.models.audit_recommendation import AuditRecommendation
from app.models.vulnerability import Vulnerability
from app.models.security_exception import SecurityException
from app.models.applied_control import AppliedControl
from app.models.policy import Policy
from app.models.vendor import Vendor

logger = logging.getLogger(__name__)

RULE_POLL_SECONDS = 300     # in-process loop cadence (matches report_scheduler)
RULE_INTERVAL_SECONDS = 3600  # how often a due rule is re-scheduled after it runs

# entity_type (as used elsewhere in the app, e.g. activity_middleware.PATH_TO_ENTITY)
# -> the model queried for candidate rows + the attribute used as its display name
# in the archive payload/reason. Every entry has tenant_id/status/created_at via
# their normal columns / Base, so age_days and "status=" criteria work uniformly.
ARCHIVABLE_ENTITIES: dict[str, dict] = {
    "risk":                {"model": Risk,              "name_attr": "title"},
    "incident":            {"model": Incident,           "name_attr": "title"},
    "audit":               {"model": Audit,              "name_attr": "title"},
    "vulnerability":       {"model": Vulnerability,       "name_attr": "title"},
    "security_exception":  {"model": SecurityException,   "name_attr": "title"},
    "applied_control":     {"model": AppliedControl,      "name_attr": "name"},
    "policy":              {"model": Policy,              "name_attr": "title"},
    "vendor":              {"model": Vendor,              "name_attr": "name"},
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Criteria DSL ─────────────────────────────────────────────────────────────
# "status=closed AND age_days>365" -> [("status", "=", "closed"), ("age_days", ">", "365")]

_CLAUSE_RE = re.compile(r"^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(>=|<=|!=|=|>|<)\s*(.+?)\s*$")


def parse_criteria(criteria: str) -> list[tuple[str, str, str]]:
    """Parse a small 'field OP value AND field OP value ...' DSL into clauses.

    Raises ValueError on malformed input so callers (endpoint + engine) can both
    reject bad rules early with a clear message.
    """
    if not criteria or not criteria.strip():
        raise ValueError("criteria must not be empty")
    clauses: list[tuple[str, str, str]] = []
    for part in re.split(r"\s+AND\s+", criteria.strip(), flags=re.IGNORECASE):
        if not part.strip():
            continue
        m = _CLAUSE_RE.match(part)
        if not m:
            raise ValueError(f"invalid criteria clause: {part!r}")
        field, op, value = m.groups()
        clauses.append((field, op, value.strip().strip("'\"")))
    if not clauses:
        raise ValueError("criteria must have at least one clause")
    return clauses


def _compare(actual, op: str, target) -> bool:
    if op == "=":
        return actual == target
    if op == "!=":
        return actual != target
    if op == ">":
        return actual > target
    if op == "<":
        return actual < target
    if op == ">=":
        return actual >= target
    if op == "<=":
        return actual <= target
    return False


def record_matches(record, clauses: list[tuple[str, str, str]], now: datetime) -> bool:
    """True if `record` satisfies every clause (AND semantics)."""
    for field, op, value in clauses:
        if field == "age_days":
            created = getattr(record, "created_at", None)
            if created is None:
                return False
            if created.tzinfo is not None:
                created = created.astimezone(timezone.utc).replace(tzinfo=None)
            try:
                target = float(value)
            except ValueError:
                return False
            if not _compare(float((now - created).days), op, target):
                return False
            continue

        raw = getattr(record, field, None)
        if raw is None:
            return False
        raw = getattr(raw, "value", raw)  # unwrap str-Enum columns
        try:
            actual, target = float(raw), float(value)
        except (TypeError, ValueError):
            actual, target = str(raw).strip().lower(), str(value).strip().lower()
        if not _compare(actual, op, target):
            return False
    return True


def serialize_record(record) -> dict:
    """JSON-safe dict of every mapped column — becomes the ArchiveRecord.payload."""
    payload: dict = {}
    for col in record.__table__.columns:
        val = getattr(record, col.name, None)
        if isinstance(val, datetime):
            val = val.isoformat()
        else:
            val = getattr(val, "value", val)  # unwrap str-Enum columns
        payload[col.name] = val
    return payload


# ── Child records that travel with the snapshot ──────────────────────────────
# An ArchiveRecord used to be a copy of exactly one row, so archiving an audit
# preserved its title, its status and its executive summary and silently left
# behind every constat and every piece of evidence attached to it — which is the
# half of « accès aux rapports et aux preuves archivées » that matters. The
# children are captured INTO the snapshot rather than resolved when it is read,
# because the whole point of an archive is to still answer once the live rows
# are gone.
#
# entity_type -> ((payload key, child model, FK attribute on the child), ...)
CHILD_SPECS: dict[str, tuple[tuple[str, type, str], ...]] = {
    "audit": (
        ("findings", AuditFinding, "audit_id"),
        ("evidence", AuditEvidence, "audit_id"),
        ("recommendations", AuditRecommendation, "audit_id"),
    ),
}


# Tables that physically exist, resolved once per worker. CHILD_SPECS names
# tables create_all() only materialises at the next restart (audit_recommendations
# is one), and asking for a table that is not there must not cost us the archive.
#
# The check is a PROBE on the engine rather than a try/except around the query,
# because there is no good way back from a failed statement inside the caller's
# transaction: on PostgreSQL it aborts the whole transaction, and the rollback
# that recovers it expires every ORM instance in the session — including the very
# row being archived, whose next attribute read then attempts lazy IO from an
# async context and raises MissingGreenlet. Not issuing the doomed statement is
# the only fix that leaves the caller's session exactly as it found it.
_known_tables: set[str] | None = None


async def _existing_tables() -> set[str]:
    """Names of the tables present in the database (cached, best effort).

    An empty set means "could not determine" and callers then simply try the
    query — never a reason to skip a collection that is probably there.
    """
    global _known_tables
    if _known_tables is None:
        try:
            from sqlalchemy import inspect as sa_inspect

            from app.core.database import engine
            async with engine.connect() as conn:
                _known_tables = await conn.run_sync(
                    lambda sync_conn: set(sa_inspect(sync_conn).get_table_names())
                )
        except Exception as exc:  # noqa: BLE001 — a failed probe is not a failed archive
            logger.warning("archiving: could not list tables (%s)", exc)
            _known_tables = set()
    return _known_tables


async def collect_children(db: AsyncSession, entity_type: str, record) -> dict[str, list[dict]]:
    """Serialize every child collection declared for `entity_type`.

    A collection whose table does not exist yet degrades to "not captured"
    instead of aborting the archive: losing the parent snapshot over an optional
    child would be a far worse outcome than an incomplete one.
    """
    specs = CHILD_SPECS.get(entity_type)
    if not specs:
        return {}
    # Read before any statement runs: if one did fail and something rolled the
    # session back, `record` would be expired and this attribute access would
    # itself try to hit the database.
    parent_id = record.id
    available = await _existing_tables()
    children: dict[str, list[dict]] = {}
    for key, model, fk_attr in specs:
        if available and model.__tablename__ not in available:
            logger.info(
                "archiving: %s %s — child collection %r skipped, table %s does not exist yet",
                entity_type, parent_id, key, model.__tablename__,
            )
            continue
        try:
            rows = (await db.execute(
                select(model)
                .where(getattr(model, fk_attr) == parent_id)
                .order_by(model.created_at.asc())
            )).scalars().all()
        except SQLAlchemyError as exc:  # noqa: BLE001 — see the note above on recovery
            logger.warning(
                "archiving: child collection %r of %s %s not captured (%s)",
                key, entity_type, parent_id, exc,
            )
            continue
        children[key] = [serialize_record(row) for row in rows]
    return children


async def serialize_record_with_children(db: AsyncSession, entity_type: str, record) -> dict:
    """The payload actually stored on an ArchiveRecord: the row plus its children.

    Evidence is embedded as METADATA (path, size, content type, sha256) — the
    bytes stay where they were uploaded. Copying them would double a bank's
    storage for every archive and, worse, break the single sha256 that proves the
    file has not changed since upload; the archive keeps the pointer and the
    digest so the retrieval route can re-verify the original.
    """
    payload = serialize_record(record)
    children = await collect_children(db, entity_type, record)
    if children:
        payload["children"] = children
    return payload


# ── Shared archive-creation path (also used by the manual POST /archiving) ──

async def create_archive_record(
    db: AsyncSession,
    tenant_id: str,
    entity_type: str,
    entity_id: str | None,
    payload: dict,
    reason: str | None,
    retention_days: int | None,
    archived_by_id: str | None,
) -> ArchiveRecord:
    """Snapshot one record. The single place an ArchiveRecord is ever constructed —
    called by the manual archiving endpoint and by evaluate_rule() alike."""
    now = _utcnow()
    retention_until = None
    if retention_days is not None:
        if retention_days < 0:
            raise ValueError("retention_days must be >= 0")
        retention_until = now + timedelta(days=retention_days)
    record = ArchiveRecord(
        tenant_id=tenant_id, entity_type=entity_type, entity_id=entity_id,
        payload=payload or {}, reason=reason, archived_at=now,
        retention_until=retention_until, archived_by_id=archived_by_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def load_archivable(db: AsyncSession, tenant_id: str, entity_type: str, entity_id: str):
    """The tenant's live row for (entity_type, entity_id), or None.

    Raises ValueError for an entity_type the engine does not know how to read,
    so callers can answer 422 rather than silently archiving nothing.
    """
    spec = ARCHIVABLE_ENTITIES.get(entity_type)
    if not spec:
        raise ValueError(
            f"Unsupported entity_type {entity_type!r}. Supported: {sorted(ARCHIVABLE_ENTITIES)}"
        )
    model = spec["model"]
    return (await db.execute(
        select(model).where(model.id == entity_id, model.tenant_id == tenant_id)
    )).scalar_one_or_none()


async def snapshot_entity(
    db: AsyncSession,
    *,
    tenant_id: str,
    entity_type: str,
    entity_id: str,
    reason: str | None,
    retention_days: int | None,
    archived_by_id: str | None,
) -> ArchiveRecord:
    """Archive a live row BY ID, payload built server-side (children included).

    The manual endpoint used to store whatever payload the caller posted, so an
    "archived audit" was only as truthful as the client that sent it. Anything
    that must survive the deletion of the original — the audits DELETE route, a
    retention job — should go through here so the snapshot is the real record.

    Raises ValueError (unknown entity_type / bad retention) or LookupError (no
    such row in this tenant).
    """
    record = await load_archivable(db, tenant_id, entity_type, entity_id)
    if record is None:
        raise LookupError(f"{entity_type} {entity_id} not found in this tenant")
    name = getattr(record, ARCHIVABLE_ENTITIES[entity_type]["name_attr"], None) or entity_id
    return await create_archive_record(
        db,
        tenant_id=tenant_id,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=await serialize_record_with_children(db, entity_type, record),
        reason=(reason or f"Archived {entity_type} — {name}")[:300],
        retention_days=retention_days,
        archived_by_id=archived_by_id,
    )


# ── Rule evaluation ──────────────────────────────────────────────────────────

async def evaluate_rule(db: AsyncSession, rule: ArchivingRule) -> int:
    """Archive every not-yet-archived row of `rule.entity_type` matching its
    criteria. Returns how many new ArchiveRecords were created."""
    spec = ARCHIVABLE_ENTITIES.get(rule.entity_type)
    if not spec:
        logger.warning("archiving rule %s: unsupported entity_type %r", rule.id, rule.entity_type)
        return 0
    try:
        clauses = parse_criteria(rule.criteria)
    except ValueError as exc:
        logger.warning("archiving rule %s: invalid criteria (%s)", rule.id, exc)
        return 0

    model = spec["model"]
    name_attr = spec["name_attr"]
    now = _utcnow()

    candidates = list((await db.execute(
        select(model).where(model.tenant_id == rule.tenant_id)
    )).scalars().all())

    already_archived = set((await db.execute(
        select(ArchiveRecord.entity_id).where(
            ArchiveRecord.tenant_id == rule.tenant_id,
            ArchiveRecord.entity_type == rule.entity_type,
        )
    )).scalars().all())

    archived_count = 0
    for record in candidates:
        if record.id in already_archived:
            continue
        if not record_matches(record, clauses, now):
            continue
        name = getattr(record, name_attr, None) or record.id
        await create_archive_record(
            db,
            tenant_id=rule.tenant_id,
            entity_type=rule.entity_type,
            entity_id=record.id,
            payload=await serialize_record_with_children(db, rule.entity_type, record),
            reason=f"Auto-archived by rule {rule.id} ({rule.criteria}) — {name}"[:300],
            retention_days=rule.retention_days,
            archived_by_id=None,  # system-initiated, no human actor
        )
        already_archived.add(record.id)
        archived_count += 1
    return archived_count


# ── Claim-based scheduler (exactly-once across N uvicorn workers) ──────────

async def run_due_rules(db: AsyncSession) -> dict:
    """Evaluate every enabled rule whose next_run_at has passed, claiming each
    atomically so concurrent workers never double-evaluate the same tick."""
    now = _utcnow()
    rows = (await db.execute(
        select(ArchivingRule).where(
            ArchivingRule.enabled == True,  # noqa: E712
            ArchivingRule.next_run_at.isnot(None),
            ArchivingRule.next_run_at <= now,
        )
    )).scalars().all()

    evaluated = 0
    total_archived = 0
    for rule in rows:
        prev_next = rule.next_run_at
        new_next = now + timedelta(seconds=RULE_INTERVAL_SECONDS)
        # Optimistic claim: only the runner whose UPDATE still matches the old
        # next_run_at wins; everyone else gets rowcount 0 and skips (same pattern
        # as report_scheduler.run_due_schedules).
        claim = await db.execute(
            update(ArchivingRule)
            .where(ArchivingRule.id == rule.id, ArchivingRule.next_run_at == prev_next)
            .values(next_run_at=new_next)
        )
        await db.commit()
        if claim.rowcount != 1:
            continue
        await db.refresh(rule)
        try:
            count = await evaluate_rule(db, rule)
            result = f"archived {count} at {now.isoformat(timespec='seconds')}"
        except Exception as exc:  # noqa: BLE001 — one bad rule must not kill the loop
            logger.error("archiving rule %s evaluation failed: %s", rule.id, exc)
            count, result = 0, f"error: {exc}"[:200]
        rule.last_run_at = now
        rule.last_result = result
        await db.commit()
        evaluated += 1
        total_archived += count

    return {
        "due": len(rows), "evaluated": evaluated, "archived": total_archived,
        "checked_at": now.isoformat(timespec="seconds"),
    }


async def start_archiving_scheduler() -> None:
    """In-process loop: every RULE_POLL_SECONDS, evaluate any due archiving rules.

    Disabled with ENABLE_ARCHIVING_SCHEDULER=0. Safe under multiple workers because
    run_due_rules claims each occurrence atomically.
    """
    if os.getenv("ENABLE_ARCHIVING_SCHEDULER", "1") == "0":
        logger.info("Archiving rule scheduler disabled via ENABLE_ARCHIVING_SCHEDULER=0")
        return
    logger.info("Archiving rule scheduler started (poll every %ss)", RULE_POLL_SECONDS)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_due_rules(db)
            if result["evaluated"]:
                logger.info("Archiving rules evaluated: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.error("Archiving scheduler tick failed: %s", exc)
        await asyncio.sleep(RULE_POLL_SECONDS)
