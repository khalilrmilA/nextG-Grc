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
from app.models.user import User
from app.models.report_schedule import ReportSchedule, ReportFrequency
from app.services.report_scheduler import compute_next_run, run_schedule_now, REPORT_TYPES

router = APIRouter()
_GATE = require_feature("advanced_reporting")


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
    ok, status = await run_schedule_now(db, sched)
    return {"ok": ok, "status": status}
