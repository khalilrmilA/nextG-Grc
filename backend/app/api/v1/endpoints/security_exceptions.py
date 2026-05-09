"""Security Exceptions & Risk Acceptances — formal waivers and approvals."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.security_exception import SecurityException, RiskAcceptance

router = APIRouter()

# ── Security Exception schemas ───────────────────────────────────────────
class SECreate(BaseModel):
    title: str; justification: str; description: str | None = None
    severity: str = "medium"; exception_type: str  # risk, control, vulnerability, requirement, asset
    related_entity_ids: list[str] = []; related_entity_names: list[str] = []
    compensating_controls: str | None = None; compensating_control_ids: list[str] = []
    expiration_date: str; effective_date: str | None = None; conditions: str | None = None

class SEUpdate(BaseModel):
    title: str | None = None; description: str | None = None; justification: str | None = None
    severity: str | None = None; status: str | None = None
    compensating_controls: str | None = None; conditions: str | None = None
    expiration_date: str | None = None

class SEOut(BaseModel):
    id: str; tenant_id: str; title: str; description: str | None; justification: str
    severity: str; status: str; exception_type: str
    related_entity_ids: list; related_entity_names: list
    compensating_controls: str | None; compensating_control_ids: list
    requested_by_id: str; approver_id: str | None; approved_at: str | None
    rejection_reason: str | None; effective_date: str | None; expiration_date: str
    review_date: str | None; conditions: str | None; tags: list
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

# ── Risk Acceptance schemas ──────────────────────────────────────────────
class RACreate(BaseModel):
    name: str; justification: str; description: str | None = None
    risk_scenario_ids: list[str] = []; risk_ids: list[str] = []
    expiration_date: str; conditions: str | None = None

class RAOut(BaseModel):
    id: str; tenant_id: str; name: str; description: str | None; justification: str
    status: str; risk_scenario_ids: list; risk_ids: list
    requested_by_id: str; approver_id: str | None; approved_at: str | None
    expiration_date: str; review_date: str | None
    residual_risk_level: str | None; conditions: str | None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

# ── Security Exception endpoints ─────────────────────────────────────────
@router.get("/exceptions", response_model=list[SEOut])
async def list_exceptions(status_filter: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(SecurityException).where(SecurityException.tenant_id == tenant_id)
    if status_filter: q = q.where(SecurityException.status == status_filter)
    return [SEOut.model_validate(e) for e in (await db.execute(q.order_by(SecurityException.created_at.desc()))).scalars().all()]

@router.post("/exceptions", response_model=SEOut, status_code=201)
async def create_exception(body: SECreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    e = SecurityException(tenant_id=tenant_id, title=body.title, description=body.description,
                          justification=body.justification, severity=body.severity,
                          exception_type=body.exception_type, related_entity_ids=body.related_entity_ids,
                          related_entity_names=body.related_entity_names,
                          compensating_controls=body.compensating_controls,
                          compensating_control_ids=body.compensating_control_ids,
                          requested_by_id=user.id, expiration_date=body.expiration_date,
                          effective_date=body.effective_date, conditions=body.conditions,
                          status="pending_approval")
    db.add(e); await db.flush(); await db.commit(); await db.refresh(e)
    return SEOut.model_validate(e)

@router.patch("/exceptions/{eid}/approve", response_model=SEOut)
async def approve_exception(
    eid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Approve a pending security exception. Four-eyes principle: requester
    cannot approve their own request, and only TENANT_ADMIN/CISO can approve."""
    r = await db.execute(select(SecurityException).where(SecurityException.id == eid, SecurityException.tenant_id == tenant_id))
    e = r.scalar_one_or_none()
    if not e: raise HTTPException(404, "Exception not found")
    if e.requested_by_id == user.id:
        raise HTTPException(403, "You cannot approve your own request (four-eyes principle).")
    if e.status != "pending_approval":
        raise HTTPException(409, f"Cannot approve exception in status '{e.status}'")
    e.status = "approved"; e.approver_id = user.id; e.approved_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(e)
    return SEOut.model_validate(e)

@router.patch("/exceptions/{eid}/reject", response_model=SEOut)
async def reject_exception(
    eid: str,
    reason: str = "",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(SecurityException).where(SecurityException.id == eid, SecurityException.tenant_id == tenant_id))
    e = r.scalar_one_or_none()
    if not e: raise HTTPException(404, "Exception not found")
    if e.requested_by_id == user.id:
        raise HTTPException(403, "You cannot reject your own request (four-eyes principle).")
    if e.status != "pending_approval":
        raise HTTPException(409, f"Cannot reject exception in status '{e.status}'")
    e.status = "rejected"; e.approver_id = user.id; e.rejection_reason = reason
    await db.commit(); await db.refresh(e)
    return SEOut.model_validate(e)

# ── Risk Acceptance endpoints ────────────────────────────────────────────
@router.get("/acceptances", response_model=list[RAOut])
async def list_acceptances(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return [RAOut.model_validate(a) for a in (await db.execute(select(RiskAcceptance).where(RiskAcceptance.tenant_id == tenant_id).order_by(RiskAcceptance.created_at.desc()))).scalars().all()]

@router.post("/acceptances", response_model=RAOut, status_code=201)
async def create_acceptance(body: RACreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = RiskAcceptance(tenant_id=tenant_id, name=body.name, description=body.description,
                       justification=body.justification, risk_scenario_ids=body.risk_scenario_ids,
                       risk_ids=body.risk_ids, requested_by_id=user.id,
                       expiration_date=body.expiration_date, conditions=body.conditions)
    db.add(a); await db.flush(); await db.commit(); await db.refresh(a)
    return RAOut.model_validate(a)

@router.patch("/acceptances/{aid}/approve", response_model=RAOut)
async def approve_acceptance(
    aid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Approve a risk acceptance. Four-eyes principle: requester cannot
    approve their own acceptance."""
    r = await db.execute(select(RiskAcceptance).where(RiskAcceptance.id == aid, RiskAcceptance.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a: raise HTTPException(404, "Acceptance not found")
    if a.requested_by_id == user.id:
        raise HTTPException(403, "You cannot approve your own risk acceptance (four-eyes principle).")
    a.status = "approved"; a.approver_id = user.id; a.approved_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(a)
    return RAOut.model_validate(a)
