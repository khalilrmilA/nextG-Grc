"""Archiving + retention endpoints (Elite Pack) — RFP module 17.

Rule-based archiving (snapshot any entity with an optional retention window),
consult archives without restoring, enforce retention via purge, and export
archived data to CSV/Excel/PDF. Gated behind ``archiving``.

Auto-archiving rules (``ArchivingRule`` + the background evaluator that acts on
them) live in app.services.archiving_engine — this file only exposes their CRUD
and reuses the engine's ``create_archive_record`` for the manual POST, so there
is a single code path that ever builds an ArchiveRecord.
"""
import csv
import io
from datetime import datetime, timezone
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.tenant import Tenant
from app.models.archive import ArchiveRecord, ArchivingRule
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.services.excel_export import rows_to_xlsx
from app.services.archiving_engine import (
    ARCHIVABLE_ENTITIES,
    create_archive_record,
    parse_criteria,
)

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
    try:
        return await create_archive_record(
            db, tenant_id=tenant_id, entity_type=body.entity_type, entity_id=body.entity_id,
            payload=body.payload or {}, reason=body.reason, retention_days=body.retention_days,
            archived_by_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


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


class ArchivingRuleIn(BaseModel):
    entity_type: str
    criteria: str            # e.g. "status=closed AND age_days>365"
    enabled: bool = True
    retention_days: int | None = None


class ArchivingRuleOut(BaseModel):
    id: str
    entity_type: str
    criteria: str
    enabled: bool
    retention_days: int | None
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_result: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# NOTE: registered ahead of GET /{archive_id} below so "/rules" resolves to this
# router, not to the single-segment archive_id path parameter.
@router.get("/rules", response_model=list[ArchivingRuleOut])
async def list_archiving_rules(
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ArchivingRule).where(ArchivingRule.tenant_id == tenant_id)
        .order_by(ArchivingRule.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/rules", response_model=ArchivingRuleOut, status_code=201)
async def create_archiving_rule(
    body: ArchivingRuleIn,
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.entity_type not in ARCHIVABLE_ENTITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported entity_type {body.entity_type!r}. Supported: {sorted(ARCHIVABLE_ENTITIES)}",
        )
    try:
        parse_criteria(body.criteria)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if body.retention_days is not None and body.retention_days < 0:
        raise HTTPException(status_code=422, detail="retention_days must be >= 0")

    rule = ArchivingRule(
        tenant_id=tenant_id, entity_type=body.entity_type, criteria=body.criteria,
        enabled=body.enabled, retention_days=body.retention_days,
        next_run_at=_utcnow(),  # due immediately so the next scheduler tick picks it up
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_archiving_rule(
    rule_id: str,
    current_user: Annotated[User, Depends(require_feature("archiving"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ArchivingRule).where(ArchivingRule.id == rule_id, ArchivingRule.tenant_id == tenant_id)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Archiving rule not found")
    await db.delete(rule)
    await db.commit()


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
    if format not in ("xlsx", "csv", "pdf"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx', 'csv', or 'pdf'")
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
    if format == "pdf":
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
        org_name = getattr(tenant, "name", None) or "Organization"
        pdf_bytes = _archives_to_pdf(org_name, rows)
        return Response(
            content=pdf_bytes, media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="archives.pdf"'},
        )
    data = rows_to_xlsx("Archives", _EXPORT_COLUMNS, rows)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="archives.xlsx"'},
    )


def _archives_to_pdf(org: str, rows: list[dict]) -> bytes:
    """Simple tabular PDF export — same columns as the CSV/Excel export.

    Reuses the ReportLab stack already used by app.services.report_generator
    (no new PDF dependency), kept self-contained here rather than importing that
    module's underscore-prefixed helpers directly.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, HRFlowable

    navy = colors.HexColor("#1a2332")
    gray_700 = colors.HexColor("#374151")
    gray_500 = colors.HexColor("#6b7280")
    gray_300 = colors.HexColor("#d1d5db")
    gray_100 = colors.HexColor("#f3f4f6")
    white = colors.white

    buf = BytesIO()
    page_size = landscape(A4)
    page_w = page_size[0] - 1.2 * inch
    doc = SimpleDocTemplate(
        buf, pagesize=page_size,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch,
    )
    styles = getSampleStyleSheet()

    els = [
        HRFlowable(width="100%", thickness=2, color=navy, spaceAfter=8),
        Paragraph(org.upper(), ParagraphStyle("ArchOrg", fontName="Helvetica", fontSize=8, textColor=gray_500)),
        Paragraph("Archive Records Export", ParagraphStyle("ArchTitle", fontName="Helvetica-Bold", fontSize=16, textColor=navy, spaceAfter=4)),
        Paragraph(
            f"Generated {datetime.utcnow().strftime('%d %b %Y, %H:%M UTC')} — {len(rows)} record(s)",
            ParagraphStyle("ArchMeta", fontName="Helvetica", fontSize=8, textColor=gray_500, spaceAfter=12),
        ),
        HRFlowable(width="100%", thickness=0.5, color=gray_300, spaceAfter=14),
    ]

    headers = ["Archive ID", "Entity Type", "Entity ID", "Reason", "Archived At", "Retention Until"]
    if not rows:
        els.append(Paragraph("<i>No archive records match this export.</i>", styles["Normal"]))
    else:
        widths = [page_w * 0.14, page_w * 0.14, page_w * 0.14, page_w * 0.30, page_w * 0.14, page_w * 0.14]
        data = [headers] + [
            [
                (r["id"] or "—")[:12], r["entity_type"] or "—", (r["entity_id"] or "—")[:12],
                (r["reason"] or "—")[:60], (r["archived_at"] or "—")[:19], (r["retention_until"] or "—")[:19],
            ]
            for r in rows
        ]
        t = Table(data, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), navy),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -1), 7.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), gray_700),
            ("TOPPADDING", (0, 1), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, gray_100]),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, gray_300),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        els.append(t)

    els.append(Paragraph(
        "CONFIDENTIAL — This export is auto-generated by the GRC Platform. "
        "Distribution is restricted to authorized personnel only.",
        ParagraphStyle("ArchFooter", fontName="Helvetica", fontSize=6.5, textColor=gray_500, alignment=TA_CENTER, spaceBefore=20),
    ))
    doc.build(els)
    return buf.getvalue()
