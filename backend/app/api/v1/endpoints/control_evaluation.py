"""Control effectiveness evaluation endpoints (Elite Pack, RFP module 6).

Gated behind require_feature("control_effectiveness"). Evaluates applied controls
on the 5 RFP criteria, derives a performance level, and lists evaluations that
are due (past their next_evaluation_at) — the obsolete/ineffective follow-up list.
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.control_evaluation import ControlEvaluation, derive_performance_level
from app.models.applied_control import AppliedControl
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_GATE = require_feature("control_effectiveness")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EvaluationCreate(BaseModel):
    applied_control_id: str
    formalisme: int = Field(0, ge=0, le=2)
    type_controle: int = Field(0, ge=0, le=2)
    timing: int = Field(0, ge=0, le=2)
    tracabilite: int = Field(0, ge=0, le=2)
    quatre_yeux: int = Field(0, ge=0, le=2)
    next_evaluation_at: datetime | None = None
    notes: str | None = None


class EvaluationOut(BaseModel):
    id: str
    applied_control_id: str
    formalisme: int
    type_controle: int
    timing: int
    tracabilite: int
    quatre_yeux: int
    performance_level: str
    evaluated_at: datetime | None = None
    next_evaluation_at: datetime | None = None
    notes: str | None = None
    model_config = {"from_attributes": True}


@router.post("", response_model=EvaluationOut, status_code=status.HTTP_201_CREATED)
async def create_evaluation(
    body: EvaluationCreate,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Validate the control belongs to the tenant.
    ctrl = await db.execute(
        select(AppliedControl).where(
            AppliedControl.id == body.applied_control_id,
            AppliedControl.tenant_id == tenant_id,
        )
    )
    if ctrl.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Applied control not found")

    total = body.formalisme + body.type_controle + body.timing + body.tracabilite + body.quatre_yeux
    evaluation = ControlEvaluation(
        tenant_id=tenant_id,
        applied_control_id=body.applied_control_id,
        evaluated_by_id=current_user.id,
        evaluated_at=_utcnow(),
        formalisme=body.formalisme,
        type_controle=body.type_controle,
        timing=body.timing,
        tracabilite=body.tracabilite,
        quatre_yeux=body.quatre_yeux,
        performance_level=derive_performance_level(total),
        next_evaluation_at=body.next_evaluation_at,
        notes=body.notes,
    )
    db.add(evaluation)
    await db.commit()
    await db.refresh(evaluation)
    return evaluation


@router.get("", response_model=list[EvaluationOut])
async def list_evaluations(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    control_id: str | None = None,
):
    stmt = select(ControlEvaluation).where(ControlEvaluation.tenant_id == tenant_id)
    if control_id:
        stmt = stmt.where(ControlEvaluation.applied_control_id == control_id)
    stmt = stmt.order_by(ControlEvaluation.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/due", response_model=list[EvaluationOut])
async def list_due_evaluations(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Evaluations past their next_evaluation_at — controls needing re-assessment."""
    now = _utcnow()
    stmt = select(ControlEvaluation).where(
        ControlEvaluation.tenant_id == tenant_id,
        ControlEvaluation.next_evaluation_at.is_not(None),
        ControlEvaluation.next_evaluation_at < now,
    ).order_by(ControlEvaluation.next_evaluation_at)
    result = await db.execute(stmt)
    return list(result.scalars().all())
