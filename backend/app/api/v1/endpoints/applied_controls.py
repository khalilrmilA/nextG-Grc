"""Applied Controls — actionable controls with cost, effort, progress tracking.

Elite Pack (RFP module 3) addition:
- Security-referent validation workflow: POST /{id}/validate and
  POST /{id}/reject let a security referent formally approve/reject a
  control, independent of its planned/in_progress/implemented lifecycle
  status. Mirrors the Vulnerability validation workflow in vulnerabilities.py.
"""
from datetime import datetime, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import String, cast, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.applied_control import AppliedControl, ControlValidationStatus
from app.models.applied_control_history import AppliedControlHistory
from app.models.control_evaluation import ControlEvaluation
from app.models.risk_scenario import RiskScenario
from app.services import control_registry as registry
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

router = APIRouter()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

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
    validation_status: str; validated_by_id: str | None; validated_at: datetime | None
    validation_notes: str | None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


class ControlValidationRequest(BaseModel):
    """Body for POST /{id}/validate and POST /{id}/reject — optional referent notes."""
    notes: str | None = None

@router.get("", response_model=list[ACOut])
async def list_controls(
    response: Response,
    status: str | None = None,
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Bounded, with the total in X-Total-Count — see list_vulns."""
    q = select(AppliedControl).where(AppliedControl.tenant_id == tenant_id)
    if status: q = q.where(AppliedControl.status == status)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    response.headers["X-Total-Count"] = str(total)
    rows = (await db.execute(
        q.order_by(AppliedControl.created_at.desc()).offset(offset).limit(limit)
    )).scalars().all()
    return [ACOut.model_validate(c) for c in rows]

@router.post("", response_model=ACOut, status_code=201)
async def create_control(
    body: ACCreate,
    db: AsyncSession = Depends(get_db),
    # A deployed security measure is not something any account should be able
    # to add, edit or remove. Validation was already restricted to the security
    # referent; the record itself was open to every authenticated user, which
    # made the gate on validation largely decorative.
    user: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER, UserRole.SECURITY_ANALYST, UserRole.CONTROL_OWNER)),
    tenant_id: str = Depends(get_tenant_id),
):
    c = AppliedControl(tenant_id=tenant_id, ref_id=body.ref_id, name=body.name,
                       description=body.description, category=body.category, csf_function=body.csf_function,
                       status=body.status, eta=body.eta, expiration=body.expiration,
                       effort=body.effort, cost=body.cost, recurring_cost=body.recurring_cost,
                       framework_control_ids=body.framework_control_ids,
                       owner_id=body.owner_id or user.id, link=body.link, tags=body.tags)
    db.add(c); await db.flush()
    registry.record(db, c, "created", actor=user,
                    changes=registry.diff({}, registry.snapshot(c)))
    await db.commit(); await db.refresh(c)
    return ACOut.model_validate(c)

@router.get("/{cid}", response_model=ACOut)
async def get_control(cid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    return ACOut.model_validate(c)

@router.patch("/{cid}", response_model=ACOut)
async def update_control(
    cid: str,
    body: ACUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER, UserRole.SECURITY_ANALYST, UserRole.CONTROL_OWNER)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    before = registry.snapshot(c)
    for f in ["name","description","category","csf_function","status","progress","eta","expiration",
              "effort","cost","recurring_cost","framework_control_ids","evidence_ids",
              "risk_scenario_ids","risk_ids","vulnerability_ids","owner_id","link","tags"]:
        v = getattr(body, f, None)
        if v is not None: setattr(c, f, v)
    changes = registry.diff(before, registry.snapshot(c))
    if changes:
        registry.record(db, c, registry.action_for(changes), actor=user, changes=changes)
    await db.commit(); await db.refresh(c)
    return ACOut.model_validate(c)

@router.delete("/{cid}", status_code=204)
async def delete_control(
    cid: str,
    reason: str = Query(..., min_length=3, description="Required justification for deleting this applied control"),
    db: AsyncSession = Depends(get_db),
    # Deletion is narrower than editing: removing a control removes a claimed
    # mitigation from every risk that counted on it.
    user: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    control_name = c.name
    # Recorded before the delete, with the full final state: once the row is
    # gone this entry is the only evidence the control ever existed.
    registry.record(db, c, "deleted", actor=user,
                    changes=registry.diff(registry.snapshot(c), {}), note=reason)
    # Remove this control's effectiveness evaluations with it. There is no FK
    # cascade, and an evaluation whose control no longer exists is not history —
    # it is a live row that keeps appearing in the evaluation list and, if its
    # follow-up was still open, in the action-required queue, pointing at
    # nothing. The record that the control existed and was evaluated is kept in
    # applied_control_history, which is where it belongs.
    orphans = (await db.execute(
        select(ControlEvaluation).where(ControlEvaluation.applied_control_id == c.id)
    )).scalars().all()
    for ev in orphans:
        await db.delete(ev)

    # Detach the control from any scenario that listed it. There is no FK on
    # RiskScenario.applied_control_ids either, so without this a scenario goes
    # on claiming a mitigating control that no longer exists — which overstates
    # its treatment, and is worse than the link simply being absent.
    scenarios = (await db.execute(
        select(RiskScenario).where(
            RiskScenario.tenant_id == tenant_id,
            cast(RiskScenario.applied_control_ids, String).ilike(f'%"{c.id}"%'),
        )
    )).scalars().all()
    detached = []
    for sc in scenarios:
        if c.id in (sc.applied_control_ids or []):
            # Reassign rather than mutate: SQLAlchemy does not track in-place
            # edits to a JSON column.
            sc.applied_control_ids = [x for x in sc.applied_control_ids if x != c.id]
            detached.append(sc.ref_id or sc.name)
    if detached:
        registry.record(
            db, c, "updated", actor=user,
            changes={"detached_from_scenarios": {"from": detached, "to": []}},
            note=f"Removed as a mitigation from {len(detached)} scenario(s) on deletion.",
        )

    await db.delete(c); await db.commit()

    # The generic ActivityLogMiddleware only records {method, path} for every mutating
    # request — it can't see query params, so the deletion reason wouldn't otherwise be
    # captured anywhere. Write an explicit entry to the same hash-chained log with the
    # reason included, reusing the existing activity_chain service (no new subsystem).
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=user.id,
            user_email=user.email,
            action="delete",
            entity_type="applied_control",
            entity_id=cid,
            entity_name=control_name,
            details={"reason": reason},
        ))
    except Exception:
        pass


class ControlHistoryOut(BaseModel):
    id: str; applied_control_id: str; action: str; changes: dict
    control_ref_id: str | None = None; control_name: str | None = None
    note: str | None = None
    actor_id: str | None = None; actor_email: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


@router.get("/{cid}/history", response_model=list[ControlHistoryOut])
async def get_control_history(
    cid: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Everything that has happened to this control, newest first.

    Scoped on the history rows rather than by loading the control first,
    because the entry that matters most is the one written for a control that
    no longer exists.
    """
    rows = (await db.execute(
        select(AppliedControlHistory)
        .where(AppliedControlHistory.tenant_id == tenant_id,
               AppliedControlHistory.applied_control_id == cid)
        .order_by(AppliedControlHistory.created_at.desc())
    )).scalars().all()
    return [ControlHistoryOut.model_validate(r) for r in rows]


# ── Security-referent validation workflow (Elite Pack) ─────────────────────
# A control's implementation status (planned/in_progress/...) says nothing
# about whether a security referent has actually reviewed and signed off on
# it. These two endpoints add that formal approval gate — restricted to the
# same security-referent role tuple used for vulnerability mutations
# (CISO / risk_manager; tenant_admin and super_admin auto-pass via
# require_roles()). Mirrors the shape of the Vulnerability validation
# workflow (POST /vulnerabilities/{id}/validate) and the VendorContract CISO
# approve/reject workflow.

@router.post("/{cid}/validate", response_model=ACOut)
async def validate_control(
    cid: str,
    body: ControlValidationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Security-referent approval — marks the control as formally validated."""
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Control not found")
    previous = c.validation_status
    c.validation_status = ControlValidationStatus.VALIDATED.value
    c.validated_by_id = current_user.id
    c.validated_at = _utcnow()
    if body.notes is not None:
        c.validation_notes = body.notes
    registry.record(
        db, c, "validated", actor=current_user,
        changes={"validation_status": {"from": previous, "to": c.validation_status}},
        note=body.notes,
    )
    await db.commit(); await db.refresh(c)
    return ACOut.model_validate(c)


@router.post("/{cid}/reject", response_model=ACOut)
async def reject_control(
    cid: str,
    body: ControlValidationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Security-referent rejection — sends the control back for rework."""
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Control not found")
    previous = c.validation_status
    c.validation_status = ControlValidationStatus.REJECTED.value
    c.validated_by_id = current_user.id
    c.validated_at = _utcnow()
    if body.notes is not None:
        c.validation_notes = body.notes
    registry.record(
        db, c, "rejected", actor=current_user,
        changes={"validation_status": {"from": previous, "to": c.validation_status}},
        note=body.notes,
    )
    await db.commit(); await db.refresh(c)
    return ACOut.model_validate(c)
