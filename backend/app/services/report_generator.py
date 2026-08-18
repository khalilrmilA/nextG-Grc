"""
Weekly PDF Report Generator — professional GRC reports.
Clean, corporate design inspired by Big 4 audit reports.
"""
from datetime import datetime, timedelta
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.vendor import Vendor, VendorContract, ContractValidationStatus
from app.models.compliance import ComplianceAssessment, ComplianceGap
from app.models.audit import Audit, AuditFinding
from app.models.tenant import Tenant


# ── Colors ────────────────────────────────────────────────────────────────
NAVY = colors.HexColor("#1a2332")
DARK_BLUE = colors.HexColor("#1e3a5f")
ACCENT = colors.HexColor("#2563eb")
GRAY_900 = colors.HexColor("#111827")
GRAY_700 = colors.HexColor("#374151")
GRAY_500 = colors.HexColor("#6b7280")
GRAY_300 = colors.HexColor("#d1d5db")
GRAY_100 = colors.HexColor("#f3f4f6")
WHITE = colors.white
GREEN = colors.HexColor("#059669")
RED = colors.HexColor("#dc2626")
ORANGE = colors.HexColor("#d97706")

PAGE_W = A4[0] - 1.2 * inch  # usable width


def _styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=18, textColor=NAVY, spaceAfter=4, leading=22))
    s.add(ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=12, textColor=DARK_BLUE, spaceBefore=16, spaceAfter=6, leading=15))
    s.add(ParagraphStyle("H3", fontName="Helvetica-Bold", fontSize=10, textColor=GRAY_900, spaceBefore=10, spaceAfter=4))
    s.add(ParagraphStyle("Body", fontName="Helvetica", fontSize=9, textColor=GRAY_700, leading=13, spaceAfter=4))
    s.add(ParagraphStyle("Small", fontName="Helvetica", fontSize=7.5, textColor=GRAY_500, leading=10))
    s.add(ParagraphStyle("Footer", fontName="Helvetica", fontSize=7, textColor=GRAY_500, alignment=TA_CENTER))
    s.add(ParagraphStyle("KPIValue", fontName="Helvetica-Bold", fontSize=14, textColor=NAVY, alignment=TA_CENTER, leading=18))
    s.add(ParagraphStyle("KPILabel", fontName="Helvetica", fontSize=7, textColor=GRAY_500, alignment=TA_CENTER, leading=10))
    s.add(ParagraphStyle("MetaRight", fontName="Helvetica", fontSize=8, textColor=GRAY_500, alignment=TA_RIGHT, leading=11))
    return s


# ── Reusable Components ───────────────────────────────────────────────────

def _header(st, org: str, title: str, start: str, end: str):
    """Professional header with org name, title, and date range."""
    els = []
    # Top line
    els.append(HRFlowable(width="100%", thickness=2, color=NAVY, spaceAfter=8))
    # Two-column header: left = org + title, right = meta
    left = Paragraph(
        f"<font size='8' color='#6b7280'>{org.upper()}</font><br/>"
        f"<font size='16' color='#1a2332'><b>{title}</b></font>",
        st["Normal"],
    )
    right = Paragraph(
        f"<font size='8' color='#6b7280'>Report Period</font><br/>"
        f"<font size='9' color='#111827'><b>{start} — {end}</b></font><br/>"
        f"<font size='7' color='#9ca3af'>Generated {datetime.utcnow().strftime('%d %b %Y, %H:%M UTC')}</font>",
        st["MetaRight"],
    )
    t = Table([[left, right]], colWidths=[PAGE_W * 0.65, PAGE_W * 0.35])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    els.append(t)
    els.append(Spacer(1, 4))
    els.append(HRFlowable(width="100%", thickness=0.5, color=GRAY_300, spaceAfter=14))
    return els


def _kpi_bar(kpis: list[dict]):
    """Compact KPI bar — value over label, separated by thin lines."""
    n = len(kpis)
    if n == 0:
        return Spacer(1, 1)

    vals = []
    labs = []
    for kpi in kpis:
        vals.append(Paragraph(f"<b>{kpi['value']}</b>", ParagraphStyle("_kv", fontName="Helvetica-Bold", fontSize=16, textColor=NAVY, alignment=TA_CENTER)))
        labs.append(Paragraph(kpi["label"], ParagraphStyle("_kl", fontName="Helvetica", fontSize=7, textColor=GRAY_500, alignment=TA_CENTER)))

    cw = PAGE_W / n
    t = Table([vals, labs], colWidths=[cw] * n, rowHeights=[24, 12])
    style_cmds = [
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
        ("VALIGN", (0, 1), (-1, 1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, GRAY_300),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, GRAY_300),
    ]
    # Vertical dividers between cells
    for i in range(1, n):
        style_cmds.append(("LINEBEFORE", (i, 0), (i, -1), 0.5, GRAY_300))
    t.setStyle(TableStyle(style_cmds))
    return t


def _table(headers: list[str], rows: list[list], widths=None):
    """Clean data table with subtle styling."""
    if not rows:
        return Paragraph("<i>No data available.</i>", ParagraphStyle("_nd", fontName="Helvetica-Oblique", fontSize=9, textColor=GRAY_500))

    data = [headers] + rows
    if not widths:
        widths = [PAGE_W / len(headers)] * len(headers)

    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("LEFTPADDING", (0, 0), (-1, 0), 8),
        # Body
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("TEXTCOLOR", (0, 1), (-1, -1), GRAY_700),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("LEFTPADDING", (0, 1), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, GRAY_100]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, GRAY_300),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _status_dot(status_text: str) -> str:
    """Return a colored bullet + status text for use in Paragraph."""
    c = "#059669" if status_text.lower() in ("active", "in progress", "completed", "implemented") else \
        "#d97706" if status_text.lower() in ("draft", "pending", "onboarding") else \
        "#dc2626" if status_text.lower() in ("overdue", "critical", "rejected") else "#6b7280"
    return f"<font color='{c}'>&bull;</font> {status_text}"


def _footer():
    """Confidentiality footer."""
    return Paragraph(
        "CONFIDENTIAL — This report is auto-generated by the GRC Platform. "
        "Distribution is restricted to authorized personnel only.",
        ParagraphStyle("_ft", fontName="Helvetica", fontSize=6.5, textColor=GRAY_500, alignment=TA_CENTER, spaceBefore=20),
    )


def _section(st, title: str):
    return Paragraph(title, st["H2"])


# ── Report Generators ─────────────────────────────────────────────────────

async def generate_executive_summary(db: AsyncSession, tenant_id: str, org: str) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    st = _styles()
    els = []
    ws = (datetime.utcnow() - timedelta(days=7)).strftime("%d %b %Y")
    we = datetime.utcnow().strftime("%d %b %Y")
    els.extend(_header(st, org, "Executive Summary", ws, we))

    # KPIs
    total_risks = (await db.execute(select(func.count(Risk.id)).where(Risk.tenant_id == tenant_id))).scalar() or 0
    critical_risks = (await db.execute(select(func.count(Risk.id)).where(Risk.tenant_id == tenant_id, Risk.severity == RiskSeverity.CRITICAL))).scalar() or 0
    total_vendors = (await db.execute(select(func.count(Vendor.id)).where(Vendor.tenant_id == tenant_id))).scalar() or 0
    total_assess = (await db.execute(select(func.count(ComplianceAssessment.id)).where(ComplianceAssessment.tenant_id == tenant_id))).scalar() or 0

    els.append(_kpi_bar([
        {"value": total_risks, "label": "Total Risks"},
        {"value": critical_risks, "label": "Critical Risks"},
        {"value": total_vendors, "label": "3rd Parties"},
        {"value": total_assess, "label": "Assessments"},
    ]))

    # Risk by status
    els.append(_section(st, "Risk Overview"))
    r = await db.execute(select(Risk.status, func.count(Risk.id)).where(Risk.tenant_id == tenant_id).group_by(Risk.status))
    rows = [[s[0].value.replace("_", " ").title(), str(s[1])] for s in r]
    els.append(_table(["Status", "Count"], rows, [PAGE_W * 0.65, PAGE_W * 0.35]))

    # Compliance
    els.append(_section(st, "Compliance Overview"))
    assessments = list((await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id).limit(10))).scalars().all())
    rows = []
    for a in assessments:
        s_val = a.status.value if hasattr(a.status, "value") else str(a.status)
        score = f"{a.compliance_score:.0f}%" if a.compliance_score is not None else "—"
        rows.append([a.name[:50] if a.name else "Unnamed", s_val.replace("_", " ").title(), score])
    els.append(_table(["Assessment", "Status", "Score"], rows, [PAGE_W * 0.55, PAGE_W * 0.25, PAGE_W * 0.20]))

    # Vendors
    els.append(_section(st, "3rd Party Risk Summary"))
    vr = await db.execute(select(Vendor.risk_tier, func.count(Vendor.id)).where(Vendor.tenant_id == tenant_id).group_by(Vendor.risk_tier))
    rows = [[(t[0].value if hasattr(t[0], "value") else str(t[0])).title(), str(t[1])] for t in vr]
    els.append(_table(["Risk Tier", "Count"], rows, [PAGE_W * 0.65, PAGE_W * 0.35]))

    els.append(_footer())
    doc.build(els)
    return buf.getvalue()


async def generate_risk_report(db: AsyncSession, tenant_id: str, org: str) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    st = _styles()
    els = []
    ws = (datetime.utcnow() - timedelta(days=7)).strftime("%d %b %Y")
    we = datetime.utcnow().strftime("%d %b %Y")
    els.extend(_header(st, org, "Risk Register Report", ws, we))

    risks = list((await db.execute(select(Risk).where(Risk.tenant_id == tenant_id).order_by(Risk.created_at.desc()))).scalars().all())
    sev = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in risks:
        if r.severity:
            k = r.severity.value if hasattr(r.severity, "value") else str(r.severity)
            if k in sev:
                sev[k] += 1

    els.append(_kpi_bar([
        {"value": sev["critical"], "label": "Critical"},
        {"value": sev["high"], "label": "High"},
        {"value": sev["medium"], "label": "Medium"},
        {"value": sev["low"], "label": "Low"},
    ]))

    els.append(_section(st, "Top Risks by Inherent Score"))
    scored = sorted([r for r in risks if r.likelihood and r.impact], key=lambda r: (r.likelihood or 0) * (r.impact or 0), reverse=True)[:10]
    rows = []
    for r in scored:
        score = (r.likelihood or 0) * (r.impact or 0)
        sev_v = (r.severity.value if hasattr(r.severity, "value") else str(r.severity or "—")).title()
        st_v = (r.status.value if hasattr(r.status, "value") else str(r.status or "—")).replace("_", " ").title()
        rows.append([r.title[:50], r.risk_category[:20] if r.risk_category else "—", f"{score:.1f}", sev_v, st_v])
    els.append(_table(
        ["Title", "Category", "Score", "Severity", "Status"],
        rows,
        [PAGE_W * 0.32, PAGE_W * 0.18, PAGE_W * 0.12, PAGE_W * 0.16, PAGE_W * 0.22],
    ))

    # Overdue reviews
    els.append(_section(st, "Upcoming & Overdue Reviews"))
    today = datetime.utcnow().date()
    overdue = []
    for r in risks:
        if not r.next_review_date:
            continue
        try:
            d = datetime.fromisoformat(r.next_review_date).date()
            days = (d - today).days
            if days <= 14:
                label = f"OVERDUE ({abs(days)}d)" if days < 0 else (f"TODAY" if days == 0 else f"In {days} days")
                overdue.append([r.title[:50], r.next_review_date, label])
        except (ValueError, TypeError):
            continue
    els.append(_table(["Risk", "Review Date", "Status"], overdue, [PAGE_W * 0.50, PAGE_W * 0.25, PAGE_W * 0.25]))

    els.append(_footer())
    doc.build(els)
    return buf.getvalue()


async def generate_vendor_report(db: AsyncSession, tenant_id: str, org: str) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    st = _styles()
    els = []
    ws = (datetime.utcnow() - timedelta(days=7)).strftime("%d %b %Y")
    we = datetime.utcnow().strftime("%d %b %Y")
    els.extend(_header(st, org, "3rd Party Risk Report", ws, we))

    vendors = list((await db.execute(select(Vendor).where(Vendor.tenant_id == tenant_id).order_by(Vendor.risk_score.desc().nulls_last()))).scalars().all())
    tiers = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    no_dpa = 0
    for v in vendors:
        tier = v.risk_tier.value if hasattr(v.risk_tier, "value") else str(v.risk_tier)
        if tier in tiers:
            tiers[tier] += 1
        if not v.has_data_processing_agreement:
            no_dpa += 1

    els.append(_kpi_bar([
        {"value": len(vendors), "label": "Total Vendors"},
        {"value": tiers["critical"] + tiers["high"], "label": "High / Critical"},
        {"value": no_dpa, "label": "Missing DPA"},
    ]))

    els.append(_section(st, "Vendor Risk Register"))
    rows = []
    for v in vendors[:15]:
        tier = (v.risk_tier.value if hasattr(v.risk_tier, "value") else str(v.risk_tier)).title()
        status = (v.status.value if hasattr(v.status, "value") else str(v.status)).replace("_", " ").title()
        score = f"{v.risk_score:.0f}" if v.risk_score else "—"
        dpa = "Yes" if v.has_data_processing_agreement else "No"
        rows.append([v.name[:30], v.industry[:20] if v.industry else "—", tier, score, dpa, status])
    els.append(_table(
        ["Vendor", "Industry", "Tier", "Score", "DPA", "Status"],
        rows,
        [PAGE_W * 0.22, PAGE_W * 0.20, PAGE_W * 0.12, PAGE_W * 0.10, PAGE_W * 0.10, PAGE_W * 0.16],
    ))

    # Pending contracts
    els.append(_section(st, "Contracts Pending Review"))
    contracts = list((await db.execute(
        select(VendorContract).join(Vendor).where(
            Vendor.tenant_id == tenant_id,
            VendorContract.validation_status.in_([ContractValidationStatus.AI_REVIEWED.value, ContractValidationStatus.PENDING_CISO.value]),
        )
    )).scalars().all())
    rows = []
    for c in contracts[:10]:
        vr = (await db.execute(select(Vendor).where(Vendor.id == c.vendor_id))).scalar_one_or_none()
        rows.append([(vr.name if vr else "—")[:30], c.file_name[:30], f"v{c.version}", c.created_at.strftime("%Y-%m-%d") if c.created_at else "—"])
    els.append(_table(["Vendor", "Contract", "Ver.", "Uploaded"], rows, [PAGE_W * 0.25, PAGE_W * 0.35, PAGE_W * 0.10, PAGE_W * 0.20]))

    # Missing DPA
    if no_dpa > 0:
        els.append(_section(st, "Vendors Missing Data Processing Agreement"))
        rows = [[v.name[:40], v.industry[:25] if v.industry else "—"] for v in vendors if not v.has_data_processing_agreement][:10]
        els.append(_table(["Vendor", "Industry"], rows, [PAGE_W * 0.55, PAGE_W * 0.45]))

    els.append(_footer())
    doc.build(els)
    return buf.getvalue()


async def generate_compliance_report(db: AsyncSession, tenant_id: str, org: str) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    st = _styles()
    els = []
    ws = (datetime.utcnow() - timedelta(days=7)).strftime("%d %b %Y")
    we = datetime.utcnow().strftime("%d %b %Y")
    els.extend(_header(st, org, "Compliance Status Report", ws, we))

    assessments = list((await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id))).scalars().all())
    scores = [a.compliance_score for a in assessments if a.compliance_score is not None]
    avg = f"{sum(scores) / len(scores):.0f}%" if scores else "—"

    gaps = list((await db.execute(select(ComplianceGap).join(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id))).scalars().all())
    crit_gaps = len([g for g in gaps if g.severity == "critical"])
    high_gaps = len([g for g in gaps if g.severity == "high"])

    els.append(_kpi_bar([
        {"value": len(assessments), "label": "Assessments"},
        {"value": avg, "label": "Avg. Score"},
        {"value": crit_gaps, "label": "Critical Gaps"},
        {"value": high_gaps, "label": "High Gaps"},
    ]))

    els.append(_section(st, "Assessment Status"))
    rows = []
    for a in assessments[:15]:
        s_val = (a.status.value if hasattr(a.status, "value") else str(a.status)).replace("_", " ").title()
        score = f"{a.compliance_score:.0f}%" if a.compliance_score is not None else "—"
        rows.append([a.name[:45] if a.name else "Unnamed", s_val, score, a.created_at.strftime("%Y-%m-%d") if a.created_at else "—"])
    els.append(_table(["Assessment", "Status", "Score", "Created"], rows, [PAGE_W * 0.42, PAGE_W * 0.20, PAGE_W * 0.15, PAGE_W * 0.18]))

    els.append(_section(st, "Critical & High Gaps"))
    gap_rows = []
    for g in sorted([g for g in gaps if g.severity in ("critical", "high")], key=lambda g: 0 if g.severity == "critical" else 1)[:15]:
        gap_rows.append([g.control_id[:15] if g.control_id else "—", g.severity.title(), (g.gap_description or "—")[:80]])
    els.append(_table(["Control", "Severity", "Description"], gap_rows, [PAGE_W * 0.15, PAGE_W * 0.15, PAGE_W * 0.65]))

    els.append(_footer())
    doc.build(els)
    return buf.getvalue()


async def generate_audit_report(db: AsyncSession, tenant_id: str, org: str) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    st = _styles()
    els = []
    ws = (datetime.utcnow() - timedelta(days=7)).strftime("%d %b %Y")
    we = datetime.utcnow().strftime("%d %b %Y")
    els.extend(_header(st, org, "Audit Status Report", ws, we))

    audits = list((await db.execute(select(Audit).where(Audit.tenant_id == tenant_id))).scalars().all())
    findings = list((await db.execute(select(AuditFinding).join(Audit).where(Audit.tenant_id == tenant_id))).scalars().all())
    crit_f = len([f for f in findings if f.severity == "critical"])
    high_f = len([f for f in findings if f.severity == "high"])
    open_f = len([f for f in findings if f.status == "open"])

    els.append(_kpi_bar([
        {"value": len(audits), "label": "Total Audits"},
        {"value": len(findings), "label": "Findings"},
        {"value": crit_f + high_f, "label": "High / Critical"},
        {"value": open_f, "label": "Open"},
    ]))

    els.append(_section(st, "Active Audits"))
    rows = []
    for a in audits[:10]:
        name = getattr(a, "title", None) or "Audit"
        atype = (getattr(a, "audit_type", None) or "—")
        atype = atype.value if hasattr(atype, "value") else str(atype)
        stat = str(getattr(a, "status", "—"))
        stat = stat.value if hasattr(stat, "value") else stat
        rows.append([name[:40], atype[:15], stat.replace("_", " ").title(), a.created_at.strftime("%Y-%m-%d") if a.created_at else "—"])
    els.append(_table(["Audit", "Type", "Status", "Started"], rows, [PAGE_W * 0.38, PAGE_W * 0.18, PAGE_W * 0.22, PAGE_W * 0.18]))

    els.append(_section(st, "Critical & High Findings"))
    f_rows = []
    for f in [f for f in findings if f.severity in ("critical", "high")][:15]:
        title = getattr(f, "title", "") or "—"
        stat = str(getattr(f, "status", "—")).replace("_", " ").title()
        f_rows.append([title[:50], (f.severity or "—").title(), stat])
    els.append(_table(["Finding", "Severity", "Status"], f_rows, [PAGE_W * 0.55, PAGE_W * 0.20, PAGE_W * 0.20]))

    els.append(_footer())
    doc.build(els)
    return buf.getvalue()


async def generate_single_audit_report(db: AsyncSession, audit: Audit, org: str) -> bytes:
    """Per-engagement audit report (distinct from the tenant-wide ``generate_audit_report``
    aggregate above). Used by ``POST /audits/{id}/report/generate`` so a specific audit's
    report can be persisted to ``Audit.report_url`` and then routed through the
    report-approval workflow before distribution.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    st = _styles()
    els = []
    start = audit.actual_start or audit.planned_start or audit.created_at.strftime("%d %b %Y") if audit.created_at else "—"
    end = audit.actual_end or audit.planned_end or datetime.utcnow().strftime("%d %b %Y")
    els.extend(_header(st, org, f"Audit Report — {audit.title}", start, end))

    findings = list((await db.execute(select(AuditFinding).where(AuditFinding.audit_id == audit.id))).scalars().all())
    crit_f = len([f for f in findings if f.severity == "critical"])
    high_f = len([f for f in findings if f.severity == "high"])
    open_f = len([f for f in findings if f.status in ("open", "in_remediation")])

    atype = getattr(audit, "audit_type", None)
    atype = atype.value if hasattr(atype, "value") else str(atype or "—")
    astatus = getattr(audit, "status", None)
    astatus = astatus.value if hasattr(astatus, "value") else str(astatus or "—")

    els.append(_kpi_bar([
        {"value": atype.title(), "label": "Audit Type"},
        {"value": astatus.replace("_", " ").title(), "label": "Status"},
        {"value": len(findings), "label": "Findings"},
        {"value": crit_f + high_f, "label": "High / Critical"},
        {"value": open_f, "label": "Open"},
    ]))

    if audit.scope:
        els.append(_section(st, "Scope"))
        els.append(Paragraph(audit.scope, st["Body"]))

    if audit.executive_summary:
        els.append(_section(st, "Executive Summary"))
        els.append(Paragraph(audit.executive_summary, st["Body"]))

    els.append(_section(st, "Findings"))
    f_rows = []
    for f in sorted(findings, key=lambda f: {"critical": 0, "high": 1, "medium": 2, "low": 3, "observation": 4}.get(str(f.severity.value if hasattr(f.severity, "value") else f.severity), 5)):
        sev = f.severity.value if hasattr(f.severity, "value") else str(f.severity)
        stat = f.status.value if hasattr(f.status, "value") else str(f.status)
        f_rows.append([(f.title or "—")[:50], sev.title(), stat.replace("_", " ").title(), f.due_date or "—"])
    els.append(_table(["Finding", "Severity", "Status", "Due"], f_rows, [PAGE_W * 0.45, PAGE_W * 0.18, PAGE_W * 0.22, PAGE_W * 0.15]))

    if audit.report_approved_at:
        els.append(_section(st, "Approval"))
        els.append(Paragraph(f"Report approved on {audit.report_approved_at}.", st["Body"]))

    els.append(_footer())
    doc.build(els)
    return buf.getvalue()


# ── Dispatcher ────────────────────────────────────────────────────────────

REPORT_GENERATORS = {
    "executive": generate_executive_summary,
    "risk": generate_risk_report,
    "vendor": generate_vendor_report,
    "compliance": generate_compliance_report,
    "audit": generate_audit_report,
}


async def generate_report(report_type: str, db: AsyncSession, tenant_id: str, tenant_name: str = "Organization") -> bytes:
    gen = REPORT_GENERATORS.get(report_type)
    if not gen:
        raise ValueError(f"Unknown report type: {report_type}")
    return await gen(db, tenant_id, tenant_name)
