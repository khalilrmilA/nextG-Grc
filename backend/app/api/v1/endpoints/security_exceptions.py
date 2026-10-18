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
from app.models.risk import Risk, RiskStatus
from app.models.risk_scenario import RiskScenario
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add, log_system_activity
from app.services import risk_versioning

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


async def _expire_due(db: AsyncSession, stmt, entity_type: str, on_expire=None) -> list:
    """Run `stmt`, stamping EXPIRED on anything whose window has closed.

    ``on_expire(db, row)`` runs for each newly expired row inside the same
    transaction (risk acceptances use it to hand their risks back).

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
    if on_expire is not None:
        for r in changed:
            await on_expire(db, r)
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

class RADecision(BaseModel):
    reason: str

class RAOut(BaseModel):
    id: str; tenant_id: str; name: str; description: str | None; justification: str
    status: str; risk_scenario_ids: list; risk_ids: list
    requested_by_id: str; approver_id: str | None; approved_at: str | None
    expiration_date: str; review_date: str | None
    residual_risk_level: str | None; conditions: str | None
    rejection_reason: str | None = None
    revoked_by_id: str | None = None; revoked_at: str | None = None
    revocation_reason: str | None = None
    # Withdrawn by its requester (follow-up C-1): who, when and why. Kept in the
    # revoked_* columns — a withdrawal is the same "stopped before its term"
    # record, authored by the requester instead of a CISO; `status` tells them apart.
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

# ── Risk Acceptance ↔ risk register ──────────────────────────────────────
# An approved acceptance IS the risk decision: each risk it covers (directly, or
# as the register entry of a covered scenario) moves to `accepted`, and goes
# back to the status it had before when the acceptance is revoked or lapses.

async def _covered_risks(db: AsyncSession, tenant_id: str, a: RiskAcceptance) -> list[Risk]:
    ids = set(a.risk_ids or [])
    if a.risk_scenario_ids:
        rows = await db.execute(select(RiskScenario.linked_risk_id).where(
            RiskScenario.tenant_id == tenant_id, RiskScenario.id.in_(list(a.risk_scenario_ids))))
        ids |= {r[0] for r in rows if r[0]}
    if not ids:
        return []
    return list((await db.execute(
        select(Risk).where(Risk.tenant_id == tenant_id, Risk.id.in_(list(ids)))
    )).scalars().all())


def _status_value(risk: Risk) -> str:
    return getattr(risk.status, "value", risk.status)


async def _accept_covered_risks(db: AsyncSession, a: RiskAcceptance, actor: User) -> None:
    prior: dict[str, str] = {}
    for risk in await _covered_risks(db, a.tenant_id, a):
        current = _status_value(risk)
        # A closed risk is already decided; one accepted by another acceptance
        # has nothing to record (and its prior status belongs to that one).
        if current in (RiskStatus.CLOSED.value, RiskStatus.ACCEPTED.value):
            continue
        prior[risk.id] = current
        await risk_versioning.archive(
            db, risk, actor, change_reason=f"Risk acceptance approved: {a.name}",
            transition_from=current, transition_to=RiskStatus.ACCEPTED.value)
        risk.status = RiskStatus.ACCEPTED
    a.prior_risk_statuses = prior


async def _release_covered_risks(db: AsyncSession, a: RiskAcceptance, actor: User | None, why: str) -> None:
    """Hand each risk back after `a` stopped being live (revoked / expired).

    A risk still covered by ANOTHER live acceptance stays accepted, and a risk
    someone has moved since (e.g. closed it) is left alone.
    """
    others = (await db.execute(select(RiskAcceptance).where(
        RiskAcceptance.tenant_id == a.tenant_id, RiskAcceptance.id != a.id,
        RiskAcceptance.status == "approved"))).scalars().all()
    still_covered: set[str] = set()
    for o in others:
        if not _is_past(o.expiration_date):
            still_covered |= {r.id for r in await _covered_risks(db, a.tenant_id, o)}
    prior = a.prior_risk_statuses or {}
    for risk in await _covered_risks(db, a.tenant_id, a):
        if _status_value(risk) != RiskStatus.ACCEPTED.value or risk.id in still_covered:
            continue
        back = prior.get(risk.id) or RiskStatus.ASSESSED.value
        if back == RiskStatus.ACCEPTED.value:
            back = RiskStatus.ASSESSED.value
        await risk_versioning.archive(
            db, risk, actor, change_reason=f"Risk acceptance {why}: {a.name}",
            transition_from=RiskStatus.ACCEPTED.value, transition_to=back)
        risk.status = RiskStatus(back)


async def _release_on_expiry(db: AsyncSession, a: RiskAcceptance) -> None:
    await _release_covered_risks(db, a, None, "expired")


async def _assert_targets_in_tenant(db: AsyncSession, tenant_id: str, body: RACreate) -> None:
    if body.risk_ids:
        found = {r[0] for r in await db.execute(select(Risk.id).where(
            Risk.tenant_id == tenant_id, Risk.id.in_(body.risk_ids)))}
        missing = [i for i in body.risk_ids if i not in found]
        if missing:
            raise HTTPException(422, f"Unknown risk id(s) for this tenant: {', '.join(missing)}")
    if body.risk_scenario_ids:
        found = {r[0] for r in await db.execute(select(RiskScenario.id).where(
            RiskScenario.tenant_id == tenant_id, RiskScenario.id.in_(body.risk_scenario_ids)))}
        missing = [i for i in body.risk_scenario_ids if i not in found]
        if missing:
            raise HTTPException(422, f"Unknown risk scenario id(s) for this tenant: {', '.join(missing)}")


async def _load_acceptance(db: AsyncSession, aid: str, tenant_id: str) -> RiskAcceptance:
    a = (await db.execute(select(RiskAcceptance).where(
        RiskAcceptance.id == aid, RiskAcceptance.tenant_id == tenant_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Acceptance not found")
    return a


# ── Risk Acceptance endpoints ────────────────────────────────────────────
@router.get("/acceptances", response_model=list[RAOut])
async def list_acceptances(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    rows = await _expire_due(db, (
        select(RiskAcceptance)
        .where(RiskAcceptance.tenant_id == tenant_id)
        .order_by(RiskAcceptance.created_at.desc())
    ), "risk_acceptance", on_expire=_release_on_expiry)
    return [RAOut.model_validate(a) for a in rows]

@router.post("/acceptances", response_model=RAOut, status_code=201)
async def create_acceptance(body: RACreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _assert_targets_in_tenant(db, tenant_id, body)
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
    await _accept_covered_risks(db, a, user)
    await db.commit(); await db.refresh(a)
    return RAOut.model_validate(a)

@router.patch("/acceptances/{aid}/reject", response_model=RAOut)
async def reject_acceptance(
    aid: str,
    body: RADecision,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Refuse a pending acceptance. Same four-eyes rule as approval."""
    if not body.reason.strip():
        raise HTTPException(422, "A reason is required to reject a risk acceptance.")
    a = await _load_acceptance(db, aid, tenant_id)
    if a.requested_by_id == user.id:
        raise HTTPException(403, "You cannot reject your own risk acceptance (four-eyes principle).")
    if a.status != "pending":
        raise HTTPException(409, f"Cannot reject acceptance in status '{a.status}'")
    a.status = "rejected"; a.approver_id = user.id; a.rejection_reason = body.reason.strip()
    await db.commit(); await db.refresh(a)
    return RAOut.model_validate(a)

@router.patch("/acceptances/{aid}/revoke", response_model=RAOut)
async def revoke_acceptance(
    aid: str,
    body: RADecision,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Withdraw an approved acceptance before its expiry. Its own status,
    `revoked`, rather than `expired`: a lapse and a decision are different facts,
    and the decision has an author and a reason worth keeping. The covered risks
    return to the status they had before the acceptance."""
    if not body.reason.strip():
        raise HTTPException(422, "A reason is required to revoke a risk acceptance.")
    a = await _load_acceptance(db, aid, tenant_id)
    if a.status != "approved":
        raise HTTPException(409, f"Cannot revoke acceptance in status '{a.status}'")
    a.status = ExceptionStatus.REVOKED.value
    a.revoked_by_id = user.id; a.revoked_at = datetime.utcnow().isoformat()
    a.revocation_reason = body.reason.strip()
    await _release_covered_risks(db, a, user, "revoked")
    await db.commit(); await db.refresh(a)
    return RAOut.model_validate(a)


@router.patch("/acceptances/{aid}/withdraw", response_model=RAOut)
async def withdraw_acceptance(
    aid: str,
    body: RADecision,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """The requester takes back their own PENDING request (follow-up C-1).

    Before this a pending request could only be cleared by someone else (four-eyes
    reject), so a one-person tenant was stuck with it forever. Nothing was
    approved, so no risk changes status. Reason required; the trail keeps it.
    """
    if not body.reason.strip():
        raise HTTPException(422, "A reason is required to withdraw a risk acceptance.")
    a = await _load_acceptance(db, aid, tenant_id)
    if a.requested_by_id != user.id:
        raise HTTPException(403, "Only the person who requested this acceptance can withdraw it.")
    if a.status != "pending":
        raise HTTPException(409, f"Cannot withdraw acceptance in status '{a.status}'")
    a.status = "withdrawn"
    a.revoked_by_id = user.id; a.revoked_at = datetime.utcnow().isoformat()
    a.revocation_reason = body.reason.strip()
    await db.commit(); await db.refresh(a)
    out = RAOut.model_validate(a)
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=user.id, user_email=user.email,
            action="withdraw", entity_type="risk_acceptance", entity_id=out.id,
            entity_name=(out.name or "")[:255] or None,
            details={"from": "pending", "to": "withdrawn", "reason": out.revocation_reason}, origin="api",
        ))
    except Exception:
        pass
    return out
