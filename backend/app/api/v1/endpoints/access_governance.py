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
from sqlalchemy import func, select
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


_ZERO_COUNTS = {"total": 0, "pending": 0, "confirmed": 0, "revoked": 0}


async def _campaign_counts(db, campaign_ids: list[str]) -> dict[str, dict]:
    """Decision tallies for many campaigns in ONE grouped query.

    The listing used to load every item of every campaign, one query per
    campaign, purely to count them — a recertification round holds a row per
    person in the organisation, so that is the whole user table re-read once per
    round ever run.
    """
    if not campaign_ids:
        return {}
    rows = (await db.execute(
        select(AccessReviewItem.campaign_id, AccessReviewItem.decision, func.count())
        .where(AccessReviewItem.campaign_id.in_(campaign_ids))
        .group_by(AccessReviewItem.campaign_id, AccessReviewItem.decision)
    )).all()
    out: dict[str, dict] = {}
    for cid, decision, n in rows:
        bucket = out.setdefault(cid, dict(_ZERO_COUNTS))
        bucket["total"] += n
        if decision in ("pending", "confirmed", "revoked"):
            bucket[decision] += n
    return out


def _campaign_row(c: AccessReviewCampaign, counts: dict) -> CampaignOut:
    return CampaignOut(
        id=c.id, name=c.name, status=c.status, due_date=c.due_date,
        completed_at=c.completed_at.isoformat() if c.completed_at else None,
        notes=c.notes, **counts,
    )


async def _campaign_out(db, c: AccessReviewCampaign) -> CampaignOut:
    counts = (await _campaign_counts(db, [c.id])).get(c.id) or dict(_ZERO_COUNTS)
    return _campaign_row(c, counts)


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
    counts = await _campaign_counts(db, [c.id for c in rows])
    return [_campaign_row(c, counts.get(c.id) or dict(_ZERO_COUNTS)) for c in rows]


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


async def _guard_revocation(db, subject: User, actor: User, tenant_id: str) -> None:
    """Refuse the revocations this route must not be able to make.

    require_roles(TENANT_ADMIN, CISO) lets a CISO reach the decision endpoint,
    and users.py deliberately never lets a CISO touch an administrator's account
    — every user mutation there is gated on require_roles(TENANT_ADMIN) and
    refuses super admins outright ("Cannot modify super admin accounts"). A
    review decision must not be the way around that rule.

    The last-administrator check is separate: a revocation applies immediately
    and viewer is blocked from every write in get_current_user, so an
    organisation that revokes its only administrator — including the reviewer
    revoking themselves, which is deliberately allowed — cannot appoint a
    replacement afterwards and needs platform support to recover.
    """
    if subject.role == UserRole.SUPER_ADMIN:
        raise HTTPException(
            403, "Super admin accounts are managed by the platform and cannot be "
                 "revoked from a tenant access review.")
    if subject.role == UserRole.TENANT_ADMIN:
        if actor.role not in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
            raise HTTPException(
                403, "Only an administrator can revoke another administrator's access.")
        remaining = (await db.execute(
            select(func.count()).select_from(User).where(
                User.tenant_id == tenant_id,
                User.role == UserRole.TENANT_ADMIN,
                User.is_active == True,  # noqa: E712
                User.id != subject.id,
            )
        )).scalar() or 0
        if remaining == 0:
            raise HTTPException(
                400, "This is the organization's last administrator. Appoint another "
                     "administrator before revoking this one.")


async def _strip_effective_access(db, subject: User, actor: User, tenant_id: str) -> dict:
    """Remove everything get_effective_roles() would otherwise still grant.

    Reducing role/roles to viewer left three other sources untouched — a custom
    role the account holds, a Group it belongs to, and any delegation still
    inside its window — and get_effective_roles() unions all of them, so a person
    whose access had just been "revoked" walked away with every role they held
    through any of the three. The roles_snapshot the approver judged is itself
    built from get_effective_roles(), so those are precisely the roles the
    decision was made about; leaving them is the failure mode the docstring on
    this endpoint says the ``applied`` flag exists to prevent.
    """
    from app.models.group import Group

    removed = {
        "custom_role_ids": list(subject.custom_role_ids or []),
        "group_ids": [],
        "delegation_ids": [],
    }
    subject.custom_role_ids = []

    groups = (await db.execute(
        select(Group).where(Group.tenant_id == tenant_id)
    )).scalars().all()
    for g in groups:
        if subject.id in (g.member_ids or []):
            # Reassign rather than mutate: SQLAlchemy does not track in-place
            # edits to a JSON column.
            g.member_ids = [m for m in (g.member_ids or []) if m != subject.id]
            removed["group_ids"].append(g.id)

    now = _utcnow()
    live = (await db.execute(
        select(AccessDelegation).where(
            AccessDelegation.tenant_id == tenant_id,
            AccessDelegation.revoked_at.is_(None),
            (AccessDelegation.delegate_id == subject.id)
            | (AccessDelegation.delegator_id == subject.id),
        )
    )).scalars().all()
    for d in live:
        # Both directions, and future-dated ones too. Delegations TO them would
        # hand the roles straight back the moment the window opens; delegations
        # FROM them go on granting authority the delegator no longer holds,
        # because get_effective_roles reads the delegation's stored role list
        # rather than re-checking the delegator.
        d.revoked_at = now
        d.revoked_by_id = actor.id
        removed["delegation_ids"].append(d.id)

    return removed


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
        AccessReviewCampaign.id == item.campaign_id,
        AccessReviewCampaign.tenant_id == tenant_id))).scalar_one_or_none()
    if campaign is None:
        # An item with no campaign is anchored to nothing: it can never be closed
        # out by complete_campaign, and a revocation decided on it would still
        # change an account. Treat it as gone rather than acting on it.
        raise HTTPException(404, "The review this item belongs to no longer exists.")
    if campaign.status != "open":
        raise HTTPException(400, "This review is already completed.")

    subject = (await db.execute(select(User).where(
        User.id == item.user_id, User.tenant_id == tenant_id))).scalar_one_or_none()
    if subject and subject.id == current_user.id and body.decision == "confirmed":
        # Segregation of duties: confirming your own access defeats the point of
        # the review. Revoking your own is allowed — that direction only ever
        # reduces access, and refusing it would be an odd obstacle.
        raise HTTPException(403, "You cannot certify your own access. A second "
                                 "administrator must review your entitlements.")

    before = None
    removed = None
    if body.decision == "revoked" and subject:
        await _guard_revocation(db, subject, current_user, tenant_id)
        before = {
            "role": subject.role.value if hasattr(subject.role, "value") else subject.role,
            "roles": list(subject.roles or []),
        }
        subject.role = UserRole.VIEWER
        subject.roles = [UserRole.VIEWER.value]
        removed = await _strip_effective_access(db, subject, current_user, tenant_id)
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
                          # What else the revocation had to take away for it to
                          # mean anything — the record has to show it was applied.
                          "also_removed": removed,
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


# ── Custom roles (rôles personnalisés) ───────────────────────────────────────
# An organisation names the jobs it actually has and says which built-in roles
# each one needs. See models/access_governance.py for why these compose the
# built-ins rather than defining permissions from scratch.

class CustomRoleIn(BaseModel):
    name: str
    base_roles: list[str]
    description: str | None = None
    is_active: bool = True


class CustomRoleUpdate(BaseModel):
    name: str | None = None
    base_roles: list[str] | None = None
    description: str | None = None
    is_active: bool | None = None


class CustomRoleOut(BaseModel):
    id: str
    name: str
    description: str | None
    base_roles: list
    is_active: bool
    assigned_users: int = 0

    model_config = {"from_attributes": True}


def _validate_base_roles(roles: list[str]) -> list[str]:
    """Only delegable built-ins may be composed.

    tenant_admin and super_admin are excluded for the same reason they cannot be
    delegated or granted through a group: a custom role would otherwise be a way
    to mint an administrator without going through the checks that exist to stop
    exactly that.
    """
    if not roles:
        raise HTTPException(400, "A custom role must grant at least one built-in role.")
    assignable = {r.value for r in ASSIGNABLE_ROLES}
    wanted = {str(r).strip().lower() for r in roles}
    refused = wanted - assignable
    if refused:
        raise HTTPException(403, f"These roles cannot be composed into a custom role: {sorted(refused)}")
    return sorted(wanted)


async def _custom_role_holder_counts(db, tenant_id: str) -> dict[str, int]:
    """How many users hold each custom role, in one pass over the tenant's users.

    custom_role_ids is a JSON list, so this cannot be a GROUP BY — but it can be
    read once for a whole listing instead of once per role, and it can select the
    one column it needs rather than hydrating every User in the organisation.
    """
    rows = (await db.execute(
        select(User.custom_role_ids).where(User.tenant_id == tenant_id)
    )).all()
    counts: dict[str, int] = {}
    for (ids,) in rows:
        for cid in (ids or []):
            counts[cid] = counts.get(cid, 0) + 1
    return counts


def _custom_role_row(cr, assigned_users: int) -> CustomRoleOut:
    return CustomRoleOut(
        id=cr.id, name=cr.name, description=cr.description,
        base_roles=list(cr.base_roles or []), is_active=cr.is_active,
        assigned_users=assigned_users,
    )


async def _custom_role_out(db, cr) -> CustomRoleOut:
    counts = await _custom_role_holder_counts(db, cr.tenant_id)
    return _custom_role_row(cr, counts.get(cr.id, 0))


@router.post("/custom-roles", response_model=CustomRoleOut, status_code=201)
async def create_custom_role(
    body: CustomRoleIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Define a role in the organisation's own vocabulary."""
    from app.models.access_governance import CustomRole

    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "A name is required.")
    clash = (await db.execute(select(CustomRole).where(
        CustomRole.tenant_id == tenant_id, CustomRole.name == name))).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A custom role named '{name}' already exists.")

    base = _validate_base_roles(body.base_roles)
    cr = CustomRole(tenant_id=tenant_id, name=name, description=body.description,
                    base_roles=base, is_active=body.is_active, created_by_id=current_user.id)
    db.add(cr)
    await db.commit()
    await db.refresh(cr)

    await _audit(db, tenant_id=tenant_id, actor=current_user, action="custom_role_created",
                 entity_type="custom_role", entity_id=cr.id,
                 details={"name": name, "base_roles": base})
    return await _custom_role_out(db, cr)


@router.get("/custom-roles", response_model=list[CustomRoleOut])
async def list_custom_roles(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO, UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    from app.models.access_governance import CustomRole

    rows = (await db.execute(select(CustomRole).where(
        CustomRole.tenant_id == tenant_id).order_by(CustomRole.name))).scalars().all()
    counts = await _custom_role_holder_counts(db, tenant_id)
    return [_custom_role_row(cr, counts.get(cr.id, 0)) for cr in rows]


@router.patch("/custom-roles/{role_id}", response_model=CustomRoleOut)
async def update_custom_role(
    role_id: str,
    body: CustomRoleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Change a custom role. Takes effect immediately for everyone holding it."""
    from app.models.access_governance import CustomRole

    cr = (await db.execute(select(CustomRole).where(
        CustomRole.id == role_id, CustomRole.tenant_id == tenant_id))).scalar_one_or_none()
    if not cr:
        raise HTTPException(404, "Custom role not found")

    before = {"name": cr.name, "base_roles": list(cr.base_roles or []), "is_active": cr.is_active}
    if body.name is not None:
        cr.name = body.name.strip()
    if body.description is not None:
        cr.description = body.description
    if body.base_roles is not None:
        cr.base_roles = _validate_base_roles(body.base_roles)
    if body.is_active is not None:
        cr.is_active = body.is_active
    await db.commit()
    await db.refresh(cr)

    after = {"name": cr.name, "base_roles": list(cr.base_roles or []), "is_active": cr.is_active}
    if after != before:
        # Editing a role silently changes what every holder may do, so it is a
        # rights change and belongs in the audit trail as one.
        await _audit(db, tenant_id=tenant_id, actor=current_user, action="rights_change",
                     entity_type="custom_role", entity_id=cr.id,
                     details={"changed": {k: {"from": before[k], "to": after[k]}
                                          for k in before if before[k] != after[k]},
                              "source": "custom_role_edit"})
    return await _custom_role_out(db, cr)


@router.delete("/custom-roles/{role_id}", status_code=204)
async def delete_custom_role(
    role_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Delete a custom role and strip it from everyone holding it.

    Removing the assignments matters: a dangling id would resolve to nothing and
    the user would quietly lose access with no record of why.
    """
    from app.models.access_governance import CustomRole

    cr = (await db.execute(select(CustomRole).where(
        CustomRole.id == role_id, CustomRole.tenant_id == tenant_id))).scalar_one_or_none()
    if not cr:
        raise HTTPException(404, "Custom role not found")

    holders = [u for u in (await db.execute(select(User).where(
        User.tenant_id == tenant_id))).scalars().all() if role_id in (u.custom_role_ids or [])]
    for u in holders:
        u.custom_role_ids = [c for c in (u.custom_role_ids or []) if c != role_id]

    name, base = cr.name, list(cr.base_roles or [])
    await db.delete(cr)
    await db.commit()

    await _audit(db, tenant_id=tenant_id, actor=current_user, action="custom_role_deleted",
                 entity_type="custom_role", entity_id=role_id,
                 details={"name": name, "base_roles": base,
                          "unassigned_user_ids": [u.id for u in holders]})


class AssignCustomRolesIn(BaseModel):
    custom_role_ids: list[str]


@router.put("/users/{user_id}/custom-roles", response_model=list[str])
async def assign_custom_roles(
    user_id: str,
    body: AssignCustomRolesIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Replace the set of custom roles a user holds."""
    from app.models.access_governance import CustomRole
    from app.services.activity_chain import is_system_actor

    user = (await db.execute(select(User).where(
        User.id == user_id, User.tenant_id == tenant_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if is_system_actor(user.email):
        raise HTTPException(403, "The automated-task account cannot be modified.")

    wanted = sorted(set(body.custom_role_ids or []))
    if wanted:
        found = (await db.execute(select(CustomRole).where(
            CustomRole.id.in_(wanted), CustomRole.tenant_id == tenant_id))).scalars().all()
        missing = set(wanted) - {c.id for c in found}
        if missing:
            raise HTTPException(404, f"Unknown custom role(s): {sorted(missing)}")

    before = list(user.custom_role_ids or [])
    user.custom_role_ids = wanted
    await db.commit()

    if before != wanted:
        await _audit(db, tenant_id=tenant_id, actor=current_user, action="rights_change",
                     entity_type="user", entity_id=user.id,
                     details={"subject_user_id": user.id,
                              "changed": {"custom_role_ids": {"from": before, "to": wanted}},
                              "source": "custom_role_assignment"})
    return wanted
