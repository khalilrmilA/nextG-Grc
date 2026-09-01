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
from app.models.cve_entry import CveEntry, CveAnnotation
from app.models.threat import Threat
from app.models.risk import Risk
from app.models.applied_control import AppliedControl
from app.models.policy import Policy, PolicyAttestation
from app.models.audit import Audit, AuditFinding
from app.models.governance import GovernanceCommittee
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_Gate = Depends(require_feature("custom_dashboards"))


def _label(key) -> str:
    """Human label for a group key — enum .value (not 'RiskSeverity.CRITICAL')."""
    if key is None:
        return "unspecified"
    return str(getattr(key, "value", key))


async def _count_by(db: AsyncSession, model, column, tenant_id: str, *, join_model=None, join_on=None) -> dict:
    """Grouped counts {value: n}; empty dict if the query fails.

    ``model`` may not carry ``tenant_id`` itself (e.g. AuditFinding, PolicyAttestation) —
    pass ``join_model``/``join_on`` to scope through the owning tenant-scoped table instead.
    """
    try:
        scope_model = join_model or model
        q = select(column, func.count()).group_by(column)
        if join_model is not None:
            q = q.join(join_model, join_on)
        q = q.where(scope_model.tenant_id == tenant_id)
        result = await db.execute(q)
        return {_label(k): int(v) for k, v in result.all()}
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


async def _cve_summary(db: AsyncSession, tenant_id: str, top_n: int = 5) -> dict:
    """Pertinent-CVE rollup for the vulnerabilities dashboard (RFP gap fix — CVEs
    weren't surfaced in any dashboard: dashboards.py referenced no CVE entity).

    Joins CveAnnotation (per-tenant relevance triage) to the global CveEntry
    catalog, keeping only entries this tenant has marked "pertinent", and returns
    a count plus the top few by CVSS score. Defensive like every other tile here —
    an empty/degraded result on failure rather than a 500 for the whole dashboard.
    """
    try:
        result = await db.execute(
            select(CveEntry)
            .join(CveAnnotation, CveAnnotation.cve_id == CveEntry.cve_id)
            .where(CveAnnotation.tenant_id == tenant_id, CveAnnotation.relevance == "pertinent")
        )
        entries = result.scalars().all()
    except Exception:
        return {"pertinent_count": 0, "top": []}

    top_entries = sorted(entries, key=lambda e: (e.cvss_score or 0.0), reverse=True)[:top_n]
    return {
        "pertinent_count": len(entries),
        "top": [
            {
                "cve_id": e.cve_id,
                "cvss_score": e.cvss_score,
                "cvss_vector": e.cvss_vector,
                "description": (e.description or "")[:200],
            }
            for e in top_entries
        ],
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
        "cve": await _cve_summary(db, tenant_id),
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


async def _committee_summary(db: AsyncSession, tenant_id: str) -> dict:
    """Steering committee tile (M14.6): count + the soonest upcoming meeting.

    ``next_meeting_date`` is a free-text ISO date string (project convention, not a
    SQL Date column — see other *_date fields across the schema), so the "soonest"
    pick is done in Python rather than an ORDER BY, skipping unparseable/blank values.
    """
    try:
        result = await db.execute(
            select(GovernanceCommittee).where(GovernanceCommittee.tenant_id == tenant_id)
        )
        committees = result.scalars().all()
    except Exception:
        return {"total": 0, "next_meeting": None}

    upcoming = [
        {"id": c.id, "name": c.name, "next_meeting_date": c.next_meeting_date}
        for c in committees
        if c.next_meeting_date
    ]
    upcoming.sort(key=lambda c: c["next_meeting_date"])
    return {
        "total": len(committees),
        "next_meeting": upcoming[0] if upcoming else None,
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
        "attestations_by_status": await _count_by(
            db, PolicyAttestation, getattr(PolicyAttestation, "status", PolicyAttestation.id), tenant_id,
            join_model=Policy, join_on=PolicyAttestation.policy_id == Policy.id,
        ),
        "committees": await _committee_summary(db, tenant_id),
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
        "findings_by_severity": await _count_by(
            db, AuditFinding, getattr(AuditFinding, "severity", AuditFinding.id), tenant_id,
            join_model=Audit, join_on=AuditFinding.audit_id == Audit.id,
        ),
        "findings_by_status": await _count_by(
            db, AuditFinding, getattr(AuditFinding, "status", AuditFinding.id), tenant_id,
            join_model=Audit, join_on=AuditFinding.audit_id == Audit.id,
        ),
    }
