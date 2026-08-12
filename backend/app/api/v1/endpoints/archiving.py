"""Archiving + retention endpoints (Elite Pack) — RFP module 17.

Rule-based archiving (snapshot any entity with an optional retention window),
consult archives without restoring, enforce retention via purge, and export
archived data to CSV/Excel. Gated behind ``archiving``.
"""
import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.archive import ArchiveRecord
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.services.excel_export import rows_to_xlsx

router = APIRouter()

_EXPORT_COLUMNS = ["id", "entity_type", "entity_id", "reason", "archived_at", "retention_until"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ArchiveIn(BaseModel):
    entity_type: str
    entity_id: str | None = None
    payload: dict = {}
    reason: str | None = None
    retention_days: int | None = None   # None = keep indefinitely


class ArchiveOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str | None
    payload: dict
    reason: str | None
    archived_at: datetime
    retention_until: datetime | None
    model_config = {"from_attributes": True}


@router.post("", response_model=ArchiveOut, status_code=201)
async def archive_entity(
    body: ArchiveIn,
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    now = _utcnow()
    retention_until = None
    if body.retention_days is not None:
        if body.retention_days < 0:
            raise HTTPException(status_code=422, detail="retention_days must be >= 0")
        retention_until = now + timedelta(days=body.retention_days)
    record = ArchiveRecord(
        tenant_id=tenant_id, entity_type=body.entity_type, entity_id=body.entity_id,
        payload=body.payload or {}, reason=body.reason, archived_at=now,
        retention_until=retention_until, archived_by_id=current_user.id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.get("", response_model=list[ArchiveOut])
async def list_archives(
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_type: str | None = None,
    limit: int = 200,
):
    query = select(ArchiveRecord).where(ArchiveRecord.tenant_id == tenant_id)
    if entity_type:
        query = query.where(ArchiveRecord.entity_type == entity_type)
    query = query.order_by(ArchiveRecord.archived_at.desc()).limit(min(limit, 1000))
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{archive_id}", response_model=ArchiveOut)
async def get_archive(
    archive_id: str,
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ArchiveRecord).where(
            ArchiveRecord.id == archive_id, ArchiveRecord.tenant_id == tenant_id
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Archive record not found")
    return record


@router.post("/purge-expired")
async def purge_expired(
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Enforce retention: delete records whose retention_until has passed."""
    now = _utcnow()
    count_result = await db.execute(
        select(func.count()).select_from(ArchiveRecord).where(
            ArchiveRecord.tenant_id == tenant_id,
            ArchiveRecord.retention_until.is_not(None),
            ArchiveRecord.retention_until < now,
        )
    )
    to_purge = int(count_result.scalar() or 0)
    if to_purge:
        await db.execute(
            delete(ArchiveRecord).where(
                ArchiveRecord.tenant_id == tenant_id,
                ArchiveRecord.retention_until.is_not(None),
                ArchiveRecord.retention_until < now,
            )
        )
        await db.commit()
    return {"purged": to_purge}


@router.get("/export/download")
async def export_archives(
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity_type: str | None = None,
    format: str = "xlsx",
):
    if format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx' or 'csv'")
    query = select(ArchiveRecord).where(ArchiveRecord.tenant_id == tenant_id)
    if entity_type:
        query = query.where(ArchiveRecord.entity_type == entity_type)
    result = await db.execute(query.order_by(ArchiveRecord.archived_at.desc()).limit(10000))
    rows = [
        {
            "id": r.id, "entity_type": r.entity_type, "entity_id": r.entity_id,
            "reason": r.reason,
            "archived_at": r.archived_at.isoformat() if r.archived_at else None,
            "retention_until": r.retention_until.isoformat() if r.retention_until else None,
        }
        for r in result.scalars().all()
    ]
    if format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_EXPORT_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="archives.csv"'},
        )
    data = rows_to_xlsx("Archives", _EXPORT_COLUMNS, rows)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="archives.xlsx"'},
    )
