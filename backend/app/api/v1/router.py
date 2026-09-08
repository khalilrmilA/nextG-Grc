"""API v1 router — aggregates all endpoint routers."""
from fastapi import APIRouter
from app.api.v1.endpoints import (
    access_governance,
    auth,
    ai_access,
    tenants,
    users,
    groups,
    frameworks,
    risks,
    compliance,
    audits,
    policies,
    vendors,
    assets,
    dashboard,
    subscriptions,
    ai,
    notifications,
    auditor_portal,
    admin,
    reports,
    data_io,
    activity_log,
    trust_center,
    incidents,
    webhooks,
    regulatory,
    threats,
    vulnerabilities,
    risk_scenarios,
    applied_controls,
    security_exceptions,
    risk_matrices,
    risk_cartographies,
    contract_collab,
    public_upload,
    public_chat,
    public_contact,
    support,
    license,
    license_server,
    mfa,
    control_evaluation,
    asset_graph,
    cve,
    risk_treatment,
    vuln_import,
    sso,
    report_builder,
    dashboards,
    governance,
    archiving,
    scenario_versions,
    ocr,
    report_schedules,
    system,
    database_config,
    dashboard_export,
    # STB tender (bloc « conformité & audit ») — new modules
    requirements,
    audit_campaigns,
    audit_grids,
    audit_comments,
    compliance_scales,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(ai_access.router, tags=["AI Access"])
api_router.include_router(tenants.router, prefix="/tenants", tags=["Tenants"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(groups.router, prefix="/groups", tags=["Team Groups"])
api_router.include_router(access_governance.router, prefix="/access-governance", tags=["Access Governance"])
api_router.include_router(frameworks.router, prefix="/frameworks", tags=["Frameworks"])
api_router.include_router(risks.router, prefix="/risks", tags=["Risk Management"])
api_router.include_router(compliance.router, prefix="/compliance", tags=["Compliance"])
api_router.include_router(audits.router, prefix="/audits", tags=["Audit Management"])
api_router.include_router(policies.router, prefix="/policies", tags=["Policy Management"])
api_router.include_router(vendors.router, prefix="/vendors", tags=["Vendor Risk (TPRM)"])
api_router.include_router(assets.router, prefix="/assets", tags=["Asset Management"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
api_router.include_router(subscriptions.router, prefix="/subscriptions", tags=["Subscriptions"])
api_router.include_router(ai.router, prefix="/ai", tags=["AI Assistant"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(auditor_portal.router, prefix="/auditor-portal", tags=["Auditor Portal"])

# --- STB tender: référentiel centralisé, campagnes, grilles, échanges, échelles ---
# The prefixes are load-bearing: audit_grids declares /audits/{audit_id}/... sub-paths
# that only stay unambiguous underneath /audit-grids.
api_router.include_router(requirements.router, prefix="/requirements", tags=["Requirements Referential"])
api_router.include_router(audit_campaigns.router, prefix="/audit-campaigns", tags=["Audit Campaigns"])
api_router.include_router(audit_grids.router, prefix="/audit-grids", tags=["Audit Grids"])
api_router.include_router(audit_comments.router, prefix="/audit-comments", tags=["Audit Comments"])
api_router.include_router(compliance_scales.router, prefix="/compliance-scales", tags=["Compliance Scales"])
api_router.include_router(admin.router, prefix="/admin", tags=["Super Admin"])
api_router.include_router(reports.router, prefix="/reports", tags=["Reports"])
api_router.include_router(data_io.router, prefix="/data", tags=["Data Import/Export"])
api_router.include_router(activity_log.router, prefix="/activity-log", tags=["Activity Log"])
api_router.include_router(trust_center.router, prefix="/trust-center", tags=["Trust Center"])
api_router.include_router(incidents.router, prefix="/incidents", tags=["Incident Management"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["Webhooks"])
api_router.include_router(regulatory.router, prefix="/regulatory", tags=["Regulatory Updates"])
api_router.include_router(threats.router, prefix="/threats", tags=["Threat Library"])
api_router.include_router(vulnerabilities.router, prefix="/vulnerabilities", tags=["Vulnerability Management"])
api_router.include_router(risk_scenarios.router, prefix="/risk-scenarios", tags=["Risk Scenarios"])
api_router.include_router(applied_controls.router, prefix="/applied-controls", tags=["Applied Controls"])
api_router.include_router(security_exceptions.router, prefix="/security", tags=["Security Exceptions & Risk Acceptance"])
api_router.include_router(risk_matrices.router, prefix="/risk-matrices", tags=["Risk Matrices"])
api_router.include_router(risk_cartographies.router, prefix="/risk-cartographies", tags=["Risk Cartography"])
api_router.include_router(contract_collab.router, prefix="/contract-collab", tags=["Contract Collaboration"])
api_router.include_router(public_upload.router, prefix="/public", tags=["Public Upload"])
api_router.include_router(public_chat.router, prefix="/public", tags=["Public Support Chat"])
api_router.include_router(public_contact.router, prefix="/public", tags=["Public Contact Form"])
api_router.include_router(support.router, prefix="/support/tickets", tags=["Support Tickets"])
api_router.include_router(license.router, prefix="/license", tags=["License"])
api_router.include_router(license_server.router, prefix="/licenses", tags=["License Server"])
api_router.include_router(mfa.router, prefix="/mfa", tags=["MFA (Elite Pack)"])
api_router.include_router(control_evaluation.router, prefix="/control-evaluations", tags=["Control Effectiveness (Elite Pack)"])
api_router.include_router(asset_graph.router, prefix="/asset-graph", tags=["Asset Cartography (Elite Pack)"])
api_router.include_router(cve.router, prefix="/cve", tags=["CVE Knowledge Base (Elite Pack)"])
api_router.include_router(risk_treatment.router, prefix="/risk-treatment", tags=["Risk Treatment (Elite Pack)"])
api_router.include_router(vuln_import.router, prefix="/vuln-import", tags=["Vulnerability Scanner Import (Elite Pack)"])
api_router.include_router(sso.router, prefix="/sso", tags=["AD/LDAP SSO (Elite Pack)"])
api_router.include_router(report_builder.router, prefix="/report-builder", tags=["Report Builder (Elite Pack)"])
api_router.include_router(dashboards.router, prefix="/dashboards", tags=["Module Dashboards (Elite Pack)"])
api_router.include_router(governance.router, prefix="/governance", tags=["Governance & RACI (Elite Pack)"])
api_router.include_router(archiving.router, prefix="/archiving", tags=["Archiving & Retention (Elite Pack)"])
api_router.include_router(scenario_versions.router, prefix="/scenario-versions", tags=["Scenario Versioning (Elite Pack)"])
api_router.include_router(ocr.router, prefix="/ocr", tags=["OCR Document Capture (Elite Pack)"])
api_router.include_router(report_schedules.router, prefix="/report-schedules", tags=["Scheduled Reports (Elite Pack)"])
api_router.include_router(system.router, prefix="/system", tags=["System Self-Test"])
# STB « SGBD : Oracle 19C et SQL Server 2019 » — datastore selection from the UI.
# Shares the /system prefix; its own paths are /system/database*.
api_router.include_router(database_config.router, prefix="/system", tags=["Database Configuration"])
# STB « Export PDF/Excel » — exports the dashboard itself, reusing the same
# aggregation the screen renders, behind the same role gate as the dashboard.
api_router.include_router(dashboard_export.router, prefix="/dashboard-export", tags=["Dashboard Export"])
