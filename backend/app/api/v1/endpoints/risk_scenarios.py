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
from app.models.risk import Risk
from app.services import risk_scoring
from app.api.v1.endpoints.risks import _apply_scoring

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
    linked_risk_id: str | None = None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

def _level(definition, prob, impact):
    """Qualitative risk level from the tenant's active matrix (unified with the risk register)."""
    return risk_scoring.score_and_level(definition, prob, impact)[1]

def _new_linked_risk(tenant_id: str, s: RiskScenario) -> Risk:
    """RFP rule: auto-consolidate a scenario into the risk register (additive only —
    only ever called when the scenario has no link yet, so a pre-existing
    manually-created Risk is never touched or orphaned)."""
    return Risk(
        tenant_id=tenant_id, title=s.name, description=s.description,
        likelihood=s.current_probability, impact=s.current_impact, owner_id=s.owner_id,
    )

@router.get("", response_model=list[ScenarioOut])
async def list_scenarios(treatment: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(RiskScenario).where(RiskScenario.tenant_id == tenant_id)
    if treatment: q = q.where(RiskScenario.treatment == treatment)
    return [ScenarioOut.model_validate(s) for s in (await db.execute(q.order_by(RiskScenario.created_at.desc()))).scalars().all()]

@router.post("", response_model=ScenarioOut, status_code=201)
async def create_scenario(body: ScenarioCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    definition, _ = await risk_scoring.resolve_matrix(db, tenant_id)
    s = RiskScenario(
        tenant_id=tenant_id, name=body.name, description=body.description,
        treatment=body.treatment, threat_ids=body.threat_ids,
        vulnerability_ids=body.vulnerability_ids, asset_ids=body.asset_ids,
        applied_control_ids=body.applied_control_ids,
        current_probability=body.current_probability, current_impact=body.current_impact,
        current_risk_level=_level(definition, body.current_probability, body.current_impact),
        target_probability=body.target_probability, target_impact=body.target_impact,
        target_risk_level=_level(definition, body.target_probability, body.target_impact),
        strength_of_knowledge=body.strength_of_knowledge, threat_actor=body.threat_actor,
        owner_id=body.owner_id or user.id, estimated_loss_min=body.estimated_loss_min,
        estimated_loss_max=body.estimated_loss_max, estimated_loss_likely=body.estimated_loss_likely,
        justification=body.justification, existing_controls_description=body.existing_controls_description,
        tags=body.tags,
    )
    db.add(s); await db.flush()

    # RFP rule: scenario -> risk-register consolidation. Every new scenario gets a
    # linked Risk row so the register reflects it automatically (additive-only).
    risk = _new_linked_risk(tenant_id, s)
    db.add(risk)
    await _apply_scoring(db, tenant_id, risk)
    await db.flush()
    s.linked_risk_id = risk.id

    await db.commit(); await db.refresh(s)
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
    definition, _ = await risk_scoring.resolve_matrix(db, tenant_id)
    s.current_risk_level = _level(definition, s.current_probability, s.current_impact)
    s.target_risk_level = _level(definition, s.target_probability, s.target_impact)

    # RFP rule: keep the linked risk-register entry's likelihood/impact (and
    # matrix-derived severity) in sync with the scenario's current probability/impact.
    if s.linked_risk_id:
        linked = (await db.execute(
            select(Risk).where(Risk.id == s.linked_risk_id, Risk.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if linked is not None:
            linked.likelihood = s.current_probability
            linked.impact = s.current_impact
            await _apply_scoring(db, tenant_id, linked)
    elif s.current_probability is not None or s.current_impact is not None:
        # Backfill: this scenario predates auto-consolidation and has no link yet.
        # Safe to create one now since there was no pre-existing link to orphan.
        risk = _new_linked_risk(tenant_id, s)
        db.add(risk)
        await _apply_scoring(db, tenant_id, risk)
        await db.flush()
        s.linked_risk_id = risk.id

    await db.commit(); await db.refresh(s)
    return ScenarioOut.model_validate(s)

@router.delete("/{sid}", status_code=204)
async def delete_scenario(sid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")
    await db.delete(s); await db.commit()
