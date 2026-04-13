"""Threat Library — browse and manage threat catalog."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.threat import Threat, ThreatCategory

router = APIRouter()

class ThreatCreate(BaseModel):
    ref_id: str
    name: str
    description: str | None = None
    category: str = "cyber_attack"
    typical_threat_actors: list[str] = []
    typical_attack_vectors: list[str] = []
    affected_assets: list[str] = []
    mitre_ids: list[str] = []

class ThreatOut(BaseModel):
    id: str; ref_id: str; name: str; description: str | None
    category: str; typical_threat_actors: list; typical_attack_vectors: list
    affected_assets: list; mitre_ids: list; is_builtin: bool
    created_at: datetime
    model_config = {"from_attributes": True}

@router.get("", response_model=list[ThreatOut])
async def list_threats(category: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(Threat).where((Threat.is_builtin == True) | (Threat.tenant_id == tenant_id))  # noqa: E712
    if category: q = q.where(Threat.category == category)
    return [ThreatOut.model_validate(t) for t in (await db.execute(q.order_by(Threat.ref_id))).scalars().all()]

@router.post("", response_model=ThreatOut, status_code=201)
async def create_threat(body: ThreatCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    t = Threat(ref_id=body.ref_id, name=body.name, description=body.description,
               category=body.category, typical_threat_actors=body.typical_threat_actors,
               typical_attack_vectors=body.typical_attack_vectors, affected_assets=body.affected_assets,
               mitre_ids=body.mitre_ids, is_builtin=False, tenant_id=tenant_id)
    db.add(t); await db.flush(); await db.commit(); await db.refresh(t)
    return ThreatOut.model_validate(t)

@router.delete("/{tid}", status_code=204)
async def delete_threat(tid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Threat).where(Threat.id == tid, Threat.tenant_id == tenant_id, Threat.is_builtin == False))  # noqa: E712
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Threat not found or is built-in")
    await db.delete(t); await db.commit()
