"""Data Import/Export — CSV export for all modules + CSV bulk import."""
import csv
import io
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security_utils import csv_safe_cell
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.risk import Risk
from app.models.vendor import Vendor
from app.models.asset import Asset, AssetType, AssetCriticality
from app.models.audit import Audit
from app.models.policy import Policy
from app.models.compliance import ComplianceAssessment
from app.models.threat import Threat

router = APIRouter()


async def _read_csv_safely(file: UploadFile) -> str:
    """Read an uploaded CSV with size + encoding guards.

    Caps the upload at MAX_UPLOAD_SIZE_MB and decodes with errors='replace'
    so a non-UTF-8 file produces a 400 (not a 500 stack trace)."""
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    raw = await file.read()
    if len(raw) > max_bytes:
        raise HTTPException(413, f"CSV exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit")
    return raw.decode("utf-8", errors="replace")


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    """Build a CSV streaming response from a list of dicts.

    Cells are run through ``csv_safe_cell`` so values that begin with =, +,
    -, @, \\t or \\r are prefixed with a single quote. This blocks formula
    injection when the export is opened in Excel/LibreOffice."""
    if not rows:
        buf = io.StringIO()
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


# ── EXPORTS ──────────────────────────────────────────────────────────────

@router.get("/export/risks")
async def export_risks(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
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
    return _csv_response(rows, f"risks_export_{datetime.utcnow().strftime('%Y%m%d')}.csv")

@router.get("/export/vendors")
async def export_vendors(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
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
    return _csv_response(rows, f"vendors_export_{datetime.utcnow().strftime('%Y%m%d')}.csv")

@router.get("/export/assets")
async def export_assets(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    assets = list((await db.execute(select(Asset).where(Asset.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": a.id, "name": a.name,
        "type": a.asset_type.value if hasattr(a.asset_type, "value") else str(a.asset_type),
        "criticality": a.criticality.value if hasattr(a.criticality, "value") else str(a.criticality),
        "description": a.description or "", "hosting_type": a.hosting_type or "",
        "cloud_provider": a.cloud_provider or "", "location": a.location or "",
        "data_classification": a.data_classification or "",
        "contains_pii": a.contains_pii, "contains_phi": a.contains_phi, "contains_pci": a.contains_pci,
        "created_at": a.created_at.isoformat() if a.created_at else "",
    } for a in assets]
    return _csv_response(rows, f"assets_export_{datetime.utcnow().strftime('%Y%m%d')}.csv")

@router.get("/export/audits")
async def export_audits(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    audits = list((await db.execute(select(Audit).where(Audit.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": a.id, "title": a.title, "description": a.description or "",
        "type": a.audit_type.value if hasattr(a.audit_type, "value") else str(a.audit_type),
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "planned_start": a.planned_start or "", "planned_end": a.planned_end or "",
        "scope": a.scope or "",
        "created_at": a.created_at.isoformat() if a.created_at else "",
    } for a in audits]
    return _csv_response(rows, f"audits_export_{datetime.utcnow().strftime('%Y%m%d')}.csv")

@router.get("/export/policies")
async def export_policies(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    policies = list((await db.execute(select(Policy).where(Policy.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": p.id, "title": p.title, "policy_number": p.policy_number or "",
        "category": p.category or "",
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "review_frequency_months": p.review_frequency_months,
        "next_review_date": p.next_review_date or "",
        "created_at": p.created_at.isoformat() if p.created_at else "",
    } for p in policies]
    return _csv_response(rows, f"policies_export_{datetime.utcnow().strftime('%Y%m%d')}.csv")

@router.get("/export/compliance")
async def export_compliance(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    assessments = list((await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id))).scalars().all())
    rows = [{
        "id": a.id, "name": a.name or "",
        "status": a.status.value if hasattr(a.status, "value") else str(a.status),
        "compliance_score": a.compliance_score if a.compliance_score is not None else "",
        "created_at": a.created_at.isoformat() if a.created_at else "",
    } for a in assessments]
    return _csv_response(rows, f"compliance_export_{datetime.utcnow().strftime('%Y%m%d')}.csv")

@router.get("/export/threats")
async def export_threats(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
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
    return _csv_response(rows, f"threats_export_{datetime.utcnow().strftime('%Y%m%d')}.csv")


# ── IMPORTS ──────────────────────────────────────────────────────────────

@router.post("/import/risks")
async def import_risks(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """Import risks from CSV file. Columns: title, description, category, likelihood, impact, severity."""
    content = await _read_csv_safely(file)
    reader = csv.DictReader(io.StringIO(content))
    created = 0; errors = []
    for i, row in enumerate(reader, 2):
        try:
            if not row.get("title", "").strip():
                errors.append(f"Row {i}: title is required"); continue
            r = Risk(tenant_id=tenant_id, title=row["title"].strip(),
                     description=row.get("description", "").strip() or None,
                     risk_category=row.get("category", "").strip() or None,
                     likelihood=float(row["likelihood"]) if row.get("likelihood") else None,
                     impact=float(row["impact"]) if row.get("impact") else None)
            db.add(r); created += 1
        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")
    await db.commit()
    return {"created": created, "errors": errors, "total_rows": created + len(errors)}

@router.post("/import/vendors")
async def import_vendors(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """Import vendors from CSV. Columns: name, industry, country, risk_tier, services_provided, website."""
    content = await _read_csv_safely(file)
    reader = csv.DictReader(io.StringIO(content))
    created = 0; errors = []
    for i, row in enumerate(reader, 2):
        try:
            if not row.get("name", "").strip():
                errors.append(f"Row {i}: name is required"); continue
            v = Vendor(tenant_id=tenant_id, name=row["name"].strip(),
                       industry=row.get("industry", "").strip() or None,
                       country=row.get("country", "").strip() or None,
                       services_provided=row.get("services_provided", "").strip() or None,
                       website=row.get("website", "").strip() or None)
            tier = row.get("risk_tier", "medium").strip().lower()
            if tier in ("critical", "high", "medium", "low"):
                from app.models.vendor import VendorRiskTier
                v.risk_tier = VendorRiskTier(tier)
            db.add(v); created += 1
        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")
    await db.commit()
    return {"created": created, "errors": errors, "total_rows": created + len(errors)}

@router.post("/import/assets")
async def import_assets(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """Import assets from CSV. Columns: name, asset_type, criticality, description, hosting_type, location."""
    content = await _read_csv_safely(file)
    reader = csv.DictReader(io.StringIO(content))
    created = 0; errors = []
    for i, row in enumerate(reader, 2):
        try:
            if not row.get("name", "").strip():
                errors.append(f"Row {i}: name is required"); continue
            at = row.get("asset_type", "application").strip().lower()
            crit = row.get("criticality", "medium").strip().lower()
            a = Asset(tenant_id=tenant_id, name=row["name"].strip(),
                      asset_type=AssetType(at) if at in [e.value for e in AssetType] else AssetType.APPLICATION,
                      criticality=AssetCriticality(crit) if crit in [e.value for e in AssetCriticality] else AssetCriticality.MEDIUM,
                      description=row.get("description", "").strip() or None,
                      hosting_type=row.get("hosting_type", "").strip() or None,
                      location=row.get("location", "").strip() or None)
            db.add(a); created += 1
        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")
    await db.commit()
    return {"created": created, "errors": errors, "total_rows": created + len(errors)}
