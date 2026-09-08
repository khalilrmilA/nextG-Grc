"""Security Exceptions & Risk Acceptances — formal waivers and approvals."""
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.security_exception import SecurityException, ExceptionStatus, RiskAcceptance
from app.services.activity_chain import log_system_activity

router = APIRouter()


# ── Expiry ───────────────────────────────────────────────────────────────
# The model says expiration_date MUST expire and ExceptionStatus.EXPIRED
# exists, but nothing ever set it: an approved waiver read as approved
# forever, which is the one thing a time-boxed exception must not do. There
# is no scheduler to hang a sweep on (no Celery, no beat), so the transition
# is evaluated whenever the register is read — the same place the stale value
# would otherwise be believed.

_LIVE_STATUSES = ("approved", "active")


def _is_past(expiration_date: str | None) -> bool:
    """True once `expiration_date` (an ISO date string) is behind today.

    Compared as strings after truncating to YYYY-MM-DD: ISO dates sort
    lexicographically, and the column is a String(20) that may hold either a
    plain date or a full timestamp. Anything unparseable is treated as not
    expired — a malformed date must not silently void a waiver.
    """
    if not expiration_date or len(expiration_date) < 10:
        return False
    return expiration_date[:10] < date.today().isoformat()


async def _expire_due(db: AsyncSession, stmt, entity_type: str) -> list:
    """Run `stmt`, stamping EXPIRED on anything whose window has closed.

    Idempotent and convergent: both uvicorn workers compute the same value from
    the same stored date, and the write happens only on the transition, so the
    read path stays read-only for every subsequent call.
    """
    rows = list((await db.execute(stmt)).scalars().all())
    changed = [r for r in rows if r.status in _LIVE_STATUSES and _is_past(r.expiration_date)]
    if not changed:
        return rows
    # Capture the before-state now: after the commit these are the new values.
    transitions = [
        (r.tenant_id, r.id, getattr(r, "title", None) or getattr(r, "name", None),
         r.status, r.expiration_date)
        for r in changed
    ]
    for r in changed:
        r.status = ExceptionStatus.EXPIRED.value
    try:
        await db.commit()
    except Exception:
        # A lost race against the other worker means the row is already expired
        # there; re-read rather than 500 a read path.
        await db.rollback()
    else:
        # A waiver going from approved to expired is a status change nobody
        # requested, so without this the trail held only the middleware's record
        # of the GET that happened to trigger it. log_system_activity writes
        # through its OWN session and never raises — it cannot roll back or
        # delay the transition it describes, which is why the chain entry is
        # written here rather than with chain_and_add on this session.
        for tenant_id, row_id, name, was, expires_on in transitions:
            await log_system_activity(
                tenant_id=tenant_id, action="expired", entity_type=entity_type,
                entity_id=row_id, entity_name=name,
                details={"changed": {"status": {"from": was,
                                                "to": ExceptionStatus.EXPIRED.value}},
                         "expiration_date": expires_on,
                         "reason": "expiration_date_passed"},
                # STB's declared origin vocabulary is manuel | batch | API
                # (core/activity_middleware.classify_origin) — an automatic
                # transition is "batch", not a fourth value the filter can't offer.
                origin="batch",
            )
    # Both commit and rollback leave the onupdate-computed `updated_at` needing
    # a re-fetch, and a lazy load from the sync response serializer raises
    # MissingGreenlet. Re-run the query instead of touching the stale instances.
    return list((await db.execute(stmt)).scalars().all())

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
    # Derived, not stored: true once expiration_date is behind today, whatever
    # `status` still says. Lets a client mark a lapsed waiver even on the read
    # that performed the transition.
    is_expired: bool = False
    model_config = {"from_attributes": True}

    @field_validator(
        "related_entity_ids", "related_entity_names", "compensating_control_ids", "tags",
        mode="before",
    )
    @classmethod
    def _none_to_list(cls, v):
        # A NULL in one of these JSON columns (a row written before the column
        # existed, or by a script that bypassed the ORM default) used to fail
        # validation for the whole response, so one bad row 500s every waiver in
        # the tenant. Same guard IncidentOut and ThreatOut already carry.
        return v if isinstance(v, list) else ([] if v is None else v)

    @model_validator(mode="after")
    def _derive_is_expired(self):
        # Computed after the ORM row is read so it is correct even on a worker
        # that has not yet performed the status transition.
        self.is_expired = _is_past(self.expiration_date)
        return self

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
    is_expired: bool = False
    model_config = {"from_attributes": True}

    @field_validator("risk_scenario_ids", "risk_ids", mode="before")
    @classmethod
    def _none_to_list(cls, v):
        return v if isinstance(v, list) else ([] if v is None else v)

    @model_validator(mode="after")
    def _derive_is_expired(self):
        self.is_expired = _is_past(self.expiration_date)
        return self

# ── Security Exception endpoints ─────────────────────────────────────────
@router.get("/exceptions", response_model=list[SEOut])
async def list_exceptions(status_filter: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    # Expire first, then filter: with the transition applied afterwards a
    # ?status_filter=approved page would keep listing lapsed waivers as approved.
    rows = await _expire_due(db, (
        select(SecurityException)
        .where(SecurityException.tenant_id == tenant_id)
        .order_by(SecurityException.created_at.desc())
    ), "security_exception")
    if status_filter:
        rows = [e for e in rows if e.status == status_filter]
    return [SEOut.model_validate(e) for e in rows]

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
    if _is_past(e.expiration_date):
        # Approving a window that already closed produces a waiver that is
        # 'approved' and expired at the same instant — a signature covering
        # nothing. Ask for a new expiry rather than record it.
        raise HTTPException(
            409, "This exception's expiration date has already passed. Extend it before approving.")
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
    rows = await _expire_due(db, (
        select(RiskAcceptance)
        .where(RiskAcceptance.tenant_id == tenant_id)
        .order_by(RiskAcceptance.created_at.desc())
    ), "risk_acceptance")
    return [RAOut.model_validate(a) for a in rows]

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
    """Approve a pending risk acceptance. Four-eyes principle: requester cannot
    approve their own acceptance, and only TENANT_ADMIN/CISO can approve."""
    r = await db.execute(select(RiskAcceptance).where(RiskAcceptance.id == aid, RiskAcceptance.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a: raise HTTPException(404, "Acceptance not found")
    if a.requested_by_id == user.id:
        raise HTTPException(403, "You cannot approve your own risk acceptance (four-eyes principle).")
    # Same state guard approve_exception already has: without it an acceptance
    # that was rejected — or that has expired — could be re-approved, replacing
    # the recorded approver and sign-off date with no trace of the first decision.
    if a.status != "pending":
        raise HTTPException(409, f"Cannot approve acceptance in status '{a.status}'")
    if _is_past(a.expiration_date):
        raise HTTPException(
            409, "This acceptance's expiration date has already passed. Extend it before approving.")
    a.status = "approved"; a.approver_id = user.id; a.approved_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(a)
    return RAOut.model_validate(a)
