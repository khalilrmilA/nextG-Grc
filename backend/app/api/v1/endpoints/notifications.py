"""Notification endpoints — in-app feed and preference management."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, and_, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies import get_current_user
from app.models.user import User
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
    limit: int = 25,
    offset: int = 0,
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
