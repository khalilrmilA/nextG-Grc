"""CVE knowledge base endpoints (Elite Pack, RFP module 3).

Gated behind require_feature("cve_knowledge_base"). Advanced search over the NVD
catalog, an on-demand sync trigger, and per-tenant relevance annotation.
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, cast, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.cve_entry import CveEntry, CveAnnotation, RELEVANCE_VALUES
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.services.nvd_sync import sync_recent_cves

router = APIRouter()

_GATE = require_feature("cve_knowledge_base")


class CveOut(BaseModel):
    id: str
    cve_id: str
    description: str | None = None
    cvss_score: float | None = None
    cvss_vector: str | None = None
    cwe_ids: list = []
    published_at: datetime | None = None
    last_modified: datetime | None = None
    relevance: str | None = None
    notes: str | None = None
    linked_asset_ids: list = []
    model_config = {"from_attributes": True}


class AnnotationIn(BaseModel):
    relevance: str
    notes: str | None = None
    linked_asset_ids: list[str] = []


@router.get("", response_model=list[CveOut])
async def search_cve(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = None,
    min_cvss: float | None = None,
    cwe: str | None = None,
    vector: str | None = None,
    published_after: datetime | None = None,
    relevance: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    stmt = select(CveEntry)
    if q:
        like = f"%{q}%"
        stmt = stmt.where((CveEntry.cve_id.ilike(like)) | (CveEntry.description.ilike(like)))
    if min_cvss is not None:
        stmt = stmt.where(CveEntry.cvss_score >= min_cvss)
    if cwe:
        # JSON list stored as text; cast + ILIKE works on both SQLite and Postgres.
        stmt = stmt.where(cast(CveEntry.cwe_ids, String).ilike(f"%{cwe}%"))
    if vector:
        # RFP gap fix: no attack-vector filter existed even though cvss_vector is
        # stored (e.g. "CVSS:3.1/AV:N/AC:L/..."). Substring match on a fragment
        # like "AV:N" is the practical filter shape for a free-text vector string.
        stmt = stmt.where(CveEntry.cvss_vector.ilike(f"%{vector}%"))
    if published_after is not None:
        stmt = stmt.where(CveEntry.published_at >= published_after)
    # Newest-published first so the catalog surfaces the latest CVEs, not decade-old
    # entries that NVD merely re-scored recently.
    stmt = stmt.order_by(CveEntry.published_at.desc().nullslast(), CveEntry.last_modified.desc().nullslast())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    entries = (await db.execute(stmt)).scalars().all()

    # Attach the tenant's relevance annotations.
    ann_map = {}
    if entries:
        ids = [e.cve_id for e in entries]
        anns = (await db.execute(
            select(CveAnnotation).where(
                CveAnnotation.tenant_id == tenant_id,
                CveAnnotation.cve_id.in_(ids),
            )
        )).scalars().all()
        ann_map = {a.cve_id: a for a in anns}

    out = []
    for e in entries:
        ann = ann_map.get(e.cve_id)
        rel = ann.relevance if ann else None
        if relevance and rel != relevance:
            continue
        item = CveOut.model_validate(e)
        item.relevance = rel
        item.notes = ann.notes if ann else None
        item.linked_asset_ids = (ann.linked_asset_ids or []) if ann else []
        out.append(item)
    return out


@router.post("/sync")
async def trigger_sync(
    current_user: Annotated[User, Depends(_GATE)],
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(1, ge=1, le=30),
):
    """Pull recently-modified CVEs from NVD into the catalog."""
    return await sync_recent_cves(db, days=days)


@router.put("/{cve_id}/annotation", response_model=CveOut)
async def set_annotation(
    cve_id: str,
    body: AnnotationIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.relevance not in RELEVANCE_VALUES:
        raise HTTPException(status_code=422, detail=f"relevance must be one of {RELEVANCE_VALUES}")
    entry = (await db.execute(select(CveEntry).where(CveEntry.cve_id == cve_id))).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="CVE not found in catalog")

    ann = (await db.execute(
        select(CveAnnotation).where(
            CveAnnotation.tenant_id == tenant_id, CveAnnotation.cve_id == cve_id
        )
    )).scalar_one_or_none()
    if ann is None:
        ann = CveAnnotation(tenant_id=tenant_id, cve_id=cve_id)
        db.add(ann)
    ann.relevance = body.relevance
    ann.notes = body.notes
    ann.linked_asset_ids = body.linked_asset_ids
    await db.commit()

    item = CveOut.model_validate(entry)
    item.relevance = body.relevance
    item.notes = body.notes
    item.linked_asset_ids = body.linked_asset_ids
    return item
