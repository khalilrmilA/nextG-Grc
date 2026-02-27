"""Dashboard and analytics endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus
from app.models.audit import Audit, AuditFinding, FindingStatus
from app.models.vendor import Vendor
from app.models.policy import Policy, PolicyAttestation, AttestationStatus
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
