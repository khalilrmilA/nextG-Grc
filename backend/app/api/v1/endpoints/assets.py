"""Asset Management — IT asset inventory with criticality and lifecycle."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.asset import Asset, AssetType, AssetCriticality

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class AssetCreate(BaseModel):
    name: str
    asset_type: str = "application"
    criticality: str = "medium"
    description: str | None = None
    owner_id: str | None = None
    hosting_type: str | None = None
    cloud_provider: str | None = None
    location: str | None = None
    data_classification: str | None = None
    contains_pii: bool = False
    contains_phi: bool = False
    contains_pci: bool = False
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
    tags: list[str] | None = None

class AssetOut(BaseModel):
    id: str; tenant_id: str; name: str; asset_type: str; criticality: str
    description: str | None; owner_id: str | None; hosting_type: str | None
    cloud_provider: str | None; location: str | None; data_classification: str | None
    contains_pii: bool; contains_phi: bool; contains_pci: bool; tags: list
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class AssetStats(BaseModel):
    total: int
    by_type: dict[str, int]
    by_criticality: dict[str, int]
    with_pii: int
    with_phi: int
    with_pci: int


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("", response_model=list[AssetOut])
async def list_assets(
    asset_type: str | None = None, criticality: str | None = None,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    q = select(Asset).where(Asset.tenant_id == tenant_id)
    if asset_type: q = q.where(Asset.asset_type == asset_type)
    if criticality: q = q.where(Asset.criticality == criticality)
    return [AssetOut.model_validate(a) for a in (await db.execute(q.order_by(Asset.created_at.desc()))).scalars().all()]

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

@router.post("", response_model=AssetOut, status_code=201)
async def create_asset(body: AssetCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = Asset(tenant_id=tenant_id, name=body.name, asset_type=AssetType(body.asset_type),
              criticality=AssetCriticality(body.criticality), description=body.description,
              owner_id=body.owner_id, hosting_type=body.hosting_type, cloud_provider=body.cloud_provider,
              location=body.location, data_classification=body.data_classification,
              contains_pii=body.contains_pii, contains_phi=body.contains_phi,
              contains_pci=body.contains_pci, tags=body.tags)
    db.add(a); await db.flush(); await db.commit(); await db.refresh(a)
    return AssetOut.model_validate(a)

@router.get("/{aid}", response_model=AssetOut)
async def get_asset(aid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Asset).where(Asset.id == aid, Asset.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a: raise HTTPException(404, "Asset not found")
    return AssetOut.model_validate(a)

@router.patch("/{aid}", response_model=AssetOut)
async def update_asset(aid: str, body: AssetUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Asset).where(Asset.id == aid, Asset.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a: raise HTTPException(404, "Asset not found")
    for f in ["name","description","owner_id","hosting_type","cloud_provider","location","data_classification","contains_pii","contains_phi","contains_pci","tags"]:
        v = getattr(body, f, None)
        if v is not None: setattr(a, f, v)
    if body.asset_type: a.asset_type = AssetType(body.asset_type)
    if body.criticality: a.criticality = AssetCriticality(body.criticality)
    await db.commit(); await db.refresh(a)
    return AssetOut.model_validate(a)

@router.delete("/{aid}", status_code=204)
async def delete_asset(aid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Asset).where(Asset.id == aid, Asset.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a: raise HTTPException(404, "Asset not found")
    await db.delete(a); await db.commit()
