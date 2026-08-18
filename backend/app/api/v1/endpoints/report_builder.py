"""Elite Pack advanced report builder.

Custom, filterable reports over the tenant's data, exportable to Excel (.xlsx) or
CSV, plus saved templates for re-running. Gated behind ``advanced_reporting``.

Row extraction is deliberately defensive: columns are pulled with
``getattr(obj, col, None)``, so a column that doesn't exist on a model yields an
empty cell rather than a 500 — datasets stay declarative and safe to extend.
"""
import csv
import io
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.risk import Risk
from app.models.vulnerability import Vulnerability
from app.models.asset import Asset
from app.models.applied_control import AppliedControl
from app.models.audit import Audit
from app.models.threat import Threat
from app.models.report_builder import ReportTemplate
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature
from app.services.excel_export import rows_to_xlsx

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
}

# Report types considered sensitive enough to need a role check beyond the
# advanced_reporting feature gate — same require_roles() semantics used
# elsewhere this session (vulnerabilities.py PATCH, applied_controls.py
# validate): tenant_admin/super_admin always pass, everyone else must hold one
# of the listed roles. Datasets not listed here stay open to any authenticated
# tenant user, same as before this fix.
_SENSITIVE_DATASET_ROLES: dict[str, set[UserRole]] = {
    "audits": {UserRole.CISO, UserRole.COMPLIANCE_MANAGER},
}


def _check_dataset_role(current_user: User, dataset: str) -> None:
    allowed = _SENSITIVE_DATASET_ROLES.get(dataset)
    if not allowed:
        return
    if current_user.role in (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN):
        return
    if current_user.role not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Dataset '{dataset}' requires one of: {sorted(r.value for r in allowed)}",
        )


def _serialize(value):
    if isinstance(value, (list, dict)):
        return str(value)
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
    if dataset == "threats":
        # Builtin (global) threats + this tenant's own custom threats — mirrors
        # the visibility rule in threats.py's own list/get endpoints.
        stmt = select(model).where((model.is_builtin == True) | (model.tenant_id == tenant_id))  # noqa: E712
    else:
        stmt = select(model).where(model.tenant_id == tenant_id)
    for clause in _filter_clauses(model, filters or {}):
        stmt = stmt.where(clause)
    result = await db.execute(stmt.limit(_MAX_ROWS))
    rows = []
    for obj in result.scalars().all():
        rows.append({col: _serialize(getattr(obj, col, None)) for col in columns})
    return rows


class DatasetInfo(BaseModel):
    name: str
    label: str
    columns: list[str]


class ExportRequest(BaseModel):
    dataset: str
    format: str = "xlsx"          # xlsx | csv
    columns: list[str] | None = None
    filters: dict = {}


def _resolve_columns(dataset: str, requested: list[str] | None) -> list[str]:
    _, _, default_cols = DATASETS[dataset]
    if not requested:
        return default_cols
    # Keep only known-safe column names (present in defaults) to avoid arbitrary attr reads.
    allowed = set(default_cols)
    picked = [c for c in requested if c in allowed]
    return picked or default_cols


def _file_response(fmt: str, dataset: str, columns: list[str], rows: list[dict]) -> Response:
    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{dataset}.csv"'},
        )
    label = DATASETS[dataset][0]
    data = rows_to_xlsx(label, columns, rows)
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
):
    if body.dataset not in DATASETS:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{body.dataset}'")
    if body.format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx' or 'csv'")
    _check_dataset_role(current_user, body.dataset)
    columns = _resolve_columns(body.dataset, body.columns)
    rows = await _load_rows(db, tenant_id, body.dataset, columns, body.filters)
    return _file_response(body.format, body.dataset, columns, rows)


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
    _check_dataset_role(current_user, body.dataset)
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
    format: str = "xlsx",
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
    _check_dataset_role(current_user, tmpl.dataset)
    if format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx' or 'csv'")
    columns = _resolve_columns(tmpl.dataset, list(tmpl.columns or []))
    rows = await _load_rows(db, tenant_id, tmpl.dataset, columns, tmpl.filters)
    return _file_response(format, tmpl.dataset, columns, rows)
