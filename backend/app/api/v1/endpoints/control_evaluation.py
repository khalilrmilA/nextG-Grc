"""Control effectiveness evaluation endpoints (Elite Pack, RFP module 6).

Gated behind require_feature("control_effectiveness"). Evaluates applied controls
on the 5 RFP criteria, derives a performance level, and lists evaluations that
are due (past their next_evaluation_at) — the obsolete/ineffective follow-up list.
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.control_evaluation import (
    ControlEvaluation, derive_performance_level, EVALUATION_METHODS,
    NON_PERFORMANT, REMEDIATION_STATUSES,
)
from app.models.audit import Audit
from app.services import control_registry
from app.models.applied_control import AppliedControl
from app.api.v1.dependencies.auth import get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_GATE = require_feature("control_effectiveness")

# require_feature() answers "is this capability in the tenant's plan" — it is a
# billing gate and it was the only thing standing in front of the writes here,
# so anyone the plan let in (an auditor, a vendor manager) could score a control
# or close the follow-up on one that had been declared ineffective. Recording an
# effectiveness judgement is a write on the control's assurance record, so it
# takes a role check.
#
# The set is the one the product already declares for this page — Layout.tsx
# gates /control-effectiveness to exactly these roles plus the two read-only
# profiles (viewer/executive), which get_current_user already blocks from every
# write. business_owner is included for that reason: the page has no per-role
# UI gating, so a role the sidebar admits to it must not meet a 403 it cannot
# interpret. tenant_admin/super_admin auto-pass via require_roles.
# Reading stays open to everyone the plan admits.
_WRITE_ROLES = require_roles(
    UserRole.CISO, UserRole.RISK_MANAGER, UserRole.SECURITY_ANALYST,
    UserRole.CONTROL_OWNER, UserRole.BUSINESS_OWNER,
)


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
    # What the score rests on. The requirement names internal audits, technical
    # tests and performance indicators explicitly; without recording which, an
    # 8/10 from a documented penetration test looks identical to one given from
    # memory in a meeting.
    method: str | None = None
    evidence_ref: str | None = None
    audit_id: str | None = None


class RemediationUpdate(BaseModel):
    """The follow-up on a control that evaluated badly."""
    remediation_status: str | None = None
    remediation_plan: str | None = None
    remediation_owner_id: str | None = None
    remediation_due_date: str | None = None


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
    method: str | None = None
    evidence_ref: str | None = None
    audit_id: str | None = None
    remediation_status: str = "not_required"
    remediation_plan: str | None = None
    remediation_owner_id: str | None = None
    remediation_due_date: str | None = None
    evaluated_by_id: str | None = None
    model_config = {"from_attributes": True}


@router.post("", response_model=EvaluationOut, status_code=status.HTTP_201_CREATED)
async def create_evaluation(
    body: EvaluationCreate,
    current_user: Annotated[User, Depends(_GATE)],
    _writer: Annotated[User, Depends(_WRITE_ROLES)],
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
    control = ctrl.scalar_one_or_none()
    if control is None:
        raise HTTPException(status_code=404, detail="Applied control not found")

    if body.method and body.method not in EVALUATION_METHODS:
        raise HTTPException(422, f"method must be one of {EVALUATION_METHODS}")
    if body.audit_id:
        found = (await db.execute(
            select(Audit.id).where(Audit.id == body.audit_id, Audit.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if found is None:
            raise HTTPException(422, "Unknown audit for this tenant")

    total = body.formalisme + body.type_controle + body.timing + body.tracabilite + body.quatre_yeux
    level = derive_performance_level(total)
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
        performance_level=level,
        next_evaluation_at=body.next_evaluation_at,
        notes=body.notes,
        method=body.method,
        evidence_ref=body.evidence_ref,
        audit_id=body.audit_id,
        # A control that comes out non-performant opens its follow-up here
        # rather than waiting for someone to remember. The requirement asks for
        # specific tracking of controls declared ineffective, and a follow-up
        # that depends on the evaluator also filing it is one that gets skipped
        # exactly when the result is bad.
        remediation_status="open" if level == NON_PERFORMANT else "not_required",
    )
    db.add(evaluation)
    control_registry.record(
        db, control, "evaluated", actor=current_user,
        changes={"performance_level": {"from": None, "to": level}},
        note=(f"Scored {total}/10"
              + (f" by {body.method.replace('_', ' ')}" if body.method else "")
              + ("; follow-up opened" if level == NON_PERFORMANT else "")),
    )
    await db.commit()
    await db.refresh(evaluation)
    return evaluation


@router.get("", response_model=list[EvaluationOut])
async def list_evaluations(
    response: Response,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    control_id: str | None = None,
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    """Bounded, with the total in X-Total-Count — same shape as list_controls.

    Evaluations accumulate for the life of a control (one per re-assessment per
    control), so this list only grows; returning it whole was fine at five rows
    and is not at five years of quarterly re-assessments.
    """
    stmt = select(ControlEvaluation).where(ControlEvaluation.tenant_id == tenant_id)
    if control_id:
        stmt = stmt.where(ControlEvaluation.applied_control_id == control_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    response.headers["X-Total-Count"] = str(total)
    stmt = stmt.order_by(ControlEvaluation.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/action-required", response_model=list[EvaluationOut])
async def list_action_required(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Controls declared ineffective whose follow-up is still open.

    Declared before "/{...}" style routes so the literal path is not captured.
    This is the working list the requirement asks for: not every bad score
    ever recorded, but the ones nobody has closed out yet.
    """
    rows = (await db.execute(
        select(ControlEvaluation)
        .where(
            ControlEvaluation.tenant_id == tenant_id,
            ControlEvaluation.remediation_status.in_(("open", "in_progress")),
        )
        .order_by(ControlEvaluation.evaluated_at.desc().nullslast())
    )).scalars().all()
    return [EvaluationOut.model_validate(r) for r in rows]


@router.patch("/{evaluation_id}/remediation", response_model=EvaluationOut)
async def update_remediation(
    evaluation_id: str,
    body: RemediationUpdate,
    current_user: Annotated[User, Depends(_GATE)],
    _writer: Annotated[User, Depends(_WRITE_ROLES)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record or close the action plan attached to a poor evaluation."""
    evaluation = (await db.execute(
        select(ControlEvaluation).where(
            ControlEvaluation.id == evaluation_id,
            ControlEvaluation.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Evaluation not found")

    if body.remediation_status and body.remediation_status not in REMEDIATION_STATUSES:
        raise HTTPException(422, f"remediation_status must be one of {REMEDIATION_STATUSES}")
    if body.remediation_status == "done" and not (
        body.remediation_plan or evaluation.remediation_plan
    ):
        # Closing a follow-up with no record of what was done leaves the audit
        # trail asserting a remediation that cannot be evidenced.
        raise HTTPException(422, "Describe what was done before closing the follow-up")
    if body.remediation_owner_id:
        # A follow-up owned by somebody outside this organization is a follow-up
        # with no owner: nothing here can notify them and nobody can chase them.
        owner = (await db.execute(
            select(User.id).where(
                User.id == body.remediation_owner_id, User.tenant_id == tenant_id
            )
        )).scalar_one_or_none()
        if owner is None:
            raise HTTPException(422, "Remediation owner is not a member of this organization")

    before = {
        "remediation_status": evaluation.remediation_status,
        "remediation_plan": evaluation.remediation_plan,
    }
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(evaluation, field, value)

    control = (await db.execute(
        select(AppliedControl).where(AppliedControl.id == evaluation.applied_control_id)
    )).scalar_one_or_none()
    if control is not None:
        control_registry.record(
            db, control, "updated", actor=current_user,
            changes={k: {"from": v, "to": getattr(evaluation, k)}
                     for k, v in before.items() if v != getattr(evaluation, k)},
            note="Evaluation follow-up updated",
        )
    await db.commit()
    await db.refresh(evaluation)
    return evaluation


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
