"""Governance endpoints (Elite Pack) — RACI matrix + document repository.

RFP module 11:
- RACI matrix, filterable by role/entity/module (gated ``raci_governance``).
- Unified document repository with typology/module/entity classification,
  version control that archives previous versions, and a per-document access
  level (read/edit/validate) (gated ``document_repository``).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.governance import RaciAssignment, GovernanceDocument, GovernanceDocumentVersion, GovernanceGroup
from app.models.notification import NotificationType
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.services.notification_generator import create_notification, notification_exists

router = APIRouter()

_VALID_RACI = {"R", "A", "C", "I"}
_VALID_ACCESS = {"read", "edit", "validate"}
# Roles that may modify a document regardless of its access_level (mirrors the
# require_roles() convention used elsewhere: tenant_admin/super_admin always have
# full access; CISO is the elevated governance role for this module).
_DOCUMENT_ELEVATED_ROLES = {UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.CISO}


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
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    raci = body.raci.strip().upper()
    if raci not in _VALID_RACI:
        raise HTTPException(status_code=422, detail="raci must be one of R, A, C, I")
    if body.responsible_type not in ("role", "user", "group"):
        raise HTTPException(status_code=422, detail="responsible_type must be 'role', 'user', or 'group'")
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
                )
        await db.commit()

    return row


@router.delete("/raci/{raci_id}", status_code=204)
async def delete_raci(
    raci_id: str,
    current_user: Annotated[User, Depends(require_feature("raci_governance"))],
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
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
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
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(GovernanceGroup).where(GovernanceGroup.id == group_id, GovernanceGroup.tenant_id == tenant_id)
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
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
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(GovernanceGroup).where(GovernanceGroup.id == group_id, GovernanceGroup.tenant_id == tenant_id)
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
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
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def create_document(
    body: DocumentIn,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
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
    return await _get_doc(db, doc_id, tenant_id)


@router.put("/documents/{doc_id}", response_model=DocumentOut)
async def update_document(
    doc_id: str,
    body: DocumentUpdate,
    current_user: Annotated[User, Depends(require_feature("document_repository"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    doc = await _get_doc(db, doc_id, tenant_id)

    # Per-document access enforcement (RFP gap): a document flagged access_level="read"
    # is read-only — reject the update unless the caller is the document's
    # creator/owner or holds an elevated governance role (tenant admin/CISO).
    #
    # LIMITATION (documented, not built): access_level is a single tenant-wide field
    # on GovernanceDocument, not a per-user ACL — the schema has no table recording
    # "user X has edit rights on document Y". So this enforces "read-only for
    # everyone except the owner/elevated roles", which is the most faithful
    # approximation of "per-document per-user access" the current schema supports.
    # True per-user grants (e.g. "read" for user A, "edit" for user B on the same
    # document) would need a new document_access_grants(document_id, user_id, level)
    # table — deliberately not added here, flagged for a future iteration.
    is_owner = doc.created_by_id is not None and doc.created_by_id == current_user.id
    is_elevated = current_user.role in _DOCUMENT_ELEVATED_ROLES
    if doc.access_level == "read" and not is_owner and not is_elevated:
        raise HTTPException(
            status_code=403,
            detail="This document is read-only; only its owner or a CISO/tenant admin can modify it",
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
    await _get_doc(db, doc_id, tenant_id)  # tenant ownership check
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
    await db.delete(doc)
    await db.commit()
    return None
