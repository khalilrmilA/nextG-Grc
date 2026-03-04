"""Seed real frameworks into grc_dev.db directly."""
import sqlite3
import uuid
import json

conn = sqlite3.connect("grc_dev.db")
cur = conn.cursor()


def add_framework(name, short_name, version, description, controls):
    existing = cur.execute("SELECT id FROM frameworks WHERE short_name=?", (short_name,)).fetchone()
    if existing:
        cur.execute("DELETE FROM framework_controls WHERE framework_id=?", (existing[0],))
        cur.execute("DELETE FROM frameworks WHERE id=?", (existing[0],))

    fw_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO frameworks (id, name, short_name, version, description, issuing_body,
           applicable_regions, applicable_industries, status, is_builtin, tenant_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))""",
        (fw_id, name, short_name, version, description, "",
         json.dumps(["global"]), json.dumps(["all"]), "ACTIVE", 1, None),
    )
    for i, ctrl in enumerate(controls):
        cur.execute(
            """INSERT INTO framework_controls (id, framework_id, control_id, title,
               description, guidance, category, tags, mapped_controls, sort_order, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))""",
            (str(uuid.uuid4()), fw_id, ctrl["id"], ctrl["title"],
             ctrl.get("desc", ""), ctrl.get("guidance", ""),
             ctrl.get("cat", "GOVERNANCE"), "[]", "[]", i),
        )
    print(f"  Added: {short_name} — {name} ({len(controls)} controls)")
    return fw_id


# ── SOC 2 (TSC 2017)
add_framework(
    "SOC 2 — Trust Services Criteria", "SOC2", "2017",
    "AICPA Trust Services Criteria for Security, Availability, Processing Integrity, Confidentiality, and Privacy.",
    [
        {"id": "CC1.1", "title": "COSO Principle 1 — Integrity and ethical values", "cat": "GOVERNANCE"},
        {"id": "CC1.2", "title": "COSO Principle 2 — Board oversight", "cat": "GOVERNANCE"},
        {"id": "CC1.3", "title": "COSO Principle 3 — Organizational structure", "cat": "GOVERNANCE"},
        {"id": "CC1.4", "title": "COSO Principle 4 — Commitment to competence", "cat": "GOVERNANCE"},
        {"id": "CC1.5", "title": "COSO Principle 5 — Accountability", "cat": "GOVERNANCE"},
        {"id": "CC2.1", "title": "COSO Principle 13 — Internal communication", "cat": "ORGANIZATIONAL"},
        {"id": "CC2.2", "title": "COSO Principle 14 — External communication", "cat": "ORGANIZATIONAL"},
        {"id": "CC2.3", "title": "COSO Principle 15 — Security incident communication", "cat": "ORGANIZATIONAL"},
        {"id": "CC3.1", "title": "Risk assessment objectives", "cat": "ORGANIZATIONAL"},
        {"id": "CC3.2", "title": "Risk identification and analysis", "cat": "ORGANIZATIONAL"},
        {"id": "CC3.3", "title": "Fraud risk assessment", "cat": "ORGANIZATIONAL"},
        {"id": "CC3.4", "title": "Change risk assessment", "cat": "ORGANIZATIONAL"},
        {"id": "CC4.1", "title": "Control activities selection and development", "cat": "TECHNICAL"},
        {"id": "CC4.2", "title": "Technology general controls", "cat": "TECHNICAL"},
        {"id": "CC5.1", "title": "Control activity policies and procedures", "cat": "TECHNICAL"},
        {"id": "CC5.2", "title": "Control activities deployment", "cat": "TECHNICAL"},
        {"id": "CC5.3", "title": "Policy deployment to responsible parties", "cat": "GOVERNANCE"},
        {"id": "CC6.1", "title": "Logical and physical access controls", "cat": "TECHNICAL"},
        {"id": "CC6.2", "title": "System credentials prior to issuance", "cat": "TECHNICAL"},
        {"id": "CC6.3", "title": "Access removal and modification", "cat": "TECHNICAL"},
        {"id": "CC6.4", "title": "Physical access restrictions", "cat": "PHYSICAL"},
        {"id": "CC6.5", "title": "Logical access security measures", "cat": "TECHNICAL"},
        {"id": "CC6.6", "title": "Network boundary controls", "cat": "TECHNICAL"},
        {"id": "CC6.7", "title": "System component access restrictions", "cat": "TECHNICAL"},
        {"id": "CC6.8", "title": "Malicious software prevention", "cat": "TECHNICAL"},
        {"id": "CC7.1", "title": "System monitoring for vulnerabilities", "cat": "TECHNICAL"},
        {"id": "CC7.2", "title": "Security event monitoring", "cat": "TECHNICAL"},
        {"id": "CC7.3", "title": "Incident evaluation and response", "cat": "ORGANIZATIONAL"},
        {"id": "CC7.4", "title": "Security incident response", "cat": "ORGANIZATIONAL"},
        {"id": "CC7.5", "title": "Incident recovery", "cat": "ORGANIZATIONAL"},
        {"id": "CC8.1", "title": "Change management process", "cat": "ORGANIZATIONAL"},
        {"id": "CC9.1", "title": "Risk mitigation", "cat": "ORGANIZATIONAL"},
        {"id": "CC9.2", "title": "Vendor and business partner risk management", "cat": "ORGANIZATIONAL"},
        {"id": "A1.1", "title": "Availability commitments and system requirements", "cat": "TECHNICAL"},
        {"id": "A1.2", "title": "Environmental and technological threats", "cat": "TECHNICAL"},
        {"id": "A1.3", "title": "Recovery plan testing", "cat": "ORGANIZATIONAL"},
        {"id": "C1.1", "title": "Confidentiality commitments", "cat": "ORGANIZATIONAL"},
        {"id": "P1.0", "title": "Privacy notice", "cat": "ORGANIZATIONAL"},
        {"id": "P2.0", "title": "Choice and consent", "cat": "ORGANIZATIONAL"},
        {"id": "P3.0", "title": "Collection practices", "cat": "ORGANIZATIONAL"},
        {"id": "P4.0", "title": "Use, retention, and disposal", "cat": "ORGANIZATIONAL"},
        {"id": "P5.0", "title": "Access to personal information", "cat": "ORGANIZATIONAL"},
        {"id": "P6.0", "title": "Disclosure and notification", "cat": "ORGANIZATIONAL"},
        {"id": "P7.0", "title": "Quality of personal information", "cat": "ORGANIZATIONAL"},
        {"id": "P8.0", "title": "Monitoring and enforcement", "cat": "ORGANIZATIONAL"},
    ],
)

# ── NIST CSF 2.0
add_framework(
    "NIST Cybersecurity Framework 2.0", "NIST-CSF", "2.0",
    "NIST CSF 2.0 helps organizations manage and reduce cybersecurity risk across six core functions: Govern, Identify, Protect, Detect, Respond, Recover.",
    [
        {"id": "GV.OC-01", "title": "Organizational mission understood", "cat": "GOVERNANCE"},
        {"id": "GV.OC-02", "title": "Internal and external stakeholder needs understood", "cat": "GOVERNANCE"},
        {"id": "GV.OC-03", "title": "Legal, regulatory, and contractual requirements understood", "cat": "GOVERNANCE"},
        {"id": "GV.OC-04", "title": "Critical objectives and activities identified", "cat": "GOVERNANCE"},
        {"id": "GV.OC-05", "title": "Outcomes and dependencies identified", "cat": "GOVERNANCE"},
        {"id": "GV.RM-01", "title": "Risk management objectives established", "cat": "GOVERNANCE"},
        {"id": "GV.RM-02", "title": "Risk appetite and risk tolerance established", "cat": "GOVERNANCE"},
        {"id": "GV.RM-03", "title": "Cybersecurity risk management integrated", "cat": "GOVERNANCE"},
        {"id": "GV.RM-06", "title": "Policies and procedures established and reviewed", "cat": "GOVERNANCE"},
        {"id": "GV.RM-07", "title": "Strategic opportunities considered", "cat": "GOVERNANCE"},
        {"id": "GV.RR-01", "title": "Organizational leadership responsible for cybersecurity", "cat": "GOVERNANCE"},
        {"id": "GV.RR-02", "title": "Roles and responsibilities assigned and communicated", "cat": "GOVERNANCE"},
        {"id": "GV.RR-03", "title": "Adequate resources allocated for cybersecurity", "cat": "GOVERNANCE"},
        {"id": "GV.SC-01", "title": "Cybersecurity supply chain risk management program", "cat": "GOVERNANCE"},
        {"id": "GV.SC-03", "title": "Supplier cybersecurity practices included in agreements", "cat": "GOVERNANCE"},
        {"id": "ID.AM-01", "title": "Hardware asset inventory maintained", "cat": "IDENTIFY"},
        {"id": "ID.AM-02", "title": "Software and service inventory maintained", "cat": "IDENTIFY"},
        {"id": "ID.AM-03", "title": "Organizational communication and data flows mapped", "cat": "IDENTIFY"},
        {"id": "ID.AM-04", "title": "External service inventories maintained", "cat": "IDENTIFY"},
        {"id": "ID.AM-05", "title": "Assets prioritized based on classification", "cat": "IDENTIFY"},
        {"id": "ID.AM-07", "title": "Data inventory and metadata maintained", "cat": "IDENTIFY"},
        {"id": "ID.AM-08", "title": "Asset lifecycle managed", "cat": "IDENTIFY"},
        {"id": "ID.RA-01", "title": "Vulnerabilities identified and documented", "cat": "IDENTIFY"},
        {"id": "ID.RA-02", "title": "Cyber threat intelligence received", "cat": "IDENTIFY"},
        {"id": "ID.RA-03", "title": "Internal and external threats identified", "cat": "IDENTIFY"},
        {"id": "ID.RA-04", "title": "Potential impacts and likelihoods assessed", "cat": "IDENTIFY"},
        {"id": "ID.RA-05", "title": "Threats and vulnerabilities prioritized", "cat": "IDENTIFY"},
        {"id": "ID.RA-06", "title": "Risk responses planned and tracked", "cat": "IDENTIFY"},
        {"id": "PR.AA-01", "title": "Identities and credentials managed", "cat": "PROTECT"},
        {"id": "PR.AA-02", "title": "Identities proofed and bound to credentials", "cat": "PROTECT"},
        {"id": "PR.AA-03", "title": "Users and hardware authenticated", "cat": "PROTECT"},
        {"id": "PR.AA-04", "title": "Identity assertions protected", "cat": "PROTECT"},
        {"id": "PR.AA-05", "title": "Access permissions managed", "cat": "PROTECT"},
        {"id": "PR.AA-06", "title": "Physical access managed", "cat": "PROTECT"},
        {"id": "PR.AT-01", "title": "Security awareness training provided", "cat": "PROTECT"},
        {"id": "PR.AT-02", "title": "Specialized roles trained", "cat": "PROTECT"},
        {"id": "PR.DS-01", "title": "Data at rest protected", "cat": "PROTECT"},
        {"id": "PR.DS-02", "title": "Data in transit protected", "cat": "PROTECT"},
        {"id": "PR.DS-10", "title": "Data in use protected", "cat": "PROTECT"},
        {"id": "PR.DS-11", "title": "Backups created and tested", "cat": "PROTECT"},
        {"id": "PR.IR-01", "title": "Networks protected from unauthorized logical access", "cat": "PROTECT"},
        {"id": "PR.IR-02", "title": "Technologies managed consistent with risk", "cat": "PROTECT"},
        {"id": "PR.PS-01", "title": "Configuration management practices established", "cat": "PROTECT"},
        {"id": "PR.PS-02", "title": "Software maintained and removed", "cat": "PROTECT"},
        {"id": "PR.PS-04", "title": "Log records created and protected", "cat": "PROTECT"},
        {"id": "PR.PS-05", "title": "Unauthorized software execution prevented", "cat": "PROTECT"},
        {"id": "DE.AE-02", "title": "Potentially adverse events analyzed", "cat": "DETECT"},
        {"id": "DE.AE-03", "title": "Information correlated from multiple sources", "cat": "DETECT"},
        {"id": "DE.AE-04", "title": "Impact and scope of adverse events estimated", "cat": "DETECT"},
        {"id": "DE.AE-06", "title": "Adverse event information provided to authorized staff", "cat": "DETECT"},
        {"id": "DE.CM-01", "title": "Networks and services monitored", "cat": "DETECT"},
        {"id": "DE.CM-02", "title": "Physical environment monitored", "cat": "DETECT"},
        {"id": "DE.CM-03", "title": "Personnel activity and technology usage monitored", "cat": "DETECT"},
        {"id": "DE.CM-06", "title": "External service provider activities monitored", "cat": "DETECT"},
        {"id": "DE.CM-09", "title": "Computing hardware and software monitored", "cat": "DETECT"},
        {"id": "RS.MA-01", "title": "Incident response plan executed", "cat": "RESPOND"},
        {"id": "RS.MA-02", "title": "Incident reports triaged", "cat": "RESPOND"},
        {"id": "RS.MA-03", "title": "Incidents categorized and escalated", "cat": "RESPOND"},
        {"id": "RS.AN-03", "title": "Analysis to establish recovery activities performed", "cat": "RESPOND"},
        {"id": "RS.AN-06", "title": "Actions to contain impact performed", "cat": "RESPOND"},
        {"id": "RS.CO-02", "title": "Internal and external stakeholders notified", "cat": "RESPOND"},
        {"id": "RS.CO-03", "title": "Information shared with designated parties", "cat": "RESPOND"},
        {"id": "RC.RP-01", "title": "Recovery plan executed", "cat": "RECOVER"},
        {"id": "RC.RP-02", "title": "Recovery actions scoped and prioritized", "cat": "RECOVER"},
        {"id": "RC.RP-03", "title": "Backups and restoration integrity tested", "cat": "RECOVER"},
        {"id": "RC.RP-04", "title": "Critical business functions restored", "cat": "RECOVER"},
        {"id": "RC.RP-05", "title": "Integrity of restored assets verified", "cat": "RECOVER"},
        {"id": "RC.CO-03", "title": "Recovery activities communicated", "cat": "RECOVER"},
    ],
)

# ── GDPR
add_framework(
    "General Data Protection Regulation (GDPR)", "GDPR", "2016/679",
    "EU Regulation 2016/679 on protection of natural persons with regard to processing of personal data and on the free movement of such data.",
    [
        {"id": "Art.5", "title": "Principles relating to processing of personal data", "cat": "GOVERNANCE"},
        {"id": "Art.6", "title": "Lawfulness of processing", "cat": "GOVERNANCE"},
        {"id": "Art.7", "title": "Conditions for consent", "cat": "GOVERNANCE"},
        {"id": "Art.9", "title": "Processing of special categories of personal data", "cat": "GOVERNANCE"},
        {"id": "Art.12", "title": "Transparent information and communication to data subjects", "cat": "ORGANIZATIONAL"},
        {"id": "Art.13", "title": "Information to be provided where data collected from data subject", "cat": "ORGANIZATIONAL"},
        {"id": "Art.14", "title": "Information where data not obtained from the data subject", "cat": "ORGANIZATIONAL"},
        {"id": "Art.15", "title": "Right of access by the data subject", "cat": "ORGANIZATIONAL"},
        {"id": "Art.16", "title": "Right to rectification", "cat": "ORGANIZATIONAL"},
        {"id": "Art.17", "title": "Right to erasure (right to be forgotten)", "cat": "ORGANIZATIONAL"},
        {"id": "Art.18", "title": "Right to restriction of processing", "cat": "ORGANIZATIONAL"},
        {"id": "Art.20", "title": "Right to data portability", "cat": "ORGANIZATIONAL"},
        {"id": "Art.21", "title": "Right to object", "cat": "ORGANIZATIONAL"},
        {"id": "Art.22", "title": "Automated individual decision-making including profiling", "cat": "ORGANIZATIONAL"},
        {"id": "Art.24", "title": "Responsibility of the controller", "cat": "GOVERNANCE"},
        {"id": "Art.25", "title": "Data protection by design and by default", "cat": "TECHNICAL"},
        {"id": "Art.26", "title": "Joint controllers", "cat": "GOVERNANCE"},
        {"id": "Art.28", "title": "Processor obligations — Data Processing Agreement", "cat": "GOVERNANCE"},
        {"id": "Art.29", "title": "Processing under authority of controller or processor", "cat": "GOVERNANCE"},
        {"id": "Art.30", "title": "Records of processing activities", "cat": "GOVERNANCE"},
        {"id": "Art.32", "title": "Security of processing", "cat": "TECHNICAL"},
        {"id": "Art.33", "title": "Notification of personal data breach to supervisory authority", "cat": "ORGANIZATIONAL"},
        {"id": "Art.34", "title": "Communication of personal data breach to data subjects", "cat": "ORGANIZATIONAL"},
        {"id": "Art.35", "title": "Data protection impact assessment (DPIA)", "cat": "ORGANIZATIONAL"},
        {"id": "Art.36", "title": "Prior consultation with supervisory authority", "cat": "GOVERNANCE"},
        {"id": "Art.37", "title": "Designation of the data protection officer", "cat": "GOVERNANCE"},
        {"id": "Art.38", "title": "Position of the data protection officer", "cat": "GOVERNANCE"},
        {"id": "Art.39", "title": "Tasks of the data protection officer", "cat": "GOVERNANCE"},
        {"id": "Art.44", "title": "General principle for transfers to third countries", "cat": "GOVERNANCE"},
        {"id": "Art.46", "title": "Transfers subject to appropriate safeguards (SCCs, BCRs)", "cat": "GOVERNANCE"},
    ],
)

conn.commit()

print("\nFinal framework list:")
rows = conn.execute(
    "SELECT f.short_name, f.name, COUNT(fc.id) FROM frameworks f "
    "LEFT JOIN framework_controls fc ON fc.framework_id=f.id GROUP BY f.id ORDER BY f.name"
).fetchall()
for r in rows:
    print(f"  {r[0]:15} {r[1][:55]:55} ({r[2]} controls)")

conn.close()
print("\nDone.")
