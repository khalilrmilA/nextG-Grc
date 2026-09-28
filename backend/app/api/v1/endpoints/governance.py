"""Governance endpoints (Elite Pack) — RACI matrix + document repository.

RFP module 11:
- RACI matrix, filterable by role/entity/module (gated ``raci_governance``).
- Unified document repository with typology/module/entity classification,
  version control that archives previous versions, and a per-document access
  level (read/edit/validate) (gated ``document_repository``).
- M11.3: a real per-user/per-role ACL (``GovernanceDocumentAccess``) layered on
  top of the document-level access_level, for documents that need finer-grained
  permissions than one tenant-wide flag. It governs reads as well as writes: a
  document that carries explicit grants is visible only to its owner, an
  elevated role, or a grantee. A document with no grants is unaffected.

RFP module 14:
- M14.6: steering committee ("comité de pilotage") tracking (``GovernanceCommittee``)
  — distinct from RACI, which records responsibilities, not governance bodies
  (gated ``raci_governance``).

STB tender, objectif 6 (« mise à jour mensuelle »):
- GET /trend returns one governance point per calendar month, read from the
  daily ``trend_snapshots`` history and degrading to an intake-volume proxy
  while that history is still empty.
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.governance import (
    RaciAssignment, GovernanceDocument, GovernanceDocumentVersion, GovernanceGroup,
    GovernanceDocumentAccess, GovernanceCommittee,
)
from app.models.notification import NotificationType
from app.models.policy import Policy
from app.models.trend_snapshot import METRIC_GOVERNANCE, month_buckets
from app.api.v1.dependencies.auth import (
    get_current_user, get_tenant_id, require_roles, require_roles_strict,
)
from app.api.v1.dependencies.features import require_feature
from app.services.notification_generator import create_notification, notification_exists
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add
from app.services.file_integrity import sha256_bytes
from app.services.trend_snapshot_scheduler import snapshot_series, unavailable_series

router = APIRouter()

_VALID_RACI = {"R", "A", "C", "I"}
_VALID_ACCESS = {"read", "edit", "validate"}
# Roles that may modify a document regardless of its access_level (mirrors the
# require_roles() convention used elsewhere: tenant_admin/super_admin always have
# full access; CISO is the elevated governance role for this module).
_DOCUMENT_ELEVATED_ROLES = {UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.CISO}

# require_feature() answers one question — "is this capability in the tenant's
# plan" — and it was the only thing standing in front of every mutation in this
# file. A billing gate is not an access check: any role the plan admitted (an
# auditor, a vendor manager, a control owner) could rewrite or delete the RACI
# matrix that says who answers for what, the groups it assigns work to, and the
# steering committees that oversee it — the accountability record they are
# themselves measured against. These are the roles the product already treats as
# the governance owners (Layout.tsx gates /governance to exactly this set);
# tenant_admin and super_admin auto-pass via require_roles(), and viewer /
# executive are blocked from every write in get_current_user.
#
# Document read/write is NOT gated on this: those routes carry a real
# per-document owner + ACL check of their own (see _can_write_document), and
# forcing a role on top would break a grant made to somebody outside this set.
_GOVERNANCE_WRITERS = require_roles(
    UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.POLICY_MANAGER,
)


async def _assert_tenant_users(db: AsyncSession, tenant_id: str, user_ids) -> None:
    """Refuse user ids that are not members of this organization.

    RACI lines, group rosters and committee memberships hold bare id strings with
    no foreign key, so an id from another tenant is stored happily and then
    resolves to nobody for everyone who reads the matrix afterwards.
    """
    wanted = {u for u in (user_ids or []) if u}
    if not wanted:
        return
    found = {r[0] for r in (await db.execute(
        select(User.id).where(User.id.in_(wanted), User.tenant_id == tenant_id)
    )).all()}
    missing = wanted - found
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown user(s) for this organization: {sorted(missing)}",
        )


async def _assert_tenant_group(db: AsyncSession, tenant_id: str, group_id: str | None) -> None:
    """Same, for the governance group a RACI line can be assigned to."""
    if not group_id:
        return
    found = (await db.execute(
        select(GovernanceGroup.id).where(
            GovernanceGroup.id == group_id, GovernanceGroup.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if found is None:
        raise HTTPException(status_code=422, detail="Unknown group for this organization")


# ---------------------------------------------------------------------------
# RACI matrix
# ---------------------------------------------------------------------------
class RaciIn(BaseModel):
    activity: str
    responsible_type: str = "role"     # role | user | group
    role: str | None = None            # free text — custom roles are supported as-is
    user_id: str | None = None
    group_id: str | None = None
    raci: str                          # R | A | C | I
    module: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None


class RaciOut(BaseModel):
    id: str
    activity: str
    responsible_type: str
    role: str | None
    user_id: str | None
    group_id: str | None
    raci: str
    module: str | None
    entity_type: str | None
    entity_id: str | None
    model_config = {"from_attributes": True}


class RaciUpdate(BaseModel):
    activity: str | None = None
    responsible_type: str | None = None     # role | user | group
    role: str | None = None
    user_id: str | None = None
    group_id: str | None = None
    raci: str | None = None                 # R | A | C | I
    module: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None


@router.get("/raci", response_model=list[RaciOut])
async def list_raci(
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    module: str | None = None,
    role: str | None = None,
    entity_type: str | None = None,
):
    query = select(RaciAssignment).where(RaciAssignment.tenant_id == tenant_id)
    if module:
        query = query.where(RaciAssignment.module == module)
    if role:
        query = query.where(RaciAssignment.role == role)
    if entity_type:
        query = query.where(RaciAssignment.entity_type == entity_type)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/raci/roles/preview", response_model=list[RaciOut])
async def preview_role(
    role: str,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """All RACI assignments currently held by a given role (built-in or custom) —
    lets an admin preview what a role is responsible for before assigning it further."""
    result = await db.execute(
        select(RaciAssignment).where(RaciAssignment.tenant_id == tenant_id, RaciAssignment.role == role)
    )
    return list(result.scalars().all())


@router.post("/raci", response_model=RaciOut, status_code=201)
async def create_raci(
    body: RaciIn,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    raci = body.raci.strip().upper()
    if raci not in _VALID_RACI:
        raise HTTPException(status_code=422, detail="raci must be one of R, A, C, I")
    if body.responsible_type not in ("role", "user", "group"):
        raise HTTPException(status_code=422, detail="responsible_type must be 'role', 'user', or 'group'")
    await _assert_tenant_users(db, tenant_id, [body.user_id])
    await _assert_tenant_group(db, tenant_id, body.group_id)
    row = RaciAssignment(
        tenant_id=tenant_id, activity=body.activity, responsible_type=body.responsible_type,
        role=body.role, user_id=body.user_id, group_id=body.group_id, raci=raci, module=body.module,
        entity_type=body.entity_type, entity_id=body.entity_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/raci/{raci_id}", response_model=RaciOut)
async def update_raci(
    raci_id: str,
    body: RaciUpdate,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(RaciAssignment).where(RaciAssignment.id == raci_id, RaciAssignment.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="RACI assignment not found")

    if body.raci is not None:
        raci = body.raci.strip().upper()
        if raci not in _VALID_RACI:
            raise HTTPException(status_code=422, detail="raci must be one of R, A, C, I")
        body.raci = raci
    if body.responsible_type is not None and body.responsible_type not in ("role", "user", "group"):
        raise HTTPException(status_code=422, detail="responsible_type must be 'role', 'user', or 'group'")
    await _assert_tenant_users(db, tenant_id, [body.user_id])
    await _assert_tenant_group(db, tenant_id, body.group_id)

    old_user_id = row.user_id
    new_responsible_type = body.responsible_type if body.responsible_type is not None else row.responsible_type

    for f in ["activity", "responsible_type", "role", "user_id", "group_id", "raci", "module", "entity_type", "entity_id"]:
        v = getattr(body, f, None)
        if v is not None:
            setattr(row, f, v)

    # "Responsible changed" only makes sense when the assignment is user-scoped and the
    # user_id actually moved to a different person.
    responsible_changed = (
        new_responsible_type == "user"
        and body.user_id is not None
        and body.user_id != old_user_id
    )

    await db.commit()
    await db.refresh(row)

    if responsible_changed:
        if row.user_id:
            new_result = await db.execute(select(User).where(User.id == row.user_id, User.tenant_id == tenant_id))
            new_user = new_result.scalar_one_or_none()
            if new_user and not await notification_exists(
                db, new_user.id, NotificationType.RACI_RESPONSIBLE_CHANGED, row.id, within_days=1
            ):
                await create_notification(
                    db,
                    user=new_user,
                    notif_type=NotificationType.RACI_RESPONSIBLE_CHANGED,
                    title=f"You are now responsible for: {row.activity[:60]}",
                    message=f"You have been assigned as the responsible (R) party for '{row.activity}'.",
                    entity_id=row.id,
                    entity_type="raci_assignment",
                    link="/governance",
                    severity="info",
                    title_key="notifications.raci_responsible_assigned.title",
                    message_key="notifications.raci_responsible_assigned.message",
                    params={"activity": row.activity},
                )
        if old_user_id and old_user_id != row.user_id:
            old_result = await db.execute(select(User).where(User.id == old_user_id, User.tenant_id == tenant_id))
            old_user = old_result.scalar_one_or_none()
            if old_user:
                await create_notification(
                    db,
                    user=old_user,
                    notif_type=NotificationType.RACI_RESPONSIBLE_CHANGED,
                    title=f"Responsibility reassigned: {row.activity[:60]}",
                    message=f"You are no longer the responsible (R) party for '{row.activity}'.",
                    entity_id=row.id,
                    entity_type="raci_assignment",
                    link="/governance",
                    severity="info",
                    title_key="notifications.raci_responsible_removed.title",
                    message_key="notifications.raci_responsible_removed.message",
                    params={"activity": row.activity},
                )
        await db.commit()

    return row


@router.delete("/raci/{raci_id}", status_code=204)
async def delete_raci(
    raci_id: str,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(RaciAssignment).where(RaciAssignment.id == raci_id, RaciAssignment.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="RACI assignment not found")
    await db.delete(row)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Groups (collections of users assignable to a RACI role)
# ---------------------------------------------------------------------------
class GroupIn(BaseModel):
    name: str
    description: str | None = None
    member_ids: list[str] = []


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    member_ids: list[str] | None = None


class GroupOut(BaseModel):
    id: str
    name: str
    description: str | None
    member_ids: list
    model_config = {"from_attributes": True}


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(GovernanceGroup).where(GovernanceGroup.tenant_id == tenant_id))
    return list(result.scalars().all())


@router.post("/groups", response_model=GroupOut, status_code=201)
async def create_group(
    body: GroupIn,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _assert_tenant_users(db, tenant_id, body.member_ids)
    group = GovernanceGroup(
        tenant_id=tenant_id, name=body.name, description=body.description, member_ids=body.member_ids,
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: str,
    body: GroupUpdate,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(GovernanceGroup).where(GovernanceGroup.id == group_id, GovernanceGroup.tenant_id == tenant_id)
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    await _assert_tenant_users(db, tenant_id, body.member_ids)
    for f in ["name", "description", "member_ids"]:
        v = getattr(body, f, None)
        if v is not None:
            setattr(group, f, v)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(
    group_id: str,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(GovernanceGroup).where(GovernanceGroup.id == group_id, GovernanceGroup.tenant_id == tenant_id)
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    # RaciAssignment.group_id carries no foreign key, so deleting a group used to
    # leave every RACI line that named it pointing at nothing — the matrix went on
    # displaying an accountable party that no longer existed, which is worse than
    # showing none. Refuse instead of silently emptying the assignment; the same
    # reasoning delete_document applies to its dependent rows.
    referencing = (await db.execute(
        select(RaciAssignment).where(
            RaciAssignment.tenant_id == tenant_id,
            RaciAssignment.group_id == group_id,
        )
    )).scalars().all()
    if referencing:
        activities = sorted({r.activity for r in referencing})[:5]
        raise HTTPException(
            status_code=409,
            detail=(f"This group is still assigned in {len(referencing)} RACI line(s) "
                    f"({', '.join(activities)}). Reassign or remove them first."),
        )
    await db.delete(group)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Document repository
# ---------------------------------------------------------------------------
class DocumentIn(BaseModel):
    title: str
    typology: str = "policy"
    module: str | None = None
    entity: str | None = None
    access_level: str = "read"
    content: str | None = None


class DocumentUpdate(BaseModel):
    title: str | None = None
    typology: str | None = None
    module: str | None = None
    entity: str | None = None
    access_level: str | None = None
    content: str | None = None
    change_summary: str | None = None


class DocumentOut(BaseModel):
    id: str
    title: str
    typology: str
    module: str | None
    entity: str | None
    current_version: int
    access_level: str
    content: str | None
    model_config = {"from_attributes": True}


class DocumentVersionOut(BaseModel):
    id: str
    version_number: int
    content: str | None
    change_summary: str | None
    model_config = {"from_attributes": True}


_VALID_DOC_PERMISSIONS = {"view", "edit", "validate"}
_DOC_WRITE_PERMISSIONS = {"edit", "validate"}


async def _document_acl_rows(db: AsyncSession, document_id: str, tenant_id: str) -> list[GovernanceDocumentAccess]:
    result = await db.execute(
        select(GovernanceDocumentAccess).where(
            GovernanceDocumentAccess.document_id == document_id,
            GovernanceDocumentAccess.tenant_id == tenant_id,
        )
    )
    return list(result.scalars().all())


def _is_document_owner_or_elevated(doc: GovernanceDocument, current_user: User) -> bool:
    is_owner = doc.created_by_id is not None and doc.created_by_id == current_user.id
    is_elevated = current_user.role in _DOCUMENT_ELEVATED_ROLES
    return is_owner or is_elevated


def _passes_document_grants(doc: GovernanceDocument, grants, current_user: User) -> bool:
    """Whether ``current_user`` may READ ``doc``, given that document's ACL rows.

    "view" was accepted by POST /documents/{id}/access, validated, stored — and
    then read by nothing: only _DOC_WRITE_PERMISSIONS was ever consulted, and
    reads were open to the whole tenant regardless. So an owner who restricted a
    minutes document to three named people got a document three named people
    could edit and everyone could read, with no indication the grant had no
    effect. Any grant (view, edit or validate) admits its holder.

    Precedence mirrors _can_write_document exactly: owner and elevated roles
    always pass; when the document carries explicit grants they govern; with no
    grants at all nothing changes and the document stays readable tenant-wide,
    as every existing document is today.
    """
    if _is_document_owner_or_elevated(doc, current_user):
        return True
    if not grants:
        return True
    return any(
        (g.user_id and g.user_id == current_user.id)
        or (g.role and g.role == current_user.role)
        for g in grants
    )


async def _assert_can_read_document(
    db: AsyncSession, doc: GovernanceDocument, current_user: User, tenant_id: str
) -> GovernanceDocument:
    if not _passes_document_grants(doc, await _document_acl_rows(db, doc.id, tenant_id), current_user):
        # 404, not 403: a restricted document's existence is itself part of what
        # the grant list withholds.
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


async def _can_write_document(db: AsyncSession, doc: GovernanceDocument, current_user: User, tenant_id: str) -> bool:
    """True if ``current_user`` may modify ``doc`` (M11.3 — per-document ACL).

    The document's creator and elevated governance roles (tenant admin/CISO/super
    admin) can always write — this preserves the pre-ACL baseline so those roles
    never regress. Otherwise: if the document has explicit ``GovernanceDocumentAccess``
    rows, write access is governed entirely by them (a real per-user/per-role
    permission list — grant an "edit" or "validate" row to unlock writes for that
    user/role). With no ACL rows at all, fall back to the legacy ``access_level``
    behavior (``read`` == locked to everyone but owner/elevated; ``edit``/``validate``
    == open to every tenant member) so existing documents keep working unchanged.
    """
    if _is_document_owner_or_elevated(doc, current_user):
        return True

    grants = await _document_acl_rows(db, doc.id, tenant_id)
    if grants:
        for g in grants:
            if g.permission not in _DOC_WRITE_PERMISSIONS:
                continue
            if g.user_id and g.user_id == current_user.id:
                return True
            if g.role and g.role == current_user.role:
                return True
        return False

    return doc.access_level != "read"


async def _get_doc(db: AsyncSession, doc_id: str, tenant_id: str) -> GovernanceDocument:
    result = await db.execute(
        select(GovernanceDocument).where(
            GovernanceDocument.id == doc_id, GovernanceDocument.tenant_id == tenant_id
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    typology: str | None = None,
    module: str | None = None,
):
    query = select(GovernanceDocument).where(GovernanceDocument.tenant_id == tenant_id)
    if typology:
        query = query.where(GovernanceDocument.typology == typology)
    if module:
        query = query.where(GovernanceDocument.module == module)
    rows = list((await db.execute(query)).scalars().all())
    if not rows:
        return rows
    # One query for every grant on the page, indexed by document — not one query
    # per document.
    grants = (await db.execute(
        select(GovernanceDocumentAccess).where(
            GovernanceDocumentAccess.tenant_id == tenant_id,
            GovernanceDocumentAccess.document_id.in_([d.id for d in rows]),
        )
    )).scalars().all()
    by_doc: dict[str, list[GovernanceDocumentAccess]] = {}
    for g in grants:
        by_doc.setdefault(g.document_id, []).append(g)
    return [d for d in rows if _passes_document_grants(d, by_doc.get(d.id), current_user)]


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def create_document(
    body: DocumentIn,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a document to the governance repository.

    Creation is the one document route the per-document ACL cannot govern — there
    is no document yet, and therefore no owner and no grant to defer to — so it
    was reachable by every role the plan admitted, an external `auditor`
    included. An audit firm writing into the audited organisation's own
    référentiel documentaire is the independence problem a bank tender exists to
    check for, so creation is gated on the governance writers, exactly like the
    RACI matrix and the committees. Reads, edits and deletes keep their ACL
    precedence untouched (see _can_write_document): a grant made to somebody
    outside this set still works.
    """
    if body.access_level not in _VALID_ACCESS:
        raise HTTPException(status_code=422, detail="access_level must be read, edit, or validate")
    doc = GovernanceDocument(
        tenant_id=tenant_id, title=body.title, typology=body.typology, module=body.module,
        entity=body.entity, access_level=body.access_level, content=body.content,
        current_version=1, created_by_id=current_user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/documents/{doc_id}", response_model=DocumentOut)
async def get_document(
    doc_id: str,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)
    return await _assert_can_read_document(db, doc, current_user, tenant_id)


@router.put("/documents/{doc_id}", response_model=DocumentOut)
async def update_document(
    doc_id: str,
    body: DocumentUpdate,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)

    # Per-document access enforcement (M11.3): a real per-user/per-role ACL
    # (GovernanceDocumentAccess) governs writes when grants exist for this document;
    # otherwise the legacy access_level="read" behavior applies. See
    # _can_write_document for the full precedence rules.
    if not await _can_write_document(db, doc, current_user, tenant_id):
        raise HTTPException(
            status_code=403,
            detail="You do not have edit access to this document",
        )

    if body.access_level is not None and body.access_level not in _VALID_ACCESS:
        raise HTTPException(status_code=422, detail="access_level must be read, edit, or validate")

    # If the content changes, archive the current version first.
    if body.content is not None and body.content != doc.content:
        db.add(GovernanceDocumentVersion(
            document_id=doc.id, version_number=doc.current_version,
            content=doc.content, change_summary=body.change_summary,
            authored_by_id=current_user.id,
        ))
        doc.current_version += 1
        doc.content = body.content

    for field in ("title", "typology", "module", "entity", "access_level"):
        value = getattr(body, field)
        if value is not None:
            setattr(doc, field, value)

    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/documents/{doc_id}/versions", response_model=list[DocumentVersionOut])
async def list_document_versions(
    doc_id: str,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)  # tenant ownership check
    # Old versions carry the same content as the document itself, so the same
    # grant list has to govern them or the ACL is trivially bypassed.
    await _assert_can_read_document(db, doc, current_user, tenant_id)
    result = await db.execute(
        select(GovernanceDocumentVersion)
        .where(GovernanceDocumentVersion.document_id == doc_id)
        .order_by(GovernanceDocumentVersion.version_number.desc())
    )
    return list(result.scalars().all())


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)
    # Deletion is the most destructive write on a document, so it is at least as
    # restricted as managing its ACL: only the creator or an elevated governance
    # role may delete. Without this, a user denied edit access by the per-document
    # ACL (or by access_level="read") could still destroy the document outright.
    if not _is_document_owner_or_elevated(doc, current_user):
        raise HTTPException(
            status_code=403,
            detail="Only the document's owner or a CISO/tenant admin can delete this document",
        )
    # GovernanceDocument has no deleted_at to soft-delete into, so an issued
    # document and every version behind it leave the database for good. Record
    # what existed in the tamper-evident chain before it goes: the metadata in
    # full, and each version by number, author and a sha256 of its text rather
    # than the text itself — a document repository's history can run to
    # megabytes, and the chain is not a content store.
    versions = list((await db.execute(
        select(GovernanceDocumentVersion)
        .where(GovernanceDocumentVersion.document_id == doc.id)
        .order_by(GovernanceDocumentVersion.version_number)
    )).scalars().all())
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="delete", entity_type="governance_document", entity_id=doc.id,
            entity_name=doc.title,
            details={"deleted": {
                "title": doc.title, "typology": doc.typology, "module": doc.module,
                "entity": doc.entity, "access_level": doc.access_level,
                "current_version": doc.current_version,
                "created_by_id": doc.created_by_id,
                "content_sha256": sha256_bytes((doc.content or "").encode("utf-8")),
                "content_length": len(doc.content or ""),
            }, "versions": [
                {"version_number": v.version_number, "authored_by_id": v.authored_by_id,
                 "change_summary": v.change_summary,
                 "content_sha256": sha256_bytes((v.content or "").encode("utf-8")),
                 "content_length": len(v.content or "")}
                for v in versions
            ]},
            origin="api",
        ))
    except Exception:
        # Log-and-continue: a chain failure must not leave the delete half-done.
        pass

    # Remove dependent rows in the same transaction: the FKs carry no ON DELETE
    # cascade, so on FK-enforcing databases (PostgreSQL/Oracle/MSSQL) leaving them
    # would raise an IntegrityError, and on SQLite they would linger as orphans.
    await db.execute(
        delete(GovernanceDocumentAccess).where(
            GovernanceDocumentAccess.document_id == doc.id,
            GovernanceDocumentAccess.tenant_id == tenant_id,
        )
    )
    await db.execute(
        delete(GovernanceDocumentVersion).where(GovernanceDocumentVersion.document_id == doc.id)
    )
    await db.delete(doc)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Document access (M11.3 — per-user/per-role ACL)
# ---------------------------------------------------------------------------
class DocumentAccessIn(BaseModel):
    user_id: str | None = None
    role: str | None = None            # free text — mirrors RaciAssignment.role
    permission: str = "view"           # view | edit | validate


class DocumentAccessOut(BaseModel):
    id: str
    document_id: str
    user_id: str | None
    role: str | None
    permission: str
    granted_by_id: str | None
    model_config = {"from_attributes": True}


@router.get("/documents/{doc_id}/access", response_model=list[DocumentAccessOut])
async def list_document_access(
    doc_id: str,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)
    if not _is_document_owner_or_elevated(doc, current_user):
        raise HTTPException(
            status_code=403,
            detail="Only the document's owner or a CISO/tenant admin can view its access list",
        )
    return await _document_acl_rows(db, doc.id, tenant_id)


@router.post("/documents/{doc_id}/access", response_model=DocumentAccessOut, status_code=201)
async def add_document_access(
    doc_id: str,
    body: DocumentAccessIn,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)
    if not _is_document_owner_or_elevated(doc, current_user):
        raise HTTPException(
            status_code=403,
            detail="Only the document's owner or a CISO/tenant admin can grant access",
        )
    if bool(body.user_id) == bool(body.role):
        raise HTTPException(status_code=422, detail="Set exactly one of user_id or role")
    if body.permission not in _VALID_DOC_PERMISSIONS:
        raise HTTPException(status_code=422, detail="permission must be view, edit, or validate")
    if body.user_id:
        result = await db.execute(select(User).where(User.id == body.user_id, User.tenant_id == tenant_id))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="User not found in this tenant")

    grant = GovernanceDocumentAccess(
        tenant_id=tenant_id, document_id=doc.id, user_id=body.user_id, role=body.role,
        permission=body.permission, granted_by_id=current_user.id,
    )
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return grant


@router.delete("/documents/{doc_id}/access/{access_id}", status_code=204)
async def revoke_document_access(
    doc_id: str,
    access_id: str,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)
    if not _is_document_owner_or_elevated(doc, current_user):
        raise HTTPException(
            status_code=403,
            detail="Only the document's owner or a CISO/tenant admin can revoke access",
        )
    result = await db.execute(
        select(GovernanceDocumentAccess).where(
            GovernanceDocumentAccess.id == access_id,
            GovernanceDocumentAccess.document_id == doc_id,
            GovernanceDocumentAccess.tenant_id == tenant_id,
        )
    )
    grant = result.scalar_one_or_none()
    if grant is None:
        raise HTTPException(status_code=404, detail="Access grant not found")
    await db.delete(grant)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Steering committees (M14.6 — "comité de pilotage", distinct from RACI)
# ---------------------------------------------------------------------------
_VALID_CADENCE = {"monthly", "quarterly", "annual", "ad_hoc"}


class CommitteeIn(BaseModel):
    name: str
    description: str | None = None
    cadence: str = "quarterly"
    member_ids: list[str] = []
    linked_policy_ids: list[str] = []
    linked_document_ids: list[str] = []
    next_meeting_date: str | None = None


class CommitteeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    cadence: str | None = None
    member_ids: list[str] | None = None
    linked_policy_ids: list[str] | None = None
    linked_document_ids: list[str] | None = None
    next_meeting_date: str | None = None


class CommitteeOut(BaseModel):
    id: str
    name: str
    description: str | None
    cadence: str
    member_ids: list
    linked_policy_ids: list
    linked_document_ids: list
    next_meeting_date: str | None
    created_by_id: str | None
    model_config = {"from_attributes": True}


@router.get("/committees", response_model=list[CommitteeOut])
async def list_committees(
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(GovernanceCommittee).where(GovernanceCommittee.tenant_id == tenant_id))
    return list(result.scalars().all())


@router.post("/committees", response_model=CommitteeOut, status_code=201)
async def create_committee(
    body: CommitteeIn,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.cadence not in _VALID_CADENCE:
        raise HTTPException(status_code=422, detail="cadence must be monthly, quarterly, annual, or ad_hoc")
    await _assert_tenant_users(db, tenant_id, body.member_ids)
    committee = GovernanceCommittee(
        tenant_id=tenant_id, name=body.name, description=body.description, cadence=body.cadence,
        member_ids=body.member_ids, linked_policy_ids=body.linked_policy_ids,
        linked_document_ids=body.linked_document_ids, next_meeting_date=body.next_meeting_date,
        created_by_id=current_user.id,
    )
    db.add(committee)
    await db.commit()
    await db.refresh(committee)
    return committee


@router.patch("/committees/{committee_id}", response_model=CommitteeOut)
async def update_committee(
    committee_id: str,
    body: CommitteeUpdate,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(GovernanceCommittee).where(GovernanceCommittee.id == committee_id, GovernanceCommittee.tenant_id == tenant_id)
    )
    committee = result.scalar_one_or_none()
    if committee is None:
        raise HTTPException(status_code=404, detail="Committee not found")
    if body.cadence is not None and body.cadence not in _VALID_CADENCE:
        raise HTTPException(status_code=422, detail="cadence must be monthly, quarterly, annual, or ad_hoc")
    await _assert_tenant_users(db, tenant_id, body.member_ids)
    for f in ["name", "description", "cadence", "member_ids", "linked_policy_ids", "linked_document_ids", "next_meeting_date"]:
        v = getattr(body, f, None)
        if v is not None:
            setattr(committee, f, v)
    await db.commit()
    await db.refresh(committee)
    return committee


@router.delete("/committees/{committee_id}", status_code=204)
async def delete_committee(
    committee_id: str,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
    _writer: Annotated[User, Depends(_GOVERNANCE_WRITERS)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(GovernanceCommittee).where(GovernanceCommittee.id == committee_id, GovernanceCommittee.tenant_id == tenant_id)
    )
    committee = result.scalar_one_or_none()
    if committee is None:
        raise HTTPException(status_code=404, detail="Committee not found")
    await db.delete(committee)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Historical series (STB tender objectif 6 — « mise à jour mensuelle »)
# ---------------------------------------------------------------------------
@router.get("/trend")
async def get_governance_trend(
    db: Annotated[AsyncSession, Depends(get_db)],
    # Billing half + access half, mirroring how endpoints/dashboards.py gates
    # GET /dashboards/governance. This series is that dashboard's history, so
    # it carries the same pair: a looser gate here would be a way around the
    # restriction on the live tile. Objectif 6's clause is an exclusion
    # (« réservé aux fonctions de direction »), hence require_roles_strict —
    # deliberately excluding the tenant owner, which is the point of the clause.
    #
    # The plan gate is ``custom_dashboards`` rather than this module's usual
    # ``raci_governance`` because what is being sold here is the dashboard
    # history, not the RACI matrix; both are Elite, so no tenant's entitlement
    # changes either way.
    _plan: Annotated[User, Depends(require_feature("custom_dashboards"))],
    _role: Annotated[User, Depends(require_roles_strict(UserRole.EXECUTIVE, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    months: int = Query(6, ge=1, le=24),
):
    """Monthly governance series — the « mise à jour mensuelle » of objectif 6.

    One point per calendar month, each being the governance posture as of the
    last daily snapshot written on or before that month's end
    (app.services.trend_snapshot_scheduler). The breakdown mirrors
    GET /dashboards/governance — policies by status, attestations by status,
    committees — plus the document-repository counts, so the history and the
    live dashboard are reading the same things rather than two similar-looking
    but differently-defined numbers.

    Fallback (``source: "intake_volume"``) while no snapshot exists yet: how
    many policies and repository documents were *created* per month. That is a
    different measurement from "how many existed", and it is labelled as such
    instead of being passed off as the series proper.
    """
    buckets = month_buckets(months)

    series = await snapshot_series(db, tenant_id, METRIC_GOVERNANCE, buckets)
    if series is not None:
        return {
            "metric": METRIC_GOVERNANCE,
            "months": months,
            "series": series,
            "source": "trend_snapshot_daily",
            "note": (
                "Governance artefacts (policies + repository documents) and their "
                "status as of the latest daily snapshot on or before each month's end."
            ),
        }

    # --- Fallback: intake volume from created_at -----------------------------
    # Bucketed in Python rather than with func.strftime('%Y-%m', ...): strftime
    # is SQLite-only and this application also targets PostgreSQL, Oracle and
    # SQL Server (app/core/database.py).
    #
    # Both source tables already exist on this installation, but the query is
    # still guarded: governance_documents is one of the tables create_all()
    # builds at startup, and a 5xx here would not surface as an error — the SPA
    # hard-redirects to /service-down on any 5xx, ejecting the user out of the
    # application entirely. Same degrade-don't-500 rule the snapshot read
    # follows, and the same one frameworks.py/compliance.py apply.
    window_start = datetime(buckets[0][0], buckets[0][1], 1)
    per_month: dict[str, dict[str, int]] = {}

    def _bucket(rows, key_name: str) -> None:
        for (created_at,) in rows:
            if not created_at:
                continue
            key = f"{created_at.year:04d}-{created_at.month:02d}"
            bucket = per_month.setdefault(key, {})
            bucket[key_name] = bucket.get(key_name, 0) + 1

    try:
        _bucket((await db.execute(
            select(Policy.created_at).where(
                Policy.tenant_id == tenant_id,
                Policy.created_at.isnot(None),
                Policy.created_at >= window_start,
            )
        )).all(), "policies_created")
        _bucket((await db.execute(
            select(GovernanceDocument.created_at).where(
                GovernanceDocument.tenant_id == tenant_id,
                GovernanceDocument.created_at.isnot(None),
                GovernanceDocument.created_at >= window_start,
            )
        )).all(), "documents_created")
    except (OperationalError, ProgrammingError):
        # Degrade, but do NOT answer with zeros. Emptying per_month here made
        # every month read "0 policies, 0 documents created" — a fabricated
        # figure presented as a measurement, when what actually happened is that
        # the question could not be answered. Every total goes out as null and
        # the source says so.
        await db.rollback()
        return {
            "metric": METRIC_GOVERNANCE,
            "months": months,
            "series": unavailable_series(buckets),
            "source": "unavailable",
            "note": (
                "Governance history could not be read: the underlying tables are "
                "not available on this database yet (a backend restart creates "
                "them). No figures are shown rather than zeros."
            ),
        }

    fallback_series = []
    for (yy, mm) in buckets:
        key = f"{yy:04d}-{mm:02d}"
        counts = per_month.get(key, {})
        fallback_series.append({
            "month": datetime(yy, mm, 1).strftime("%b"),
            "period": key,
            "as_of": None,
            "total": sum(counts.values()),
            "counts": {
                "policies_created": counts.get("policies_created", 0),
                "documents_created": counts.get("documents_created", 0),
            },
        })
    return {
        "metric": METRIC_GOVERNANCE,
        "months": months,
        "series": fallback_series,
        "source": "intake_volume",
        # Wording is deliberately "no snapshot is available" and not "none has
        # been recorded yet": snapshot_series() returns None both when the
        # history is genuinely empty AND when it could not be read (table not
        # created until the next restart, or a transient SQLite lock under the
        # 2 workers). Only the first of those is a fact about the register; the
        # second is a fact about this request. Stating the first when the second
        # happened is the same fabricated-figure problem as plotting a 0.
        "note": (
            "No point-in-time snapshot is available for this period — showing "
            "governance artefacts created per month, not how many were in force "
            "on that date."
        ),
    }
