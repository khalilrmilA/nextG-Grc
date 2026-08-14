"""Activity Log endpoints — audit trail for all user actions."""
from datetime import datetime
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.models.user import User
from app.models.activity_log import ActivityLog
from app.models.login_event import LoginEvent
from app.services.activity_chain import compute_entry_hash, _utcnow

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
    seq: int | None = None
    entry_hash: str | None = None
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


@router.get("/verify")
async def verify_chain(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_feature("tamper_evident_log")),
    tenant_id: str = Depends(get_tenant_id),
):
    """Recompute the tenant's activity-log hash chain and report its integrity (Elite Pack).

    Walks the chained entries in seq order; any tampered/deleted/reordered row makes the
    recomputed hash diverge and is reported as the first broken sequence number.
    """
    rows = list((await db.execute(
        select(ActivityLog)
        .where(ActivityLog.tenant_id == tenant_id, ActivityLog.seq.isnot(None))
        .order_by(ActivityLog.seq.asc())
    )).scalars().all())

    unchained = (await db.execute(
        select(func.count(ActivityLog.id)).where(
            ActivityLog.tenant_id == tenant_id, ActivityLog.seq.is_(None)
        )
    )).scalar() or 0

    prev_hash = ""
    expected_seq = 1
    broken_seq: int | None = None
    reason: str | None = None
    for row in rows:
        if row.seq != expected_seq:
            broken_seq, reason = row.seq, f"sequence gap (expected {expected_seq}, got {row.seq})"
            break
        if (row.prev_hash or "") != prev_hash:
            broken_seq, reason = row.seq, "prev_hash mismatch"
            break
        if row.entry_hash != compute_entry_hash(row, prev_hash):
            broken_seq, reason = row.seq, "entry_hash mismatch (row was altered)"
            break
        prev_hash = row.entry_hash
        expected_seq += 1

    return {
        "valid": broken_seq is None,
        "chained_entries": len(rows),
        "unchained_legacy_entries": unchained,
        "first_broken_seq": broken_seq,
        "reason": reason,
        "verified_at": _utcnow().isoformat(timespec="seconds"),
    }


class LoginEventOut(BaseModel):
    id: str
    tenant_id: str | None
    user_id: str | None
    email: str
    success: bool
    reason: str | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


@router.get("/login-events", response_model=list[LoginEventOut])
async def list_login_events(
    success: bool | None = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_feature("tamper_evident_log")),
    tenant_id: str = Depends(get_tenant_id),
):
    """List authentication attempts for the tenant, newest first (Elite Pack).

    Includes failures (bad password / locked / unknown user) that never reach the
    normal activity log.
    """
    q = select(LoginEvent).where(LoginEvent.tenant_id == tenant_id)
    if success is not None:
        q = q.where(LoginEvent.success == success)
    rows = (await db.execute(q.order_by(LoginEvent.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    return [LoginEventOut.model_validate(r) for r in rows]


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
