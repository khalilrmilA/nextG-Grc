"""Generate a realistic third-party vendor services agreement PDF for testing."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY

OUTPUT = "vendor_services_agreement.pdf"

doc = SimpleDocTemplate(OUTPUT, pagesize=A4,
    rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)

styles = getSampleStyleSheet()

title_style = ParagraphStyle("Title", parent=styles["Normal"],
    fontSize=16, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=6)
subtitle_style = ParagraphStyle("Sub", parent=styles["Normal"],
    fontSize=10, fontName="Helvetica", alignment=TA_CENTER, spaceAfter=4,
    textColor=colors.grey)
h1_style = ParagraphStyle("H1", parent=styles["Normal"],
    fontSize=11, fontName="Helvetica-Bold", spaceBefore=14, spaceAfter=4,
    textColor=colors.HexColor("#1a365d"))
h2_style = ParagraphStyle("H2", parent=styles["Normal"],
    fontSize=10, fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=3,
    textColor=colors.HexColor("#2c5282"))
body_style = ParagraphStyle("Body", parent=styles["Normal"],
    fontSize=9.5, fontName="Helvetica", spaceAfter=5, leading=14,
    alignment=TA_JUSTIFY)
bullet_style = ParagraphStyle("Bullet", parent=styles["Normal"],
    fontSize=9.5, fontName="Helvetica", spaceAfter=3, leftIndent=20, leading=13)

story = []

# ── Header ────────────────────────────────────────────────────────────────────
story.append(Spacer(1, 0.3*cm))
story.append(Paragraph("VENDOR SERVICES AGREEMENT", title_style))
story.append(Paragraph("Master Services & Data Processing Agreement", subtitle_style))
story.append(Paragraph("Contract No: VSA-2026-0215  |  Version 1.0", subtitle_style))
story.append(Spacer(1, 0.3*cm))
story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#1a365d")))
story.append(Spacer(1, 0.4*cm))

# ── Parties ───────────────────────────────────────────────────────────────────
parties_data = [
    ["SERVICE PROVIDER", "CLIENT"],
    ["NextStep IT Solutions SRL", "NexaFinance Group SA"],
    ["12 Rue de l'Innovation, 75008 Paris", "45 Boulevard Haussmann, 75009 Paris"],
    ["SIRET: 82312456700018", "SIRET: 71234987600042"],
    ["contact@nextstep-it.com", "legal@nexafinance.com"],
    ["Represented by: Khalil Rmila, CEO", "Represented by: Sophie Laurent, CFO"],
]
pt = Table(parties_data, colWidths=[8.5*cm, 8.5*cm])
pt.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1a365d")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,0), 9),
    ("FONTNAME", (0,1), (-1,1), "Helvetica-Bold"),
    ("FONTSIZE", (0,1), (-1,1), 9),
    ("FONTSIZE", (0,2), (-1,-1), 8.5),
    ("FONTNAME", (0,2), (-1,-1), "Helvetica"),
    ("ALIGN", (0,0), (-1,-1), "CENTER"),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.HexColor("#ebf8ff"), colors.white]),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#bee3f8")),
    ("PADDING", (0,0), (-1,-1), 5),
]))
story.append(pt)
story.append(Spacer(1, 0.5*cm))

# ── Key Terms ─────────────────────────────────────────────────────────────────
terms_data = [
    ["Effective Date", "April 1, 2026", "Contract Term", "24 months"],
    ["Renewal", "Auto-renew 12 months (90-day notice)", "Governing Law", "French Law / EU Regulations"],
    ["Total Contract Value", "EUR 480,000 / year", "Payment Terms", "Net 30 days"],
]
tt = Table(terms_data, colWidths=[4*cm, 5.25*cm, 4*cm, 4.25*cm])
tt.setStyle(TableStyle([
    ("FONTNAME", (0,0), (0,-1), "Helvetica-Bold"),
    ("FONTNAME", (2,0), (2,-1), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 8.5),
    ("BACKGROUND", (0,0), (0,-1), colors.HexColor("#edf2f7")),
    ("BACKGROUND", (2,0), (2,-1), colors.HexColor("#edf2f7")),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e0")),
    ("PADDING", (0,0), (-1,-1), 5),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
]))
story.append(tt)
story.append(Spacer(1, 0.5*cm))

# ── Section 1 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("1. SCOPE OF SERVICES", h1_style))
story.append(Paragraph(
    "NextStep IT Solutions SRL (\"Service Provider\") agrees to deliver the following managed IT "
    "and cybersecurity services to NexaFinance Group SA (\"Client\") in accordance with the terms "
    "set forth herein:", body_style))

story.append(Paragraph("1.1 Managed Security Operations Center (SOC)", h2_style))
for item in [
    "24/7 threat monitoring, detection, and response",
    "SIEM platform management (Microsoft Sentinel)",
    "Incident triage, escalation, and post-incident reporting",
    "Monthly threat intelligence briefings",
    "Security alert tuning and false-positive reduction",
]:
    story.append(Paragraph(f"• {item}", bullet_style))

story.append(Paragraph("1.2 Vulnerability Management", h2_style))
for item in [
    "Weekly authenticated network vulnerability scans",
    "Monthly web application penetration testing",
    "CVE prioritisation and remediation tracking",
    "Executive vulnerability risk dashboard",
]:
    story.append(Paragraph(f"• {item}", bullet_style))

story.append(Paragraph("1.3 GRC Platform & Compliance Advisory", h2_style))
for item in [
    "Access to GRC SaaS platform (full license, up to 50 users)",
    "ISO 27001:2022 implementation support and evidence collection",
    "DORA readiness assessment and gap analysis",
    "Quarterly compliance reporting to management",
    "Regulatory change monitoring (NIS2, DORA, GDPR)",
]:
    story.append(Paragraph(f"• {item}", bullet_style))

story.append(Paragraph("1.4 Cloud Security Posture Management (CSPM)", h2_style))
for item in [
    "Microsoft Azure and AWS security configuration review",
    "CIS Benchmark compliance assessment (monthly)",
    "Cloud asset inventory and shadow IT detection",
]:
    story.append(Paragraph(f"• {item}", bullet_style))

# ── Section 2 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("2. DATA PROTECTION & GDPR COMPLIANCE", h1_style))
story.append(Paragraph(
    "The parties agree to comply with Regulation (EU) 2016/679 (GDPR) and all applicable "
    "French data protection laws. This section constitutes the Data Processing Agreement (DPA) "
    "required under Article 28 GDPR.", body_style))

story.append(Paragraph("2.1 Data Processing Roles", h2_style))
story.append(Paragraph(
    "Client acts as Data Controller. Service Provider acts as Data Processor when processing "
    "personal data on behalf of the Client. Any sub-processors must be pre-approved in writing "
    "by the Client.", body_style))

story.append(Paragraph("2.2 Data Processing Activities", h2_style))
dpa_data = [
    ["Category of Data", "Purpose", "Retention"],
    ["Employee identifiers (names, email, AD accounts)", "SOC monitoring & access logs", "12 months"],
    ["Network traffic metadata", "Threat detection & SIEM correlation", "6 months"],
    ["Security event logs", "Incident investigation", "24 months"],
    ["Vulnerability scan results", "Remediation tracking", "36 months"],
    ["Financial system access logs", "Compliance audit trail", "7 years (legal)"],
]
dpat = Table(dpa_data, colWidths=[6*cm, 5.5*cm, 3*cm])
dpat.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#2c5282")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTNAME", (0,1), (-1,-1), "Helvetica"),
    ("FONTSIZE", (0,0), (-1,-1), 8),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.HexColor("#ebf8ff"), colors.white]),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#bee3f8")),
    ("PADDING", (0,0), (-1,-1), 4),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
]))
story.append(dpat)
story.append(Spacer(1, 0.3*cm))

story.append(Paragraph("2.3 Security Measures (Art. 32 GDPR)", h2_style))
for item in [
    "AES-256 encryption at rest and TLS 1.3 in transit for all personal data",
    "Role-based access control (RBAC) with least-privilege principle",
    "Multi-factor authentication mandatory for all personnel accessing Client data",
    "Annual penetration testing of systems processing personal data",
    "Data breach notification to Client within 24 hours of discovery",
    "Client notification to supervisory authority within 72 hours per GDPR Art. 33",
]:
    story.append(Paragraph(f"• {item}", bullet_style))

story.append(Paragraph("2.4 International Data Transfers", h2_style))
story.append(Paragraph(
    "All personal data will be processed within the European Economic Area (EEA). Any transfer "
    "outside the EEA requires prior written consent and execution of Standard Contractual Clauses "
    "(SCCs) per EU Commission Decision 2021/914. Data will not be processed in countries without "
    "an adequacy decision without explicit approval.", body_style))

# ── Section 3 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("3. SERVICE LEVEL AGREEMENT (SLA)", h1_style))
sla_data = [
    ["Service", "Availability", "Response Time", "Penalty"],
    ["SOC Monitoring", "99.9%", "15 min (P1 alerts)", "5% monthly fee"],
    ["GRC Platform", "99.5%", "4 hours (P2)", "3% monthly fee"],
    ["Vulnerability Scans", "Weekly delivery", "24h report", "EUR 2,000/miss"],
    ["Incident Response", "N/A", "30 min (critical)", "10% monthly fee"],
    ["CSPM Reports", "Monthly delivery", "5 business days", "EUR 1,000/miss"],
]
slat = Table(sla_data, colWidths=[4.5*cm, 3.5*cm, 3.5*cm, 4*cm])
slat.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#1a365d")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTNAME", (0,1), (-1,-1), "Helvetica"),
    ("FONTSIZE", (0,0), (-1,-1), 8),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.HexColor("#f7fafc"), colors.white]),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
    ("PADDING", (0,0), (-1,-1), 4),
    ("ALIGN", (1,0), (-1,-1), "CENTER"),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
]))
story.append(slat)
story.append(Spacer(1, 0.3*cm))
story.append(Paragraph(
    "SLA credits are the sole financial remedy for service level failures and do not constitute "
    "an admission of liability. Credits must be claimed within 30 days of the incident.", body_style))

# ── Section 4 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("4. CONFIDENTIALITY", h1_style))
story.append(Paragraph(
    "Each party agrees to keep confidential all non-public information disclosed by the other "
    "party, including security architectures, vulnerability reports, financial data, intellectual "
    "property, and personnel information. This obligation survives termination for five (5) years.",
    body_style))

# ── Section 5 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("5. LIABILITY & INDEMNIFICATION", h1_style))
story.append(Paragraph("5.1 Limitation of Liability", h2_style))
story.append(Paragraph(
    "The Service Provider's total aggregate liability shall not exceed the total fees paid by "
    "the Client in the twelve (12) months immediately preceding the event giving rise to liability. "
    "Neither party shall be liable for indirect, incidental, special, or consequential damages.",
    body_style))
story.append(Paragraph("5.2 Indemnification", h2_style))
story.append(Paragraph(
    "Each party shall indemnify the other from third-party claims arising from: (a) breach of "
    "this Agreement; (b) gross negligence or wilful misconduct; (c) infringement of intellectual "
    "property rights.", body_style))

# ── Section 6 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("6. SUBCONTRACTORS & SUPPLY CHAIN", h1_style))
story.append(Paragraph(
    "Service Provider may engage the following approved sub-processors. Changes require 30 days "
    "written notice; Client has the right to object within 15 days.", body_style))
sub_data = [
    ["Sub-processor", "Location", "Service", "Certification"],
    ["Microsoft Ireland Operations Ltd", "Ireland (EEA)", "Azure cloud infrastructure", "ISO 27001, SOC 2"],
    ["CrowdStrike Inc. (EU nodes)", "Germany (EEA)", "Endpoint detection & response", "ISO 27001, FedRAMP"],
    ["Tenable Network Security", "Netherlands (EEA)", "Vulnerability scanning engine", "SOC 2 Type II"],
]
subt = Table(sub_data, colWidths=[4.5*cm, 3*cm, 4*cm, 3*cm])
subt.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#2d3748")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTNAME", (0,1), (-1,-1), "Helvetica"),
    ("FONTSIZE", (0,0), (-1,-1), 7.5),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.HexColor("#f7fafc"), colors.white]),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
    ("PADDING", (0,0), (-1,-1), 4),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
]))
story.append(subt)
story.append(Spacer(1, 0.3*cm))

# ── Section 7 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("7. TERMINATION", h1_style))
for item in [
    "Either party may terminate for convenience with 90 days written notice.",
    "Either party may terminate immediately upon material breach not cured within 30 days.",
    "Client may terminate immediately if Service Provider suffers a data breach affecting Client personal data.",
    "Upon termination, Service Provider shall return or destroy all Client data within 30 days.",
    "Sections 4 (Confidentiality), 5 (Liability), and 2 (Data Protection) survive termination.",
]:
    story.append(Paragraph(f"• {item}", bullet_style))

# ── Section 8 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("8. AUDIT RIGHTS", h1_style))
story.append(Paragraph(
    "Client shall have the right to audit Service Provider's compliance upon 15 business days' "
    "written notice, no more than once per year. Service Provider shall provide annual third-party "
    "audit reports (ISO 27001 certification, SOC 2 Type II) within 30 days of issuance.", body_style))

# ── Section 9 ─────────────────────────────────────────────────────────────────
story.append(Paragraph("9. DORA COMPLIANCE (Digital Operational Resilience Act)", h1_style))
story.append(Paragraph(
    "As NexaFinance Group SA is a regulated financial entity subject to DORA (Regulation EU "
    "2022/2554), this Agreement incorporates mandatory provisions required under DORA Article 30:",
    body_style))
for item in [
    "Service Provider is classified as an ICT third-party service provider (TPSP) under DORA.",
    "Service Provider will participate in threat-led penetration testing (TLPT) upon Client request.",
    "BC/DR plans must be provided and tested annually.",
    "Maximum Tolerable Period of Disruption (MTPD): 4 hours for critical services.",
    "Recovery Time Objective (RTO): 2 hours  |  Recovery Point Objective (RPO): 30 minutes.",
    "Service Provider must notify Client of any ICT-related incident within 2 hours of detection.",
    "Exit strategy documentation must be maintained and exercised annually.",
]:
    story.append(Paragraph(f"• {item}", bullet_style))

# ── Section 10 ────────────────────────────────────────────────────────────────
story.append(Paragraph("10. GENERAL PROVISIONS", h1_style))
story.append(Paragraph(
    "<b>10.1 Governing Law:</b> This Agreement is governed by French law. Disputes shall be "
    "subject to the exclusive jurisdiction of the Commercial Court of Paris.", body_style))
story.append(Paragraph(
    "<b>10.2 Entire Agreement:</b> This Agreement supersedes all prior negotiations, "
    "representations, and agreements between the parties.", body_style))
story.append(Paragraph(
    "<b>10.3 Amendments:</b> No amendment shall be effective unless in writing and signed by "
    "authorized representatives of both parties.", body_style))
story.append(Paragraph(
    "<b>10.4 Force Majeure:</b> Neither party shall be liable for failure to perform obligations "
    "due to circumstances beyond reasonable control.", body_style))

# ── Signatures ────────────────────────────────────────────────────────────────
story.append(Spacer(1, 0.6*cm))
story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1a365d")))
story.append(Spacer(1, 0.3*cm))
sig_title = ParagraphStyle("SigTitle", parent=styles["Normal"],
    fontSize=11, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=8)
story.append(Paragraph("SIGNATURES", sig_title))

sig_data = [
    ["FOR NEXTST EP IT SOLUTIONS SRL", "FOR NEXAFINANCE GROUP SA"],
    ["", ""],
    ["_________________________________", "_________________________________"],
    ["Khalil Rmila", "Sophie Laurent"],
    ["Chief Executive Officer", "Chief Financial Officer"],
    ["Date: ______ / ______ / 2026", "Date: ______ / ______ / 2026"],
]
sigt = Table(sig_data, colWidths=[8.5*cm, 8.5*cm])
sigt.setStyle(TableStyle([
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,0), 9),
    ("FONTSIZE", (0,1), (-1,-1), 9),
    ("FONTNAME", (0,3), (-1,3), "Helvetica-Bold"),
    ("ALIGN", (0,0), (-1,-1), "CENTER"),
    ("ROWHEIGHT", (0,1), (-1,1), 35),
    ("PADDING", (0,0), (-1,-1), 4),
]))
story.append(sigt)

doc.build(story)
print(f"PDF created: {OUTPUT}")