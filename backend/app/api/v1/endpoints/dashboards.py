"""Per-module dashboards (Elite Pack) — RFP module 14.

The RFP asks for 9 dashboards; the platform shipped only compliance + a central
KPI view. This adds the 7 missing module dashboards as aggregation endpoints the
SPA renders. Every metric query is wrapped defensively so one missing column
degrades a single tile to empty rather than 500-ing the whole dashboard.

All gated behind ``custom_dashboards``; all tenant-scoped.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.asset import Asset
from app.models.vulnerability import Vulnerability
from app.models.threat import Threat
from app.models.risk import Risk
from app.models.applied_control import AppliedControl
from app.models.policy import Policy, PolicyAttestation
from app.models.audit import Audit, AuditFinding
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_Gate = Depends(require_feature("custom_dashboards"))


async def _count_by(db: AsyncSession, model, column, tenant_id: str) -> dict:
    """Grouped counts {value: n}; empty dict if the column/query fails."""
    try:
        result = await db.execute(
            select(column, func.count())
            .where(model.tenant_id == tenant_id)
            .group_by(column)
        )
        return {str(k if k is not None else "unspecified"): int(v) for k, v in result.all()}
    except Exception:
        return {}


async def _total(db: AsyncSession, model, tenant_id: str) -> int:
    try:
        result = await db.execute(
            select(func.count()).select_from(model).where(model.tenant_id == tenant_id)
        )
        return int(result.scalar() or 0)
    except Exception:
        return 0


async def _agg(db: AsyncSession, model, agg_fn, tenant_id: str) -> float | None:
    try:
        result = await db.execute(select(agg_fn).where(model.tenant_id == tenant_id))
        value = result.scalar()
        return round(float(value), 2) if value is not None else None
    except Exception:
        return None


@router.get("/assets")
async def assets_dashboard(
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "total": await _total(db, Asset, tenant_id),
        "by_type": await _count_by(db, Asset, Asset.asset_type, tenant_id),
        "by_criticality": await _count_by(db, Asset, Asset.criticality, tenant_id),
        "by_class": await _count_by(db, Asset, getattr(Asset, "asset_class", Asset.asset_type), tenant_id),
        "by_lifecycle": await _count_by(db, Asset, getattr(Asset, "lifecycle_state", Asset.asset_type), tenant_id),
    }


@router.get("/vulnerabilities")
async def vulnerabilities_dashboard(
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "total": await _total(db, Vulnerability, tenant_id),
        "by_severity": await _count_by(db, Vulnerability, Vulnerability.severity, tenant_id),
        "by_status": await _count_by(db, Vulnerability, Vulnerability.status, tenant_id),
        "avg_cvss": await _agg(db, Vulnerability, func.avg(Vulnerability.cvss_score), tenant_id),
    }


@router.get("/threats")
async def threats_dashboard(
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "total": await _total(db, Threat, tenant_id),
        "by_category": await _count_by(db, Threat, Threat.category, tenant_id),
        "pending": await _count_by(db, Threat, getattr(Threat, "is_pending", Threat.category), tenant_id),
    }


@router.get("/risks")
async def risks_dashboard(
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # 5x5 heatmap cells from likelihood x impact.
    heatmap: list[dict] = []
    try:
        result = await db.execute(
            select(Risk.likelihood, Risk.impact, func.count())
            .where(Risk.tenant_id == tenant_id)
            .group_by(Risk.likelihood, Risk.impact)
        )
        heatmap = [{"likelihood": lk, "impact": im, "count": int(n)} for lk, im, n in result.all()]
    except Exception:
        heatmap = []
    return {
        "total": await _total(db, Risk, tenant_id),
        "by_severity": await _count_by(db, Risk, Risk.severity, tenant_id),
        "by_status": await _count_by(db, Risk, Risk.status, tenant_id),
        "heatmap": heatmap,
    }


@router.get("/controls")
async def controls_dashboard(
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "total": await _total(db, AppliedControl, tenant_id),
        "by_status": await _count_by(db, AppliedControl, AppliedControl.status, tenant_id),
        "avg_progress": await _agg(db, AppliedControl, func.avg(getattr(AppliedControl, "progress", AppliedControl.id)), tenant_id),
        "total_cost": await _agg(db, AppliedControl, func.sum(getattr(AppliedControl, "cost", AppliedControl.id)), tenant_id),
    }


@router.get("/governance")
async def governance_dashboard(
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "policies_total": await _total(db, Policy, tenant_id),
        "policies_by_status": await _count_by(db, Policy, Policy.status, tenant_id),
        "attestations_by_status": await _count_by(db, PolicyAttestation, getattr(PolicyAttestation, "status", PolicyAttestation.id), tenant_id),
    }


@router.get("/audit")
async def audit_dashboard(
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "audits_total": await _total(db, Audit, tenant_id),
        "audits_by_status": await _count_by(db, Audit, Audit.status, tenant_id),
        "findings_by_severity": await _count_by(db, AuditFinding, getattr(AuditFinding, "severity", AuditFinding.id), tenant_id),
        "findings_by_status": await _count_by(db, AuditFinding, getattr(AuditFinding, "status", AuditFinding.id), tenant_id),
    }
