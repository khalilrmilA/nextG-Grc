"""Archiving + retention endpoints (Elite Pack) — RFP module 17.

Rule-based archiving (snapshot any entity with an optional retention window),
consult archives without restoring, enforce retention via purge, and export
archived data to CSV/Excel/PDF. Gated behind ``archiving``.

STB objectif 8 (« registre et traçabilité ») adds three things this module was
missing: every route is role-gated on top of the plan gate, the purge — the one
irreversible operation here — is restricted to a tenant administrator and takes
a written reason that is sealed into the hash-chained trail together with a
manifest of exactly what was destroyed, and an archived record can be READ BACK
with its children (``GET /{id}/content``) down to downloading an archived
evidence file (``GET /{id}/evidence/{evidence_id}/download``), which is what
« accès aux rapports et aux preuves archivées » means in practice.

Auto-archiving rules (``ArchivingRule`` + the background evaluator that acts on
them) live in app.services.archiving_engine — this file only exposes their CRUD
and reuses the engine's ``create_archive_record`` for the manual POST, so there
is a single code path that ever builds an ArchiveRecord.
"""
import asyncio
import csv
import hashlib
import io
import json
import logging
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.activity_log import ActivityLog
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.archive import ArchiveRecord, ArchivingRule
from app.api.v1.dependencies.auth import get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.services import file_integrity
from app.services.activity_chain import chain_and_add
from app.services.excel_export import rows_to_xlsx
from app.services.archiving_engine import (
    ARCHIVABLE_ENTITIES,
    CHILD_SPECS,
    collect_children,
    create_archive_record,
    load_archivable,
    parse_criteria,
    snapshot_entity,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_EXPORT_COLUMNS = ["id", "entity_type", "entity_id", "reason", "archived_at", "retention_until"]

# How many purged records are itemised in the audit-trail entry. The digest
# below always covers the full set, so a truncated list is still verifiable.
_MANIFEST_LIMIT = 500


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Access control ───────────────────────────────────────────────────────────
# require_feature() is the BILLING gate: it answers "is archiving in this
# tenant's plan", never "may this person touch it". On its own it let any
# authenticated user of an entitled tenant read the whole register and empty it.
# Objectif 8 asks for « accès filtré selon les droits utilisateurs », so every
# route below carries a role gate as well.

# Consultation of the register: the profiles that answer for the records —
# plus the auditor, who is precisely the person meant to read archived audits.
ARCHIVE_READERS = (
    UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.RISK_MANAGER,
    UserRole.AUDITOR, UserRole.POLICY_MANAGER, UserRole.EXECUTIVE,
)
# Creating snapshots and writing retention rules is a records-management act.
ARCHIVE_MANAGERS = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.RISK_MANAGER)


def _archive_access(*roles: UserRole):
    """Compose the plan entitlement and the role gate into a single dependency.

    Both must hold: 402 when the tenant has no Elite entitlement, 403 when the
    caller has no business reading or changing the register. require_roles()
    auto-passes tenant_admin/super_admin, which is what we want everywhere here
    except the purge — see _purge_access.
    """
    _roles_dep = require_roles(*roles)

    async def _dep(
        current_user: Annotated[User, Depends(require_feature("archiving"))],
        _authorized: Annotated[User, Depends(_roles_dep)],
    ) -> User:
        return current_user

    return _dep


_read_access = _archive_access(*ARCHIVE_READERS)
_manage_access = _archive_access(*ARCHIVE_MANAGERS)


async def _purge_access(
    current_user: Annotated[User, Depends(require_feature("archiving"))],
) -> User:
    """Purge destroys records permanently — a tenant administrator decides that.

    Written as an explicit check rather than require_roles(UserRole.TENANT_ADMIN):
    that factory hands tenant_admin and super_admin a free pass BEFORE it looks
    at the roles it was given, so it can express "admins too" but never "admins
    only". Reading it as the latter while it means the former is exactly how a
    destructive route ends up open to a whole tenant. Same reasoning as
    admin._super_admin_only.
    """
    if current_user.role not in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=403,
            detail="Purging archived records requires a tenant administrator.",
        )
    return current_user


def _display_name(payload: dict | None) -> str | None:
    """Human label for an archived row — entity_name in the trail is 500 chars."""
    payload = payload if isinstance(payload, dict) else {}
    name = payload.get("title") or payload.get("name") or payload.get("ref_id")
    return str(name)[:500] if name else None


def _as_str(value) -> str | None:
    """A JSON value as a string, or None — snapshots are not always ours."""
    if value is None or isinstance(value, (dict, list)):
        return None
    return value if isinstance(value, str) else str(value)


def _as_int(value) -> int | None:
    """A JSON value as an int, or None when it is not a number."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _payload_children(payload: dict | None) -> dict[str, list[dict]]:
    """The ``children`` map of a snapshot, coerced to the shape we promise.

    A payload is a JSON column, and on the free-form POST path it is whatever
    the client sent — ``{"children": "oops"}`` is a legal body. Every consumer
    here (the trail entry, the content view, the evidence download) used to
    assume a dict of lists of dicts, so a hostile or merely sloppy body turned
    into a 500 AFTER the ArchiveRecord had already been committed: the archive
    existed and the caller was told the call failed. Anything that is not the
    declared shape is dropped rather than trusted.
    """
    if not isinstance(payload, dict):
        return {}
    raw = payload.get("children")
    if not isinstance(raw, dict):
        return {}
    return {
        str(key): [item for item in value if isinstance(item, dict)]
        for key, value in raw.items()
        if isinstance(value, list)
    }


async def _log_archive(db: AsyncSession, tenant_id: str, user: User, record: ArchiveRecord) -> None:
    """Name the archived object in the hash-chained trail.

    The middleware already records {method, path} for this POST, which says a
    call happened — not WHAT left the live tables, under what justification, or
    for how long it is kept. Those three are the register the tender asks for.
    """
    children = _payload_children(record.payload)
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=user.id, user_email=user.email,
        action="archive", entity_type=record.entity_type,
        entity_id=record.entity_id, entity_name=_display_name(record.payload),
        details={
            "archive_id": record.id,
            "reason": record.reason,
            "retention_until": (
                record.retention_until.isoformat() if record.retention_until else None
            ),
            "children": {k: len(v) for k, v in children.items()},
        },
    ))


def _archived_file_path(tenant_id: str, rel_path: str | None) -> Path | None:
    """Resolve an evidence path recorded in a snapshot, or None if it is not ours.

    Uploads are always written as ``<tenant_id>/<kind>/<file>`` under
    UPLOADS_DIR, so requiring the resolved path to stay inside this tenant's own
    directory is both the traversal guard and the tenant-isolation check: a
    snapshot payload is JSON, and JSON that once passed through an API is not a
    trustworthy source of filesystem paths.
    """
    if not rel_path or not isinstance(rel_path, str):
        return None
    root = Path(settings.UPLOADS_DIR).resolve()
    try:
        candidate = (root / rel_path).resolve()
        candidate.relative_to(root / tenant_id)
    except (ValueError, OSError):
        return None
    return candidate


async def _resolve_children(
    db: AsyncSession, tenant_id: str, record: ArchiveRecord
) -> tuple[dict[str, list[dict]], str]:
    """The children of an archived record, and where they came from.

    ``snapshot`` — read out of the archived payload, the durable answer.
    ``live``     — rebuilt from the still-existing row, for records archived
                   before children were captured.
    ``none``     — nothing to show.

    Shared by the content view and the evidence download ON PURPOSE: when the
    two resolved children differently, /content listed a live-rebuilt preuve as
    ``downloadable`` and the download route — which only ever looked in the
    payload — answered 404 for it. A listing that offers a file the retrieval
    route refuses is worse than no listing at all.
    """
    children = _payload_children(record.payload)
    if children:
        return children, "snapshot"
    if record.entity_id and record.entity_type in CHILD_SPECS:
        try:
            live = await load_archivable(db, tenant_id, record.entity_type, record.entity_id)
        except ValueError:
            live = None
        if live is not None:
            children = await collect_children(db, record.entity_type, live)
            if children:
                return children, "live"
    return {}, "none"


class ArchiveIn(BaseModel):
    entity_type: str
    entity_id: str | None = None
    # Only consulted when entity_id is absent — with an id the snapshot is built
    # server-side from the live row (see archive_entity).
    payload: dict = {}
    reason: str | None = None
    retention_days: int | None = None   # None = keep indefinitely


class ArchiveOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str | None
    payload: dict
    reason: str | None
    archived_at: datetime
    retention_until: datetime | None
    # "Who archived this" is half of the traceability requirement and was stored
    # but never returned. NULL means the archiving scheduler did it, not a person.
    archived_by_id: str | None = None
    model_config = {"from_attributes": True}


@router.post("", response_model=ArchiveOut, status_code=201)
async def archive_entity(
    body: ArchiveIn,
    current_user: Annotated[User, Depends(_manage_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Snapshot one record into the archive register.

    When `entity_id` names a live row, the payload is built HERE from that row —
    children included, so an archived audit carries its constats and its evidence
    metadata — and the caller's `payload` is ignored: an archive whose contents
    are whatever the client posted proves nothing to an examiner. Without an
    entity_id the call keeps its original free-form behaviour, which is what the
    Archiving page's note form uses today.
    """
    try:
        if body.entity_id:
            record = await snapshot_entity(
                db, tenant_id=tenant_id, entity_type=body.entity_type,
                entity_id=body.entity_id, reason=body.reason,
                retention_days=body.retention_days, archived_by_id=current_user.id,
            )
        else:
            record = await create_archive_record(
                db, tenant_id=tenant_id, entity_type=body.entity_type, entity_id=None,
                payload=body.payload or {},
                # ArchiveRecord.reason is String(300); SQLite silently accepts a
                # longer value but PostgreSQL — the production target — refuses
                # the INSERT outright, so truncate at the boundary the column
                # declares rather than at the one the current database tolerates.
                reason=(body.reason[:300] if body.reason else None),
                retention_days=body.retention_days, archived_by_id=current_user.id,
            )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await _log_archive(db, tenant_id, current_user, record)
    return record


@router.get("", response_model=list[ArchiveOut])
async def list_archives(
    current_user: Annotated[User, Depends(_read_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_type: str | None = None,
    # Bounded: an unvalidated int let ?limit=-1 through, and SQL reads a negative
    # LIMIT as "no limit" — the one value that undoes the cap this line exists for.
    limit: int = Query(200, ge=1, le=1000),
):
    query = select(ArchiveRecord).where(ArchiveRecord.tenant_id == tenant_id)
    if entity_type:
        query = query.where(ArchiveRecord.entity_type == entity_type)
    query = query.order_by(ArchiveRecord.archived_at.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


class ArchivingRuleIn(BaseModel):
    entity_type: str
    criteria: str            # e.g. "status=closed AND age_days>365"
    enabled: bool = True
    retention_days: int | None = None


class ArchivingRuleOut(BaseModel):
    id: str
    entity_type: str
    criteria: str
    enabled: bool
    retention_days: int | None
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_result: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# NOTE: registered ahead of GET /{archive_id} below so "/rules" resolves to this
# router, not to the single-segment archive_id path parameter.
@router.get("/rules", response_model=list[ArchivingRuleOut])
async def list_archiving_rules(
    current_user: Annotated[User, Depends(_read_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ArchivingRule).where(ArchivingRule.tenant_id == tenant_id)
        .order_by(ArchivingRule.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/rules", response_model=ArchivingRuleOut, status_code=201)
async def create_archiving_rule(
    body: ArchivingRuleIn,
    current_user: Annotated[User, Depends(_manage_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.entity_type not in ARCHIVABLE_ENTITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported entity_type {body.entity_type!r}. Supported: {sorted(ARCHIVABLE_ENTITIES)}",
        )
    try:
        parse_criteria(body.criteria)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if body.retention_days is not None and body.retention_days < 0:
        raise HTTPException(status_code=422, detail="retention_days must be >= 0")

    rule = ArchivingRule(
        tenant_id=tenant_id, entity_type=body.entity_type, criteria=body.criteria,
        enabled=body.enabled, retention_days=body.retention_days,
        next_run_at=_utcnow(),  # due immediately so the next scheduler tick picks it up
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_archiving_rule(
    rule_id: str,
    current_user: Annotated[User, Depends(_manage_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ArchivingRule).where(ArchivingRule.id == rule_id, ArchivingRule.tenant_id == tenant_id)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Archiving rule not found")
    await db.delete(rule)
    await db.commit()


@router.get("/{archive_id}", response_model=ArchiveOut)
async def get_archive(
    archive_id: str,
    current_user: Annotated[User, Depends(_read_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ArchiveRecord).where(
            ArchiveRecord.id == archive_id, ArchiveRecord.tenant_id == tenant_id
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Archive record not found")
    return record


class ArchivedEvidenceOut(BaseModel):
    """One evidence file as the snapshot recorded it, plus where it stands now."""
    id: str | None = None
    name: str | None = None
    file_name: str | None = None
    content_type: str | None = None
    file_size_bytes: int | None = None
    file_sha256: str | None = None
    finding_id: str | None = None
    uploaded_by_id: str | None = None
    # stored | not_stored | missing, or a file_integrity verdict when verify=true
    integrity: str
    downloadable: bool


class ArchiveContentOut(BaseModel):
    record: ArchiveOut
    archived_by_email: str | None = None
    # snapshot = read out of the archived payload (the durable answer)
    # live     = rebuilt from the still-existing row, for records archived
    #            before children were captured
    # none     = nothing to show
    children_source: str
    children: dict[str, list[dict]] = {}
    evidence: list[ArchivedEvidenceOut] = []


@router.get("/{archive_id}/content", response_model=ArchiveContentOut)
async def get_archive_content(
    archive_id: str,
    current_user: Annotated[User, Depends(_read_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    verify: bool = Query(
        False,
        description="Re-read every archived evidence file and compare it against "
                    "the sha256 taken at upload. Off by default: it streams the "
                    "bytes of every file, which a listing should not do.",
    ),
):
    """Read an archived record back WITH its children — objectif 8.

    Consultation « sans restauration » only means something if what comes back is
    the whole engagement: the audit row, its constats, its recommendations and
    the evidence that was attached to it. Records archived before children were
    captured fall back to rebuilding from the live row when it still exists, and
    say so via children_source rather than pretending the snapshot held it.
    """
    record = (await db.execute(
        select(ArchiveRecord).where(
            ArchiveRecord.id == archive_id, ArchiveRecord.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Archive record not found")

    children, source = await _resolve_children(db, tenant_id, record)

    evidence: list[ArchivedEvidenceOut] = []
    for item in children.get("evidence") or []:
        rel = item.get("file_path")
        full = _archived_file_path(tenant_id, rel)
        if not rel:
            # Rows created before audit evidence could carry bytes: a described
            # attachment, not a missing file. Saying "missing" here would report
            # a design gap as a lost document.
            integrity, downloadable = "not_stored", False
        elif full is None or not full.is_file():
            integrity, downloadable = file_integrity.MISSING, False
        elif verify:
            integrity, _actual = await asyncio.to_thread(
                file_integrity.verify_file, full, item.get("file_sha256")
            )
            # UNREADABLE means the bytes are there but cannot be opened, so the
            # download route cannot serve them either — offering the link would
            # produce a broken response mid-stream rather than a clean refusal.
            downloadable = integrity not in (file_integrity.MISSING, file_integrity.UNREADABLE)
        else:
            integrity, downloadable = "stored", True
        # Coerced, not passed straight through: on the free-form POST path the
        # payload is the client's own JSON, and a non-string id or a
        # non-numeric size would fail response validation — a 500 on a READ of
        # an already-stored record, which no amount of retrying fixes.
        evidence.append(ArchivedEvidenceOut(
            id=_as_str(item.get("id")), name=_as_str(item.get("name")),
            file_name=_as_str(item.get("file_name")),
            content_type=_as_str(item.get("content_type")),
            file_size_bytes=_as_int(item.get("file_size_bytes")),
            file_sha256=_as_str(item.get("file_sha256")),
            finding_id=_as_str(item.get("finding_id")),
            uploaded_by_id=_as_str(item.get("uploaded_by_id")),
            integrity=integrity, downloadable=downloadable,
        ))

    archived_by_email = None
    if record.archived_by_id:
        archived_by_email = (await db.execute(
            select(User.email).where(User.id == record.archived_by_id)
        )).scalar_one_or_none()

    return ArchiveContentOut(
        record=ArchiveOut.model_validate(record),
        archived_by_email=archived_by_email,
        children_source=source,
        children=children,
        evidence=evidence,
    )


async def _may_override_integrity(db: AsyncSession, user: User) -> bool:
    """Who can retrieve a file whose checksum no longer matches: admins and CISO.

    Effective roles, not the scalar column, so a CISO granted through a Group can
    override and one carved out via excluded_roles cannot — same rule the
    compliance evidence download applies.
    """
    if user.role in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
        return True
    from app.services.authz import get_effective_roles
    return UserRole.CISO.value in await get_effective_roles(user, db)


@router.get("/{archive_id}/evidence/{evidence_id}/download")
async def download_archived_evidence(
    archive_id: str,
    evidence_id: str,
    current_user: Annotated[User, Depends(_read_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    acknowledge_integrity_failure: bool = Query(
        False,
        description="CISO override: serve a file whose checksum no longer matches, "
                    "so a damaged or altered file can still be investigated.",
    ),
):
    """Serve an archived evidence file — « accès aux preuves archivées ».

    Reached through the ARCHIVE, so it keeps answering after the audit row it
    came from has been deleted, which the module's own download route cannot.
    The snapshot holds the path and the digest; the bytes are still the originals,
    so the same integrity guard applies: a file that no longer matches what was
    uploaded is refused rather than handed over as if it were intact.

    The integrity gate is written out here rather than imported from compliance:
    this file already keeps its cross-module helpers local on purpose (see
    _archives_to_pdf), and a security check should not depend on another
    endpoint module's private function staying private and staying named.
    """
    record = (await db.execute(
        select(ArchiveRecord).where(
            ArchiveRecord.id == archive_id, ArchiveRecord.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Archive record not found")

    # Same resolution as GET /{id}/content — including its fallback to the live
    # row for records archived before children were captured. Reading only the
    # payload here made /content advertise a downloadable preuve that this route
    # then denied with 404.
    children, _source = await _resolve_children(db, tenant_id, record)
    item = next(
        (e for e in (children.get("evidence") or []) if e.get("id") == evidence_id),
        None,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Evidence not found in this archive")

    full = _archived_file_path(tenant_id, item.get("file_path"))
    if full is None or not full.is_file():
        raise HTTPException(
            status_code=404,
            detail="The archived evidence file is no longer on disk.",
        )

    # Coerced for the same reason as in the content view: everything below —
    # the digest comparison, the response headers, the download filename —
    # comes out of a JSON column that the free-form POST path lets a client
    # write, and a non-string here would blow up while building the response.
    recorded_sha = _as_str(item.get("file_sha256"))
    status_, actual = await asyncio.to_thread(
        file_integrity.verify_file, full, recorded_sha
    )
    if status_ == file_integrity.MODIFIED:
        may_override = await _may_override_integrity(db, current_user)
        if not (acknowledge_integrity_failure and may_override):
            logger.error(
                "file.integrity.failed archived evidence %s tenant=%s expected=%s actual=%s",
                evidence_id, tenant_id, recorded_sha, actual,
            )
            detail = ("This file no longer matches the checksum recorded when it was "
                      "uploaded and may have been altered.")
            detail += (" A CISO can retrieve it for investigation with "
                       "?acknowledge_integrity_failure=true." if may_override
                       else " Contact your administrator.")
            raise HTTPException(status_code=409, detail=detail)
        logger.warning(
            "file.integrity.override archived evidence %s tenant=%s by=%s",
            evidence_id, tenant_id, current_user.id,
        )
    elif status_ == file_integrity.UNREADABLE:
        # The file is on disk but cannot be opened. Handing it to FileResponse
        # would fail while the response was already being streamed, so the
        # caller would see a truncated download instead of an explanation.
        logger.error(
            "file.integrity.unreadable archived evidence %s tenant=%s path=%s",
            evidence_id, tenant_id, full,
        )
        raise HTTPException(
            status_code=409,
            detail="The archived evidence file is present but cannot be read. "
                   "Contact your administrator.",
        )

    response = FileResponse(
        path=str(full),
        filename=_as_str(item.get("file_name")) or _as_str(item.get("name")) or "evidence",
        media_type=_as_str(item.get("content_type")) or "application/octet-stream",
    )
    response.headers["X-Content-Integrity"] = status_
    if recorded_sha:
        response.headers["X-Content-SHA256"] = recorded_sha
    if actual and status_ == file_integrity.MODIFIED:
        response.headers["X-Content-SHA256-Actual"] = actual
    return response


def _payload_digest(payload: dict | None) -> str:
    """Stable digest of a snapshot, so a purged record stays identifiable."""
    return hashlib.sha256(
        json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


@router.post("/purge-expired")
async def purge_expired(
    current_user: Annotated[User, Depends(_purge_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    reason: str = Query(
        ..., min_length=5,
        description="Written justification for destroying these records — sealed "
                    "into the audit trail with the manifest of what was purged.",
    ),
    dry_run: bool = Query(
        False, description="List what would be destroyed without deleting anything."
    ),
):
    """Enforce retention: delete records whose retention_until has passed.

    Objectif 8 asks the register to be durable. Purging is the one operation here
    that destroys evidence permanently, so it is now a tenant_admin act, it takes
    a written reason, and before the rows go the trail keeps a manifest of them —
    id, entity, archived_at, and a digest of the payload — plus a digest over the
    whole manifest. What was destroyed, by whom and why therefore stays
    answerable even though the records themselves are gone.
    """
    now = _utcnow()
    expired = list((await db.execute(
        select(ArchiveRecord).where(
            ArchiveRecord.tenant_id == tenant_id,
            ArchiveRecord.retention_until.is_not(None),
            ArchiveRecord.retention_until < now,
        ).order_by(ArchiveRecord.archived_at.asc())
    )).scalars().all())

    manifest = [
        {
            "id": r.id,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "name": _display_name(r.payload),
            "reason": r.reason,
            "archived_at": r.archived_at.isoformat() if r.archived_at else None,
            "retention_until": r.retention_until.isoformat() if r.retention_until else None,
            "payload_sha256": _payload_digest(r.payload),
        }
        for r in expired
    ]
    manifest_sha256 = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    if dry_run:
        return {
            "purged": 0, "would_purge": len(manifest), "dry_run": True,
            "manifest_sha256": manifest_sha256, "records": manifest[:_MANIFEST_LIMIT],
        }

    if manifest:
        # Delete by the exact ids that were just read, not by re-evaluating the
        # retention predicate: with 2 uvicorn workers a concurrent purge (or a
        # record whose retention lapses between the two statements) would
        # otherwise destroy rows this manifest never mentions.
        await db.execute(
            delete(ArchiveRecord).where(
                ArchiveRecord.tenant_id == tenant_id,
                ArchiveRecord.id.in_([m["id"] for m in manifest]),
            )
        )
        await db.commit()
        # Sealed after the deletion committed, matching risk_matrices' order: an
        # entry describing a purge that did not happen would be worse than one
        # written a moment late, and chain_and_add never raises.
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="purge", entity_type="archive_record",
            entity_id=None, entity_name=f"{len(manifest)} archived record(s)",
            details={
                "reason": reason,
                "purged": len(manifest),
                "manifest_sha256": manifest_sha256,
                "manifest_truncated": len(manifest) > _MANIFEST_LIMIT,
                "records": manifest[:_MANIFEST_LIMIT],
                "purged_at": now.isoformat(timespec="seconds"),
            },
        ))

    return {
        "purged": len(manifest), "dry_run": False,
        "manifest_sha256": manifest_sha256, "records": manifest[:_MANIFEST_LIMIT],
    }


@router.get("/export/download")
async def export_archives(
    current_user: Annotated[User, Depends(_read_access)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_type: str | None = None,
    format: str = "xlsx",
):
    if format not in ("xlsx", "csv", "pdf"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx', 'csv', or 'pdf'")
    query = select(ArchiveRecord).where(ArchiveRecord.tenant_id == tenant_id)
    if entity_type:
        query = query.where(ArchiveRecord.entity_type == entity_type)
    result = await db.execute(query.order_by(ArchiveRecord.archived_at.desc()).limit(10000))
    rows = [
        {
            "id": r.id, "entity_type": r.entity_type, "entity_id": r.entity_id,
            "reason": r.reason,
            "archived_at": r.archived_at.isoformat() if r.archived_at else None,
            "retention_until": r.retention_until.isoformat() if r.retention_until else None,
        }
        for r in result.scalars().all()
    ]
    if format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_EXPORT_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="archives.csv"'},
        )
    if format == "pdf":
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
        org_name = getattr(tenant, "name", None) or "Organization"
        # ReportLab lays the whole table out synchronously; on 10 000 rows that
        # is seconds of CPU, and doing it inline would stall every other request
        # on this worker's event loop.
        pdf_bytes = await asyncio.to_thread(_archives_to_pdf, org_name, rows)
        return Response(
            content=pdf_bytes, media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="archives.pdf"'},
        )
    data = await asyncio.to_thread(rows_to_xlsx, "Archives", _EXPORT_COLUMNS, rows)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="archives.xlsx"'},
    )


def _archives_to_pdf(org: str, rows: list[dict]) -> bytes:
    """Simple tabular PDF export — same columns as the CSV/Excel export.

    Reuses the ReportLab stack already used by app.services.report_generator
    (no new PDF dependency), kept self-contained here rather than importing that
    module's underscore-prefixed helpers directly.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, HRFlowable

    navy = colors.HexColor("#1a2332")
    gray_700 = colors.HexColor("#374151")
    gray_500 = colors.HexColor("#6b7280")
    gray_300 = colors.HexColor("#d1d5db")
    gray_100 = colors.HexColor("#f3f4f6")
    white = colors.white

    buf = BytesIO()
    page_size = landscape(A4)
    page_w = page_size[0] - 1.2 * inch
    doc = SimpleDocTemplate(
        buf, pagesize=page_size,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch,
    )
    styles = getSampleStyleSheet()

    els = [
        HRFlowable(width="100%", thickness=2, color=navy, spaceAfter=8),
        Paragraph(org.upper(), ParagraphStyle("ArchOrg", fontName="Helvetica", fontSize=8, textColor=gray_500)),
        Paragraph("Archive Records Export", ParagraphStyle("ArchTitle", fontName="Helvetica-Bold", fontSize=16, textColor=navy, spaceAfter=4)),
        Paragraph(
            f"Generated {datetime.utcnow().strftime('%d %b %Y, %H:%M UTC')} — {len(rows)} record(s)",
            ParagraphStyle("ArchMeta", fontName="Helvetica", fontSize=8, textColor=gray_500, spaceAfter=12),
        ),
        HRFlowable(width="100%", thickness=0.5, color=gray_300, spaceAfter=14),
    ]

    headers = ["Archive ID", "Entity Type", "Entity ID", "Reason", "Archived At", "Retention Until"]
    if not rows:
        els.append(Paragraph("<i>No archive records match this export.</i>", styles["Normal"]))
    else:
        widths = [page_w * 0.14, page_w * 0.14, page_w * 0.14, page_w * 0.30, page_w * 0.14, page_w * 0.14]
        data = [headers] + [
            [
                (r["id"] or "—")[:12], r["entity_type"] or "—", (r["entity_id"] or "—")[:12],
                (r["reason"] or "—")[:60], (r["archived_at"] or "—")[:19], (r["retention_until"] or "—")[:19],
            ]
            for r in rows
        ]
        t = Table(data, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), navy),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -1), 7.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), gray_700),
            ("TOPPADDING", (0, 1), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, gray_100]),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, gray_300),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        els.append(t)

    els.append(Paragraph(
        "CONFIDENTIAL — This export is auto-generated by the GRC Platform. "
        "Distribution is restricted to authorized personnel only.",
        ParagraphStyle("ArchFooter", fontName="Helvetica", fontSize=6.5, textColor=gray_500, alignment=TA_CENTER, spaceBefore=20),
    ))
    doc.build(els)
    return buf.getvalue()
