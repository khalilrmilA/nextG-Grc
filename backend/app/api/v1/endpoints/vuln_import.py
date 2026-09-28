"""Scanner import endpoints (Elite Pack, RFP module 3).

Gated behind require_feature("vuln_scanner_import"). Accepts a Nessus (.nessus)
or generic CSV (Qualys / OpenVAS) export, ingests findings into the vulnerability
register (auto-matching assets + dedup), and records a ScanJournal per run.
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.i18n_messages import request_language, translate_text
from app.core.security_utils import assert_safe_upload_name
from app.models.user import User, UserRole
from app.models.scan_journal import ScanJournal
from app.api.v1.dependencies.auth import get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.services.scanner_import import import_scan
from app.models.scanner_connector import ScannerConnector, ScannerConnectorSettings
from app.services.scanner_connectors import PULL_TOOLS, load_settings, sync_connector, test_connector
from app.services.easm_connector import normalize_config as normalize_easm_config

router = APIRouter()

_GATE = require_feature("vuln_scanner_import")

# require_feature is the BILLING gate — it says the tenant bought the capability,
# not that this user may use it. A scanner connector holds the credentials to a
# security tool, syncs on demand and can be destroyed; that is security-tooling
# administration, so it also takes a role gate (tenant/super admins auto-pass).
_CONNECTOR_ADMIN = require_roles(UserRole.CISO, UserRole.SECURITY_ANALYST)

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
    # Set on a connector-sync response only (EASM asset discovery); not stored
    # as a column — the journal's filename line carries it for later reads.
    discovered_assets: int | None = None
    model_config = {"from_attributes": True}


def _journal_out(journal: ScanJournal, lang: str) -> ScanJournalOut:
    """ScanJournalOut with the stored (English) error text localised for display."""
    out = ScanJournalOut.model_validate(journal)
    if out.error:
        out.error = translate_text(out.error, lang)
    return out


@router.post("/upload", response_model=ScanJournalOut, status_code=201)
async def upload_scan(
    current_user: Annotated[User, Depends(_GATE)],
    # Ingesting an export WRITES findings into the vulnerability register — the
    # same effect POST /vulnerabilities has, and it carried only the billing
    # gate. Same role set the connectors above already use; the journal below
    # stays readable to anyone entitled to the module.
    _role: Annotated[User, Depends(_CONNECTOR_ADMIN)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    tool: Annotated[str, Form()] = "csv",
    file: UploadFile = File(...),
):
    """Ingest a scanner export file and return the resulting ScanJournal."""
    # Reject filenames whose extension must never reach the uploads
    # volume — see security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(file.filename, field_name="file")
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
    return _journal_out(journal, request_language(request))


@router.get("/journal", response_model=list[ScanJournalOut])
async def list_journals(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
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
    lang = request_language(request)
    return [_journal_out(j, lang) for j in result.scalars().all()]


# ---------------------------------------------------------------------------
# Scanner connectors (live API integration — RFP 'Collecte automatique')
# ---------------------------------------------------------------------------
_CONNECTOR_TOOLS = {"tenable", "nessus", "qualys", "openvas", "demo", "easm"}
# Tools whose connector takes a `config` object (stored in scanner_connector_settings).
_CONFIG_TOOLS = {"easm"}


class ConnectorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    tool: str
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    api_secret: str | None = Field(default=None, max_length=500)
    verify_ssl: bool = True
    schedule_enabled: bool = False
    interval_hours: int = Field(default=168, ge=1, le=8760)  # 1 hour .. 1 year
    # EASM only — non-secret settings (auth style, endpoint paths, field
    # mapping); validated by easm_connector.normalize_config.
    config: dict | None = None


class ConnectorPatch(BaseModel):
    """Partial update. Secrets are only replaced when a non-empty value is sent,
    so the UI can edit a schedule without ever holding the stored keys."""
    name: str | None = Field(default=None, min_length=1, max_length=200)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    api_secret: str | None = Field(default=None, max_length=500)
    verify_ssl: bool | None = None
    enabled: bool | None = None
    schedule_enabled: bool | None = None
    interval_hours: int | None = Field(default=None, ge=1, le=8760)
    # EASM only. Merged key-by-key into the stored config (a key sent as null
    # goes back to its default); field_map, when sent, replaces the whole map.
    config: dict | None = None


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
    # Non-secret tool settings (EASM). Credentials are never part of it.
    config: dict | None = None
    model_config = {"from_attributes": True}  # note: secrets deliberately not exposed


class ConnectorTestOut(BaseModel):
    ok: bool
    message: str
    # EASM: first mapped findings, so the admin can check the field mapping.
    preview: list[dict] | None = None


def _out(conn: ScannerConnector, config: dict | None) -> ConnectorOut:
    out = ConnectorOut.model_validate(conn)
    out.config = config if (conn.tool or "").lower() in _CONFIG_TOOLS else None
    return out


def _validated_config(raw: dict | None, base_url: str | None) -> dict:
    try:
        return normalize_easm_config(raw, base_url)
    except ValueError as exc:
        raise HTTPException(400, f"Invalid EASM configuration: {exc}") from None


async def _settings_row(db: AsyncSession, cid: str) -> ScannerConnectorSettings | None:
    return (await db.execute(
        select(ScannerConnectorSettings).where(ScannerConnectorSettings.connector_id == cid)
    )).scalar_one_or_none()


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


def _clean_base_url(raw: str | None) -> str | None:
    """Empty -> None; otherwise it must at least be an http(s) URL. Reachability
    and the private-address policy are checked at call time (scanner_connectors
    ._check_target), where DNS is resolved for the request actually made."""
    url = (raw or "").strip()
    if not url:
        return None
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(400, "base_url must start with http:// or https://")
    return url


def _assert_schedulable(tool: str, schedule_enabled: bool) -> None:
    # OpenVAS has no pull (GMP, not HTTP): a schedule on it could only ever fail
    # and raise a failure alert every interval.
    if schedule_enabled and tool not in PULL_TOOLS:
        raise HTTPException(400, f"'{tool}' connectors are file-import only and cannot sync automatically")


@router.post("/connectors", response_model=ConnectorOut, status_code=201)
async def create_connector(
    body: ConnectorIn,
    current_user: Annotated[User, Depends(_GATE)],
    _role: Annotated[User, Depends(_CONNECTOR_ADMIN)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.tool not in _CONNECTOR_TOOLS:
        raise HTTPException(400, f"tool must be one of {sorted(_CONNECTOR_TOOLS)}")
    _assert_schedulable(body.tool, body.schedule_enabled)
    base_url = _clean_base_url(body.base_url)
    config = None
    if body.tool in _CONFIG_TOOLS:
        if not base_url:
            raise HTTPException(400, "base_url is required for an EASM connector")
        config = _validated_config(body.config, base_url)
    elif body.config:
        raise HTTPException(400, f"'{body.tool}' connectors take no config")
    conn = ScannerConnector(
        tenant_id=tenant_id, name=body.name.strip(), tool=body.tool, base_url=base_url,
        api_key=body.api_key or None, api_secret=body.api_secret or None, verify_ssl=body.verify_ssl,
        schedule_enabled=body.schedule_enabled, interval_hours=body.interval_hours,
    )
    db.add(conn)
    await db.flush()
    if config is not None:
        db.add(ScannerConnectorSettings(tenant_id=tenant_id, connector_id=conn.id, config=config))
    await db.commit()
    await db.refresh(conn)
    return _out(conn, config)


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
    conns = list(result.scalars().all())
    configs: dict[str, dict] = {}
    if any((c.tool or "").lower() in _CONFIG_TOOLS for c in conns):
        rows = await db.execute(
            select(ScannerConnectorSettings.connector_id, ScannerConnectorSettings.config)
            .where(ScannerConnectorSettings.tenant_id == tenant_id)
        )
        configs = {cid: cfg for cid, cfg in rows.all()}
    return [_out(c, configs.get(c.id)) for c in conns]


@router.patch("/connectors/{cid}", response_model=ConnectorOut)
async def update_connector(
    cid: str,
    body: ConnectorPatch,
    current_user: Annotated[User, Depends(_GATE)],
    _role: Annotated[User, Depends(_CONNECTOR_ADMIN)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Partial update (schedule, enable, URL, credentials). Tool is immutable."""
    conn = await _get_connector(db, cid, tenant_id)
    sent = body.model_fields_set
    if "name" in sent and body.name is not None:
        if not body.name.strip():
            raise HTTPException(400, "name cannot be empty")
        conn.name = body.name.strip()
    if "base_url" in sent:
        conn.base_url = _clean_base_url(body.base_url)
    is_config_tool = (conn.tool or "").lower() in _CONFIG_TOOLS
    if "config" in sent and body.config is not None and not is_config_tool:
        raise HTTPException(400, f"'{conn.tool}' connectors take no config")
    row = await _settings_row(db, conn.id) if is_config_tool else None
    config = dict(row.config or {}) if row else None
    if is_config_tool and (("config" in sent and body.config is not None) or "base_url" in sent):
        if not conn.base_url:
            raise HTTPException(400, "base_url is required for an EASM connector")
        merged = {**(config or {}), **(body.config or {})}
        # A path or URL key sent as null/"" goes back to its default.
        merged = {k: v for k, v in merged.items() if v is not None}
        # Re-validated against the (possibly new) base URL: a full-URL path must
        # stay on the connector's host.
        config = _validated_config(merged, conn.base_url)
        if row is None:
            db.add(ScannerConnectorSettings(tenant_id=tenant_id, connector_id=conn.id, config=config))
        else:
            row.config = config
    # Never clear a stored secret by omission or by an empty field.
    if body.api_key:
        conn.api_key = body.api_key
    if body.api_secret:
        conn.api_secret = body.api_secret
    for flag in ("verify_ssl", "enabled", "schedule_enabled"):
        if flag in sent and getattr(body, flag) is not None:
            setattr(conn, flag, getattr(body, flag))
    if "interval_hours" in sent and body.interval_hours is not None:
        conn.interval_hours = body.interval_hours
    _assert_schedulable((conn.tool or "").lower(), bool(conn.schedule_enabled))
    await db.commit()
    await db.refresh(conn)
    return _out(conn, config)


@router.delete("/connectors/{cid}", status_code=204)
async def delete_connector(
    cid: str,
    current_user: Annotated[User, Depends(_GATE)],
    _role: Annotated[User, Depends(_CONNECTOR_ADMIN)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conn = await _get_connector(db, cid, tenant_id)
    row = await _settings_row(db, conn.id)
    if row is not None:
        await db.delete(row)
        await db.flush()
    await db.delete(conn)
    await db.commit()
    return None


@router.post("/connectors/{cid}/test", response_model=ConnectorTestOut)
async def test_conn(
    cid: str,
    current_user: Annotated[User, Depends(_GATE)],
    _role: Annotated[User, Depends(_CONNECTOR_ADMIN)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
):
    conn = await _get_connector(db, cid, tenant_id)
    lang = request_language(request)
    result = await test_connector(conn, await load_settings(db, conn), lang=lang)
    if isinstance(result, dict) and isinstance(result.get("message"), str):
        result = {**result, "message": translate_text(result["message"], lang)}
    return result


@router.post("/connectors/{cid}/sync", response_model=ScanJournalOut)
async def sync_conn(
    cid: str,
    current_user: Annotated[User, Depends(_GATE)],
    _role: Annotated[User, Depends(_CONNECTOR_ADMIN)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
):
    conn = await _get_connector(db, cid, tenant_id)
    journal = await sync_connector(db, conn, created_by_id=current_user.id)
    return _journal_out(journal, request_language(request))
