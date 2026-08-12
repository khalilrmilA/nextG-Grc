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
    if option == RiskTreatmentOption.ACCEPT and not (justification and justification.strip()):
        raise HTTPException(status_code=422, detail="Acceptance requires a justification.")


@router.post("", response_model=TreatmentOut, status_code=status.HTTP_201_CREATED)
async def upsert_treatment(
    body: TreatmentIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create or replace the treatment plan for a risk (one per risk)."""
    await _risk_in_tenant(body.risk_id, tenant_id, db)
    _require_justification(body.treatment_option, body.acceptance_justification)

    existing = (await db.execute(
        select(RiskTreatment).where(RiskTreatment.risk_id == body.risk_id)
    )).scalar_one_or_none()

    data = body.model_dump()
    if existing is None:
        treatment = RiskTreatment(**data)
        db.add(treatment)
    else:
        for k, v in data.items():
            setattr(existing, k, v)
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
    await db.commit()
    await db.refresh(treatment)
    return treatment
