"""Data Import/Export — CSV/XML/Excel/PDF export for all modules + CSV/XML bulk import.

XML support (RFP gap T2) is additive: every ``/export/{module}`` endpoint
takes an optional ``?format=csv|xml|xlsx|pdf`` query param (default ``csv``, so
existing callers are unaffected), and every ``/import/{module}`` endpoint
takes ``?format=csv|xml`` to select which parser reads the uploaded file. Both
import formats funnel into the SAME per-module "validate and build one record"
functions below (``_validate_*_row``) — no business-rule validation is
duplicated between the two paths.

The referential exports (``/export/frameworks`` and
``/export/framework-controls``) exist so objectif 1's "import automatisé" can
round-trip: what comes out of here is shaped so it can go straight back in
through the frameworks importer. They therefore export BUSINESS keys
(framework short_name + version, the parent's ``control_id``) and never the
internal uuids, which are meaningless on the far side of an export.
"""
import asyncio
import csv
import io
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security_utils import csv_safe_cell
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.services.ai_locale import get_request_language, normalize_language
from app.models.user import User, UserRole
from app.models.risk import Risk
from app.models.vendor import Vendor, VendorRiskTier
from app.models.asset import Asset, AssetType, AssetCriticality, AssetStatus
from app.models.audit import Audit, AuditFinding
from app.models.framework import ControlRequirement, Framework, FrameworkControl
from app.models.policy import Policy
from app.models.compliance import ComplianceAssessment
from app.models.threat import Threat
from app.models.applied_control import AppliedControl
from app.models.control_evaluation import ControlEvaluation
from app.services.excel_export import rows_to_xlsx
from app.services.report_generator import register_label
from app.services.tabular_pdf import rows_to_pdf
from app.services.xml_export import rows_to_xml, xml_to_rows

router = APIRouter()

_VALID_FORMATS = ("csv", "xml")


_EXPORT_FORMATS = {"csv", "xml", "xlsx", "pdf"}


def _check_export_format(format: str) -> str:
    fmt = (format or "csv").strip().lower()
    if fmt not in _EXPORT_FORMATS:
        raise HTTPException(400, f"format must be one of {', '.join(sorted(_EXPORT_FORMATS))}")
    return fmt


def _resolve_lang(explicit: str | None, header_lang: str) -> str:
    """`?lang=` wins over Accept-Language, unknown values fall back to the header.

    Same rule as reports.py, and for the same reason: an export is fetched from
    a plain `<a href>` or a `window.open`, neither of which can set a header, so
    the query parameter has to exist and has to win.
    """
    return normalize_language(explicit) or header_lang


def _check_import_format(format: str) -> str:
    """Imports stay csv/xml. Excel and PDF are output formats — there is no
    sane way to read a register back out of a PDF, and accepting one here would
    fail later with a confusing parse error instead of a clear refusal."""
    fmt = (format or "csv").strip().lower()
    if fmt not in _VALID_FORMATS:
        raise HTTPException(400, "format must be 'csv' or 'xml'")
    return fmt


async def _read_upload_text(file: UploadFile, label: str = "File") -> str:
    """Read an uploaded file with a size + encoding guard.

    Caps the upload at MAX_UPLOAD_SIZE_MB and decodes with errors='replace'
    so a non-UTF-8 file produces a 400 (not a 500 stack trace). Shared by
    both the CSV and XML import paths."""
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    raw = await file.read()
    if len(raw) > max_bytes:
        raise HTTPException(413, f"{label} exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit")
    return raw.decode("utf-8", errors="replace")


def _csv_response(rows: list[dict], filename: str, columns: list[str] | None = None) -> StreamingResponse:
    """Build a CSV streaming response from a list of dicts.

    Cells are run through ``csv_safe_cell`` so values that begin with =, +,
    -, @, \\t or \\r are prefixed with a single quote. This blocks formula
    injection when the export is opened in Excel/LibreOffice.

    ``columns`` lets an empty register still produce a real, header-only CSV
    instead of the "No data available" placeholder. That matters for the
    referential exports, whose whole point is to be re-importable: a header is
    a valid empty dataset, a prose sentence is a parse error on the far side.
    Callers that pass nothing keep the placeholder they have always emitted."""
    if not rows:
        buf = io.StringIO()
        if columns:
            csv.DictWriter(buf, fieldnames=list(columns)).writeheader()
        else:
            buf.write("No data available\n")
        buf.seek(0)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    safe_rows = [{k: csv_safe_cell(v) for k, v in r.items()} for r in rows]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=safe_rows[0].keys())
    writer.writeheader()
    writer.writerows(safe_rows)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _xlsx_safe_rows(rows: list[dict]) -> list[dict]:
    """Neutralise formula injection on the .xlsx path.

    ``_csv_response`` already runs every cell through ``csv_safe_cell``; the
    Excel branch did not, and openpyxl promotes any string starting with "="
    to a real formula cell (``data_type == 'f'``), so an attacker-controlled
    register field — a risk title, a vendor name — was evaluated when the
    workbook was opened. Only str cells are rewritten: numbers, bools and
    datetimes must stay typed or the spreadsheet stops sorting correctly.
    """
    return [
        {k: (csv_safe_cell(v) if isinstance(v, str) else v) for k, v in row.items()}
        for row in rows
    ]


def _export_rows_bytes(fmt: str, label: str, cols: list[str], rows: list[dict],
                       root_tag: str, record_tag: str, lang: str = "en") -> bytes:
    """Render the document body. Pure CPU — always called through
    ``asyncio.to_thread`` so it never runs on the event loop (see below)."""
    if fmt == "xml":
        return rows_to_xml(root_tag, record_tag, rows)
    if fmt == "xlsx":
        # lang translates the header row only (see excel_export.rows_to_xlsx):
        # the cells stay exactly as exported so /data/import/* still reads them.
        return rows_to_xlsx(label, cols, _xlsx_safe_rows(rows), lang=lang)
    # NOTE: no markup escaping here on purpose. ``rows_to_pdf`` renders every
    # cell through ``pdf_arabic.paragraph_markup``, which already escapes
    # &, < and > before ReportLab parses the Paragraph. Escaping a second time
    # here is not "extra safety": it is visible corruption — a control titled
    # "Backup & Recovery" (49 such rows on the live referential) came out of
    # the PDF as "Backup &amp; Recovery".
    # ``lang`` is about page DIRECTION only — Arabic content is detected per
    # cell by the renderer, so a mixed register still reads correctly without
    # it. What was lost was the layout: an Arabic export came out with the
    # first column on the left, which is not a right-to-left document.
    return rows_to_pdf(label, cols, rows, lang=lang)


async def _export_response(rows: list[dict], filename_base: str, root_tag: str, record_tag: str,
                           format: str, columns: list[str] | None = None,
                           lang: str = "en") -> StreamingResponse:
    """Branch a per-module export to CSV, XML, Excel or PDF.

    Excel and PDF were added because the requirement asks for "export possible
    au format Excel ou PDF" and CSV is neither: an auditor handed a CSV of a
    risk register has to open and format it before it can be read, which is the
    friction the rule exists to remove. Every module's export goes through this
    one helper, so all of them gained both formats at once rather than the risk
    register alone.

    ``columns`` is the header to fall back on when the register is EMPTY: the
    row builders are dict comprehensions, so with no rows there is nothing to
    read the column order off. Every renderer uses it — csv emits a header-only
    file, xlsx/pdf need at least one column to produce a document at all.

    Async because the renderers are pure CPU and this runs in a uvicorn worker
    that serves every other request: a full-size PDF (2000 x 12, the renderer's
    own cap) measures ~9.7 s of ReportLab. Called inline, that is 9.7 s during
    which the worker's event loop never runs — no health check, no login, no
    other tenant — and there are only two workers. ``asyncio.to_thread`` does
    not make it free (it is Python bytecode, so it holds the GIL), but the
    interpreter switches between the render thread and the loop every few
    milliseconds, so the rest of the worker keeps making progress instead of
    stalling outright. The render only touches caller-local data.
    """
    fmt = _check_export_format(format)
    date_stamp = datetime.utcnow().strftime("%Y%m%d")
    stem = f"{filename_base}_{date_stamp}"
    cols = list(rows[0]) if rows else list(columns or [])
    # The document heading / sheet name in the caller's language. It used to be
    # the XML root tag title-cased ("Framework Controls"), i.e. English on a
    # French or Arabic export — the one line a reader sees first.
    label = register_label(lang, root_tag)

    if fmt == "csv":
        return _csv_response(rows, f"{stem}.csv", columns=cols)

    if fmt in ("xlsx", "pdf") and not cols:
        # Both renderers need at least one column. rows_to_pdf raises
        # "must have at least a row and column" on a zero-column table, so an
        # empty register used to 500 instead of returning an empty document —
        # mirror _csv_response's "No data available" placeholder rather than
        # inventing a second empty-state convention.
        cols, rows = ["info"], [{"info": "No data available"}]

    data = await asyncio.to_thread(_export_rows_bytes, fmt, label, cols, rows, root_tag, record_tag, lang)
    media, ext = {
        "xml": ("application/xml", "xml"),
        "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
        "pdf": ("application/pdf", "pdf"),
    }[fmt]
    return StreamingResponse(
        io.BytesIO(data), media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{stem}.{ext}"'},
    )


async def _read_import_rows(file: UploadFile, format: str) -> tuple[list[dict], int]:
    """Read an uploaded CSV or XML file into a list of field dicts.

    Returns (rows, row_number_start) — CSV numbering starts at 2 (row 1 is
    the header), XML numbering starts at 1 (records aren't preceded by a
    header row) so error messages line up with what the user opened."""
    fmt = _check_import_format(format)
    if fmt == "xml":
        content = await _read_upload_text(file, "XML")
        try:
            rows = xml_to_rows(content)
        except Exception as e:
            raise HTTPException(400, f"Invalid XML: {e}")
        return rows, 1
    content = await _read_upload_text(file, "CSV")
    rows = list(csv.DictReader(io.StringIO(content)))
    return rows, 2


# ── Shared per-record validators (used by both CSV and XML import) ────────

def _validate_risk_row(row: dict, tenant_id: str) -> tuple[Risk | None, str | None]:
    title = (row.get("title") or "").strip()
    if not title:
        return None, "title is required"
    try:
        r = Risk(tenant_id=tenant_id, title=title,
                 description=(row.get("description") or "").strip() or None,
                 risk_category=(row.get("category") or "").strip() or None,
                 likelihood=float(row["likelihood"]) if row.get("likelihood") else None,
                 impact=float(row["impact"]) if row.get("impact") else None)
        return r, None
    except Exception as e:
        return None, str(e)


def _validate_vendor_row(row: dict, tenant_id: str) -> tuple[Vendor | None, str | None]:
    name = (row.get("name") or "").strip()
    if not name:
        return None, "name is required"
    try:
        v = Vendor(tenant_id=tenant_id, name=name,
                   industry=(row.get("industry") or "").strip() or None,
                   country=(row.get("country") or "").strip() or None,
                   services_provided=(row.get("services_provided") or "").strip() or None,
                   website=(row.get("website") or "").strip() or None)
        tier = (row.get("risk_tier") or "medium").strip().lower()
        if tier in ("critical", "high", "medium", "low"):
            v.risk_tier = VendorRiskTier(tier)
        return v, None
    except Exception as e:
        return None, str(e)


def _validate_asset_row(row: dict, tenant_id: str) -> tuple[Asset | None, str | None]:
    name = (row.get("name") or "").strip()
    if not name:
        return None, "name is required"
    try:
        # /export/assets emits the column as "type", not "asset_type", so an
        # export -> edit -> import round trip silently reset every asset to
        # APPLICATION. Both spellings are accepted; nothing that already sends
        # "asset_type" changes behaviour.
        at = (row.get("asset_type") or row.get("type") or "application").strip().lower()
        crit = (row.get("criticality") or "medium").strip().lower()
        # Same tolerant coercion as asset_type/criticality: an unknown or empty
        # value falls back to the column's own default rather than rejecting the
        # row, so a file produced before the column existed still imports.
        st = (row.get("status") or "").strip().lower()
        a = Asset(tenant_id=tenant_id, name=name,
                  asset_type=AssetType(at) if at in [e.value for e in AssetType] else AssetType.APPLICATION,
                  criticality=AssetCriticality(crit) if crit in [e.value for e in AssetCriticality] else AssetCriticality.MEDIUM,
                  status=st if st in [e.value for e in AssetStatus] else AssetStatus.OPERATIONAL.value,
                  description=(row.get("description") or "").strip() or None,
                  hosting_type=(row.get("hosting_type") or "").strip() or None,
                  location=(row.get("location") or "").strip() or None)
        return a, None
    except Exception as e:
        return None, str(e)


# ── EXPORTS ──────────────────────────────────────────────────────────────

@router.get("/export/risks")
async def export_risks(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    risks = list((await db.execute(select(Risk).where(Risk.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": r.id, "title": r.title, "description": r.description or "",
        "category": r.risk_category or "", "status": r.status.value if hasattr(r.status, "value") else str(r.status),
        "severity": (r.severity.value if hasattr(r.severity, "value") else str(r.severity)) if r.severity else "",
        "likelihood": r.likelihood or "", "impact": r.impact or "",
        "inherent_score": (r.likelihood or 0) * (r.impact or 0),
        "residual_likelihood": r.residual_likelihood or "", "residual_impact": r.residual_impact or "",
        "next_review_date": r.next_review_date or "",
        "created_at": r.created_at.isoformat() if r.created_at else "",
    } for r in risks]
    return await _export_response(rows, "risks_export", "risks", "risk", format, lang=_resolve_lang(lang, header_lang))

@router.get("/export/vendors")
async def export_vendors(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    vendors = list((await db.execute(select(Vendor).where(Vendor.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": v.id, "name": v.name, "industry": v.industry or "",
        "country": v.country or "", "website": v.website or "",
        "risk_tier": v.risk_tier.value if hasattr(v.risk_tier, "value") else str(v.risk_tier),
        "status": v.status.value if hasattr(v.status, "value") else str(v.status),
        "risk_score": v.risk_score or "", "services_provided": v.services_provided or "",
        "has_dpa": v.has_data_processing_agreement,
        "contract_expiry": v.contract_expiry or "",
        "created_at": v.created_at.isoformat() if v.created_at else "",
    } for v in vendors]
    return await _export_response(rows, "vendors_export", "vendors", "vendor", format, lang=_resolve_lang(lang, header_lang))

@router.get("/export/assets")
async def export_assets(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    assets = list((await db.execute(select(Asset).where(Asset.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": a.id, "name": a.name,
        "type": a.asset_type.value if hasattr(a.asset_type, "value") else str(a.asset_type),
        "criticality": a.criticality.value if hasattr(a.criticality, "value") else str(a.criticality),
        "description": a.description or "", "hosting_type": a.hosting_type or "",
        "cloud_provider": a.cloud_provider or "", "location": a.location or "",
        "data_classification": a.data_classification or "",
        # « leur statut » — the asset's operational state. It was on the model
        # and on every screen but not in the export, so a CSV round-trip
        # (export -> edit -> import) silently flattened it back to the default.
        "status": a.status or "",
        "contains_pii": a.contains_pii, "contains_phi": a.contains_phi, "contains_pci": a.contains_pci,
        "created_at": a.created_at.isoformat() if a.created_at else "",
    } for a in assets]
    return await _export_response(rows, "assets_export", "assets", "asset", format, lang=_resolve_lang(lang, header_lang))

@router.get("/export/audits")
async def export_audits(format: str = "csv", db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    """Engagement list, narrowed to the engagements the caller may actually see.

    ``GET /audits`` has always applied ``_visible_audit_ids``; this export did
    not, so an auditor assigned to one engagement — or an audite who only owns a
    constat — could download the tenant's whole audit register as a CSV that the
    same person cannot list in the UI. /export/audit-findings already borrows the
    audits module's own rule; this route is the sibling that was left behind.
    CISO / compliance / risk / executive / viewer and the admins are unaffected
    (``_visible_audit_ids`` returns None for them, i.e. the whole register).
    """
    # Lazy import: audits.py owns this rule and stays its single definition.
    from app.api.v1.endpoints.audits import _visible_audit_ids

    q = select(Audit).where(Audit.tenant_id == tenant_id)
    visible_ids = await _visible_audit_ids(db, user, tenant_id)
    if visible_ids is not None:
        # An empty set must produce an empty export, never an unfiltered one.
        q = q.where(Audit.id.in_(list(visible_ids)))
    audits = list((await db.execute(q)).scalars().all())
    rows = [{
        "id": a.id, "title": a.title, "description": a.description or "",
        "type": a.audit_type.value if hasattr(a.audit_type, "value") else str(a.audit_type),
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "planned_start": a.planned_start or "", "planned_end": a.planned_end or "",
        "scope": a.scope or "",
        "created_at": a.created_at.isoformat() if a.created_at else "",
    } for a in audits]
    return await _export_response(rows, "audits_export", "audits", "audit", format, lang=_resolve_lang(lang, header_lang))

@router.get("/export/policies")
async def export_policies(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    policies = list((await db.execute(select(Policy).where(Policy.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": p.id, "title": p.title, "policy_number": p.policy_number or "",
        "category": p.category or "",
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "review_frequency_months": p.review_frequency_months,
        "next_review_date": p.next_review_date or "",
        "created_at": p.created_at.isoformat() if p.created_at else "",
    } for p in policies]
    return await _export_response(rows, "policies_export", "policies", "policy", format, lang=_resolve_lang(lang, header_lang))

@router.get("/export/compliance")
async def export_compliance(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    assessments = list((await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": a.id, "name": a.name or "",
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "compliance_score": a.compliance_score if a.compliance_score is not None else "",
        "created_at": a.created_at.isoformat() if a.created_at else "",
    } for a in assessments]
    return await _export_response(rows, "compliance_export", "compliance_assessments", "assessment", format, lang=_resolve_lang(lang, header_lang))

@router.get("/export/threats")
async def export_threats(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    """RFP gap: threats were absent from CSV exports (and from the Report
    Builder datasets — see report_builder.py's DATASETS['threats']). Scope
    matches threats.py's own visibility rule: builtin/global catalog entries
    (tenant_id is null) plus this tenant's own custom threats."""
    threats = list((await db.execute(
        select(Threat).where((Threat.is_builtin == True) | (Threat.tenant_id == tenant_id))  # noqa: E712
    )).scalars().all())
    rows = [{
        "id": t.id, "ref_id": t.ref_id, "name": t.name, "description": t.description or "",
        "category": t.category.value if hasattr(t.category, "value") else str(t.category),
        "typical_threat_actors": "; ".join(t.typical_threat_actors or []),
        "typical_attack_vectors": "; ".join(t.typical_attack_vectors or []),
        "mitre_ids": "; ".join(t.mitre_ids or []),
        "is_builtin": t.is_builtin,
        "probability_level": t.probability_level or "",
        "severity_level": t.severity_level or "",
        "created_at": t.created_at.isoformat() if t.created_at else "",
    } for t in threats]
    return await _export_response(rows, "threats_export", "threats", "threat", format, lang=_resolve_lang(lang, header_lang))


@router.get("/export/applied-controls")
async def export_applied_controls(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    """The security-measures register, for reporting or an audit.

    "Le registre permet des exports pour reporting ou audits" — applied
    controls were the one register with no export, so the only way to hand an
    auditor the list of deployed measures was a screenshot.

    Carries the latest effectiveness evaluation alongside each control, because
    an auditor asking for the register invariably asks how well each measure
    works, and joining two exports by hand is how transcription errors happen.
    """
    controls = list((await db.execute(
        select(AppliedControl).where(AppliedControl.tenant_id == tenant_id)
        .order_by(AppliedControl.ref_id)
    )).scalars().all())

    # Latest evaluation per control, in one pass.
    evaluations = list((await db.execute(
        select(ControlEvaluation).where(ControlEvaluation.tenant_id == tenant_id)
        .order_by(ControlEvaluation.evaluated_at.desc().nullslast())
    )).scalars().all())
    latest: dict = {}
    for ev in evaluations:
        latest.setdefault(ev.applied_control_id, ev)

    def _v(x):
        return x.value if hasattr(x, "value") else ("" if x is None else str(x))

    rows = []
    for c in controls:
        ev = latest.get(c.id)
        rows.append({
            "ref_id": c.ref_id or "", "name": c.name, "description": c.description or "",
            "category": _v(c.category), "csf_function": _v(c.csf_function),
            "status": _v(c.status), "progress": c.progress if c.progress is not None else "",
            "validation_status": _v(c.validation_status),
            "validated_at": c.validated_at.isoformat() if c.validated_at else "",
            "owner_id": c.owner_id or "",
            "eta": c.eta or "", "expiration": c.expiration or "",
            "cost": c.cost if c.cost is not None else "",
            "recurring_cost": c.recurring_cost if c.recurring_cost is not None else "",
            "linked_risks": "; ".join(c.risk_ids or []),
            "linked_risk_scenarios": "; ".join(c.risk_scenario_ids or []),
            "linked_vulnerabilities": "; ".join(c.vulnerability_ids or []),
            "framework_controls": "; ".join(c.framework_control_ids or []),
            # Latest effectiveness evaluation, on the same row.
            "performance_level": ev.performance_level if ev else "",
            "evaluation_score": (
                ev.formalisme + ev.type_controle + ev.timing + ev.tracabilite + ev.quatre_yeux
            ) if ev else "",
            "evaluation_method": (ev.method or "") if ev else "",
            "evaluation_evidence": (ev.evidence_ref or "") if ev else "",
            "evaluated_at": ev.evaluated_at.isoformat() if ev and ev.evaluated_at else "",
            "next_evaluation_at": ev.next_evaluation_at.isoformat() if ev and ev.next_evaluation_at else "",
            "remediation_status": (ev.remediation_status or "") if ev else "",
            "created_at": c.created_at.isoformat() if c.created_at else "",
        })
    return await _export_response(rows, "applied_controls_export", "applied_controls", "applied_control", format, lang=_resolve_lang(lang, header_lang))


# ── Referential export (objectif 1: "import automatisé possible") ─────────
#
# Column names below are the contract the frameworks importer reads back, so
# they are business keys, not uuids: a framework is identified by
# (short_name, version) and a control by (framework_short_name, control_id),
# and a control's parent is exported as the PARENT'S control_id rather than
# its internal row id. An export taken from one install can therefore be
# re-imported into another.

_FRAMEWORK_EXPORT_COLUMNS = [
    "short_name", "version", "name", "source_type", "issuing_body", "status",
    "is_builtin", "controls_count", "applicable_regions", "applicable_industries",
    "description", "created_at", "id", "cloned_from_framework_id", "is_tenant_copy",
]

_CONTROL_EXPORT_COLUMNS = [
    "framework_short_name", "control_id", "parent_control_id", "title", "domain",
    "category", "requirement_type", "is_mandatory", "sort_order", "description",
    "guidance", "tags", "framework_version", "mapped_controls", "requirements",
]

_AUDIT_FINDING_EXPORT_COLUMNS = [
    "audit_title", "title", "severity", "status", "finding_type", "control_ref",
    "due_date", "description", "recommendation", "management_response",
    "closed_at", "created_at", "id", "audit_id", "audit_status",
    "remediation_owner_id", "remediation_notes", "closure_note",
]


def _framework_visibility(tenant_id: str):
    """Built-in (shared, tenant_id null) frameworks + this tenant's own forks —
    the same rule frameworks.py applies on every list/read path."""
    return (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id)  # noqa: E712


@router.get("/export/frameworks")
async def export_frameworks(format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    """The framework referential itself — one row per norm/regulation/policy.

    Objectif 1 asks for a centralised referential "classée par source" with an
    automated import; a referential you can only fill in cannot be reviewed
    offline or moved between environments, so the import needs a matching
    export. ``source_type`` is exported because that classification is the
    column the rule is about.
    """
    frameworks = list((await db.execute(
        select(Framework).where(_framework_visibility(tenant_id)).order_by(Framework.short_name, Framework.version)
    )).scalars().all())

    # Control counts in one grouped query rather than a lazy load per framework
    # (95 frameworks on the live database — 95 extra round-trips otherwise).
    # Scoped to the same visible set as the rows themselves: an aggregate over
    # another tenant's forks is still another tenant's data.
    counts = dict((await db.execute(
        select(FrameworkControl.framework_id, func.count(FrameworkControl.id))
        .join(Framework, FrameworkControl.framework_id == Framework.id)
        .where(_framework_visibility(tenant_id))
        .group_by(FrameworkControl.framework_id)
    )).all())

    rows = [{
        "short_name": f.short_name, "version": f.version, "name": f.name,
        "source_type": f.source_type or "",
        "issuing_body": f.issuing_body or "",
        "status": f.status.value if hasattr(f.status, "value") else str(f.status),
        "is_builtin": f.is_builtin,
        "controls_count": counts.get(f.id, 0),
        "applicable_regions": "; ".join(f.applicable_regions or []),
        "applicable_industries": "; ".join(f.applicable_industries or []),
        "description": f.description or "",
        "created_at": f.created_at.isoformat() if f.created_at else "",
        "id": f.id,
        "cloned_from_framework_id": f.cloned_from_framework_id or "",
        # Distinguishes "this tenant forked it" from "shared built-in", which
        # is not the same question as is_builtin on a cloned copy.
        "is_tenant_copy": bool(f.tenant_id),
    } for f in frameworks]
    return await _export_response(rows, "frameworks_export", "frameworks", "framework", format,
                            columns=_FRAMEWORK_EXPORT_COLUMNS, lang=_resolve_lang(lang, header_lang))


@router.get("/export/framework-controls")
async def export_framework_controls(framework_id: str | None = None, format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    """Every requirement/control of the visible referential, import-shaped.

    ``?framework_id=`` narrows the export to one framework — the whole
    referential is ~4.5k controls on the live database, which is a legitimate
    full-referential dump but not what someone editing one norm wants.
    """
    visible = _framework_visibility(tenant_id)
    if framework_id:
        fw = (await db.execute(
            select(Framework).where(Framework.id == framework_id, visible)
        )).scalar_one_or_none()
        if fw is None:
            raise HTTPException(404, "Framework not found")

    ctrl_stmt = (
        select(FrameworkControl, Framework.short_name, Framework.version)
        .join(Framework, FrameworkControl.framework_id == Framework.id)
        .where(visible)
        .order_by(Framework.short_name, FrameworkControl.sort_order, FrameworkControl.control_id)
    )
    if framework_id:
        ctrl_stmt = ctrl_stmt.where(FrameworkControl.framework_id == framework_id)
    control_rows = list((await db.execute(ctrl_stmt)).all())

    # uuid -> business control_id, so parents survive the round-trip. Built from
    # the exported set; a parent outside it (shouldn't happen — parents live in
    # the same framework) degrades to an empty cell rather than leaking a uuid.
    ref_by_uuid = {c.id: c.control_id for c, _sn, _v in control_rows}

    # Requirements in one join instead of a per-control lazy load.
    req_stmt = (
        select(ControlRequirement)
        .join(FrameworkControl, ControlRequirement.control_id == FrameworkControl.id)
        .join(Framework, FrameworkControl.framework_id == Framework.id)
        .where(visible)
    )
    if framework_id:
        req_stmt = req_stmt.where(FrameworkControl.framework_id == framework_id)
    reqs_by_control: dict[str, list] = {}
    for r in (await db.execute(req_stmt)).scalars().all():
        reqs_by_control.setdefault(r.control_id, []).append(
            {"level": r.requirement_level, "text": r.requirement_text}
        )

    rows = []
    for c, short_name, version in control_rows:
        rows.append({
            "framework_short_name": short_name,
            "control_id": c.control_id,
            "parent_control_id": ref_by_uuid.get(c.parent_id, "") if c.parent_id else "",
            "title": c.title,
            "domain": c.domain or "",
            "category": c.category or "",
            "requirement_type": c.requirement_type or "",
            "is_mandatory": c.is_mandatory,
            "sort_order": c.sort_order if c.sort_order is not None else 0,
            "description": c.description or "",
            "guidance": c.guidance or "",
            "tags": "; ".join(c.tags or []),
            "framework_version": version,
            # JSON rather than a delimiter join: mapped_controls and requirements
            # are lists of dicts, and "; ".join would not survive a re-import.
            "mapped_controls": json.dumps(c.mapped_controls or [], ensure_ascii=False),
            "requirements": json.dumps(reqs_by_control.get(c.id, []), ensure_ascii=False),
        })
    return await _export_response(rows, "framework_controls_export", "framework_controls", "control", format,
                            columns=_CONTROL_EXPORT_COLUMNS, lang=_resolve_lang(lang, header_lang))


@router.get("/export/audit-findings")
async def export_audit_findings(audit_id: str | None = None, format: str = "csv", db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id), lang: str | None = None, header_lang: str = Depends(get_request_language)):
    """Findings register — Excel/PDF export of an audit's results.

    Objectif 6 wants the audit report exportable "en PDF ou Excel"; the only
    export that existed was the engagement LIST (/export/audits), which carries
    no finding. ``?audit_id=`` narrows it to one engagement, which is the
    Excel form of that engagement's report.

    AuditFinding has no tenant_id of its own — it is scoped exclusively through
    its parent Audit — so the tenant filter has to be a join, not a column
    predicate. Getting that wrong would leak every tenant's findings, which is
    why it is spelled out here rather than copied from the other exports.

    Access is the audit module's OWN visibility rule, borrowed from audits.py
    (``_visible_audit_ids``), not a fresh role list. An export is the same data
    in another container, so anyone who can already read a finding through
    ``GET /audits/{id}/findings`` can download it: the lead auditor and the
    assigned auditors of an engagement — the people who actually write the
    audit report objectif 6 is about — plus the audité a constat was raised
    against. A flat ``require_roles(CISO, COMPLIANCE_MANAGER)`` looked stricter
    but locked the auditor out of exporting their own report, which is the
    requirement, while leaving the whole tenant register readable as JSON on
    the audits endpoints anyway. CISO / compliance / risk / executive / viewer
    keep the unscoped register (``_visible_audit_ids`` returns None for them);
    everyone else is narrowed to their own engagements, and an engagement they
    cannot see 404s exactly as it does in audits.py.
    """
    # Lazy import: audits.py owns this rule and must stay its single definition.
    # Imported inside the function so the two endpoint modules never form an
    # import cycle at startup.
    from app.api.v1.endpoints.audits import _visible_audit_ids

    visible_ids = await _visible_audit_ids(db, user, tenant_id)

    stmt = (
        select(AuditFinding, Audit.title, Audit.status, FrameworkControl.control_id)
        .join(Audit, AuditFinding.audit_id == Audit.id)
        .outerjoin(FrameworkControl, AuditFinding.control_id == FrameworkControl.id)
        .where(Audit.tenant_id == tenant_id)
        .order_by(Audit.title, AuditFinding.created_at)
    )
    if audit_id:
        audit = (await db.execute(
            select(Audit).where(Audit.id == audit_id, Audit.tenant_id == tenant_id)
        )).scalar_one_or_none()
        # Same 404-not-403 for "exists but not yours" that _audit_for uses, so
        # this route does not become an existence oracle the audits API is not.
        if audit is None or (visible_ids is not None and audit.id not in visible_ids):
            raise HTTPException(404, "Audit not found")
        # An explicitly named engagement exports even when soft-deleted: the
        # register has to survive deletion (objectif 8), so its report must too.
        stmt = stmt.where(AuditFinding.audit_id == audit_id)
    else:
        # The unfiltered dump follows list_audits and hides archived engagements.
        stmt = stmt.where(Audit.deleted_at.is_(None))
        if visible_ids is not None:
            # Not entitled to the whole register: narrow to the engagements this
            # caller may see. An empty set must produce an empty export, never
            # an unfiltered one — hence in_() on the explicit (possibly empty)
            # list rather than a falsy-guard around the clause.
            stmt = stmt.where(Audit.id.in_(list(visible_ids)))

    def _v(x):
        return x.value if hasattr(x, "value") else ("" if x is None else str(x))

    rows = []
    for f, audit_title, audit_status, control_ref in (await db.execute(stmt)).all():
        rows.append({
            "audit_title": audit_title or "",
            "title": f.title,
            "severity": _v(f.severity),
            "status": _v(f.status),
            "finding_type": f.finding_type or "",
            "control_ref": control_ref or "",
            "due_date": f.due_date or "",
            "description": f.description or "",
            "recommendation": f.recommendation or "",
            "management_response": f.management_response or "",
            "closed_at": f.closed_at.isoformat() if f.closed_at else "",
            "created_at": f.created_at.isoformat() if f.created_at else "",
            "id": f.id,
            "audit_id": f.audit_id,
            "audit_status": _v(audit_status),
            "remediation_owner_id": f.remediation_owner_id or "",
            "remediation_notes": f.remediation_notes or "",
            "closure_note": f.closure_note or "",
        })
    filename_base = f"audit_findings_{audit_id}" if audit_id else "audit_findings_export"
    return await _export_response(rows, filename_base, "audit_findings", "finding", format,
                            columns=_AUDIT_FINDING_EXPORT_COLUMNS, lang=_resolve_lang(lang, header_lang))


# ── IMPORTS ──────────────────────────────────────────────────────────────

@router.post("/import/risks")
async def import_risks(file: UploadFile = File(...), format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    """Import risks from CSV or XML (``?format=csv|xml``, default csv).
    Fields: title, description, category, likelihood, impact, severity."""
    rows, start = await _read_import_rows(file, format)
    created = 0; errors = []
    for i, row in enumerate(rows, start):
        risk, err = _validate_risk_row(row, tenant_id)
        if err:
            errors.append(f"Row {i}: {err}"); continue
        db.add(risk); created += 1
    await db.commit()
    return {"created": created, "errors": errors, "total_rows": created + len(errors)}

@router.post("/import/vendors")
async def import_vendors(file: UploadFile = File(...), format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    """Import vendors from CSV or XML (``?format=csv|xml``, default csv).
    Fields: name, industry, country, risk_tier, services_provided, website."""
    rows, start = await _read_import_rows(file, format)
    created = 0; errors = []
    for i, row in enumerate(rows, start):
        vendor, err = _validate_vendor_row(row, tenant_id)
        if err:
            errors.append(f"Row {i}: {err}"); continue
        db.add(vendor); created += 1
    await db.commit()
    return {"created": created, "errors": errors, "total_rows": created + len(errors)}

@router.post("/import/assets")
async def import_assets(file: UploadFile = File(...), format: str = "csv", db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.BUSINESS_OWNER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    """Import assets from CSV or XML (``?format=csv|xml``, default csv).
    Fields: name, asset_type, criticality, description, hosting_type, location."""
    rows, start = await _read_import_rows(file, format)
    created = 0; errors = []
    for i, row in enumerate(rows, start):
        asset, err = _validate_asset_row(row, tenant_id)
        if err:
            errors.append(f"Row {i}: {err}"); continue
        db.add(asset); created += 1
    await db.commit()
    return {"created": created, "errors": errors, "total_rows": created + len(errors)}
