"""Audit campaigns — STB objectif 4, « créer, planifier et gérer les campagnes d'audit ».

A campaign is the *plan* ("Plan d'audit 2026"), an engagement is one line of it.
Before this module `audits` was a flat list with a per-audit `recurrence`, so
nothing could answer « montrez-moi le plan d'audit annuel et son avancement ».

Scope of this file: CRUD over AuditCampaign, the list of engagements attached to
a campaign, and the consolidated status/findings view a steering committee reads.
Attaching an engagement to a campaign is a write on the *audit* — it belongs to
endpoints/audits.py (audits.campaign_id) and is deliberately not duplicated here.

Deletion is refused while engagements still point at the campaign: the register
of what was audited, and under which plan, has to survive (objectif 8). A
finished plan is closed with `is_active=false`, not erased.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.core.database import get_db
from app.models.activity_log import ActivityLog
from app.models.audit import Audit, AuditFinding
from app.models.audit_campaign import CAMPAIGN_CADENCES, CAMPAIGN_STATUSES, AuditCampaign
from app.models.notification import Notification, NotificationStatus, NotificationType
from app.models.user import User, UserRole
from app.services.activity_chain import chain_and_add

router = APIRouter()

# Who plans audits. require_roles() auto-passes tenant_admin and super_admin,
# which is correct here — the plan is theirs to approve as much as the head of
# internal audit's to write.
CAMPAIGN_MANAGERS = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.AUDITOR)

# Seats that run the tenant's own governance. Anyone holding one keeps full
# access whether or not they are flagged external — a bank that hires its CISO
# from a firm has still put that person in the seat.
GOVERNANCE_SEATS = (
    UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.CISO, UserRole.COMPLIANCE_MANAGER,
)


def require_campaign_manager():
    """CAMPAIGN_MANAGERS, minus the appointed outside firm.

    `auditor` has to stay in the list: in a bank the head of internal audit holds
    exactly that role and the annual plan is theirs to write. But `is_external`
    marks an outside firm, and everywhere else in this feature such an account is
    confined to the engagements it was appointed to (see
    audit_comments.can_access_audit). Writing, announcing or deleting the bank's
    own audit plan is not one of them. `require_roles` has no way to express
    "this role, but not this account", so the carve-out is explicit.
    """
    checked = require_roles(*CAMPAIGN_MANAGERS)

    # `Depends` as a default rather than inside Annotated: this module runs under
    # `from __future__ import annotations`, so an Annotated[...] here would be a
    # string FastAPI resolves against MODULE globals — and `checked` is a local.
    async def _dep(user: User = Depends(checked)) -> User:
        if user.is_external and user.role not in GOVERNANCE_SEATS:
            raise HTTPException(
                403,
                "An external auditor conducts the engagements they are appointed to; "
                "the tenant's audit plan is not theirs to change.",
            )
        return user

    return _dep


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CampaignCreate(BaseModel):
    name: str
    description: str | None = None
    cadence: str = "ponctuelle"
    status: str = "draft"
    period_start: str | None = None      # ISO "YYYY-MM-DD", like audits.planned_start
    period_end: str | None = None
    owner_id: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    cadence: str | None = None
    status: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    owner_id: str | None = None
    is_active: bool | None = None


class CampaignOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    description: str | None
    cadence: str
    status: str
    period_start: str | None
    period_end: str | None
    owner_id: str | None
    stakeholders_notified_at: datetime | None
    is_active: bool
    created_by_id: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class CampaignListOut(BaseModel):
    items: list[CampaignOut]
    total: int
    limit: int
    offset: int


class CampaignAuditOut(BaseModel):
    """An engagement as it appears inside its campaign."""

    id: str
    title: str
    audit_type: str
    status: str
    lead_auditor_id: str | None
    framework_id: str | None
    planned_start: str | None
    planned_end: str | None
    report_status: str
    findings_count: int


class CampaignSummaryOut(BaseModel):
    """What a steering committee asks for: where the plan stands, in one call."""

    campaign: CampaignOut
    audits_total: int
    audits_by_status: dict[str, int]
    audits_closed: int
    completion_pct: float
    findings_total: int
    findings_by_severity: dict[str, int]
    findings_by_status: dict[str, int]
    findings_open: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _enum_value(v) -> str:
    return v.value if hasattr(v, "value") else str(v)


def _check_iso_date(value: str | None, field: str) -> None:
    if value is None or value == "":
        return
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"{field} must be an ISO date (YYYY-MM-DD)")


def _validate_campaign_fields(
    cadence: str | None, status: str | None, period_start: str | None, period_end: str | None
) -> None:
    """Vocabulary and period sanity — the model stores plain strings on purpose
    (portability across SQLite/PostgreSQL/Oracle/MSSQL), so validation lives here."""
    if cadence is not None and cadence not in CAMPAIGN_CADENCES:
        raise HTTPException(422, f"cadence must be one of {list(CAMPAIGN_CADENCES)}")
    if status is not None and status not in CAMPAIGN_STATUSES:
        raise HTTPException(422, f"status must be one of {list(CAMPAIGN_STATUSES)}")
    _check_iso_date(period_start, "period_start")
    _check_iso_date(period_end, "period_end")
    if period_start and period_end and period_start > period_end:
        raise HTTPException(422, "period_end must not precede period_start")


async def _validate_owner(db: AsyncSession, tenant_id: str, owner_id: str | None) -> None:
    """An owner from another tenant would leak a name across the boundary."""
    if not owner_id:
        return
    owner = (await db.execute(
        select(User).where(User.id == owner_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if owner is None:
        raise HTTPException(404, "Owner not found in this tenant")


async def _get_campaign(db: AsyncSession, tenant_id: str, campaign_id: str) -> AuditCampaign:
    campaign = (await db.execute(
        select(AuditCampaign).where(
            AuditCampaign.id == campaign_id, AuditCampaign.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(404, "Campaign not found")
    return campaign


async def _log(
    db: AsyncSession, tenant_id: str, user: User, campaign: AuditCampaign,
    action: str, details: dict | None = None,
) -> None:
    """The audit plan is a governance artefact; who changed it must be recoverable.

    Never write activity_logs directly — chain_and_add keeps the tenant's
    hash chain intact and commits on its own.
    """
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=user.id, user_email=user.email,
        action=action, entity_type="audit_campaign",
        entity_id=campaign.id, entity_name=campaign.name,
        details=details or {},
    ))


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("", response_model=CampaignListOut)
async def list_campaigns(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    status: str | None = Query(None, description="|".join(CAMPAIGN_STATUSES)),
    cadence: str | None = Query(None, description="|".join(CAMPAIGN_CADENCES)),
    is_active: bool | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """The tenant's audit plans. Readable by anyone in the tenant — an auditee is
    entitled to know which campaign an engagement they are part of belongs to."""
    q = select(AuditCampaign).where(AuditCampaign.tenant_id == tenant_id)
    cq = select(func.count(AuditCampaign.id)).where(AuditCampaign.tenant_id == tenant_id)
    if status:
        q, cq = q.where(AuditCampaign.status == status), cq.where(AuditCampaign.status == status)
    if cadence:
        q, cq = q.where(AuditCampaign.cadence == cadence), cq.where(AuditCampaign.cadence == cadence)
    if is_active is not None:
        q, cq = q.where(AuditCampaign.is_active == is_active), cq.where(AuditCampaign.is_active == is_active)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        clause = or_(AuditCampaign.name.ilike(pattern), AuditCampaign.description.ilike(pattern))
        q, cq = q.where(clause), cq.where(clause)

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        # Newest plan first, then a stable tiebreaker so paging never repeats a row.
        q.order_by(AuditCampaign.period_start.desc().nullslast(),
                   AuditCampaign.created_at.desc(),
                   AuditCampaign.id)
        .limit(limit).offset(offset)
    )).scalars().all()
    return CampaignListOut(
        items=[CampaignOut.model_validate(c) for c in rows],
        total=total, limit=limit, offset=offset,
    )


@router.post("", response_model=CampaignOut, status_code=201)
async def create_campaign(
    body: CampaignCreate,
    user: Annotated[User, Depends(require_campaign_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    _validate_campaign_fields(body.cadence, body.status, body.period_start, body.period_end)
    await _validate_owner(db, tenant_id, body.owner_id)

    campaign = AuditCampaign(
        tenant_id=tenant_id, name=name, description=body.description,
        cadence=body.cadence, status=body.status,
        period_start=body.period_start or None, period_end=body.period_end or None,
        owner_id=body.owner_id, created_by_id=user.id,
    )
    db.add(campaign)
    await db.flush()
    await db.commit()
    await _log(db, tenant_id, user, campaign, "create", {
        "cadence": campaign.cadence, "status": campaign.status,
        "period_start": campaign.period_start, "period_end": campaign.period_end,
    })
    await db.refresh(campaign)
    return CampaignOut.model_validate(campaign)


@router.get("/{campaign_id}", response_model=CampaignOut)
async def get_campaign(
    campaign_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return CampaignOut.model_validate(await _get_campaign(db, tenant_id, campaign_id))


@router.patch("/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: str,
    body: CampaignUpdate,
    user: Annotated[User, Depends(require_campaign_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    campaign = await _get_campaign(db, tenant_id, campaign_id)
    _validate_campaign_fields(
        body.cadence, body.status,
        body.period_start if body.period_start is not None else campaign.period_start,
        body.period_end if body.period_end is not None else campaign.period_end,
    )
    await _validate_owner(db, tenant_id, body.owner_id)

    changed: dict[str, list] = {}
    for field in ("name", "description", "cadence", "status", "period_start",
                  "period_end", "owner_id", "is_active"):
        new = getattr(body, field)
        if new is None:
            continue
        old = getattr(campaign, field)
        if old != new:
            changed[field] = [old, new]
            setattr(campaign, field, new)
    if not changed:
        return CampaignOut.model_validate(campaign)

    await db.commit()
    await _log(db, tenant_id, user, campaign, "update", {"changed": changed})
    await db.refresh(campaign)
    return CampaignOut.model_validate(campaign)


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(
    campaign_id: str,
    user: Annotated[User, Depends(require_campaign_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete an empty plan. A plan that already has engagements is closed, not erased.

    Hard-deleting it would orphan audits.campaign_id and destroy the evidence of
    which plan an engagement was conducted under.
    """
    campaign = await _get_campaign(db, tenant_id, campaign_id)
    attached = (await db.execute(
        select(func.count(Audit.id)).where(
            Audit.campaign_id == campaign.id, Audit.deleted_at.is_(None)
        )
    )).scalar() or 0
    if attached:
        raise HTTPException(
            409,
            f"{attached} audit(s) belong to this campaign. "
            "Detach them or set is_active=false to close the plan instead.",
        )
    # Recorded before the delete: afterwards this entry is the only trace the
    # plan ever existed.
    await _log(db, tenant_id, user, campaign, "delete", {
        "cadence": campaign.cadence, "status": campaign.status,
        "period_start": campaign.period_start, "period_end": campaign.period_end,
    })
    await db.delete(campaign)
    await db.commit()


# ---------------------------------------------------------------------------
# The engagements inside a plan, and their consolidated state
# ---------------------------------------------------------------------------
@router.get("/{campaign_id}/audits", response_model=list[CampaignAuditOut])
async def campaign_audits(
    campaign_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """The engagements that make up the plan, with their finding counts.

    Soft-deleted engagements are excluded, matching list_audits — a plan must not
    show a line the register itself no longer shows.
    """
    campaign = await _get_campaign(db, tenant_id, campaign_id)
    audits = (await db.execute(
        select(Audit).where(
            Audit.campaign_id == campaign.id,
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
        ).order_by(Audit.planned_start.nullslast(), Audit.created_at, Audit.id)
    )).scalars().all()
    if not audits:
        return []

    # One grouped query instead of one per audit.
    counts = dict((await db.execute(
        select(AuditFinding.audit_id, func.count(AuditFinding.id))
        .where(AuditFinding.audit_id.in_([a.id for a in audits]))
        .group_by(AuditFinding.audit_id)
    )).all())
    return [
        CampaignAuditOut(
            id=a.id, title=a.title, audit_type=_enum_value(a.audit_type),
            status=_enum_value(a.status), lead_auditor_id=a.lead_auditor_id,
            framework_id=a.framework_id, planned_start=a.planned_start,
            planned_end=a.planned_end, report_status=a.report_status or "draft",
            findings_count=int(counts.get(a.id, 0)),
        )
        for a in audits
    ]


@router.get("/{campaign_id}/summary", response_model=CampaignSummaryOut)
async def campaign_summary(
    campaign_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Consolidated campaign status + findings — the « avancement du plan » view.

    Everything is aggregated in SQL: a plan can hold dozens of engagements and
    hundreds of findings, and this endpoint is what a dashboard polls.
    """
    campaign = await _get_campaign(db, tenant_id, campaign_id)

    by_status_rows = (await db.execute(
        select(Audit.status, func.count(Audit.id)).where(
            Audit.campaign_id == campaign.id,
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
        ).group_by(Audit.status)
    )).all()
    audits_by_status = {_enum_value(s): int(n) for s, n in by_status_rows}
    audits_total = sum(audits_by_status.values())
    audits_closed = audits_by_status.get("closed", 0)

    sev_rows = (await db.execute(
        select(AuditFinding.severity, func.count(AuditFinding.id))
        .select_from(AuditFinding)
        .join(Audit, Audit.id == AuditFinding.audit_id)
        .where(Audit.campaign_id == campaign.id,
               Audit.tenant_id == tenant_id,
               Audit.deleted_at.is_(None))
        .group_by(AuditFinding.severity)
    )).all()
    st_rows = (await db.execute(
        select(AuditFinding.status, func.count(AuditFinding.id))
        .select_from(AuditFinding)
        .join(Audit, Audit.id == AuditFinding.audit_id)
        .where(Audit.campaign_id == campaign.id,
               Audit.tenant_id == tenant_id,
               Audit.deleted_at.is_(None))
        .group_by(AuditFinding.status)
    )).all()
    findings_by_severity = {_enum_value(s): int(n) for s, n in sev_rows}
    findings_by_status = {_enum_value(s): int(n) for s, n in st_rows}
    findings_total = sum(findings_by_status.values())
    # "Open" is everything not yet closed or formally accepted — the number a
    # steering committee actually chases.
    findings_open = findings_total - findings_by_status.get("closed", 0) - findings_by_status.get("accepted", 0)

    return CampaignSummaryOut(
        campaign=CampaignOut.model_validate(campaign),
        audits_total=audits_total,
        audits_by_status=audits_by_status,
        audits_closed=audits_closed,
        completion_pct=round(audits_closed * 100.0 / audits_total, 1) if audits_total else 0.0,
        findings_total=findings_total,
        findings_by_severity=findings_by_severity,
        findings_by_status=findings_by_status,
        findings_open=max(findings_open, 0),
    )


# ---------------------------------------------------------------------------
# Announcing the plan
# ---------------------------------------------------------------------------
@router.post("/{campaign_id}/notify", response_model=CampaignOut)
async def notify_stakeholders(
    campaign_id: str,
    user: Annotated[User, Depends(require_campaign_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    force: bool = Query(False, description="Re-announce a plan that was already announced"),
):
    """Tell the stakeholders the plan exists — once.

    `stakeholders_notified_at` is the guard the model was given for exactly this:
    the two uvicorn workers share no memory, so a de-duplication flag has to live
    in the database or the same plan is announced twice.
    """
    campaign = await _get_campaign(db, tenant_id, campaign_id)
    if campaign.stakeholders_notified_at and not force:
        raise HTTPException(409, "This campaign has already been announced. Pass force=true to re-send.")

    # Governance recipients + the plan's owner + every lead auditor it names.
    recipient_ids: set[str] = set()
    if campaign.owner_id:
        recipient_ids.add(campaign.owner_id)
    lead_ids = (await db.execute(
        select(Audit.lead_auditor_id).where(
            Audit.campaign_id == campaign.id,
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
            Audit.lead_auditor_id.isnot(None),
        ).distinct()
    )).scalars().all()
    recipient_ids.update(i for i in lead_ids if i)

    governance = (await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            User.role.in_([UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.TENANT_ADMIN]),
        )
    )).scalars().all()
    recipient_ids.update(u.id for u in governance)
    recipient_ids.discard(user.id)  # never notify the person who pressed the button

    if recipient_ids:
        recipients = (await db.execute(
            select(User).where(User.id.in_(recipient_ids), User.tenant_id == tenant_id,
                               User.is_active == True)  # noqa: E712
        )).scalars().all()
        for r in recipients:
            db.add(Notification(
                tenant_id=tenant_id, user_id=r.id,
                type=NotificationType.SYSTEM, status=NotificationStatus.UNREAD,
                # title/message stay populated as the fallback for the e-mail leg
                # and for any client that cannot resolve the key.
                title="Audit plan published",
                message=f"The audit campaign '{campaign.name}' has been published.",
                title_key="notifications.audit_campaign.published.title",
                message_key="notifications.audit_campaign.published.message",
                params={"campaign": campaign.name, "cadence": campaign.cadence},
                data={"entity_type": "audit_campaign", "entity_id": campaign.id,
                      "link": f"/audits?campaign={campaign.id}", "severity": "info"},
            ))

    campaign.stakeholders_notified_at = datetime.now(timezone.utc)
    await db.commit()
    await _log(db, tenant_id, user, campaign, "notify", {"recipients": len(recipient_ids)})
    await db.refresh(campaign)
    return CampaignOut.model_validate(campaign)
