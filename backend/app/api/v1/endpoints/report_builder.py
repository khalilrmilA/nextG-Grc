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
from app.models.user import User
from app.models.risk import Risk
from app.models.vulnerability import Vulnerability
from app.models.asset import Asset
from app.models.applied_control import AppliedControl
from app.models.audit import Audit
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
}


def _serialize(value):
    if isinstance(value, (list, dict)):
        return str(value)
    return value


async def _load_rows(db: AsyncSession, tenant_id: str, dataset: str, columns: list[str]) -> list[dict]:
    label, model, _ = DATASETS[dataset]
    result = await db.execute(
        select(model).where(model.tenant_id == tenant_id).limit(_MAX_ROWS)
    )
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
    columns = _resolve_columns(body.dataset, body.columns)
    rows = await _load_rows(db, tenant_id, body.dataset, columns)
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
    if format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx' or 'csv'")
    columns = _resolve_columns(tmpl.dataset, list(tmpl.columns or []))
    rows = await _load_rows(db, tenant_id, tmpl.dataset, columns)
    return _file_response(format, tmpl.dataset, columns, rows)
