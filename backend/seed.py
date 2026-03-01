"""
Seed script — populate the dev database with realistic demo data.
Run: python seed.py

Creates:
  - 1 tenant (Acme Corp)
  - 3 users  (admin, ciso, analyst)
  - 1 custom framework (ISO-lite: 8 controls)
  - 12 risks (various severities)
  - 2 compliance assessments (one scored, one fresh)
  - 4 audits + 10 findings
  - 6 policies
  - 5 vendors
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from app.core.database import engine, Base, AsyncSession
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.framework import (
    Framework, FrameworkControl, FrameworkStatus,
)
from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.compliance import (
    ComplianceAssessment, AssessmentStatus,
    ControlAssessment, ControlStatus,
)

# ── helpers ──────────────────────────────────────────────────────────────────

def uid() -> str:
    return str(uuid.uuid4())

def now() -> datetime:
    return datetime.now(timezone.utc)

def dago(days: int) -> datetime:
    return now() - timedelta(days=days)

# ── data definitions ─────────────────────────────────────────────────────────

TENANT_ID   = "97c606ea-2588-4915-94eb-b8ad25236d0f"  # reuse existing Acme Corp
ADMIN_ID    = "193fa797-6183-4431-83e2-da86923010e3"
CISO_ID     = "1e25d93b-a8a9-43bf-b3d1-65bbf2f0db21"
ANALYST_ID  = uid()

FRAMEWORK_ID = uid()

CONTROLS = [
    ("ISO-L-1.1", "Asset Inventory",         "IDENTIFY",       "Maintain inventory of all information assets"),
    ("ISO-L-1.2", "Data Classification",     "IDENTIFY",       "Classify data by sensitivity and criticality"),
    ("ISO-L-2.1", "Access Control Policy",   "PROTECT",        "Implement least-privilege access"),
    ("ISO-L-2.2", "Multi-Factor Auth",       "PROTECT",        "MFA for all privileged and remote access"),
    ("ISO-L-2.3", "Encryption at Rest",      "PROTECT",        "Encrypt sensitive data at rest (AES-256)"),
    ("ISO-L-3.1", "Security Monitoring",     "DETECT",         "Monitor systems for security events (SIEM)"),
    ("ISO-L-4.1", "Incident Response Plan",  "RESPOND",        "Documented and tested incident response plan"),
    ("ISO-L-5.1", "Backup & Recovery",       "RECOVER",        "Regular backups tested for restoration"),
]

RISKS_DATA = [
    # (title, category, likelihood, impact, status, tags)
    ("Unpatched production servers",         "Technical",          4, 5, "identified",            ["patch", "infrastructure"]),
    ("S3 bucket misconfiguration — PII",     "Access Control",     3, 5, "treatment_planned",     ["cloud", "data-protection"]),
    ("Lack of MFA on privileged accounts",   "Identity & Access",  3, 4, "treatment_in_progress", ["mfa", "iam"]),
    ("Missing DR / backup procedures",       "Business Continuity",2, 5, "identified",            ["backup", "resilience"]),
    ("Vendor without security assessment",   "Vendor Risk",        2, 4, "assessed",              ["vendor", "tprm"]),
    ("Security awareness training < 60%",    "People",             3, 3, "treatment_in_progress", ["training", "awareness"]),
    ("Outdated incident response plan",      "Incident Management",2, 3, "identified",            ["incident-response"]),
    ("SQL injection risk on legacy portal",  "Application",        3, 5, "treatment_planned",     ["appsec", "sqli"]),
    ("Weak password policy enforcement",     "Identity & Access",  4, 3, "identified",            ["passwords", "iam"]),
    ("No DLP tooling for email",             "Data Protection",    2, 4, "assessed",              ["dlp", "email"]),
    ("Insider threat — over-privileged devs","Access Control",     2, 4, "treatment_planned",     ["insider", "iam"]),
    ("Third-party API keys in source code",  "Technical",          3, 4, "identified",            ["secrets", "devops"]),
]

ASSESSMENT_1_ID = uid()  # scored assessment
ASSESSMENT_2_ID = uid()  # fresh draft

CONTROL_STATUSES_ASS1 = [
    ("ISO-L-1.1", ControlStatus.IMPLEMENTED,           0.94, None),
    ("ISO-L-1.2", ControlStatus.PARTIALLY_IMPLEMENTED, 0.71, "Classification schema exists but not enforced on all data stores"),
    ("ISO-L-2.1", ControlStatus.IMPLEMENTED,           0.89, None),
    ("ISO-L-2.2", ControlStatus.NOT_IMPLEMENTED,       0.82, "MFA not deployed for VPN and legacy apps"),
    ("ISO-L-2.3", ControlStatus.PARTIALLY_IMPLEMENTED, 0.65, "Encryption applied to DB tier but not file shares"),
    ("ISO-L-3.1", ControlStatus.IMPLEMENTED,           0.91, None),
    ("ISO-L-4.1", ControlStatus.PARTIALLY_IMPLEMENTED, 0.77, "IRP documented but last tabletop exercise >18 months ago"),
    ("ISO-L-5.1", ControlStatus.NOT_IMPLEMENTED,       0.88, "Backups exist but restoration tests not performed in 2025"),
]


async def clear_demo_data(db: AsyncSession) -> None:
    """Remove previous seed data (keep users & tenant)."""
    for tbl in [
        "control_requirements", "control_assessments", "compliance_gaps",
        "uploaded_documents", "compliance_assessments",
        "framework_controls", "frameworks",
        "risks",
    ]:
        await db.execute(text(f"DELETE FROM {tbl}"))
    await db.commit()
    print("  OK cleared previous demo data")


async def seed_framework(db: AsyncSession) -> dict[str, str]:
    """Create a custom ISO-lite framework with 8 controls. Returns control_id → db_id map."""
    fw = Framework(
        id=FRAMEWORK_ID,
        name="ISO 27001 Lite (Demo)",
        short_name="ISO-Lite",
        version="1.0",
        description="Simplified 8-control subset of ISO 27001:2022 for demonstration",
        issuing_body="Acme Corp (internal)",
        applicable_regions=["Global"],
        applicable_industries=["Technology", "Finance"],
        is_builtin=False,
        tenant_id=TENANT_ID,
        status=FrameworkStatus.ACTIVE,
    )
    db.add(fw)
    await db.flush()

    ctrl_map: dict[str, str] = {}
    for i, (ctrl_id, title, category, description) in enumerate(CONTROLS):
        ctrl = FrameworkControl(
            framework_id=FRAMEWORK_ID,
            control_id=ctrl_id,
            title=title,
            category=category,            # uppercase enum name
            description=description,
            sort_order=i,
            mapped_controls=[],
            tags=[],
        )
        db.add(ctrl)
        await db.flush()
        ctrl_map[ctrl_id] = ctrl.id

    print(f"  OK framework '{fw.name}' + {len(CONTROLS)} controls")
    return ctrl_map


async def seed_risks(db: AsyncSession) -> None:
    for title, category, likelihood, impact, status, tags in RISKS_DATA:
        score = likelihood * impact
        if score >= 20:   sev = RiskSeverity.CRITICAL
        elif score >= 12: sev = RiskSeverity.HIGH
        elif score >= 6:  sev = RiskSeverity.MEDIUM
        else:             sev = RiskSeverity.LOW

        risk = Risk(
            tenant_id=TENANT_ID,
            title=title,
            description=f"Risk identified during the 2025 annual risk assessment — {category} domain.",
            risk_category=category,
            status=RiskStatus(status),
            likelihood=float(likelihood),
            impact=float(impact),
            severity=sev,
            tags=tags,
            linked_controls=[],
            linked_assets=[],
        )
        db.add(risk)

    await db.flush()
    print(f"  OK {len(RISKS_DATA)} risks created")


async def seed_assessments(db: AsyncSession, ctrl_map: dict[str, str]) -> None:
    # ── Assessment 1: scored, in-progress ─────────────────────────────────
    ass1 = ComplianceAssessment(
        id=ASSESSMENT_1_ID,
        tenant_id=TENANT_ID,
        framework_id=FRAMEWORK_ID,
        name="2026 Q1 — ISO 27001 Lite Audit",
        description="First formal compliance assessment against our internal ISO-Lite standard",
        scope_description="All production IT systems, cloud workloads, and third-party integrations",
        status=AssessmentStatus.IN_PROGRESS,
        compliance_score=67.5,
        lead_assessor_id=CISO_ID,
    )
    db.add(ass1)
    await db.flush()

    # Add control assessments for assessment 1
    for ctrl_id_short, ctrl_status, confidence, gap_desc in CONTROL_STATUSES_ASS1:
        db_ctrl_id = ctrl_map.get(ctrl_id_short)
        if not db_ctrl_id:
            continue
        ca = ControlAssessment(
            assessment_id=ASSESSMENT_1_ID,
            control_id=db_ctrl_id,
            status=ctrl_status,
            ai_confidence=confidence,
            notes=gap_desc,
            implementation_notes=(
                "Verified via documentation review and technical testing." if ctrl_status == ControlStatus.IMPLEMENTED else None
            ),
        )
        db.add(ca)

    await db.flush()
    print(f"  OK assessment 1 (scored 67.5%) + {len(CONTROL_STATUSES_ASS1)} control assessments")

    # ── Assessment 2: fresh draft ──────────────────────────────────────────
    ass2 = ComplianceAssessment(
        id=ASSESSMENT_2_ID,
        tenant_id=TENANT_ID,
        framework_id=FRAMEWORK_ID,
        name="2026 Q2 — Pre-certification Review",
        description="Preparation assessment ahead of external ISO certification audit",
        scope_description="Corporate IT + Cloud (AWS/Azure) + HR systems",
        status=AssessmentStatus.DRAFT,
        lead_assessor_id=ADMIN_ID,
    )
    db.add(ass2)
    await db.flush()
    print("  OK assessment 2 (draft, no score yet)")


async def main() -> None:
    print("")
    print("=== GRC Platform - Seed Script ===")
    print("")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSession(engine) as db:
        print("Clearing old demo data ...")
        await clear_demo_data(db)

        print("\nSeeding framework ...")
        ctrl_map = await seed_framework(db)

        print("\nSeeding risks ...")
        await seed_risks(db)

        print("\nSeeding assessments ...")
        await seed_assessments(db, ctrl_map)

        await db.commit()

    await engine.dispose()

    print("")
    print("=== Done! ===")
    print("Login at http://localhost:3000")
    print("  admin@demo.com / demo123")
    print("  ciso@demo.com  / demo123")
    print("")


if __name__ == "__main__":
    asyncio.run(main())
