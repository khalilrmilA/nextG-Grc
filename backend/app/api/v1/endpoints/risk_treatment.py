"""Risk treatment plans (Elite Pack, RFP module 8).

Wires up the previously-unused RiskTreatment model: one treatment decision per
risk (accept / mitigate / transfer / avoid) with justification, schedule, cost,
owner and progress, plus an execution-tracking view that flags overdue plans.
Gated behind require_feature("risk_treatment_plans").
"""
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.risk import Risk, RiskTreatment, RiskTreatmentOption
from app.models.risk_scenario import RiskScenario, ScenarioTreatment
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_GATE = require_feature("risk_treatment_plans")


class TreatmentIn(BaseModel):
    risk_id: str
    treatment_option: RiskTreatmentOption
    description: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    owner_id: str | None = None
    progress_percentage: int = 0
    estimated_cost: float | None = None
    actual_cost: float | None = None
    transfer_to: str | None = None
    acceptance_justification: str | None = None


class TreatmentPatch(BaseModel):
    treatment_option: RiskTreatmentOption | None = None
    description: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    owner_id: str | None = None
    progress_percentage: int | None = None
    estimated_cost: float | None = None
    actual_cost: float | None = None
    transfer_to: str | None = None
    acceptance_justification: str | None = None


class TreatmentOut(BaseModel):
    id: str
    risk_id: str
    treatment_option: RiskTreatmentOption
    description: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    owner_id: str | None = None
    progress_percentage: int
    estimated_cost: float | None = None
    actual_cost: float | None = None
    priority: str | None = None
    transfer_to: str | None = None
    acceptance_justification: str | None = None
    model_config = {"from_attributes": True}


class TrackingRow(BaseModel):
    id: str
    risk_id: str
    treatment_option: RiskTreatmentOption
    progress_percentage: int
    due_date: str | None = None
    overdue: bool
    at_risk: bool


async def _risk_in_tenant(risk_id: str, tenant_id: str, db: AsyncSession) -> Risk:
    risk = (await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=404, detail="Risk not found")
    return risk


def _require_justification(option: RiskTreatmentOption, justification: str | None) -> None:
    """RFP rule: "une justification est requise pour chaque décision" — every
    treatment option (mitigate/accept/transfer/avoid), not just acceptance."""
    if not (justification and justification.strip()):
        raise HTTPException(
            status_code=422,
            detail=f"A justification is required for treatment option '{option.value}'.",
        )


_SEVERITY_TO_PRIORITY = {
    "critical": "critical", "high": "high", "medium": "medium", "low": "low", "info": "low",
}


def _derive_treatment_priority(risk: Risk) -> str:
    """RFP gap fix: auto-derive the treatment plan's priority from its linked risk,
    reusing the same critical/high/medium/low tiering compliance.py's ActionItem
    remediation already uses (there: gap.remediation_priority -> ActionItemPriority;
    here: risk.severity -> priority).

    Simplified from the RFP's "criticité x complexité" formula to severity alone —
    this codebase has no existing notion of treatment "complexity" to multiply
    against, and inventing one would be a materially bigger feature than this gap
    fix warrants. Falls back to the raw likelihood x impact score when severity
    hasn't been computed yet (bands mirror the register's qualitative 1-5 scale:
    >=20 critical, >=12 high, >=6 medium, else low).
    """
    severity = risk.severity
    if severity is not None:
        sev = severity.value if hasattr(severity, "value") else str(severity)
        return _SEVERITY_TO_PRIORITY.get(sev, "medium")
    score = risk.residual_risk_score if risk.residual_risk_score is not None else risk.inherent_risk_score
    if score is None:
        return "medium"
    if score >= 20:
        return "critical"
    if score >= 12:
        return "high"
    if score >= 6:
        return "medium"
    return "low"


@router.post("", response_model=TreatmentOut, status_code=status.HTTP_201_CREATED)
async def upsert_treatment(
    body: TreatmentIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create or replace the treatment plan for a risk (one per risk)."""
    risk = await _risk_in_tenant(body.risk_id, tenant_id, db)
    _require_justification(body.treatment_option, body.acceptance_justification)

    existing = (await db.execute(
        select(RiskTreatment).where(RiskTreatment.risk_id == body.risk_id)
    )).scalar_one_or_none()

    data = body.model_dump()
    priority = _derive_treatment_priority(risk)
    if existing is None:
        treatment = RiskTreatment(**data, priority=priority)
        db.add(treatment)
    else:
        for k, v in data.items():
            setattr(existing, k, v)
        existing.priority = priority
        treatment = existing
    await db.commit()
    await db.refresh(treatment)
    return treatment


@router.get("", response_model=list[TreatmentOut])
async def list_treatments(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    risk_id: str | None = None,
):
    stmt = (
        select(RiskTreatment)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(Risk.tenant_id == tenant_id)
    )
    if risk_id:
        stmt = stmt.where(RiskTreatment.risk_id == risk_id)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/tracking", response_model=list[TrackingRow])
async def tracking(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Execution tracking: flag overdue (past due, <100%) and at-risk plans."""
    rows = list((await db.execute(
        select(RiskTreatment)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(Risk.tenant_id == tenant_id)
    )).scalars().all())
    today = date.today().isoformat()
    out = []
    for t in rows:
        overdue = bool(t.due_date and t.due_date < today and (t.progress_percentage or 0) < 100)
        at_risk = bool(
            not overdue and t.due_date and t.due_date <= today and (t.progress_percentage or 0) < 100
        )
        out.append(TrackingRow(
            id=t.id, risk_id=t.risk_id, treatment_option=t.treatment_option,
            progress_percentage=t.progress_percentage or 0, due_date=t.due_date,
            overdue=overdue, at_risk=at_risk,
        ))
    return out


@router.patch("/{treatment_id}", response_model=TreatmentOut)
async def patch_treatment(
    treatment_id: str,
    body: TreatmentPatch,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    treatment = (await db.execute(
        select(RiskTreatment)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(RiskTreatment.id == treatment_id, Risk.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if treatment is None:
        raise HTTPException(status_code=404, detail="Treatment not found")
    updates = body.model_dump(exclude_none=True)
    option = updates.get("treatment_option", treatment.treatment_option)
    justification = updates.get("acceptance_justification", treatment.acceptance_justification)
    _require_justification(option, justification)
    for k, v in updates.items():
        setattr(treatment, k, v)
    # Re-derive priority from the linked risk on every update — its severity may
    # have changed since the treatment plan was created.
    risk = await _risk_in_tenant(treatment.risk_id, tenant_id, db)
    treatment.priority = _derive_treatment_priority(risk)
    await db.commit()
    await db.refresh(treatment)
    return treatment


class UntreatedScenarioOut(BaseModel):
    id: str
    name: str
    current_probability: int | None = None
    current_impact: int | None = None
    current_risk_level: str | None = None
    owner_id: str | None = None
    model_config = {"from_attributes": True}


@router.get("/untreated", response_model=list[UntreatedScenarioOut])
async def untreated_evaluated_scenarios(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """RFP rule: "le choix d'une option n'est pas rendu obligatoire pour tout risque
    évalué" — surface risk scenarios still at the default `untreated` state that
    have actually been evaluated (probability + impact both set), so the gap is
    visible/actionable instead of silently sitting on default data.

    Deliberately NOT a blocking DB constraint: many existing scenarios are already
    `untreated` and a hard requirement would break them retroactively.
    """
    rows = (await db.execute(
        select(RiskScenario).where(
            RiskScenario.tenant_id == tenant_id,
            RiskScenario.treatment == ScenarioTreatment.UNTREATED.value,
            RiskScenario.current_probability.isnot(None),
            RiskScenario.current_impact.isnot(None),
        ).order_by(RiskScenario.created_at.desc())
    )).scalars().all()
    return rows
