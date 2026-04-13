"""Risk Scenarios — threat-vulnerability-asset-control chains."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.risk_scenario import RiskScenario

router = APIRouter()

class ScenarioCreate(BaseModel):
    name: str; description: str | None = None; treatment: str = "untreated"
    threat_ids: list[str] = []; vulnerability_ids: list[str] = []; asset_ids: list[str] = []
    applied_control_ids: list[str] = []; current_probability: int | None = None
    current_impact: int | None = None; target_probability: int | None = None
    target_impact: int | None = None; strength_of_knowledge: str = "medium"
    threat_actor: str | None = None; owner_id: str | None = None
    estimated_loss_min: float | None = None; estimated_loss_max: float | None = None
    estimated_loss_likely: float | None = None; justification: str | None = None
    existing_controls_description: str | None = None; tags: list[str] = []

class ScenarioUpdate(BaseModel):
    name: str | None = None; description: str | None = None; treatment: str | None = None
    threat_ids: list[str] | None = None; vulnerability_ids: list[str] | None = None
    asset_ids: list[str] | None = None; applied_control_ids: list[str] | None = None
    current_probability: int | None = None; current_impact: int | None = None
    target_probability: int | None = None; target_impact: int | None = None
    strength_of_knowledge: str | None = None; threat_actor: str | None = None
    owner_id: str | None = None; estimated_loss_min: float | None = None
    estimated_loss_max: float | None = None; estimated_loss_likely: float | None = None
    justification: str | None = None; existing_controls_description: str | None = None
    tags: list[str] | None = None

class ScenarioOut(BaseModel):
    id: str; tenant_id: str; name: str; description: str | None; treatment: str
    threat_ids: list; vulnerability_ids: list; asset_ids: list; applied_control_ids: list
    current_probability: int | None; current_impact: int | None; current_risk_level: str | None
    target_probability: int | None; target_impact: int | None; target_risk_level: str | None
    strength_of_knowledge: str; existing_controls_description: str | None
    threat_actor: str | None; estimated_loss_min: float | None
    estimated_loss_max: float | None; estimated_loss_likely: float | None
    justification: str | None; owner_id: str | None; tags: list
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

def _risk_level(prob, impact):
    if not prob or not impact: return None
    score = prob * impact
    if score >= 16: return "critical"
    if score >= 10: return "high"
    if score >= 5: return "medium"
    return "low"

@router.get("", response_model=list[ScenarioOut])
async def list_scenarios(treatment: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(RiskScenario).where(RiskScenario.tenant_id == tenant_id)
    if treatment: q = q.where(RiskScenario.treatment == treatment)
    return [ScenarioOut.model_validate(s) for s in (await db.execute(q.order_by(RiskScenario.created_at.desc()))).scalars().all()]

@router.post("", response_model=ScenarioOut, status_code=201)
async def create_scenario(body: ScenarioCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    s = RiskScenario(
        tenant_id=tenant_id, name=body.name, description=body.description,
        treatment=body.treatment, threat_ids=body.threat_ids,
        vulnerability_ids=body.vulnerability_ids, asset_ids=body.asset_ids,
        applied_control_ids=body.applied_control_ids,
        current_probability=body.current_probability, current_impact=body.current_impact,
        current_risk_level=_risk_level(body.current_probability, body.current_impact),
        target_probability=body.target_probability, target_impact=body.target_impact,
        target_risk_level=_risk_level(body.target_probability, body.target_impact),
        strength_of_knowledge=body.strength_of_knowledge, threat_actor=body.threat_actor,
        owner_id=body.owner_id or user.id, estimated_loss_min=body.estimated_loss_min,
        estimated_loss_max=body.estimated_loss_max, estimated_loss_likely=body.estimated_loss_likely,
        justification=body.justification, existing_controls_description=body.existing_controls_description,
        tags=body.tags,
    )
    db.add(s); await db.flush(); await db.commit(); await db.refresh(s)
    return ScenarioOut.model_validate(s)

@router.get("/{sid}", response_model=ScenarioOut)
async def get_scenario(sid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")
    return ScenarioOut.model_validate(s)

@router.patch("/{sid}", response_model=ScenarioOut)
async def update_scenario(sid: str, body: ScenarioUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")
    for f in ["name","description","treatment","threat_ids","vulnerability_ids","asset_ids","applied_control_ids",
              "current_probability","current_impact","target_probability","target_impact","strength_of_knowledge",
              "threat_actor","owner_id","estimated_loss_min","estimated_loss_max","estimated_loss_likely",
              "justification","existing_controls_description","tags"]:
        v = getattr(body, f, None)
        if v is not None: setattr(s, f, v)
    s.current_risk_level = _risk_level(s.current_probability, s.current_impact)
    s.target_risk_level = _risk_level(s.target_probability, s.target_impact)
    await db.commit(); await db.refresh(s)
    return ScenarioOut.model_validate(s)

@router.delete("/{sid}", status_code=204)
async def delete_scenario(sid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")
    await db.delete(s); await db.commit()
