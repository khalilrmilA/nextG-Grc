"""Dashboard and analytics endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Annotated

from app.core.database import get_db
from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus, ComplianceGap, UploadedDocument
from app.models.audit import Audit, AuditFinding, FindingStatus
from app.models.vendor import Vendor
from app.models.policy import Policy, PolicyAttestation, AttestationStatus
from app.models.framework import Framework, FrameworkControl
from app.models.mandatory_document import MandatoryDocument
from app.models.tenant import Tenant
from app.api.v1.dependencies import get_current_user, get_tenant_id
from app.models.user import User

router = APIRouter()


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

        # Most recent assessment for this framework
        a_result = await db.execute(
            select(ComplianceAssessment)
            .where(ComplianceAssessment.tenant_id == tenant_id, ComplianceAssessment.framework_id == fw_id)
            .order_by(ComplianceAssessment.updated_at.desc())
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
                "status": assessment.status.value if assessment else "draft",
            })
            continue

        cas = (await db.execute(
            select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
        )).scalars().all()

        total = len(cas)
        implemented = sum(1 for c in cas if c.status == ControlStatus.IMPLEMENTED)
        partial = sum(1 for c in cas if c.status == ControlStatus.PARTIALLY_IMPLEMENTED)
        compliance_score = round((implemented + partial * 0.5) / total * 100, 1) if total else 0.0

        gaps_result = await db.execute(
            select(ComplianceGap).where(
                ComplianceGap.assessment_id == assessment.id,
                ComplianceGap.recommendation_status != "accepted",
            )
        )
        open_gaps = len(gaps_result.scalars().all())

        blockers_result = await db.execute(
            select(ComplianceGap).where(
                ComplianceGap.assessment_id == assessment.id,
                ComplianceGap.is_certification_blocker == True,  # noqa: E712
                ComplianceGap.recommendation_status != "accepted",
            )
        )
        open_blockers = len(blockers_result.scalars().all())

        docs_uploaded = (await db.execute(
            select(func.count(UploadedDocument.id))
            .where(UploadedDocument.assessment_id == assessment.id)
        )).scalar_one() or 0
        docs_required = (await db.execute(
            select(func.count(MandatoryDocument.id))
            .where(MandatoryDocument.framework_short_name == fw.short_name, MandatoryDocument.is_mandatory == True)  # noqa: E712
        )).scalar_one() or 0

        total_blockers_result = await db.execute(
            select(ComplianceGap).where(
                ComplianceGap.assessment_id == assessment.id,
                ComplianceGap.is_certification_blocker == True,  # noqa: E712
            )
        )
        total_blockers = len(total_blockers_result.scalars().all())
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

    fw_result = await db.execute(select(Framework).where(Framework.id == target_fw_id))
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
