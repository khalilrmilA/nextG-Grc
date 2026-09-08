"""Scheduled reports (Elite Pack) — CRUD + manual run for recurring PDF deliveries."""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.models.audit import Audit
from app.models.user import User, UserRole
from app.models.report_schedule import ReportSchedule, ReportFrequency
from app.services.report_scheduler import (
    ENGAGEMENT_PREFIX,
    REPORT_TYPES,
    compute_next_run,
    engagement_id,
    is_supported_report_type,
    run_schedule_now,
)

router = APIRouter()
_GATE = require_feature("advanced_reporting")

# Report types considered sensitive enough to need a role check beyond the
# advanced_reporting feature gate. Mirrors the require_roles() pattern used
# elsewhere this session (vulnerabilities.py PATCH, applied_controls.py
# validate): tenant_admin/super_admin always pass, everyone else must hold one
# of the listed roles. report_type values not listed here (risk, executive)
# stay open to any authenticated tenant user with the feature unlocked.
_SENSITIVE_REPORT_ROLES: dict[str, set[UserRole]] = {
    "compliance": {UserRole.CISO, UserRole.COMPLIANCE_MANAGER},
    "audit": {UserRole.CISO, UserRole.COMPLIANCE_MANAGER},
    "vendor": {UserRole.CISO, UserRole.VENDOR_MANAGER},
}


def _role_key(report_type: str) -> str:
    """The key `_SENSITIVE_REPORT_ROLES` is looked up under.

    An engagement schedule carries the audit id inside its report_type
    ("audit:<uuid>"), so it can never match a static map entry — it would have
    silently escaped the gate that the plain "audit" type is under. It is an
    audit report by another name and takes the same roles.
    """
    return "audit" if engagement_id(report_type or "") else (report_type or "")


async def _check_report_type_role(db: AsyncSession, current_user: User, report_type: str) -> None:
    allowed = _SENSITIVE_REPORT_ROLES.get(_role_key(report_type))
    if not allowed:
        return
    if current_user.role in (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN):
        return
    # Effective roles, not the scalar column: a CISO who holds the role through
    # a Group, a custom role or an active delegation passes require_roles
    # everywhere else (and report_builder's identical dataset gate), so reading
    # `current_user.role` alone here refused schedules to accounts that can
    # already run the same report by hand.
    from app.services.authz import get_effective_roles
    effective = await get_effective_roles(current_user, db)
    if not effective.intersection(r.value for r in allowed):
        raise HTTPException(
            status_code=403,
            detail=f"Report type '{report_type}' requires one of: {sorted(r.value for r in allowed)}",
        )


class ScheduleCreate(BaseModel):
    name: str
    report_type: str
    frequency: ReportFrequency = ReportFrequency.WEEKLY
    recipients: list[str] = []
    hour: int = 7
    day_of_week: int = 0
    day_of_month: int = 1
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: str | None = None
    report_type: str | None = None
    frequency: ReportFrequency | None = None
    recipients: list[str] | None = None
    hour: int | None = None
    day_of_week: int | None = None
    day_of_month: int | None = None
    enabled: bool | None = None


class ScheduleOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    report_type: str
    frequency: ReportFrequency
    recipients: list
    hour: int
    day_of_week: int
    day_of_month: int
    enabled: bool
    last_run_at: datetime | None
    next_run_at: datetime | None
    last_status: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


async def _validate_type(db: AsyncSession, tenant_id: str, report_type: str) -> None:
    """Accept a tenant-wide type OR a per-engagement target.

    The bare `report_type not in REPORT_TYPES` test that used to live here made
    "audit:<audit_id>" schedules impossible to create, so report_scheduler's
    « validation avant diffusion » gate — the whole point of the engagement
    path — was unreachable from the API: the delivery code honoured a prefixed
    value that nothing could ever write.
    """
    if not is_supported_report_type(report_type or ""):
        raise HTTPException(
            400,
            f"report_type must be one of {sorted(REPORT_TYPES)} "
            f"or '{ENGAGEMENT_PREFIX}<audit_id>'",
        )
    audit_id = engagement_id(report_type or "")
    if not audit_id:
        return
    # Resolve the engagement now. _deliver() refuses an unknown audit at send
    # time and records "refused: audit not found", which an operator reads as a
    # broken mailer rather than a mistyped target — and the tenant predicate is
    # what stops a schedule being pointed at another tenant's audit.
    owned = (await db.execute(
        select(Audit.id).where(
            Audit.id == audit_id,
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not owned:
        raise HTTPException(404, "Audit not found for this tenant")


@router.get("", response_model=list[ScheduleOut])
async def list_schedules(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    rows = (await db.execute(
        select(ReportSchedule).where(ReportSchedule.tenant_id == tenant_id).order_by(ReportSchedule.created_at.desc())
    )).scalars().all()
    return [ScheduleOut.model_validate(r) for r in rows]


@router.post("", response_model=ScheduleOut, status_code=201)
async def create_schedule(
    body: ScheduleCreate,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _validate_type(db, tenant_id, body.report_type)
    await _check_report_type_role(db, current_user, body.report_type)
    sched = ReportSchedule(
        tenant_id=tenant_id, name=body.name, report_type=body.report_type,
        frequency=body.frequency, recipients=body.recipients, hour=body.hour,
        day_of_week=body.day_of_week, day_of_month=body.day_of_month, enabled=body.enabled,
        created_by_id=current_user.id,
    )
    sched.next_run_at = compute_next_run(sched, datetime.utcnow())
    db.add(sched)
    await db.commit()
    await db.refresh(sched)
    return ScheduleOut.model_validate(sched)


async def _get_owned(db: AsyncSession, tenant_id: str, sid: str) -> ReportSchedule:
    sched = (await db.execute(
        select(ReportSchedule).where(ReportSchedule.id == sid, ReportSchedule.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "Schedule not found")
    return sched


@router.patch("/{sid}", response_model=ScheduleOut)
async def update_schedule(
    sid: str,
    body: ScheduleUpdate,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    sched = await _get_owned(db, tenant_id, sid)
    provided = body.model_dump(exclude_none=True)
    if "report_type" in provided:
        await _validate_type(db, tenant_id, provided["report_type"])
    # Check the role against whichever report_type will be effective after this
    # update (the new one if changing, otherwise the schedule's current one) —
    # a caller without the right role shouldn't be able to edit a sensitive
    # schedule even when the report_type field itself isn't part of this PATCH.
    await _check_report_type_role(db, current_user, provided.get("report_type", sched.report_type))
    for field, value in provided.items():
        setattr(sched, field, value)
    # Recompute the next fire time if the cadence changed.
    if any(k in provided for k in ("frequency", "hour", "day_of_week", "day_of_month")):
        sched.next_run_at = compute_next_run(sched, datetime.utcnow())
    await db.commit()
    await db.refresh(sched)
    return ScheduleOut.model_validate(sched)


@router.delete("/{sid}", status_code=204)
async def delete_schedule(
    sid: str,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    sched = await _get_owned(db, tenant_id, sid)
    # Same role gate as create / update / run: without it any tenant user whose
    # plan unlocks advanced_reporting could delete the CISO's recurring
    # compliance or vendor delivery — a schedule they are not allowed to create,
    # edit or run.
    await _check_report_type_role(db, current_user, sched.report_type)
    await db.delete(sched)
    await db.commit()


@router.post("/{sid}/run")
async def run_now(
    sid: str,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Generate + email this schedule's report immediately (does not change its cadence)."""
    sched = await _get_owned(db, tenant_id, sid)
    await _check_report_type_role(db, current_user, sched.report_type)
    ok, status = await run_schedule_now(db, sched)
    return {"ok": ok, "status": status}
