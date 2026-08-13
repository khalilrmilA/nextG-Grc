"""Scanner import endpoints (Elite Pack, RFP module 3).

Gated behind require_feature("vuln_scanner_import"). Accepts a Nessus (.nessus)
or generic CSV (Qualys / OpenVAS) export, ingests findings into the vulnerability
register (auto-matching assets + dedup), and records a ScanJournal per run.
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.scan_journal import ScanJournal
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.services.scanner_import import import_scan
from app.models.scanner_connector import ScannerConnector
from app.services.scanner_connectors import sync_connector, test_connector

router = APIRouter()

_GATE = require_feature("vuln_scanner_import")

_ALLOWED_TOOLS = {"nessus", "tenable", "qualys", "openvas", "csv"}


class ScanJournalOut(BaseModel):
    id: str
    tenant_id: str
    tool: str
    filename: str | None
    status: str
    imported_count: int
    matched_count: int
    skipped_count: int
    parsed_count: int
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    model_config = {"from_attributes": True}


@router.post("/upload", response_model=ScanJournalOut, status_code=201)
async def upload_scan(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    tool: Annotated[str, Form()] = "csv",
    file: UploadFile = File(...),
):
    """Ingest a scanner export file and return the resulting ScanJournal."""
    tool_norm = (tool or "csv").strip().lower()
    if tool_norm not in _ALLOWED_TOOLS:
        raise HTTPException(
            400,
            f"Unsupported tool '{tool}'. Expected one of: {sorted(_ALLOWED_TOOLS)}",
        )

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    if len(content) > max_bytes:
        raise HTTPException(413, f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit")

    journal = await import_scan(
        db,
        tenant_id=tenant_id,
        tool=tool_norm,
        filename=file.filename,
        content=content,
        created_by_id=current_user.id,
    )
    return ScanJournalOut.model_validate(journal)


@router.get("/journal", response_model=list[ScanJournalOut])
async def list_journals(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = 50,
):
    """List recent scanner-import runs for the tenant (newest first)."""
    limit = max(1, min(limit, 200))
    result = await db.execute(
        select(ScanJournal)
        .where(ScanJournal.tenant_id == tenant_id)
        .order_by(ScanJournal.created_at.desc())
        .limit(limit)
    )
    return [ScanJournalOut.model_validate(j) for j in result.scalars().all()]


# ---------------------------------------------------------------------------
# Scanner connectors (live API integration — RFP 'Collecte automatique')
# ---------------------------------------------------------------------------
_CONNECTOR_TOOLS = {"tenable", "nessus", "qualys", "openvas", "demo"}


class ConnectorIn(BaseModel):
    name: str
    tool: str
    base_url: str | None = None
    api_key: str | None = None
    api_secret: str | None = None
    verify_ssl: bool = True
    schedule_enabled: bool = False
    interval_hours: int = 168


class ConnectorOut(BaseModel):
    id: str
    name: str
    tool: str
    base_url: str | None = None
    verify_ssl: bool
    enabled: bool
    schedule_enabled: bool
    interval_hours: int
    last_sync_at: datetime | None = None
    last_status: str | None = None
    model_config = {"from_attributes": True}  # note: secrets deliberately not exposed


class ConnectorTestOut(BaseModel):
    ok: bool
    message: str


async def _get_connector(db: AsyncSession, cid: str, tenant_id: str) -> ScannerConnector:
    result = await db.execute(
        select(ScannerConnector).where(
            ScannerConnector.id == cid, ScannerConnector.tenant_id == tenant_id
        )
    )
    conn = result.scalar_one_or_none()
    if conn is None:
        raise HTTPException(404, "Connector not found")
    return conn


@router.post("/connectors", response_model=ConnectorOut, status_code=201)
async def create_connector(
    body: ConnectorIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.tool not in _CONNECTOR_TOOLS:
        raise HTTPException(400, f"tool must be one of {sorted(_CONNECTOR_TOOLS)}")
    conn = ScannerConnector(
        tenant_id=tenant_id, name=body.name, tool=body.tool, base_url=body.base_url,
        api_key=body.api_key, api_secret=body.api_secret, verify_ssl=body.verify_ssl,
        schedule_enabled=body.schedule_enabled, interval_hours=body.interval_hours,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn


@router.get("/connectors", response_model=list[ConnectorOut])
async def list_connectors(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ScannerConnector).where(ScannerConnector.tenant_id == tenant_id)
        .order_by(ScannerConnector.created_at.desc())
    )
    return list(result.scalars().all())


@router.delete("/connectors/{cid}", status_code=204)
async def delete_connector(
    cid: str,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conn = await _get_connector(db, cid, tenant_id)
    await db.delete(conn)
    await db.commit()
    return None


@router.post("/connectors/{cid}/test", response_model=ConnectorTestOut)
async def test_conn(
    cid: str,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conn = await _get_connector(db, cid, tenant_id)
    return await test_connector(conn)


@router.post("/connectors/{cid}/sync", response_model=ScanJournalOut)
async def sync_conn(
    cid: str,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conn = await _get_connector(db, cid, tenant_id)
    journal = await sync_connector(db, conn, created_by_id=current_user.id)
    return ScanJournalOut.model_validate(journal)
