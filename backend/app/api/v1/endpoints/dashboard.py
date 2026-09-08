"""Dashboard and analytics endpoints."""
import logging
import uuid
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, insert as sa_insert, update as sa_update
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from typing import Annotated

from app.core.database import get_db
from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus, ComplianceGap, UploadedDocument, AssessmentStatus
from app.models.audit import Audit, AuditFinding, FindingStatus
from app.models.vendor import Vendor
from app.models.policy import Policy, PolicyAttestation, AttestationStatus
from app.models.framework import Framework, FrameworkControl
from app.models.mandatory_document import MandatoryDocument
from app.models.tenant import Tenant
from app.models.risk_snapshot import RiskSnapshot
from app.models.dashboard_layout import DashboardLayout
# Cross-module models, used only by the consolidated executive view below. The
# central /summary predates seven of the nine tender objectives and never
# imported them.
from app.models.asset import Asset
from app.models.vulnerability import Vulnerability, VulnStatus
from app.models.threat import Threat
from app.models.applied_control import AppliedControl
from app.models.incident import Incident, IncidentStatus
from app.models.governance import GovernanceCommittee
from app.models.security_exception import SecurityException
from app.api.v1.dependencies import get_current_user, get_tenant_id
from app.api.v1.dependencies.auth import require_roles_strict
from app.api.v1.dependencies.features import require_feature
from app.models.user import User, UserRole

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/summary")
async def get_dashboard_summary(
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Returns the main dashboard summary with metrics across all GRC modules.
    Used for the executive dashboard / CISO overview.
    """
    # Risk metrics
    risk_result = await db.execute(
        select(Risk.severity, func.count(Risk.id))
        .where(Risk.tenant_id == tenant_id, Risk.status != RiskStatus.CLOSED)
        .group_by(Risk.severity)
    )
    risk_by_severity = {row[0]: row[1] for row in risk_result.fetchall() if row[0]}

    total_open_risks = sum(risk_by_severity.values())
    critical_risks = risk_by_severity.get(RiskSeverity.CRITICAL, 0)
    high_risks = risk_by_severity.get(RiskSeverity.HIGH, 0)

    # Compliance posture
    assessments_result = await db.execute(
        select(ComplianceAssessment)
        .where(ComplianceAssessment.tenant_id == tenant_id)
    )
    assessments = assessments_result.scalars().all()

    avg_compliance_score = None
    if assessments:
        scores = [a.compliance_score for a in assessments if a.compliance_score is not None]
        avg_compliance_score = round(sum(scores) / len(scores), 1) if scores else None

    # Control status distribution
    control_result = await db.execute(
        select(ControlAssessment.status, func.count(ControlAssessment.id))
        .join(ComplianceAssessment)
        .where(ComplianceAssessment.tenant_id == tenant_id)
        .group_by(ControlAssessment.status)
    )
    controls_by_status = {row[0].value: row[1] for row in control_result.fetchall()}

    total_controls = sum(controls_by_status.values())
    implemented = controls_by_status.get(ControlStatus.IMPLEMENTED.value, 0)
    control_coverage = round((implemented / total_controls * 100), 1) if total_controls else 0

    # Open audit findings
    findings_result = await db.execute(
        select(func.count(AuditFinding.id))
        .join(Audit)
        .where(Audit.tenant_id == tenant_id, AuditFinding.status == FindingStatus.OPEN)
    )
    open_findings = findings_result.scalar_one()

    # Vendor risk
    vendor_result = await db.execute(
        select(func.count(Vendor.id))
        .where(Vendor.tenant_id == tenant_id)
    )
    total_vendors = vendor_result.scalar_one()

    # Policy attestation rate
    attestation_result = await db.execute(
        select(PolicyAttestation.status, func.count(PolicyAttestation.id))
        .join(Policy)
        .where(Policy.tenant_id == tenant_id)
        .group_by(PolicyAttestation.status)
    )
    attestations_by_status = {row[0].value: row[1] for row in attestation_result.fetchall()}
    total_attestations = sum(attestations_by_status.values())
    acknowledged = attestations_by_status.get(AttestationStatus.ACKNOWLEDGED.value, 0)
    attestation_rate = round((acknowledged / total_attestations * 100), 1) if total_attestations else 0

    return {
        "risk": {
            "total_open": total_open_risks,
            "critical": critical_risks,
            "high": high_risks,
            "by_severity": {k.value if hasattr(k, 'value') else k: v for k, v in risk_by_severity.items()},
        },
        "compliance": {
            "average_score": avg_compliance_score,
            "total_assessments": len(assessments),
            "control_coverage_percent": control_coverage,
            "controls_by_status": controls_by_status,
        },
        "audit": {
            "open_findings": open_findings,
        },
        "vendor": {
            "total_vendors": total_vendors,
        },
        "policy": {
            "attestation_rate_percent": attestation_rate,
            "total_attestations": total_attestations,
        },
    }


@router.get("/risk-trend")
async def get_risk_trend(
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    months: int = 6,
):
    """
    Real risk-trend series for the central dashboard's trend chart.

    RFP gap (part 1, closed earlier): the chart was fed by a hardcoded
    frontend constant (RISK_TREND in DashboardPage.tsx) with fabricated
    numbers. That was fixed by computing new-risk intake volume from
    Risk.created_at — real data, but only a proxy for "is new risk volume
    rising or falling", not the true point-in-time open-risk backlog.

    RFP gap (part 2, closed here): "il s'agit d'un volume d'entrée réel
    plutôt qu'un historique complet du solde de risques (aucune table
    d'historisation)." app.services.risk_snapshot_scheduler now writes one
    RiskSnapshot row per tenant per UTC day with the then-current open-risk
    counts by severity. Once any snapshots exist for this tenant, this
    endpoint switches to that real point-in-time series (last snapshot on or
    before each month's end); until then — a fresh deploy with no snapshots
    accumulated yet — it falls back to the original intake-volume proxy below
    so behavior never regresses.
    """
    months = max(1, min(months, 24))
    now = datetime.utcnow()

    # Build the ordered list of the last `months` (year, month) buckets, oldest first.
    buckets: list[tuple[int, int]] = []
    y, m = now.year, now.month
    for _ in range(months):
        buckets.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    buckets.reverse()

    has_snapshots = (await db.execute(
        select(func.count(RiskSnapshot.id)).where(RiskSnapshot.tenant_id == tenant_id)
    )).scalar() or 0

    if has_snapshots:
        earliest_key = f"{buckets[0][0]:04d}-{buckets[0][1]:02d}-01"
        snaps = list((await db.execute(
            select(RiskSnapshot)
            .where(RiskSnapshot.tenant_id == tenant_id, RiskSnapshot.snapshot_date >= earliest_key)
            .order_by(RiskSnapshot.snapshot_date.asc())
        )).scalars().all())

        import calendar
        series = []
        last_seen: RiskSnapshot | None = None
        idx = 0
        for (yy, mm) in buckets:
            month_end = f"{yy:04d}-{mm:02d}-{calendar.monthrange(yy, mm)[1]:02d}"
            while idx < len(snaps) and snaps[idx].snapshot_date <= month_end:
                last_seen = snaps[idx]
                idx += 1
            series.append({
                "month": datetime(yy, mm, 1).strftime("%b"),
                "period": f"{yy:04d}-{mm:02d}",
                "critical": last_seen.critical if last_seen else 0,
                "high": last_seen.high if last_seen else 0,
            })

        return {
            "series": series,
            "source": "risk_snapshot_daily",
            "note": (
                "Point-in-time open-risk counts by severity, as of the latest "
                "daily snapshot on or before each month's end."
            ),
        }

    # Fallback: no snapshots accumulated yet — original intake-volume proxy.
    month_key = func.strftime("%Y-%m", Risk.created_at)
    result = await db.execute(
        select(month_key, Risk.severity, func.count())
        .where(Risk.tenant_id == tenant_id)
        .group_by(month_key, Risk.severity)
    )
    counts: dict[str, dict[str, int]] = {}
    for key, severity, n in result.all():
        if not key:
            continue
        sev = severity.value if hasattr(severity, "value") else str(severity)
        counts.setdefault(key, {})[sev] = int(n)

    series = []
    for (yy, mm) in buckets:
        key = f"{yy:04d}-{mm:02d}"
        month_counts = counts.get(key, {})
        series.append({
            "month": datetime(yy, mm, 1).strftime("%b"),
            "period": key,
            "critical": month_counts.get("critical", 0),
            "high": month_counts.get("high", 0),
        })

    return {
        "series": series,
        "source": "risk_created_at_monthly",
        "note": (
            "New risks logged per month, by severity. No point-in-time snapshot "
            "history has accumulated for this tenant yet, so this reflects "
            "intake volume, not the historical open-risk backlog."
        ),
    }


def _build_section_pivot(controls, ca_map: dict) -> list[dict]:
    """Group controls by category and compute per-section compliance counts."""
    section_map: dict[str, dict] = {}
    for ctrl in controls:
        section = ctrl.category or "OTHER"
        if section not in section_map:
            section_map[section] = {"full": 0, "partial": 0, "not_impl": 0, "na": 0, "total": 0}
        ca = ca_map.get(ctrl.id)
        status = ca.status if ca else ControlStatus.NOT_STARTED
        section_map[section]["total"] += 1
        if status == ControlStatus.IMPLEMENTED:
            section_map[section]["full"] += 1
        elif status == ControlStatus.PARTIALLY_IMPLEMENTED:
            section_map[section]["partial"] += 1
        elif status == ControlStatus.NOT_APPLICABLE:
            section_map[section]["na"] += 1
        else:
            section_map[section]["not_impl"] += 1

    rows = []
    for section, counts in section_map.items():
        scoreable = counts["total"] - counts["na"]
        pct = round((counts["full"] + counts["partial"] * 0.5) / scoreable * 100, 1) if scoreable > 0 else 0.0
        rows.append({**counts, "section": section, "percent": pct})
    return rows


def _build_top_gaps(gaps, controls) -> list[dict]:
    """Return top 5 gaps sorted by remediation priority."""
    ctrl_id_map = {c.id: c for c in controls}
    top = sorted(gaps, key=lambda g: (-g.remediation_priority, g.severity))[:5]
    return [
        {
            "gap_id": g.id,
            "control_identifier": ctrl_id_map[g.control_id].control_id if g.control_id in ctrl_id_map else "",
            "control_title": ctrl_id_map[g.control_id].title if g.control_id in ctrl_id_map else "",
            "severity": g.severity,
            "is_certification_blocker": g.is_certification_blocker,
            "recommendation_status": g.recommendation_status,
        }
        for g in top
    ]


def _normalise_fw_key(short_name: str) -> str:
    key = short_name.upper().replace(" ", "").replace(":", "").replace("-", "")[:10]
    return "ISO27001" if "ISO27001" in key else key


def _cert_readiness(compliance_score: float, docs_uploaded: int, docs_required: int,
                    open_blockers: int, total_blockers: int) -> float:
    doc_pct = (docs_uploaded / docs_required * 100) if docs_required > 0 else 0.0
    blocker_pct = ((total_blockers - open_blockers) / total_blockers * 100) if total_blockers > 0 else 100.0
    return round(compliance_score * 0.5 + doc_pct * 0.3 + blocker_pct * 0.2, 1)


@router.get("/frameworks-overview")
async def get_frameworks_overview(
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
):
    """
    Returns a lightweight overview of ALL selected frameworks for the overview dashboard.
    Each entry has compliance score, open gaps, cert readiness, and assessment_id.
    """
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant or not tenant.primary_framework_id:
        return {"frameworks": [], "has_framework": False}

    all_fw_ids = list({tenant.primary_framework_id, *(tenant.selected_framework_ids or [])} - {None})

    fws_result = await db.execute(select(Framework).where(Framework.id.in_(all_fw_ids)))
    fws = {fw.id: fw for fw in fws_result.scalars().all()}

    cards = []
    for fw_id in all_fw_ids:
        fw = fws.get(fw_id)
        if not fw:
            continue

        # Pick the best assessment for this framework on the dashboard:
        #  1. Prefer non-draft (in_progress / completed) over draft, so a freshly
        #     created empty draft doesn't hide an older assessment with real progress.
        #  2. Among the preferred bucket, take the most recently updated one.
        a_result = await db.execute(
            select(ComplianceAssessment)
            .where(ComplianceAssessment.tenant_id == tenant_id, ComplianceAssessment.framework_id == fw_id)
            .order_by(
                case((ComplianceAssessment.status == AssessmentStatus.DRAFT, 1), else_=0),
                ComplianceAssessment.updated_at.desc(),
            )
            .limit(1)
        )
        assessment = a_result.scalar_one_or_none()

        if not assessment:
            cards.append({
                "framework_id": fw_id,
                "framework_name": fw.name,
                "framework_short_name": fw.short_name,
                "is_primary": fw_id == tenant.primary_framework_id,
                "has_assessment": False,
                "assessment_id": None,
                "compliance_score": None,
                "open_gaps": 0,
                "cert_readiness": None,
                "controls_total": 0,
                "controls_implemented": 0,
                # Unconditional: this branch is only reached when there is no
                # assessment at all (the old ternary could never take its first arm).
                "status": "draft",
            })
            continue

        # Counts only — this card never shows an individual control or gap, so
        # aggregate in SQL instead of hydrating every ControlAssessment and
        # ComplianceGap row of every selected framework just to call len() on
        # them (this loop already runs once per framework).
        status_counts = dict((await db.execute(
            select(ControlAssessment.status, func.count())
            .where(ControlAssessment.assessment_id == assessment.id)
            .group_by(ControlAssessment.status)
        )).all())

        total = sum(status_counts.values())
        implemented = status_counts.get(ControlStatus.IMPLEMENTED, 0)
        partial = status_counts.get(ControlStatus.PARTIALLY_IMPLEMENTED, 0)
        compliance_score = round((implemented + partial * 0.5) / total * 100, 1) if total else 0.0

        open_gaps = (await db.execute(
            select(func.count(ComplianceGap.id)).where(
                ComplianceGap.assessment_id == assessment.id,
                ComplianceGap.recommendation_status != "accepted",
            )
        )).scalar_one()

        open_blockers = (await db.execute(
            select(func.count(ComplianceGap.id)).where(
                ComplianceGap.assessment_id == assessment.id,
                ComplianceGap.is_certification_blocker == True,  # noqa: E712
                ComplianceGap.recommendation_status != "accepted",
            )
        )).scalar_one()

        docs_uploaded = (await db.execute(
            select(func.count(UploadedDocument.id))
            .where(UploadedDocument.assessment_id == assessment.id)
        )).scalar_one() or 0
        docs_required = (await db.execute(
            select(func.count(MandatoryDocument.id))
            .where(MandatoryDocument.framework_short_name == fw.short_name, MandatoryDocument.is_mandatory == True)  # noqa: E712
        )).scalar_one() or 0

        total_blockers = (await db.execute(
            select(func.count(ComplianceGap.id)).where(
                ComplianceGap.assessment_id == assessment.id,
                ComplianceGap.is_certification_blocker == True,  # noqa: E712
            )
        )).scalar_one()
        cert_readiness = _cert_readiness(compliance_score, docs_uploaded, docs_required, open_blockers, total_blockers)

        cards.append({
            "framework_id": fw_id,
            "framework_name": fw.name,
            "framework_short_name": fw.short_name,
            "is_primary": fw_id == tenant.primary_framework_id,
            "has_assessment": True,
            "assessment_id": assessment.id,
            "compliance_score": compliance_score,
            "open_gaps": open_gaps,
            "open_blockers": open_blockers,
            "cert_readiness": cert_readiness,
            "controls_total": total,
            "controls_implemented": implemented,
            "status": assessment.status.value,
        })

    # Put primary first, then sort by name
    cards.sort(key=lambda c: (not c["is_primary"], c["framework_name"]))
    return {"frameworks": cards, "has_framework": True}


@router.get("/framework-summary")
async def get_framework_summary(
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    framework_id: str | None = None,
):
    """
    Framework-specific compliance dashboard data.
    Returns section pivot table, certification readiness score, doc progress, and top gaps.
    Pass ?framework_id= to switch between selected frameworks; defaults to primary framework.
    """
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    if not tenant or not tenant.primary_framework_id:
        return {"has_framework": False}

    # Resolve which framework to show
    target_fw_id = framework_id or tenant.primary_framework_id

    # Build list of all selected frameworks for the switcher
    all_selected_ids = list({tenant.primary_framework_id, *(tenant.selected_framework_ids or [])} - {None})
    selected_fws_result = await db.execute(
        select(Framework).where(Framework.id.in_(all_selected_ids))
    )
    selected_fws = selected_fws_result.scalars().all()
    selected_fws_info = [
        {"id": f.id, "name": f.name, "short_name": f.short_name, "is_primary": f.id == tenant.primary_framework_id}
        for f in selected_fws
    ]

    # ?framework_id= is caller-supplied and was looked up by id alone, so any
    # authenticated user who knew (or was handed) the id of ANOTHER tenant's
    # custom framework got its name and short_name back in the payload. The
    # assessment below is tenant-filtered, so nothing else leaked — but the name
    # of a private, tenant-owned referential is still a cross-tenant read. Same
    # visibility predicate frameworks.py uses everywhere: shared built-ins, plus
    # this tenant's own forks, and nothing else.
    fw_result = await db.execute(select(Framework).where(
        Framework.id == target_fw_id,
        (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id),  # noqa: E712
    ))
    fw = fw_result.scalar_one_or_none()
    if not fw:
        return {"has_framework": False}

    assessment_result = await db.execute(
        select(ComplianceAssessment)
        .where(
            ComplianceAssessment.tenant_id == tenant_id,
            ComplianceAssessment.framework_id == fw.id,
        )
        .order_by(ComplianceAssessment.created_at.desc())
        .limit(1)
    )
    assessment = assessment_result.scalar_one_or_none()

    if not assessment:
        return {"has_framework": True, "framework_name": fw.name,
                "framework_short_name": fw.short_name, "has_assessment": False,
                "selected_frameworks": selected_fws_info}

    cas = (await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
    )).scalars().all()

    controls = (await db.execute(
        select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
        .order_by(FrameworkControl.sort_order)
    )).scalars().all()

    ca_map = {ca.control_id: ca for ca in cas}
    section_rows = _build_section_pivot(controls, ca_map)
    total_controls = len(controls)
    implemented_count = sum(1 for ca in cas if ca.status == ControlStatus.IMPLEMENTED)
    partial_count = sum(1 for ca in cas if ca.status == ControlStatus.PARTIALLY_IMPLEMENTED)

    gaps = (await db.execute(
        select(ComplianceGap).where(
            ComplianceGap.assessment_id == assessment.id,
            ComplianceGap.is_resolved == False,  # noqa: E712
        )
    )).scalars().all()

    open_gaps = len(gaps)
    top_gaps_data = _build_top_gaps(gaps, controls)
    open_blockers = sum(1 for g in gaps if g.is_certification_blocker)
    total_blockers = (await db.execute(
        select(func.count()).where(
            ComplianceGap.assessment_id == assessment.id,
            ComplianceGap.is_certification_blocker == True,  # noqa: E712
        )
    )).scalar() or 0

    fw_key = _normalise_fw_key(fw.short_name)
    mandatory_docs = (await db.execute(
        select(MandatoryDocument).where(MandatoryDocument.framework_short_name == fw_key)
    )).scalars().all()

    uploaded_docs = (await db.execute(
        select(UploadedDocument).where(UploadedDocument.assessment_id == assessment.id)
    )).scalars().all()
    uploaded_keys = {d.document_type_key for d in uploaded_docs if d.document_type_key}
    docs_uploaded = sum(1 for md in mandatory_docs if md.document_type_key in uploaded_keys)
    docs_required = len(mandatory_docs)
    missing_doc_names = [
        md.document_name for md in mandatory_docs
        if md.document_type_key not in uploaded_keys and md.is_mandatory
    ][:5]

    compliance_score = assessment.compliance_score or 0.0
    cert_readiness = _cert_readiness(compliance_score, docs_uploaded, docs_required,
                                     open_blockers, total_blockers)

    return {
        "has_framework": True,
        "has_assessment": True,
        "framework_name": fw.name,
        "framework_short_name": fw.short_name,
        "assessment_id": assessment.id,
        "assessment_name": assessment.name,
        "last_analyzed": assessment.updated_at.isoformat() if assessment.updated_at else None,
        "kpi": {
            "compliance_score": compliance_score,
            "controls_total": total_controls,
            "controls_implemented": implemented_count,
            "controls_partial": partial_count,
            "open_gaps": open_gaps,
            "certification_blockers": open_blockers,
            "cert_readiness": cert_readiness,
            "docs_uploaded": docs_uploaded,
            "docs_required": docs_required,
        },
        "section_pivot": section_rows,
        "top_gaps": top_gaps_data,
        "doc_progress": {
            "uploaded": docs_uploaded,
            "required": docs_required,
            "missing_names": missing_doc_names,
        },
        "certification_readiness": cert_readiness,
        "selected_frameworks": selected_fws_info,
        "active_framework_id": fw.id,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard widget personalization (Elite Pack, M14.9 partial).
#
# The RFP gap: tiles on the main Dashboard and the 7 module Analytics
# dashboards (dashboards.py) were fixed — `custom_dashboards` only gated
# access to the dashboard SET, not any actual layout personalization. This
# lets a user save which widgets are visible and in what order, per
# dashboard_key ("main" for this page, or a module key like "risks" for the
# Analytics dashboards). GET always works with a sensible all-visible default
# so nothing breaks for non-Elite tenants; only saving is gated.
# ─────────────────────────────────────────────────────────────────────────────

# Built-in default widget id lists, in display order — used whenever a user has
# no saved layout yet (or is on a plan that can't save one).
_DEFAULT_DASHBOARD_WIDGETS: dict[str, list[str]] = {
    "main": ["frameworks_grid", "action_plan", "platform_kpis"],
    "risks": ["total", "by_severity", "by_status", "heatmap"],
    "compliance": ["policies_total", "policies_by_status", "attestations_by_status"],
    "assets": ["total", "by_type", "by_criticality", "by_class", "by_lifecycle"],
    "vulnerabilities": ["total", "by_severity", "by_status", "avg_cvss", "cve"],
    "threats": ["total", "by_category", "pending"],
    "controls": ["total", "by_status", "avg_progress", "total_cost"],
    "governance": ["policies_total", "policies_by_status", "attestations_by_status"],
    "audit": ["audits_total", "audits_by_status", "findings_by_severity", "findings_by_status"],
    # Consolidated executive view (GET /executive-summary below). Listed here so
    # the board can hide blocks it does not want without the frontend inventing
    # its own catalogue, and so GET /layout?dashboard_key=executive returns
    # something other than an empty array. Ids match the response keys 1:1.
    "executive": ["posture", "risk", "compliance", "controls", "audit", "assets",
                  "vulnerabilities", "threats", "governance", "incidents",
                  "vendors", "exceptions"],
}


# --- STB objectif 1: « mise à jour ... selon un intervalle configuré » -------
# The tender wants a dashboard that refreshes itself, "en temps réel ou selon un
# intervalle configuré". There was no cadence anywhere in the product: no column,
# no setting, no API — the only way to see fresher numbers was to reload the page.
# The cadence is stored per (user, dashboard_key) on the same row as the widget
# layout, because it is the same kind of thing: a personal preference about one
# dashboard, not a tenant-wide policy.
#
# Bounds: 0 turns auto-refresh OFF (explicit, and distinct from NULL = "never
# chose one"); anything else must sit between 30s and 1h. The floor exists
# because /summary and /executive-summary are multi-table aggregations and a
# 5-second poll from every open browser is a self-inflicted load test; the
# ceiling exists because past an hour "auto-refresh" is a lie and the user
# should just say 0.
_MIN_REFRESH_SECONDS = 30
_MAX_REFRESH_SECONDS = 3600

# Per-process memo of "does dashboard_layouts.refresh_interval_seconds physically
# exist?".
#
# THE TRAP: dashboard_layouts is an EXISTING table, so create_all() will not add
# the new column at the next restart — scripts/migrate_add_dashboard_refresh.py
# has to be run by the operator. Until it is, any ORM SELECT of DashboardLayout
# names a column the database does not have => OperationalError => 500 => client.ts
# hard-redirects the whole SPA to /service-down. Losing the dashboard because a
# refresh *preference* is unmigrated is a far worse outcome than not having the
# preference, so every read here is column-restricted and probes first.
#
# Only ever flips False -> True, so the two uvicorn workers memoising it
# independently is harmless. A negative result is deliberately NOT cached: the
# probe is a single indexed-free one-row SELECT, and re-running it means the
# feature lights up on its own the moment the operator runs the migration, with
# no restart of a process that has no supervisor to bring it back.
_refresh_column_ready = False


async def _has_refresh_column(db: AsyncSession) -> bool:
    """True when the refresh-cadence column exists on this database."""
    global _refresh_column_ready
    if _refresh_column_ready:
        return True
    try:
        await db.execute(select(DashboardLayout.refresh_interval_seconds).limit(1))
    except (OperationalError, ProgrammingError):
        # Roll back before anything else runs on this session: on PostgreSQL the
        # failed statement poisons the transaction and every later query in the
        # request would fail too.
        await db.rollback()
        logger.info(
            "dashboard_layouts.refresh_interval_seconds is missing — run "
            "scripts/migrate_add_dashboard_refresh.py; serving layouts without a cadence"
        )
        return False
    _refresh_column_ready = True
    return True


def _refresh_unavailable() -> HTTPException:
    """424, not 500 — a 5xx would eject the user from the application entirely."""
    return HTTPException(
        status_code=424,
        detail=(
            "The dashboard refresh interval cannot be saved yet: column "
            "dashboard_layouts.refresh_interval_seconds does not exist. Run "
            "`python -m scripts.migrate_add_dashboard_refresh` on the server, then retry."
        ),
    )


class DashboardLayoutIn(BaseModel):
    # Ordered list of {"id": <widget-id>, "visible": <bool>}. List order IS the
    # display order — kept intentionally unstructured (list[dict]) rather than a
    # strict widget schema so the frontend owns the widget-id catalogue.
    #
    # Optional since the refresh cadence was added: a client changing only the
    # cadence must not have to round-trip (and risk clobbering) the whole widget
    # array. Omitted => left exactly as it was.
    widget_config: list[dict] | None = None

    # Seconds between auto-refreshes. 0 = off, null/omitted = leave unchanged.
    refresh_interval_seconds: int | None = None

    @field_validator("refresh_interval_seconds")
    @classmethod
    def _bounded_interval(cls, v: int | None) -> int | None:
        if v is None or v == 0:
            return v
        if v < _MIN_REFRESH_SECONDS or v > _MAX_REFRESH_SECONDS:
            raise ValueError(
                f"refresh_interval_seconds must be 0 (auto-refresh off) or between "
                f"{_MIN_REFRESH_SECONDS} and {_MAX_REFRESH_SECONDS} seconds"
            )
        return v


class DashboardLayoutOut(BaseModel):
    dashboard_key: str
    widget_config: list[dict]
    is_default: bool  # True when nothing was ever saved — a built-in default was returned instead
    # null = the user never configured a cadence (the client applies its own
    # default), 0 = auto-refresh explicitly off, n = refresh every n seconds.
    refresh_interval_seconds: int | None = None
    # False when the column is not on this database yet. The client MUST NOT send
    # refresh_interval_seconds while this is false — the PUT would 424.
    refresh_config_available: bool = True
    # Echoed so the settings UI does not have to hardcode the bounds.
    refresh_min_seconds: int = _MIN_REFRESH_SECONDS
    refresh_max_seconds: int = _MAX_REFRESH_SECONDS


def _default_widget_config(dashboard_key: str) -> list[dict]:
    return [{"id": wid, "visible": True} for wid in _DEFAULT_DASHBOARD_WIDGETS.get(dashboard_key, [])]


async def _load_layout_row(db: AsyncSession, user_id: str, dashboard_key: str, has_refresh: bool):
    """(id, widget_config, refresh_interval_seconds) for one saved layout, or None.

    Column-restricted on purpose: naming only the columns we need is what lets the
    unmigrated case work at all — an ORM entity SELECT would name
    refresh_interval_seconds unconditionally and blow up.
    """
    cols = [DashboardLayout.id, DashboardLayout.widget_config]
    if has_refresh:
        cols.append(DashboardLayout.refresh_interval_seconds)
    row = (await db.execute(
        select(*cols).where(
            DashboardLayout.user_id == user_id,
            DashboardLayout.dashboard_key == dashboard_key,
        )
    )).first()
    if row is None:
        return None
    return (row[0], row[1], row[2] if has_refresh else None)


@router.get("/layout", response_model=DashboardLayoutOut)
async def get_dashboard_layout(
    dashboard_key: str = "main",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Read the current user's saved widget layout + refresh cadence — never
    feature-gated, since a missing/denied layout must still render a normal
    (all-widgets, default order) dashboard for every tenant, Elite or not."""
    has_refresh = await _has_refresh_column(db)
    row = await _load_layout_row(db, current_user.id, dashboard_key, has_refresh)
    if row is not None and row[1]:
        return DashboardLayoutOut(
            dashboard_key=dashboard_key, widget_config=row[1], is_default=False,
            refresh_interval_seconds=row[2], refresh_config_available=has_refresh,
        )
    return DashboardLayoutOut(
        dashboard_key=dashboard_key, widget_config=_default_widget_config(dashboard_key),
        is_default=True,
        # A row can exist with an empty widget_config (cadence set, layout never
        # personalised) — its cadence is still the user's and must survive.
        refresh_interval_seconds=row[2] if row is not None else None,
        refresh_config_available=has_refresh,
    )


# The Elite Pack entitlement check, reused rather than reimplemented so the 402
# body stays byte-identical to every other gated route (the frontend has one
# global listener keyed on that `feature_not_in_plan` payload). It is applied
# INSIDE the handler instead of as a route dependency because the two things this
# route now writes are not the same product: rearranging widgets is the
# custom_dashboards feature, while the refresh cadence is an STB tender
# requirement (« mise à jour ... selon un intervalle configuré »). Gating the
# cadence on the plan would leave that clause unsatisfiable for every non-Elite
# tenant — on this database, 16 of 18 — which is a billing check doing the job of
# a capability, exactly what require_feature must not be used for.
_custom_dashboards_required = require_feature("custom_dashboards")


@router.put("/layout", response_model=DashboardLayoutOut)
async def save_dashboard_layout(
    body: DashboardLayoutIn,
    dashboard_key: str = "main",
    db: AsyncSession = Depends(get_db),
    tenant_id: str = Depends(get_tenant_id),
    current_user: User = Depends(get_current_user),
):
    """Save the current user's widget visibility + order and/or refresh cadence.

    Saving a WIDGET LAYOUT is unchanged: still custom_dashboards (Elite Pack),
    still the same 402 payload for everyone else. Saving only the REFRESH CADENCE
    is available on every plan — see _custom_dashboards_required above. Fields
    omitted from the body are left as they were, so the cadence and the widget
    list can be saved independently."""
    if body.widget_config is not None:
        await _custom_dashboards_required(current_user=current_user, db=db)

    wants_refresh = "refresh_interval_seconds" in body.model_fields_set
    has_refresh = await _has_refresh_column(db)
    if wants_refresh and not has_refresh:
        # Refuse before writing anything: a silent drop would show the user a
        # cadence that is not actually stored. 424 (not 500) keeps the SPA alive.
        raise _refresh_unavailable()

    # Only what the caller actually sent. Kept separate from the INSERT payload
    # below, which has to invent a widget_config for a brand-new row: replaying
    # that invented empty list on the conflict path would wipe the layout the
    # competing request just wrote.
    values: dict = {}
    if body.widget_config is not None:
        values["widget_config"] = body.widget_config
    if wants_refresh:
        values["refresh_interval_seconds"] = body.refresh_interval_seconds

    row = await _load_layout_row(db, current_user.id, dashboard_key, has_refresh)
    if row is None:
        # Core INSERT rather than db.add(DashboardLayout(...)): the ORM would emit
        # every mapped column, including the one that may not exist yet.
        insert_values = dict(values)
        insert_values.setdefault("widget_config", body.widget_config or [])
        try:
            await db.execute(sa_insert(DashboardLayout).values(
                id=str(uuid.uuid4()), user_id=current_user.id, tenant_id=tenant_id,
                dashboard_key=dashboard_key, **insert_values,
            ))
            await db.commit()
        except IntegrityError:
            # uq_dashboard_layout_user_key (user_id, dashboard_key). Select-then-
            # insert is not atomic and the two uvicorn workers make the race real:
            # dashboard_layouts is EMPTY on production, so every save happening
            # today is a *first* save and therefore takes the INSERT path, and a
            # cadence auto-save landing next to a widget save is enough to
            # collide. An unhandled IntegrityError is a 5xx, and a 5xx
            # hard-redirects the whole SPA to /service-down — losing the
            # application over a saved preference. The other writer won: keep its
            # row and merge our own fields into it.
            await db.rollback()
            row = await _load_layout_row(db, current_user.id, dashboard_key, has_refresh)
            if row is None:
                # Not the uniqueness race then (a foreign key, most likely).
                # Say so instead of returning 200 over a write that never landed;
                # 409 keeps the SPA alive where a 5xx would eject it.
                raise HTTPException(
                    status_code=409,
                    detail="The dashboard layout could not be saved. Please retry.",
                )
            if values:
                await db.execute(
                    sa_update(DashboardLayout).where(DashboardLayout.id == row[0]).values(**values)
                )
            await db.commit()
    else:
        if values:
            await db.execute(
                sa_update(DashboardLayout).where(DashboardLayout.id == row[0]).values(**values)
            )
        await db.commit()

    saved = await _load_layout_row(db, current_user.id, dashboard_key, has_refresh)
    widget_config = (saved[1] if saved else None) or _default_widget_config(dashboard_key)
    return DashboardLayoutOut(
        dashboard_key=dashboard_key, widget_config=widget_config,
        is_default=not bool(saved and saved[1]),
        refresh_interval_seconds=saved[2] if saved else None,
        refresh_config_available=has_refresh,
    )


# ─────────────────────────────────────────────────────────────────────────────
# STB objectif 9 — « une vue consolidée ... accessible uniquement aux profils
# exécutifs »
#
# Two independent failures had to be fixed for that clause to be true:
#
#  1. CONSOLIDATION. GET /summary above covers five of the nine objectives the
#     tender enumerates (risques, conformité, audit, tiers, politiques). Assets,
#     vulnerabilities, threats and applied controls appear nowhere in it, and
#     neither do incidents, exceptions or governance bodies — so no single call
#     ever produced "the" consolidated picture.
#  2. EXCLUSIVITY. /summary can never carry the restriction: it is the home
#     screen of every authenticated account, and gating it would lock every
#     non-executive user out of the product's landing page. The consolidated set
#     therefore lives on its own route, and that route carries the exclusion.
#
# require_roles_strict — not require_roles — is what makes « uniquement » true:
# require_roles returns early for SUPER_ADMIN and TENANT_ADMIN, so the clause
# would stay false for the tenant owner no matter which roles the route lists.
# Strict has no auto-pass; a tenant_admin who genuinely sits on the Direction
# Générale gets in by holding the `executive` (or `ciso`) role, not by owning
# the tenant. Deliberately NOT feature-gated on top: this is a tender
# requirement, not an Elite up-sell, and mixing a 402 into it would send the SPA
# to the upgrade dialog instead of showing the board its KPIs.
# ─────────────────────────────────────────────────────────────────────────────

# CISO is included alongside EXECUTIVE because the same clause names « la
# direction et le RSSI » as the audience of the consolidated view.
_EXECUTIVE_ROLES = (UserRole.EXECUTIVE, UserRole.CISO)

# Statuses that do NOT count as live work, per module. Filtering is done in
# Python over grouped counts rather than in the WHERE clause on purpose: these
# columns are a mix of SAEnum and plain String across models, so an enum bound
# into SQL is right for some and silently matches nothing on others. Grouping
# once and summing here is both cheaper (one query per module) and immune to it.
_CLOSED_VULN_STATUSES = {"mitigated", "closed", "false_positive", "accepted"}
_CLOSED_INCIDENT_STATUSES = {"resolved", "closed"}
_CLOSED_FINDING_STATUSES = {"remediated", "closed", "accepted"}


def _key_of(value) -> str:
    """Group-by key as a plain string — enum .value, never 'RiskSeverity.CRITICAL'."""
    if value is None:
        return "unspecified"
    return str(getattr(value, "value", value))


async def _exec_rows(db: AsyncSession, stmt, degraded: list[str], label: str) -> list[tuple]:
    """Run one aggregation, or degrade that block to empty and say which one.

    Broad `except` on purpose (dashboards.py does the same): the point is that a
    single missing column, absent table or bad enum value costs one tile, never
    the whole consolidated view — a 5xx here hard-redirects the SPA to
    /service-down, which is the worst possible outcome on a board-level screen.
    The rollback matters on PostgreSQL, where the failed statement would
    otherwise poison the transaction for every query that follows.
    """
    try:
        return list((await db.execute(stmt)).all())
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        degraded.append(label)
        logger.warning("executive-summary block degraded: %s", label, exc_info=True)
        return []


async def _exec_scalar(db: AsyncSession, stmt, degraded: list[str], label: str, default=0):
    rows = await _exec_rows(db, stmt, degraded, label)
    if not rows:
        return default
    value = rows[0][0]
    return default if value is None else value


def _grouped(rows: list[tuple]) -> dict[str, int]:
    """[(key, n), ...] -> {"key": n} with stringified keys."""
    return {_key_of(k): int(n) for k, n in rows}


def _posture(compliance_score: float | None, control_coverage: float | None,
             critical_risks: int, high_risks: int) -> dict:
    """One headline number for the board, with its inputs shown.

    There is no such thing as an objective "security posture score", so this
    returns the formula and every component alongside the value — an executive
    reading a single number has to be able to see what moved it, and an auditor
    has to be able to reproduce it. Components that cannot be computed (no
    assessment yet, no control evaluated) are dropped and the remaining weights
    are renormalised rather than silently scored as zero, which would make an
    empty tenant look catastrophic instead of unmeasured.
    """
    # A critical open risk costs 15 points, a high one 5; 100 is a clean book.
    risk_component = max(0.0, 100.0 - (critical_risks * 15 + high_risks * 5))
    parts = [
        ("compliance", compliance_score, 0.4),
        ("control_coverage", control_coverage, 0.3),
        ("risk_exposure", risk_component, 0.3),
    ]
    available = [(n, v, w) for n, v, w in parts if v is not None]
    total_weight = sum(w for _n, _v, w in available)
    score = round(sum(v * w for _n, v, w in available) / total_weight, 1) if total_weight else None
    return {
        "score": score,
        "components": {n: round(float(v), 1) for n, v, _w in available},
        "weights": {n: w for n, _v, w in parts},
        "formula": (
            "0.4 x average compliance score + 0.3 x implemented-control coverage + "
            "0.3 x (100 - 15 x critical open risks - 5 x high open risks), "
            "renormalised over the components that could be computed"
        ),
    }


@router.get("/executive-summary")
async def get_executive_summary(
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles_strict(*_EXECUTIVE_ROLES))],
):
    """Consolidated cross-module KPI set for the Direction Générale / RSSI.

    Every one of the nine tender objectives contributes one block. `degraded`
    lists the blocks whose query failed (missing column, unmigrated table) so the
    UI can mark them "unavailable" instead of drawing a convincing zero, and so
    an operator can see it in the response rather than only in the log.
    """
    degraded: list[str] = []

    # --- Objectif 1: patrimoine / assets -------------------------------------
    assets_total = await _exec_scalar(
        db, select(func.count()).select_from(Asset).where(Asset.tenant_id == tenant_id),
        degraded, "assets")
    assets_by_criticality = _grouped(await _exec_rows(
        db, select(Asset.criticality, func.count()).where(Asset.tenant_id == tenant_id)
        .group_by(Asset.criticality), degraded, "assets.by_criticality"))

    # --- Objectif 2: vulnérabilités ------------------------------------------
    vuln_rows = await _exec_rows(
        db, select(Vulnerability.status, Vulnerability.severity, func.count())
        .where(Vulnerability.tenant_id == tenant_id)
        .group_by(Vulnerability.status, Vulnerability.severity), degraded, "vulnerabilities")
    vulns_total = sum(int(n) for _s, _sev, n in vuln_rows)
    vulns_open = 0
    vulns_open_by_severity: dict[str, int] = {}
    for status, severity, n in vuln_rows:
        if _key_of(status) in _CLOSED_VULN_STATUSES:
            continue
        vulns_open += int(n)
        key = _key_of(severity)
        vulns_open_by_severity[key] = vulns_open_by_severity.get(key, 0) + int(n)
    avg_cvss = await _exec_scalar(
        db, select(func.avg(Vulnerability.cvss_score)).where(Vulnerability.tenant_id == tenant_id),
        degraded, "vulnerabilities.avg_cvss", default=None)

    # --- Objectif 3: menaces --------------------------------------------------
    # Built-in threats carry a NULL tenant_id (models/threat.py) and are shared
    # by every tenant, so scoping on tenant_id alone would report zero on a
    # tenant that has not forked any of them.
    threats_total = await _exec_scalar(
        db, select(func.count()).select_from(Threat).where(
            (Threat.tenant_id == tenant_id) | (Threat.is_builtin == True)  # noqa: E712
        ), degraded, "threats")
    threats_tenant_specific = await _exec_scalar(
        db, select(func.count()).select_from(Threat).where(Threat.tenant_id == tenant_id),
        degraded, "threats.tenant")
    threats_by_category = _grouped(await _exec_rows(
        db, select(Threat.category, func.count()).where(
            (Threat.tenant_id == tenant_id) | (Threat.is_builtin == True)  # noqa: E712
        ).group_by(Threat.category), degraded, "threats.by_category"))

    # --- Objectif 4: risques --------------------------------------------------
    risk_by_severity = _grouped(await _exec_rows(
        db, select(Risk.severity, func.count(Risk.id))
        .where(Risk.tenant_id == tenant_id, Risk.status != RiskStatus.CLOSED)
        .group_by(Risk.severity), degraded, "risks"))
    total_open_risks = sum(risk_by_severity.values())
    critical_risks = risk_by_severity.get(RiskSeverity.CRITICAL.value, 0)
    high_risks = risk_by_severity.get(RiskSeverity.HIGH.value, 0)

    # The board's « top 5 » ranked on the INHERENT product (likelihood x impact)
    # alone, which contradicted the platform's own definition of how big a risk
    # is: Risk.is_above_appetite (models/risk.py) reads the residual score and
    # falls back to the inherent one only when there is none. The contradiction
    # was visible, not theoretical — on the demo tenant a severity=low risk with
    # a 2x2 residual sat at #1 with 20.0, above six `high` risks — and it is the
    # treated-risk case a bank will look for first. nullif() reproduces the model
    # property exactly: it treats a 0 factor as "not assessed", not as a residual
    # of zero. Both inputs are returned alongside the effective score, so a
    # reader can see why a treated risk now sits below an untreated one: a row
    # carrying a residual_score was ranked on it, one carrying null was not.
    # Deliberately NOT a third `score_basis` string field — it is derivable from
    # residual_score being null, nothing reads it, and its value ("inherent")
    # is a machine token the export's shared vocabulary table cannot translate,
    # which would put an English word into the French tender artefact.
    _inherent_score = func.coalesce(Risk.likelihood, 0) * func.coalesce(Risk.impact, 0)
    _residual_score = func.nullif(Risk.residual_likelihood, 0) * func.nullif(Risk.residual_impact, 0)
    _effective_score = func.coalesce(_residual_score, _inherent_score)
    top_risks = [
        {
            "id": rid,
            "title": title,
            "severity": _key_of(severity),
            # The score the ranking used. Null factors score 0 rather than
            # dropping the row: an unscored risk is a governance problem the
            # board should still see listed.
            "score": round(float(score or 0), 1),
            "inherent_score": round(float(inherent or 0), 1),
            "residual_score": round(float(residual), 1) if residual is not None else None,
        }
        for rid, title, severity, score, residual, inherent in await _exec_rows(
            db, select(
                Risk.id, Risk.title, Risk.severity,
                _effective_score.label("score"),
                _residual_score.label("residual"),
                _inherent_score.label("inherent"),
            )
            .where(Risk.tenant_id == tenant_id, Risk.status != RiskStatus.CLOSED)
            .order_by(_effective_score.desc())
            .limit(5), degraded, "risks.top")
    ]

    # Month-over-month backlog movement, from the daily snapshot table the
    # risk-trend endpoint above already relies on. Absent snapshots (fresh
    # install, scheduler never ran) => null, never a fabricated 0%.
    snapshots = await _exec_rows(
        db, select(RiskSnapshot.snapshot_date, RiskSnapshot.total_open)
        .where(RiskSnapshot.tenant_id == tenant_id)
        .order_by(RiskSnapshot.snapshot_date.desc()).limit(60), degraded, "risks.trend")
    risk_backlog_delta = None
    if len(snapshots) >= 2:
        latest_date, latest_open = snapshots[0]
        # The newest snapshot at least 30 days older than the latest one; if the
        # series is shorter than that, the oldest row we pulled, so a young
        # tenant still gets an honest (clearly-dated) comparison rather than none.
        try:
            cutoff = (date.fromisoformat(latest_date) - timedelta(days=30)).isoformat()
        except (TypeError, ValueError):
            cutoff = latest_date
        prior = next((s for s in snapshots if s[0] <= cutoff), snapshots[-1])
        risk_backlog_delta = {
            "from_date": prior[0], "from_open": int(prior[1] or 0),
            "to_date": latest_date, "to_open": int(latest_open or 0),
            "change": int(latest_open or 0) - int(prior[1] or 0),
        }

    # --- Objectif 5: mesures / contrôles appliqués ---------------------------
    applied_by_status = _grouped(await _exec_rows(
        db, select(AppliedControl.status, func.count())
        .where(AppliedControl.tenant_id == tenant_id)
        .group_by(AppliedControl.status), degraded, "controls"))
    applied_total = sum(applied_by_status.values())
    avg_progress = await _exec_scalar(
        db, select(func.avg(AppliedControl.progress)).where(AppliedControl.tenant_id == tenant_id),
        degraded, "controls.avg_progress", default=None)
    total_control_cost = await _exec_scalar(
        db, select(func.sum(AppliedControl.cost)).where(AppliedControl.tenant_id == tenant_id),
        degraded, "controls.cost", default=None)

    # Evaluated-control coverage (framework controls), the other half of
    # "contrôles": /summary's control_coverage_percent, kept identical.
    controls_by_status = _grouped(await _exec_rows(
        db, select(ControlAssessment.status, func.count(ControlAssessment.id))
        .join(ComplianceAssessment)
        .where(ComplianceAssessment.tenant_id == tenant_id)
        .group_by(ControlAssessment.status), degraded, "controls.assessed"))
    total_assessed = sum(controls_by_status.values())
    implemented = controls_by_status.get(ControlStatus.IMPLEMENTED.value, 0)
    control_coverage = round(implemented / total_assessed * 100, 1) if total_assessed else None

    # --- Objectif 6: gouvernance ---------------------------------------------
    policies_by_status = _grouped(await _exec_rows(
        db, select(Policy.status, func.count()).where(Policy.tenant_id == tenant_id)
        .group_by(Policy.status), degraded, "governance.policies"))
    attestations_by_status = _grouped(await _exec_rows(
        db, select(PolicyAttestation.status, func.count(PolicyAttestation.id))
        .join(Policy).where(Policy.tenant_id == tenant_id)
        .group_by(PolicyAttestation.status), degraded, "governance.attestations"))
    total_attestations = sum(attestations_by_status.values())
    acknowledged = attestations_by_status.get(AttestationStatus.ACKNOWLEDGED.value, 0)
    attestation_rate = round(acknowledged / total_attestations * 100, 1) if total_attestations else None
    committee_rows = await _exec_rows(
        db, select(GovernanceCommittee.name, GovernanceCommittee.next_meeting_date)
        .where(GovernanceCommittee.tenant_id == tenant_id), degraded, "governance.committees")
    # next_meeting_date is an ISO *string* column (project convention), so the
    # soonest one is picked in Python, skipping blanks — same as dashboards.py.
    upcoming = sorted(
        ({"name": n, "next_meeting_date": d} for n, d in committee_rows if d),
        key=lambda c: c["next_meeting_date"],
    )

    # --- Objectif 7: conformité ----------------------------------------------
    assessment_rows = await _exec_rows(
        db, select(ComplianceAssessment.id, ComplianceAssessment.compliance_score)
        .where(ComplianceAssessment.tenant_id == tenant_id), degraded, "compliance")
    scores = [float(s) for _i, s in assessment_rows if s is not None]
    avg_compliance_score = round(sum(scores) / len(scores), 1) if scores else None
    open_gaps = await _exec_scalar(
        db, select(func.count(ComplianceGap.id)).join(ComplianceAssessment)
        .where(ComplianceAssessment.tenant_id == tenant_id,
               ComplianceGap.is_resolved == False),  # noqa: E712
        degraded, "compliance.gaps")
    cert_blockers = await _exec_scalar(
        db, select(func.count(ComplianceGap.id)).join(ComplianceAssessment)
        .where(ComplianceAssessment.tenant_id == tenant_id,
               ComplianceGap.is_resolved == False,  # noqa: E712
               ComplianceGap.is_certification_blocker == True),  # noqa: E712
        degraded, "compliance.blockers")

    # --- Objectif 8: audit ----------------------------------------------------
    audits_by_status = _grouped(await _exec_rows(
        db, select(Audit.status, func.count()).where(Audit.tenant_id == tenant_id)
        .group_by(Audit.status), degraded, "audit"))
    finding_rows = await _exec_rows(
        db, select(AuditFinding.status, AuditFinding.severity, func.count())
        .join(Audit, AuditFinding.audit_id == Audit.id)
        .where(Audit.tenant_id == tenant_id)
        .group_by(AuditFinding.status, AuditFinding.severity), degraded, "audit.findings")
    open_findings = 0
    open_findings_by_severity: dict[str, int] = {}
    for status, severity, n in finding_rows:
        if _key_of(status) in _CLOSED_FINDING_STATUSES:
            continue
        open_findings += int(n)
        key = _key_of(severity)
        open_findings_by_severity[key] = open_findings_by_severity.get(key, 0) + int(n)

    # --- Cross-cutting: incidents, tiers, dérogations -------------------------
    incident_rows = await _exec_rows(
        db, select(Incident.status, Incident.severity, func.count())
        .where(Incident.tenant_id == tenant_id)
        .group_by(Incident.status, Incident.severity), degraded, "incidents")
    incidents_open = 0
    incidents_open_by_severity: dict[str, int] = {}
    for status, severity, n in incident_rows:
        if _key_of(status) in _CLOSED_INCIDENT_STATUSES:
            continue
        incidents_open += int(n)
        key = _key_of(severity)
        incidents_open_by_severity[key] = incidents_open_by_severity.get(key, 0) + int(n)

    vendors_by_tier = _grouped(await _exec_rows(
        db, select(Vendor.risk_tier, func.count()).where(Vendor.tenant_id == tenant_id)
        .group_by(Vendor.risk_tier), degraded, "vendors"))
    exceptions_by_status = _grouped(await _exec_rows(
        db, select(SecurityException.status, func.count())
        .where(SecurityException.tenant_id == tenant_id)
        .group_by(SecurityException.status), degraded, "exceptions"))

    # The cadence the executive dashboard should poll itself at, so the client
    # does not need a second round trip. Null when never configured or when the
    # column is not on this database yet (see _has_refresh_column).
    has_refresh = await _has_refresh_column(db)
    layout_row = None
    if has_refresh:
        layout_row = await _load_layout_row(db, current_user.id, "executive", True)

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "refresh_interval_seconds": layout_row[2] if layout_row else None,
        "refresh_config_available": has_refresh,
        # Blocks whose query failed. Empty on a healthy database; non-empty means
        # the UI must show "unavailable", not a zero.
        "degraded": degraded,
        "posture": _posture(avg_compliance_score, control_coverage, critical_risks, high_risks),
        "assets": {
            "total": int(assets_total),
            "by_criticality": assets_by_criticality,
            "critical": assets_by_criticality.get("critical", 0),
        },
        "vulnerabilities": {
            "total": vulns_total,
            "open": vulns_open,
            "open_by_severity": vulns_open_by_severity,
            "critical_high_open": vulns_open_by_severity.get("critical", 0) + vulns_open_by_severity.get("high", 0),
            "avg_cvss": round(float(avg_cvss), 2) if avg_cvss is not None else None,
        },
        "threats": {
            "total": int(threats_total),
            "tenant_specific": int(threats_tenant_specific),
            "by_category": threats_by_category,
        },
        "risk": {
            "total_open": total_open_risks,
            "critical": critical_risks,
            "high": high_risks,
            "by_severity": risk_by_severity,
            "top": top_risks,
            "backlog_change": risk_backlog_delta,
        },
        "controls": {
            "applied_total": applied_total,
            "applied_by_status": applied_by_status,
            "avg_progress_percent": round(float(avg_progress), 1) if avg_progress is not None else None,
            "total_cost": round(float(total_control_cost), 2) if total_control_cost is not None else None,
            "assessed_total": total_assessed,
            "assessed_implemented": implemented,
            "coverage_percent": control_coverage,
            "by_status": controls_by_status,
        },
        "governance": {
            "policies_total": sum(policies_by_status.values()),
            "policies_by_status": policies_by_status,
            "attestation_rate_percent": attestation_rate,
            "total_attestations": total_attestations,
            "committees_total": len(committee_rows),
            "next_committee_meeting": upcoming[0] if upcoming else None,
        },
        "compliance": {
            "average_score": avg_compliance_score,
            "total_assessments": len(assessment_rows),
            "open_gaps": int(open_gaps),
            "certification_blockers": int(cert_blockers),
        },
        "audit": {
            "audits_total": sum(audits_by_status.values()),
            "audits_by_status": audits_by_status,
            "open_findings": open_findings,
            "open_findings_by_severity": open_findings_by_severity,
        },
        "incidents": {
            "open": incidents_open,
            "open_by_severity": incidents_open_by_severity,
            "total": sum(int(n) for _s, _sev, n in incident_rows),
        },
        "vendors": {
            "total": sum(vendors_by_tier.values()),
            "by_risk_tier": vendors_by_tier,
        },
        "exceptions": {
            "total": sum(exceptions_by_status.values()),
            "by_status": exceptions_by_status,
            "active": exceptions_by_status.get("approved", 0),
        },
    }
