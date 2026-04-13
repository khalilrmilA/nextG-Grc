"""Regulatory Change Tracking — monitor and manage regulatory updates."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.regulatory_update import RegulatoryUpdate, UpdateImpact, UpdateStatus

router = APIRouter()


class RegUpdateCreate(BaseModel):
    title: str
    description: str | None = None
    source: str | None = None
    regulation_name: str | None = None
    impact: str = "medium"
    effective_date: str | None = None
    deadline: str | None = None
    url: str | None = None
    affected_frameworks: list[str] = []
    affected_controls: list[str] = []
    assigned_to_id: str | None = None

class RegUpdateMod(BaseModel):
    title: str | None = None
    description: str | None = None
    source: str | None = None
    regulation_name: str | None = None
    impact: str | None = None
    status: str | None = None
    effective_date: str | None = None
    deadline: str | None = None
    url: str | None = None
    affected_frameworks: list[str] | None = None
    affected_controls: list[str] | None = None
    action_items: list[dict] | None = None
    assigned_to_id: str | None = None
    notes: str | None = None

class RegUpdateOut(BaseModel):
    id: str; tenant_id: str; title: str; description: str | None
    source: str | None; regulation_name: str | None; impact: str; status: str
    effective_date: str | None; deadline: str | None; url: str | None
    affected_frameworks: list; affected_controls: list; action_items: list
    assigned_to_id: str | None; notes: str | None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


@router.get("", response_model=list[RegUpdateOut])
async def list_updates(status_filter: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(RegulatoryUpdate).where(RegulatoryUpdate.tenant_id == tenant_id)
    if status_filter: q = q.where(RegulatoryUpdate.status == status_filter)
    return [RegUpdateOut.model_validate(u) for u in (await db.execute(q.order_by(RegulatoryUpdate.created_at.desc()))).scalars().all()]

@router.post("", response_model=RegUpdateOut, status_code=201)
async def create_update(body: RegUpdateCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    u = RegulatoryUpdate(
        tenant_id=tenant_id, title=body.title, description=body.description,
        source=body.source, regulation_name=body.regulation_name,
        impact=UpdateImpact(body.impact), effective_date=body.effective_date,
        deadline=body.deadline, url=body.url, affected_frameworks=body.affected_frameworks,
        affected_controls=body.affected_controls, assigned_to_id=body.assigned_to_id,
    )
    db.add(u); await db.flush(); await db.commit(); await db.refresh(u)
    return RegUpdateOut.model_validate(u)

@router.get("/{uid}", response_model=RegUpdateOut)
async def get_update(uid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u: raise HTTPException(404, "Update not found")
    return RegUpdateOut.model_validate(u)

@router.patch("/{uid}", response_model=RegUpdateOut)
async def modify_update(uid: str, body: RegUpdateMod, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u: raise HTTPException(404, "Update not found")
    for f in ["title","description","source","regulation_name","effective_date","deadline","url","affected_frameworks","affected_controls","action_items","assigned_to_id","notes"]:
        v = getattr(body, f, None)
        if v is not None: setattr(u, f, v)
    if body.impact: u.impact = UpdateImpact(body.impact)
    if body.status: u.status = UpdateStatus(body.status)
    await db.commit(); await db.refresh(u)
    return RegUpdateOut.model_validate(u)

@router.delete("/{uid}", status_code=204)
async def delete_update(uid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u: raise HTTPException(404, "Update not found")
    await db.delete(u); await db.commit()
