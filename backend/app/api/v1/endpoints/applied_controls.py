"""Applied Controls — actionable controls with cost, effort, progress tracking."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.applied_control import AppliedControl

router = APIRouter()

class ACCreate(BaseModel):
    ref_id: str | None = None; name: str; description: str | None = None
    category: str | None = None; csf_function: str | None = None
    status: str = "planned"; eta: str | None = None; expiration: str | None = None
    effort: str | None = None; cost: float | None = None; recurring_cost: float | None = None
    framework_control_ids: list[str] = []; owner_id: str | None = None
    link: str | None = None; tags: list[str] = []

class ACUpdate(BaseModel):
    name: str | None = None; description: str | None = None
    category: str | None = None; csf_function: str | None = None
    status: str | None = None; progress: int | None = None
    eta: str | None = None; expiration: str | None = None
    effort: str | None = None; cost: float | None = None; recurring_cost: float | None = None
    framework_control_ids: list[str] | None = None; evidence_ids: list[str] | None = None
    risk_scenario_ids: list[str] | None = None; vulnerability_ids: list[str] | None = None
    owner_id: str | None = None; link: str | None = None; tags: list[str] | None = None

class ACOut(BaseModel):
    id: str; tenant_id: str; ref_id: str | None; name: str; description: str | None
    category: str | None; csf_function: str | None; status: str; progress: int
    eta: str | None; expiration: str | None; effort: str | None
    cost: float | None; recurring_cost: float | None
    framework_control_ids: list; evidence_ids: list; risk_scenario_ids: list
    vulnerability_ids: list; owner_id: str | None; link: str | None; tags: list
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

@router.get("", response_model=list[ACOut])
async def list_controls(status: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(AppliedControl).where(AppliedControl.tenant_id == tenant_id)
    if status: q = q.where(AppliedControl.status == status)
    return [ACOut.model_validate(c) for c in (await db.execute(q.order_by(AppliedControl.created_at.desc()))).scalars().all()]

@router.post("", response_model=ACOut, status_code=201)
async def create_control(body: ACCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    c = AppliedControl(tenant_id=tenant_id, ref_id=body.ref_id, name=body.name,
                       description=body.description, category=body.category, csf_function=body.csf_function,
                       status=body.status, eta=body.eta, expiration=body.expiration,
                       effort=body.effort, cost=body.cost, recurring_cost=body.recurring_cost,
                       framework_control_ids=body.framework_control_ids,
                       owner_id=body.owner_id or user.id, link=body.link, tags=body.tags)
    db.add(c); await db.flush(); await db.commit(); await db.refresh(c)
    return ACOut.model_validate(c)

@router.get("/{cid}", response_model=ACOut)
async def get_control(cid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    return ACOut.model_validate(c)

@router.patch("/{cid}", response_model=ACOut)
async def update_control(cid: str, body: ACUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    for f in ["name","description","category","csf_function","status","progress","eta","expiration",
              "effort","cost","recurring_cost","framework_control_ids","evidence_ids",
              "risk_scenario_ids","vulnerability_ids","owner_id","link","tags"]:
        v = getattr(body, f, None)
        if v is not None: setattr(c, f, v)
    await db.commit(); await db.refresh(c)
    return ACOut.model_validate(c)

@router.delete("/{cid}", status_code=204)
async def delete_control(cid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    await db.delete(c); await db.commit()
