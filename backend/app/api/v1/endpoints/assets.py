"""Asset Management — IT/business asset inventory (RFP module 2).

Base CRUD is core. The CIA valuation grid, primary/support classification,
cartography links and lifecycle/EOL are the Elite Pack asset capabilities.
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.models.user import User
from app.models.asset import Asset, AssetType, AssetCriticality
from app.models.asset_history import AssetValuationHistory

router = APIRouter()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Schemas ──────────────────────────────────────────────────────────────

class AssetCreate(BaseModel):
    name: str
    asset_type: str = "application"
    criticality: str = "medium"
    description: str | None = None
    owner_id: str                       # RFP: business owner is mandatory
    hosting_type: str | None = None
    cloud_provider: str | None = None
    location: str | None = None
    data_classification: str | None = None
    contains_pii: bool = False
    contains_phi: bool = False
    contains_pci: bool = False
    asset_class: str | None = None       # 'primary' | 'support'
    serves_asset_ids: list[str] = []
    business_process_id: str | None = None
    org_entity_id: str | None = None
    lifecycle_state: str | None = None
    acquired_at: datetime | None = None
    end_of_life_at: datetime | None = None
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    security_objectives: dict | None = None
    next_review_date: str | None = None
    tags: list[str] = []


class AssetUpdate(BaseModel):
    name: str | None = None
    asset_type: str | None = None
    criticality: str | None = None
    description: str | None = None
    owner_id: str | None = None
    hosting_type: str | None = None
    cloud_provider: str | None = None
    location: str | None = None
    data_classification: str | None = None
    contains_pii: bool | None = None
    contains_phi: bool | None = None
    contains_pci: bool | None = None
    asset_class: str | None = None
    serves_asset_ids: list[str] | None = None
    business_process_id: str | None = None
    org_entity_id: str | None = None
    lifecycle_state: str | None = None
    acquired_at: datetime | None = None
    end_of_life_at: datetime | None = None
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    next_review_date: str | None = None
    tags: list[str] | None = None


class AssetOut(BaseModel):
    id: str; tenant_id: str; name: str; asset_type: str; criticality: str
    description: str | None; owner_id: str | None; hosting_type: str | None
    cloud_provider: str | None; location: str | None; data_classification: str | None
    contains_pii: bool; contains_phi: bool; contains_pci: bool; tags: list
    asset_class: str | None = None
    serves_asset_ids: list = []
    business_process_id: str | None = None
    org_entity_id: str | None = None
    lifecycle_state: str | None = None
    acquired_at: datetime | None = None
    end_of_life_at: datetime | None = None
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    security_objectives: dict | None = None
    next_review_date: str | None = None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


class PaginatedAssets(BaseModel):
    items: list[AssetOut]
    total: int
    page: int
    page_size: int


class AssetStats(BaseModel):
    total: int
    by_type: dict[str, int]
    by_criticality: dict[str, int]
    with_pii: int
    with_phi: int
    with_pci: int


class CiaUpdate(BaseModel):
    confidentiality: int
    integrity: int
    availability: int
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    note: str | None = None


class CiaHistoryOut(BaseModel):
    id: str
    old_cia: dict | None = None
    new_cia: dict | None = None
    changed_by_id: str | None = None
    note: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


async def _get_asset(aid: str, tenant_id: str, db: AsyncSession) -> Asset:
    r = await db.execute(select(Asset).where(Asset.id == aid, Asset.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Asset not found")
    return a


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("", response_model=PaginatedAssets)
async def list_assets(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    asset_type: str | None = None,
    criticality: str | None = None,
    asset_class: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    base = select(Asset).where(Asset.tenant_id == tenant_id)
    if asset_type:
        base = base.where(Asset.asset_type == asset_type)
    if criticality:
        base = base.where(Asset.criticality == criticality)
    if asset_class:
        base = base.where(Asset.asset_class == asset_class)
    all_rows = list((await db.execute(base)).scalars().all())
    total = len(all_rows)
    ordered = sorted(all_rows, key=lambda a: a.created_at, reverse=True)
    start = (page - 1) * page_size
    items = [AssetOut.model_validate(a) for a in ordered[start:start + page_size]]
    return PaginatedAssets(items=items, total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=AssetStats)
async def get_stats(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    assets = list((await db.execute(select(Asset).where(Asset.tenant_id == tenant_id))).scalars().all())
    by_type: dict[str, int] = {}
    by_crit: dict[str, int] = {}
    pii = phi = pci = 0
    for a in assets:
        t = a.asset_type.value if hasattr(a.asset_type, "value") else str(a.asset_type)
        c = a.criticality.value if hasattr(a.criticality, "value") else str(a.criticality)
        by_type[t] = by_type.get(t, 0) + 1
        by_crit[c] = by_crit.get(c, 0) + 1
        if a.contains_pii: pii += 1
        if a.contains_phi: phi += 1
        if a.contains_pci: pci += 1
    return AssetStats(total=len(assets), by_type=by_type, by_criticality=by_crit, with_pii=pii, with_phi=phi, with_pci=pci)


@router.get("/lifecycle/eol-soon", response_model=list[AssetOut])
async def eol_soon(
    current_user: Annotated[User, Depends(require_feature("asset_lifecycle"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    within_days: int = Query(90, ge=1, le=365),
):
    """Assets reaching end-of-life within `within_days` (includes overdue)."""
    cutoff = _utcnow() + timedelta(days=within_days)
    rows = (await db.execute(
        select(Asset).where(
            Asset.tenant_id == tenant_id,
            Asset.end_of_life_at.is_not(None),
            Asset.end_of_life_at <= cutoff,
        ).order_by(Asset.end_of_life_at)
    )).scalars().all()
    return [AssetOut.model_validate(a) for a in rows]


@router.post("", response_model=AssetOut, status_code=201)
async def create_asset(body: AssetCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    # RFP: mandatory business owner — validate it belongs to the tenant.
    owner = (await db.execute(
        select(User).where(User.id == body.owner_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if owner is None:
        raise HTTPException(status_code=422, detail="owner_id must reference a user in this tenant")

    a = Asset(
        tenant_id=tenant_id, name=body.name, asset_type=AssetType(body.asset_type),
        criticality=AssetCriticality(body.criticality), description=body.description,
        owner_id=body.owner_id, hosting_type=body.hosting_type, cloud_provider=body.cloud_provider,
        location=body.location, data_classification=body.data_classification,
        contains_pii=body.contains_pii, contains_phi=body.contains_phi,
        contains_pci=body.contains_pci, tags=body.tags,
        asset_class=body.asset_class, serves_asset_ids=body.serves_asset_ids,
        business_process_id=body.business_process_id, org_entity_id=body.org_entity_id,
        lifecycle_state=body.lifecycle_state, acquired_at=body.acquired_at,
        end_of_life_at=body.end_of_life_at, business_value=body.business_value,
        rto_seconds=body.rto_seconds, rpo_seconds=body.rpo_seconds, mtd_seconds=body.mtd_seconds,
        security_objectives=body.security_objectives, next_review_date=body.next_review_date,
    )
    db.add(a); await db.flush(); await db.commit(); await db.refresh(a)
    return AssetOut.model_validate(a)


@router.get("/{aid}", response_model=AssetOut)
async def get_asset(aid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return AssetOut.model_validate(await _get_asset(aid, tenant_id, db))


@router.patch("/{aid}", response_model=AssetOut)
async def update_asset(aid: str, body: AssetUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = await _get_asset(aid, tenant_id, db)
    for f in ["name", "description", "owner_id", "hosting_type", "cloud_provider", "location",
              "data_classification", "contains_pii", "contains_phi", "contains_pci", "tags",
              "asset_class", "serves_asset_ids", "business_process_id", "org_entity_id",
              "lifecycle_state", "acquired_at", "end_of_life_at", "business_value",
              "rto_seconds", "rpo_seconds", "mtd_seconds", "next_review_date"]:
        v = getattr(body, f, None)
        if v is not None:
            setattr(a, f, v)
    if body.asset_type:
        a.asset_type = AssetType(body.asset_type)
    if body.criticality:
        a.criticality = AssetCriticality(body.criticality)
    await db.commit(); await db.refresh(a)
    return AssetOut.model_validate(a)


@router.get("/{aid}/cia")
async def get_cia(aid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = await _get_asset(aid, tenant_id, db)
    return {
        "security_objectives": a.security_objectives or {},
        "business_value": a.business_value,
        "rto_seconds": a.rto_seconds, "rpo_seconds": a.rpo_seconds, "mtd_seconds": a.mtd_seconds,
    }


@router.put("/{aid}/cia", response_model=AssetOut)
async def set_cia(
    aid: str,
    body: CiaUpdate,
    current_user: Annotated[User, Depends(require_feature("cia_valuation"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set the C/I/A valuation grid, recording the change in history."""
    a = await _get_asset(aid, tenant_id, db)
    old = a.security_objectives or {}
    new = {"confidentiality": body.confidentiality, "integrity": body.integrity, "availability": body.availability}
    db.add(AssetValuationHistory(
        tenant_id=tenant_id, asset_id=a.id, changed_by_id=current_user.id,
        old_cia=old, new_cia=new, note=body.note,
    ))
    a.security_objectives = new
    if body.business_value is not None:
        a.business_value = body.business_value
    if body.rto_seconds is not None:
        a.rto_seconds = body.rto_seconds
    if body.rpo_seconds is not None:
        a.rpo_seconds = body.rpo_seconds
    if body.mtd_seconds is not None:
        a.mtd_seconds = body.mtd_seconds
    await db.commit(); await db.refresh(a)
    return AssetOut.model_validate(a)


@router.get("/{aid}/cia-history", response_model=list[CiaHistoryOut])
async def cia_history(
    aid: str,
    current_user: Annotated[User, Depends(require_feature("cia_valuation"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_asset(aid, tenant_id, db)
    rows = (await db.execute(
        select(AssetValuationHistory).where(
            AssetValuationHistory.tenant_id == tenant_id,
            AssetValuationHistory.asset_id == aid,
        ).order_by(AssetValuationHistory.created_at.desc())
    )).scalars().all()
    return list(rows)


@router.delete("/{aid}", status_code=204)
async def delete_asset(aid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = await _get_asset(aid, tenant_id, db)
    await db.delete(a); await db.commit()
