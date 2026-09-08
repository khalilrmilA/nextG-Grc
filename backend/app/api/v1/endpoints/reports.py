"""Reports endpoints — generate, download and archive PDF reports.

Three things changed here beyond the original generate/preview pair:

**Language.** A report is an artefact that leaves the platform and lands in an
examiner's file, so it has to exist in French and Arabic, not only in the
language of the screen that launched it. Every route resolves a language from an
explicit ``?lang=`` (an ``<a href>`` cannot set a header, and a report is very
often fetched from a plain link) falling back to ``Accept-Language``, and hands
it to the generator.

**Archiving.** ``/generate`` now persists what it produced. Before, the only copy
of a report was the body of one HTTP response: there was no historique to list,
and a report that had been distributed could never be re-read as it was sent.

**Traceability.** Producing and re-downloading a report are recorded in the
hash-chained activity trail, so « qui a consulté ce rapport ? » has an answer.
"""
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.activity_log import ActivityLog
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.services import file_integrity
from app.services.activity_chain import chain_and_add
from app.services.ai_locale import get_request_language, normalize_language
from app.services.report_generator import (
    REPORT_GENERATORS,
    archive_report,
    generate_report,
    get_archived_report,
    list_report_archive,
    report_parent_type,
    report_type_catalog,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# The historique is the archive of documents that have already been produced —
# and, for the ones that were distributed, of exactly what a recipient holds.
# Generating a fresh report stays open to any authenticated tenant user (that is
# today's behaviour and narrowing it would break existing users); reading back
# what was produced before is a governance act, so it is gated. require_roles
# auto-passes tenant_admin/super_admin, which is intended here.
_REPORT_ARCHIVE_ROLES = (
    UserRole.CISO,
    UserRole.RISK_MANAGER,
    UserRole.COMPLIANCE_MANAGER,
    UserRole.AUDITOR,
    UserRole.EXECUTIVE,
)


class ArchivedReportOut(BaseModel):
    """One archived report — the row an « historique des rapports » screen lists."""
    id: str
    report_type: str
    version_number: int
    file_name: str | None
    file_size_bytes: int | None
    sha256: str | None
    status: str
    note: str | None
    generated_by_id: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


def _resolve_lang(explicit: str | None, header_lang: str) -> str:
    """`?lang=` wins over Accept-Language, unknown values fall back to the header.

    A download is very often a plain link or a `window.open`, neither of which
    can carry a header — so the query parameter has to exist, and has to win.
    """
    return normalize_language(explicit) or header_lang


async def _tenant_name(db: AsyncSession, tenant_id: str) -> str:
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    return tenant.name if tenant else "Organization"


async def _log(db: AsyncSession, tenant_id: str, user: User, action: str,
               entity_id: str | None, entity_name: str | None, details: dict) -> None:
    """Append to the tenant's hash-chained trail. Never blocks the response."""
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=user.id, user_email=user.email,
            action=action, entity_type="report",
            entity_id=entity_id, entity_name=entity_name, details=details,
        ))
    except Exception as exc:  # noqa: BLE001 — a trail write must not cost the report
        logger.warning("report activity log write failed: %s", exc)


@router.get("/types")
async def list_report_types(
    lang: str | None = Query(None, description="en | fr | ar — overrides Accept-Language"),
    header_lang: str = Depends(get_request_language),
):
    """List all available report types, named in the caller's language."""
    return {"types": report_type_catalog(_resolve_lang(lang, header_lang))}


@router.get("/history", response_model=list[ArchivedReportOut])
async def list_report_history(
    report_type: str | None = Query(None, description="Filter to one report type"),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REPORT_ARCHIVE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Archivage des rapports dans l'historique » — every report this tenant has
    generated, newest first, with the digest of the bytes that were produced."""
    if report_type and report_type not in REPORT_GENERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown report type. Valid types: {list(REPORT_GENERATORS.keys())}",
        )
    rows = await list_report_archive(db, tenant_id, report_type=report_type, limit=limit)
    prefix_len = len(report_parent_type(""))
    return [
        ArchivedReportOut(
            id=r.id,
            report_type=(r.parent_type or "")[prefix_len:],
            version_number=r.version_number,
            file_name=r.file_name,
            file_size_bytes=r.file_size_bytes,
            sha256=r.file_sha256,
            status=r.status,
            note=r.note,
            generated_by_id=r.uploaded_by_id,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/history/{version_id}/download")
async def download_archived_report(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REPORT_ARCHIVE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Re-read an archived report exactly as it was produced.

    The digest is re-checked before the bytes are served: an archive whose file
    no longer matches what was recorded is not an archive, and handing it over
    silently would defeat the point of keeping one.
    """
    version = await get_archived_report(db, tenant_id, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Archived report not found")

    full = Path(version.file_path) if version.is_absolute_path else Path(settings.UPLOADS_DIR) / version.file_path
    status, _actual = file_integrity.verify_file(full, version.file_sha256)
    if status == file_integrity.MISSING:
        raise HTTPException(status_code=404, detail="Archived report file is no longer on disk")
    if status == file_integrity.UNREADABLE:
        raise HTTPException(status_code=500, detail="Archived report file could not be read")
    if status == file_integrity.MODIFIED:
        await _log(db, tenant_id, current_user, "integrity_failed", version.id, version.file_name,
                   {"sha256_expected": version.file_sha256, "path": version.file_path})
        raise HTTPException(status_code=409, detail="Archived report failed its integrity check")

    # Read every attribute the response needs BEFORE the trail write. chain_and_add
    # retries a lost `seq` race with `db.rollback()`, and a rollback expires every
    # loaded instance whatever expire_on_commit says — the next attribute read would
    # then attempt an implicit lazy refresh, which async SQLAlchemy cannot perform,
    # and a perfectly good download would 500 with MissingGreenlet.
    version_id_ = version.id
    file_name = version.file_name
    version_number = version.version_number
    sha256 = version.file_sha256
    content_type = version.content_type

    await _log(db, tenant_id, current_user, "download", version_id_, file_name,
               {"version": version_number, "sha256": sha256, "integrity": status})
    return FileResponse(
        path=str(full),
        filename=file_name or f"report-{version_number}.pdf",
        media_type=content_type or "application/pdf",
    )


@router.get("/{report_type}/generate")
async def generate_and_download_report(
    report_type: str,
    lang: str | None = Query(None, description="en | fr | ar — overrides Accept-Language"),
    archive: bool = Query(True, description="Persist the produced report to the historique"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    header_lang: str = Depends(get_request_language),
):
    """Generate and download a PDF report of the specified type."""
    if report_type not in REPORT_GENERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown report type. Valid types: {list(REPORT_GENERATORS.keys())}",
        )

    resolved = _resolve_lang(lang, header_lang)
    tenant_name = await _tenant_name(db, tenant_id)

    try:
        pdf_bytes = await generate_report(report_type, db, tenant_id, tenant_name, resolved)
    except Exception:
        logging.getLogger(__name__).exception("report.generate.error report_type=%s", report_type)
        raise HTTPException(status_code=500, detail="Report generation failed")

    # Archived before it is handed over, so the historique holds the same bytes
    # the caller received. A failure inside archive_report is logged there and
    # returns None — the download still succeeds.
    version = None
    if archive:
        version = await archive_report(
            db, tenant_id=tenant_id, report_type=report_type, pdf_bytes=pdf_bytes,
            lang=resolved, generated_by_id=current_user.id,
            note=f"lang={resolved}",
        )

    # Same reason as in the download route: everything the trail entry needs is
    # read off the version row before chain_and_add, which may roll back.
    version_id_ = version.id if version is not None else None
    version_name = version.file_name if version is not None else report_type
    version_number = version.version_number if version is not None else None

    await _log(db, tenant_id, current_user, "generate", version_id_, version_name,
               {"report_type": report_type, "lang": resolved, "bytes": len(pdf_bytes),
                "archived": version is not None, "version": version_number})

    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    filename = f"{report_type}_report_{date_str}_{resolved}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/{report_type}/preview")
async def preview_report(
    report_type: str,
    lang: str | None = Query(None, description="en | fr | ar — overrides Accept-Language"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    header_lang: str = Depends(get_request_language),
):
    """Preview a PDF report (inline display).

    Deliberately NOT archived: a preview is a look at the current state, and
    versioning every keystroke of a user flipping between languages would bury
    the reports that were actually produced and sent.
    """
    if report_type not in REPORT_GENERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown report type. Valid types: {list(REPORT_GENERATORS.keys())}",
        )

    resolved = _resolve_lang(lang, header_lang)
    tenant_name = await _tenant_name(db, tenant_id)

    try:
        pdf_bytes = await generate_report(report_type, db, tenant_id, tenant_name, resolved)
    except Exception:
        logging.getLogger(__name__).exception("report.preview.error report_type=%s", report_type)
        raise HTTPException(status_code=500, detail="Report preview failed")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "inline",
        },
    )
