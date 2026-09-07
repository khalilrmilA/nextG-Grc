"""Delegations and access recertification — the Administrateur's entitlement tools.

Both are named requirements for that role and had no implementation. See
``app/models/access_governance.py`` for the design notes.

Everything here writes to the hash-chained activity log. Granting, revoking and
recertifying authority are exactly the events an auditor asks to see, and a
delegation that leaves no trace is worse than no delegation at all.
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.core.database import get_db
from app.models.access_governance import AccessDelegation, AccessReviewCampaign, AccessReviewItem
from app.models.activity_log import ActivityLog
from app.models.user import ASSIGNABLE_ROLES, User, UserRole
from app.services.activity_chain import chain_and_add
from app.services.authz import get_effective_roles

router = APIRouter()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _audit(db, *, tenant_id, actor, action, entity_type, entity_id, details):
    """Record an entitlement event. Best-effort — never breaks the operation."""
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=actor.id,
            user_email=actor.email,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=None,
            details=details,
            ip_address=None,
            origin="api",
        ))
    except Exception:  # noqa: BLE001
        pass


# ── Delegations ──────────────────────────────────────────────────────────────

class DelegationCreate(BaseModel):
    delegate_id: str
    roles: list[str]
    starts_at: str          # ISO-8601
    ends_at: str
    reason: str | None = None
    delegator_id: str | None = None   # admin acting for someone else


class DelegationOut(BaseModel):
    id: str
    delegator_id: str
    delegate_id: str
    roles: list
    reason: str | None
    starts_at: str
    ends_at: str
    revoked_at: str | None
    is_active: bool

    model_config = {"from_attributes": True}


def _parse(ts: str, field: str) -> datetime:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, AttributeError):
        raise HTTPException(400, f"{field} must be an ISO-8601 datetime")


def _out(d: AccessDelegation) -> DelegationOut:
    return DelegationOut(
        id=d.id, delegator_id=d.delegator_id, delegate_id=d.delegate_id,
        roles=list(d.roles or []), reason=d.reason,
        starts_at=d.starts_at.isoformat(), ends_at=d.ends_at.isoformat(),
        revoked_at=d.revoked_at.isoformat() if d.revoked_at else None,
        is_active=d.is_active(_utcnow()),
    )


@router.post("/delegations", response_model=DelegationOut, status_code=201)
async def create_delegation(
    body: DelegationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Lend authority to a colleague for a bounded window.

    You may delegate your own roles. A tenant admin may also delegate on
    someone else's behalf, which is what makes cover possible for an
    unplanned absence — the person who is away cannot set it up themselves.
    """
    actor_roles = await get_effective_roles(current_user, db)
    is_admin = current_user.role in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN)

    delegator_id = body.delegator_id or current_user.id
    if delegator_id != current_user.id and not is_admin:
        raise HTTPException(403, "Only an administrator can delegate on someone else's behalf.")

    delegator = (await db.execute(select(User).where(
        User.id == delegator_id, User.tenant_id == tenant_id))).scalar_one_or_none()
    delegate = (await db.execute(select(User).where(
        User.id == body.delegate_id, User.tenant_id == tenant_id))).scalar_one_or_none()
    if not delegator or not delegate:
        raise HTTPException(404, "Delegator or delegate not found in this organization.")
    if delegator.id == delegate.id:
        raise HTTPException(400, "A user cannot delegate to themselves.")
    if not delegate.is_active:
        raise HTTPException(400, "Cannot delegate to a disabled account.")

    if not body.roles:
        raise HTTPException(400, "At least one role is required.")
    assignable = {r.value for r in ASSIGNABLE_ROLES}
    requested = {str(r).strip().lower() for r in body.roles}

    # tenant_admin and super_admin are never delegated, matching the rule
    # users.py and groups.py already enforce — lending administration of the
    # organisation would be a way around it.
    refused = requested - assignable
    if refused:
        raise HTTPException(403, f"These roles cannot be delegated: {sorted(refused)}")

    # You cannot lend authority you do not hold. Without this an ordinary user
    # could grant themselves anything by delegating it to themselves via a
    # second account.
    grantable = actor_roles if delegator_id == current_user.id else await get_effective_roles(delegator, db)
    if not is_admin and not requested <= grantable:
        raise HTTPException(403, f"You cannot delegate roles you do not hold: {sorted(requested - grantable)}")

    starts, ends = _parse(body.starts_at, "starts_at"), _parse(body.ends_at, "ends_at")
    if ends <= starts:
        raise HTTPException(400, "ends_at must be after starts_at.")

    d = AccessDelegation(
        tenant_id=tenant_id, delegator_id=delegator_id, delegate_id=delegate.id,
        roles=sorted(requested), reason=body.reason, starts_at=starts, ends_at=ends,
        created_by_id=current_user.id,
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)

    await _audit(db, tenant_id=tenant_id, actor=current_user, action="delegation_granted",
                 entity_type="delegation", entity_id=d.id,
                 details={"delegator_id": delegator_id, "delegate_id": delegate.id,
                          "roles": sorted(requested),
                          "starts_at": starts.isoformat(), "ends_at": ends.isoformat(),
                          "reason": body.reason})
    return _out(d)


@router.get("/delegations", response_model=list[DelegationOut])
async def list_delegations(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    active_only: bool = False,
):
    """Delegations in this organization. Non-admins see only their own."""
    q = select(AccessDelegation).where(AccessDelegation.tenant_id == tenant_id)
    if current_user.role not in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
        q = q.where(
            (AccessDelegation.delegator_id == current_user.id)
            | (AccessDelegation.delegate_id == current_user.id)
        )
    rows = (await db.execute(q.order_by(AccessDelegation.starts_at.desc()))).scalars().all()
    out = [_out(d) for d in rows]
    return [d for d in out if d.is_active] if active_only else out


@router.delete("/delegations/{delegation_id}", status_code=204)
async def revoke_delegation(
    delegation_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """End a delegation now. The row is kept — revocation is part of the record."""
    d = (await db.execute(select(AccessDelegation).where(
        AccessDelegation.id == delegation_id,
        AccessDelegation.tenant_id == tenant_id))).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Delegation not found")
    if d.revoked_at is not None:
        raise HTTPException(400, "This delegation is already revoked.")
    if current_user.role not in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN) \
            and current_user.id != d.delegator_id:
        raise HTTPException(403, "Only the delegator or an administrator can revoke this.")

    d.revoked_at = _utcnow()
    d.revoked_by_id = current_user.id
    await db.commit()

    await _audit(db, tenant_id=tenant_id, actor=current_user, action="delegation_revoked",
                 entity_type="delegation", entity_id=d.id,
                 details={"delegator_id": d.delegator_id, "delegate_id": d.delegate_id,
                          "roles": list(d.roles or [])})


# ── Access reviews (revues d'habilitations) ──────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    due_date: str | None = None
    notes: str | None = None


class ReviewItemOut(BaseModel):
    id: str
    user_id: str
    user_email: str | None
    roles_snapshot: list
    decision: str
    decided_by_id: str | None
    decided_at: str | None
    note: str | None
    applied: bool

    model_config = {"from_attributes": True}


class CampaignOut(BaseModel):
    id: str
    name: str
    status: str
    due_date: str | None
    completed_at: str | None
    notes: str | None
    total: int = 0
    pending: int = 0
    confirmed: int = 0
    revoked: int = 0

    model_config = {"from_attributes": True}


class DecisionIn(BaseModel):
    decision: str            # confirmed | revoked
    note: str | None = None


async def _campaign_out(db, c: AccessReviewCampaign) -> CampaignOut:
    items = (await db.execute(select(AccessReviewItem).where(
        AccessReviewItem.campaign_id == c.id))).scalars().all()
    return CampaignOut(
        id=c.id, name=c.name, status=c.status, due_date=c.due_date,
        completed_at=c.completed_at.isoformat() if c.completed_at else None,
        notes=c.notes, total=len(items),
        pending=sum(1 for i in items if i.decision == "pending"),
        confirmed=sum(1 for i in items if i.decision == "confirmed"),
        revoked=sum(1 for i in items if i.decision == "revoked"),
    )


@router.post("/access-reviews", response_model=CampaignOut, status_code=201)
async def open_campaign(
    body: CampaignCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Open a recertification round, snapshotting every active user's entitlements.

    The snapshot is the point: it records what the approver actually judged, so
    a role that changes mid-review cannot be confirmed by someone who never saw
    it.
    """
    from app.services.activity_chain import is_system_actor

    c = AccessReviewCampaign(
        tenant_id=tenant_id, name=body.name, due_date=body.due_date,
        notes=body.notes, created_by_id=current_user.id, status="open",
    )
    db.add(c)
    await db.flush()

    users = (await db.execute(select(User).where(
        User.tenant_id == tenant_id, User.is_active == True))).scalars().all()  # noqa: E712
    reviewed = 0
    for u in users:
        if is_system_actor(u.email):
            continue          # the automated-task principal is not a person to recertify
        roles = sorted(await get_effective_roles(u, db))
        db.add(AccessReviewItem(
            campaign_id=c.id, tenant_id=tenant_id, user_id=u.id,
            user_email=u.email, roles_snapshot=roles, decision="pending",
        ))
        reviewed += 1

    await db.commit()
    await db.refresh(c)

    await _audit(db, tenant_id=tenant_id, actor=current_user, action="access_review_opened",
                 entity_type="access_review", entity_id=c.id,
                 details={"name": body.name, "users_snapshotted": reviewed})
    return await _campaign_out(db, c)


@router.get("/access-reviews", response_model=list[CampaignOut])
async def list_campaigns(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO, UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    rows = (await db.execute(select(AccessReviewCampaign).where(
        AccessReviewCampaign.tenant_id == tenant_id
    ).order_by(AccessReviewCampaign.created_at.desc()))).scalars().all()
    return [await _campaign_out(db, c) for c in rows]


@router.get("/access-reviews/{campaign_id}/items", response_model=list[ReviewItemOut])
async def list_items(
    campaign_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO, UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    rows = (await db.execute(select(AccessReviewItem).where(
        AccessReviewItem.campaign_id == campaign_id,
        AccessReviewItem.tenant_id == tenant_id,
    ).order_by(AccessReviewItem.user_email))).scalars().all()
    return [
        ReviewItemOut(
            id=i.id, user_id=i.user_id, user_email=i.user_email,
            roles_snapshot=list(i.roles_snapshot or []), decision=i.decision,
            decided_by_id=i.decided_by_id,
            decided_at=i.decided_at.isoformat() if i.decided_at else None,
            note=i.note, applied=i.applied,
        )
        for i in rows
    ]


@router.patch("/access-reviews/items/{item_id}", response_model=ReviewItemOut)
async def decide_item(
    item_id: str,
    body: DecisionIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Confirm or revoke one person's entitlements.

    A revocation is APPLIED, not merely recorded: the account is reduced to
    viewer and its multi-role list cleared. A review whose decisions are never
    enforced is the failure mode that makes recertification theatre — the
    control exists to remove access, not to note that it should be removed.
    """
    if body.decision not in ("confirmed", "revoked"):
        raise HTTPException(400, "decision must be 'confirmed' or 'revoked'")

    item = (await db.execute(select(AccessReviewItem).where(
        AccessReviewItem.id == item_id,
        AccessReviewItem.tenant_id == tenant_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Review item not found")

    campaign = (await db.execute(select(AccessReviewCampaign).where(
        AccessReviewCampaign.id == item.campaign_id))).scalar_one_or_none()
    if campaign and campaign.status != "open":
        raise HTTPException(400, "This review is already completed.")

    subject = (await db.execute(select(User).where(User.id == item.user_id))).scalar_one_or_none()
    if subject and subject.id == current_user.id and body.decision == "confirmed":
        # Segregation of duties: confirming your own access defeats the point of
        # the review. Revoking your own is allowed — that direction only ever
        # reduces access, and refusing it would be an odd obstacle.
        raise HTTPException(403, "You cannot certify your own access. A second "
                                 "administrator must review your entitlements.")

    before = None
    if body.decision == "revoked" and subject:
        before = {
            "role": subject.role.value if hasattr(subject.role, "value") else subject.role,
            "roles": list(subject.roles or []),
        }
        subject.role = UserRole.VIEWER
        subject.roles = [UserRole.VIEWER.value]
        item.applied = True

    item.decision = body.decision
    item.note = body.note
    item.decided_by_id = current_user.id
    item.decided_at = _utcnow()
    await db.commit()
    await db.refresh(item)

    await _audit(db, tenant_id=tenant_id, actor=current_user,
                 action="access_review_decision", entity_type="user",
                 entity_id=item.user_id,
                 details={"campaign_id": item.campaign_id, "decision": body.decision,
                          "reviewed_roles": list(item.roles_snapshot or []),
                          "changed": ({"from": before, "to": {"role": "viewer", "roles": ["viewer"]}}
                                      if before else None),
                          "note": body.note})
    return ReviewItemOut(
        id=item.id, user_id=item.user_id, user_email=item.user_email,
        roles_snapshot=list(item.roles_snapshot or []), decision=item.decision,
        decided_by_id=item.decided_by_id,
        decided_at=item.decided_at.isoformat() if item.decided_at else None,
        note=item.note, applied=item.applied,
    )


@router.post("/access-reviews/{campaign_id}/complete", response_model=CampaignOut)
async def complete_campaign(
    campaign_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Close a round. Refused while anything is still undecided."""
    c = (await db.execute(select(AccessReviewCampaign).where(
        AccessReviewCampaign.id == campaign_id,
        AccessReviewCampaign.tenant_id == tenant_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Access review not found")
    if c.status != "open":
        raise HTTPException(400, "This review is already completed.")

    pending = (await db.execute(select(AccessReviewItem).where(
        AccessReviewItem.campaign_id == c.id,
        AccessReviewItem.decision == "pending"))).scalars().all()
    if pending:
        # Name who is blocking, and call out the self-review case explicitly.
        # Nobody may certify their own access, so a reviewer's own entitlement
        # needs a second reviewer — without saying so, a single-admin tenant
        # hits a 400 it cannot interpret and concludes the feature is broken.
        own = [i for i in pending if i.user_id == current_user.id]
        others = [i for i in pending if i.user_id != current_user.id]
        detail = (f"{len(pending)} entitlement(s) still undecided. "
                  f"A review closed with open items certifies nothing.")
        if others:
            names = ", ".join(sorted(i.user_email or i.user_id for i in others)[:5])
            detail += f" Awaiting a decision on: {names}."
        if own:
            detail += (" Your own entitlement is among them — nobody may certify "
                       "their own access, so a second administrator or the "
                       "platform administrator must decide it.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    c.status = "completed"
    c.completed_at = _utcnow()
    c.completed_by_id = current_user.id
    await db.commit()
    await db.refresh(c)

    await _audit(db, tenant_id=tenant_id, actor=current_user, action="access_review_completed",
                 entity_type="access_review", entity_id=c.id, details={"name": c.name})
    return await _campaign_out(db, c)
