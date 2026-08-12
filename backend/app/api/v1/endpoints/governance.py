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
from app.models.user import User
from app.models.governance import RaciAssignment, GovernanceDocument, GovernanceDocumentVersion
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_VALID_RACI = {"R", "A", "C", "I"}
_VALID_ACCESS = {"read", "edit", "validate"}


# ---------------------------------------------------------------------------
# RACI matrix
# ---------------------------------------------------------------------------
class RaciIn(BaseModel):
    activity: str
    responsible_type: str = "role"     # role | user
    role: str | None = None
    user_id: str | None = None
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
    raci: str
    module: str | None
    entity_type: str | None
    entity_id: str | None
    model_config = {"from_attributes": True}


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
    if body.responsible_type not in ("role", "user"):
        raise HTTPException(status_code=422, detail="responsible_type must be 'role' or 'user'")
    row = RaciAssignment(
        tenant_id=tenant_id, activity=body.activity, responsible_type=body.responsible_type,
        role=body.role, user_id=body.user_id, raci=raci, module=body.module,
        entity_type=body.entity_type, entity_id=body.entity_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
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
