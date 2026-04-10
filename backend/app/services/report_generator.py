"""
Weekly PDF Report Generator — produces professional GRC reports in PDF format.

Generates 5 types of reports:
1. Executive Summary (overview of all modules)
2. Risk Report (risk register + heatmap)
3. Compliance Report (framework coverage + gaps)
4. Vendor Risk Report (all 3rd parties + scores)
5. Audit Report (findings + status)
"""
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, KeepTogether,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.vendor import Vendor, VendorContract, ContractValidationStatus
from app.models.compliance import ComplianceAssessment, ComplianceGap
from app.models.audit import Audit, AuditFinding
from app.models.tenant import Tenant


# ── Brand colors ──────────────────────────────────────────────────────────
BRAND_PRIMARY = colors.HexColor("#2563eb")  # blue-600
BRAND_SECONDARY = colors.HexColor("#1e40af")  # blue-800
BRAND_LIGHT = colors.HexColor("#eff6ff")  # blue-50
TEXT_PRIMARY = colors.HexColor("#111827")  # gray-900
TEXT_SECONDARY = colors.HexColor("#6b7280")  # gray-500
BORDER_COLOR = colors.HexColor("#e5e7eb")  # gray-200

SEVERITY_COLORS = {
    "critical": colors.HexColor("#dc2626"),  # red-600
    "high": colors.HexColor("#ea580c"),  # orange-600
    "medium": colors.HexColor("#ca8a04"),  # yellow-600
    "low": colors.HexColor("#16a34a"),  # green-600
}


def get_styles():
    """Custom stylesheet for PDF reports."""
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        name="ReportTitle",
        parent=styles["Title"],
        fontSize=22,
        textColor=BRAND_PRIMARY,
        spaceAfter=8,
        alignment=TA_LEFT,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="ReportSubtitle",
        parent=styles["Normal"],
        fontSize=11,
        textColor=TEXT_SECONDARY,
        spaceAfter=20,
        alignment=TA_LEFT,
    ))
    styles.add(ParagraphStyle(
        name="SectionHeader",
        parent=styles["Heading2"],
        fontSize=14,
        textColor=BRAND_SECONDARY,
        spaceBefore=18,
        spaceAfter=8,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="SubHeader",
        parent=styles["Heading3"],
        fontSize=12,
        textColor=TEXT_PRIMARY,
        spaceBefore=12,
        spaceAfter=6,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="BodyText2",
        parent=styles["Normal"],
        fontSize=10,
        textColor=TEXT_PRIMARY,
        leading=14,
        alignment=TA_JUSTIFY,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="Caption",
        parent=styles["Normal"],
        fontSize=8,
        textColor=TEXT_SECONDARY,
        alignment=TA_CENTER,
    ))
    return styles


def build_header(styles, tenant_name: str, report_title: str, period_start: str, period_end: str):
    """Build the header section of a report."""
    elements = []
    elements.append(Paragraph(f"<b>{tenant_name}</b>", styles["ReportSubtitle"]))
    elements.append(Paragraph(report_title, styles["ReportTitle"]))
    elements.append(Paragraph(
        f"Weekly Report · {period_start} to {period_end}<br/>Generated: {datetime.utcnow().strftime('%B %d, %Y %H:%M UTC')}",
        styles["ReportSubtitle"],
    ))
    # Blue line separator
    elements.append(Table(
        [[""]],
        colWidths=[6.5 * inch],
        rowHeights=[2],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), BRAND_PRIMARY),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]),
    ))
    elements.append(Spacer(1, 0.2 * inch))
    return elements


def build_kpi_row(kpis: list[dict]):
    """Build a row of KPI boxes."""
    data = []
    row = []
    for kpi in kpis:
        cell = [
            Paragraph(f"<font size='18' color='#2563eb'><b>{kpi['value']}</b></font>", getSampleStyleSheet()["Normal"]),
            Paragraph(f"<font size='9' color='#6b7280'>{kpi['label']}</font>", getSampleStyleSheet()["Normal"]),
        ]
        row.append(cell)
    data.append(row)

    col_width = 6.5 * inch / len(kpis)
    table = Table(data, colWidths=[col_width] * len(kpis))
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRAND_LIGHT),
        ("BOX", (0, 0), (-1, -1), 1, BORDER_COLOR),
        ("LINEBEFORE", (1, 0), (-1, -1), 1, BORDER_COLOR),
        ("PADDING", (0, 0), (-1, -1), 12),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return table


def build_data_table(headers: list[str], rows: list[list], col_widths=None):
    """Build a styled data table."""
    data = [headers] + rows
    if not col_widths:
        col_widths = [6.5 * inch / len(headers)] * len(headers)
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("PADDING", (0, 0), (-1, 0), 8),
        # Body
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("TEXTCOLOR", (0, 1), (-1, -1), TEXT_PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("PADDING", (0, 1), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
    ]))
    return table


# ── Report generators ────────────────────────────────────────────────────────

async def generate_executive_summary(db: AsyncSession, tenant_id: str, tenant_name: str) -> bytes:
    """Generate the weekly Executive Summary PDF."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.75 * inch, bottomMargin=0.75 * inch,
    )
    styles = get_styles()
    elements = []

    # Header
    week_start = (datetime.utcnow() - timedelta(days=7)).strftime("%b %d, %Y")
    week_end = datetime.utcnow().strftime("%b %d, %Y")
    elements.extend(build_header(styles, tenant_name, "Executive Summary", week_start, week_end))

    # Fetch KPI data
    risks_result = await db.execute(
        select(func.count(Risk.id)).where(Risk.tenant_id == tenant_id)
    )
    total_risks = risks_result.scalar() or 0

    critical_risks_result = await db.execute(
        select(func.count(Risk.id)).where(
            Risk.tenant_id == tenant_id,
            Risk.severity == RiskSeverity.CRITICAL,
        )
    )
    critical_risks = critical_risks_result.scalar() or 0

    vendors_result = await db.execute(
        select(func.count(Vendor.id)).where(Vendor.tenant_id == tenant_id)
    )
    total_vendors = vendors_result.scalar() or 0

    assessments_result = await db.execute(
        select(func.count(ComplianceAssessment.id)).where(
            ComplianceAssessment.tenant_id == tenant_id
        )
    )
    total_assessments = assessments_result.scalar() or 0

    # KPI Row
    elements.append(Paragraph("Key Performance Indicators", styles["SectionHeader"]))
    elements.append(build_kpi_row([
        {"value": str(total_risks), "label": "Total Risks"},
        {"value": str(critical_risks), "label": "Critical Risks"},
        {"value": str(total_vendors), "label": "3rd Parties"},
        {"value": str(total_assessments), "label": "Assessments"},
    ]))
    elements.append(Spacer(1, 0.2 * inch))

    # Risks Overview
    elements.append(Paragraph("Risk Overview", styles["SectionHeader"]))
    risks_by_status = await db.execute(
        select(Risk.status, func.count(Risk.id))
        .where(Risk.tenant_id == tenant_id)
        .group_by(Risk.status)
    )
    status_data = [(r[0].value if r[0] else "unknown", r[1]) for r in risks_by_status]

    if status_data:
        rows = [[status.replace("_", " ").title(), str(count)] for status, count in status_data]
        elements.append(build_data_table(["Status", "Count"], rows, col_widths=[4 * inch, 2.5 * inch]))
    else:
        elements.append(Paragraph("No risks registered yet.", styles["BodyText2"]))
    elements.append(Spacer(1, 0.15 * inch))

    # Compliance Overview
    elements.append(Paragraph("Compliance Overview", styles["SectionHeader"]))
    assessments_result = await db.execute(
        select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id).limit(5)
    )
    assessments = list(assessments_result.scalars().all())
    if assessments:
        rows = [
            [
                a.name[:40] if a.name else "Unnamed",
                (a.status.value if hasattr(a.status, 'value') else str(a.status)).replace("_", " ").title(),
                f"{a.compliance_score:.0f}%" if a.compliance_score is not None else "N/A",
            ]
            for a in assessments
        ]
        elements.append(build_data_table(
            ["Assessment", "Status", "Score"],
            rows,
            col_widths=[3.5 * inch, 1.5 * inch, 1.5 * inch],
        ))
    else:
        elements.append(Paragraph("No compliance assessments yet.", styles["BodyText2"]))
    elements.append(Spacer(1, 0.15 * inch))

    # Vendor Risk Summary
    elements.append(Paragraph("3rd Party Risk Summary", styles["SectionHeader"]))
    vendors_by_tier = await db.execute(
        select(Vendor.risk_tier, func.count(Vendor.id))
        .where(Vendor.tenant_id == tenant_id)
        .group_by(Vendor.risk_tier)
    )
    tier_data = [(r[0].value if hasattr(r[0], 'value') else str(r[0]), r[1]) for r in vendors_by_tier]
    if tier_data:
        rows = [[tier.title(), str(count)] for tier, count in tier_data]
        elements.append(build_data_table(["Risk Tier", "Count"], rows, col_widths=[4 * inch, 2.5 * inch]))
    else:
        elements.append(Paragraph("No vendors registered.", styles["BodyText2"]))

    # Footer
    elements.append(Spacer(1, 0.3 * inch))
    elements.append(Paragraph(
        "This report is auto-generated by the GRC Platform. For questions, contact your security team.",
        styles["Caption"],
    ))

    doc.build(elements)
    return buffer.getvalue()


async def generate_risk_report(db: AsyncSession, tenant_id: str, tenant_name: str) -> bytes:
    """Generate the weekly Risk Report PDF."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=0.75 * inch, rightMargin=0.75 * inch)
    styles = get_styles()
    elements = []

    week_start = (datetime.utcnow() - timedelta(days=7)).strftime("%b %d, %Y")
    week_end = datetime.utcnow().strftime("%b %d, %Y")
    elements.extend(build_header(styles, tenant_name, "Risk Register Report", week_start, week_end))

    # Summary stats
    risks_result = await db.execute(
        select(Risk).where(Risk.tenant_id == tenant_id).order_by(Risk.created_at.desc())
    )
    risks = list(risks_result.scalars().all())

    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in risks:
        if r.severity:
            sev = r.severity.value if hasattr(r.severity, 'value') else str(r.severity)
            if sev in severity_counts:
                severity_counts[sev] += 1

    elements.append(Paragraph("Risk Overview", styles["SectionHeader"]))
    elements.append(build_kpi_row([
        {"value": str(severity_counts["critical"]), "label": "Critical"},
        {"value": str(severity_counts["high"]), "label": "High"},
        {"value": str(severity_counts["medium"]), "label": "Medium"},
        {"value": str(severity_counts["low"]), "label": "Low"},
    ]))
    elements.append(Spacer(1, 0.2 * inch))

    # Top 10 risks by score
    elements.append(Paragraph("Top 10 Risks by Score", styles["SectionHeader"]))
    scored_risks = [r for r in risks if r.likelihood and r.impact]
    scored_risks.sort(key=lambda r: (r.likelihood or 0) * (r.impact or 0), reverse=True)
    top_risks = scored_risks[:10]

    if top_risks:
        rows = []
        for r in top_risks:
            score = (r.likelihood or 0) * (r.impact or 0)
            sev = (r.severity.value if hasattr(r.severity, 'value') else str(r.severity or "-")).title()
            status = (r.status.value if hasattr(r.status, 'value') else str(r.status or "-")).replace("_", " ").title()
            rows.append([
                r.title[:45] + ("..." if len(r.title) > 45 else ""),
                r.risk_category[:20] if r.risk_category else "-",
                f"{score:.1f}",
                sev,
                status,
            ])
        elements.append(build_data_table(
            ["Title", "Category", "Score", "Severity", "Status"],
            rows,
            col_widths=[2.5 * inch, 1.3 * inch, 0.7 * inch, 0.9 * inch, 1.1 * inch],
        ))
    else:
        elements.append(Paragraph("No scored risks available.", styles["BodyText2"]))

    elements.append(Spacer(1, 0.2 * inch))

    # Overdue reviews
    elements.append(Paragraph("Risks Needing Review", styles["SectionHeader"]))
    today = datetime.utcnow().date()
    overdue_risks = []
    for r in risks:
        if not r.next_review_date:
            continue
        try:
            review_date = datetime.fromisoformat(r.next_review_date).date()
            days = (review_date - today).days
            if days <= 14:
                overdue_risks.append((r, days))
        except (ValueError, TypeError):
            continue

    if overdue_risks:
        overdue_risks.sort(key=lambda x: x[1])
        rows = []
        for r, days in overdue_risks[:15]:
            status_label = "OVERDUE" if days < 0 else ("DUE TODAY" if days == 0 else f"{days} days")
            rows.append([
                r.title[:50] + ("..." if len(r.title) > 50 else ""),
                r.next_review_date or "-",
                status_label,
            ])
        elements.append(build_data_table(
            ["Risk", "Review Date", "Status"],
            rows,
            col_widths=[3.5 * inch, 1.5 * inch, 1.5 * inch],
        ))
    else:
        elements.append(Paragraph("No risks due for review in the next 14 days.", styles["BodyText2"]))

    doc.build(elements)
    return buffer.getvalue()


async def generate_vendor_report(db: AsyncSession, tenant_id: str, tenant_name: str) -> bytes:
    """Generate the weekly Vendor Risk Report PDF."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=0.75 * inch, rightMargin=0.75 * inch)
    styles = get_styles()
    elements = []

    week_start = (datetime.utcnow() - timedelta(days=7)).strftime("%b %d, %Y")
    week_end = datetime.utcnow().strftime("%b %d, %Y")
    elements.extend(build_header(styles, tenant_name, "3rd Party Risk Report", week_start, week_end))

    # Fetch vendors
    result = await db.execute(
        select(Vendor).where(Vendor.tenant_id == tenant_id).order_by(Vendor.risk_score.desc().nulls_last())
    )
    vendors = list(result.scalars().all())

    tier_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    dpa_missing = 0
    for v in vendors:
        tier = v.risk_tier.value if hasattr(v.risk_tier, 'value') else str(v.risk_tier)
        if tier in tier_counts:
            tier_counts[tier] += 1
        if not v.has_data_processing_agreement:
            dpa_missing += 1

    # KPIs
    elements.append(Paragraph("3rd Party Overview", styles["SectionHeader"]))
    elements.append(build_kpi_row([
        {"value": str(len(vendors)), "label": "Total 3rd Parties"},
        {"value": str(tier_counts["critical"] + tier_counts["high"]), "label": "High Risk"},
        {"value": str(dpa_missing), "label": "Missing DPA"},
        {"value": str(tier_counts["critical"]), "label": "Critical Tier"},
    ]))
    elements.append(Spacer(1, 0.2 * inch))

    # Top risky vendors
    elements.append(Paragraph("Top 10 Vendors by Risk Score", styles["SectionHeader"]))
    top_vendors = [v for v in vendors if v.risk_score is not None][:10]
    if top_vendors:
        rows = []
        for v in top_vendors:
            tier = (v.risk_tier.value if hasattr(v.risk_tier, 'value') else str(v.risk_tier)).title()
            status = (v.status.value if hasattr(v.status, 'value') else str(v.status)).replace("_", " ").title()
            dpa = "✓" if v.has_data_processing_agreement else "✗"
            rows.append([
                v.name[:30] + ("..." if len(v.name) > 30 else ""),
                v.industry[:20] if v.industry else "-",
                tier,
                f"{v.risk_score:.1f}" if v.risk_score else "-",
                dpa,
                status,
            ])
        elements.append(build_data_table(
            ["Name", "Industry", "Tier", "Score", "DPA", "Status"],
            rows,
            col_widths=[1.8 * inch, 1.4 * inch, 0.8 * inch, 0.7 * inch, 0.5 * inch, 1.3 * inch],
        ))
    else:
        elements.append(Paragraph("No vendors with risk scores.", styles["BodyText2"]))

    elements.append(Spacer(1, 0.2 * inch))

    # Contracts pending review
    elements.append(Paragraph("Contracts Pending CISO Review", styles["SectionHeader"]))
    contracts_result = await db.execute(
        select(VendorContract)
        .join(Vendor, VendorContract.vendor_id == Vendor.id)
        .where(
            Vendor.tenant_id == tenant_id,
            VendorContract.validation_status.in_([
                ContractValidationStatus.AI_REVIEWED.value,
                ContractValidationStatus.PENDING_CISO.value,
            ])
        )
    )
    pending_contracts = list(contracts_result.scalars().all())
    if pending_contracts:
        rows = []
        for c in pending_contracts[:10]:
            # Get vendor name
            v_result = await db.execute(select(Vendor).where(Vendor.id == c.vendor_id))
            v = v_result.scalar_one_or_none()
            v_name = v.name if v else "Unknown"
            rows.append([
                v_name[:30],
                c.file_name[:30],
                f"v{c.version}",
                c.created_at.strftime("%Y-%m-%d") if c.created_at else "-",
            ])
        elements.append(build_data_table(
            ["Vendor", "File", "Version", "Uploaded"],
            rows,
            col_widths=[2 * inch, 2.5 * inch, 0.8 * inch, 1.2 * inch],
        ))
    else:
        elements.append(Paragraph("No contracts pending review.", styles["BodyText2"]))

    # Missing DPA alert
    if dpa_missing > 0:
        elements.append(Spacer(1, 0.2 * inch))
        elements.append(Paragraph("Compliance Alert: Missing DPAs", styles["SectionHeader"]))
        missing_dpa_vendors = [v for v in vendors if not v.has_data_processing_agreement][:10]
        rows = [[v.name[:40], v.industry[:25] if v.industry else "-"] for v in missing_dpa_vendors]
        elements.append(build_data_table(
            ["Vendor", "Industry"],
            rows,
            col_widths=[3.5 * inch, 3 * inch],
        ))

    doc.build(elements)
    return buffer.getvalue()


async def generate_compliance_report(db: AsyncSession, tenant_id: str, tenant_name: str) -> bytes:
    """Generate the weekly Compliance Report PDF."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=0.75 * inch, rightMargin=0.75 * inch)
    styles = get_styles()
    elements = []

    week_start = (datetime.utcnow() - timedelta(days=7)).strftime("%b %d, %Y")
    week_end = datetime.utcnow().strftime("%b %d, %Y")
    elements.extend(build_header(styles, tenant_name, "Compliance Status Report", week_start, week_end))

    # Assessments
    result = await db.execute(
        select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id)
    )
    assessments = list(result.scalars().all())

    avg_score = 0
    if assessments:
        scores = [a.compliance_score for a in assessments if a.compliance_score is not None]
        avg_score = sum(scores) / len(scores) if scores else 0

    # Gaps
    gaps_result = await db.execute(
        select(ComplianceGap)
        .join(ComplianceAssessment, ComplianceGap.assessment_id == ComplianceAssessment.id)
        .where(ComplianceAssessment.tenant_id == tenant_id)
    )
    gaps = list(gaps_result.scalars().all())
    critical_gaps = len([g for g in gaps if g.severity == "critical"])
    high_gaps = len([g for g in gaps if g.severity == "high"])

    # KPIs
    elements.append(Paragraph("Compliance Overview", styles["SectionHeader"]))
    elements.append(build_kpi_row([
        {"value": str(len(assessments)), "label": "Assessments"},
        {"value": f"{avg_score:.0f}%", "label": "Avg Score"},
        {"value": str(critical_gaps), "label": "Critical Gaps"},
        {"value": str(high_gaps), "label": "High Gaps"},
    ]))
    elements.append(Spacer(1, 0.2 * inch))

    # Assessment status
    elements.append(Paragraph("Assessment Status", styles["SectionHeader"]))
    if assessments:
        rows = []
        for a in assessments[:15]:
            status = (a.status.value if hasattr(a.status, 'value') else str(a.status)).replace("_", " ").title()
            score = f"{a.compliance_score:.0f}%" if a.compliance_score is not None else "N/A"
            rows.append([
                (a.name or "Unnamed")[:40],
                status,
                score,
                a.created_at.strftime("%Y-%m-%d") if a.created_at else "-",
            ])
        elements.append(build_data_table(
            ["Assessment", "Status", "Score", "Created"],
            rows,
            col_widths=[2.8 * inch, 1.5 * inch, 1 * inch, 1.2 * inch],
        ))
    else:
        elements.append(Paragraph("No compliance assessments yet.", styles["BodyText2"]))

    elements.append(Spacer(1, 0.2 * inch))

    # Top gaps
    elements.append(Paragraph("Top Compliance Gaps", styles["SectionHeader"]))
    critical_high_gaps = [g for g in gaps if g.severity in ["critical", "high"]]
    critical_high_gaps.sort(key=lambda g: 0 if g.severity == "critical" else 1)
    if critical_high_gaps:
        rows = []
        for g in critical_high_gaps[:15]:
            rows.append([
                g.control_id[:20] if g.control_id else "-",
                g.severity.title() if g.severity else "-",
                (g.gap_description or "-")[:80] + ("..." if g.gap_description and len(g.gap_description) > 80 else ""),
            ])
        elements.append(build_data_table(
            ["Control", "Severity", "Description"],
            rows,
            col_widths=[1.2 * inch, 1 * inch, 4.3 * inch],
        ))
    else:
        elements.append(Paragraph("No critical or high severity gaps identified.", styles["BodyText2"]))

    doc.build(elements)
    return buffer.getvalue()


async def generate_audit_report(db: AsyncSession, tenant_id: str, tenant_name: str) -> bytes:
    """Generate the weekly Audit Report PDF."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=0.75 * inch, rightMargin=0.75 * inch)
    styles = get_styles()
    elements = []

    week_start = (datetime.utcnow() - timedelta(days=7)).strftime("%b %d, %Y")
    week_end = datetime.utcnow().strftime("%b %d, %Y")
    elements.extend(build_header(styles, tenant_name, "Audit Status Report", week_start, week_end))

    # Fetch audits
    audits_result = await db.execute(
        select(Audit).where(Audit.tenant_id == tenant_id)
    )
    audits = list(audits_result.scalars().all())

    # Fetch findings
    findings_result = await db.execute(
        select(AuditFinding)
        .join(Audit, AuditFinding.audit_id == Audit.id)
        .where(Audit.tenant_id == tenant_id)
    )
    findings = list(findings_result.scalars().all())

    # KPIs
    critical_findings = len([f for f in findings if f.severity == "critical"])
    high_findings = len([f for f in findings if f.severity == "high"])
    open_findings = len([f for f in findings if f.status == "open"])

    elements.append(Paragraph("Audit Overview", styles["SectionHeader"]))
    elements.append(build_kpi_row([
        {"value": str(len(audits)), "label": "Total Audits"},
        {"value": str(len(findings)), "label": "Findings"},
        {"value": str(critical_findings + high_findings), "label": "High/Critical"},
        {"value": str(open_findings), "label": "Open"},
    ]))
    elements.append(Spacer(1, 0.2 * inch))

    # Active audits
    elements.append(Paragraph("Active Audits", styles["SectionHeader"]))
    if audits:
        rows = []
        for a in audits[:10]:
            audit_name = getattr(a, 'name', None) or getattr(a, 'title', None) or "Audit"
            rows.append([
                audit_name[:40],
                (getattr(a, 'audit_type', None) or "-")[:15],
                (str(getattr(a, 'status', '-'))).replace("_", " ").title()[:15],
                a.created_at.strftime("%Y-%m-%d") if a.created_at else "-",
            ])
        elements.append(build_data_table(
            ["Audit", "Type", "Status", "Started"],
            rows,
            col_widths=[2.8 * inch, 1.2 * inch, 1.3 * inch, 1.2 * inch],
        ))
    else:
        elements.append(Paragraph("No active audits.", styles["BodyText2"]))

    elements.append(Spacer(1, 0.2 * inch))

    # Top findings
    elements.append(Paragraph("Critical & High Findings", styles["SectionHeader"]))
    top_findings = [f for f in findings if f.severity in ["critical", "high"]]
    if top_findings:
        rows = []
        for f in top_findings[:15]:
            title = getattr(f, 'title', None) or getattr(f, 'description', '') or "-"
            rows.append([
                title[:50],
                (f.severity or "-").title(),
                (str(getattr(f, 'status', '-'))).replace("_", " ").title(),
            ])
        elements.append(build_data_table(
            ["Finding", "Severity", "Status"],
            rows,
            col_widths=[4 * inch, 1 * inch, 1.5 * inch],
        ))
    else:
        elements.append(Paragraph("No critical or high severity findings.", styles["BodyText2"]))

    doc.build(elements)
    return buffer.getvalue()


# ── Report dispatcher ────────────────────────────────────────────────────────

REPORT_GENERATORS = {
    "executive": generate_executive_summary,
    "risk": generate_risk_report,
    "vendor": generate_vendor_report,
    "compliance": generate_compliance_report,
    "audit": generate_audit_report,
}


async def generate_report(
    report_type: str,
    db: AsyncSession,
    tenant_id: str,
    tenant_name: str = "Organization",
) -> bytes:
    """Main dispatcher — generate a report of the specified type."""
    generator = REPORT_GENERATORS.get(report_type)
    if not generator:
        raise ValueError(f"Unknown report type: {report_type}. Valid: {list(REPORT_GENERATORS.keys())}")
    return await generator(db, tenant_id, tenant_name)
