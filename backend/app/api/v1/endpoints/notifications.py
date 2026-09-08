"""Notification endpoints — in-app feed and preference management."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, and_, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.notification import (
    Notification, NotificationPreference,
    NotificationType, NotificationChannel, NotificationStatus,
)

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: str
    type: str
    status: str
    title: str
    message: str
    data: dict | None
    created_at: datetime
    read_at: datetime | None
    # The i18n triple every notification carries since services/
    # notification_generator started writing it ("the in-app notification is
    # localised by the client from title_key/message_key"). The feed never put
    # it on the wire, so the client had nothing to call t() with and the bell
    # stayed English for a French/Arabic tenant. Additive and optional: title /
    # message remain the fallback for rows written before the keys existed and
    # for any key the client does not know.
    title_key: str | None = None
    message_key: str | None = None
    params: dict | None = None

    model_config = {"from_attributes": True}


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread_count: int
    total: int


class PreferenceIn(BaseModel):
    notification_type: NotificationType
    channel: NotificationChannel
    enabled: bool


class PreferencesUpdateIn(BaseModel):
    preferences: list[PreferenceIn]


class PreferenceOut(BaseModel):
    notification_type: str
    channel: str
    enabled: bool

    model_config = {"from_attributes": True}


# ── Notification feed endpoints ───────────────────────────────────────────────

@router.get("", response_model=NotificationListOut)
async def list_notifications(
    status_filter: Literal["all", "unread"] = "all",
    # Bounded server-side: an unbounded limit lets a caller pull the whole feed
    # in one request, and a negative offset is a database error (SQLite tolerates
    # it, PostgreSQL does not) rather than a 422.
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the authenticated user's in-app notification feed."""
    conditions = [Notification.user_id == current_user.id]
    if status_filter == "unread":
        conditions.append(Notification.status == NotificationStatus.UNREAD)

    total_result = await db.execute(
        select(func.count(Notification.id)).where(and_(*conditions))
    )
    total = total_result.scalar() or 0

    unread_result = await db.execute(
        select(func.count(Notification.id)).where(
            and_(
                Notification.user_id == current_user.id,
                Notification.status == NotificationStatus.UNREAD,
            )
        )
    )
    unread_count = unread_result.scalar() or 0

    items_result = await db.execute(
        select(Notification)
        .where(and_(*conditions))
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = items_result.scalars().all()

    return NotificationListOut(
        items=[NotificationOut.model_validate(n) for n in items],
        unread_count=unread_count,
        total=total,
    )


@router.patch("/{notification_id}/read", response_model=NotificationOut)
async def mark_as_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a single notification as read."""
    result = await db.execute(
        select(Notification).where(
            and_(
                Notification.id == notification_id,
                Notification.user_id == current_user.id,
            )
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    notif.status = NotificationStatus.READ
    notif.read_at = datetime.now(timezone.utc)
    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    return NotificationOut.model_validate(notif)


@router.patch("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark all unread notifications as read for the current user."""
    await db.execute(
        update(Notification)
        .where(
            and_(
                Notification.user_id == current_user.id,
                Notification.status == NotificationStatus.UNREAD,
            )
        )
        .values(status=NotificationStatus.READ, read_at=datetime.now(timezone.utc))
    )


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single notification."""
    await db.execute(
        delete(Notification).where(
            and_(
                Notification.id == notification_id,
                Notification.user_id == current_user.id,
            )
        )
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_all_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clear all notifications for the current user."""
    await db.execute(
        delete(Notification).where(Notification.user_id == current_user.id)
    )


@router.post("/check-deadlines", status_code=status.HTTP_200_OK)
async def check_deadlines_and_generate(
    # The trigger stays restricted to the roles that own the notification
    # programme (tenant_admin / super_admin auto-pass): the sweep is an
    # unthrottled scan of every register and it writes rows and sends mail.
    current_user: User = Depends(
        require_roles(UserRole.CISO, UserRole.RISK_MANAGER, UserRole.COMPLIANCE_MANAGER)
    ),
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Run all deadline/threshold checks and generate notifications.

    No longer the only trigger: app/main.py's lifespan now starts
    start_notification_scheduler(), which runs the same sweep on a loop (one
    worker at a time via its file lock). This endpoint is the "run it now"
    button on top of that, and run_all_checks is idempotent, so pressing it
    between sweeps costs a set of dedup queries and creates nothing twice.

    Scoped to the caller's tenant. Until run_all_checks took a tenant_id, one
    tenant's click swept all eleven — writing notifications and mailing the
    other ten tenants' users, and returning platform-wide counts to a caller
    who is entitled to none of them. The scheduler still passes None and keeps
    the whole-platform sweep.
    """
    from app.services.notification_generator import run_all_checks
    results = await run_all_checks(db, tenant_id)
    return {
        "status": "success",
        "notifications_created": results,
    }


# ── Preference management ─────────────────────────────────────────────────────

@router.get("/preferences", response_model=list[PreferenceOut])
async def get_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all notification preferences for the current user."""
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id
        )
    )
    prefs = result.scalars().all()

    # Build a full matrix of all types × channels, filling in defaults (True)
    existing: dict[tuple, bool] = {
        (p.notification_type, p.channel): p.enabled for p in prefs
    }
    full: list[PreferenceOut] = []
    for ntype in NotificationType:
        for channel in NotificationChannel:
            enabled = existing.get((ntype, channel), True)
            full.append(PreferenceOut(
                notification_type=ntype.value,
                channel=channel.value,
                enabled=enabled,
            ))
    return full


@router.put("/preferences", response_model=list[PreferenceOut])
async def update_preferences(
    body: PreferencesUpdateIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upsert notification preferences for the current user."""
    for pref_in in body.preferences:
        result = await db.execute(
            select(NotificationPreference).where(
                and_(
                    NotificationPreference.user_id == current_user.id,
                    NotificationPreference.notification_type == pref_in.notification_type,
                    NotificationPreference.channel == pref_in.channel,
                )
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.enabled = pref_in.enabled
        else:
            db.add(NotificationPreference(
                user_id=current_user.id,
                notification_type=pref_in.notification_type,
                channel=pref_in.channel,
                enabled=pref_in.enabled,
            ))

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    # Return updated full list
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id
        )
    )
    prefs = result.scalars().all()
    existing_map: dict[tuple, bool] = {
        (p.notification_type, p.channel): p.enabled for p in prefs
    }
    return [
        PreferenceOut(
            notification_type=ntype.value,
            channel=channel.value,
            enabled=existing_map.get((ntype, channel), True),
        )
        for ntype in NotificationType
        for channel in NotificationChannel
    ]
