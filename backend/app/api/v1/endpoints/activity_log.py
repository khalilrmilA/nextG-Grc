"""Activity Log endpoints — audit trail for all user actions."""
from datetime import datetime
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.activity_log import ActivityLog

router = APIRouter()


class LogEntry(BaseModel):
    id: str
    user_id: str
    user_email: str
    action: str
    entity_type: str
    entity_id: str | None
    entity_name: str | None
    details: dict | None
    ip_address: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class LogListResponse(BaseModel):
    items: list[LogEntry]
    total: int


@router.get("", response_model=LogListResponse)
async def list_activity_logs(
    entity_type: str | None = None,
    action: str | None = None,
    user_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List activity logs with optional filtering."""
    q = select(ActivityLog).where(ActivityLog.tenant_id == tenant_id)
    cq = select(func.count(ActivityLog.id)).where(ActivityLog.tenant_id == tenant_id)

    if entity_type:
        q = q.where(ActivityLog.entity_type == entity_type)
        cq = cq.where(ActivityLog.entity_type == entity_type)
    if action:
        q = q.where(ActivityLog.action == action)
        cq = cq.where(ActivityLog.action == action)
    if user_id:
        q = q.where(ActivityLog.user_id == user_id)
        cq = cq.where(ActivityLog.user_id == user_id)

    total = (await db.execute(cq)).scalar() or 0
    items = list((await db.execute(q.order_by(ActivityLog.created_at.desc()).limit(limit).offset(offset))).scalars().all())

    return LogListResponse(
        items=[LogEntry.model_validate(i) for i in items],
        total=total,
    )


async def log_activity(
    db: AsyncSession,
    tenant_id: str,
    user: User,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    entity_name: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
):
    """Helper to create an activity log entry. Call from other endpoints."""
    entry = ActivityLog(
        tenant_id=tenant_id,
        user_id=user.id,
        user_email=user.email,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        details=details,
        ip_address=ip_address,
    )
    db.add(entry)
