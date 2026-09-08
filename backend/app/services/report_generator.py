"""
Weekly PDF Report Generator — professional GRC reports.
Clean, corporate design inspired by Big 4 audit reports.

Three things this module is responsible for beyond drawing boxes:

**Enum values, never Python reprs.** The status columns are ``str``-mixin enums,
so ``str(AuditStatus.FIELDWORK)`` is ``"AuditStatus.FIELDWORK"``, not
``"fieldwork"``. Several tables used to render exactly that — a downloadable
report that said *Auditstatus.Fieldwork* and *Findingstatus.Open* to the reader.
Every enum column now goes through :func:`_enum_value`, and every value the
reader sees goes through :func:`_label`, which also translates it.

**Language.** STB requires the produced artefact in French and Arabic, not just
the screen that launched it. Every heading, column and KPI label comes from
:data:`_L10N`; dates are formatted with localised month names; Arabic runs
through :mod:`app.services.pdf_arabic` so the header does not render as a row of
solid boxes, and Arabic reports are laid out right-to-left.

**Archiving.** A generated report used to exist only as the bytes of one HTTP
response. :func:`archive_report` writes it to disk and records a version, so
« archivage des rapports dans l'historique » is real and a distributed report can
be re-read byte-for-byte as it was sent.
"""
import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from sqlalchemy import inspect, select, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.risk import Risk, RiskStatus, RiskSeverity
from app.models.vendor import Vendor, VendorContract, ContractValidationStatus
from app.models.compliance import ComplianceAssessment, ComplianceGap
from app.models.audit import Audit, AuditFinding
from app.models.action_item import ActionItem
from app.models.audit_recommendation import AuditRecommendation
from app.models.report_distribution import ReportDistribution
from app.models.stored_file_version import StoredFileVersion
from app.models.tenant import Tenant
from app.models.user import User
from app.services import file_integrity, pdf_arabic

logger = logging.getLogger(__name__)


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

# A table that keeps growing stops being a report, but the previous cap was a
# *severity filter*: a medium finding simply never appeared, with nothing saying
# so. Rows are now capped, never filtered, and the cap is printed under the
# table (see ``_more_note``) so the reader knows the list is partial.
MAX_TABLE_ROWS = 100


# ── Localisation ──────────────────────────────────────────────────────────
# Same shape as endpoints/compliance.py's _L10N/_t: a flat key table per
# supported language with an English fallback. Deliberately NOT a new i18n
# mechanism — the frontend keys stay in the frontend; these are the strings that
# are burnt into a PDF, which no browser will ever translate.

_MONTHS_ABBR = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "fr": ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    "ar": ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
}

# Enum/vocabulary values as the reader should see them. The fallback for an
# unknown value is the old behaviour (``replace("_", " ").title()``), so a new
# status added elsewhere degrades to readable English instead of vanishing.
_VOCAB: dict[str, dict[str, str]] = {
    # severities / priorities
    "critical": {"fr": "Critique", "ar": "حرج"},
    "high": {"fr": "Élevé", "ar": "مرتفع"},
    "medium": {"fr": "Moyen", "ar": "متوسط"},
    "low": {"fr": "Faible", "ar": "منخفض"},
    "informational": {"fr": "Informatif", "ar": "إعلامي"},
    "info": {"en": "Informational", "fr": "Informatif", "ar": "إعلامي"},
    # Risk statuses — every member of models.risk.RiskStatus, not a plausible
    # subset. A half-covered enum is not a missing translation, it is a visible
    # English word in a French artefact: "treatment_in_progress" fell through
    # _label's fallback and printed « Treatment In Progress » in the French and
    # Arabic risk reports of the live tenant (5 of its 12 risks). The "-ing"
    # spellings are not produced by the current enum; they are left in place
    # because they cost nothing and other modules still hand them to _label.
    "identified": {"fr": "Identifié", "ar": "محدَّد"},
    "assessed": {"fr": "Évalué", "ar": "مُقيَّم"},
    "treatment_planned": {"en": "Treatment planned", "fr": "Traitement planifié", "ar": "المعالجة مخططة"},
    "treatment_in_progress": {"en": "Treatment in progress", "fr": "Traitement en cours", "ar": "المعالجة قيد التنفيذ"},
    "treated": {"fr": "Traité", "ar": "تمت المعالجة"},
    "analyzing": {"fr": "En analyse", "ar": "قيد التحليل"},
    "mitigating": {"fr": "En traitement", "ar": "قيد المعالجة"},
    "monitoring": {"fr": "Sous surveillance", "ar": "قيد المراقبة"},
    "accepted": {"fr": "Accepté", "ar": "مقبول"},
    "transferred": {"fr": "Transféré", "ar": "مُحوَّل"},
    "avoided": {"fr": "Évité", "ar": "مُتجنَّب"},
    # Treatment options (models.risk.RiskTreatmentOption)
    "mitigate": {"en": "Mitigate", "fr": "Réduire", "ar": "تخفيف"},
    "accept": {"en": "Accept", "fr": "Accepter", "ar": "قبول"},
    "transfer": {"en": "Transfer", "fr": "Transférer", "ar": "نقل"},
    "avoid": {"en": "Avoid", "fr": "Éviter", "ar": "تجنّب"},
    # generic lifecycle
    "draft": {"fr": "Brouillon", "ar": "مسودة"},
    "not_started": {"fr": "Non démarré", "ar": "لم يبدأ"},
    "in_progress": {"fr": "En cours", "ar": "قيد التنفيذ"},
    "completed": {"fr": "Terminé", "ar": "مكتمل"},
    "cancelled": {"fr": "Annulé", "ar": "ملغى"},
    "closed": {"fr": "Clôturé", "ar": "مغلق"},
    "open": {"fr": "Ouvert", "ar": "مفتوح"},
    "pending": {"fr": "En attente", "ar": "قيد الانتظار"},
    "rejected": {"fr": "Rejeté", "ar": "مرفوض"},
    "approved": {"fr": "Validé", "ar": "معتمد"},
    "submitted": {"fr": "Soumis", "ar": "مُقدَّم"},
    "issued": {"fr": "Diffusé", "ar": "صادر"},
    "overdue": {"fr": "En retard", "ar": "متأخر"},
    "active": {"fr": "Actif", "ar": "نشط"},
    "inactive": {"fr": "Inactif", "ar": "غير نشط"},
    "archived": {"fr": "Archivé", "ar": "مؤرشف"},
    "under_review": {"fr": "En revue", "ar": "قيد المراجعة"},
    "onboarding": {"fr": "En intégration", "ar": "قيد الإدماج"},
    "offboarding": {"en": "Offboarding", "fr": "En sortie de relation", "ar": "قيد إنهاء العلاقة"},
    "terminated": {"fr": "Résilié", "ar": "منتهٍ"},
    # Control implementation states (models.compliance.ControlStatus)
    "implemented": {"fr": "Mise en œuvre", "ar": "مُطبَّق"},
    "partially_implemented": {"en": "Partially implemented", "fr": "Partiellement mise en œuvre", "ar": "مُطبَّق جزئيًا"},
    "not_implemented": {"en": "Not implemented", "fr": "Non mise en œuvre", "ar": "غير مُطبَّق"},
    "not_applicable": {"en": "Not applicable", "fr": "Non applicable", "ar": "غير قابل للتطبيق"},
    # Contract review workflow (models.vendor.ContractValidationStatus)
    "pending_ai": {"en": "Pending AI review", "fr": "En attente d'analyse IA", "ar": "بانتظار تحليل الذكاء الاصطناعي"},
    "ai_reviewed": {"en": "AI reviewed", "fr": "Analysé par l'IA", "ar": "تمت مراجعته آليًا"},
    "pending_ciso": {"en": "Pending CISO approval", "fr": "En attente de validation RSSI", "ar": "بانتظار موافقة مسؤول أمن المعلومات"},
    "sent_to_vendor": {"en": "Sent to vendor", "fr": "Transmis au tiers", "ar": "أُرسل إلى الطرف الثالث"},
    # audit lifecycle
    "planning": {"fr": "Planification", "ar": "التخطيط"},
    "fieldwork": {"fr": "Travaux sur site", "ar": "العمل الميداني"},
    "review": {"fr": "Revue", "ar": "المراجعة"},
    "reporting": {"fr": "Rapport", "ar": "إعداد التقرير"},
    "internal": {"fr": "Interne", "ar": "داخلي"},
    "external": {"fr": "Externe", "ar": "خارجي"},
    "regulatory": {"fr": "Réglementaire", "ar": "تنظيمي"},
    "certification": {"fr": "Certification", "ar": "اعتماد"},
    # findings
    "in_remediation": {"fr": "En remédiation", "ar": "قيد المعالجة"},
    "remediated": {"fr": "Remédié", "ar": "تمت المعالجة"},
    "nonconformity_major": {"en": "Major non-conformity", "fr": "Non-conformité majeure", "ar": "عدم مطابقة كبرى"},
    "nonconformity_minor": {"en": "Minor non-conformity", "fr": "Non-conformité mineure", "ar": "عدم مطابقة صغرى"},
    "observation": {"fr": "Observation", "ar": "ملاحظة"},
    "improvement": {"en": "Improvement", "fr": "Piste d'amélioration", "ar": "فرصة تحسين"},
    # action items
    "corrective": {"fr": "Corrective", "ar": "تصحيحي"},
    "preventive": {"fr": "Préventive", "ar": "وقائي"},
}

_L10N: dict[str, dict[str, str]] = {
    "en": {
        # header / footer / chrome
        "period": "Report Period",
        "generated": "Generated {stamp}",
        "confidential": ("CONFIDENTIAL — This report is auto-generated by the GRC Platform. "
                         "Distribution is restricted to authorized personnel only."),
        "no_data": "No data available.",
        "unnamed": "Unnamed",
        "showing_of": "Showing the first {shown} of {total} rows.",
        "yes": "Yes",
        "no": "No",
        # report titles
        "title_executive": "Executive Summary",
        "title_risk": "Risk Register Report",
        "title_vendor": "3rd Party Risk Report",
        "title_compliance": "Compliance Status Report",
        "title_audit": "Audit Status Report",
        "title_audit_single": "Audit Report — {audit}",
        # catalogue descriptions (/reports/types)
        "name_executive": "Executive Summary",
        "name_risk": "Risk Register Report",
        "name_compliance": "Compliance Report",
        "name_vendor": "3rd Party Risk Report",
        "name_audit": "Audit Report",
        "desc_executive": "High-level overview of all GRC modules with KPIs",
        "desc_risk": "Detailed risk register with top risks and upcoming reviews",
        "desc_compliance": "Compliance assessments, scores, and critical gaps",
        "desc_vendor": "Vendor list, risk scores, and contracts pending review",
        "desc_audit": "Active audits and findings",
        # KPI labels
        "kpi_total_risks": "Total Risks",
        "kpi_critical_risks": "Critical Risks",
        "kpi_third_parties": "3rd Parties",
        "kpi_assessments": "Assessments",
        "kpi_critical": "Critical",
        "kpi_high": "High",
        "kpi_medium": "Medium",
        "kpi_low": "Low",
        "kpi_total_vendors": "Total Vendors",
        "kpi_high_critical": "High / Critical",
        "kpi_missing_dpa": "Missing DPA",
        "kpi_avg_score": "Avg. Score",
        "kpi_critical_gaps": "Critical Gaps",
        "kpi_high_gaps": "High Gaps",
        "kpi_total_audits": "Total Audits",
        "kpi_findings": "Findings",
        "kpi_open": "Open",
        "kpi_audit_type": "Audit Type",
        "kpi_status": "Status",
        "kpi_nonconformities": "Non-conformities",
        "kpi_recommendations": "Recommendations",
        "kpi_actions": "Actions",
        # sections
        "sec_risk_overview": "Risk Overview",
        "sec_compliance_overview": "Compliance Overview",
        "sec_vendor_summary": "3rd Party Risk Summary",
        "sec_top_risks": "Top Risks by Inherent Score",
        "sec_reviews": "Upcoming & Overdue Reviews",
        "sec_vendor_register": "Vendor Risk Register",
        "sec_contracts_pending": "Contracts Pending Review",
        "sec_missing_dpa": "Vendors Missing Data Processing Agreement",
        "sec_assessment_status": "Assessment Status",
        "sec_gaps": "Critical & High Gaps",
        "sec_active_audits": "Active Audits",
        "sec_findings": "Findings",
        "sec_scope": "Scope",
        "sec_exec_summary": "Executive Summary",
        "sec_nonconformities": "Non-conformities",
        "sec_recommendations": "Recommendations",
        "sec_action_plan": "Action Plan",
        "sec_approval": "Approval",
        "sec_distribution": "Distribution History",
        # columns
        "col_status": "Status",
        "col_count": "Count",
        "col_assessment": "Assessment",
        "col_score": "Score",
        "col_risk_tier": "Risk Tier",
        "col_title": "Title",
        "col_category": "Category",
        "col_severity": "Severity",
        "col_risk": "Risk",
        "col_review_date": "Review Date",
        "col_vendor": "Vendor",
        "col_industry": "Industry",
        "col_tier": "Tier",
        "col_dpa": "DPA",
        "col_contract": "Contract",
        "col_version": "Ver.",
        "col_uploaded": "Uploaded",
        "col_control": "Control",
        "col_description": "Description",
        "col_created": "Created",
        "col_audit": "Audit",
        "col_type": "Type",
        "col_started": "Started",
        "col_finding": "Finding",
        "col_due": "Due",
        "col_owner": "Owner",
        "col_progress": "Progress",
        "col_action": "Action",
        "col_priority": "Priority",
        "col_reference": "Ref.",
        "col_recommendation": "Recommendation",
        "col_recipients": "Recipients",
        "col_sent": "Sent",
        "col_channel": "Channel",
        "col_linked_finding": "Linked finding",
        # sentences
        "due_overdue": "Overdue by {days} d",
        "due_today": "Today",
        "due_in": "In {days} days",
        "approved_on": "Report approved on {date}.",
        "no_recommendations": "No recommendation has been recorded for this engagement.",
        "no_actions": "No action plan has been linked to this engagement's findings.",
        "unlinked": "Not linked to a finding",
    },
    "fr": {
        "period": "Période du rapport",
        "generated": "Généré le {stamp}",
        "confidential": ("CONFIDENTIEL — Rapport généré automatiquement par la plateforme GRC. "
                         "Sa diffusion est réservée aux personnes habilitées."),
        "no_data": "Aucune donnée disponible.",
        "unnamed": "Sans intitulé",
        "showing_of": "Affichage des {shown} premières lignes sur {total}.",
        "yes": "Oui",
        "no": "Non",
        "title_executive": "Synthèse de direction",
        "title_risk": "Rapport du registre des risques",
        "title_vendor": "Rapport des risques tiers",
        "title_compliance": "Rapport d'état de la conformité",
        "title_audit": "Rapport d'état des audits",
        "title_audit_single": "Rapport d'audit — {audit}",
        "name_executive": "Synthèse de direction",
        "name_risk": "Rapport du registre des risques",
        "name_compliance": "Rapport de conformité",
        "name_vendor": "Rapport des risques tiers",
        "name_audit": "Rapport d'audit",
        "desc_executive": "Vue d'ensemble de tous les modules GRC avec indicateurs clés",
        "desc_risk": "Registre des risques détaillé, risques majeurs et revues à venir",
        "desc_compliance": "Évaluations de conformité, scores et écarts critiques",
        "desc_vendor": "Liste des tiers, scores de risque et contrats en attente de revue",
        "desc_audit": "Audits en cours et constats",
        "kpi_total_risks": "Risques",
        "kpi_critical_risks": "Risques critiques",
        "kpi_third_parties": "Tiers",
        "kpi_assessments": "Évaluations",
        "kpi_critical": "Critique",
        "kpi_high": "Élevé",
        "kpi_medium": "Moyen",
        "kpi_low": "Faible",
        "kpi_total_vendors": "Tiers référencés",
        "kpi_high_critical": "Élevé / Critique",
        "kpi_missing_dpa": "Sans DPA",
        "kpi_avg_score": "Score moyen",
        "kpi_critical_gaps": "Écarts critiques",
        "kpi_high_gaps": "Écarts élevés",
        "kpi_total_audits": "Audits",
        "kpi_findings": "Constats",
        "kpi_open": "Ouverts",
        "kpi_audit_type": "Type d'audit",
        "kpi_status": "Statut",
        "kpi_nonconformities": "Non-conformités",
        "kpi_recommendations": "Recommandations",
        "kpi_actions": "Actions",
        "sec_risk_overview": "Vue d'ensemble des risques",
        "sec_compliance_overview": "Vue d'ensemble de la conformité",
        "sec_vendor_summary": "Synthèse des risques tiers",
        "sec_top_risks": "Principaux risques par score inhérent",
        "sec_reviews": "Revues à venir et en retard",
        "sec_vendor_register": "Registre des risques tiers",
        "sec_contracts_pending": "Contrats en attente de revue",
        "sec_missing_dpa": "Tiers sans accord de traitement des données",
        "sec_assessment_status": "État des évaluations",
        "sec_gaps": "Écarts critiques et élevés",
        "sec_active_audits": "Audits en cours",
        "sec_findings": "Constats",
        "sec_scope": "Périmètre",
        "sec_exec_summary": "Synthèse",
        "sec_nonconformities": "Non-conformités",
        "sec_recommendations": "Recommandations",
        "sec_action_plan": "Plan d'action",
        "sec_approval": "Validation",
        "sec_distribution": "Historique de diffusion",
        "col_status": "Statut",
        "col_count": "Nombre",
        "col_assessment": "Évaluation",
        "col_score": "Score",
        "col_risk_tier": "Niveau de risque",
        "col_title": "Intitulé",
        "col_category": "Catégorie",
        "col_severity": "Gravité",
        "col_risk": "Risque",
        "col_review_date": "Date de revue",
        "col_vendor": "Tiers",
        "col_industry": "Secteur",
        "col_tier": "Niveau",
        "col_dpa": "DPA",
        "col_contract": "Contrat",
        "col_version": "Vers.",
        "col_uploaded": "Déposé le",
        "col_control": "Mesure",
        "col_description": "Description",
        "col_created": "Créé le",
        "col_audit": "Audit",
        "col_type": "Type",
        "col_started": "Débuté le",
        "col_finding": "Constat",
        "col_due": "Échéance",
        "col_owner": "Responsable",
        "col_progress": "Avancement",
        "col_action": "Action",
        "col_priority": "Priorité",
        "col_reference": "Réf.",
        "col_recommendation": "Recommandation",
        "col_recipients": "Destinataires",
        "col_sent": "Envoyé le",
        "col_channel": "Canal",
        "col_linked_finding": "Constat lié",
        "due_overdue": "En retard de {days} j",
        "due_today": "Aujourd'hui",
        "due_in": "Dans {days} jours",
        "approved_on": "Rapport validé le {date}.",
        "no_recommendations": "Aucune recommandation n'a été enregistrée pour cette mission.",
        "no_actions": "Aucun plan d'action n'est rattaché aux constats de cette mission.",
        "unlinked": "Non rattachée à un constat",
    },
    "ar": {
        "period": "فترة التقرير",
        "generated": "أُنشئ في {stamp}",
        "confidential": ("سري — أُنشئ هذا التقرير آليًا بواسطة منصة الحوكمة والمخاطر والامتثال. "
                         "يقتصر تعميمه على الأشخاص المصرَّح لهم."),
        "no_data": "لا توجد بيانات متاحة.",
        "unnamed": "بدون عنوان",
        "showing_of": "عرض أول {shown} صفًا من أصل {total}.",
        "yes": "نعم",
        "no": "لا",
        "title_executive": "الملخص التنفيذي",
        "title_risk": "تقرير سجل المخاطر",
        "title_vendor": "تقرير مخاطر الأطراف الثالثة",
        "title_compliance": "تقرير حالة الامتثال",
        "title_audit": "تقرير حالة عمليات التدقيق",
        "title_audit_single": "تقرير التدقيق — {audit}",
        "name_executive": "الملخص التنفيذي",
        "name_risk": "تقرير سجل المخاطر",
        "name_compliance": "تقرير الامتثال",
        "name_vendor": "تقرير مخاطر الأطراف الثالثة",
        "name_audit": "تقرير التدقيق",
        "desc_executive": "نظرة عامة على جميع وحدات الحوكمة والمخاطر والامتثال مع المؤشرات الرئيسية",
        "desc_risk": "سجل مخاطر مفصّل مع أبرز المخاطر والمراجعات القادمة",
        "desc_compliance": "تقييمات الامتثال والنتائج والفجوات الحرجة",
        "desc_vendor": "قائمة الأطراف الثالثة ودرجات المخاطر والعقود قيد المراجعة",
        "desc_audit": "عمليات التدقيق الجارية والملاحظات",
        "kpi_total_risks": "إجمالي المخاطر",
        "kpi_critical_risks": "المخاطر الحرجة",
        "kpi_third_parties": "الأطراف الثالثة",
        "kpi_assessments": "التقييمات",
        "kpi_critical": "حرج",
        "kpi_high": "مرتفع",
        "kpi_medium": "متوسط",
        "kpi_low": "منخفض",
        "kpi_total_vendors": "إجمالي الأطراف الثالثة",
        "kpi_high_critical": "مرتفع / حرج",
        "kpi_missing_dpa": "بدون اتفاقية معالجة بيانات",
        "kpi_avg_score": "متوسط النتيجة",
        "kpi_critical_gaps": "فجوات حرجة",
        "kpi_high_gaps": "فجوات مرتفعة",
        "kpi_total_audits": "عمليات التدقيق",
        "kpi_findings": "الملاحظات",
        "kpi_open": "مفتوحة",
        "kpi_audit_type": "نوع التدقيق",
        "kpi_status": "الحالة",
        "kpi_nonconformities": "حالات عدم المطابقة",
        "kpi_recommendations": "التوصيات",
        "kpi_actions": "الإجراءات",
        "sec_risk_overview": "نظرة عامة على المخاطر",
        "sec_compliance_overview": "نظرة عامة على الامتثال",
        "sec_vendor_summary": "ملخص مخاطر الأطراف الثالثة",
        "sec_top_risks": "أبرز المخاطر حسب الدرجة الكامنة",
        "sec_reviews": "المراجعات القادمة والمتأخرة",
        "sec_vendor_register": "سجل مخاطر الأطراف الثالثة",
        "sec_contracts_pending": "العقود قيد المراجعة",
        "sec_missing_dpa": "أطراف ثالثة بدون اتفاقية معالجة بيانات",
        "sec_assessment_status": "حالة التقييمات",
        "sec_gaps": "الفجوات الحرجة والمرتفعة",
        "sec_active_audits": "عمليات التدقيق الجارية",
        "sec_findings": "الملاحظات",
        "sec_scope": "النطاق",
        "sec_exec_summary": "الملخص التنفيذي",
        "sec_nonconformities": "حالات عدم المطابقة",
        "sec_recommendations": "التوصيات",
        "sec_action_plan": "خطة العمل",
        "sec_approval": "الاعتماد",
        "sec_distribution": "سجل التعميم",
        "col_status": "الحالة",
        "col_count": "العدد",
        "col_assessment": "التقييم",
        "col_score": "النتيجة",
        "col_risk_tier": "مستوى المخاطر",
        "col_title": "العنوان",
        "col_category": "الفئة",
        "col_severity": "الخطورة",
        "col_risk": "الخطر",
        "col_review_date": "تاريخ المراجعة",
        "col_vendor": "الطرف الثالث",
        "col_industry": "القطاع",
        "col_tier": "المستوى",
        "col_dpa": "اتفاقية المعالجة",
        "col_contract": "العقد",
        "col_version": "الإصدار",
        "col_uploaded": "تاريخ الرفع",
        "col_control": "الضابط",
        "col_description": "الوصف",
        "col_created": "تاريخ الإنشاء",
        "col_audit": "التدقيق",
        "col_type": "النوع",
        "col_started": "تاريخ البدء",
        "col_finding": "الملاحظة",
        "col_due": "الاستحقاق",
        "col_owner": "المسؤول",
        "col_progress": "نسبة الإنجاز",
        "col_action": "الإجراء",
        "col_priority": "الأولوية",
        "col_reference": "المرجع",
        "col_recommendation": "التوصية",
        "col_recipients": "المستلمون",
        "col_sent": "تاريخ الإرسال",
        "col_channel": "القناة",
        "col_linked_finding": "الملاحظة المرتبطة",
        "due_overdue": "متأخر بـ {days} يومًا",
        "due_today": "اليوم",
        "due_in": "خلال {days} يومًا",
        "approved_on": "تم اعتماد التقرير في {date}.",
        "no_recommendations": "لم تُسجَّل أي توصية لهذه المهمة.",
        "no_actions": "لا توجد خطة عمل مرتبطة بملاحظات هذه المهمة.",
        "unlinked": "غير مرتبط بملاحظة",
    },
}

SUPPORTED_REPORT_LANGS = tuple(_L10N.keys())


def _lang(value) -> str:
    """Coerce anything to a language this module has strings for.

    Delegates to ai_locale so "fr-FR", "Arabic" and "français" all resolve the
    same way they do on the AI and notification paths — one language resolver
    for the whole backend, not a second one invented here.
    """
    try:
        from app.services.ai_locale import normalize_language

        return normalize_language(value) or "en"
    except Exception:  # noqa: BLE001 — a locale lookup must never fail a report
        code = str(value or "en").strip().lower()[:2]
        return code if code in _L10N else "en"


def _t(lang: str, key: str, **fmt) -> str:
    """Platform-authored report string in the requested language (en/fr/ar)."""
    table = _L10N.get(lang) or _L10N["en"]
    text = table.get(key) or _L10N["en"].get(key) or key
    return text.format(**fmt) if fmt else text


def _is_rtl(lang: str) -> bool:
    return lang == "ar"


def _enum_value(value) -> str:
    """The stored value of an enum column, never its Python repr.

    ``Audit.status`` is a ``str``-mixin enum, so ``str(AuditStatus.FIELDWORK)``
    yields ``"AuditStatus.FIELDWORK"``. Rendering that is how the downloadable
    report came to print "Auditstatus.Fieldwork" and "Findingstatus.Open".
    ``.value`` first, plain ``str`` only for the columns that really are strings.
    """
    if value is None:
        return ""
    inner = getattr(value, "value", None)
    if inner is not None:
        return str(inner)
    return str(value)


def _label(lang: str, value, default: str = "—") -> str:
    """A vocabulary value as the reader should see it, translated when known."""
    raw = _enum_value(value).strip()
    if not raw:
        return default
    entry = _VOCAB.get(raw.lower())
    if entry:
        return entry.get(lang) or entry.get("en") or raw.replace("_", " ").title()
    return raw.replace("_", " ").title()


# ── Vocabulary for the generic register exports ───────────────────────────
# services/tabular_pdf.py and services/excel_export.py render a list of row
# dicts straight from an endpoint, so their headers were the raw ORM column
# names ("next_review_date") and their document title was the table name
# title-cased ("Framework Controls") — English in every language, in the one
# artefact that leaves the platform and lands in an examiner's file. There is
# no other header vocabulary anywhere in the codebase to reuse: `_VOCAB` above
# translates enum VALUES, which is a different problem.
#
# Deliberately headers and titles ONLY, never cell values: an xlsx/csv export is
# also the input to /data/import/*, and a translated "operational" would not
# import back. Unknown names fall through to today's Title Case, so a column
# added elsewhere degrades to English instead of vanishing.
_COLUMNS: dict[str, dict[str, str]] = {
    "applicable_industries": {"fr": "Secteurs applicables", "ar": "القطاعات المعنية"},
    "applicable_regions": {"fr": "Régions applicables", "ar": "المناطق المعنية"},
    "assessment_end": {"fr": "Fin de l'évaluation", "ar": "نهاية التقييم"},
    "assessment_start": {"fr": "Début de l'évaluation", "ar": "بداية التقييم"},
    "asset_class": {"fr": "Classe d'actif", "ar": "فئة الأصل"},
    "asset_type": {"fr": "Type d'actif", "ar": "نوع الأصل"},
    "audit_id": {"fr": "Identifiant de la mission", "ar": "معرّف المهمة"},
    "audit_status": {"fr": "Statut de la mission", "ar": "حالة المهمة"},
    "audit_title": {"fr": "Mission d'audit", "ar": "مهمة التدقيق"},
    "audit_type": {"fr": "Type d'audit", "ar": "نوع التدقيق"},
    "breach_notification_required": {"fr": "Notification de violation requise", "ar": "إشعار الاختراق مطلوب"},
    "business_impact": {"fr": "Impact métier", "ar": "الأثر على النشاط"},
    "category": {"fr": "Catégorie", "ar": "الفئة"},
    "cloned_from_framework_id": {"fr": "Cloné depuis (référentiel)", "ar": "منسوخ من (مرجع)"},
    "closed_at": {"fr": "Clôturé le", "ar": "تاريخ الإغلاق"},
    "closure_note": {"fr": "Note de clôture", "ar": "ملاحظة الإغلاق"},
    "cloud_provider": {"fr": "Fournisseur cloud", "ar": "مزوّد السحابة"},
    "compliance_score": {"fr": "Score de conformité", "ar": "درجة الامتثال"},
    "contains_pci": {"fr": "Données PCI", "ar": "بيانات PCI"},
    "contains_phi": {"fr": "Données de santé", "ar": "بيانات صحية"},
    "contains_pii": {"fr": "Données personnelles", "ar": "بيانات شخصية"},
    "contract_expiry": {"fr": "Échéance du contrat", "ar": "انتهاء العقد"},
    "control_id": {"fr": "Identifiant du contrôle", "ar": "معرّف الضابط"},
    "control_ref": {"fr": "Contrôle de référence", "ar": "الضابط المرجعي"},
    "controls_count": {"fr": "Nombre de contrôles", "ar": "عدد الضوابط"},
    "cost": {"fr": "Coût", "ar": "التكلفة"},
    "country": {"fr": "Pays", "ar": "البلد"},
    "created_at": {"fr": "Créé le", "ar": "تاريخ الإنشاء"},
    "criticality": {"fr": "Criticité", "ar": "الأهمية الحرجة"},
    "cvss_score": {"fr": "Score CVSS", "ar": "درجة CVSS"},
    "data_classification": {"fr": "Classification des données", "ar": "تصنيف البيانات"},
    "description": {"fr": "Description", "ar": "الوصف"},
    "detected_at": {"fr": "Détecté le", "ar": "تاريخ الاكتشاف"},
    "domain": {"fr": "Domaine", "ar": "المجال"},
    "due_date": {"fr": "Échéance", "ar": "تاريخ الاستحقاق"},
    "effective_date": {"fr": "Date d'entrée en vigueur", "ar": "تاريخ السريان"},
    "expiration_date": {"fr": "Date d'expiration", "ar": "تاريخ الانتهاء"},
    "financial_impact": {"fr": "Impact financier", "ar": "الأثر المالي"},
    "finding_type": {"fr": "Type de constat", "ar": "نوع الملاحظة"},
    "framework": {"fr": "Référentiel", "ar": "المرجع"},
    "framework_short_name": {"fr": "Référentiel (abrégé)", "ar": "المرجع (اختصار)"},
    "framework_version": {"fr": "Version du référentiel", "ar": "إصدار المرجع"},
    "guidance": {"fr": "Guide d'application", "ar": "إرشادات التطبيق"},
    "has_dpa": {"fr": "Accord de traitement (DPA)", "ar": "اتفاقية معالجة البيانات"},
    "hosting_type": {"fr": "Type d'hébergement", "ar": "نوع الاستضافة"},
    "id": {"fr": "Identifiant", "ar": "المعرّف"},
    "impact": {"fr": "Impact", "ar": "الأثر"},
    "industry": {"fr": "Secteur", "ar": "القطاع"},
    "inherent_score": {"fr": "Score inhérent", "ar": "الدرجة الكامنة"},
    "info": {"fr": "Information", "ar": "معلومة"},
    "is_builtin": {"fr": "Intégré", "ar": "مدمج"},
    "is_mandatory": {"fr": "Obligatoire", "ar": "إلزامي"},
    "is_tenant_copy": {"fr": "Copie de l'organisation", "ar": "نسخة المؤسسة"},
    "issuing_body": {"fr": "Organisme émetteur", "ar": "الجهة المُصدِرة"},
    "lifecycle_state": {"fr": "État du cycle de vie", "ar": "مرحلة دورة الحياة"},
    "likelihood": {"fr": "Probabilité", "ar": "الاحتمالية"},
    "location": {"fr": "Localisation", "ar": "الموقع"},
    "management_response": {"fr": "Réponse de la direction", "ar": "رد الإدارة"},
    "mapped_controls": {"fr": "Contrôles correspondants", "ar": "الضوابط المقابلة"},
    "mitre_ids": {"fr": "Identifiants MITRE", "ar": "معرّفات MITRE"},
    "name": {"fr": "Nom", "ar": "الاسم"},
    "next_review_date": {"fr": "Prochaine revue", "ar": "المراجعة القادمة"},
    "owner_id": {"fr": "Responsable", "ar": "المسؤول"},
    "parent_control_id": {"fr": "Contrôle parent", "ar": "الضابط الأب"},
    "planned_end": {"fr": "Fin prévue", "ar": "النهاية المخططة"},
    "planned_start": {"fr": "Début prévu", "ar": "البداية المخططة"},
    "policy_number": {"fr": "Numéro de politique", "ar": "رقم السياسة"},
    "probability_level": {"fr": "Niveau de probabilité", "ar": "مستوى الاحتمال"},
    "progress": {"fr": "Avancement", "ar": "نسبة الإنجاز"},
    "recommendation": {"fr": "Recommandation", "ar": "التوصية"},
    "ref_id": {"fr": "Référence", "ar": "المرجع"},
    "remediation_notes": {"fr": "Notes de remédiation", "ar": "ملاحظات المعالجة"},
    "remediation_owner_id": {"fr": "Responsable de la remédiation", "ar": "مسؤول المعالجة"},
    "requirement_type": {"fr": "Type d'exigence", "ar": "نوع المتطلب"},
    "requirements": {"fr": "Exigences", "ar": "المتطلبات"},
    "residual_impact": {"fr": "Impact résiduel", "ar": "الأثر المتبقي"},
    "residual_likelihood": {"fr": "Probabilité résiduelle", "ar": "الاحتمالية المتبقية"},
    "resolved_at": {"fr": "Résolu le", "ar": "تاريخ الحل"},
    "review_frequency_months": {"fr": "Fréquence de revue (mois)", "ar": "دورية المراجعة (أشهر)"},
    "risk_category": {"fr": "Catégorie de risque", "ar": "فئة الخطر"},
    "risk_score": {"fr": "Score de risque", "ar": "درجة الخطر"},
    "risk_tier": {"fr": "Niveau de risque", "ar": "مستوى الخطر"},
    "root_cause": {"fr": "Cause racine", "ar": "السبب الجذري"},
    "scope": {"fr": "Périmètre", "ar": "النطاق"},
    "scope_type": {"fr": "Type de périmètre", "ar": "نوع النطاق"},
    "services_provided": {"fr": "Services fournis", "ar": "الخدمات المقدَّمة"},
    "severity": {"fr": "Gravité", "ar": "الخطورة"},
    "severity_level": {"fr": "Niveau de gravité", "ar": "مستوى الخطورة"},
    "short_name": {"fr": "Nom abrégé", "ar": "الاسم المختصر"},
    "sort_order": {"fr": "Ordre", "ar": "الترتيب"},
    "source_type": {"fr": "Type de source", "ar": "نوع المصدر"},
    "status": {"fr": "Statut", "ar": "الحالة"},
    "tags": {"fr": "Étiquettes", "ar": "الوسوم"},
    "title": {"fr": "Intitulé", "ar": "العنوان"},
    "type": {"fr": "Type", "ar": "النوع"},
    "typical_attack_vectors": {"fr": "Vecteurs d'attaque typiques", "ar": "متجهات الهجوم النمطية"},
    "typical_threat_actors": {"fr": "Acteurs de menace typiques", "ar": "الجهات المهدِّدة النمطية"},
    "version": {"fr": "Version", "ar": "الإصدار"},
    "website": {"fr": "Site web", "ar": "الموقع الإلكتروني"},
}

# Document/sheet titles for the same generic exports. Keyed by the register key
# the endpoint already uses (data_io's root_tag, report_builder's dataset name);
# a trailing "_export" is tolerated so a file stem can be passed straight in.
_REGISTERS: dict[str, dict[str, str]] = {
    "risks": {"en": "Risk Register", "fr": "Registre des risques", "ar": "سجل المخاطر"},
    "vendors": {"en": "Third Parties", "fr": "Tiers et fournisseurs", "ar": "الأطراف الثالثة"},
    "assets": {"en": "Asset Inventory", "fr": "Inventaire des actifs", "ar": "جرد الأصول"},
    "audits": {"en": "Audits", "fr": "Missions d'audit", "ar": "مهام التدقيق"},
    "audit_findings": {"en": "Audit Findings", "fr": "Constats d'audit", "ar": "ملاحظات التدقيق"},
    "policies": {"en": "Policies", "fr": "Politiques", "ar": "السياسات"},
    "compliance": {"en": "Compliance Assessments", "fr": "Évaluations de conformité", "ar": "تقييمات الامتثال"},
    "compliance_assessments": {"en": "Compliance Assessments", "fr": "Évaluations de conformité", "ar": "تقييمات الامتثال"},
    "threats": {"en": "Threat Library", "fr": "Bibliothèque des menaces", "ar": "مكتبة التهديدات"},
    "applied_controls": {"en": "Applied Controls", "fr": "Contrôles appliqués", "ar": "الضوابط المطبَّقة"},
    "frameworks": {"en": "Frameworks", "fr": "Référentiels", "ar": "المراجع"},
    "framework_controls": {"en": "Framework Controls", "fr": "Contrôles des référentiels", "ar": "ضوابط المراجع"},
    "vulnerabilities": {"en": "Vulnerabilities", "fr": "Vulnérabilités", "ar": "الثغرات"},
    "incidents": {"en": "Incidents", "fr": "Incidents", "ar": "الحوادث"},
}


def column_label(lang, name: str) -> str:
    """A register column header as the reader should see it.

    Falls back to the previous behaviour — the raw name, underscores replaced,
    Title Case — for anything not in the table, so an export never loses a
    column because nobody translated it.
    """
    raw = str(name or "").strip()
    if not raw:
        return raw
    entry = _COLUMNS.get(raw.lower())
    fallback = raw.replace("_", " ").title()
    if not entry:
        return fallback
    return entry.get(_lang(lang)) or entry.get("en") or fallback


def register_label(lang, key: str) -> str:
    """The title of a generic register export (document heading / sheet name)."""
    raw = str(key or "").strip().lower()
    if raw.endswith("_export"):
        raw = raw[: -len("_export")]
    entry = _REGISTERS.get(raw)
    fallback = str(key or "").replace("_", " ").title()
    if not entry:
        return fallback
    return entry.get(_lang(lang)) or entry.get("en") or fallback


def _as_date(value) -> date | None:
    """Best-effort date from a datetime, a date, or an ISO-ish string column."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _fmt_date(value, lang: str, default: str = "—") -> str:
    """``12 févr. 2026`` / ``12 Feb 2026`` / ``12 فبراير 2026``.

    strftime("%d %b %Y") is locale-dependent at the C level and, in this
    container, always English — which is how a French report ended up with
    British dates. Month names come from :data:`_MONTHS_ABBR` instead.
    """
    d = _as_date(value)
    if d is None:
        text = str(value or "").strip()
        return text or default
    months = _MONTHS_ABBR.get(lang) or _MONTHS_ABBR["en"]
    return f"{d.day:02d} {months[d.month - 1]} {d.year}"


def _fmt_datetime(value: datetime, lang: str) -> str:
    """Date + UTC clock, for the "generated at" stamp."""
    return f"{_fmt_date(value, lang)}, {value.strftime('%H:%M')} UTC"


def _styles(lang: str = "en"):
    """Paragraph styles for one report. RTL swaps the text alignment.

    The Arabic *font* is not set here: pdf_arabic.paragraph_markup wraps only the
    Arabic runs in a <font> tag, so a mixed heading ("ISO 27001 — النطاق") keeps
    its Latin typography and picks up the Arabic face exactly where needed.
    """
    align = TA_RIGHT if _is_rtl(lang) else TA_LEFT
    s = getSampleStyleSheet()
    s.add(ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=18, textColor=NAVY, spaceAfter=4, leading=22, alignment=align))
    s.add(ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=12, textColor=DARK_BLUE, spaceBefore=16, spaceAfter=6, leading=15, alignment=align))
    s.add(ParagraphStyle("H3", fontName="Helvetica-Bold", fontSize=10, textColor=GRAY_900, spaceBefore=10, spaceAfter=4, alignment=align))
    s.add(ParagraphStyle("Body", fontName="Helvetica", fontSize=9, textColor=GRAY_700, leading=13, spaceAfter=4, alignment=align))
    s.add(ParagraphStyle("Small", fontName="Helvetica", fontSize=7.5, textColor=GRAY_500, leading=10, alignment=align))
    s.add(ParagraphStyle("Footer", fontName="Helvetica", fontSize=7, textColor=GRAY_500, alignment=TA_CENTER))
    s.add(ParagraphStyle("KPIValue", fontName="Helvetica-Bold", fontSize=14, textColor=NAVY, alignment=TA_CENTER, leading=18))
    s.add(ParagraphStyle("KPILabel", fontName="Helvetica", fontSize=7, textColor=GRAY_500, alignment=TA_CENTER, leading=10))
    s.add(ParagraphStyle("MetaRight", fontName="Helvetica", fontSize=8, textColor=GRAY_500, alignment=TA_LEFT if _is_rtl(lang) else TA_RIGHT, leading=11))
    return s


# ── Reusable Components ───────────────────────────────────────────────────

def _p(text, style, width: float | None = None) -> Paragraph:
    """Paragraph whose Arabic runs carry an Arabic-capable font.

    Everything user- or platform-authored goes through here; a bare
    ``Paragraph(text)`` on an Arabic tenant name renders as solid boxes, which
    is precisely what the report header used to do.

    ``width`` is the width the flowable will be laid out in — the frame, unless
    the caller says otherwise. Arabic has to be line-broken before it is
    bidi-reordered (see pdf_arabic.wrapped_markup), so a paragraph that wraps
    reads top-to-bottom instead of last-line-first. Latin text is unaffected.
    """
    style_font = getattr(style, "fontName", "") or ""
    return Paragraph(
        pdf_arabic.wrapped_markup(
            "" if text is None else str(text),
            PAGE_W if width is None else width,
            getattr(style, "fontSize", 9) or 9,
            bold="Bold" in style_font,
        ),
        style,
    )


def _header(st, org: str, title: str, start: str, end: str, lang: str = "en"):
    """Professional header with org name, title, and date range."""
    els = []
    # Top line
    els.append(HRFlowable(width="100%", thickness=2, color=NAVY, spaceAfter=8))
    # Two-column header: identity block + meta block. The org name and title are
    # tenant data and are very often Arabic, so both halves are built from
    # paragraph_markup rather than raw f-string interpolation.
    id_width = PAGE_W * 0.65
    left = Paragraph(
        f"<font size='8' color='#6b7280'>"
        f"{pdf_arabic.wrapped_markup((org or '').upper(), id_width, 8)}</font><br/>"
        f"<font size='16' color='#1a2332'><b>"
        f"{pdf_arabic.wrapped_markup(title, id_width, 16, bold=True)}</b></font>",
        ParagraphStyle("_hdl", parent=st["Normal"], alignment=TA_RIGHT if _is_rtl(lang) else TA_LEFT, leading=20),
    )
    right = Paragraph(
        f"<font size='8' color='#6b7280'>{pdf_arabic.paragraph_markup(_t(lang, 'period'))}</font><br/>"
        f"<font size='9' color='#111827'><b>{pdf_arabic.paragraph_markup(f'{start} — {end}')}</b></font><br/>"
        f"<font size='7' color='#9ca3af'>"
        f"{pdf_arabic.paragraph_markup(_t(lang, 'generated', stamp=_fmt_datetime(datetime.utcnow(), lang)))}</font>",
        st["MetaRight"],
    )
    # Right-to-left reading order puts the identity block on the right.
    cells = [right, left] if _is_rtl(lang) else [left, right]
    widths = [PAGE_W * 0.35, PAGE_W * 0.65] if _is_rtl(lang) else [PAGE_W * 0.65, PAGE_W * 0.35]
    t = Table([cells], colWidths=widths)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    els.append(t)
    els.append(Spacer(1, 4))
    els.append(HRFlowable(width="100%", thickness=0.5, color=GRAY_300, spaceAfter=14))
    return els


def _kpi_bar(kpis: list[dict], lang: str = "en"):
    """Compact KPI bar — value over label, separated by thin lines."""
    n = len(kpis)
    if n == 0:
        return Spacer(1, 1)

    # RTL reads the strip right to left, so the first KPI has to be rightmost.
    if _is_rtl(lang):
        kpis = list(reversed(kpis))

    cw = PAGE_W / n
    vals = []
    labs = []
    for kpi in kpis:
        vals.append(Paragraph(
            f"<b>{pdf_arabic.wrapped_markup(kpi['value'], cw, 16, bold=True)}</b>",
            ParagraphStyle("_kv", fontName="Helvetica-Bold", fontSize=16, textColor=NAVY,
                           alignment=TA_CENTER, leading=18),
        ))
        labs.append(Paragraph(
            pdf_arabic.wrapped_markup(kpi["label"], cw, 7),
            ParagraphStyle("_kl", fontName="Helvetica", fontSize=7, textColor=GRAY_500, alignment=TA_CENTER),
        ))

    # Heights are computed, not fixed at [24, 12]. Some KPI values are words, not
    # numbers ("Fieldwork", "Internal"), and their translations are longer than
    # the column is wide: "Travaux sur site" wrapped to a second line that a
    # 24pt row could not hold, so it printed on top of the KPI label underneath
    # ("Travaux surStatut site"). Letting the rows size themselves keeps the
    # English strip visually identical and stops the French/Arabic collision.
    t = Table([vals, labs], colWidths=[cw] * n)
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


_AR_CELL = ParagraphStyle("_arcell", fontName="Helvetica", fontSize=8, leading=10,
                          textColor=GRAY_700, alignment=TA_RIGHT)
_AR_HEAD = ParagraphStyle("_arhead", fontName="Helvetica-Bold", fontSize=8, leading=10,
                          textColor=WHITE, alignment=TA_RIGHT)
# Latin-script counterparts. Same font, size and colour the TableStyle applies to
# a plain string cell, so promoting a cell to a Paragraph changes where the text
# breaks and nothing else about how it looks.
_LTR_CELL = ParagraphStyle("_ltrcell", fontName="Helvetica", fontSize=8, leading=10,
                           textColor=GRAY_700, alignment=TA_LEFT)
_LTR_HEAD = ParagraphStyle("_ltrhead", fontName="Helvetica-Bold", fontSize=8, leading=10,
                           textColor=WHITE, alignment=TA_LEFT)


def _cell(value):
    """Table cell, promoted to a right-aligned Arabic Paragraph when needed.

    Client data (risk titles, asset and vendor names) is where Arabic actually
    turns up, and a plain string cell renders through the table's Helvetica —
    which has no Arabic glyphs, so the text came out as solid boxes. Latin
    values are returned *identically* (same object), which is the contract
    ``scripts/selftest_pdf_arabic.py`` pins.

    :func:`_text_cell` is what the tables actually use — it also knows the
    column width, which Arabic line-breaking needs. This narrower helper is kept
    because the self-test asserts the promotion rule on its own.
    """
    if not isinstance(value, str) or not pdf_arabic.has_arabic(value):
        return value
    return Paragraph(pdf_arabic.paragraph_markup(value), _AR_CELL)


def _cell_width(width: float | None) -> float | None:
    """Usable text width of a table column: its width less the cell padding.

    Only ever used to decide where an Arabic line breaks — see
    :func:`_text_cell` — so an approximation is fine, but it has to be an
    under-estimate, not an over-estimate.
    """
    if not width:
        return None
    return max(width - 16.0, 24.0)


def _text_cell(value, lang: str = "en", width: float | None = None):
    """A body cell that wraps inside its column instead of bleeding into the next.

    A plain string cell is painted by the table itself, which neither wraps nor
    clips — it keeps drawing past the column edge. English values mostly fit;
    their translations are 20-40% longer ("Fieldwork" → "Travaux sur site",
    "Owner" → "Responsable"), so tables that read cleanly in English printed
    « incomplètesÉlevé » in French, one column's text over the next one's.
    Promoting every *string* to a Paragraph makes it wrap at the column boundary
    in all three languages; numbers stay plain values and keep the table's own
    typography, so a purely numeric table is unchanged.

    ``width`` is the column the cell will be laid out in. Arabic must be
    line-broken before the bidi reordering ReportLab knows nothing about, or a
    wrapped cell reads last-line-first; ``pdf_arabic.wrapped_markup`` leaves
    Latin values exactly as they were.
    """
    if not isinstance(value, str):
        return value
    style = _AR_CELL if (_is_rtl(lang) or pdf_arabic.has_arabic(value)) else _LTR_CELL
    return Paragraph(pdf_arabic.wrapped_markup(value, _cell_width(width), 8), style)


def _text_head(value, lang: str = "en", width: float | None = None):
    """Header cell — same wrapping rule, in the header row's white bold typography."""
    if not isinstance(value, str):
        return value
    style = _AR_HEAD if (_is_rtl(lang) or pdf_arabic.has_arabic(value)) else _LTR_HEAD
    return Paragraph(pdf_arabic.wrapped_markup(value, _cell_width(width), 8, bold=True), style)


def _table(headers: list[str], rows: list[list], widths=None, lang: str = "en"):
    """Clean data table with subtle styling."""
    if not rows:
        return Paragraph(
            f"<i>{pdf_arabic.wrapped_markup(_t(lang, 'no_data'), PAGE_W, 9)}</i>",
            ParagraphStyle("_nd", fontName="Helvetica-Oblique", fontSize=9, textColor=GRAY_500,
                           alignment=TA_RIGHT if _is_rtl(lang) else TA_LEFT),
        )

    if not widths:
        widths = [PAGE_W / len(headers)] * len(headers)

    # An Arabic report reads right to left: the first logical column belongs on
    # the right-hand edge, so the column order (and its widths) are mirrored.
    if _is_rtl(lang):
        headers = list(reversed(headers))
        widths = list(reversed(widths))
        rows = [list(reversed(row)) for row in rows]

    rows = [[_text_cell(c, lang, widths[i] if i < len(widths) else None)
             for i, c in enumerate(row)] for row in rows]
    data = [[_text_head(h, lang, widths[i] if i < len(widths) else None)
             for i, h in enumerate(headers)]] + rows

    # The gutter belongs on the side the language starts from, so an Arabic table
    # is not printed hard against the column rule on its right.
    pad_side = "RIGHTPADDING" if _is_rtl(lang) else "LEFTPADDING"

    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        (pad_side, (0, 0), (-1, 0), 8),
        # Body
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("TEXTCOLOR", (0, 1), (-1, -1), GRAY_700),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        (pad_side, (0, 1), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, GRAY_100]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, GRAY_300),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _more_note(st, shown: int, total: int, lang: str):
    """Say out loud that a table was capped.

    A silently truncated table is how a reader ends up believing an engagement
    had 15 findings when it had 62 — the same class of defect as the severity
    filter this replaced.
    """
    if total <= shown:
        return None
    return _p(_t(lang, "showing_of", shown=shown, total=total), st["Small"])


def _status_dot(status_text: str) -> str:
    """Return a colored bullet + status text for use in Paragraph."""
    c = "#059669" if status_text.lower() in ("active", "in progress", "completed", "implemented") else \
        "#d97706" if status_text.lower() in ("draft", "pending", "onboarding") else \
        "#dc2626" if status_text.lower() in ("overdue", "critical", "rejected") else "#6b7280"
    return f"<font color='{c}'>&bull;</font> {status_text}"


def _footer(lang: str = "en"):
    """Confidentiality footer."""
    return Paragraph(
        pdf_arabic.wrapped_markup(_t(lang, "confidential"), PAGE_W, 6.5),
        ParagraphStyle("_ft", fontName="Helvetica", fontSize=6.5, textColor=GRAY_500,
                       alignment=TA_CENTER, spaceBefore=20),
    )


def _section(st, title: str):
    return _p(title, st["H2"])


def _period(lang: str) -> tuple[str, str]:
    """The rolling 7-day window every tenant-wide report covers."""
    now = datetime.utcnow()
    return _fmt_date(now - timedelta(days=7), lang), _fmt_date(now, lang)


def _doc(buf: BytesIO, title: str) -> SimpleDocTemplate:
    return SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.5 * inch, bottomMargin=0.5 * inch, title=title,
    )


async def _render(buf: BytesIO, title: str, els: list) -> bytes:
    """Lay the assembled flowables out on pages, off the event loop.

    ReportLab's build is pure CPU and a full compliance or audit report is
    hundreds of milliseconds of it. Production runs two uvicorn workers, so a
    report rendered inline stalls every other request that worker is serving —
    including the SPA's polling calls, and a stalled call is what the
    /service-down redirect reacts to. All the ORM work is finished by the time
    a caller gets here, so the thread touches nothing async.

    Same pattern data_io.py and report_builder.py already use for
    rows_to_pdf/rows_to_xlsx, so the two rendering paths agree.
    """
    await asyncio.to_thread(_doc(buf, title).build, els)
    return buf.getvalue()


# ── Report Generators ─────────────────────────────────────────────────────

async def generate_executive_summary(db: AsyncSession, tenant_id: str, org: str, lang: str = "en") -> bytes:
    lang = _lang(lang)
    buf = BytesIO()
    st = _styles(lang)
    els = []
    ws, we = _period(lang)
    els.extend(_header(st, org, _t(lang, "title_executive"), ws, we, lang))

    # KPIs
    total_risks = (await db.execute(select(func.count(Risk.id)).where(Risk.tenant_id == tenant_id))).scalar() or 0
    critical_risks = (await db.execute(select(func.count(Risk.id)).where(Risk.tenant_id == tenant_id, Risk.severity == RiskSeverity.CRITICAL))).scalar() or 0
    total_vendors = (await db.execute(select(func.count(Vendor.id)).where(Vendor.tenant_id == tenant_id))).scalar() or 0
    total_assess = (await db.execute(select(func.count(ComplianceAssessment.id)).where(ComplianceAssessment.tenant_id == tenant_id))).scalar() or 0

    els.append(_kpi_bar([
        {"value": total_risks, "label": _t(lang, "kpi_total_risks")},
        {"value": critical_risks, "label": _t(lang, "kpi_critical_risks")},
        {"value": total_vendors, "label": _t(lang, "kpi_third_parties")},
        {"value": total_assess, "label": _t(lang, "kpi_assessments")},
    ], lang))

    # Risk by status
    els.append(_section(st, _t(lang, "sec_risk_overview")))
    r = await db.execute(select(Risk.status, func.count(Risk.id)).where(Risk.tenant_id == tenant_id).group_by(Risk.status))
    rows = [[_label(lang, s[0]), str(s[1])] for s in r]
    els.append(_table([_t(lang, "col_status"), _t(lang, "col_count")], rows, [PAGE_W * 0.65, PAGE_W * 0.35], lang))

    # Compliance
    els.append(_section(st, _t(lang, "sec_compliance_overview")))
    assessments = list((await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id).limit(10))).scalars().all())
    rows = []
    for a in assessments:
        score = f"{a.compliance_score:.0f}%" if a.compliance_score is not None else "—"
        rows.append([a.name[:50] if a.name else _t(lang, "unnamed"), _label(lang, a.status), score])
    els.append(_table(
        [_t(lang, "col_assessment"), _t(lang, "col_status"), _t(lang, "col_score")],
        rows, [PAGE_W * 0.55, PAGE_W * 0.25, PAGE_W * 0.20], lang,
    ))

    # Vendors
    els.append(_section(st, _t(lang, "sec_vendor_summary")))
    vr = await db.execute(select(Vendor.risk_tier, func.count(Vendor.id)).where(Vendor.tenant_id == tenant_id).group_by(Vendor.risk_tier))
    rows = [[_label(lang, t[0]), str(t[1])] for t in vr]
    els.append(_table([_t(lang, "col_risk_tier"), _t(lang, "col_count")], rows, [PAGE_W * 0.65, PAGE_W * 0.35], lang))

    els.append(_footer(lang))
    return await _render(buf, _t(lang, "title_executive"), els)


async def generate_risk_report(db: AsyncSession, tenant_id: str, org: str, lang: str = "en") -> bytes:
    lang = _lang(lang)
    buf = BytesIO()
    st = _styles(lang)
    els = []
    ws, we = _period(lang)
    els.extend(_header(st, org, _t(lang, "title_risk"), ws, we, lang))

    risks = list((await db.execute(select(Risk).where(Risk.tenant_id == tenant_id).order_by(Risk.created_at.desc()))).scalars().all())
    sev = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in risks:
        k = _enum_value(r.severity)
        if k in sev:
            sev[k] += 1

    els.append(_kpi_bar([
        {"value": sev["critical"], "label": _t(lang, "kpi_critical")},
        {"value": sev["high"], "label": _t(lang, "kpi_high")},
        {"value": sev["medium"], "label": _t(lang, "kpi_medium")},
        {"value": sev["low"], "label": _t(lang, "kpi_low")},
    ], lang))

    els.append(_section(st, _t(lang, "sec_top_risks")))
    scored = sorted([r for r in risks if r.likelihood and r.impact], key=lambda r: (r.likelihood or 0) * (r.impact or 0), reverse=True)[:10]
    rows = []
    for r in scored:
        score = (r.likelihood or 0) * (r.impact or 0)
        rows.append([r.title[:50], r.risk_category[:20] if r.risk_category else "—", f"{score:.1f}",
                     _label(lang, r.severity), _label(lang, r.status)])
    els.append(_table(
        [_t(lang, "col_title"), _t(lang, "col_category"), _t(lang, "col_score"),
         _t(lang, "col_severity"), _t(lang, "col_status")],
        rows,
        [PAGE_W * 0.32, PAGE_W * 0.18, PAGE_W * 0.12, PAGE_W * 0.16, PAGE_W * 0.22],
        lang,
    ))

    # Overdue reviews
    els.append(_section(st, _t(lang, "sec_reviews")))
    today = datetime.utcnow().date()
    overdue = []
    for r in risks:
        d = _as_date(r.next_review_date)
        if d is None:
            continue
        days = (d - today).days
        if days <= 14:
            label = (_t(lang, "due_overdue", days=abs(days)) if days < 0
                     else _t(lang, "due_today") if days == 0
                     else _t(lang, "due_in", days=days))
            overdue.append([r.title[:50], _fmt_date(d, lang), label])
    els.append(_table(
        [_t(lang, "col_risk"), _t(lang, "col_review_date"), _t(lang, "col_status")],
        overdue, [PAGE_W * 0.50, PAGE_W * 0.25, PAGE_W * 0.25], lang,
    ))

    els.append(_footer(lang))
    return await _render(buf, _t(lang, "title_risk"), els)


async def generate_vendor_report(db: AsyncSession, tenant_id: str, org: str, lang: str = "en") -> bytes:
    lang = _lang(lang)
    buf = BytesIO()
    st = _styles(lang)
    els = []
    ws, we = _period(lang)
    els.extend(_header(st, org, _t(lang, "title_vendor"), ws, we, lang))

    vendors = list((await db.execute(select(Vendor).where(Vendor.tenant_id == tenant_id).order_by(Vendor.risk_score.desc().nulls_last()))).scalars().all())
    tiers = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    no_dpa = 0
    for v in vendors:
        tier = _enum_value(v.risk_tier)
        if tier in tiers:
            tiers[tier] += 1
        if not v.has_data_processing_agreement:
            no_dpa += 1

    els.append(_kpi_bar([
        {"value": len(vendors), "label": _t(lang, "kpi_total_vendors")},
        {"value": tiers["critical"] + tiers["high"], "label": _t(lang, "kpi_high_critical")},
        {"value": no_dpa, "label": _t(lang, "kpi_missing_dpa")},
    ], lang))

    els.append(_section(st, _t(lang, "sec_vendor_register")))
    rows = []
    for v in vendors[:15]:
        score = f"{v.risk_score:.0f}" if v.risk_score else "—"
        dpa = _t(lang, "yes") if v.has_data_processing_agreement else _t(lang, "no")
        rows.append([v.name[:30], v.industry[:20] if v.industry else "—",
                     _label(lang, v.risk_tier), score, dpa, _label(lang, v.status)])
    els.append(_table(
        [_t(lang, "col_vendor"), _t(lang, "col_industry"), _t(lang, "col_tier"),
         _t(lang, "col_score"), _t(lang, "col_dpa"), _t(lang, "col_status")],
        rows,
        [PAGE_W * 0.22, PAGE_W * 0.20, PAGE_W * 0.12, PAGE_W * 0.10, PAGE_W * 0.10, PAGE_W * 0.16],
        lang,
    ))
    note = _more_note(st, min(15, len(vendors)), len(vendors), lang)
    if note is not None:
        els.append(note)

    # Pending contracts
    els.append(_section(st, _t(lang, "sec_contracts_pending")))
    contracts = list((await db.execute(
        select(VendorContract).join(Vendor).where(
            Vendor.tenant_id == tenant_id,
            VendorContract.validation_status.in_([ContractValidationStatus.AI_REVIEWED.value, ContractValidationStatus.PENDING_CISO.value]),
        )
    )).scalars().all())
    rows = []
    for c in contracts[:10]:
        vr = (await db.execute(select(Vendor).where(Vendor.id == c.vendor_id))).scalar_one_or_none()
        rows.append([(vr.name if vr else "—")[:30], c.file_name[:30], f"v{c.version}", _fmt_date(c.created_at, lang)])
    els.append(_table(
        [_t(lang, "col_vendor"), _t(lang, "col_contract"), _t(lang, "col_version"), _t(lang, "col_uploaded")],
        rows, [PAGE_W * 0.25, PAGE_W * 0.35, PAGE_W * 0.10, PAGE_W * 0.20], lang,
    ))

    # Missing DPA
    if no_dpa > 0:
        els.append(_section(st, _t(lang, "sec_missing_dpa")))
        rows = [[v.name[:40], v.industry[:25] if v.industry else "—"] for v in vendors if not v.has_data_processing_agreement][:10]
        els.append(_table([_t(lang, "col_vendor"), _t(lang, "col_industry")], rows,
                          [PAGE_W * 0.55, PAGE_W * 0.45], lang))

    els.append(_footer(lang))
    return await _render(buf, _t(lang, "title_vendor"), els)


async def generate_compliance_report(db: AsyncSession, tenant_id: str, org: str, lang: str = "en") -> bytes:
    lang = _lang(lang)
    buf = BytesIO()
    st = _styles(lang)
    els = []
    ws, we = _period(lang)
    els.extend(_header(st, org, _t(lang, "title_compliance"), ws, we, lang))

    assessments = list((await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id))).scalars().all())
    scores = [a.compliance_score for a in assessments if a.compliance_score is not None]
    avg = f"{sum(scores) / len(scores):.0f}%" if scores else "—"

    gaps = list((await db.execute(select(ComplianceGap).join(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant_id))).scalars().all())
    crit_gaps = len([g for g in gaps if _enum_value(g.severity) == "critical"])
    high_gaps = len([g for g in gaps if _enum_value(g.severity) == "high"])

    els.append(_kpi_bar([
        {"value": len(assessments), "label": _t(lang, "kpi_assessments")},
        {"value": avg, "label": _t(lang, "kpi_avg_score")},
        {"value": crit_gaps, "label": _t(lang, "kpi_critical_gaps")},
        {"value": high_gaps, "label": _t(lang, "kpi_high_gaps")},
    ], lang))

    els.append(_section(st, _t(lang, "sec_assessment_status")))
    rows = []
    for a in assessments[:15]:
        score = f"{a.compliance_score:.0f}%" if a.compliance_score is not None else "—"
        rows.append([a.name[:45] if a.name else _t(lang, "unnamed"), _label(lang, a.status),
                     score, _fmt_date(a.created_at, lang)])
    els.append(_table(
        [_t(lang, "col_assessment"), _t(lang, "col_status"), _t(lang, "col_score"), _t(lang, "col_created")],
        rows, [PAGE_W * 0.42, PAGE_W * 0.20, PAGE_W * 0.15, PAGE_W * 0.18], lang,
    ))
    note = _more_note(st, min(15, len(assessments)), len(assessments), lang)
    if note is not None:
        els.append(note)

    els.append(_section(st, _t(lang, "sec_gaps")))
    ranked = sorted([g for g in gaps if _enum_value(g.severity) in ("critical", "high")],
                    key=lambda g: 0 if _enum_value(g.severity) == "critical" else 1)
    gap_rows = []
    for g in ranked[:MAX_TABLE_ROWS]:
        gap_rows.append([g.control_id[:15] if g.control_id else "—", _label(lang, g.severity),
                         (g.gap_description or "—")[:80]])
    els.append(_table(
        [_t(lang, "col_control"), _t(lang, "col_severity"), _t(lang, "col_description")],
        gap_rows, [PAGE_W * 0.15, PAGE_W * 0.15, PAGE_W * 0.65], lang,
    ))
    note = _more_note(st, min(MAX_TABLE_ROWS, len(ranked)), len(ranked), lang)
    if note is not None:
        els.append(note)

    els.append(_footer(lang))
    return await _render(buf, _t(lang, "title_compliance"), els)


_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "observation": 4}


def _severity_rank(value) -> int:
    return _SEVERITY_ORDER.get(_enum_value(value), 5)


async def generate_audit_report(db: AsyncSession, tenant_id: str, org: str, lang: str = "en") -> bytes:
    lang = _lang(lang)
    buf = BytesIO()
    st = _styles(lang)
    els = []
    ws, we = _period(lang)
    els.extend(_header(st, org, _t(lang, "title_audit"), ws, we, lang))

    audits = list((await db.execute(select(Audit).where(Audit.tenant_id == tenant_id))).scalars().all())
    findings = list((await db.execute(select(AuditFinding).join(Audit).where(Audit.tenant_id == tenant_id))).scalars().all())
    crit_f = len([f for f in findings if _enum_value(f.severity) == "critical"])
    high_f = len([f for f in findings if _enum_value(f.severity) == "high"])
    open_f = len([f for f in findings if _enum_value(f.status) == "open"])

    els.append(_kpi_bar([
        {"value": len(audits), "label": _t(lang, "kpi_total_audits")},
        {"value": len(findings), "label": _t(lang, "kpi_findings")},
        {"value": crit_f + high_f, "label": _t(lang, "kpi_high_critical")},
        {"value": open_f, "label": _t(lang, "kpi_open")},
    ], lang))

    els.append(_section(st, _t(lang, "sec_active_audits")))
    rows = []
    for a in audits[:MAX_TABLE_ROWS]:
        name = getattr(a, "title", None) or _t(lang, "unnamed")
        rows.append([name[:40], _label(lang, a.audit_type), _label(lang, a.status), _fmt_date(a.created_at, lang)])
    els.append(_table(
        [_t(lang, "col_audit"), _t(lang, "col_type"), _t(lang, "col_status"), _t(lang, "col_started")],
        rows, [PAGE_W * 0.38, PAGE_W * 0.18, PAGE_W * 0.22, PAGE_W * 0.18], lang,
    ))
    note = _more_note(st, min(MAX_TABLE_ROWS, len(audits)), len(audits), lang)
    if note is not None:
        els.append(note)

    # Every finding, ordered by severity — not "critical & high" only. Filtering
    # by severity here meant a medium or low finding never reached the reader and
    # nothing said so; the register in the PDF then disagreed with the register
    # in the application, which is the one thing an audit artefact may not do.
    els.append(_section(st, _t(lang, "sec_findings")))
    ordered = sorted(findings, key=_severity_rank)
    f_rows = []
    for f in ordered[:MAX_TABLE_ROWS]:
        title = getattr(f, "title", "") or "—"
        # _finding_type, not the raw column: finding_type is NULL on every row
        # created before it existed, so reading it directly printed an "—" in
        # every line of a column the reader was given — and disagreed with the
        # per-engagement report, which groups the same findings by the type it
        # derives from severity.
        f_rows.append([title[:50], _label(lang, f.severity), _label(lang, f.status),
                       _label(lang, _finding_type(f), default="—")])
    els.append(_table(
        [_t(lang, "col_finding"), _t(lang, "col_severity"), _t(lang, "col_status"), _t(lang, "col_type")],
        f_rows, [PAGE_W * 0.44, PAGE_W * 0.16, PAGE_W * 0.18, PAGE_W * 0.22], lang,
    ))
    note = _more_note(st, min(MAX_TABLE_ROWS, len(ordered)), len(ordered), lang)
    if note is not None:
        els.append(note)

    els.append(_footer(lang))
    return await _render(buf, _t(lang, "title_audit"), els)


# ── Per-engagement audit report ───────────────────────────────────────────

async def _user_names(db: AsyncSession, ids) -> dict[str, str]:
    """id -> display name for the owners named in a report. One query, not N."""
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(wanted)))).scalars().all()
    out: dict[str, str] = {}
    for u in rows:
        name = " ".join(p for p in [u.first_name, u.last_name] if p).strip()
        out[u.id] = name or u.email or u.id
    return out


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    """Is this table physically present?

    Asked BEFORE querying rather than catching the failure afterwards, and that
    ordering is the whole point: a failed statement leaves the session needing a
    rollback, and ``Session.rollback()`` expires every loaded instance — including
    the ``Audit`` the caller handed us. The next attribute read would then try an
    implicit lazy refresh, which async SQLAlchemy cannot do, and the report would
    die with MissingGreenlet instead of quietly skipping a section.
    """
    try:
        conn = await db.connection()
        return bool(await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table(table_name)))
    except SQLAlchemyError as exc:  # noqa: BLE001 — inspection must never fail a report
        logger.warning("report: could not inspect table %s (%s)", table_name, exc.__class__.__name__)
        return False


async def _optional_rows(db: AsyncSession, stmt, table_name: str) -> list:
    """Rows from a table that may not exist yet.

    audit_recommendations and report_distributions are new tables; create_all()
    builds them at the next restart. Until then a report missing its newest
    section is far better than a report that refuses to build, so an absent
    table degrades to "no rows".
    """
    if not await _table_exists(db, table_name):
        return []
    try:
        return list((await db.execute(stmt)).scalars().all())
    except SQLAlchemyError as exc:  # noqa: BLE001
        # Deliberately no rollback here — see _table_exists. The session is the
        # caller's, and expiring its instances would break the whole report.
        logger.warning("report: %s unavailable (%s)", table_name, exc.__class__.__name__)
        return []


async def generate_single_audit_report(db: AsyncSession, audit: Audit, org: str, lang: str = "en") -> bytes:
    """Per-engagement audit report (distinct from the tenant-wide ``generate_audit_report``
    aggregate above). Used by ``POST /audits/{id}/report/generate`` so a specific audit's
    report can be persisted to ``Audit.report_url`` and then routed through the
    report-approval workflow before distribution.

    The requirement names four things the deliverable must contain — constats,
    non-conformités, recommandations and the plan d'action linked to each — so
    all four are sections here rather than one findings table. Recommendations
    and actions live in their own tables now (AuditRecommendation, ActionItem
    with finding_id): the legacy free-text ``AuditFinding.recommendation`` is
    still rendered as a fallback so the three live engagements do not lose their
    content.
    """
    lang = _lang(lang)
    buf = BytesIO()
    st = _styles(lang)
    els = []
    # Precedence, not a mixed conditional: an engagement with no created_at but a
    # planned start used to lose the date entirely (the previous expression
    # parsed as `(a or b or c) if created_at else "—"`).
    start = _fmt_date(audit.actual_start or audit.planned_start or audit.created_at, lang)
    end = _fmt_date(audit.actual_end or audit.planned_end or datetime.utcnow(), lang)
    els.extend(_header(st, org, _t(lang, "title_audit_single", audit=audit.title), start, end, lang))

    findings = list((await db.execute(
        select(AuditFinding).where(AuditFinding.audit_id == audit.id)
    )).scalars().all())
    findings.sort(key=_severity_rank)
    finding_ids = [f.id for f in findings]
    by_id = {f.id: f for f in findings}

    recommendations = await _optional_rows(
        db,
        select(AuditRecommendation)
        .where(AuditRecommendation.tenant_id == audit.tenant_id,
               AuditRecommendation.audit_id == audit.id)
        .order_by(AuditRecommendation.created_at.asc()),
        AuditRecommendation.__tablename__,
    )
    actions = []
    if finding_ids:
        actions = await _optional_rows(
            db,
            select(ActionItem)
            .where(ActionItem.tenant_id == audit.tenant_id, ActionItem.finding_id.in_(finding_ids))
            .order_by(ActionItem.due_date.asc().nulls_last()),
            ActionItem.__tablename__,
        )
    distributions = await _optional_rows(
        db,
        select(ReportDistribution)
        .where(ReportDistribution.tenant_id == audit.tenant_id,
               ReportDistribution.audit_id == audit.id)
        .order_by(ReportDistribution.created_at.desc()),
        ReportDistribution.__tablename__,
    )

    names = await _user_names(
        db,
        [f.remediation_owner_id for f in findings]
        + [r.owner_id for r in recommendations]
        + [a.owner_id for a in actions],
    )

    crit_f = len([f for f in findings if _enum_value(f.severity) == "critical"])
    high_f = len([f for f in findings if _enum_value(f.severity) == "high"])
    open_f = len([f for f in findings if _enum_value(f.status) in ("open", "in_remediation")])
    nc_count = len([f for f in findings if _finding_type(f).startswith("nonconformity")])

    els.append(_kpi_bar([
        {"value": _label(lang, audit.audit_type), "label": _t(lang, "kpi_audit_type")},
        {"value": _label(lang, audit.status), "label": _t(lang, "kpi_status")},
        {"value": len(findings), "label": _t(lang, "kpi_findings")},
        {"value": nc_count, "label": _t(lang, "kpi_nonconformities")},
        {"value": crit_f + high_f, "label": _t(lang, "kpi_high_critical")},
        {"value": open_f, "label": _t(lang, "kpi_open")},
    ], lang))

    if audit.scope:
        els.append(_section(st, _t(lang, "sec_scope")))
        els.append(_p(audit.scope, st["Body"]))

    if audit.executive_summary:
        els.append(_section(st, _t(lang, "sec_exec_summary")))
        els.append(_p(audit.executive_summary, st["Body"]))

    # 1. Constats — every finding, whatever its severity.
    els.append(_section(st, _t(lang, "sec_findings")))
    f_rows = []
    for f in findings[:MAX_TABLE_ROWS]:
        f_rows.append([
            (f.title or "—")[:50],
            _label(lang, f.severity),
            _label(lang, f.status),
            names.get(f.remediation_owner_id or "", "—"),
            _fmt_date(f.due_date, lang),
        ])
    els.append(_table(
        [_t(lang, "col_finding"), _t(lang, "col_severity"), _t(lang, "col_status"),
         _t(lang, "col_owner"), _t(lang, "col_due")],
        f_rows,
        [PAGE_W * 0.34, PAGE_W * 0.14, PAGE_W * 0.16, PAGE_W * 0.21, PAGE_W * 0.15],
        lang,
    ))
    note = _more_note(st, min(MAX_TABLE_ROWS, len(findings)), len(findings), lang)
    if note is not None:
        els.append(note)

    # 2. Non-conformités, grouped by finding_type — the structure an ISO 27001
    # report is read in. Legacy rows have a NULL finding_type, so the grouping
    # derives it from severity exactly as endpoints/audits.py does.
    els.append(_section(st, _t(lang, "sec_nonconformities")))
    grouped: dict[str, list] = {}
    for f in findings:
        grouped.setdefault(_finding_type(f), []).append(f)
    for ftype in ("nonconformity_major", "nonconformity_minor", "observation", "improvement"):
        bucket = grouped.get(ftype) or []
        if not bucket:
            continue
        els.append(_p(f"{_label(lang, ftype)} ({len(bucket)})", st["H3"]))
        els.append(_table(
            [_t(lang, "col_finding"), _t(lang, "col_severity"), _t(lang, "col_status"), _t(lang, "col_description")],
            [[(f.title or "—")[:40], _label(lang, f.severity), _label(lang, f.status),
              (f.description or "—")[:110]] for f in bucket[:MAX_TABLE_ROWS]],
            [PAGE_W * 0.26, PAGE_W * 0.13, PAGE_W * 0.16, PAGE_W * 0.45],
            lang,
        ))
    if not any(grouped.values()):
        els.append(_p(_t(lang, "no_data"), st["Body"]))

    # 3. Recommandations — the tracked rows, falling back to the legacy free-text
    # column on the finding so nothing that exists today disappears.
    els.append(_section(st, _t(lang, "sec_recommendations")))
    r_rows = []
    for r in recommendations[:MAX_TABLE_ROWS]:
        linked = by_id.get(r.finding_id or "")
        r_rows.append([
            r.ref_code or "—",
            (r.title or "—")[:60],
            (linked.title[:30] if linked is not None and linked.title else _t(lang, "unlinked")),
            names.get(r.owner_id or "", "—"),
            _fmt_date(r.due_date, lang),
            _label(lang, r.status),
        ])
    if not r_rows:
        for f in findings:
            if (f.recommendation or "").strip():
                r_rows.append(["—", f.recommendation.strip()[:60], (f.title or "—")[:30],
                               names.get(f.remediation_owner_id or "", "—"),
                               _fmt_date(f.due_date, lang), _label(lang, f.status)])
    if r_rows:
        els.append(_table(
            [_t(lang, "col_reference"), _t(lang, "col_recommendation"), _t(lang, "col_linked_finding"),
             _t(lang, "col_owner"), _t(lang, "col_due"), _t(lang, "col_status")],
            r_rows[:MAX_TABLE_ROWS],
            [PAGE_W * 0.10, PAGE_W * 0.30, PAGE_W * 0.20, PAGE_W * 0.17, PAGE_W * 0.13, PAGE_W * 0.10],
            lang,
        ))
    else:
        els.append(_p(_t(lang, "no_recommendations"), st["Body"]))

    # 4. Plan d'action — the actions attached to this engagement's findings, so
    # the reader can see what each constat is actually being answered with.
    els.append(_section(st, _t(lang, "sec_action_plan")))
    a_rows = []
    for it in actions[:MAX_TABLE_ROWS]:
        linked = by_id.get(it.finding_id or "")
        a_rows.append([
            (it.title or "—")[:45],
            (linked.title[:30] if linked is not None and linked.title else _t(lang, "unlinked")),
            names.get(it.owner_id or "", "—"),
            _label(lang, it.priority),
            _fmt_date(it.due_date, lang),
            _label(lang, it.status),
        ])
    if a_rows:
        els.append(_table(
            [_t(lang, "col_action"), _t(lang, "col_linked_finding"), _t(lang, "col_owner"),
             _t(lang, "col_priority"), _t(lang, "col_due"), _t(lang, "col_status")],
            a_rows,
            [PAGE_W * 0.26, PAGE_W * 0.22, PAGE_W * 0.17, PAGE_W * 0.12, PAGE_W * 0.13, PAGE_W * 0.10],
            lang,
        ))
        note = _more_note(st, min(MAX_TABLE_ROWS, len(actions)), len(actions), lang)
        if note is not None:
            els.append(note)
    else:
        els.append(_p(_t(lang, "no_actions"), st["Body"]))

    if audit.report_approved_at:
        els.append(_section(st, _t(lang, "sec_approval")))
        els.append(_p(_t(lang, "approved_on", date=_fmt_date(audit.report_approved_at, lang)), st["Body"]))

    # Who already received this report — printed inside the artefact so a
    # re-read copy answers « à qui a-t-il été diffusé ? » on its own.
    if distributions:
        els.append(_section(st, _t(lang, "sec_distribution")))
        els.append(_table(
            [_t(lang, "col_recipients"), _t(lang, "col_channel"), _t(lang, "col_version"), _t(lang, "col_sent")],
            [[(d.recipients or "—")[:60], d.channel or "—", f"v{d.report_version}",
              _fmt_date(d.distributed_at or d.created_at, lang)] for d in distributions[:MAX_TABLE_ROWS]],
            [PAGE_W * 0.45, PAGE_W * 0.15, PAGE_W * 0.12, PAGE_W * 0.20],
            lang,
        ))

    els.append(_footer(lang))
    return await _render(buf, _t(lang, "title_audit_single", audit=audit.title), els)


# Mirrors endpoints/audits.py's _SEVERITY_TO_FINDING_TYPE. Duplicated rather than
# imported because a service importing an endpoint module would make the import
# graph circular (audits.py already imports this module).
_SEVERITY_TO_FINDING_TYPE = {
    "critical": "nonconformity_major",
    "high": "nonconformity_major",
    "medium": "nonconformity_minor",
    "low": "nonconformity_minor",
    "observation": "observation",
}


def _finding_type(finding: AuditFinding) -> str:
    """A finding's declared type, derived from severity when NULL (legacy rows)."""
    declared = (getattr(finding, "finding_type", None) or "").strip()
    if declared:
        return declared
    return _SEVERITY_TO_FINDING_TYPE.get(_enum_value(finding.severity), "nonconformity_minor")


# ── Dispatcher ────────────────────────────────────────────────────────────

REPORT_GENERATORS = {
    "executive": generate_executive_summary,
    "risk": generate_risk_report,
    "vendor": generate_vendor_report,
    "compliance": generate_compliance_report,
    "audit": generate_audit_report,
}


def report_type_name(report_type: str, lang: str = "en") -> str:
    """A built-in report type's name as a reader should see it.

    The raw keys ("risk", "executive") are internal identifiers, not titles: a
    French e-mail announcing a "risk report" is still an English artefact to the
    recipient. Falls back to the key, title-cased, for anything unknown.
    """
    lang = _lang(lang)
    key = f"name_{report_type}"
    if (_L10N.get(lang) or {}).get(key) or _L10N["en"].get(key):
        return _t(lang, key)
    return str(report_type or "").replace("_", " ").title()


def report_type_catalog(lang: str = "en") -> list[dict]:
    """The /reports/types catalogue, in the caller's language."""
    lang = _lang(lang)
    icons = {"executive": "layout", "risk": "alert-triangle", "compliance": "check-square",
             "vendor": "building", "audit": "clipboard-list"}
    return [
        {
            "id": key,
            "name": _t(lang, f"name_{key}"),
            "description": _t(lang, f"desc_{key}"),
            "icon": icons[key],
        }
        for key in ("executive", "risk", "compliance", "vendor", "audit")
    ]


async def generate_report(
    report_type: str,
    db: AsyncSession,
    tenant_id: str,
    tenant_name: str = "Organization",
    lang: str = "en",
) -> bytes:
    gen = REPORT_GENERATORS.get(report_type)
    if not gen:
        raise ValueError(f"Unknown report type: {report_type}")
    return await gen(db, tenant_id, tenant_name, _lang(lang))


# ── Archiving (« archivage des rapports dans l'historique ») ───────────────
# Every report a user could obtain used to be ephemeral: the bytes went into one
# HTTP response and were never written anywhere. That makes two requirements
# impossible at once — there is no historique to list, and a distributed report
# cannot be re-read exactly as it was sent, because it no longer exists.
#
# Storage reuses services/file_integrity.py rather than inventing a second
# ledger: the same StoredFileVersion rows, the same sha256, the same retention
# sweep. Versions are numbered per (parent_type, parent_id), so parent_type
# carries the report type and parent_id the tenant — giving each report type its
# own version series per tenant, with the newest marked `current`.

def _write_archive_file(rel_path: str, pdf_bytes: bytes) -> None:
    """Blocking disk write, called through a thread by :func:`archive_report`."""
    target = Path(settings.UPLOADS_DIR) / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(pdf_bytes)


REPORT_ARCHIVE_SUBDIR = "reports"
REPORT_ENTITY_TYPE = "tenant_report"
REPORT_PARENT_PREFIX = "report:"


def report_parent_type(report_type: str) -> str:
    """`parent_type` for a tenant-wide report of this type (max 30 chars)."""
    return f"{REPORT_PARENT_PREFIX}{report_type}"[:30]


async def archive_report(
    db: AsyncSession,
    *,
    tenant_id: str,
    report_type: str,
    pdf_bytes: bytes,
    lang: str = "en",
    generated_by_id: str | None = None,
    note: str | None = None,
) -> StoredFileVersion | None:
    """Persist a generated report and record it as a version. Never raises.

    Archiving is a side effect of producing a report, so a failure here must not
    cost the caller their download — the exception is swallowed and logged, and
    the caller still returns the bytes it already has.

    This commits: unlike the version helpers called mid-transaction, it is
    invoked when the caller has no other pending business row, and both callers
    (the endpoint and the scheduler) want the archive durable before the file
    leaves the building.
    """
    entity_id = str(uuid.uuid4())
    rel_path = f"{REPORT_ARCHIVE_SUBDIR}/{entity_id}.pdf"
    try:
        # mkdir + write_bytes both block the event loop, and the two uvicorn
        # workers serve every other request on it — same reason endpoints/audits.py
        # writes its report through a thread.
        await asyncio.to_thread(_write_archive_file, rel_path, pdf_bytes)
    except OSError as exc:
        logger.error("report archive: could not write %s report to disk: %s", report_type, exc)
        return None

    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    file_name = f"{report_type}-report-{stamp}-{_lang(lang)}.pdf"
    # record_version numbers per parent with a UNIQUE index, so two workers
    # archiving at the same instant race for the same number; the loser retries
    # against the new tail rather than losing the archive.
    for attempt in range(3):
        try:
            version = await file_integrity.record_version(
                db,
                tenant_id=tenant_id,
                entity_type=REPORT_ENTITY_TYPE,
                entity_id=entity_id,
                parent_type=report_parent_type(report_type),
                parent_id=tenant_id,
                file_path=rel_path,
                file_name=file_name,
                file_sha256=file_integrity.sha256_bytes(pdf_bytes),
                file_size_bytes=len(pdf_bytes),
                content_type="application/pdf",
                uploaded_by_id=generated_by_id,
                note=note or f"lang={_lang(lang)}",
            )
            await db.commit()
            return version
        except IntegrityError:
            await db.rollback()
            continue
        except SQLAlchemyError as exc:  # noqa: BLE001 — never fail the download
            await db.rollback()
            logger.error("report archive: could not record %s report version: %s", report_type, exc)
            return None
    logger.warning("report archive: gave up on a version number for the %s report", report_type)
    return None


async def list_report_archive(
    db: AsyncSession,
    tenant_id: str,
    *,
    report_type: str | None = None,
    limit: int = 50,
) -> list[StoredFileVersion]:
    """The tenant's archived reports, newest first — the « historique »."""
    stmt = (
        select(StoredFileVersion)
        .where(
            StoredFileVersion.tenant_id == tenant_id,
            StoredFileVersion.entity_type == REPORT_ENTITY_TYPE,
        )
        # created_at is stored at second precision, so two reports produced in
        # the same second would otherwise come back in an arbitrary order; the
        # version number breaks the tie deterministically.
        .order_by(StoredFileVersion.created_at.desc(), StoredFileVersion.version_number.desc())
        .limit(max(1, min(int(limit or 50), 500)))
    )
    if report_type:
        stmt = stmt.where(StoredFileVersion.parent_type == report_parent_type(report_type))
    return list((await db.execute(stmt)).scalars().all())


async def get_archived_report(
    db: AsyncSession, tenant_id: str, version_id: str
) -> StoredFileVersion | None:
    """One archived report, scoped to the tenant that owns it."""
    return (await db.execute(
        select(StoredFileVersion).where(
            StoredFileVersion.id == version_id,
            StoredFileVersion.tenant_id == tenant_id,
            StoredFileVersion.entity_type == REPORT_ENTITY_TYPE,
        )
    )).scalar_one_or_none()
