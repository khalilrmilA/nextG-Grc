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
