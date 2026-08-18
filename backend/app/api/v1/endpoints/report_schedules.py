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
from app.models.user import User, UserRole
from app.models.report_schedule import ReportSchedule, ReportFrequency
from app.services.report_scheduler import compute_next_run, run_schedule_now, REPORT_TYPES

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


def _check_report_type_role(current_user: User, report_type: str) -> None:
    allowed = _SENSITIVE_REPORT_ROLES.get(report_type)
    if not allowed:
        return
    if current_user.role in (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN):
        return
    if current_user.role not in allowed:
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


def _validate_type(report_type: str) -> None:
    if report_type not in REPORT_TYPES:
        raise HTTPException(400, f"report_type must be one of {sorted(REPORT_TYPES)}")


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
    _validate_type(body.report_type)
    _check_report_type_role(current_user, body.report_type)
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
        _validate_type(provided["report_type"])
    # Check the role against whichever report_type will be effective after this
    # update (the new one if changing, otherwise the schedule's current one) —
    # a caller without the right role shouldn't be able to edit a sensitive
    # schedule even when the report_type field itself isn't part of this PATCH.
    _check_report_type_role(current_user, provided.get("report_type", sched.report_type))
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
    _check_report_type_role(current_user, sched.report_type)
    ok, status = await run_schedule_now(db, sched)
    return {"ok": ok, "status": status}
