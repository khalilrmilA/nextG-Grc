"""Elite Pack advanced report builder.

Custom, filterable reports over the tenant's data, exportable to Excel (.xlsx),
CSV or PDF, plus saved templates for re-running. Gated behind
``advanced_reporting``.

Row extraction is deliberately defensive: columns are pulled with
``getattr(obj, col, None)``, so a column that doesn't exist on a model yields an
empty cell rather than a 500 — datasets stay declarative and safe to extend.

PDF was added for objectif 6 ("Export en PDF ou Excel"): a dataset the builder
can already filter is the generic answer to "give me this register as a
document", and it reuses ``services/tabular_pdf.py`` — the same renderer the
per-module exports in data_io.py use — so the two never diverge in layout.

The dataset table is the builder's whole surface: a register absent from it is
a register nobody can report on. ``incidents``, ``policies`` and ``compliance``
were the three the STB audit found missing, and ``audit_findings`` the fourth;
adding one is a table entry plus, where the useful label lives on another table,
a join in ``_load_rows``.
"""
import asyncio
import csv
import datetime as dt
import enum
import io
from functools import partial
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import csv_safe_cell
from app.models.user import User, UserRole
from app.models.risk import Risk
from app.models.vulnerability import Vulnerability
from app.models.asset import Asset
from app.models.applied_control import AppliedControl
from app.models.audit import Audit, AuditFinding
from app.models.threat import Threat
from app.models.incident import Incident
from app.models.policy import Policy
from app.models.compliance import ComplianceAssessment
from app.models.framework import Framework
from app.models.report_builder import ReportTemplate
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.services.ai_locale import get_request_language, normalize_language
from app.services.excel_export import rows_to_xlsx
from app.services.report_generator import register_label
from app.services.tabular_pdf import rows_to_pdf

router = APIRouter()

_MAX_ROWS = 10000

# dataset name -> (label, model, default columns)
DATASETS: dict[str, tuple[str, type, list[str]]] = {
    "risks": ("Risk Register", Risk,
              ["title", "risk_category", "likelihood", "impact", "severity", "status", "next_review_date", "created_at"]),
    "vulnerabilities": ("Vulnerabilities", Vulnerability,
                        ["ref_id", "title", "severity", "cvss_score", "status", "created_at"]),
    "assets": ("Asset Inventory", Asset,
               ["name", "asset_type", "asset_class", "criticality", "data_classification", "owner_id", "lifecycle_state", "created_at"]),
    "applied_controls": ("Applied Controls", AppliedControl,
                         ["ref_id", "name", "status", "progress", "cost", "created_at"]),
    "audits": ("Audits", Audit,
               ["title", "audit_type", "status", "created_at"]),
    # RFP gap: threats were absent from both the Report Builder datasets and the
    # CSV exports (see data_io.py's /export/threats). Threat.tenant_id is
    # nullable (null = global/builtin catalog entry), so its row loader below
    # special-cases visibility to match threats.py's own builtin-or-owned rule
    # instead of the plain `model.tenant_id == tenant_id` every other dataset uses.
    "threats": ("Threat Library", Threat,
                ["ref_id", "name", "category", "probability_level", "severity_level", "is_builtin", "created_at"]),
    # STB objectif 6: the audits dataset carries the engagements but not a
    # single finding, so "the audit report as Excel" was not expressible here.
    # AuditFinding has NO tenant_id — it is scoped only through its parent
    # Audit — so its row loader below joins rather than filtering on a column
    # that does not exist. `audit_title` is a joined column, not an attribute
    # of the model; _load_rows fills it in explicitly.
    "audit_findings": ("Audit Findings", AuditFinding,
                       ["audit_title", "title", "severity", "status", "finding_type", "due_date",
                        "description", "recommendation", "management_response", "closed_at",
                        "closure_note", "created_at", "audit_id", "remediation_owner_id"]),
    # STB objectifs 2/6/7: three registers the builder could not report on at
    # all. Each one is already downloadable elsewhere (the module's own API, and
    # for policies/compliance data_io's /export/{module}), so no dataset here
    # widens what an account can read — see _SENSITIVE_DATASET_ROLES below.
    "incidents": ("Incidents", Incident,
                  ["title", "category", "severity", "status", "detected_at", "resolved_at",
                   "business_impact", "financial_impact", "breach_notification_required",
                   "root_cause", "created_at"]),
    "policies": ("Policies", Policy,
                 ["title", "policy_number", "category", "status", "owner_id",
                  "review_frequency_months", "next_review_date", "effective_date",
                  "expiration_date", "created_at"]),
    # `framework` is a joined column, not an attribute of ComplianceAssessment:
    # the model stores framework_id, and a uuid in a compliance report tells the
    # reader nothing. _load_rows fills it from the Framework row.
    "compliance": ("Compliance Assessments", ComplianceAssessment,
                   ["name", "framework", "status", "compliance_score", "scope_type",
                    "assessment_start", "assessment_end", "next_review_date", "created_at"]),
}

# Report types considered sensitive enough to need a role check beyond the
# advanced_reporting feature gate — same require_roles() semantics used
# elsewhere this session (vulnerabilities.py PATCH, applied_controls.py
# validate): tenant_admin/super_admin always pass, everyone else must hold one
# of the listed roles. Datasets not listed here stay open to any authenticated
# tenant user, same as before this fix.
_SENSITIVE_DATASET_ROLES: dict[str, set[UserRole]] = {
    "audits": {UserRole.CISO, UserRole.COMPLIANCE_MANAGER},
    # Findings name unremediated weaknesses and their owners — strictly more
    # sensitive than the engagement list, so it inherits the same gate.
    "audit_findings": {UserRole.CISO, UserRole.COMPLIANCE_MANAGER},
    # Deliberately NOT listed: incidents, policies and compliance. Reading those
    # rows needs nothing beyond get_current_user in incidents.py / policies.py /
    # data_io.py's /export/policies + /export/compliance, so gating them here
    # would not protect anything — it would only make the builder disagree with
    # the register it copies, the exact split brain _check_dataset_role fixes.
}


async def _check_dataset_role(db: AsyncSession, current_user: User, dataset: str) -> None:
    """Gate a sensitive dataset on the caller's EFFECTIVE roles.

    This used to read the scalar ``current_user.role`` alone, which silently
    ignored the role a user holds through a Group, a custom role or an active
    delegation — the same mistake CLAUDE.md flags as a codebase trap. The
    result was a split brain: a group-granted CISO could export the findings
    register from /data/export/audit-findings (which goes through
    require_roles, and does resolve group roles) but was refused the identical
    rows here. Uses the same resolver require_roles uses, and keeps its
    super_admin / tenant_admin auto-pass.
    """
    allowed = _SENSITIVE_DATASET_ROLES.get(dataset)
    if not allowed:
        return
    if current_user.role in (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN):
        return
    from app.services.authz import get_effective_roles
    effective = await get_effective_roles(current_user, db)
    if not effective.intersection(r.value for r in allowed):
        raise HTTPException(
            status_code=403,
            detail=f"Dataset '{dataset}' requires one of: {sorted(r.value for r in allowed)}",
        )


def _serialize(value):
    if isinstance(value, (list, dict)):
        return str(value)
    if isinstance(value, enum.Enum):
        # Every status/severity column on these models is a (str, Enum), and
        # str() on one renders "FindingStatus.OPEN" — which is what the CSV
        # export used to write while the xlsx wrote the bare value. Unwrap once,
        # here, so all three formats agree with data_io.py's `.value` convention.
        return value.value
    if isinstance(value, dt.datetime) and value.tzinfo is not None:
        # openpyxl refuses a timezone-aware datetime outright ("Excel does not
        # support timezones in datetimes") — a 500 on every xlsx export of a
        # DateTime(timezone=True) column such as AuditFinding.closed_at once the
        # database is Postgres rather than SQLite, which hands them back naive.
        # Naive values are left as real datetimes so the spreadsheet keeps a
        # date cell instead of text.
        return value.isoformat()
    return value


# Stored-filter operators applied as real SQL WHERE clauses (see _filter_clauses).
_FILTER_OPS: dict[str, Callable] = {
    "eq": lambda col, v: col == v,
    "ne": lambda col, v: col != v,
    "gte": lambda col, v: col >= v,
    "lte": lambda col, v: col <= v,
    "gt": lambda col, v: col > v,
    "lt": lambda col, v: col < v,
    "in": lambda col, v: col.in_(v) if isinstance(v, list) else col == v,
    "contains": lambda col, v: col.ilike(f"%{v}%"),
}


def _filter_clauses(model: type, filters: dict) -> list:
    """Translate a saved template's ``filters`` dict into SQLAlchemy WHERE
    clauses. Previously `filters` was stored on ReportTemplate but never read
    back by _load_rows — every run only scoped by tenant, ignoring whatever
    row filters the user had configured.

    Two shapes are accepted per key:
      - {"column": value}               -> equality (or IN if value is a list)
      - {"column": {"op": value, ...}}  -> one or more ops from _FILTER_OPS
    Unknown column names or ops are silently skipped — same defensive stance as
    _serialize()'s getattr(obj, col, None): a stale/typo'd filter degrades to
    "no filter" instead of a 500.
    """
    valid_cols = set(model.__table__.columns.keys())
    clauses = []
    for col, spec in (filters or {}).items():
        if col not in valid_cols:
            continue
        column = getattr(model, col)
        if isinstance(spec, dict):
            for op, val in spec.items():
                fn = _FILTER_OPS.get(op)
                if fn is not None:
                    clauses.append(fn(column, val))
        elif isinstance(spec, list):
            clauses.append(column.in_(spec))
        else:
            clauses.append(column == spec)
    return clauses


async def _load_rows(db: AsyncSession, tenant_id: str, dataset: str, columns: list[str],
                      filters: dict | None = None) -> list[dict]:
    label, model, _ = DATASETS[dataset]
    # Column selected alongside the entity for datasets whose useful label lives
    # on a joined table; None for the ordinary single-model datasets.
    joined_col: str | None = None
    if dataset == "threats":
        # Builtin (global) threats + this tenant's own custom threats — mirrors
        # the visibility rule in threats.py's own list/get endpoints.
        stmt = select(model).where((model.is_builtin == True) | (model.tenant_id == tenant_id))  # noqa: E712
    elif dataset == "audit_findings":
        # AuditFinding carries no tenant_id: the ONLY thing that scopes a
        # finding to a tenant is its parent Audit, so the isolation rule has to
        # be enforced by this join. `model.tenant_id == tenant_id` here would
        # raise AttributeError — and any variant that dropped the predicate
        # would leak every tenant's findings.
        joined_col = "audit_title"
        stmt = (
            select(model, Audit.title.label("audit_title"))
            .join(Audit, model.audit_id == Audit.id)
            # Archived engagements are hidden here for the same reason
            # list_audits hides them; a template pointed at one returns no rows
            # rather than resurrecting it into a report.
            .where(Audit.tenant_id == tenant_id, Audit.deleted_at.is_(None))
        )
    elif dataset == "compliance":
        # Same joined-label pattern as audit_findings, for the opposite reason:
        # ComplianceAssessment IS tenant-scoped, but its framework_id is a uuid
        # and a compliance report that names the framework as
        # "3f2a…" is not a compliance report. LEFT join on purpose — an
        # assessment whose framework row has since been deleted still belongs in
        # the register, with an empty framework cell rather than a missing line.
        joined_col = "framework"
        stmt = (
            select(model, Framework.short_name.label("framework"))
            .join(Framework, model.framework_id == Framework.id, isouter=True)
            .where(model.tenant_id == tenant_id)
        )
    else:
        stmt = select(model).where(model.tenant_id == tenant_id)
    for clause in _filter_clauses(model, filters or {}):
        stmt = stmt.where(clause)
    result = await db.execute(stmt.limit(_MAX_ROWS))
    rows = []
    if joined_col:
        for obj, joined_value in result.all():
            row = {col: _serialize(getattr(obj, col, None)) for col in columns}
            if joined_col in row:
                row[joined_col] = _serialize(joined_value)
            rows.append(row)
        return rows
    for obj in result.scalars().all():
        rows.append({col: _serialize(getattr(obj, col, None)) for col in columns})
    return rows


class DatasetInfo(BaseModel):
    name: str
    label: str
    columns: list[str]


_OUTPUT_FORMATS = ("xlsx", "csv", "pdf")


class ExportRequest(BaseModel):
    dataset: str
    format: str = "xlsx"          # xlsx | csv | pdf
    columns: list[str] | None = None
    filters: dict = {}
    # Page direction for the PDF. Optional: a caller that sends nothing gets the
    # language of its own Accept-Language header, so an Arabic UI produces a
    # right-to-left document without the SPA having to ask for one.
    lang: str | None = None


def _resolve_columns(dataset: str, requested: list[str] | None) -> list[str]:
    _, _, default_cols = DATASETS[dataset]
    if not requested:
        return default_cols
    # Keep only known-safe column names (present in defaults) to avoid arbitrary attr reads.
    allowed = set(default_cols)
    picked = [c for c in requested if c in allowed]
    return picked or default_cols


async def _file_response(fmt: str, dataset: str, columns: list[str], rows: list[dict],
                         lang: str = "en") -> Response:
    """Render the chosen format.

    Async because rows_to_xlsx/rows_to_pdf are pure CPU: a full 10 000-row
    report renders on the event loop of a worker that is also serving every
    other request, and there are only two workers. asyncio.to_thread keeps the
    loop free.
    """
    # Localised heading / sheet name; falls back to the dataset's English label
    # for a dataset the register vocabulary does not know.
    label = register_label(lang, dataset) or DATASETS[dataset][0]
    if fmt == "csv":
        # Formula injection: a cell starting with =, +, -, @ is executed when
        # the file is opened in Excel/LibreOffice. data_io.py has run its CSV
        # through csv_safe_cell since it was written; this path never did.
        safe = [{k: csv_safe_cell(v) for k, v in row.items()} for row in rows]
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(safe)
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{dataset}.csv"'},
        )
    if fmt == "pdf":
        # No markup escaping here on purpose: rows_to_pdf renders each cell via
        # pdf_arabic.paragraph_markup, which already escapes &, < and > before
        # ReportLab parses the Paragraph. A second pass is not extra safety, it
        # is corruption — "Risk & Compliance" came out as "Risk &amp; Compliance".
        data = await asyncio.to_thread(rows_to_pdf, label, columns, rows, lang=lang)
        return Response(
            content=data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{dataset}.pdf"'},
        )
    # openpyxl promotes any string starting with "=" to a real formula cell, so
    # the xlsx path needs the same neutralisation as the CSV one. Only strings
    # are rewritten — numbers and bools must stay typed to remain sortable.
    safe = [{k: (csv_safe_cell(v) if isinstance(v, str) else v) for k, v in row.items()} for row in rows]
    # lang translates the header row only — the cell values are the same ones
    # the csv path emits, so nothing that reads an export back is affected.
    data = await asyncio.to_thread(partial(rows_to_xlsx, label, columns, safe, lang=lang))
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{dataset}.xlsx"'},
    )


@router.get("/datasets", response_model=list[DatasetInfo])
async def list_datasets(
    current_user: Annotated[User, Depends(require_feature("advanced_reporting"))],
):
    return [DatasetInfo(name=name, label=label, columns=cols) for name, (label, _m, cols) in DATASETS.items()]


@router.post("/export")
async def export_report(
    body: ExportRequest,
    current_user: Annotated[User, Depends(require_feature("advanced_reporting"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    if body.dataset not in DATASETS:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{body.dataset}'")
    if body.format not in _OUTPUT_FORMATS:
        raise HTTPException(status_code=400, detail=f"format must be one of {', '.join(_OUTPUT_FORMATS)}")
    await _check_dataset_role(db, current_user, body.dataset)
    columns = _resolve_columns(body.dataset, body.columns)
    rows = await _load_rows(db, tenant_id, body.dataset, columns, body.filters)
    return await _file_response(body.format, body.dataset, columns, rows,
                                lang=normalize_language(body.lang) or header_lang)


# ---------------------------------------------------------------------------
# Saved templates
# ---------------------------------------------------------------------------
class TemplateIn(BaseModel):
    name: str
    dataset: str
    columns: list[str] = []
    filters: dict = {}


class TemplateOut(BaseModel):
    id: str
    name: str
    dataset: str
    columns: list[str]
    filters: dict
    model_config = {"from_attributes": True}


@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(
    current_user: Annotated[User, Depends(require_feature("advanced_reporting"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(ReportTemplate).where(ReportTemplate.tenant_id == tenant_id))
    return list(result.scalars().all())


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create_template(
    body: TemplateIn,
    current_user: Annotated[User, Depends(require_feature("advanced_reporting"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.dataset not in DATASETS:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{body.dataset}'")
    await _check_dataset_role(db, current_user, body.dataset)
    tmpl = ReportTemplate(
        tenant_id=tenant_id, name=body.name, dataset=body.dataset,
        columns=_resolve_columns(body.dataset, body.columns), filters=body.filters or {},
        created_by_id=current_user.id,
    )
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    return tmpl


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    current_user: Annotated[User, Depends(require_feature("advanced_reporting"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ReportTemplate).where(
            ReportTemplate.id == template_id, ReportTemplate.tenant_id == tenant_id
        )
    )
    tmpl = result.scalar_one_or_none()
    if tmpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(tmpl)
    await db.commit()
    return None


@router.post("/templates/{template_id}/run")
async def run_template(
    template_id: str,
    current_user: Annotated[User, Depends(require_feature("advanced_reporting"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
    format: str = "xlsx",
    lang: str | None = None,
):
    result = await db.execute(
        select(ReportTemplate).where(
            ReportTemplate.id == template_id, ReportTemplate.tenant_id == tenant_id
        )
    )
    tmpl = result.scalar_one_or_none()
    if tmpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    if tmpl.dataset not in DATASETS:
        raise HTTPException(status_code=400, detail="Template references an unknown dataset")
    await _check_dataset_role(db, current_user, tmpl.dataset)
    if format not in _OUTPUT_FORMATS:
        raise HTTPException(status_code=400, detail=f"format must be one of {', '.join(_OUTPUT_FORMATS)}")
    columns = _resolve_columns(tmpl.dataset, list(tmpl.columns or []))
    rows = await _load_rows(db, tenant_id, tmpl.dataset, columns, tmpl.filters)
    # Same ?lang=-wins-over-Accept-Language rule as POST /export: a saved
    # template run from an Arabic UI has to produce the same right-to-left
    # document the ad-hoc export does, or the two disagree on the same rows.
    return await _file_response(format, tmpl.dataset, columns, rows,
                                lang=normalize_language(lang) or header_lang)
