"""Compliance assessment endpoints — full implementation.

AI sites in this file (both on the shared AI foundation under ``app.services``):
  * ``_run_analysis_background`` — document set × framework controls
    (``ai_chunking.assess_controls_over_document`` + the ``control_assessment`` prompt);
  * ``_detect_clauses_background`` — document → clause tags + summary
    (``ai_structured`` + the ``clause_coverage`` prompt, chunked with ``map_reduce``).
"""
import asyncio
import logging
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update as sa_update
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.api.v1.dependencies.pagination import PaginationParams
from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.core.security_utils import (
    assert_assets_in_tenant,
    assert_safe_upload_name,
    assert_user_in_tenant,
    verify_file_signature,
)
from app.services import file_integrity
from app.services import compliance_merge, perimeter
from app.models.applied_control import AppliedControl
from app.services.authz import get_effective_roles
from app.models.compliance import (
    AssessmentStatus,
    ComplianceAssessment,
    ComplianceGap,
    ControlAssessment,
    ControlStatus,
    Evidence,
    EvidenceType,
    UploadedDocument,
)
from app.models.framework import ControlRequirement, Framework, FrameworkControl
from app.models.mandatory_document import MandatoryDocument
from app.models.tenant import Tenant
from app.models.action_item import ActionItem, ActionItemPriority, ActionItemStatus
from app.models.action_item_attachment import ActionItemAttachment
from app.models.activity_log import ActivityLog
from app.models.compliance_scale import ComplianceScale
from app.models.org_unit import BusinessProcess, OrgEntity
from app.models.user import User, UserRole
from app.services import ai_chunking, ai_prompts, ai_provider
from app.services.activity_chain import chain_and_add
from app.services.ai_locale import get_request_language, normalize_language
from app.services.content_translation import get_display_language, localize_fields
from app.services.ai_structured import ai_structured, coerce_shape, extract_json, validate_against

router = APIRouter()

# R2 5.3 — who may do what on a compliance assessment. Reading and self-assessing
# open to compliance_manager (tenant-wide) and control_owner (their own rows, via
# services/perimeter); running the analysis and creating assessments stay with
# the CISO and compliance_manager. tenant_admin / super_admin auto-pass.
# Reading follows App.tsx ROUTE_ROLES["/compliance"]: every role the SPA lets onto
# the compliance pages can read them (they used to land on 403s).
_READ_ROLES = (
    UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.CONTROL_OWNER, UserRole.RISK_MANAGER,
    UserRole.POLICY_MANAGER, UserRole.BUSINESS_OWNER, UserRole.SECURITY_ANALYST,
    UserRole.VIEWER, UserRole.EXECUTIVE,
)
_ASSESS_ROLES = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.CONTROL_OWNER)
_MANAGE_ROLES = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER)

# ─── Request / Response schemas ────────────────────────────────────────────────


class AssessmentCreate(BaseModel):
    framework_id: str
    name: str
    description: str | None = None
    scope_description: str | None = None
    # STB objectif 2 — « le niveau de conformité DES PROCESSUS, DÉPARTEMENTS OU
    # SYSTÈMES ». Omitting all four keeps the historical organisation-wide
    # behaviour ("tenant"), which is what every pre-existing assessment is.
    scope_type: str = "tenant"
    org_entity_id: str | None = None
    business_process_id: str | None = None
    in_scope_assets: list[str] | None = None
    # « Grille d'évaluation personnalisable » — null keeps the legacy ControlStatus
    # enum and the legacy score formula.
    scale_id: str | None = None


class AssessmentUpdate(BaseModel):
    """PATCH body. Every field is optional; an omitted field is left untouched.

    This endpoint did not exist, which is half the reason a tenant was locked to
    one live assessment per framework forever: nothing could rename one, re-scope
    it, or move it to ARCHIVED (no writer of AssessmentStatus.ARCHIVED existed
    anywhere in the backend).
    """
    name: str | None = None
    description: str | None = None
    scope_description: str | None = None
    scope_type: str | None = None
    org_entity_id: str | None = None
    business_process_id: str | None = None
    in_scope_assets: list[str] | None = None
    scale_id: str | None = None
    status: AssessmentStatus | None = None
    lead_assessor_id: str | None = None
    assessment_start: str | None = None
    assessment_end: str | None = None
    next_review_date: str | None = None


class ControlAssessmentUpdate(BaseModel):
    status: ControlStatus | None = None
    # A level key of the assessment's ComplianceScale. Takes precedence over
    # `status`, which keeps carrying the nearest legacy enum value so every
    # existing query, export and dashboard keeps working untouched.
    status_key: str | None = None
    owner_id: str | None = None
    notes: str | None = None
    implementation_notes: str | None = None
    not_applicable_justification: str | None = None


class UploadedDocumentResponse(BaseModel):
    id: str
    file_name: str
    file_path: str | None = None
    file_size_bytes: int | None = None
    content_type: str | None = None
    is_visible_to_auditor: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


class LinkedChecklistDocument(BaseModel):
    """A Document Checklist upload that automatically covers a control's clause."""
    id: str
    file_name: str
    document_name: str | None = None
    clause_ref: str | None = None
    document_type_key: str | None = None
    file_size_bytes: int | None = None
    content_type: str | None = None


class EvidenceResponse(BaseModel):
    id: str
    file_name: str | None = None
    file_path: str | None = None
    file_size_bytes: int | None = None
    content_type: str | None = None
    is_visible_to_auditor: bool = True
    created_at: datetime
    shared_count: int = 0
    is_shared: bool = False
    # Validity window (YYYY-MM-DD). The UI derives "expired" / "expires in N days".
    valid_from: str | None = None
    valid_until: str | None = None

    model_config = {"from_attributes": True}


class ControlAssessmentResponse(BaseModel):
    id: str
    assessment_id: str
    control_id: str
    control_identifier: str
    control_title: str
    control_category: str | None = None
    control_description: str | None = None
    status: ControlStatus
    status_key: str | None = None
    notes: str | None = None
    implementation_notes: str | None = None
    not_applicable_justification: str | None = None
    # True when the control sits on "not applicable" with no justification on
    # record — an auditor always asks why a requirement was excluded, so the UI
    # has to be able to flag it.
    requires_justification: bool = False
    owner_id: str | None = None
    owner_name: str | None = None
    ai_confidence: float | None = None
    cross_framework_coverage: list[dict] = []
    is_mandatory: bool = False
    linked_checklist_documents: list[LinkedChecklistDocument] = []
    # R2 5.1 — "human" when a person set the status; the AI's own opinion beside it.
    status_source: str | None = None
    ai_suggested_status: str | None = None
    ai_suggested_status_key: str | None = None
    ai_suggested_notes: str | None = None
    ai_suggested_at: str | None = None
    # R2 5.4 — evidence on file, and whether every piece of it has expired.
    evidence_count: int = 0
    evidence_expired_count: int = 0
    evidence_all_expired: bool = False
    # R2 5.6 — applied controls declared as implementing this requirement
    # (information only: never changes the requirement's status).
    applied_controls: list[dict] = []
    # Machine translation of the requirement text for display (content_translations);
    # the stored text stays in original_*. Additive/optional.
    translated: bool = False
    original_control_title: str | None = None
    original_control_description: str | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class GapResponse(BaseModel):
    id: str
    control_id: str
    control_identifier: str
    control_title: str
    control_description: str | None = None
    gap_description: str
    severity: str
    remediation_steps: str | None = None
    recommendation_status: str = "pending"
    is_certification_blocker: bool = False
    remediation_priority: int = 50
    action_item_id: str | None = None
    translated: bool = False
    original_control_title: str | None = None
    original_control_description: str | None = None

    model_config = {"from_attributes": True}


class AssessmentDetailResponse(BaseModel):
    id: str
    tenant_id: str
    framework_id: str
    framework_name: str
    framework_short_name: str
    name: str
    description: str | None = None
    status: str
    compliance_score: float | None = None
    scope_description: str | None = None
    # Perimeter (STB objectif 2). scope_type is "tenant" on every legacy row.
    scope_type: str = "tenant"
    org_entity_id: str | None = None
    org_entity_name: str | None = None
    business_process_id: str | None = None
    business_process_name: str | None = None
    in_scope_assets: list[str] = []
    # The customisable grid, resolved so the UI can render the tenant's own
    # level labels/colours instead of the hard-coded English enum.
    scale_id: str | None = None
    scale_name: str | None = None
    scale_levels: list[dict] = []
    created_at: datetime
    updated_at: datetime
    uploaded_documents: list[UploadedDocumentResponse] = []
    control_assessments: list[ControlAssessmentResponse] = []
    gaps: list[GapResponse] = []
    cross_framework_summary: dict = {}
    translated: bool = False
    original_framework_name: str | None = None

    model_config = {"from_attributes": True}


class AssessmentListItem(BaseModel):
    id: str
    framework_id: str
    framework_name: str
    framework_short_name: str
    name: str
    status: str
    compliance_score: float | None = None
    document_count: int = 0
    scope_type: str = "tenant"
    org_entity_id: str | None = None
    org_entity_name: str | None = None
    business_process_id: str | None = None
    business_process_name: str | None = None
    scale_id: str | None = None
    created_at: datetime
    translated: bool = False
    original_framework_name: str | None = None

    model_config = {"from_attributes": True}


class PaginatedAssessments(BaseModel):
    items: list[AssessmentListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


# ─── Internal helpers ──────────────────────────────────────────────────────────


def _sanitize_filename(name: str) -> str:
    stem = Path(name).stem
    suffix = Path(name).suffix
    safe = re.sub(r"[^\w\-.]", "_", stem)
    return safe[:80] + suffix[:10]


_STATUS_LABEL = {
    "implemented":           "conforme",
    "partially_implemented": "partiel",
    "not_implemented":       "non_conforme",
    "in_progress":           "en_cours",
    "not_applicable":        "na",
    "not_started":           "a_evaluer",
}


def _build_evidence_filename(
    framework_short: str,
    control_identifier: str,
    status: str,
    original_filename: str,
) -> str:
    """Return a display filename following the convention:
    <norme>_<control>_<statut>_<date>.<ext>
    e.g. ISO27001_A5_1_conforme_2026-06-09.pdf
    """
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    norme    = re.sub(r"[^\w]", "", framework_short or "NORME")[:20]
    control  = re.sub(r"[^\w]", "_", control_identifier or "XX").strip("_")[:20]
    statut   = _STATUS_LABEL.get(status, "en_evaluation")
    ext      = Path(original_filename).suffix[:10] if original_filename else ".bin"
    return f"{norme}_{control}_{statut}_{date_str}{ext}"


def _build_doc_filename(
    framework_short: str,
    original_filename: str,
) -> str:
    """Assessment-level document (no specific control).
    <norme>_document_<date>.<ext>
    """
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    norme    = re.sub(r"[^\w]", "", framework_short or "NORME")[:20]
    ext      = Path(original_filename).suffix[:10] if original_filename else ".bin"
    return f"{norme}_document_{date_str}{ext}"


logger = logging.getLogger(__name__)


# ─── AI foundation: language-aware platform copy ──────────────────────────────
# Free text the PLATFORM writes into AI results (defaults, prefixes, labels) must
# follow the UI language exactly like the model's own prose. Model output itself is
# localised by ai_prompts.system_prompt(lang=...); these strings cover what we add.

_L10N: dict[str, dict[str, str]] = {
    "en": {
        "no_text": ("No text could be extracted from the uploaded documents. Scanned PDFs need OCR "
                    "(Document Capture) and spreadsheets need a text export before analysis."),
        "no_evidence": "No evidence found in the uploaded documents.",
        "evidence": "Evidence",
        "requirement": "Requirement applied",
        "note": "Note",
        "not_analysed": "AI analysis did not return a verdict for this control; assess it manually.",
        "gap_default": "The uploaded documents do not evidence \"{title}\" ({control_id}).",
        "evidence_gap": "Evidence gap:",
        "remediation_default": ("Provide evidence for \"{title}\" ({control_id}): the policy or standard that "
                                "defines it, the owner, the procedure and the records showing it operates — "
                                "or implement it per the framework guidance."),
        "partial": ("Partial analysis: {n} of {total} control(s) received no AI verdict this run — {new} newly "
                    "marked \"not started\", {preserved} kept at their previous status, not re-verified this run."),
        "mostly_failed": "AI analysis produced verdicts for only {n} of {total} controls; the previous results were kept.",
        "clause_failed": "AI clause detection failed for this document.",
        "clause_too_large": ("This document is too large to tag with AI clause detection in one job ({n} parts, "
                             "limit {limit}). Split it into smaller files, or rely on the manual checklist."),
        "clause_partial": "AI clause detection could not process {n} of {total} part(s) of this document; results may be incomplete.",
        "locate_failed": ("AI analysis could not search every part of the uploaded documents for evidence (a "
                          "retrieval step failed); the previous results were kept. Retry the analysis."),
        "gap_manual": "Manual evaluation: \"{title}\" ({control_id}) was assessed as not compliant.",
        "closed_by_action": ("Requirement closed on {date}: the action \"{title}\" that remediated it was "
                             "completed."),
        "reopened_by_action": ("Requirement re-opened on {date}: the action \"{title}\" that remediated it was "
                               "re-opened."),
        "plan_orphaned": ("The non-conformity this action addressed was closed by the analysis of {date}; the "
                          "action was cancelled rather than deleted so its history remains."),
    },
    "fr": {
        "no_text": ("Aucun texte n'a pu être extrait des documents téléversés. Les PDF scannés nécessitent une OCR "
                    "(Capture de documents) et les tableurs un export texte avant l'analyse."),
        "no_evidence": "Aucune preuve trouvée dans les documents téléversés.",
        "evidence": "Preuve",
        "requirement": "Exigence appliquée",
        "note": "Remarque",
        "not_analysed": "L'analyse IA n'a renvoyé aucun verdict pour ce contrôle ; évaluez-le manuellement.",
        "gap_default": "Les documents téléversés n'apportent pas de preuve pour « {title} » ({control_id}).",
        "evidence_gap": "Écart de preuve :",
        "remediation_default": ("Fournir des preuves pour « {title} » ({control_id}) : la politique ou norme qui le "
                                "définit, le responsable, la procédure et les enregistrements montrant son "
                                "fonctionnement — ou le mettre en œuvre selon les recommandations du référentiel."),
        "partial": ("Analyse partielle : {n} contrôle(s) sur {total} n'ont reçu aucun verdict IA lors de cette "
                    "exécution — {new} nouvellement marqué(s) « non démarré(s) », {preserved} conservé(s) à leur "
                    "statut précédent, non revérifié(s) lors de cette exécution."),
        "mostly_failed": "L'analyse IA n'a produit des verdicts que pour {n} contrôles sur {total} ; les résultats précédents ont été conservés.",
        "clause_failed": "La détection IA des clauses a échoué pour ce document.",
        "clause_too_large": ("Ce document est trop volumineux pour être analysé en une seule fois par la détection "
                             "IA des clauses ({n} parties, limite {limit}). Scindez-le en fichiers plus petits, ou "
                             "utilisez la checklist manuelle."),
        "clause_partial": "La détection IA des clauses n'a pas pu traiter {n} partie(s) sur {total} de ce document ; les résultats peuvent être incomplets.",
        "locate_failed": ("L'analyse IA n'a pas pu rechercher des preuves dans toutes les parties des documents "
                          "téléversés (une étape de recherche a échoué) ; les résultats précédents ont été conservés. "
                          "Relancez l'analyse."),
        "gap_manual": "Évaluation manuelle : « {title} » ({control_id}) a été jugée non conforme.",
        "closed_by_action": ("Exigence clôturée le {date} : l'action « {title} » qui la corrigeait a été terminée."),
        "reopened_by_action": ("Exigence rouverte le {date} : l'action « {title} » qui la corrigeait a été rouverte."),
        "plan_orphaned": ("La non-conformité traitée par cette action a été levée par l'analyse du {date} ; "
                          "l'action a été annulée plutôt que supprimée afin de conserver son historique."),
    },
    "ar": {
        "no_text": ("تعذر استخراج أي نص من المستندات المرفوعة. تحتاج ملفات PDF الممسوحة ضوئيًا إلى التعرف الضوئي على "
                    "الحروف (التقاط المستندات) وتحتاج جداول البيانات إلى تصدير نصي قبل التحليل."),
        "no_evidence": "لم يُعثر على أي دليل في المستندات المرفوعة.",
        "evidence": "الدليل",
        "requirement": "المتطلب المطبَّق",
        "note": "ملاحظة",
        "not_analysed": "لم يُرجع تحليل الذكاء الاصطناعي أي حكم لهذا الضابط؛ يرجى تقييمه يدويًا.",
        "gap_default": "لا تقدم المستندات المرفوعة دليلًا على \"{title}\" ({control_id}).",
        "evidence_gap": "فجوة في الأدلة:",
        "remediation_default": ("قدّم أدلة على \"{title}\" ({control_id}): السياسة أو المعيار الذي يحدده، والمسؤول، "
                                "والإجراء والسجلات التي تُظهر تطبيقه — أو طبّقه وفق إرشادات الإطار."),
        "partial": ("تحليل جزئي: {n} من أصل {total} ضابطًا لم يتلقَّ أي حكم من الذكاء الاصطناعي في هذا التشغيل — "
                    "تم تصنيف {new} حديثًا بحالة \"لم يبدأ\"، وتم الاحتفاظ بحالة {preserved} على وضعها السابق "
                    "دون إعادة التحقق منها في هذا التشغيل."),
        "mostly_failed": "أنتج تحليل الذكاء الاصطناعي أحكامًا لـ {n} فقط من أصل {total} ضابطًا؛ تم الاحتفاظ بالنتائج السابقة.",
        "clause_failed": "فشل اكتشاف البنود بالذكاء الاصطناعي لهذا المستند.",
        "clause_too_large": ("هذا المستند كبير جدًا لتحليله دفعة واحدة عبر اكتشاف البنود بالذكاء الاصطناعي ({n} جزءًا، "
                             "والحد الأقصى {limit}). قسّمه إلى ملفات أصغر، أو استخدم القائمة المرجعية اليدوية."),
        "clause_partial": "تعذر على اكتشاف البنود بالذكاء الاصطناعي معالجة {n} من أصل {total} جزءًا من هذا المستند؛ قد تكون النتائج غير مكتملة.",
        "locate_failed": ("تعذر على تحليل الذكاء الاصطناعي البحث عن الأدلة في جميع أجزاء المستندات المرفوعة (فشلت "
                          "خطوة استرجاع)؛ تم الاحتفاظ بالنتائج السابقة. أعد تشغيل التحليل."),
        "gap_manual": "تقييم يدوي: تم اعتبار \"{title}\" ({control_id}) غير مطابق.",
        "closed_by_action": "تم إغلاق المتطلب في {date}: اكتمل الإجراء \"{title}\" الذي عالجه.",
        "reopened_by_action": "أُعيد فتح المتطلب في {date}: أُعيد فتح الإجراء \"{title}\" الذي عالجه.",
        "plan_orphaned": ("تمت معالجة عدم المطابقة التي يعالجها هذا الإجراء في تحليل {date}؛ تم إلغاء الإجراء بدلاً "
                          "من حذفه للحفاظ على سجله."),
    },
}


def _t(lang: str, key: str, **fmt) -> str:
    """Platform-authored sentence in the resolved UI language (en/fr/ar; English fallback)."""
    table = _L10N.get(normalize_language(lang) or "en") or _L10N["en"]
    text = table.get(key) or _L10N["en"][key]
    return text.format(**fmt) if fmt else text


# ─── Text extraction (whole text, never truncated; chunking happens at analysis time) ──

_PLAIN_TEXT_SUFFIXES = (".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm")


def _extract_xlsx(file_path: str) -> str:
    """Sheet-by-sheet, row-by-row text for an OOXML workbook (cell values, formulas evaluated)."""
    from openpyxl import load_workbook

    wb = load_workbook(file_path, read_only=True, data_only=True)
    try:
        parts: list[str] = []
        for ws in wb.worksheets:
            parts.append(f"=== Sheet: {ws.title} ===")
            for row in ws.iter_rows(values_only=True):
                cells = ["" if v is None else str(v).strip() for v in row]
                if any(cells):
                    parts.append(" | ".join(cells).rstrip(" |"))
        return "\n".join(parts)
    finally:
        wb.close()


def _extract_xls(file_path: str) -> str:
    """Legacy BIFF workbook: needs xlrd, which is optional. Without it the document has no
    text (the analysis pre-check tells the user), instead of the old binary garbage."""
    try:
        import xlrd  # type: ignore[import-not-found]
    except ImportError:
        logger.info("xlrd is not installed; no text extracted from legacy .xls file %s", file_path)
        return ""
    book = xlrd.open_workbook(file_path)
    parts: list[str] = []
    for sheet in book.sheets():
        parts.append(f"=== Sheet: {sheet.name} ===")
        for r in range(sheet.nrows):
            cells = [str(c).strip() for c in sheet.row_values(r)]
            if any(cells):
                parts.append(" | ".join(cells).rstrip(" |"))
    return "\n".join(parts)


def _extract_text(file_path: str, content_type: str) -> str:
    """Extract the WHOLE plain text of an uploaded document.

    PDF   text layer per page, joined with ``[[PAGE n]]`` markers so chunking cuts on page
          breaks and evidence citations can name pages; an image-only (scanned) PDF yields ""
          (OCR lives in Document Capture) instead of silently analysing nothing.
    DOCX  paragraphs AND table rows (tables were ignored before).
    XLSX  every sheet, row by row (was read as binary garbage before).
    XLS   via xlrd when available, else "".
    TXT   decoded as UTF-8; binary-looking content yields "".
    Never raises; failures are logged and yield "".
    """
    ct = (content_type or "").lower()
    name = (file_path or "").lower()
    try:
        if "pdf" in ct or name.endswith(".pdf"):
            from pypdf import PdfReader

            pages = [(page.extract_text() or "") for page in PdfReader(file_path).pages]
            if not any(p.strip() for p in pages):
                return ""
            return ai_chunking.page_marked_text(pages) if len(pages) > 1 else pages[0].strip()
        if "docx" in ct or "word" in ct or name.endswith(".docx"):
            from docx import Document as DocxDocument

            document = DocxDocument(file_path)
            parts = [p.text for p in document.paragraphs if p.text and p.text.strip()]
            for table in document.tables:
                for row in table.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))
            return "\n".join(parts)
        if "spreadsheetml" in ct or name.endswith(".xlsx"):
            return _extract_xlsx(file_path)
        if "ms-excel" in ct or name.endswith(".xls"):
            return _extract_xls(file_path)
        if ct.startswith("text/") or name.endswith(_PLAIN_TEXT_SUFFIXES) or not ct:
            raw = Path(file_path).read_bytes()
            if b"\x00" in raw[:4096]:
                return ""
            return raw.decode("utf-8", errors="ignore")
        return ""
    except Exception:  # noqa: BLE001 — extraction must never break an upload
        logger.warning("text extraction failed for %s (%s)", file_path, ct, exc_info=True)
        return ""


# ─── AI site 1: document set × framework controls (control_assessment task) ──────

#: Model verdict -> ControlStatus. Source of truth is the foundation's mapping;
#: ``insufficient_evidence`` scores as not evidenced, and the notes/gap say so explicitly.
_VERDICT_STATUS: dict[str, ControlStatus] = {
    verdict: ControlStatus(value) for verdict, value in ai_prompts.VERDICT_TO_CONTROL_STATUS.items()
}


def _build_control_specs(
    controls: list, reqs_by_control: dict[str, list],
) -> tuple[list[ai_chunking.ControlSpec], dict[str, list]]:
    """ORM controls -> ``ControlSpec`` list for the assessor, plus ``spec id -> [FrameworkControl]``.

    The assessor requires unique, non-empty identifiers. Rows sharing one identifier
    (possible in cloned/custom frameworks) are judged once and receive the same verdict;
    a row with no identifier gets a positional one so it is still assessed.
    """
    specs: list[ai_chunking.ControlSpec] = []
    by_key: dict[str, list] = {}
    for idx, control in enumerate(controls):
        spec = ai_chunking.control_spec_from_model(control, reqs_by_control.get(control.id, []))
        key = spec.control_id or f"CTRL-{idx + 1}"
        spec.control_id = key
        rows = by_key.setdefault(key, [])
        if rows:
            logger.warning("framework control identifier %r appears more than once; rows share one verdict", key)
        else:
            specs.append(spec)
        rows.append(control)
    return specs, by_key


def _framework_label_text(name: str | None, version: str | None, short: str | None) -> str:
    """Clean, single-line "Name Version (Short)" display string built from raw framework fields.

    NOT platform-trusted: Framework.name/version/short_name are tenant-editable free text (a
    tenant can clone a built-in framework via POST /frameworks/{id}/clone then PATCH the clone
    to any text). ``clean_field()`` only makes the value single-line and length-capped — it does
    NOT fence it or mark it as data-not-instructions. Callers MUST run the result through
    ``ai_provider.delimit_untrusted(..., "FRAMEWORK NAME")`` before it reaches a prompt; never
    pass it as ``ai_prompts.system_prompt``'s ``extra_context`` (or ai_chunking's
    ``assess_controls_over_document(framework_label=...)``, whose internal per-batch renderers
    apply a naive 200-char slice that would cut a delimiting fence in half and leave it
    unclosed) without delimiting it first."""
    n = ai_provider.clean_field(name, 120)
    v = ai_provider.clean_field(version, 40)
    s = ai_provider.clean_field(short, 40)
    label = " ".join(x for x in (n, v) if x)
    return f"{label} ({s})" if s else label


def _framework_label(framework: Framework | None) -> str:
    if framework is None:
        return ""
    return _framework_label_text(framework.name, framework.version, framework.short_name)


def _analysis_context(
    tenant: Tenant | None, assessment: ComplianceAssessment, framework: Framework | None = None,
) -> str | None:
    """Framework label + organisation profile (short platform fields) + the user-authored scope
    statement — all three delimited as untrusted third-party data. Framework.name/version/
    short_name (see ``_framework_label_text``) and tenant.name/industry/country/org_size are
    tenant-editable, not platform-trusted facts, and this string lands verbatim, ahead of the
    (also fenced) document text, in every judge/locate prompt for every control on the tenant;
    clean_field() alone (single-line, length-capped) does not neutralise fence look-alikes or
    mark the text as data-not-instructions the way delimit_untrusted() does. This is the ONLY
    channel the framework label reaches ``assess_controls_over_document`` through — the call
    site passes ``framework_label=""`` so the tenant-controlled name never reaches the
    unfenced/unbounded ``extra_context`` CONTEXT header or the 200-char-truncated per-batch
    "- Framework: %s" line that function renders internally."""
    fw_label = _framework_label(framework)
    facts: list[str] = []
    if tenant is not None:
        org = ai_provider.clean_field(tenant.name, 120)
        if org:
            facts.append(f"Organisation: {org}")
        for label, value in (("industry", tenant.industry), ("country", tenant.country), ("size", tenant.org_size)):
            clean = ai_provider.clean_field(value, 60)
            if clean:
                facts.append(f"{label}: {clean}")
    lines: list[str] = []
    if fw_label:
        lines.append(ai_provider.delimit_untrusted(fw_label, "FRAMEWORK NAME", max_len=len(fw_label) + 1))
    facts_line = "; ".join(facts)
    if facts_line:
        lines.append(ai_provider.delimit_untrusted(facts_line, "ORG PROFILE", max_len=len(facts_line) + 1))
    scope = (assessment.scope_description or "").strip()
    if scope:
        # ai_chunking's _context_text hard-caps the WHOLE context string at 1500 chars with a
        # plain slice (not fence-aware), so the fences here must never together exceed that or a
        # closing "<<<END ...>>>" marker gets truncated. Budget what's left after the FRAMEWORK
        # NAME + ORG PROFILE blocks above (220 = a fence's own overhead + a safety margin),
        # capped to the original 1000-char allowance for a scope statement (a paragraph, not a
        # document).
        used = len("\n".join(lines)) + 1 if lines else 0
        cap = max(200, min(1000, 1500 - used - 220))
        lines.append(ai_provider.delimit_untrusted(scope[:cap], "SCOPE STATEMENT", max_len=cap + 1))
    return "\n".join(lines) or None


def _implementation_notes(v: ai_chunking.ControlVerdict, lang: str) -> str:
    """What the CISO (and an external auditor) reads under "AI assessment": the model's
    explanation, the requirement it applied, every VERIFIED quotation with its source, and the
    post-check notes (downgrades, dropped quotes) so nothing is hidden."""
    parts: list[str] = []
    if v.verdict == "insufficient_evidence":
        parts.append(_t(lang, "no_evidence"))
    rationale = " ".join((v.rationale or "").split())
    if rationale:
        parts.append(rationale)
    requirement = " ".join((v.requirement_applied or "").split())
    if requirement:
        parts.append(f"{_t(lang, 'requirement')}: {requirement}")
    for quote in v.evidence:
        text = " ".join((quote.quote or "").split())
        if not quote.located or not text:
            continue
        where = quote.source or "document"
        if quote.label:
            where += f", {quote.label}"
        parts.append(f'{_t(lang, "evidence")} ({where}): "{text}"')
    notes = list(dict.fromkeys(w.strip() for w in (v.warnings or ()) if w and w.strip()))
    if notes:
        parts.append(f"{_t(lang, 'note')}: " + "; ".join(notes))
    return "\n".join(parts)


def _gap_severity(v: ai_chunking.ControlVerdict, ctrl_status: ControlStatus, has_must: bool) -> str:
    """The model's rubric-based severity when it gave one, else the platform's must-based rule."""
    if v.gap_severity in ai_chunking.GAP_SEVERITIES:
        return v.gap_severity
    if v.verdict == "insufficient_evidence":
        return "medium" if has_must else "low"
    if ctrl_status == ControlStatus.NOT_IMPLEMENTED:
        return "high" if has_must else "medium"
    return "medium" if has_must else "low"


def _gap_priority(severity: str, is_blocker: bool) -> int:
    """remediation_priority values stay in {90, 60, 50, 30}: list_action_plan maps them to
    ActionItem priorities critical/high/medium/low."""
    if is_blocker or severity == "critical":
        return 90
    if severity == "high":
        return 60
    if severity == "medium":
        return 50
    return 30


# ─── STB objectif 2/3: perimeter, customisable grid, gap → action-plan loop ───
# Three things this module never had, and the tender is built on all three:
#
#   * a PERIMETER — « évaluer le niveau de conformité DES PROCESSUS, DÉPARTEMENTS
#     OU SYSTÈMES » — instead of one implicit organisation-wide run per framework;
#   * a CUSTOMISABLE GRID (ComplianceScale) driving both the status vocabulary and
#     the score, instead of a hard-coded enum and a hard-coded formula;
#   * WRITERS for ComplianceGap.is_resolved. There were none anywhere in the
#     backend, so all 625 production gaps were permanently open, nothing a user
#     did could ever close one, and the compliance score was frozen the moment the
#     AI had run.
#
# Everything below degrades to the exact previous behaviour when the new columns
# are null — which is what all 51 live assessments are.

SCOPE_TYPES = ("tenant", "org_entity", "business_process", "assets")

#: The two legacy statuses that have always produced a ComplianceGap in the AI
#: path; used when the assessment is graded on the enum rather than on a scale.
_LEGACY_GAP_STATUSES = (ControlStatus.NOT_IMPLEMENTED, ControlStatus.PARTIALLY_IMPLEMENTED)

#: ``file_integrity.entity_type`` is a free string. A dedicated value keeps
#: action-plan attachments out of the evidence integrity report while giving them
#: the same version history, checksum and recovery path as evidence.
_ACTION_ATTACHMENT = "action_item_attachment"

#: « actions correctives OU PRÉVENTIVES » — the distinction objectif 3 is built on.
ACTION_TYPES = ("corrective", "preventive")
#: A preventive action is typically recurring ("revue trimestrielle des habilitations").
ACTION_RECURRENCES = ("monthly", "quarterly", "semiannual", "annual")


# ── Perimeter ────────────────────────────────────────────────────────────────

async def _validate_scope(
    db: AsyncSession,
    tenant_id: str,
    scope_type: str,
    org_entity_id: str | None,
    business_process_id: str | None,
    in_scope_assets: list[str] | None,
) -> None:
    """Reject a perimeter that does not exist or belongs to another tenant.

    Both id columns are plain foreign keys on a SQLite database with foreign-key
    enforcement off, so without this an assessment could be pointed at another
    bank's department and read its name back out of the detail response.
    """
    if scope_type not in SCOPE_TYPES:
        raise HTTPException(status_code=422, detail=f"scope_type must be one of {list(SCOPE_TYPES)}")

    if org_entity_id:
        entity = (await db.execute(
            select(OrgEntity).where(OrgEntity.id == org_entity_id, OrgEntity.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if entity is None:
            raise HTTPException(status_code=422, detail="org_entity_id does not exist in this tenant")
    if business_process_id:
        proc = (await db.execute(
            select(BusinessProcess).where(
                BusinessProcess.id == business_process_id,
                BusinessProcess.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if proc is None:
            raise HTTPException(status_code=422, detail="business_process_id does not exist in this tenant")
    if in_scope_assets:
        await assert_assets_in_tenant(db, in_scope_assets, tenant_id, field_name="in_scope_assets")

    # The perimeter must actually carry the thing it claims to scope, otherwise
    # « conformité de la DSI » would be stored indistinguishably from an
    # organisation-wide run and the coverage endpoints below would report nothing.
    if scope_type == "org_entity" and not org_entity_id:
        raise HTTPException(status_code=422, detail="org_entity_id is required when scope_type is 'org_entity'")
    if scope_type == "business_process" and not business_process_id:
        raise HTTPException(
            status_code=422, detail="business_process_id is required when scope_type is 'business_process'")
    if scope_type == "assets" and not in_scope_assets:
        raise HTTPException(
            status_code=422, detail="in_scope_assets must name at least one asset when scope_type is 'assets'")


def _normalize_scope(
    scope_type: str,
    org_entity_id: str | None,
    business_process_id: str | None,
) -> tuple[str | None, str | None]:
    """Drop the perimeter ids that do not belong to the declared ``scope_type``.

    ``scope_type`` names WHICH of the three nouns an assessment covers and the
    matching id column carries it, so an id left over from another scope is not
    merely untidy: ``coverage/by-entity`` groups on ``org_entity_id`` alone, so an
    organisation-wide assessment that still carried a stale ``org_entity_id``
    would be reported as that department's conformity — « la DSI est à 62% »
    computed from a group-wide run. Refusing the extra id would break a caller
    that simply sends its whole form back; clearing it cannot.
    """
    return (
        org_entity_id if scope_type == "org_entity" else None,
        business_process_id if scope_type == "business_process" else None,
    )


def _scope_key(assessment_or_body) -> tuple:
    """The identity of a perimeter, used as the de-duplication key.

    The create handler used to de-duplicate on (tenant, framework) alone and hand
    back the existing row, so a bank could never run "ISO 27001 sur la DSI"
    alongside "ISO 27001 sur la filière monétique" — one live assessment per
    framework, forever. Widening the key to the perimeter is what unlocks that,
    while an organisation-wide re-create still returns the existing row exactly
    as before.

    For a SYSTEMS perimeter the set of assets IS the perimeter: without it in the
    key, "ISO 27001 sur le SI monétique" and "ISO 27001 sur le core banking"
    collapse into one row and « ou systèmes » is no more expressible than it was
    before the column existed. It is deliberately absent from the key for every
    other scope_type, where in_scope_assets is a free-form scope note rather than
    the perimeter's identity.
    """
    scope_type = getattr(assessment_or_body, "scope_type", None) or "tenant"
    assets: frozenset | None = None
    if scope_type == "assets":
        assets = frozenset(str(a) for a in (getattr(assessment_or_body, "in_scope_assets", None) or []))
    return (
        getattr(assessment_or_body, "framework_id", None),
        scope_type,
        getattr(assessment_or_body, "org_entity_id", None),
        getattr(assessment_or_body, "business_process_id", None),
        assets,
    )


async def _scope_names(db: AsyncSession, assessments: list, tenant_id: str) -> tuple[dict, dict]:
    """(org entity id -> name, business process id -> name) for a set of assessments,
    in two queries rather than two per row.

    Tenant-filtered even though the ids were validated on the way in: these names
    are echoed straight back in the API response, and a row that predates the
    validation (or was written by another path) must not turn this into a way to
    read another bank's org chart one id at a time.
    """
    entity_ids = {a.org_entity_id for a in assessments if getattr(a, "org_entity_id", None)}
    process_ids = {a.business_process_id for a in assessments if getattr(a, "business_process_id", None)}
    entities: dict[str, str] = {}
    processes: dict[str, str] = {}
    if entity_ids:
        entities = {
            e.id: e.name for e in (await db.execute(
                select(OrgEntity).where(OrgEntity.id.in_(entity_ids), OrgEntity.tenant_id == tenant_id)
            )).scalars().all()
        }
    if process_ids:
        processes = {
            p.id: p.name for p in (await db.execute(
                select(BusinessProcess).where(
                    BusinessProcess.id.in_(process_ids), BusinessProcess.tenant_id == tenant_id
                )
            )).scalars().all()
        }
    return entities, processes


# ── Customisable grid (« grille d'évaluation personnalisable ») ──────────────

def _scale_levels(scale: ComplianceScale | None) -> list[dict]:
    """The level dicts of a scale, defensively filtered — ``levels`` is free JSON."""
    if scale is None:
        return []
    return [lv for lv in (scale.levels or []) if isinstance(lv, dict) and lv.get("key")]


async def _load_scale(db: AsyncSession, assessment: ComplianceAssessment) -> ComplianceScale | None:
    """The grid an assessment is graded on, or None for the legacy enum.

    Queried ONLY when scale_id is set. compliance_scales is a brand-new table and
    every existing assessment has a null scale_id, so the legacy path never
    touches it — which also means this file keeps working on a server whose
    create_all() has not run yet.
    """
    if not getattr(assessment, "scale_id", None):
        return None
    try:
        return (await db.execute(
            select(ComplianceScale).where(ComplianceScale.id == assessment.scale_id)
        )).scalar_one_or_none()
    except (OperationalError, ProgrammingError):
        # compliance_scales is created by create_all() at the next restart. An
        # assessment that already names a scale must fall back to the legacy enum
        # rather than 500 the whole screen — client.ts hard-redirects the SPA to
        # /service-down on any 5xx. Same tolerance frameworks.py gives its own new
        # tables.
        logger.debug("compliance.scale.unavailable assessment=%s", getattr(assessment, "id", None))
        return None


async def _resolve_scale(db: AsyncSession, tenant_id: str, scale_id: str) -> ComplianceScale:
    """Validate a scale a caller is attaching: built-in rows are shared and
    read-only, exactly like built-in frameworks and risk matrices; a tenant may
    also own its own."""
    try:
        scale = (await db.execute(
            select(ComplianceScale).where(
                ComplianceScale.id == scale_id,
                (ComplianceScale.is_builtin == True) | (ComplianceScale.tenant_id == tenant_id),  # noqa: E712
            )
        )).scalar_one_or_none()
    except (OperationalError, ProgrammingError):
        # The grid table itself is absent. That is an operator step (restart, then
        # seed the built-in scale), not a malformed request, and saying so is the
        # difference between a 5xx that bounces the SPA to /service-down and a
        # message somebody can act on.
        raise HTTPException(
            status_code=424,
            detail="Evaluation grids are not available until the server has been restarted "
                   "once (compliance_scales is created at startup).",
        )
    if scale is None:
        raise HTTPException(status_code=422, detail="scale_id does not exist or is not available to this tenant")
    if not _scale_levels(scale):
        raise HTTPException(status_code=422, detail="scale_id points at a scale that defines no levels")
    return scale


def _level_by_key(scale: ComplianceScale | None, key: str | None) -> dict | None:
    if not key:
        return None
    for level in _scale_levels(scale):
        if level.get("key") == key:
            return level
    return None


def _level_for_status(scale: ComplianceScale | None, status: ControlStatus | None) -> dict | None:
    """The level whose ``legacy_status`` matches an enum value — the bridge that
    lets a row written before a scale was attached still score under it."""
    if status is None:
        return None
    wanted = getattr(status, "value", status)
    for level in _scale_levels(scale):
        if level.get("legacy_status") == wanted:
            return level
    return None


def _level_for_ca(scale: ComplianceScale | None, ca: ControlAssessment) -> dict | None:
    """Where a control assessment sits on the grid: its own status_key when it has
    one, else the level matching its legacy enum."""
    return _level_by_key(scale, getattr(ca, "status_key", None)) or _level_for_status(scale, ca.status)


def _status_key_for(scale: ComplianceScale | None, status: ControlStatus | None) -> str | None:
    level = _level_for_status(scale, status)
    return level.get("key") if level else None


def _compute_score(cas: list, scale: ComplianceScale | None, total: int | None = None) -> float:
    """The assessment's compliance percentage.

    With a scale: the mean of the levels' weights, levels whose weight is null
    (« non applicable ») dropped from the denominator — so a five-level maturity
    grid scores correctly without this formula changing at all.

    Without one: the historical ``(implemented + 0.5 × partial) / scoreable``,
    kept byte-for-byte so all 51 live assessments keep the score they show today.
    ``total`` exists because the AI path divides by the framework's control count
    while the manual path divides by the number of assessed rows.

    The two branches must agree on WHAT IS IN THE DENOMINATOR, or attaching a grid
    silently rewrites every score. Only « non applicable » is ever dropped: a row
    the grid has no level for (NOT_STARTED / IN_PROGRESS — the shipped grid defines
    a level for neither) scores zero and STAYS in the denominator, exactly as the
    legacy formula counts it, and an assessment with 10 conforme and 90 unassessed
    requirements therefore reads 10%, not 100%. Likewise ``total`` applies to both
    branches, so the AI path keeps dividing by the framework's control count and
    controls it never scored at all are not quietly excused.
    """
    if scale is not None and _scale_levels(scale):
        weights: list[float] = []
        dropped = 0  # « non applicable » — out of the denominator, like NOT_APPLICABLE
        for ca in cas:
            level = _level_for_ca(scale, ca)
            if level is None:
                if ca.status == ControlStatus.NOT_APPLICABLE:
                    dropped += 1
                else:
                    weights.append(0.0)
                continue
            raw = level.get("weight")
            if raw is None:
                dropped += 1
                continue
            try:
                weights.append(float(raw))
            except (TypeError, ValueError):
                weights.append(0.0)
        denominator = len(weights) if total is None else max(len(weights), total - dropped)
        return round(sum(weights) / denominator * 100, 1) if denominator > 0 else 0.0

    implemented = sum(1 for c in cas if c.status == ControlStatus.IMPLEMENTED)
    partial = sum(1 for c in cas if c.status == ControlStatus.PARTIALLY_IMPLEMENTED)
    not_applicable = sum(1 for c in cas if c.status == ControlStatus.NOT_APPLICABLE)
    denominator = (len(cas) if total is None else total) - not_applicable
    return round((implemented + partial * 0.5) / denominator * 100, 1) if denominator > 0 else 0.0


def _is_scoreable(ca: ControlAssessment, scale: ComplianceScale | None) -> bool:
    """Does this row count towards the percentage at all?

    With a grid, a level whose weight is null (« non applicable ») does not; without
    one, ControlStatus.NOT_APPLICABLE does not — the two have always been the same
    rule, only expressed differently.
    """
    level = _level_for_ca(scale, ca)
    if level is not None:
        return level.get("weight") is not None
    return ca.status != ControlStatus.NOT_APPLICABLE


def _rescore(assessment: ComplianceAssessment, cas: list, scale: ComplianceScale | None) -> None:
    """Recompute the assessment's score, leaving it untouched when nothing is
    scoreable. An assessment whose every requirement is « non applicable » has no
    percentage, and writing 0 there would read as total failure rather than as
    "not applicable" — which is exactly what the previous code avoided with its
    ``if scoreable > 0`` guard."""
    if any(_is_scoreable(ca, scale) for ca in cas):
        assessment.compliance_score = _compute_score(cas, scale)


def _is_gap_level(
    scale: ComplianceScale | None, status: ControlStatus | None, status_key: str | None = None,
) -> bool:
    """Does the level this control sits on open a non-conformité?

    With a scale it is the level's own ``counts_as_gap`` flag — the hook the
    tender's « génération automatique de plans d'action pour les non-conformités »
    hangs on. Without one it is the two legacy statuses the AI path has always
    treated as gaps.
    """
    level = _level_by_key(scale, status_key) or _level_for_status(scale, status)
    if level is not None:
        return bool(level.get("counts_as_gap"))
    return status in _LEGACY_GAP_STATUSES


def _closure_level_key(scale: ComplianceScale | None) -> str | None:
    """The « conforme » level of a grid: the heaviest level that is not a gap."""
    candidates = [
        lv for lv in _scale_levels(scale)
        if not lv.get("counts_as_gap") and lv.get("weight") is not None
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda lv: float(lv.get("weight") or 0)).get("key")


def _regression_level_key(scale: ComplianceScale | None) -> str | None:
    """The « partiellement conforme » level: the heaviest level that IS a gap —
    where a requirement lands when a closed action is re-opened."""
    candidates = [lv for lv in _scale_levels(scale) if lv.get("counts_as_gap")]
    if not candidates:
        return None
    return max(candidates, key=lambda lv: float(lv.get("weight") or 0)).get("key")


def _manual_gap_severity(ctrl_status: ControlStatus, has_must: bool) -> str:
    """Severity of a gap opened by a HUMAN evaluation, where there is no AI verdict
    to read a rubric off. Mirrors the no-verdict branch of ``_gap_severity`` so an
    auditor's « non conforme » is graded exactly like the model's."""
    if ctrl_status == ControlStatus.NOT_IMPLEMENTED:
        return "high" if has_must else "medium"
    return "medium" if has_must else "low"


async def _sync_gap_for_control(
    db: AsyncSession,
    assessment: ComplianceAssessment,
    ca: ControlAssessment,
    control: FrameworkControl,
    lang: str,
    scale: ComplianceScale | None,
) -> tuple[str | None, bool]:
    """Open, keep or RESOLVE the ComplianceGap mirroring a control's level.

    This is the ``ComplianceGap.is_resolved`` writer the platform never had.
    Before it, marking a control « conforme » by hand left its gap open forever
    and re-running the whole AI analysis was the only thing that could clear one
    — which is also why 625 of 625 production gaps are unresolved.

    Returns ``(gap_id, resolved_now)``; writes into the caller's session and lets
    the caller commit.
    """
    existing = list((await db.execute(
        select(ComplianceGap).where(
            ComplianceGap.assessment_id == assessment.id,
            ComplianceGap.control_id == ca.control_id,
        )
    )).scalars().all())

    if _is_gap_level(scale, ca.status, getattr(ca, "status_key", None)):
        open_gap = next((g for g in existing if not g.is_resolved), None)
        if open_gap is not None:
            return open_gap.id, False
        if existing:
            # A control that regresses re-opens the SAME gap, so its action plan,
            # owner, dates and history survive instead of restarting from an empty
            # row every time somebody flips the status back and forth.
            existing[0].is_resolved = False
            return existing[0].id, False

        req_levels = (await db.execute(
            select(ControlRequirement.requirement_level).where(ControlRequirement.control_id == ca.control_id)
        )).scalars().all()
        has_must = "must" in [str(r) for r in req_levels]
        identifier = control.control_id or ca.control_id
        severity = _manual_gap_severity(ca.status, has_must)
        # "Not evidenced" is a gap to evidence; only a verdict that the control is
        # genuinely absent blocks certification — same rule as the AI path.
        is_blocker = ca.status == ControlStatus.NOT_IMPLEMENTED and has_must
        gap = ComplianceGap(
            assessment_id=assessment.id,
            control_id=ca.control_id,
            gap_description=_t(lang, "gap_manual", title=control.title, control_id=identifier),
            severity=severity,
            remediation_steps=_t(lang, "remediation_default", title=control.title, control_id=identifier),
            is_certification_blocker=is_blocker,
            remediation_priority=_gap_priority(severity, is_blocker),
        )
        db.add(gap)
        await db.flush()
        return gap.id, False

    # The control is on a non-gap level: the non-conformité is closed.
    resolved_now = False
    for gap in existing:
        if not gap.is_resolved:
            gap.is_resolved = True
            resolved_now = True
    return (existing[0].id if existing else None), resolved_now


async def sync_action_items(
    db: AsyncSession, tenant_id: str, assessment_id: str | None = None,
) -> int:
    """Create the missing ActionItem for every OPEN ComplianceGap of the tenant.

    « Génération automatique de plans d'action pour les non-conformités ». This
    used to live inline in ``list_action_plan``, which meant the plan only came
    into existence when somebody happened to open the action-plan screen — never
    at the moment an auditor recorded the non-conformity. Extracted so both the
    evaluation path and the end of an AI analysis can call it.

    Resolved gaps are skipped: without that filter, closing a gap would simply
    grow a fresh action item for it on the next page load.

    Writes into the CALLER's session and lets the caller commit — an isolated
    session cannot write while the caller holds SQLite's single write lock.
    Returns how many items were created.
    """
    assessment_ids = (await db.execute(
        select(ComplianceAssessment.id).where(ComplianceAssessment.tenant_id == tenant_id)
    )).scalars().all()
    if assessment_id is not None:
        assessment_ids = [a for a in assessment_ids if a == assessment_id]
    if not assessment_ids:
        return 0

    open_gaps = list((await db.execute(
        select(ComplianceGap).where(
            ComplianceGap.assessment_id.in_(assessment_ids),
            ComplianceGap.is_resolved == False,  # noqa: E712
        )
    )).scalars().all())
    if not open_gaps:
        return 0

    covered_gap_ids: set[str] = set((await db.execute(
        select(ActionItem.gap_id).where(
            ActionItem.tenant_id == tenant_id,
            ActionItem.gap_id.isnot(None),
        )
    )).scalars().all())

    orphan_gaps = [g for g in open_gaps if g.id not in covered_gap_ids]
    if not orphan_gaps:
        return 0

    ctrl_map: dict = {}
    orphan_ctrl_ids = {g.control_id for g in orphan_gaps if g.control_id}
    if orphan_ctrl_ids:
        ctrl_map = {
            c.id: c for c in (await db.execute(
                select(FrameworkControl).where(FrameworkControl.id.in_(orphan_ctrl_ids))
            )).scalars().all()
        }

    priority_map = {
        90: ActionItemPriority.CRITICAL, 60: ActionItemPriority.HIGH,
        50: ActionItemPriority.MEDIUM,   30: ActionItemPriority.LOW,
    }
    created = 0
    for gap in orphan_gaps:
        ctrl = ctrl_map.get(gap.control_id or "")
        title = f"Remediate: {ctrl.title}" if ctrl else (gap.gap_description or "")[:120]
        item = ActionItem(
            tenant_id=tenant_id,
            assessment_id=gap.assessment_id,
            gap_id=gap.id,
            title=title,
            description=gap.gap_description,
            priority=priority_map.get(gap.remediation_priority or 30, ActionItemPriority.MEDIUM),
            status=ActionItemStatus.OPEN,
            ai_generated=True,
            action_type="corrective",
        )
        db.add(item)
        await db.flush()
        # Keep the back-reference in step so the traceability matrix and the gap
        # card can both find the action without a scan.
        if not gap.action_item_id:
            gap.action_item_id = item.id
        created += 1
    return created


async def _mark_analysis_failed(db: AsyncSession, assessment: ComplianceAssessment, detail: str) -> None:
    """Explicit failure state the SPA shows (analyze-status: status="failed", error=...).
    Called before any result row was touched, so the previous results stay intact."""
    assessment.ai_analysis_status = "failed"
    assessment.ai_analysis_error = (detail or "AI analysis failed.")[:500]
    await db.commit()


# ─── AI site 2: document → framework clause tags + factual summary (clause_coverage task) ──


class _ClauseStepFailed(Exception):
    """One chunk of the clause-coverage job produced no usable result (carries the AiResult)."""

    def __init__(self, res) -> None:
        self.res = res
        super().__init__(res.failure_detail() or "The AI request failed.")


def _salvage_clause_reply(res, schema: dict) -> dict | None:
    """Schema-valid data from a reply that failed ONLY the allow-list consistency check after
    the repair turn. The stray identifiers are dropped deterministically by the caller (with a
    log line) rather than losing every valid tag in the chunk. Anything else stays a failure."""
    if res.ok or res.kind != "validation" or not res.raw:
        return None
    try:
        parsed = coerce_shape(extract_json(res.raw), schema)
        ok, _err, data = validate_against(parsed, schema)
    except Exception:  # noqa: BLE001 — a salvage attempt must never raise
        return None
    return data if ok and isinstance(data, dict) else None


async def _detect_clauses_background(
    doc_id: str,
    doc_text: str,
    *,
    framework_id: str,
    framework_name: str,
    framework_version: str,
    framework_short_name: str,
    doc_name: str,
    checklist_item: str,
    expected_clause: str,
    lang: str,
    user_id: str | None,
    tenant_id: str | None,
) -> None:
    """Tag an uploaded document with the clauses of the ASSESSMENT'S framework it addresses and
    store a factual summary (``UploadedDocument.clause_refs`` / ``ai_analysis_summary``).

    Whole text, chunked (never ``[:6000]``); one ``clause_coverage`` call per chunk with the
    framework's real control identifiers as the allow-list; every returned identifier is
    resolved against that list and every quotation is verified against the chunk text.
    Only "addresses" entries become tags ("mentions" = a heading or reference, not a practice).
    A failure is surfaced in the document's summary in the UI language — never left
    indistinguishable from "no clauses apply".
    """
    lang = normalize_language(lang) or "en"
    refs: list[str] = []
    summary: str | None = None
    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(FrameworkControl.control_id)
                .where(FrameworkControl.framework_id == framework_id)
                .order_by(FrameworkControl.sort_order)
            )).scalars().all()
        allowed = list(dict.fromkeys(str(r).strip() for r in rows if r and str(r).strip()))
        if not allowed:
            logger.info("clause detection skipped for document %s: framework %s has no controls", doc_id, framework_id)
            return
        chunks = ai_chunking.chunk_documents([(doc_name, doc_text)])
        if not chunks:
            return
        # Job-size guard: an unbounded chunk count (one ai_structured call each, up to 2 model
        # calls with the repair turn) would spend hours of background work per upload and starve
        # the foreground control-assessment job on the same worker (AI_MAX_PARALLEL_CALLS). Widen
        # the window once like the assessor does (ai_chunking.assess_controls_over_document), then
        # refuse honestly instead of running unbounded.
        max_calls = max(2, int(getattr(settings, "AI_MAX_CALLS_PER_JOB", 60) or 60) // 2)
        if len(chunks) > max_calls:
            chunks = ai_chunking.chunk_documents([(doc_name, doc_text)], ai_chunking.MAX_CHUNK_TOKENS)
        if len(chunks) > max_calls:
            logger.info("clause detection skipped for document %s: %d chunks exceeds the per-job guard (%d)",
                        doc_id, len(chunks), max_calls)
            summary = _t(lang, "clause_too_large", n=len(chunks), limit=max_calls)
            try:
                async with AsyncSessionLocal() as guard_db:
                    doc = await guard_db.get(UploadedDocument, doc_id)
                    if doc is not None:
                        doc.clause_refs = refs                 # []
                        doc.ai_analysis_summary = summary[:2000]
                        await guard_db.commit()
            except Exception:  # noqa: BLE001
                logger.exception("clause detection: could not store the result for document %s", doc_id)
            return

        task = "clause_coverage"
        # Framework.name/version/short_name are tenant-editable free text (see
        # _framework_label_text) — never pass the raw label as `extra_context` (system_prompt
        # appends it verbatim under the "rely on them, never contradict them" CONTEXT header).
        # Delimit it as untrusted data; the sentence framing stays outside the fence.
        fw_label = _framework_label_text(framework_name, framework_version, framework_short_name)
        context = (
            "Framework under assessment:\n"
            + ai_provider.delimit_untrusted(fw_label, "FRAMEWORK NAME", max_len=len(fw_label) + 1)
        ) if fw_label else None
        system = ai_prompts.system_prompt(task, lang=lang, extra_context=context)
        schema = ai_prompts.task_schema(task)
        defaults = ai_prompts.task_defaults(task)
        decoding = ai_provider.decoding(defaults["preset"], temperature=defaults["temperature"])
        resolver = ai_chunking.build_id_resolver(allowed)
        allowed_block = ", ".join(allowed)
        position = {cid: i for i, cid in enumerate(allowed)}
        failures: list = []

        def check(data):
            return ai_prompts.consistency_issues(task, data, allowed_values=allowed)

        async def one(chunk: ai_chunking.Chunk):
            # framework_name/framework_version are tenant-editable free text (see
            # _framework_label_text) landing in the "FRAMEWORK: ..." line of this user turn —
            # delimit each as untrusted data rather than interpolating clean_field()'s plain,
            # unfenced value directly (clean_field only makes it single-line and length-capped).
            fw_name_clean = ai_provider.clean_field(framework_name, 120) or "not stated"
            fw_version_clean = ai_provider.clean_field(framework_version, 40) or "not stated"
            user = ai_prompts.render_user_prompt(
                task,
                framework_name=ai_provider.delimit_untrusted(fw_name_clean, "FRAMEWORK NAME", max_len=len(fw_name_clean) + 1),
                framework_version=ai_provider.delimit_untrusted(fw_version_clean, "FRAMEWORK VERSION", max_len=len(fw_version_clean) + 1),
                # doc_name is always the server-generated display filename (never the raw
                # upload filename) — see upload_document's background_tasks.add_task call.
                doc_name=ai_provider.clean_field(doc_name, 150) or "document",
                chunk_index=chunk.index,
                chunk_total=chunk.total,
                checklist_item=ai_provider.clean_field(checklist_item, 150) or "not specified",
                expected_clause=ai_provider.clean_field(expected_clause, 60) or "not specified",
                id_count=len(allowed),
                allowed_ids=allowed_block,
                document_block=ai_provider.delimit_untrusted(chunk.text, "DOCUMENT", max_len=len(chunk.text) + 1),
            )
            res = await ai_structured(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                schema,
                schema_in_prompt=False,          # ai_prompts.system_prompt already carries the schema
                check=check,
                partial_items="covered",
                user_id=user_id,
                tenant_id=tenant_id,
                task="compliance.clause_coverage",
                **decoding,
            )
            data = res.data if res.ok else _salvage_clause_reply(res, schema)
            if data is None:
                failures.append(res)
                raise _ClauseStepFailed(res)
            if not res.ok:
                logger.info("clause detection %s part %d: kept schema-valid reply after allow-list check failed (%s)",
                            doc_id, chunk.index, res.failure_detail()[:200])
            return chunk, data

        results = await ai_chunking.map_reduce(chunks, one, list, allow_partial=True)

        seen: set[str] = set()
        mentions = dropped_ids = dropped_quotes = 0
        failed_chunks = 0
        for entry in results:
            if isinstance(entry, ai_chunking.MapFailure):
                # Counted from ``results`` itself (not the ``failures`` list ``one()`` fills) so a
                # chunk failing for any reason — including one that never reached the
                # ``_ClauseStepFailed`` branch — is still reflected, never silently dropped.
                failed_chunks += 1
                continue
            chunk, data = entry
            if summary is None:
                text = " ".join(str(data.get("summary") or "").split())
                summary = text or None
            for item in data.get("covered") or []:
                if not isinstance(item, dict):
                    continue
                cid = resolver(item.get("control_id"))
                if cid is None:
                    dropped_ids += 1
                    continue
                quote = str(item.get("quote") or "").strip()
                if quote and not ai_chunking.quote_in_text(quote, chunk.text):
                    dropped_quotes += 1
                    continue
                if item.get("strength") != "addresses":
                    mentions += 1
                    continue
                if cid not in seen:
                    seen.add(cid)
                    refs.append(cid)
        refs.sort(key=lambda cid: position.get(cid, len(position)))
        if failed_chunks and failed_chunks >= len(chunks):
            # Every chunk failed: nothing usable came back — honest, localised; clause_refs stay [].
            summary = failures[0].user_message(lang) if failures else _t(lang, "clause_failed")
        elif failed_chunks:
            # Some chunks failed: keep what the rest found, but say so — a partial summary must
            # never read as "that part of the document addresses nothing".
            note = _t(lang, "clause_partial", n=failed_chunks, total=len(chunks))
            summary = f"{summary} {note}".strip() if summary else note
        logger.info("clause detection %s: chunks=%d failed=%d tags=%d mentions=%d dropped_ids=%d dropped_quotes=%d",
                    doc_id, len(chunks), failed_chunks, len(refs), mentions, dropped_ids, dropped_quotes)
    except Exception:  # noqa: BLE001 — a background job must report, never crash silently
        logger.exception("clause detection failed for document %s", doc_id)
        summary = summary or _t(lang, "clause_failed")

    try:
        async with AsyncSessionLocal() as db:
            doc = await db.get(UploadedDocument, doc_id)
            if doc is not None:
                doc.clause_refs = refs
                if summary:
                    doc.ai_analysis_summary = summary[:2000]
                await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("clause detection: could not store the result for document %s", doc_id)


async def _compute_cross_framework_coverage(
    db: AsyncSession,
    assessment: "ComplianceAssessment",
) -> dict:
    """
    Build cross-framework summary from the tenant's other active assessments.
    Each entry shows: compliance_score, total controls, implemented count,
    gap count, and assessment_id so the frontend can link to it.
    """
    other_assessments_result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.tenant_id == assessment.tenant_id,
            ComplianceAssessment.id != assessment.id,
            ComplianceAssessment.framework_id != assessment.framework_id,
        )
    )
    other_assessments = other_assessments_result.scalars().all()

    if not other_assessments:
        return {}

    fw_ids = [a.framework_id for a in other_assessments]
    fws_result = await db.execute(select(Framework).where(Framework.id.in_(fw_ids)))
    fw_map: dict[str, Framework] = {fw.id: fw for fw in fws_result.scalars().all()}

    covered_statuses = {ControlStatus.IMPLEMENTED, ControlStatus.PARTIALLY_IMPLEMENTED}
    summary: dict[str, dict] = {}

    for other in other_assessments:
        fw = fw_map.get(other.framework_id)
        if not fw:
            continue

        cas_result = await db.execute(
            select(ControlAssessment).where(ControlAssessment.assessment_id == other.id)
        )
        cas = cas_result.scalars().all()
        total = len(cas)
        covered = sum(1 for ca in cas if ca.status in covered_statuses)
        gaps = sum(1 for ca in cas if ca.status == ControlStatus.NOT_IMPLEMENTED)

        summary[fw.short_name] = {
            "framework_name": fw.name,
            "framework_short_name": fw.short_name,
            "assessment_id": other.id,
            "compliance_score": round(other.compliance_score or 0.0, 1),
            "total": total,
            "covered": covered,
            "gaps": gaps,
            "percent": round(covered / total * 100, 1) if total > 0 else 0.0,
            # legacy fields kept for backward compat with old frontend rendering
            "total_mapped": total,
            "controls": [],
        }

    return summary


async def _build_assessment_detail(
    db: AsyncSession,
    assessment: ComplianceAssessment,
) -> AssessmentDetailResponse:
    """Build full AssessmentDetailResponse with all nested data."""
    fw_result = await db.execute(select(Framework).where(Framework.id == assessment.framework_id))
    framework = fw_result.scalar_one_or_none()
    framework_short_name = framework.short_name if framework else ""

    docs_result = await db.execute(
        select(UploadedDocument).where(UploadedDocument.assessment_id == assessment.id)
    )
    docs = docs_result.scalars().all()

    # Load mandatory document metadata so we can resolve clause_refs for checklist uploads
    md_result = await db.execute(
        select(MandatoryDocument).where(MandatoryDocument.framework_short_name == framework_short_name)
    )
    md_by_key: dict[str, MandatoryDocument] = {md.document_type_key: md for md in md_result.scalars().all()}

    # Build clause_ref → [LinkedChecklistDocument] map (only checklist uploads, not AI analysis uploads)
    clause_doc_map: dict[str, list[LinkedChecklistDocument]] = {}
    for d in docs:
        if d.document_type_key and d.document_type_key in md_by_key:
            md = md_by_key[d.document_type_key]
            linked = LinkedChecklistDocument(
                id=d.id,
                file_name=d.file_name,
                document_name=md.document_name,
                clause_ref=md.clause_ref,
                document_type_key=d.document_type_key,
                file_size_bytes=d.file_size_bytes,
                content_type=d.content_type,
            )
            clause_doc_map.setdefault(md.clause_ref, []).append(linked)

    ca_result = await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
    )
    cas = ca_result.scalars().all()

    # The customisable grid this assessment is graded on (null on every legacy
    # row, in which case nothing below queries compliance_scales at all), plus the
    # perimeter labels and the control owners, each in one bulk query.
    scale = await _load_scale(db, assessment)
    entity_names, process_names = await _scope_names(db, [assessment], assessment.tenant_id)
    owner_ids = {ca.owner_id for ca in cas if ca.owner_id}
    owners: dict[str, User] = {}
    if owner_ids:
        owners = {
            u.id: u for u in (await db.execute(
                select(User).where(User.id.in_(owner_ids), User.tenant_id == assessment.tenant_id)
            )).scalars().all()
        }

    ctrl_result = await db.execute(
        select(FrameworkControl).where(FrameworkControl.framework_id == assessment.framework_id)
    )
    controls = ctrl_result.scalars().all()
    controls_map: dict[str, FrameworkControl] = {c.id: c for c in controls}

    # Evidence validity per requirement, in one query (R2 5.4).
    today_iso = datetime.now(timezone.utc).date().isoformat()
    ev_stats: dict[str, list[int]] = {}
    if cas:
        for ca_id, valid_until in (await db.execute(
            select(Evidence.control_assessment_id, Evidence.valid_until).where(
                Evidence.control_assessment_id.in_([ca.id for ca in cas]),
                Evidence.tenant_id == assessment.tenant_id,
            )
        )).all():
            st = ev_stats.setdefault(ca_id, [0, 0])
            st[0] += 1
            if valid_until and valid_until[:10] < today_iso:
                st[1] += 1

    # Applied controls that declare they implement a requirement (R2 5.6) —
    # framework_control_ids holds FrameworkControl ids.
    applied_by_control: dict[str, list[dict]] = {}
    for ac in (await db.execute(
        select(AppliedControl).where(AppliedControl.tenant_id == assessment.tenant_id)
    )).scalars().all():
        for fc_id in (ac.framework_control_ids or []):
            if fc_id in controls_map:
                applied_by_control.setdefault(fc_id, []).append({
                    "id": ac.id, "name": ac.name,
                    "status": getattr(ac.status, "value", ac.status),
                    "progress": getattr(ac, "progress", None),
                })

    ca_responses = []
    for ca in cas:
        cid = controls_map[ca.control_id].control_id if ca.control_id in controls_map else ca.control_id

        # Match checklist docs by clause: exact match ("4.1" → "4.1") or parent clause
        # ("4.1" → "4.1.1", "4.1.2") so uploading one doc covers all child controls
        linked_docs: list[LinkedChecklistDocument] = []
        for clause_ref, doc_list in clause_doc_map.items():
            if cid == clause_ref or cid.startswith(clause_ref + "."):
                linked_docs.extend(doc_list)

        ca_responses.append(ControlAssessmentResponse(
            id=ca.id,
            assessment_id=ca.assessment_id,
            control_id=ca.control_id,
            control_identifier=cid,
            control_title=(controls_map[ca.control_id].title if ca.control_id in controls_map else ""),
            control_category=(controls_map[ca.control_id].category if ca.control_id in controls_map else None),
            control_description=(controls_map[ca.control_id].description if ca.control_id in controls_map else None),
            status=ca.status,
            status_key=ca.status_key or _status_key_for(scale, ca.status),
            notes=ca.notes,
            implementation_notes=ca.implementation_notes,
            not_applicable_justification=ca.not_applicable_justification,
            requires_justification=(
                ca.status == ControlStatus.NOT_APPLICABLE
                and not (ca.not_applicable_justification or "").strip()
            ),
            owner_id=ca.owner_id,
            owner_name=(
                f"{owners[ca.owner_id].first_name} {owners[ca.owner_id].last_name}".strip()
                if ca.owner_id in owners else None
            ),
            ai_confidence=ca.ai_confidence,
            cross_framework_coverage=(
                controls_map[ca.control_id].mapped_controls
                if ca.control_id in controls_map
                else []
            ) or [],
            is_mandatory=(controls_map[ca.control_id].is_mandatory if ca.control_id in controls_map else False),
            linked_checklist_documents=linked_docs,
            status_source=ca.status_source,
            ai_suggested_status=ca.ai_suggested_status,
            ai_suggested_status_key=ca.ai_suggested_status_key,
            ai_suggested_notes=ca.ai_suggested_notes,
            ai_suggested_at=ca.ai_suggested_at,
            evidence_count=ev_stats.get(ca.id, [0, 0])[0],
            evidence_expired_count=ev_stats.get(ca.id, [0, 0])[1],
            evidence_all_expired=bool(ev_stats.get(ca.id)) and ev_stats[ca.id][0] == ev_stats[ca.id][1],
            applied_controls=applied_by_control.get(ca.control_id, []),
        ))

    gap_result = await db.execute(
        select(ComplianceGap).where(
            ComplianceGap.assessment_id == assessment.id,
            ComplianceGap.is_resolved == False,  # noqa: E712
        )
    )
    gaps = gap_result.scalars().all()

    gap_responses = [
        GapResponse(
            id=gap.id,
            control_id=gap.control_id,
            control_identifier=(controls_map[gap.control_id].control_id if gap.control_id in controls_map else gap.control_id),
            control_title=(controls_map[gap.control_id].title if gap.control_id in controls_map else ""),
            control_description=(controls_map[gap.control_id].description if gap.control_id in controls_map else None),
            gap_description=gap.gap_description,
            severity=gap.severity,
            remediation_steps=gap.remediation_steps,
            recommendation_status=gap.recommendation_status,
            is_certification_blocker=gap.is_certification_blocker,
            remediation_priority=gap.remediation_priority,
            action_item_id=gap.action_item_id,
        )
        for gap in gaps
    ]

    return AssessmentDetailResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        framework_id=assessment.framework_id,
        framework_name=framework.name if framework else "",
        framework_short_name=framework.short_name if framework else "",
        name=assessment.name,
        description=assessment.description,
        status=assessment.status,
        compliance_score=assessment.compliance_score,
        scope_description=assessment.scope_description,
        scope_type=assessment.scope_type or "tenant",
        org_entity_id=assessment.org_entity_id,
        org_entity_name=entity_names.get(assessment.org_entity_id or ""),
        business_process_id=assessment.business_process_id,
        business_process_name=process_names.get(assessment.business_process_id or ""),
        in_scope_assets=list(assessment.in_scope_assets or []),
        scale_id=assessment.scale_id,
        scale_name=scale.name if scale else None,
        scale_levels=_scale_levels(scale),
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        uploaded_documents=[
            UploadedDocumentResponse(
                id=d.id,
                file_name=d.file_name,
                file_size_bytes=d.file_size_bytes,
                content_type=d.content_type,
                created_at=d.created_at,
            )
            for d in docs
        ],
        control_assessments=ca_responses,
        gaps=gap_responses,
        cross_framework_summary=await _compute_cross_framework_coverage(db, assessment),
    )


# ─── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/assessments", status_code=status.HTTP_201_CREATED)
async def create_assessment(
    body: AssessmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
) -> AssessmentDetailResponse:
    """Create a compliance assessment on a PERIMETER — the whole organisation, a
    département (org entity), a processus, or a set of systèmes (assets).

    An assessment that duplicates an existing LIVE one on the SAME perimeter still
    returns that one rather than creating a second: the de-duplication key is just
    no longer (tenant, framework) alone, which is what used to lock a tenant to a
    single live assessment per framework forever.
    """
    fw_result = await db.execute(
        select(Framework).where(
            Framework.id == body.framework_id,
            (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id),  # noqa: E712
        )
    )
    if not fw_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Framework not found")

    scope_type = body.scope_type or "tenant"
    in_scope_assets = list(body.in_scope_assets or [])
    # Keep only the id the declared scope_type actually names — see _normalize_scope:
    # a stale org_entity_id on an organisation-wide run would be counted by
    # coverage/by-entity as that department's own conformity.
    org_entity_id, business_process_id = _normalize_scope(
        scope_type, body.org_entity_id, body.business_process_id,
    )
    await _validate_scope(
        db, tenant_id, scope_type, org_entity_id, business_process_id, in_scope_assets,
    )
    if body.scale_id:
        await _resolve_scale(db, tenant_id, body.scale_id)

    # Return the existing active assessment ON THIS PERIMETER rather than creating
    # a duplicate. Priority: in_progress > under_review > draft (most recent of each).
    perimeter_filter = [
        ComplianceAssessment.tenant_id == tenant_id,
        ComplianceAssessment.framework_id == body.framework_id,
        ComplianceAssessment.status != AssessmentStatus.ARCHIVED,
    ]
    if scope_type == "tenant":
        # A null scope_type is a pre-perimeter row and means "tenant"; matching it
        # explicitly keeps re-creating an organisation-wide assessment behaving
        # exactly as it did before this column existed.
        perimeter_filter.append(
            or_(ComplianceAssessment.scope_type == "tenant", ComplianceAssessment.scope_type.is_(None))
        )
    else:
        perimeter_filter.append(ComplianceAssessment.scope_type == scope_type)
    perimeter_filter.append(
        ComplianceAssessment.org_entity_id == org_entity_id if org_entity_id
        else ComplianceAssessment.org_entity_id.is_(None)
    )
    perimeter_filter.append(
        ComplianceAssessment.business_process_id == business_process_id if business_process_id
        else ComplianceAssessment.business_process_id.is_(None)
    )

    from sqlalchemy import case as sa_case
    existing_result = await db.execute(
        select(ComplianceAssessment)
        .where(*perimeter_filter)
        .order_by(
            sa_case(
                (ComplianceAssessment.status == AssessmentStatus.IN_PROGRESS, 0),
                (ComplianceAssessment.status == AssessmentStatus.UNDER_REVIEW, 1),
                (ComplianceAssessment.status == AssessmentStatus.COMPLETED, 2),
                else_=3,
            ),
            ComplianceAssessment.updated_at.desc(),
        )
    )
    if scope_type == "assets":
        # For a SYSTEMS perimeter the asset SET is the perimeter, and it lives in a
        # JSON column no SQL predicate above can compare portably. Without this
        # every asset-scoped assessment of a framework collapsed onto the first
        # one — "ISO 27001 sur le core banking" handed back when the caller asked
        # for "ISO 27001 sur le SI monétique" — so « ou systèmes » was no more
        # expressible than before the column existed.
        wanted_assets = frozenset(str(a) for a in in_scope_assets)
        existing = next(
            (
                row for row in existing_result.scalars().all()
                if frozenset(str(a) for a in (row.in_scope_assets or [])) == wanted_assets
            ),
            None,
        )
    else:
        existing = existing_result.scalars().first()
    if existing:
        return await _build_assessment_detail(db, existing)

    assessment = ComplianceAssessment(
        tenant_id=tenant_id,
        framework_id=body.framework_id,
        name=body.name,
        description=body.description,
        scope_description=body.scope_description,
        status=AssessmentStatus.DRAFT,
        lead_assessor_id=current_user.id,
        scope_type=scope_type,
        org_entity_id=org_entity_id,
        business_process_id=business_process_id,
        scale_id=body.scale_id,
        in_scope_assets=in_scope_assets,
    )
    db.add(assessment)
    await db.flush()
    # One NOT_STARTED row per requirement from day one (R2 5.2), as registration
    # does: without them nobody could assess by hand before an AI run, and an
    # appliance tenant or a framework added later had no way to start at all.
    # Only for a NEW assessment — the de-duplicated one above already has its rows.
    scale = await _load_scale(db, assessment)
    for fc_id in (await db.execute(
        select(FrameworkControl.id).where(FrameworkControl.framework_id == body.framework_id)
    )).scalars().all():
        db.add(ControlAssessment(
            assessment_id=assessment.id, control_id=fc_id,
            status=ControlStatus.NOT_STARTED,
            status_key=_status_key_for(scale, ControlStatus.NOT_STARTED),
        ))
    await db.commit()
    await db.refresh(assessment)
    return await _build_assessment_detail(db, assessment)


async def _localize_assessment_detail(db: AsyncSession, lang: str, detail: AssessmentDetailResponse) -> None:
    """Requirement text and framework name of an assessment in the reader's language
    (cached machine translations; the stored text is kept in original_*)."""
    entries: list = [(detail, {"framework_name": detail.framework_name})]
    for row in list(detail.control_assessments) + list(detail.gaps):
        entries.append((row, {"control_title": row.control_title,
                              "control_description": row.control_description or ""}))
    await localize_fields(db, lang, entries)


@router.get("/assessments")
async def list_assessments(
    pagination: PaginationParams = Depends(),
    include_archived: bool = Query(
        False,
        description="Include assessments moved to ARCHIVED. Archived rows are a "
                    "historical record of a past perimeter, not part of the live picture.",
    ),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
) -> PaginatedAssessments:
    """List compliance assessments for the tenant, limited to selected frameworks."""
    # Load tenant to get selected framework IDs
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    # Build the set of framework IDs the tenant has selected on the dashboard
    selected_fw_ids: list[str] | None = None
    if tenant:
        ids = set(tenant.selected_framework_ids or [])
        if tenant.primary_framework_id:
            ids.add(tenant.primary_framework_id)
        if ids:
            selected_fw_ids = list(ids)

    base_filter = [ComplianceAssessment.tenant_id == tenant_id]
    if selected_fw_ids:
        base_filter.append(ComplianceAssessment.framework_id.in_(selected_fw_ids))
    if not include_archived:
        # Nothing wrote ARCHIVED before PATCH /assessments/{id} existed, so this
        # filter changes nothing for existing data — it only stops a deliberately
        # archived perimeter from coming back as the live one.
        base_filter.append(ComplianceAssessment.status != AssessmentStatus.ARCHIVED)

    # Fetch all matching assessments, then keep only the best one per framework.
    # Best = highest status priority (in_progress > under_review > completed > draft),
    # then most recently updated within each status tier.
    from sqlalchemy import case as sa_case
    all_result = await db.execute(
        select(ComplianceAssessment)
        .where(*base_filter)
        .order_by(
            sa_case(
                (ComplianceAssessment.status == AssessmentStatus.IN_PROGRESS, 0),
                (ComplianceAssessment.status == AssessmentStatus.UNDER_REVIEW, 1),
                (ComplianceAssessment.status == AssessmentStatus.COMPLETED, 2),
                else_=3,
            ),
            ComplianceAssessment.updated_at.desc(),
        )
    )
    all_assessments = all_result.scalars().all()

    # Deduplicate per (framework, PERIMETER) — not per framework. Collapsing on the
    # framework alone hid every scoped assessment behind the organisation-wide one,
    # so "la DSI est à 62% d'ISO 27001" could never appear next to the group score.
    seen_scope: set[tuple] = set()
    deduped: list[ComplianceAssessment] = []
    for a in all_assessments:
        # Archived rows dedupe among THEMSELVES, never against the live one. An
        # archived perimeter always loses the status ordering above, so folding it
        # into the same bucket made include_archived=true a no-op: the flag let the
        # row through the filter and the collapse then dropped it again, leaving a
        # retired assessment unreachable from every screen in the product.
        key = _scope_key(a) + (a.status == AssessmentStatus.ARCHIVED,)
        if key not in seen_scope:
            seen_scope.add(key)
            deduped.append(a)

    total = len(deduped)
    # Apply pagination on the deduped list
    assessments = deduped[pagination.offset: pagination.offset + pagination.limit]

    fw_ids = list({a.framework_id for a in assessments})
    fw_result = await db.execute(select(Framework).where(Framework.id.in_(fw_ids)))
    fw_map: dict[str, Framework] = {fw.id: fw for fw in fw_result.scalars().all()}

    doc_counts: dict[str, int] = {}
    if assessments:
        a_ids = [a.id for a in assessments]
        count_result = await db.execute(
            select(UploadedDocument.assessment_id, func.count())
            .where(UploadedDocument.assessment_id.in_(a_ids))
            .group_by(UploadedDocument.assessment_id)
        )
        doc_counts = {row[0]: row[1] for row in count_result.all()}

    entity_names, process_names = await _scope_names(db, list(assessments), tenant_id)

    items = [
        AssessmentListItem(
            id=a.id,
            framework_id=a.framework_id,
            framework_name=(fw_map[a.framework_id].name if a.framework_id in fw_map else ""),
            framework_short_name=(fw_map[a.framework_id].short_name if a.framework_id in fw_map else ""),
            name=a.name,
            status=a.status,
            compliance_score=a.compliance_score,
            document_count=doc_counts.get(a.id, 0),
            scope_type=a.scope_type or "tenant",
            org_entity_id=a.org_entity_id,
            org_entity_name=entity_names.get(a.org_entity_id or ""),
            business_process_id=a.business_process_id,
            business_process_name=process_names.get(a.business_process_id or ""),
            scale_id=a.scale_id,
            created_at=a.created_at,
        )
        for a in assessments
    ]
    await localize_fields(db, lang, [(it, {"framework_name": it.framework_name}) for it in items])

    page_size = pagination.limit
    return PaginatedAssessments(
        items=items,
        total=total,
        page=(pagination.offset // page_size) + 1 if page_size else 1,
        page_size=page_size,
        total_pages=max(1, -(-total // page_size)) if page_size else 1,
    )


@router.get("/assessments/{assessment_id}")
async def get_assessment(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
) -> AssessmentDetailResponse:
    """Get full assessment detail."""
    result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    detail = await _build_assessment_detail(db, assessment)
    await _localize_assessment_detail(db, lang if isinstance(lang, str) else "", detail)
    return detail


@router.patch("/assessments/{assessment_id}")
async def update_assessment(
    assessment_id: str,
    body: AssessmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> AssessmentDetailResponse:
    """Rename, re-scope, re-grade or ARCHIVE an assessment.

    This route did not exist. Together with the perimeter-aware de-duplication in
    ``create_assessment`` it is what unlocks « évaluer le niveau de conformité des
    processus, départements ou systèmes »: a tenant used to be stuck with exactly
    one live assessment per framework, unable to rename it, move it to another
    perimeter, or retire it — nothing anywhere in the backend wrote
    ``AssessmentStatus.ARCHIVED``.

    An omitted field is left untouched; an explicit ``null`` clears it (Pydantic's
    ``model_fields_set`` is what tells the two apart).
    """
    assessment = (await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    given = body.model_fields_set

    # Validate the perimeter as it will be AFTER the patch, not as it was sent:
    # moving scope_type to "org_entity" while org_entity_id stays where it is has
    # to be judged against the effective pair.
    scope_type = body.scope_type if body.scope_type else (assessment.scope_type or "tenant")
    org_entity_id = body.org_entity_id if "org_entity_id" in given else assessment.org_entity_id
    business_process_id = (
        body.business_process_id if "business_process_id" in given else assessment.business_process_id
    )
    in_scope_assets = (
        list(body.in_scope_assets or []) if "in_scope_assets" in given
        else list(assessment.in_scope_assets or [])
    )
    # Re-scoping must also DROP the id the new scope_type no longer names. Without
    # this, moving an assessment back to "tenant" left its org_entity_id behind and
    # coverage/by-entity went on reporting an organisation-wide run as that
    # department's own conformity — a wrong number, not a missing one.
    org_entity_id, business_process_id = _normalize_scope(
        scope_type, org_entity_id, business_process_id,
    )
    await _validate_scope(db, tenant_id, scope_type, org_entity_id, business_process_id, in_scope_assets)

    if "scale_id" in given and body.scale_id:
        await _resolve_scale(db, tenant_id, body.scale_id)
    if "lead_assessor_id" in given:
        await assert_user_in_tenant(db, body.lead_assessor_id, tenant_id, field_name="lead_assessor_id")

    previous_status = assessment.status

    if body.name is not None:
        assessment.name = body.name
    if "description" in given:
        assessment.description = body.description
    if "scope_description" in given:
        assessment.scope_description = body.scope_description
    assessment.scope_type = scope_type
    assessment.org_entity_id = org_entity_id
    assessment.business_process_id = business_process_id
    if "in_scope_assets" in given:
        assessment.in_scope_assets = in_scope_assets
    if "scale_id" in given:
        assessment.scale_id = body.scale_id
    if "lead_assessor_id" in given:
        assessment.lead_assessor_id = body.lead_assessor_id
    for field in ("assessment_start", "assessment_end", "next_review_date"):
        if field in given:
            setattr(assessment, field, getattr(body, field))

    if body.status is not None and body.status != assessment.status:
        if body.status != AssessmentStatus.ARCHIVED and assessment.ai_analysis_status == "running":
            raise HTTPException(
                status_code=409,
                detail="An AI analysis is running on this assessment; wait for it to finish.",
            )
        assessment.status = body.status

    # The score is a function of the grid, so changing the grid must re-score
    # immediately rather than leaving a number computed under the old one on screen.
    if "scale_id" in given:
        scale = await _load_scale(db, assessment)
        all_cas = list((await db.execute(
            select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
        )).scalars().all())
        _rescore(assessment, all_cas, scale)

    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    # Retiring or reviving a compliance record is a governance act the generic
    # "PATCH happened" middleware entry cannot describe, so it gets its own
    # chained entry naming both ends of the transition.
    if body.status is not None and body.status != previous_status and AssessmentStatus.ARCHIVED in (
        body.status, previous_status,
    ):
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="archive" if body.status == AssessmentStatus.ARCHIVED else "update",
            entity_type="compliance_assessment", entity_id=assessment.id, entity_name=assessment.name,
            details={
                "from_status": getattr(previous_status, "value", previous_status),
                "to_status": getattr(assessment.status, "value", assessment.status),
                "scope_type": assessment.scope_type,
            },
        ))

    # Base.updated_at is a server-side `onupdate`, so SQLAlchemy expires it after an
    # UPDATE and reloads it on access — which, in async, is a MissingGreenlet rather
    # than a lazy query. Refresh explicitly before the detail response reads it.
    await db.refresh(assessment)
    return await _build_assessment_detail(db, assessment)


@router.delete("/assessments/{assessment_id}", status_code=204)
async def delete_assessment(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> None:
    """Delete a compliance assessment. Only draft assessments can be deleted."""
    result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.status != AssessmentStatus.DRAFT:
        raise HTTPException(
            status_code=400,
            detail="Only draft assessments can be deleted. Archive completed assessments instead."
        )
    await db.delete(assessment)
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()


# ─── Coverage by perimeter (STB objectif 2) ───────────────────────────────────
# « Permet d'évaluer le niveau de conformité DES PROCESSUS, DÉPARTEMENTS OU
# SYSTÈMES ». Storing the perimeter is only half of it — the answer the bank
# actually asks for is "la DSI est à 62% de conformité ISO 27001", and that needs
# a read-model that rolls the assessments of a perimeter up into one number.


class ScopeCoverageItem(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    assessment_count: int = 0
    frameworks: list[str] = []
    controls_total: int = 0
    controls_scoreable: int = 0
    open_gaps: int = 0
    compliance_score: float | None = None
    # Org entities only: this node plus every descendant, so "la conformité de la
    # DSI" includes the departments under it rather than only what was assessed on
    # the parent node itself.
    rolled_up_score: float | None = None
    rolled_up_assessment_count: int = 0

    model_config = {"from_attributes": True}


class ScopeCoverageResponse(BaseModel):
    scope_type: str
    items: list[ScopeCoverageItem]
    # Assessments that carry no perimeter at all (every pre-existing row). Reported
    # rather than hidden, so a reader can tell "0% coverage" from "not scoped yet".
    unscoped_assessment_count: int = 0


async def _assessment_counts(db: AsyncSession, assessment_ids: list[str]) -> tuple[dict, dict]:
    """(control counts per assessment, open-gap count per assessment) in two queries."""
    counts: dict[str, dict] = {aid: {"total": 0, "not_applicable": 0} for aid in assessment_ids}
    gaps: dict[str, int] = {aid: 0 for aid in assessment_ids}
    if not assessment_ids:
        return counts, gaps

    rows = (await db.execute(
        select(ControlAssessment.assessment_id, ControlAssessment.status, func.count())
        .where(ControlAssessment.assessment_id.in_(assessment_ids))
        .group_by(ControlAssessment.assessment_id, ControlAssessment.status)
    )).all()
    for assessment_id, ctrl_status, n in rows:
        bucket = counts.get(assessment_id)
        if bucket is None:
            continue
        bucket["total"] += n
        if getattr(ctrl_status, "value", ctrl_status) == ControlStatus.NOT_APPLICABLE.value:
            bucket["not_applicable"] += n

    gap_rows = (await db.execute(
        select(ComplianceGap.assessment_id, func.count())
        .where(
            ComplianceGap.assessment_id.in_(assessment_ids),
            ComplianceGap.is_resolved == False,  # noqa: E712
        )
        .group_by(ComplianceGap.assessment_id)
    )).all()
    for assessment_id, n in gap_rows:
        if assessment_id in gaps:
            gaps[assessment_id] = n
    return counts, gaps


def _aggregate_coverage(assessments: list, counts: dict, gaps: dict, fw_map: dict) -> dict:
    """Roll a set of assessments up into one coverage row.

    Each assessment's OWN ``compliance_score`` is used and weighted by how many
    controls it actually scores, rather than re-deriving a number here: that is
    what lets a perimeter graded on a custom ComplianceScale aggregate correctly
    next to one still graded on the legacy enum.
    """
    numerator = 0.0
    weight_total = 0
    controls_total = 0
    open_gaps = 0
    frameworks: list[str] = []
    for a in assessments:
        bucket = counts.get(a.id) or {"total": 0, "not_applicable": 0}
        scoreable = max(0, bucket["total"] - bucket["not_applicable"])
        controls_total += bucket["total"]
        open_gaps += gaps.get(a.id, 0)
        fw = fw_map.get(a.framework_id)
        label = (fw.short_name or fw.name) if fw else None
        if label and label not in frameworks:
            frameworks.append(label)
        if a.compliance_score is None:
            continue
        weight = scoreable or 1
        numerator += float(a.compliance_score) * weight
        weight_total += weight
    return {
        "assessment_count": len(assessments),
        "frameworks": frameworks,
        "controls_total": controls_total,
        "controls_scoreable": weight_total,
        "open_gaps": open_gaps,
        "compliance_score": round(numerator / weight_total, 1) if weight_total else None,
    }


async def _coverage_assessments(
    db: AsyncSession, tenant_id: str, framework_id: str | None,
) -> tuple[list, dict, dict, dict]:
    """Live (non-archived) assessments of the tenant plus their aggregates."""
    filters = [
        ComplianceAssessment.tenant_id == tenant_id,
        ComplianceAssessment.status != AssessmentStatus.ARCHIVED,
    ]
    if framework_id:
        filters.append(ComplianceAssessment.framework_id == framework_id)
    assessments = list((await db.execute(
        select(ComplianceAssessment).where(*filters)
    )).scalars().all())
    counts, gaps = await _assessment_counts(db, [a.id for a in assessments])
    fw_map: dict = {}
    fw_ids = {a.framework_id for a in assessments if a.framework_id}
    if fw_ids:
        fw_map = {
            f.id: f for f in (await db.execute(
                select(Framework).where(Framework.id.in_(fw_ids))
            )).scalars().all()
        }
    return assessments, counts, gaps, fw_map


@router.get("/coverage/by-entity", response_model=ScopeCoverageResponse)
async def coverage_by_entity(
    framework_id: str | None = Query(None, description="Restrict to one framework"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
) -> ScopeCoverageResponse:
    """Conformity per DÉPARTEMENT (org entity), with a roll-up over its subtree."""
    entities = list((await db.execute(
        select(OrgEntity).where(OrgEntity.tenant_id == tenant_id)
    )).scalars().all())
    assessments, counts, gaps, fw_map = await _coverage_assessments(db, tenant_id, framework_id)

    by_entity: dict[str, list] = {}
    unscoped = 0
    for a in assessments:
        if a.org_entity_id:
            by_entity.setdefault(a.org_entity_id, []).append(a)
        else:
            unscoped += 1

    children: dict[str, list[str]] = {}
    for entity in entities:
        if entity.parent_id:
            children.setdefault(entity.parent_id, []).append(entity.id)

    def subtree(root_id: str) -> list[str]:
        """Every entity id at or below `root_id` (cycle-safe: org_entities.parent_id
        is a free-form self reference, and a cycle would otherwise hang the worker)."""
        seen: set[str] = set()
        stack = [root_id]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            stack.extend(children.get(current, []))
        return list(seen)

    items: list[ScopeCoverageItem] = []
    for entity in entities:
        own = by_entity.get(entity.id, [])
        agg = _aggregate_coverage(own, counts, gaps, fw_map)
        rolled_assessments = [a for eid in subtree(entity.id) for a in by_entity.get(eid, [])]
        rolled = _aggregate_coverage(rolled_assessments, counts, gaps, fw_map)
        items.append(ScopeCoverageItem(
            id=entity.id, name=entity.name, parent_id=entity.parent_id,
            rolled_up_score=rolled["compliance_score"],
            rolled_up_assessment_count=rolled["assessment_count"],
            **agg,
        ))
    items.sort(key=lambda i: i.name.lower())
    return ScopeCoverageResponse(scope_type="org_entity", items=items, unscoped_assessment_count=unscoped)


@router.get("/coverage/by-process", response_model=ScopeCoverageResponse)
async def coverage_by_process(
    framework_id: str | None = Query(None, description="Restrict to one framework"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
) -> ScopeCoverageResponse:
    """Conformity per PROCESSUS métier."""
    processes = list((await db.execute(
        select(BusinessProcess).where(BusinessProcess.tenant_id == tenant_id)
    )).scalars().all())
    assessments, counts, gaps, fw_map = await _coverage_assessments(db, tenant_id, framework_id)

    by_process: dict[str, list] = {}
    unscoped = 0
    for a in assessments:
        if a.business_process_id:
            by_process.setdefault(a.business_process_id, []).append(a)
        else:
            unscoped += 1

    items = [
        ScopeCoverageItem(
            id=process.id, name=process.name, parent_id=process.entity_id,
            **_aggregate_coverage(by_process.get(process.id, []), counts, gaps, fw_map),
        )
        for process in processes
    ]
    items.sort(key=lambda i: i.name.lower())
    return ScopeCoverageResponse(scope_type="business_process", items=items, unscoped_assessment_count=unscoped)


@router.get("/coverage/by-asset", response_model=ScopeCoverageResponse)
async def coverage_by_asset(
    framework_id: str | None = Query(None, description="Restrict to one framework"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
) -> ScopeCoverageResponse:
    """Conformity per SYSTÈME (asset).

    ``in_scope_assets`` has existed on the model since the beginning and nothing
    ever wrote or read it; assessments can now be scoped to a set of systems, and
    this is the read side of that.
    """
    from app.models.asset import Asset

    assessments, counts, gaps, fw_map = await _coverage_assessments(db, tenant_id, framework_id)

    by_asset: dict[str, list] = {}
    unscoped = 0
    for a in assessments:
        asset_ids = [str(x) for x in (a.in_scope_assets or []) if x]
        if not asset_ids:
            unscoped += 1
            continue
        for asset_id in asset_ids:
            by_asset.setdefault(asset_id, []).append(a)

    names: dict[str, str] = {}
    if by_asset:
        names = {
            asset.id: asset.name for asset in (await db.execute(
                select(Asset).where(Asset.id.in_(list(by_asset)), Asset.tenant_id == tenant_id)
            )).scalars().all()
        }

    items = [
        ScopeCoverageItem(
            id=asset_id,
            # An id with no row behind it is an asset deleted after it was scoped;
            # showing the id beats dropping the perimeter silently.
            name=names.get(asset_id, asset_id),
            **_aggregate_coverage(rows, counts, gaps, fw_map),
        )
        for asset_id, rows in by_asset.items()
    ]
    items.sort(key=lambda i: i.name.lower())
    return ScopeCoverageResponse(scope_type="assets", items=items, unscoped_assessment_count=unscoped)


@router.post("/assessments/{assessment_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    assessment_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    document_type_key: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
) -> UploadedDocumentResponse:
    """Upload a document to an assessment for compliance analysis."""
    # Reject filenames whose extension must never reach the uploads
    # volume — see security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(file.filename, field_name="file")
    assessment_result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = assessment_result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    # Fetch framework short name for display filename
    fw_result = await db.execute(
        select(Framework).where(Framework.id == assessment.framework_id)
    )
    fw_obj = fw_result.scalar_one_or_none()
    fw_short = fw_obj.short_name if fw_obj else ""

    content_type = file.content_type or ""
    name_lower = (file.filename or "").lower()
    is_allowed = (
        "pdf" in content_type
        or "docx" in content_type
        or "word" in content_type
        or "spreadsheetml" in content_type
        or "ms-excel" in content_type
        or "text/plain" in content_type
        or name_lower.endswith(".pdf")
        or name_lower.endswith(".docx")
        or name_lower.endswith(".xlsx")
        or name_lower.endswith(".xls")
        or name_lower.endswith(".txt")
    )
    if not is_allowed:
        raise HTTPException(status_code=422, detail="Only PDF, DOCX, XLSX, XLS, and TXT files are supported")

    file_bytes = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")

    declared = (content_type or "").lower()
    if "pdf" in declared and not verify_file_signature(file_bytes, "application/pdf"):
        raise HTTPException(415, "File contents do not match the declared PDF type.")
    if "spreadsheetml" in declared and not verify_file_signature(file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
        raise HTTPException(415, "File contents do not match the declared XLSX type.")
    if "ms-excel" in declared and not verify_file_signature(file_bytes, "application/vnd.ms-excel"):
        raise HTTPException(415, "File contents do not match the declared XLS type.")

    safe_name = _sanitize_filename(file.filename or "document.txt")
    display_name = _build_doc_filename(
        fw_short,
        file.filename or safe_name,
    )
    rel_path = f"{tenant_id}/{assessment_id}/{uuid.uuid4().hex}_{safe_name}"
    full_path = Path(settings.UPLOADS_DIR) / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(file_bytes)

    extracted = _extract_text(str(full_path), content_type or name_lower)

    doc = UploadedDocument(
        assessment_id=assessment_id,
        tenant_id=tenant_id,
        file_name=display_name,
        file_path=str(rel_path),
        content_type=content_type,
        file_size_bytes=len(file_bytes),
        file_sha256=file_integrity.sha256_bytes(file_bytes),
        extracted_text=extracted,
        uploaded_by_id=current_user.id,
        document_type_key=document_type_key,  # pre-assign if provided by the UI
    )
    db.add(doc)
    await db.flush()
    await file_integrity.record_version(
        db, tenant_id=tenant_id, entity_type=file_integrity.DOCUMENT,
        entity_id=doc.id, parent_type="assessment", parent_id=assessment_id,
        file_path=str(rel_path), file_name=display_name,
        file_sha256=doc.file_sha256, file_size_bytes=len(file_bytes),
        content_type=content_type, uploaded_by_id=current_user.id,
    )

    # Auto-update matching control statuses when a checklist document is uploaded.
    # A document uploaded for clause "4.1" automatically promotes any not_started or
    # not_implemented controls under clause "4.1", "4.1.1", "4.1.2", etc.
    checklist_md: MandatoryDocument | None = None
    if document_type_key:
        md_result = await db.execute(
            select(MandatoryDocument).where(MandatoryDocument.document_type_key == document_type_key)
        )
        md = md_result.scalar_one_or_none()
        checklist_md = md
        if md and md.clause_ref:
            clause_ref = md.clause_ref
            ctrl_result = await db.execute(
                select(FrameworkControl).where(
                    FrameworkControl.framework_id == assessment.framework_id,
                    or_(
                        FrameworkControl.control_id == clause_ref,
                        FrameworkControl.control_id.like(f"{clause_ref}.%"),
                    ),
                )
            )
            matching_ctrl_ids = [c.id for c in ctrl_result.scalars().all()]
            if matching_ctrl_ids:
                await db.execute(
                    sa_update(ControlAssessment)
                    .where(
                        ControlAssessment.assessment_id == assessment_id,
                        ControlAssessment.control_id.in_(matching_ctrl_ids),
                        ControlAssessment.status.in_([
                            ControlStatus.NOT_STARTED,
                            ControlStatus.NOT_IMPLEMENTED,
                        ]),
                        # A level a person chose is not promoted automatically.
                        or_(ControlAssessment.status_source.is_(None),
                            ControlAssessment.status_source != compliance_merge.HUMAN),
                    )
                    .values(status=ControlStatus.PARTIALLY_IMPLEMENTED)
                )

    # Background: tag the document with the clauses of THIS assessment's framework it addresses
    # and store a factual summary (whole text, chunked; failures surface in the summary).
    if extracted.strip():
        background_tasks.add_task(
            _detect_clauses_background,
            doc.id,
            extracted,
            framework_id=assessment.framework_id,
            framework_name=fw_obj.name if fw_obj else "",
            framework_version=fw_obj.version if fw_obj else "",
            framework_short_name=fw_short,
            # The server-generated display name, never the raw upload filename (fully
            # attacker-controlled and rendered unfenced in the clause_coverage user template's
            # "DOCUMENT: ..." line) — matches _run_analysis_background's document naming.
            doc_name=display_name,
            checklist_item=checklist_md.document_name if checklist_md else "",
            expected_clause=checklist_md.clause_ref if checklist_md else "",
            lang=lang,
            user_id=current_user.id,
            tenant_id=tenant_id,
        )

    return UploadedDocumentResponse(
        id=doc.id,
        file_name=doc.file_name,
        file_path=doc.file_path,
        file_size_bytes=doc.file_size_bytes,
        content_type=doc.content_type,
        is_visible_to_auditor=True,
        created_at=doc.created_at,
    )


async def _run_analysis_background(assessment_id: str, tenant_id: str, user_id: str, lang: str = "en") -> None:
    """Background worker — runs the full AI analysis with its own DB session.

    Foundation path: the WHOLE text of every uploaded document × every framework control goes
    through ``ai_chunking.assess_controls_over_document`` (expert ``control_assessment`` prompt,
    chunking instead of truncation, verified quotations, schema validation with one repair
    turn, deterministic decoding, explanations in the UI language). The AI phase runs BEFORE
    the previous results are deleted: a failed run leaves the last good results in place and
    reports ``ai_analysis_status="failed"`` with an explicit, localised error. Controls the
    model returned no valid verdict for are recorded as ``not_started`` with an explicit note —
    never as a default verdict.
    """
    lang = normalize_language(lang) or "en"
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(ComplianceAssessment).where(
                    ComplianceAssessment.id == assessment_id,
                    ComplianceAssessment.tenant_id == tenant_id,
                )
            )
            assessment = result.scalar_one_or_none()
            if not assessment:
                return

            framework = (await db.execute(
                select(Framework).where(Framework.id == assessment.framework_id)
            )).scalar_one_or_none()
            tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
            # The grid this assessment is graded on (null on every legacy assessment,
            # in which case nothing below behaves any differently than it did).
            scale = await _load_scale(db, assessment)

            docs_result = await db.execute(
                select(UploadedDocument).where(UploadedDocument.assessment_id == assessment_id)
            )
            docs = docs_result.scalars().all()
            documents = [
                (d.file_name or f"document {i}", d.extracted_text or "")
                for i, d in enumerate(docs, start=1)
            ]

            ctrl_result = await db.execute(
                select(FrameworkControl)
                .where(FrameworkControl.framework_id == assessment.framework_id)
                .order_by(FrameworkControl.sort_order)
            )
            controls = ctrl_result.scalars().all()

            reqs_by_control: dict[str, list[ControlRequirement]] = {}
            if controls:
                req_result = await db.execute(
                    select(ControlRequirement).where(
                        ControlRequirement.control_id.in_([c.id for c in controls])
                    )
                )
                for r in req_result.scalars().all():
                    reqs_by_control.setdefault(r.control_id, []).append(r)
            req_levels: dict[str, list[str]] = {
                cid: [r.requirement_level for r in rows] for cid, rows in reqs_by_control.items()
            }

            specs, by_key = _build_control_specs(controls, reqs_by_control)

            # ── AI phase (nothing has been deleted yet) ──────────────────────────────
            res = await ai_chunking.assess_controls_over_document(
                documents,
                specs,
                lang=lang,
                # Never the tenant-editable framework label here: ai_chunking treats
                # framework_label as trusted (unfenced ``extra_context`` under the "rely on
                # them" system CONTEXT header, plus a naively 200-char-truncated per-batch
                # line) — see _analysis_context's docstring. The framework name still reaches
                # the model, properly delimited, via `context` below.
                framework_label="",
                context=_analysis_context(tenant, assessment, framework),
                user_id=user_id,
                tenant_id=tenant_id,
                # The tenant's own AI configuration — provider, model, endpoint.
                # Without an explicit cfg, resolve_call_config falls back to
                # env_ai_config(): a tenant that pinned its analysis to a
                # sovereign endpoint (data residency) silently had its documents
                # sent to the deployment default instead. Same one-line fix ai.py
                # made in analyze_evidence.
                cfg=await ai_provider.load_ai_config(db, tenant_id),
                allow_partial=True,
            )
            if not res.ok:
                logger.warning("compliance analysis %s failed: %s", assessment_id, res.failure_detail())
                await _mark_analysis_failed(db, assessment, f"{res.user_message(lang)} [{res.failure_detail()}]")
                return

            run = res.data
            logger.info(
                "compliance analysis %s: mode=%s chunks=%d calls=%d verdicts=%d missing=%d failures=%d warnings=%d",
                assessment_id, run.mode, run.chunks, run.calls, len(run.verdicts), len(run.missing_ids),
                len(run.failures), len(run.warnings),
            )
            for note in run.warnings[:50]:
                logger.info("compliance analysis %s: %s", assessment_id, note)

            # A failed locator call (locate_then_judge mode: any multi-chunk document set) leaves
            # the judge an EMPTY evidence packet for every control in that slice; the judge then
            # honestly reports "insufficient_evidence" — a real verdict, indistinguishable
            # downstream from "we searched thoroughly and found nothing". Persisting it would
            # silently reintroduce a default-failure verdict (not_implemented + an "Evidence gap:"
            # ComplianceGap) for controls that were never actually searched. compliance.py cannot
            # tell, from the verdict alone, which controls were tainted this way — so when any
            # locate call failed, the whole run is treated as failed instead: previous results stay.
            if run.mode == "locate_then_judge" and any(f.startswith("locate ") for f in run.failures):
                logger.warning("compliance analysis %s: %d locate failure(s), refusing to persist tainted verdicts",
                                assessment_id, sum(1 for f in run.failures if f.startswith("locate ")))
                detail = _t(lang, "locate_failed") + " " + "; ".join(run.failures)
                await _mark_analysis_failed(db, assessment, detail)
                return

            if len(run.verdicts) * 2 < len(specs):
                # A run that could not judge even half the framework must not replace a good one.
                detail = _t(lang, "mostly_failed", n=len(run.verdicts), total=len(specs))
                if run.failures:
                    detail += " " + "; ".join(run.failures)
                await _mark_analysis_failed(db, assessment, detail)
                return

            # Controls with no valid verdict this run (missing_ids, or — defensively — a verdict
            # string the platform's mapping doesn't recognise): resolved to the FrameworkControl
            # rows they cover so the persistence step below can leave any PREVIOUS result alone
            # instead of overwriting it with a "not started" placeholder just because this one run
            # could not judge it.
            missing_control_ids: set[str] = set()
            for key, rows in by_key.items():
                v = run.verdicts.get(key)
                if v is None or _VERDICT_STATUS.get(v.verdict) is None:
                    missing_control_ids.update(control.id for control in rows)

            # ── Merge into the existing rows (R2) ────────────────────────────────────
            # A re-run used to DELETE every ControlAssessment it re-judged — and its
            # Evidence with it — then recreate them, so the status, N/A justification
            # and proof a person had recorded were silently lost. Rows are now updated
            # in place through compliance_merge: a human-set row keeps its decision and
            # only receives the AI's suggestion, evidence is never touched, and a
            # control this run could not judge keeps its row exactly as it was.
            old_cas = (await db.execute(
                select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
            )).scalars().all()
            old_cas_by_control_id: dict[str, ControlAssessment] = {ca.control_id: ca for ca in old_cas}
            human_control_ids = {ca.control_id for ca in old_cas if compliance_merge.is_human(ca)}
            # Gaps of a human-set control are the human's too: left alone, like the row.
            frozen_control_ids = missing_control_ids | human_control_ids
            old_gaps = (await db.execute(
                select(ComplianceGap).where(ComplianceGap.assessment_id == assessment_id)
            )).scalars().all()
            gaps_to_replace = [g for g in old_gaps if g.control_id not in frozen_control_ids]
            gaps_to_replace_ids = [g.id for g in gaps_to_replace]
            # The action plan has to SURVIVE a re-analysis. This block used to hard-delete
            # every ActionItem hanging off a replaced gap, so re-running the analysis — the
            # single operation a CISO repeats most — silently destroyed the owners, start
            # and due dates, notes and completion history of the whole plan, with no
            # warning and no undo. Items are kept and indexed by the CONTROL they were
            # raised for; the persistence loop below re-points them at the gap this run
            # produces for that same control.
            items_by_control: dict[str, list[ActionItem]] = {}
            if gaps_to_replace_ids:
                control_of_gap = {g.id: (g.control_id or "") for g in gaps_to_replace}
                surviving_items = (await db.execute(
                    select(ActionItem).where(ActionItem.gap_id.in_(gaps_to_replace_ids))
                )).scalars().all()
                for item in surviving_items:
                    items_by_control.setdefault(control_of_gap.get(item.gap_id or "", ""), []).append(item)
                    # Detach before the gap row goes away; the re-link (or the orphan
                    # pass) further down sets the reference again.
                    item.gap_id = None
                await db.flush()
            for gap in gaps_to_replace:
                await db.delete(gap)
            await db.flush()

            # ── Persist verdicts ─────────────────────────────────────────────────────
            # Two disjoint outcomes for a missing-verdict control, tracked by spec key (same
            # unit as `run.missing_ids` / `total=len(specs)` below) so the "partial analysis"
            # warning can honestly say which happened instead of claiming every one of them was
            # reset to "not started" — a key with mixed rows (duplicate framework identifiers,
            # see _build_control_specs) counts as "preserved" if ANY of its rows already had a
            # prior result, since that is the case a reader most needs to be warned about.
            newly_not_started_keys: set[str] = set()
            preserved_keys: set[str] = set()
            # control id -> the gap this run raised for it, used to re-point the
            # surviving action items once every gap has an id.
            new_gaps_by_control: dict[str, ComplianceGap] = {}
            now_iso = datetime.now(timezone.utc).isoformat()
            for key, rows in by_key.items():
                v = run.verdicts.get(key)
                for control in rows:
                    ctrl_status = _VERDICT_STATUS.get(v.verdict) if v is not None else None
                    verdict = None
                    if v is not None and ctrl_status is not None:
                        verdict = compliance_merge.AiVerdict(
                            status=ctrl_status,
                            # The verdict is mapped onto the assessment's own grid when it has
                            # one, so a tenant scale scores an AI run exactly like a manual one.
                            status_key=_status_key_for(scale, ctrl_status),
                            confidence=v.confidence,
                            notes=_implementation_notes(v, lang) or None,
                            na_justification=v.not_applicable_justification,
                        )
                    existing = old_cas_by_control_id.get(control.id)
                    outcome = compliance_merge.merge_verdict(
                        existing, verdict, now_iso=now_iso,
                        not_applicable_value=ControlStatus.NOT_APPLICABLE.value,
                        placeholder_status=ControlStatus.NOT_STARTED,
                        placeholder_status_key=_status_key_for(scale, ControlStatus.NOT_STARTED),
                        # First-time assessment of this control with no verdict: explicit
                        # "analysis_failed" outcome — no verdict, no confidence, no gap.
                        placeholder_note=_t(lang, "not_analysed"),
                    )
                    if outcome.kind == compliance_merge.KEPT:
                        # Never overwrite a known result with a placeholder just because
                        # this run could not judge it again.
                        preserved_keys.add(key)
                        continue
                    if outcome.kind in (compliance_merge.CREATED, compliance_merge.PLACEHOLDER):
                        db.add(ControlAssessment(assessment_id=assessment_id, control_id=control.id, **outcome.fields))
                    else:
                        compliance_merge.apply(existing, outcome)
                    if outcome.kind == compliance_merge.PLACEHOLDER:
                        newly_not_started_keys.add(key)
                        continue
                    if outcome.kind == compliance_merge.SUGGESTED:
                        # A person decided this control: the AI only suggests, and opens
                        # no non-conformité behind their back.
                        continue

                    # Which levels open a non-conformité is the grid's decision when the
                    # assessment has one (« counts_as_gap »), and the two legacy statuses
                    # otherwise — identical behaviour for every existing assessment.
                    if _is_gap_level(scale, ctrl_status, _status_key_for(scale, ctrl_status)):
                        identifier = control.control_id or key
                        gap_desc = " ".join((v.gap_description or "").split()) or _t(
                            lang, "gap_default", title=control.title, control_id=identifier)
                        if v.verdict == "insufficient_evidence":
                            gap_desc = f"{_t(lang, 'evidence_gap')} {gap_desc}"
                        has_must = "must" in req_levels.get(control.id, [])
                        # Only a verdict that the control is genuinely NOT in place blocks certification;
                        # "no evidence seen" is a gap to evidence, flagged in the description instead.
                        is_blocker = v.verdict == "not_implemented" and has_must
                        severity = _gap_severity(v, ctrl_status, has_must)
                        remediation = (v.remediation or "").strip() or _t(
                            lang, "remediation_default", title=control.title, control_id=identifier)
                        new_gap = ComplianceGap(
                            assessment_id=assessment_id,
                            control_id=control.id,
                            gap_description=gap_desc,
                            severity=severity,
                            remediation_steps=remediation,
                            is_certification_blocker=is_blocker,
                            remediation_priority=_gap_priority(severity, is_blocker),
                        )
                        db.add(new_gap)
                        new_gaps_by_control[control.id] = new_gap

            await db.flush()

            # ── Re-attach the action plan whose gaps were replaced above ─────────────
            # A gap re-raised for the same control is the same non-conformity: its
            # actions keep their owner, dates, notes and completion state instead of
            # being recreated empty. Actions whose control came back compliant are
            # CANCELLED with a dated, localised note — never deleted, so "where did my
            # action go" has an answer and a finished one keeps its history.
            run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for control_id, items in items_by_control.items():
                replacement = new_gaps_by_control.get(control_id)
                for item in items:
                    if replacement is not None:
                        item.gap_id = replacement.id
                        if not replacement.action_item_id:
                            replacement.action_item_id = item.id
                    elif item.status in (ActionItemStatus.OPEN, ActionItemStatus.IN_PROGRESS):
                        item.status = ActionItemStatus.CANCELLED
                        item.notes = (
                            (item.notes + "\n") if item.notes else ""
                        ) + _t(lang, "plan_orphaned", date=run_date)
            await db.flush()

            # « Génération automatique de plans d'action » — every gap this run opened
            # gets its action item now, instead of only when somebody opens the
            # action-plan screen.
            await sync_action_items(db, tenant_id, assessment_id=assessment_id)
            await db.flush()

            # Score from the final persisted state, so controls preserved above (untouched by this
            # run) still count under their real status instead of dropping out of the calculation —
            # matching how update_control_assessment recomputes the score after a manual edit.
            all_cas = list((await db.execute(
                select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
            )).scalars().all())
            # Denominator stays the framework's control count, as before; the formula
            # itself comes from the assessment's grid when it has one.
            score = _compute_score(all_cas, scale, total=len(controls))

            warning: str | None = None
            if run.missing_ids or run.failures:
                # Honest split of "no AI verdict this run": some controls had no prior result and
                # were reset to "not started" (newly_not_started_keys); others already had a
                # ControlAssessment from an earlier run and were left exactly as they were
                # (preserved_keys) — still showing whatever status/confidence that earlier run
                # gave them, NOT re-verified against the current document set. A control counted
                # in both (duplicate framework identifier, one row new, one row preserved) is
                # reported as preserved — the more cautionary of the two.
                preserved_n = len(preserved_keys)
                new_n = len(newly_not_started_keys - preserved_keys)
                warning = _t(lang, "partial", n=preserved_n + new_n, total=len(specs), new=new_n, preserved=preserved_n)
                if run.failures:
                    warning += " " + "; ".join(run.failures)

            assessment.compliance_score = score
            assessment.status = AssessmentStatus.IN_PROGRESS
            assessment.ai_analysis_status = "completed"
            assessment.ai_analysis_error = warning[:500] if warning else None
            await db.commit()

        except Exception as exc:
            logger.exception("compliance analysis %s crashed", assessment_id)
            try:
                async with AsyncSessionLocal() as err_db:
                    err_result = await err_db.execute(
                        select(ComplianceAssessment).where(ComplianceAssessment.id == assessment_id)
                    )
                    a = err_result.scalar_one_or_none()
                    if a:
                        a.ai_analysis_status = "failed"
                        a.ai_analysis_error = f"{type(exc).__name__}: {str(exc)[:400]}"[:500]
                        await err_db.commit()
            except Exception:
                pass


@router.post("/assessments/{assessment_id}/analyze", status_code=202)
async def analyze_assessment(
    assessment_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
) -> dict:
    """Start AI analysis as a background job — returns 202 immediately.

    The language of the model's explanations follows the request's Accept-Language
    (the SPA sends the UI language); it is resolved here and handed to the job.
    """
    result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    if assessment.ai_analysis_status == "running":
        return {"status": "running", "message": "Analysis already in progress"}

    docs_result = await db.execute(
        select(UploadedDocument).where(UploadedDocument.assessment_id == assessment_id)
    )
    docs = docs_result.scalars().all()
    if not docs:
        raise HTTPException(status_code=400, detail="No documents uploaded. Upload at least one document first.")
    if not any((d.extracted_text or "").strip() for d in docs):
        # Analysing an empty text used to silently mark every control not covered.
        raise HTTPException(status_code=400, detail=_t(lang, "no_text"))

    assessment.ai_analysis_status = "running"
    assessment.ai_analysis_error = None
    await db.commit()

    background_tasks.add_task(_run_analysis_background, assessment_id, tenant_id, current_user.id, lang)

    return {"status": "running", "message": "Analysis started"}


@router.get("/assessments/{assessment_id}/analyze-status")
async def get_analyze_status(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
) -> dict:
    """Poll for background analysis job status."""
    result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    return {
        "status": assessment.ai_analysis_status,
        "compliance_score": assessment.compliance_score,
        "error": assessment.ai_analysis_error,
    }


@router.get("/assessments/{assessment_id}/results")
async def get_assessment_results(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
) -> AssessmentDetailResponse:
    """Get assessment results (alias for GET /assessments/{id})."""
    return await get_assessment(assessment_id, db, _, tenant_id, lang)


@router.patch("/control-assessments/{control_assessment_id}")
async def update_control_assessment(
    control_assessment_id: str,
    body: ControlAssessmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ASSESS_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
    display_lang: str = Depends(get_display_language),
) -> ControlAssessmentResponse:
    """Record a human evaluation of one requirement.

    This is the auditor's normal path, and until now it was a dead end: it moved
    the status and nothing else. Marking a control « non conforme » generated no
    ComplianceGap and therefore no action plan, and marking one « conforme » left
    the gap the AI had opened permanently unresolved (625 of 625 in production).
    Both directions are wired up here — non-conformity in, closure out — and the
    score is recomputed through the assessment's grid.
    """
    result = await db.execute(
        select(ControlAssessment, ComplianceAssessment, FrameworkControl)
        .join(ComplianceAssessment, ControlAssessment.assessment_id == ComplianceAssessment.id)
        .join(FrameworkControl, ControlAssessment.control_id == FrameworkControl.id)
        .where(
            ControlAssessment.id == control_assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Control assessment not found")

    ca, assessment, control = row
    # A control owner self-assesses the requirements assigned to them, and only
    # those; compliance_manager and CISO act tenant-wide (services/perimeter).
    roles = await get_effective_roles(current_user, db)
    perimeter.assert_in_perimeter(current_user, ca, roles, what="record", lang=lang)
    if (perimeter.is_perimeter_scoped(current_user, roles) and body.owner_id is not None
            and (body.owner_id or None) != current_user.id):
        raise HTTPException(status_code=403, detail="Only a compliance manager or the CISO can reassign a requirement.")
    scale = await _load_scale(db, assessment)

    # A grid level takes precedence over the legacy enum: `status_key` names a
    # level of the assessment's own ComplianceScale, and `status` keeps carrying
    # the nearest enum value so every existing query, export, report and dashboard
    # keeps working untouched.
    if body.status_key is not None:
        level = _level_by_key(scale, body.status_key)
        if level is None:
            raise HTTPException(
                status_code=422,
                detail=f"status_key '{body.status_key}' is not a level of this assessment's scale",
            )
        legacy_value = level.get("legacy_status")
        mapped: ControlStatus | None = None
        if legacy_value:
            try:
                mapped = ControlStatus(legacy_value)
            except ValueError:
                mapped = None
        if mapped == ControlStatus.NOT_APPLICABLE and control.is_mandatory:
            raise HTTPException(
                status_code=400,
                detail=f"Control '{control.control_id}' is mandatory and cannot be marked as Not Applicable."
            )
        ca.status_key = body.status_key
        if mapped is not None:
            ca.status = mapped

    if body.status is not None:
        # Block N/A on mandatory controls
        if body.status == ControlStatus.NOT_APPLICABLE and control.is_mandatory:
            raise HTTPException(
                status_code=400,
                detail=f"Control '{control.control_id}' is mandatory and cannot be marked as Not Applicable."
            )
        ca.status = body.status
        # Keep the grid key in step when the caller still speaks the legacy enum.
        if scale is not None:
            ca.status_key = _status_key_for(scale, body.status) or ca.status_key

    if body.notes is not None:
        ca.notes = body.notes
    if body.implementation_notes is not None:
        ca.implementation_notes = body.implementation_notes
    if body.owner_id is not None:
        # « le niveau de conformité des DÉPARTEMENTS » needs a real owner on the
        # requirement, not a name appended to the notes.
        await assert_user_in_tenant(db, body.owner_id or None, tenant_id, field_name="owner_id")
        ca.owner_id = body.owner_id or None
    if body.not_applicable_justification is not None:
        justification = (body.not_applicable_justification or "").strip()
        # An auditor always asks why a requirement was excluded, so an explicitly
        # BLANK justification on a N/A verdict is refused. Its ABSENCE is still
        # accepted: today's status dropdown sends `status` on its own and refusing
        # that would break the only way N/A can be set at all. The response carries
        # `requires_justification` so the UI can prompt (see needs_integration).
        if not justification and ca.status == ControlStatus.NOT_APPLICABLE:
            raise HTTPException(
                status_code=422,
                detail="not_applicable_justification cannot be empty on a Not Applicable control.",
            )
        ca.not_applicable_justification = justification or None

    # Whatever a person sets on the fields the analysis also writes is theirs from
    # now on: a later AI re-run only suggests (services/compliance_merge).
    if any(v is not None for v in (body.status, body.status_key, body.implementation_notes,
                                   body.not_applicable_justification)):
        ca.status_source = compliance_merge.HUMAN

    # Only a change of LEVEL may open or close a non-conformité. A PATCH that just
    # edits the notes must not quietly raise a gap (and an action item with it) for
    # a control that happens to sit on a gap level without one.
    gap_id: str | None = None
    gap_resolved = False
    if body.status is not None or body.status_key is not None:
        gap_id, gap_resolved = await _sync_gap_for_control(db, assessment, ca, control, lang, scale)

    await db.flush()

    # Recompute BEFORE the commit. The score used to be assigned AFTER it and left
    # to get_db()'s teardown — which runs after ActivityLogMiddleware has already
    # opened a second connection, exactly the write-lock wait every other handler
    # in this file commits early to avoid.
    all_cas = list((await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
    )).scalars().all())
    _rescore(assessment, all_cas, scale)

    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    # « Génération automatique de plans d'action pour les non-conformités »: the
    # plan appears the moment the non-conformity is recorded, not when somebody
    # next opens the action-plan screen.
    if gap_id and not gap_resolved:
        if await sync_action_items(db, tenant_id, assessment_id=assessment.id):
            await db.commit()

    owner_name = None
    if ca.owner_id:
        owner = (await db.execute(select(User).where(User.id == ca.owner_id))).scalar_one_or_none()
        if owner:
            owner_name = f"{owner.first_name} {owner.last_name}".strip()

    # Build the response BEFORE the chained entry: chain_and_add rolls the session
    # back when it loses the seq race, and a rollback expires every loaded object —
    # reading `ca` afterwards would be a MissingGreenlet, not a lazy query.
    response = ControlAssessmentResponse(
        id=ca.id,
        assessment_id=ca.assessment_id,
        control_id=ca.control_id,
        control_identifier=control.control_id,
        control_title=control.title,
        control_category=control.category,
        control_description=control.description,
        status=ca.status,
        status_key=ca.status_key or _status_key_for(scale, ca.status),
        notes=ca.notes,
        implementation_notes=ca.implementation_notes,
        not_applicable_justification=ca.not_applicable_justification,
        requires_justification=(
            ca.status == ControlStatus.NOT_APPLICABLE
            and not (ca.not_applicable_justification or "").strip()
        ),
        owner_id=ca.owner_id,
        owner_name=owner_name,
        ai_confidence=ca.ai_confidence,
        cross_framework_coverage=control.mapped_controls or [],
        is_mandatory=control.is_mandatory,
        status_source=ca.status_source,
        ai_suggested_status=ca.ai_suggested_status,
        ai_suggested_status_key=ca.ai_suggested_status_key,
        ai_suggested_notes=ca.ai_suggested_notes,
        ai_suggested_at=ca.ai_suggested_at,
    )

    if gap_resolved:
        # Closing a requirement is a governance act; the middleware's generic
        # "PATCH happened" entry cannot say which non-conformity was cleared.
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="resolve", entity_type="compliance_gap", entity_id=gap_id,
            entity_name=response.control_identifier,
            details={
                "assessment_id": response.assessment_id,
                "control_id": response.control_identifier,
                "status": getattr(response.status, "value", response.status),
                "status_key": response.status_key,
            },
        ))

    # Same display language as GET /assessments/{id}, so the row the page swaps in
    # does not flip back to the stored text.
    await localize_fields(db, display_lang, [(response, {
        "control_title": response.control_title,
        "control_description": response.control_description or ""})])
    return response


# ─── Document Checklist ────────────────────────────────────────────────────────


@router.get("/assessments/{assessment_id}/document-checklist")
async def get_document_checklist(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_READ_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
) -> dict:
    """
    Return mandatory documents for the assessment's framework with upload status.
    Returns {total, uploaded, items: [...]} shape expected by the frontend.
    """
    result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    # Get framework short_name
    fw_result = await db.execute(select(Framework).where(Framework.id == assessment.framework_id))
    fw = fw_result.scalar_one_or_none()
    fw_short = fw.short_name if fw else ""

    # Normalise: "ISO 27001:2022" → "ISO27001"
    fw_key = fw_short.upper().replace(" ", "").replace(":", "").replace("-", "")[:10]
    if "ISO27001" in fw_key:
        fw_key = "ISO27001"

    mandatory_docs = (await db.execute(
        select(MandatoryDocument)
        .where(MandatoryDocument.framework_short_name == fw_key)
        .order_by(MandatoryDocument.sort_order)
    )).scalars().all()

    # Get uploaded docs for this assessment
    uploaded = (await db.execute(
        select(UploadedDocument).where(UploadedDocument.assessment_id == assessment_id)
    )).scalars().all()

    # Match by document_type_key — collect ALL docs per key (multiple files per row)
    uploaded_by_key: dict[str, list[UploadedDocument]] = {}
    for d in uploaded:
        if d.document_type_key:
            uploaded_by_key.setdefault(d.document_type_key, []).append(d)

    items = []
    for md in mandatory_docs:
        docs_for_row = uploaded_by_key.get(md.document_type_key, [])
        items.append({
            "mandatory_document_id": md.id,
            "clause_ref": md.clause_ref,
            "document_name": md.document_name,
            "document_type_key": md.document_type_key,
            "is_mandatory": md.is_mandatory,
            "description": md.description,
            "is_uploaded": len(docs_for_row) > 0,
            # legacy single-doc field (first doc) for backward compat
            "uploaded_document": {
                "id": docs_for_row[0].id,
                "file_name": docs_for_row[0].file_name,
                "ai_analysis_summary": docs_for_row[0].ai_analysis_summary,
            } if docs_for_row else None,
            # All files for this row
            "uploaded_documents": [
                {
                    "id": d.id,
                    "file_name": d.file_name,
                    "file_path": d.file_path,
                    "content_type": d.content_type,
                    "file_size_bytes": d.file_size_bytes,
                    "is_visible_to_auditor": bool(d.is_visible_to_auditor) if d.is_visible_to_auditor is not None else True,
                    "created_at": d.created_at.isoformat() if hasattr(d.created_at, "isoformat") else str(d.created_at),
                }
                for d in docs_for_row
            ],
        })

    # Collect UploadedDocuments that don't match any mandatory document (e.g. stakeholder uploads)
    matched_ids: set[str] = set()
    for docs_list in uploaded_by_key.values():
        for d in docs_list:
            matched_ids.add(d.id)
    other_uploads = [
        {
            "id": d.id,
            "file_name": d.file_name,
            "content_type": d.content_type,
            "file_size_bytes": d.file_size_bytes,
            "is_visible_to_auditor": bool(d.is_visible_to_auditor) if d.is_visible_to_auditor is not None else True,
            "created_at": d.created_at.isoformat() if hasattr(d.created_at, "isoformat") else str(d.created_at),
            "kind": "document",
        }
        for d in uploaded
        if d.id not in matched_ids
    ]

    # Also include Evidence records uploaded directly to controls (via share links or manual upload)
    # These exist in the evidence table only — load them via ControlAssessment join
    cas = (await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
    )).scalars().all()
    ca_ids = [ca.id for ca in cas]

    if ca_ids:
        # Build clause_ref lookup: ca.id → human-readable control_id (e.g. "4.1")
        fc_ids = list({ca.control_id for ca in cas})
        fcs = (await db.execute(
            select(FrameworkControl).where(FrameworkControl.id.in_(fc_ids))
        )).scalars().all()
        fc_map: dict[str, str] = {fc.id: fc.control_id for fc in fcs}  # fc.id → clause_ref
        ca_clause_map: dict[str, str] = {ca.id: fc_map.get(ca.control_id, "") for ca in cas}

        # Build MandatoryDocument lookup: clause_ref → document_type_key
        md_by_clause: dict[str, MandatoryDocument] = {md.clause_ref: md for md in mandatory_docs}

        evidence_rows = (await db.execute(
            select(Evidence).where(
                Evidence.control_assessment_id.in_(ca_ids),
                Evidence.is_visible_to_auditor == True,  # noqa: E712
            )
        )).scalars().all()

        for ev in evidence_rows:
            clause_ref = ca_clause_map.get(ev.control_assessment_id, "")
            md = md_by_clause.get(clause_ref)
            if md:
                # Add evidence to the matching clause row's uploaded_documents list
                ev_entry = {
                    "id": ev.id,
                    "file_name": ev.file_name or ev.name,
                    "file_path": ev.file_path,
                    "content_type": ev.content_type,
                    "file_size_bytes": ev.file_size_bytes,
                    "is_visible_to_auditor": bool(ev.is_visible_to_auditor),
                    "created_at": ev.created_at.isoformat() if hasattr(ev.created_at, "isoformat") else str(ev.created_at),
                    "kind": "evidence",
                }
                for item in items:
                    if item["document_type_key"] == md.document_type_key:
                        item["uploaded_documents"].append(ev_entry)
                        item["is_uploaded"] = True
                        if not item["uploaded_document"]:
                            item["uploaded_document"] = {"id": ev.id, "file_name": ev.file_name or ev.name, "ai_analysis_summary": None}
                        break
            else:
                # No clause match — add to other_uploads
                other_uploads.append({
                    "id": ev.id,
                    "file_name": ev.file_name or ev.name,
                    "content_type": ev.content_type,
                    "file_size_bytes": ev.file_size_bytes,
                    "is_visible_to_auditor": bool(ev.is_visible_to_auditor),
                    "created_at": ev.created_at.isoformat() if hasattr(ev.created_at, "isoformat") else str(ev.created_at),
                    "kind": "evidence",
                })

    uploaded_count = sum(1 for i in items if i["is_uploaded"])
    return {
        "total": len(items),
        "uploaded": uploaded_count,
        "items": items,
        "other_uploads": other_uploads,
    }


# ─── Gap Recommendation ────────────────────────────────────────────────────────


class RecommendationRequest(BaseModel):
    action: str  # "accept" | "reject"
    owner_id: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    notes: str | None = None
    # « actions correctives OU préventives » — the nature of the action, which the
    # requirement is built on and which could not be stated anywhere before.
    action_type: str = "corrective"
    recurrence: str | None = None


class BulkRecommendationRequest(BaseModel):
    """Body of the bulk accept/reject.

    ``gap_ids`` used to be REQUIRED while the only caller in the product
    (GapReportTab's "accept all critical" button) sends ``{action, filter}`` — so
    that button answered 422 on every click and silently swallowed it. Both shapes
    are accepted now, and one of the two must be present.
    """
    gap_ids: list[str] | None = None
    action: str  # "accept" | "reject"
    #: "critical" | "high" | "medium" | "low" | "blockers" | "all" | "pending"
    filter: str | None = None
    owner_id: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    action_type: str = "corrective"


@router.post("/assessments/{assessment_id}/gaps/{gap_id}/recommendation")
async def act_on_gap_recommendation(
    assessment_id: str,
    gap_id: str,
    body: RecommendationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> dict:
    """
    Accept or reject a gap recommendation.
    Accepting creates an ActionItem assigned to the given owner.
    """
    if body.action not in ("accept", "reject"):
        raise HTTPException(status_code=422, detail="action must be 'accept' or 'reject'")

    result = await db.execute(
        select(ComplianceGap, ComplianceAssessment)
        .join(ComplianceAssessment, ComplianceGap.assessment_id == ComplianceAssessment.id)
        .where(
            ComplianceGap.id == gap_id,
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Gap not found")

    gap, _ = row

    if body.action_type not in ACTION_TYPES:
        raise HTTPException(status_code=422, detail=f"action_type must be one of {list(ACTION_TYPES)}")
    if body.recurrence is not None and body.recurrence not in ACTION_RECURRENCES:
        raise HTTPException(status_code=422, detail=f"recurrence must be one of {list(ACTION_RECURRENCES)}")

    # Verify owner_id (if any) is in this tenant before assigning the action item.
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")

    gap.recommendation_status = body.action + "ed"  # "accepted" | "rejected"

    action_item_id = None
    if body.action == "accept":
        # The auto-sync in list_action_plan may already have raised an item for this
        # gap. Accepting used to add a SECOND one, so the same non-conformity showed
        # up twice on the board and closing one of them proved nothing. Plan the
        # existing item instead: an "accept" carrying an owner and dates is exactly
        # the planning act the requirement asks for.
        existing_item = (await db.execute(
            select(ActionItem).where(
                ActionItem.tenant_id == tenant_id,
                ActionItem.gap_id == gap_id,
                ActionItem.status != ActionItemStatus.CANCELLED,
            ).order_by(ActionItem.created_at)
        )).scalars().first()

        ctrl_result = await db.execute(
            select(FrameworkControl).where(FrameworkControl.id == gap.control_id)
        )
        ctrl = ctrl_result.scalar_one_or_none()
        ctrl_title = ctrl.title if ctrl else "Control"

        priority_map = {90: ActionItemPriority.CRITICAL, 60: ActionItemPriority.HIGH,
                        50: ActionItemPriority.MEDIUM, 30: ActionItemPriority.LOW}
        priority = priority_map.get(gap.remediation_priority, ActionItemPriority.MEDIUM)

        if existing_item is not None:
            action_item = existing_item
            action_item.owner_id = body.owner_id or action_item.owner_id or current_user.id
            if body.start_date is not None:
                action_item.start_date = body.start_date
            if body.due_date is not None:
                action_item.due_date = body.due_date
            if body.notes is not None:
                action_item.notes = body.notes
            action_item.action_type = body.action_type
            if body.recurrence is not None:
                action_item.recurrence = body.recurrence
        else:
            action_item = ActionItem(
                tenant_id=tenant_id,
                assessment_id=assessment_id,
                gap_id=gap_id,
                title=f"Remediate: {ctrl_title}",
                description=gap.gap_description,
                owner_id=body.owner_id or current_user.id,  # tenant-checked above
                start_date=body.start_date,
                due_date=body.due_date,
                priority=priority,
                status=ActionItemStatus.OPEN,
                ai_generated=True,
                notes=body.notes,
                action_type=body.action_type,
                recurrence=body.recurrence,
            )
            db.add(action_item)
        await db.flush()
        gap.action_item_id = action_item.id
        action_item_id = action_item.id

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    return {
        "gap_id": gap_id,
        "recommendation_status": gap.recommendation_status,
        "action_item_id": action_item_id,
    }


@router.post("/assessments/{assessment_id}/gaps/bulk-action")
async def bulk_act_on_gaps(
    assessment_id: str,
    body: BulkRecommendationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> dict:
    """Accept or reject several gap recommendations at once.

    Selection is either an explicit ``gap_ids`` list or a ``filter`` — the shape
    the "accept all critical" button has always sent and which this endpoint used
    to reject with a 422 nobody saw, because the caller swallows the error.
    """
    if body.action not in ("accept", "reject"):
        raise HTTPException(status_code=422, detail="action must be 'accept' or 'reject'")
    if not body.gap_ids and not body.filter:
        raise HTTPException(status_code=422, detail="give either gap_ids or filter")
    if body.action_type not in ACTION_TYPES:
        raise HTTPException(status_code=422, detail=f"action_type must be one of {list(ACTION_TYPES)}")

    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")

    gap_filter = [
        ComplianceAssessment.id == assessment_id,
        ComplianceAssessment.tenant_id == tenant_id,
        # A resolved non-conformity must never grow a fresh action item.
        ComplianceGap.is_resolved == False,  # noqa: E712
    ]
    if body.gap_ids:
        gap_filter.append(ComplianceGap.id.in_(body.gap_ids))
    else:
        selector = (body.filter or "").lower()
        if selector in ("critical", "high", "medium", "low"):
            gap_filter.append(ComplianceGap.severity == selector)
        elif selector == "blockers":
            gap_filter.append(ComplianceGap.is_certification_blocker == True)  # noqa: E712
        elif selector not in ("all", "pending", ""):
            raise HTTPException(status_code=422, detail=f"unknown filter '{body.filter}'")
        # A filter means "everything still awaiting a decision", which is what the
        # caller's own optimistic update assumes.
        gap_filter.append(ComplianceGap.recommendation_status == "pending")

    result = await db.execute(
        select(ComplianceGap, ComplianceAssessment)
        .join(ComplianceAssessment, ComplianceGap.assessment_id == ComplianceAssessment.id)
        .where(*gap_filter)
    )
    rows = result.all()

    # One query for the items that already exist, instead of one per gap.
    existing_by_gap: dict[str, ActionItem] = {}
    if rows:
        for item in (await db.execute(
            select(ActionItem).where(
                ActionItem.tenant_id == tenant_id,
                ActionItem.gap_id.in_([g.id for g, _ in rows]),
                ActionItem.status != ActionItemStatus.CANCELLED,
            ).order_by(ActionItem.created_at)
        )).scalars().all():
            existing_by_gap.setdefault(item.gap_id, item)

    processed = 0
    for gap, _ in rows:
        gap.recommendation_status = body.action + "ed"
        if body.action == "accept":
            ctrl_result = await db.execute(
                select(FrameworkControl).where(FrameworkControl.id == gap.control_id)
            )
            ctrl = ctrl_result.scalar_one_or_none()
            ctrl_title = ctrl.title if ctrl else "Control"
            priority_map = {90: ActionItemPriority.CRITICAL, 60: ActionItemPriority.HIGH,
                            50: ActionItemPriority.MEDIUM, 30: ActionItemPriority.LOW}
            priority = priority_map.get(gap.remediation_priority, ActionItemPriority.MEDIUM)
            action_item = existing_by_gap.get(gap.id)
            if action_item is not None:
                # Plan the item the auto-sync already raised rather than adding a
                # second one for the same non-conformity.
                action_item.owner_id = body.owner_id or action_item.owner_id or current_user.id
                if body.start_date is not None:
                    action_item.start_date = body.start_date
                if body.due_date is not None:
                    action_item.due_date = body.due_date
                action_item.action_type = body.action_type
            else:
                action_item = ActionItem(
                    tenant_id=tenant_id,
                    assessment_id=assessment_id,
                    gap_id=gap.id,
                    title=f"Remediate: {ctrl_title}",
                    description=gap.gap_description,
                    owner_id=body.owner_id or current_user.id,  # tenant-checked above
                    start_date=body.start_date,
                    due_date=body.due_date,
                    priority=priority,
                    status=ActionItemStatus.OPEN,
                    ai_generated=True,
                    action_type=body.action_type,
                )
                db.add(action_item)
            await db.flush()
            gap.action_item_id = action_item.id
        processed += 1

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    return {"processed": processed, "action": body.action + "ed"}


# ─── Traceability Matrix ────────────────────────────────────────────────────────

@router.get("/assessments/{assessment_id}/traceability")
async def get_traceability_matrix(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
) -> dict:
    """Return control → gap → action_item traceability matrix for an assessment."""
    asmt_result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = asmt_result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    ca_result = await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
    )
    cas = ca_result.scalars().all()

    ctrl_ids = [ca.control_id for ca in cas]
    ctrl_result = await db.execute(
        select(FrameworkControl).where(FrameworkControl.id.in_(ctrl_ids))
    )
    ctrl_map = {c.id: c for c in ctrl_result.scalars().all()}

    gap_result = await db.execute(
        select(ComplianceGap).where(ComplianceGap.assessment_id == assessment_id)
    )
    gaps_by_control: dict[str, list] = {}
    for gap in gap_result.scalars().all():
        gaps_by_control.setdefault(gap.control_id, []).append(gap)

    ai_result = await db.execute(
        select(ActionItem).where(ActionItem.assessment_id == assessment_id)
    )
    ai_by_gap: dict[str, list] = {}
    for item in ai_result.scalars().all():
        if item.gap_id:
            ai_by_gap.setdefault(item.gap_id, []).append(item)

    rows = []
    for ca in cas:
        ctrl = ctrl_map.get(ca.control_id)
        ctrl_gaps = gaps_by_control.get(ca.control_id, [])
        if ctrl_gaps:
            for gap in ctrl_gaps:
                rows.append({
                    "control_id": ca.control_id,
                    "control_identifier": ctrl.control_id if ctrl else ca.control_id,
                    "control_title": ctrl.title if ctrl else "",
                    "control_category": ctrl.category if ctrl else None,
                    "control_status": ca.status,
                    "ai_confidence": ca.ai_confidence,
                    "gap_id": gap.id,
                    "gap_description": gap.gap_description,
                    "gap_severity": gap.severity,
                    "recommendation_status": gap.recommendation_status,
                    "is_certification_blocker": gap.is_certification_blocker,
                    "remediation_priority": gap.remediation_priority,
                    "action_items": [
                        {
                            "id": ai.id,
                            "title": ai.title,
                            "status": ai.status,
                            "priority": ai.priority,
                            "due_date": ai.due_date,
                        }
                        for ai in ai_by_gap.get(gap.id, [])
                    ],
                })
        else:
            rows.append({
                "control_id": ca.control_id,
                "control_identifier": ctrl.control_id if ctrl else ca.control_id,
                "control_title": ctrl.title if ctrl else "",
                "control_category": ctrl.category if ctrl else None,
                "control_status": ca.status,
                "ai_confidence": ca.ai_confidence,
                "gap_id": None,
                "gap_description": None,
                "gap_severity": None,
                "recommendation_status": None,
                "is_certification_blocker": False,
                "remediation_priority": None,
                "action_items": [],
            })

    await localize_fields(db, lang, [(r, {"control_title": r["control_title"]}) for r in rows])

    total_controls = len(cas)
    gaps_total = sum(len(v) for v in gaps_by_control.values())
    action_items_open = sum(
        sum(1 for ai in items if ai.status == "open")
        for items in ai_by_gap.values()
    )

    return {
        "assessment_id": assessment_id,
        "assessment_name": assessment.name,
        "rows": rows,
        "summary": {
            "total_controls": total_controls,
            "compliant": sum(1 for ca in cas if ca.status == ControlStatus.IMPLEMENTED),
            "partial": sum(1 for ca in cas if ca.status == ControlStatus.PARTIALLY_IMPLEMENTED),
            "gaps": gaps_total,
            "action_items_total": sum(len(v) for v in ai_by_gap.values()),
            "action_items_open": action_items_open,
        },
    }


@router.post("/control-assessments/{control_assessment_id}/evidence")
async def upload_control_evidence(
    control_assessment_id: str,
    file: UploadFile = File(...),
    # R2 5.4 — how long this proof stays valid (YYYY-MM-DD, optional).
    valid_from: str | None = Form(None),
    valid_until: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ASSESS_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
) -> EvidenceResponse:
    """Upload evidence file for a specific control assessment."""
    def _iso_date(v: str | None, name: str) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        try:
            return date.fromisoformat(v[:10]).isoformat()
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{name} must be a date (YYYY-MM-DD).")
    valid_from = _iso_date(valid_from, "valid_from")
    valid_until = _iso_date(valid_until, "valid_until")
    if valid_from and valid_until and valid_until < valid_from:
        raise HTTPException(status_code=422, detail="valid_until cannot be before valid_from.")
    # Reject filenames whose extension must never reach the uploads
    # volume — see security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(file.filename, field_name="file")
    result = await db.execute(
        select(ControlAssessment, ComplianceAssessment)
        .join(ComplianceAssessment, ControlAssessment.assessment_id == ComplianceAssessment.id)
        .where(
            ControlAssessment.id == control_assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Control assessment not found")

    ca, assessment = row
    perimeter.assert_in_perimeter(current_user, ca, await get_effective_roles(current_user, db),
                                  what="record", lang=lang)

    # Fetch framework short name for display filename
    ev_fw_result = await db.execute(
        select(Framework).where(Framework.id == assessment.framework_id)
    )
    ev_fw_obj = ev_fw_result.scalar_one_or_none()
    ev_fw_short = ev_fw_obj.short_name if ev_fw_obj else ""

    # Accept: PDF, DOCX, TXT only
    content_type = file.content_type or ""
    name_lower = (file.filename or "").lower()
    is_allowed = (
        "pdf" in content_type
        or "docx" in content_type
        or "word" in content_type
        or "spreadsheetml" in content_type
        or "ms-excel" in content_type
        or "text/plain" in content_type
        or name_lower.endswith(".pdf")
        or name_lower.endswith(".docx")
        or name_lower.endswith(".xlsx")
        or name_lower.endswith(".xls")
        or name_lower.endswith(".txt")
    )
    if not is_allowed:
        raise HTTPException(status_code=422, detail="Only PDF, DOCX, XLSX, XLS, and TXT files are supported")

    file_bytes = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")

    declared = (content_type or "").lower()
    if "pdf" in declared and not verify_file_signature(file_bytes, "application/pdf"):
        raise HTTPException(415, "File contents do not match the declared PDF type.")
    if "spreadsheetml" in declared and not verify_file_signature(file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
        raise HTTPException(415, "File contents do not match the declared XLSX type.")
    if "ms-excel" in declared and not verify_file_signature(file_bytes, "application/vnd.ms-excel"):
        raise HTTPException(415, "File contents do not match the declared XLS type.")

    safe_name = _sanitize_filename(file.filename or "evidence.txt")
    # ControlAssessment has no `control_identifier` — that name belongs to the
    # response schemas, which fill it from the linked FrameworkControl. Reading
    # it off the ORM row raised AttributeError, so EVERY upload through this
    # endpoint 500'd. Resolve the human identifier ("A.5.1") the same way the
    # rest of this module does, and fall back to the FK if the control is gone.
    ev_ctrl = (await db.execute(
        select(FrameworkControl).where(FrameworkControl.id == ca.control_id)
    )).scalar_one_or_none()
    control_identifier = ev_ctrl.control_id if ev_ctrl else (ca.control_id or "")
    display_name = _build_evidence_filename(
        ev_fw_short,
        control_identifier,
        ca.status.value if ca.status else "not_started",
        file.filename or safe_name,
    )
    rel_path = f"{tenant_id}/evidence/{uuid.uuid4().hex}_{safe_name}"
    full_path = Path(settings.UPLOADS_DIR) / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(file_bytes)

    evidence = Evidence(
        control_assessment_id=control_assessment_id,
        tenant_id=tenant_id,
        name=display_name,
        evidence_type=EvidenceType.DOCUMENT,
        file_name=display_name,
        file_path=rel_path,
        file_size_bytes=len(file_bytes),
        file_sha256=file_integrity.sha256_bytes(file_bytes),
        content_type=content_type,
        uploaded_by_id=current_user.id,
        is_visible_to_auditor=True,
        valid_from=valid_from,
        valid_until=valid_until,
    )
    db.add(evidence)
    await db.flush()
    await file_integrity.record_version(
        db, tenant_id=tenant_id, entity_type=file_integrity.EVIDENCE,
        entity_id=evidence.id, parent_type="control_assessment",
        parent_id=control_assessment_id, file_path=rel_path, file_name=display_name,
        file_sha256=evidence.file_sha256, file_size_bytes=len(file_bytes),
        content_type=content_type, uploaded_by_id=current_user.id,
    )

    # ── Cross-framework evidence propagation ──────────────────────────────────
    # Find the FrameworkControl for this control assessment to read its mapped_controls.
    shared_count = 0
    try:
        fc_result = await db.execute(
            select(FrameworkControl).where(FrameworkControl.id == ca.control_id)
        )
        framework_control = fc_result.scalar_one_or_none()
        if framework_control and framework_control.mapped_controls:
            # mapped_controls = [{"framework": "NIST_CSF", "control": "PR.AC-1"}, ...]
            mapped = framework_control.mapped_controls or []
            if mapped:
                # Collect (framework_short_name, control_id) pairs
                fw_short_names = list({m["framework"] for m in mapped if "framework" in m})
                ctrl_ids = list({m["control"] for m in mapped if "control" in m})

                # Find Frameworks and FrameworkControls that match
                fw_rows = (await db.execute(
                    select(Framework).where(Framework.short_name.in_(fw_short_names))
                )).scalars().all()
                fw_id_to_short = {fw.id: fw.short_name for fw in fw_rows}

                if fw_rows:
                    matched_fcs = (await db.execute(
                        select(FrameworkControl).where(
                            FrameworkControl.framework_id.in_([fw.id for fw in fw_rows]),
                            FrameworkControl.control_id.in_(ctrl_ids),
                        )
                    )).scalars().all()

                    # Filter: only keep FrameworkControls whose (framework_short_name, control_id) is in the mapping
                    mapping_set = {(m["framework"], m["control"]) for m in mapped if "framework" in m and "control" in m}
                    valid_fc_ids = [
                        fc.id for fc in matched_fcs
                        if (fw_id_to_short.get(fc.framework_id, ""), fc.control_id) in mapping_set
                    ]

                    if valid_fc_ids:
                        # Find ControlAssessments for those controls in other active tenant assessments
                        target_cas = (await db.execute(
                            select(ControlAssessment)
                            .join(ComplianceAssessment, ControlAssessment.assessment_id == ComplianceAssessment.id)
                            .where(
                                ControlAssessment.control_id.in_(valid_fc_ids),
                                ComplianceAssessment.tenant_id == tenant_id,
                                ControlAssessment.assessment_id != ca.assessment_id,
                            )
                        )).scalars().all()

                        for target_ca in target_cas:
                            # Give each copy its own file on disk so deletions are independent
                            copy_rel = f"{tenant_id}/evidence/{uuid.uuid4().hex}_{evidence.file_name}"
                            copy_full = Path(settings.UPLOADS_DIR) / copy_rel
                            copy_full.parent.mkdir(parents=True, exist_ok=True)
                            import shutil as _shutil
                            _shutil.copy2(str(full_path), str(copy_full))

                            shared = Evidence(
                                control_assessment_id=target_ca.id,
                                tenant_id=tenant_id,
                                name=evidence.name,
                                evidence_type=EvidenceType.DOCUMENT,
                                file_name=evidence.file_name,
                                file_path=copy_rel,
                                file_size_bytes=evidence.file_size_bytes,
                                # copy2 is byte-for-byte, so the source digest
                                # describes the copy too. Without this, every
                                # propagated copy would land "unrecorded" and
                                # that status would stop meaning "legacy".
                                file_sha256=evidence.file_sha256,
                                content_type=evidence.content_type,
                                uploaded_by_id=current_user.id,
                                is_visible_to_auditor=True,
                                shared_from_evidence_id=None,
                                valid_from=valid_from,
                                valid_until=valid_until,
                            )
                            db.add(shared)
                            await db.flush()
                            await db.commit()
                            await file_integrity.record_version(
                                db, tenant_id=tenant_id,
                                entity_type=file_integrity.EVIDENCE,
                                entity_id=shared.id,
                                parent_type="control_assessment",
                                parent_id=target_ca.id,
                                file_path=copy_rel, file_name=evidence.file_name,
                                file_sha256=evidence.file_sha256,
                                file_size_bytes=evidence.file_size_bytes,
                                content_type=evidence.content_type,
                                uploaded_by_id=current_user.id,
                                note=f"Propagated from evidence {evidence.id}",
                            )
                            shared_count += 1
    except Exception:
        # Propagation failure must never block the primary upload
        pass
    # ─────────────────────────────────────────────────────────────────────────

    return EvidenceResponse(
        id=evidence.id,
        file_name=evidence.file_name,
        file_path=evidence.file_path,
        file_size_bytes=evidence.file_size_bytes,
        content_type=evidence.content_type,
        is_visible_to_auditor=evidence.is_visible_to_auditor,
        created_at=evidence.created_at,
        shared_count=shared_count,
        valid_from=valid_from,
        valid_until=valid_until,
    )


@router.get("/control-assessments/{control_assessment_id}/evidence", response_model=list[EvidenceResponse])
async def list_control_evidence(
    control_assessment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all evidence files for a control assessment."""
    # Evidence.tenant_id was never in this WHERE, so a control_assessment_id from
    # ANOTHER tenant listed that tenant's evidence rows — file names, sizes and
    # ids, which is all the /evidence/{id}/download route then needs. Every other
    # evidence route in this file filters on it.
    stmt = (
        select(Evidence)
        .where(
            Evidence.control_assessment_id == control_assessment_id,
            Evidence.tenant_id == tenant_id,
        )
        .order_by(Evidence.created_at)
    )
    # Same rule the auditor portal and the action-plan attachments apply: a file
    # hidden from auditors must not be listed to one.
    if current_user.role == UserRole.AUDITOR:
        stmt = stmt.where(Evidence.is_visible_to_auditor == True)  # noqa: E712
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [EvidenceResponse(
        id=e.id,
        file_name=e.file_name,
        file_path=e.file_path,
        file_size_bytes=e.file_size_bytes,
        content_type=e.content_type,
        is_visible_to_auditor=e.is_visible_to_auditor if e.is_visible_to_auditor is not None else True,
        created_at=e.created_at,
        is_shared=bool(e.shared_from_evidence_id),
        valid_from=e.valid_from,
        valid_until=e.valid_until,
    ) for e in items]


@router.patch("/evidence/{evidence_id}/visibility", response_model=EvidenceResponse)
async def toggle_evidence_visibility(
    evidence_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Toggle whether an evidence file is visible to auditors.

    Gated like the upload it mirrors (POST .../evidence is CISO): with only
    get_current_user, the auditor a file was deliberately hidden from could
    simply un-hide it, which made the flag advisory rather than a control.
    """
    result = await db.execute(
        select(Evidence).where(Evidence.id == evidence_id, Evidence.tenant_id == tenant_id)
    )
    evidence = result.scalar_one_or_none()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    current_val = evidence.is_visible_to_auditor if evidence.is_visible_to_auditor is not None else True
    evidence.is_visible_to_auditor = not current_val
    await db.commit()
    await db.refresh(evidence)
    return EvidenceResponse(
        id=evidence.id,
        file_name=evidence.file_name,
        file_path=evidence.file_path,
        file_size_bytes=evidence.file_size_bytes,
        content_type=evidence.content_type,
        is_visible_to_auditor=evidence.is_visible_to_auditor,
        created_at=evidence.created_at,
    )


@router.delete("/evidence/{evidence_id}", status_code=204)
async def delete_evidence(
    evidence_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete an evidence file.

    Only the roles that may upload evidence may remove it. Unauthenticated-role
    parity matters here: with get_current_user any account of the tenant — a
    viewer, or the external auditor being audited — could erase the record an
    audit conclusion rests on.
    """
    result = await db.execute(
        select(Evidence).where(Evidence.id == evidence_id, Evidence.tenant_id == tenant_id)
    )
    evidence = result.scalar_one_or_none()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    # The file is deliberately NOT unlinked. This used to destroy the bytes an
    # audit conclusion rested on, permanently and with no trace — one wrong
    # click and the evidence was unrecoverable. The version history is retired
    # instead, so the file stays retrievable via the file-versions endpoints.
    if evidence.file_path:
        await file_integrity.retire_versions(
            db,
            entity_type=file_integrity.EVIDENCE,
            entity_id=evidence.id,
            note=f"Evidence record deleted by {current_user.email}",
        )
    await db.delete(evidence)
    await db.commit()


@router.get("/evidence/{evidence_id}/download")
async def download_evidence(
    evidence_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    acknowledge_integrity_failure: bool = Query(
        False,
        description="CISO override: serve a file whose checksum no longer matches, "
                    "so a damaged or altered file can still be investigated.",
    ),
):
    """Download/view an evidence file."""
    from fastapi.responses import FileResponse
    from pathlib import Path as _Path
    result = await db.execute(
        select(Evidence).where(Evidence.id == evidence_id, Evidence.tenant_id == tenant_id)
    )
    evidence = result.scalar_one_or_none()
    if not evidence or not evidence.file_path:
        raise HTTPException(status_code=404, detail="File not found")
    # Deliberately the same 404 as "no such file": a piece of evidence hidden
    # from auditors must not be reachable by guessing its id either — the rule
    # the action-plan attachment download already applies.
    if current_user.role == UserRole.AUDITOR and evidence.is_visible_to_auditor is False:
        raise HTTPException(status_code=404, detail="File not found")
    full = _Path(settings.UPLOADS_DIR) / evidence.file_path
    if not full.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    # Integrity check before the bytes leave the building. Evidence is what an
    # audit conclusion rests on, so serving a file that no longer matches what
    # was uploaded — silently — is the one outcome worth refusing outright.
    status_, actual = await asyncio.to_thread(
        file_integrity.verify_file, full, evidence.file_sha256
    )
    return await _integrity_response(
        FileResponse, full, evidence.file_name or "evidence", evidence.content_type,
        evidence.file_sha256, status_, actual, acknowledge_integrity_failure,
        current_user, tenant_id, label=f"evidence {evidence.id}", db=db,
    )


# ─── Uploaded Document (checklist) management ──────────────────────────────────


@router.get("/documents/{doc_id}/download")
async def download_uploaded_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    acknowledge_integrity_failure: bool = Query(
        False,
        description="CISO override: serve a file whose checksum no longer matches, "
                    "so a damaged or altered file can still be investigated.",
    ),
):
    """Download/view an uploaded checklist document."""
    from fastapi.responses import FileResponse as _FR
    from pathlib import Path as _Path2
    result = await db.execute(
        select(UploadedDocument).where(
            UploadedDocument.id == doc_id,
            UploadedDocument.tenant_id == tenant_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc or not doc.file_path:
        raise HTTPException(status_code=404, detail="Document not found")
    # Same rule as the evidence download — and for the same reason it needed the
    # integrity guard below: a share-link upload points an Evidence row and this
    # UploadedDocument at the SAME bytes, so without this an auditor could fetch
    # a hidden evidence file through the document route instead.
    if current_user.role == UserRole.AUDITOR and doc.is_visible_to_auditor is False:
        raise HTTPException(status_code=404, detail="Document not found")
    full = _Path2(settings.UPLOADS_DIR) / doc.file_path
    if not full.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    # Same integrity guard as the evidence route. Without it this endpoint is a
    # way around that one: a share-link upload writes an Evidence row and an
    # UploadedDocument row pointing at the SAME file, so a blocked evidence
    # download could simply be fetched here instead.
    status_, actual = await asyncio.to_thread(
        file_integrity.verify_file, full, doc.file_sha256
    )
    return await _integrity_response(
        _FR, full, doc.file_name or "document", doc.content_type,
        doc.file_sha256, status_, actual, acknowledge_integrity_failure,
        current_user, tenant_id, label=f"document {doc.id}", db=db,
    )


@router.patch("/documents/{doc_id}/visibility", response_model=UploadedDocumentResponse)
async def toggle_document_visibility(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Toggle whether a checklist document is visible to auditors.

    Gated like the upload (POST /assessments/{id}/documents is CISO) and like the
    evidence toggle beside it — an auditor must not be able to reveal a document
    that was hidden from them.
    """
    result = await db.execute(
        select(UploadedDocument).where(
            UploadedDocument.id == doc_id,
            UploadedDocument.tenant_id == tenant_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    current_val = bool(doc.is_visible_to_auditor) if doc.is_visible_to_auditor is not None else True
    new_val = not current_val
    # Use a direct UPDATE to guarantee the write reaches SQLite regardless of ORM dirty-tracking
    await db.execute(
        sa_update(UploadedDocument)
        .where(UploadedDocument.id == doc.id)
        .values(is_visible_to_auditor=new_val)
    )
    await db.commit()
    # Re-fetch to return the persisted value
    result2 = await db.execute(
        select(UploadedDocument).where(UploadedDocument.id == doc.id)
    )
    doc = result2.scalar_one()
    return UploadedDocumentResponse(
        id=doc.id,
        file_name=doc.file_name,
        file_path=doc.file_path,
        file_size_bytes=doc.file_size_bytes,
        content_type=doc.content_type,
        is_visible_to_auditor=bool(doc.is_visible_to_auditor) if doc.is_visible_to_auditor is not None else new_val,
        created_at=doc.created_at,
    )


class DocumentLogEntry(BaseModel):
    id: str
    file_name: str
    file_size_bytes: int | None = None
    content_type: str | None = None
    document_type_key: str | None = None
    clause_refs: list = []
    ai_analysis_summary: str | None = None
    is_visible_to_auditor: bool = True
    uploaded_by_id: str | None = None
    uploaded_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


@router.get("/assessments/{assessment_id}/document-log", response_model=list[DocumentLogEntry])
async def get_document_log(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Return all uploaded documents for an assessment, enriched with uploader info."""
    # Verify access
    a = (await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Assessment not found")

    stmt = (
        select(UploadedDocument)
        .where(UploadedDocument.assessment_id == assessment_id)
        .order_by(UploadedDocument.created_at.desc())
    )
    # The download honours is_visible_to_auditor; this listing did not, so an
    # auditor still read the id, the file name and the uploader of a document
    # deliberately withheld from them — and the id is what the download takes.
    # NULL means "never set" and has always meant visible.
    if current_user.role == UserRole.AUDITOR:
        stmt = stmt.where(or_(
            UploadedDocument.is_visible_to_auditor == True,  # noqa: E712
            UploadedDocument.is_visible_to_auditor.is_(None),
        ))
    docs = (await db.execute(stmt)).scalars().all()

    uploader_ids = {d.uploaded_by_id for d in docs if d.uploaded_by_id}
    from app.models.user import User as UserModel
    uploaders: dict = {}
    if uploader_ids:
        uploaders = {
            u.id: u for u in (await db.execute(
                select(UserModel).where(UserModel.id.in_(uploader_ids))
            )).scalars().all()
        }

    return [
        DocumentLogEntry(
            id=d.id,
            file_name=d.file_name,
            file_size_bytes=d.file_size_bytes,
            content_type=d.content_type,
            document_type_key=d.document_type_key,
            clause_refs=d.clause_refs or [],
            ai_analysis_summary=d.ai_analysis_summary,
            is_visible_to_auditor=d.is_visible_to_auditor,
            uploaded_by_id=d.uploaded_by_id,
            uploaded_by_name=(
                f"{uploaders[d.uploaded_by_id].first_name} {uploaders[d.uploaded_by_id].last_name}".strip()
                if d.uploaded_by_id and d.uploaded_by_id in uploaders else None
            ),
            created_at=d.created_at,
            updated_at=d.updated_at,
        )
        for d in docs
    ]


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_uploaded_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete a checklist document.

    Same gate as the upload: removing the document an AI analysis and its gaps
    were derived from is not something every account of the tenant may do.
    """
    result = await db.execute(
        select(UploadedDocument).where(
            UploadedDocument.id == doc_id,
            UploadedDocument.tenant_id == tenant_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # Deliberately NOT unlinked, for two reasons. The file stays recoverable
    # like deleted evidence does; and a share-link upload points an Evidence
    # row AND this UploadedDocument at the SAME path, so unlinking here used to
    # destroy the bytes of a live evidence record that delete_evidence was
    # written never to touch.
    if doc.file_path:
        await file_integrity.retire_versions(
            db, entity_type=file_integrity.DOCUMENT, entity_id=doc.id,
            note=f"Checklist document deleted by {current_user.email}",
        )
    await db.delete(doc)
    await db.commit()


# ─── Stakeholder evidence upload share-links ──────────────────────────────────

from app.models.evidence_upload_token import EvidenceUploadToken  # noqa: E402


class ShareLinkCreate(BaseModel):
    label: str | None = None
    instructions: str | None = None
    expires_at: datetime | None = None
    max_uses: int | None = None


class ShareLinkResponse(BaseModel):
    id: str
    token: str
    label: str | None
    instructions: str | None
    expires_at: datetime | None
    is_active: bool
    max_uses: int | None
    use_count: int
    created_at: str
    upload_url: str

    model_config = {"from_attributes": True}


@router.post("/control-assessments/{ca_id}/share-links", response_model=ShareLinkResponse, status_code=201)
async def create_share_link(
    ca_id: str,
    body: ShareLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a shareable upload link for a control assessment.

    The token this mints is an UNAUTHENTICATED ingress into the tenant's evidence
    store (/public/evidence-upload/{token}). Handing that power to every account
    of the tenant — including the external auditor's — was strictly wider than
    the CISO gate on the authenticated upload it bypasses.
    """
    ca = (await db.execute(
        select(ControlAssessment).join(
            ComplianceAssessment, ControlAssessment.assessment_id == ComplianceAssessment.id
        ).where(
            ControlAssessment.id == ca_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not ca:
        raise HTTPException(404, "Control assessment not found")

    tok = EvidenceUploadToken(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        control_assessment_id=ca_id,
        created_by_id=current_user.id,
        label=body.label,
        instructions=body.instructions,
        expires_at=body.expires_at,
        max_uses=body.max_uses,
    )
    db.add(tok)
    await db.commit()
    await db.refresh(tok)

    frontend_base = settings.FRONTEND_BASE_URL
    return ShareLinkResponse(
        id=tok.id,
        token=tok.token,
        label=tok.label,
        instructions=tok.instructions,
        expires_at=tok.expires_at,
        is_active=tok.is_active,
        max_uses=tok.max_uses,
        use_count=tok.use_count,
        created_at=tok.created_at.isoformat() if tok.created_at else "",
        upload_url=f"{frontend_base}/upload/{tok.token}",
    )


@router.get("/control-assessments/{ca_id}/share-links", response_model=list[ShareLinkResponse])
async def list_share_links(
    ca_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all share links for a control assessment.

    The response contains the raw token, so reading this list IS holding the
    credential — same gate as creating one.
    """
    rows = (await db.execute(
        select(EvidenceUploadToken).where(
            EvidenceUploadToken.control_assessment_id == ca_id,
            EvidenceUploadToken.tenant_id == tenant_id,
        ).order_by(EvidenceUploadToken.created_at.desc())
    )).scalars().all()

    frontend_base = settings.FRONTEND_BASE_URL
    return [
        ShareLinkResponse(
            id=r.id,
            token=r.token,
            label=r.label,
            instructions=r.instructions,
            expires_at=r.expires_at,
            is_active=r.is_active,
            max_uses=r.max_uses,
            use_count=r.use_count,
            created_at=r.created_at.isoformat() if r.created_at else "",
            upload_url=f"{frontend_base}/upload/{r.token}",
        )
        for r in rows
    ]


# ── Action Plan (global to-do list from all gaps) ─────────────────────────────

class ActionPlanItem(BaseModel):
    id: str
    title: str
    description: str | None
    priority: str
    status: str
    start_date: str | None
    due_date: str | None
    notes: str | None
    ai_generated: bool
    # linked assessment / framework context
    assessment_id: str | None
    assessment_name: str | None
    framework_name: str | None
    framework_short_name: str | None
    # linked gap context
    gap_id: str | None
    control_identifier: str | None
    control_title: str | None
    gap_severity: str | None
    is_certification_blocker: bool
    # True once the non-conformity behind this action is closed — the "Exigence
    # clôturée" state the closure loop writes back into the compliance record.
    gap_resolved: bool = False
    # « actions correctives ou préventives » + the recurrence a preventive action
    # normally carries ("revue trimestrielle des habilitations").
    action_type: str = "corrective"
    recurrence: str | None = None
    # Set when the action came from an audit finding rather than a compliance gap.
    finding_id: str | None = None
    recommendation_id: str | None = None
    # owner
    owner_id: str | None
    owner_name: str | None
    # Machine translation of control_title / framework_name for display.
    translated: bool = False
    original_control_title: str | None = None
    original_framework_name: str | None = None
    model_config = {"from_attributes": True}


class ActionPlanUpdateBody(BaseModel):
    status: str | None = None          # open / in_progress / completed / cancelled
    title: str | None = None
    description: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    owner_id: str | None = None
    notes: str | None = None
    priority: str | None = None
    action_type: str | None = None
    recurrence: str | None = None


class ActionPlanCreateBody(BaseModel):
    """Body of POST /action-plan.

    « Permet de PLANIFIER les actions correctives ou préventives »: until now an
    action could only come into existence as the by-product of an AI-detected gap,
    so a préventive action — the half of the requirement with no gap behind it at
    all — could not be planned anywhere in the product.
    """
    title: str
    description: str | None = None
    assessment_id: str | None = None
    gap_id: str | None = None
    owner_id: str | None = None
    start_date: str | None = None
    due_date: str | None = None
    priority: str = "medium"
    status: str = "open"
    action_type: str = "corrective"
    recurrence: str | None = None
    notes: str | None = None
    # An action answering an audit recommendation / finding (R2 6.1). Given a
    # recommendation, the finding is taken from it.
    recommendation_id: str | None = None
    finding_id: str | None = None


class ActionItemAttachmentResponse(BaseModel):
    id: str
    action_item_id: str
    name: str
    description: str | None = None
    file_name: str | None = None
    file_size_bytes: int | None = None
    content_type: str | None = None
    uploaded_by_id: str | None = None
    is_visible_to_auditor: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


def _validate_action_fields(action_type: str | None, recurrence: str | None, priority: str | None,
                            item_status: str | None) -> None:
    """Shared validation for the three action-plan write paths."""
    if action_type is not None and action_type not in ACTION_TYPES:
        raise HTTPException(status_code=422, detail=f"action_type must be one of {list(ACTION_TYPES)}")
    if recurrence not in (None, "") and recurrence not in ACTION_RECURRENCES:
        raise HTTPException(status_code=422, detail=f"recurrence must be one of {list(ACTION_RECURRENCES)}")
    if priority is not None:
        try:
            ActionItemPriority(priority)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid priority: {priority}")
    if item_status is not None:
        try:
            ActionItemStatus(item_status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {item_status}")


def _status_pair_for_key(
    scale: ComplianceScale | None, key: str | None, fallback: ControlStatus,
) -> tuple[ControlStatus, str | None]:
    """(legacy enum, grid key) for a level key, falling back to the legacy enum when
    the assessment is not graded on a grid at all."""
    level = _level_by_key(scale, key)
    if level is None:
        return fallback, _status_key_for(scale, fallback)
    legacy = level.get("legacy_status")
    try:
        return (ControlStatus(legacy) if legacy else fallback), level.get("key")
    except ValueError:
        return fallback, level.get("key")


async def _assert_may_move_action(db: AsyncSession, current_user: User, item: ActionItem) -> None:
    """Who may edit — and therefore CLOSE — one action.

    POST and DELETE on this resource are require_roles(CISO); PATCH was left on
    get_current_user alone, which was harmless while the plan was a detached
    to-do list. Completing an action now resolves the non-conformité and promotes
    the requirement to the grid's compliant level (see ``_apply_action_closure``),
    so any account of the tenant — an auditor, a vendor manager — could move the
    bank's conformity number. The tender still wants « le responsable clôture son
    action », so the OWNER keeps the right to move their own: owner-or-CISO, not
    CISO alone.

    Effective roles rather than the scalar column, so a CISO granted through a
    Group is honoured and one carved out via excluded_roles is not — the rule
    require_roles applies everywhere else.
    """
    if getattr(current_user, "role", None) in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
        return
    if item.owner_id and item.owner_id == current_user.id:
        return
    from app.services.authz import get_effective_roles
    if UserRole.CISO.value in await get_effective_roles(current_user, db):
        return
    raise HTTPException(
        status_code=403,
        detail="Only the action's owner or a CISO can update this action.",
    )


async def _apply_action_closure(
    db: AsyncSession, item: ActionItem, previous_status, lang: str, tenant_id: str,
) -> tuple[bool, bool]:
    """Write an action's completion back into the compliance record.

    « Visant à ATTEINDRE la conformité » — the closure loop. The action plan was a
    detached to-do list: ticking an action done moved no gap, no score and no KPI,
    and the only thing in the whole platform that could clear a ComplianceGap was
    re-running the AI analysis, which deleted the plan. Completing the LAST
    outstanding action on a non-conformity now resolves it and promotes the
    requirement to the grid's compliant level; re-opening that action reverses
    both. Nothing happens automatically — a user explicitly moved the action.

    Returns ``(gap_resolved, gap_reopened)``. Writes into the caller's session.
    """
    if not item.gap_id:
        return False, False
    gap = (await db.execute(
        select(ComplianceGap).where(ComplianceGap.id == item.gap_id)
    )).scalar_one_or_none()
    if gap is None:
        return False, False
    assessment = (await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == gap.assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if assessment is None:
        return False, False

    scale = await _load_scale(db, assessment)
    ca = (await db.execute(
        select(ControlAssessment).where(
            ControlAssessment.assessment_id == gap.assessment_id,
            ControlAssessment.control_id == gap.control_id,
        )
    )).scalar_one_or_none()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _append_note(text: str) -> None:
        if ca is None:
            return
        ca.implementation_notes = f"{ca.implementation_notes}\n{text}" if ca.implementation_notes else text

    resolved = reopened = False

    # Only a TRANSITION into "completed" closes anything. Firing on the status as
    # it stands would mean that editing the notes of an action finished months ago
    # silently re-resolves its non-conformity and re-marks the requirement
    # conforme — including one a human had deliberately re-opened since.
    if previous_status != ActionItemStatus.COMPLETED and item.status == ActionItemStatus.COMPLETED:
        outstanding = [
            sibling for sibling in (await db.execute(
                select(ActionItem).where(ActionItem.gap_id == gap.id)
            )).scalars().all()
            if sibling.status not in (ActionItemStatus.COMPLETED, ActionItemStatus.CANCELLED)
        ]
        # A non-conformity with two remediation actions is closed by the second
        # one, not the first.
        if not outstanding and not gap.is_resolved:
            gap.is_resolved = True
            resolved = True
            if ca is not None and _is_gap_level(scale, ca.status, ca.status_key):
                ca.status, ca.status_key = _status_pair_for_key(
                    scale, _closure_level_key(scale), ControlStatus.IMPLEMENTED)
                # Completing the remediation is a person's act: an AI re-run must
                # not undo the closure.
                ca.status_source = compliance_merge.HUMAN
                _append_note(_t(lang, "closed_by_action", date=today, title=item.title))
    elif previous_status == ActionItemStatus.COMPLETED and item.status in (
        ActionItemStatus.OPEN, ActionItemStatus.IN_PROGRESS,
    ):
        if gap.is_resolved:
            gap.is_resolved = False
            reopened = True
            if ca is not None and not _is_gap_level(scale, ca.status, ca.status_key):
                # Back to « partiellement conforme » rather than to whatever the
                # level was before closure: that earlier value is recorded nowhere,
                # and claiming full non-conformity would be as wrong as leaving the
                # requirement marked compliant.
                ca.status, ca.status_key = _status_pair_for_key(
                    scale, _regression_level_key(scale), ControlStatus.PARTIALLY_IMPLEMENTED)
                ca.status_source = compliance_merge.HUMAN
                _append_note(_t(lang, "reopened_by_action", date=today, title=item.title))

    if resolved or reopened:
        all_cas = list((await db.execute(
            select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
        )).scalars().all())
        _rescore(assessment, all_cas, scale)
    return resolved, reopened


@router.get("/action-plan", response_model=list[ActionPlanItem])
async def list_action_plan(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    assessment_id: str | None = None,
    # Annotated rather than `= Query(...)`: update_action_plan_item and
    # create_action_plan_item call this function DIRECTLY to build their single-item
    # response, and a bare `Query()` default would arrive as the sentinel object
    # instead of None — which the validation below would then reject with a 422.
    action_type: Annotated[
        str | None, Query(description="Filter on the nature of the action: corrective | preventive")
    ] = None,
    item_status: Annotated[
        str | None, Query(alias="status", description="Filter on open | in_progress | completed | cancelled")
    ] = None,
    # Annotated for the same reason as above: a direct call (the PATCH/POST
    # responses) gets "" — stored text — rather than a Depends sentinel.
    lang: Annotated[str, Depends(get_display_language)] = "",
):
    """Return action items for the tenant (or a single assessment if assessment_id given).

    Auto-creates ActionItem rows for any OPEN ComplianceGap that doesn't have one
    yet, so every non-conformity is immediately visible without a manual 'accept'
    step. The generation itself now lives in ``sync_action_items`` so the same
    thing happens the moment a control is evaluated and at the end of an AI
    analysis, rather than only when somebody opens this screen.
    """
    if await sync_action_items(db, tenant_id):
        # sync_action_items writes into this session and leaves the commit to us —
        # an isolated session cannot write while this one holds SQLite's write lock.
        await db.commit()

    _validate_action_fields(action_type, None, None, item_status)

    # ── Fetch all items (including newly created ones) ───────────────────────────
    item_filter = [ActionItem.tenant_id == tenant_id]
    if assessment_id:
        item_filter.append(ActionItem.assessment_id == assessment_id)
    if action_type:
        item_filter.append(ActionItem.action_type == action_type)
    if item_status:
        item_filter.append(ActionItem.status == ActionItemStatus(item_status))
    rows = (await db.execute(
        select(ActionItem)
        .where(*item_filter)
        .order_by(ActionItem.status, ActionItem.priority, ActionItem.due_date)
    )).scalars().all()

    # Pre-fetch assessments, gaps, framework controls and users in bulk
    assessment_ids = {r.assessment_id for r in rows if r.assessment_id}
    gap_ids        = {r.gap_id for r in rows if r.gap_id}
    owner_ids      = {r.owner_id for r in rows if r.owner_id}

    assessments: dict = {}
    if assessment_ids:
        res = await db.execute(
            select(ComplianceAssessment).where(ComplianceAssessment.id.in_(assessment_ids))
        )
        assessments = {a.id: a for a in res.scalars().all()}

    gaps: dict = {}
    if gap_ids:
        res = await db.execute(
            select(ComplianceGap).where(ComplianceGap.id.in_(gap_ids))
        )
        gaps = {g.id: g for g in res.scalars().all()}

    # Fetch framework controls for those gaps
    control_ids = {g.control_id for g in gaps.values() if g.control_id}
    controls: dict = {}
    if control_ids:
        res = await db.execute(
            select(FrameworkControl).where(FrameworkControl.id.in_(control_ids))
        )
        controls = {c.id: c for c in res.scalars().all()}

    # Fetch framework names
    framework_ids = {a.framework_id for a in assessments.values() if a.framework_id}
    frameworks: dict = {}
    if framework_ids:
        res = await db.execute(
            select(Framework).where(Framework.id.in_(framework_ids))
        )
        frameworks = {f.id: f for f in res.scalars().all()}

    # Fetch owners
    from app.models.user import User as UserModel
    owners: dict = {}
    if owner_ids:
        res = await db.execute(
            select(UserModel).where(UserModel.id.in_(owner_ids))
        )
        owners = {u.id: u for u in res.scalars().all()}

    items = []
    for r in rows:
        a   = assessments.get(r.assessment_id or "")
        g   = gaps.get(r.gap_id or "")
        fw  = frameworks.get(a.framework_id if a else "")
        fc  = controls.get(g.control_id if g else "")
        own = owners.get(r.owner_id or "")
        items.append(ActionPlanItem(
            id=r.id,
            title=r.title,
            description=r.description,
            priority=r.priority.value if r.priority else "medium",
            status=r.status.value if r.status else "open",
            start_date=r.start_date,
            due_date=r.due_date,
            notes=r.notes,
            ai_generated=r.ai_generated,
            assessment_id=r.assessment_id,
            assessment_name=a.name if a else None,
            framework_name=fw.name if fw else None,
            framework_short_name=fw.short_name if fw else None,
            gap_id=r.gap_id,
            control_identifier=fc.control_id if fc else None,
            control_title=fc.title if fc else None,
            gap_severity=g.severity if g else None,
            is_certification_blocker=g.is_certification_blocker if g else False,
            gap_resolved=bool(g.is_resolved) if g else False,
            action_type=r.action_type or "corrective",
            recurrence=r.recurrence,
            finding_id=r.finding_id,
            recommendation_id=getattr(r, "recommendation_id", None),
            owner_id=r.owner_id,
            owner_name=f"{own.first_name} {own.last_name}".strip() if own else None,
        ))
    await localize_fields(db, lang, [
        (it, {"control_title": it.control_title or "", "framework_name": it.framework_name or ""})
        for it in items])
    return items


@router.patch("/action-plan/{item_id}", response_model=ActionPlanItem)
async def update_action_plan_item(
    item_id: str,
    body: ActionPlanUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Plan and track one action: owner, dates, priority, nature — and its closure.

    Completing an action linked to a non-conformity now writes back into the
    compliance record (see ``_apply_action_closure``): before this, ticking an
    action done moved no gap, no score and no KPI anywhere in the platform.
    """
    item = (await db.execute(
        select(ActionItem).where(
            ActionItem.id == item_id,
            ActionItem.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Action item not found")
    await _assert_may_move_action(db, current_user, item)

    _validate_action_fields(body.action_type, body.recurrence, body.priority, body.status)

    previous_status = item.status
    if body.status is not None:
        item.status = ActionItemStatus(body.status)
    if body.priority is not None:
        item.priority = ActionItemPriority(body.priority)
    if body.title is not None:
        item.title = body.title
    if body.description is not None:
        item.description = body.description
    if body.start_date is not None:
        item.start_date = body.start_date or None
    if body.due_date is not None:
        item.due_date = body.due_date or None
    if body.notes is not None:
        item.notes = body.notes
    if body.action_type is not None:
        item.action_type = body.action_type
    if body.recurrence is not None:
        item.recurrence = body.recurrence or None
    if body.owner_id is not None:
        await assert_user_in_tenant(db, body.owner_id or None, tenant_id, field_name="owner_id")
        item.owner_id = body.owner_id or None

    resolved, reopened = await _apply_action_closure(db, item, previous_status, lang, tenant_id)

    await db.commit()
    await db.refresh(item)

    if resolved or reopened:
        # The compliance state moved without anyone editing the assessment, so the
        # trail has to say which action moved it.
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="resolve" if resolved else "reopen",
            entity_type="compliance_gap", entity_id=item.gap_id, entity_name=item.title,
            details={"action_item_id": item.id, "assessment_id": item.assessment_id},
        ))

    # Re-use list endpoint logic for single item response
    items = await list_action_plan(db=db, _=current_user, tenant_id=tenant_id)
    for i in items:
        if i.id == item_id:
            return i
    raise HTTPException(500, "Failed to return updated item")


@router.post("/action-plan", response_model=ActionPlanItem, status_code=status.HTTP_201_CREATED)
async def create_action_plan_item(
    body: ActionPlanCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Plan a corrective or PREVENTIVE action by hand.

    « Permet de planifier les actions correctives OU PRÉVENTIVES ». Every action in
    the platform used to be a by-product of an AI-detected gap, so anything that
    was not one — a preventive control, an action raised in a steering committee,
    a commitment made to a regulator — could not be planned at all.
    """
    _validate_action_fields(body.action_type, body.recurrence, body.priority, body.status)
    if not (body.title or "").strip():
        raise HTTPException(status_code=422, detail="title is required")

    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")

    assessment_id = body.assessment_id
    gap: ComplianceGap | None = None
    if body.gap_id:
        row = (await db.execute(
            select(ComplianceGap, ComplianceAssessment)
            .join(ComplianceAssessment, ComplianceGap.assessment_id == ComplianceAssessment.id)
            .where(
                ComplianceGap.id == body.gap_id,
                ComplianceAssessment.tenant_id == tenant_id,
            )
        )).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Gap not found")
        gap, gap_assessment = row
        # The gap decides the assessment: an action cannot address a non-conformity
        # of one assessment while being filed under another.
        assessment_id = gap_assessment.id
    elif assessment_id:
        owning = (await db.execute(
            select(ComplianceAssessment).where(
                ComplianceAssessment.id == assessment_id,
                ComplianceAssessment.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if owning is None:
            raise HTTPException(status_code=404, detail="Assessment not found")

    # An action raised for an audit recommendation / finding. The finding is what
    # the finding roll-up and the audit report's « plan d'action » read; it was
    # never written, so both stayed empty (R2 6.1).
    finding_id = body.finding_id or None
    recommendation_id = body.recommendation_id or None
    if recommendation_id:
        from app.models.audit_recommendation import AuditRecommendation
        rec = (await db.execute(select(AuditRecommendation).where(
            AuditRecommendation.id == recommendation_id,
            AuditRecommendation.tenant_id == tenant_id))).scalar_one_or_none()
        if rec is None:
            raise HTTPException(status_code=404, detail="Recommendation not found")
        if finding_id and rec.finding_id and finding_id != rec.finding_id:
            raise HTTPException(status_code=422, detail="finding_id does not match the recommendation's finding")
        finding_id = finding_id or rec.finding_id
    if finding_id:
        from app.models.audit import Audit, AuditFinding
        owned = (await db.execute(
            select(AuditFinding.id).join(Audit, Audit.id == AuditFinding.audit_id)
            .where(AuditFinding.id == finding_id, Audit.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if owned is None:
            raise HTTPException(status_code=404, detail="Finding not found")

    item = ActionItem(
        tenant_id=tenant_id,
        assessment_id=assessment_id,
        gap_id=gap.id if gap else None,
        finding_id=finding_id,
        recommendation_id=recommendation_id,
        title=body.title.strip(),
        description=body.description,
        owner_id=body.owner_id or current_user.id,  # tenant-checked above
        start_date=body.start_date or None,
        due_date=body.due_date or None,
        priority=ActionItemPriority(body.priority),
        status=ActionItemStatus(body.status),
        # Not AI-generated: this one was planned by a human, and the board shows
        # the difference.
        ai_generated=False,
        notes=body.notes,
        action_type=body.action_type,
        recurrence=body.recurrence or None,
    )
    db.add(item)
    await db.flush()
    if gap is not None and not gap.action_item_id:
        gap.action_item_id = item.id
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    items = await list_action_plan(db=db, _=current_user, tenant_id=tenant_id)
    for candidate in items:
        if candidate.id == item.id:
            return candidate
    raise HTTPException(500, "Failed to return the created item")


@router.delete("/action-plan/{item_id}", status_code=204)
async def delete_action_plan_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Remove an action from the plan.

    An action raised automatically for a still-open gap comes straight back on the
    next sync — that is the point of « génération automatique ». Cancel it instead
    (PATCH status=cancelled) when the intent is "we are not doing this".
    """
    item = (await db.execute(
        select(ActionItem).where(ActionItem.id == item_id, ActionItem.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Action item not found")

    # Detach the gap's back-reference before the row goes away, otherwise the gap
    # card and the traceability matrix keep pointing at a deleted action.
    if item.gap_id:
        gap = (await db.execute(
            select(ComplianceGap).where(ComplianceGap.id == item.gap_id)
        )).scalar_one_or_none()
        if gap is not None and gap.action_item_id == item.id:
            gap.action_item_id = None

    # Proof attached to the action is retired, never unlinked: the bytes stay on
    # disk and remain retrievable through the file-version endpoints, exactly like
    # deleted evidence.
    attachments = await _attachment_rows(db, select(ActionItemAttachment).where(
        ActionItemAttachment.action_item_id == item.id,
        ActionItemAttachment.tenant_id == tenant_id,
    ))
    for attachment in attachments:
        await file_integrity.retire_versions(
            db, entity_type=_ACTION_ATTACHMENT, entity_id=attachment.id,
            note=f"Action item deleted by {current_user.email}",
        )
        await db.delete(attachment)

    await db.delete(item)
    await db.commit()


# ── Action-plan attachments (« pièces justificatives ») ───────────────────────
# Objectif 3 lists « pièces justificatives » beside owner and dates as part of
# what an action carries. Evidence could be attached to a control assessment but
# never to an action, so the proof that a corrective action was actually carried
# out had nowhere to live. Storage mirrors Evidence exactly, which is what lets
# services/file_integrity.py version and checksum it and services/file_retention.py
# purge superseded copies without a line of new plumbing.

#: Same set control evidence accepts, plus screenshots — the most common proof
#: that an action was performed (a console showing MFA enforced, a ticket closed).
_ATTACHMENT_MIME_CHECKS = (
    ("pdf", "application/pdf"),
    ("spreadsheetml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("ms-excel", "application/vnd.ms-excel"),
    ("png", "image/png"),
    ("jpeg", "image/jpeg"),
)
_ATTACHMENT_SUFFIXES = (".pdf", ".docx", ".xlsx", ".xls", ".txt", ".png", ".jpg", ".jpeg")


async def _load_action_item(db: AsyncSession, item_id: str, tenant_id: str) -> ActionItem:
    item = (await db.execute(
        select(ActionItem).where(ActionItem.id == item_id, ActionItem.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Action item not found")
    return item


async def _attachment_rows(db: AsyncSession, stmt) -> list[ActionItemAttachment]:
    """Attachment rows, tolerating a database where action_item_attachments does
    not exist yet.

    The table is new and create_all() only runs at the next restart, so until then
    every query against it raises — including the one delete_action_plan_item
    makes, which turned a route that worked before this feature into a 500. A
    missing table means there is no proof attached, which is exactly true.
    """
    try:
        return list((await db.execute(stmt)).scalars().all())
    except (OperationalError, ProgrammingError):
        logger.debug("compliance.action_attachments.unavailable")
        return []


@router.post(
    "/action-plan/{item_id}/attachments",
    response_model=ActionItemAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_action_attachment(
    item_id: str,
    file: UploadFile = File(...),
    description: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> ActionItemAttachmentResponse:
    """Attach proof that an action was carried out."""
    # Reject filenames whose extension must never reach the uploads volume —
    # see security_utils.DANGEROUS_UPLOAD_EXTENSIONS (it checks EVERY suffix).
    assert_safe_upload_name(file.filename, field_name="file")
    item = await _load_action_item(db, item_id, tenant_id)

    content_type = file.content_type or ""
    name_lower = (file.filename or "").lower()
    declared = content_type.lower()
    is_allowed = (
        any(token in declared for token in ("pdf", "docx", "word", "spreadsheetml", "ms-excel", "text/plain"))
        or declared.startswith("image/png")
        or declared.startswith("image/jpeg")
        or name_lower.endswith(_ATTACHMENT_SUFFIXES)
    )
    if not is_allowed:
        raise HTTPException(
            status_code=422,
            detail="Only PDF, DOCX, XLSX, XLS, TXT, PNG and JPEG files are supported",
        )

    file_bytes = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")

    # Magic-byte check for every type we can actually verify: a declared PDF whose
    # bytes are something else must not be filed as proof of remediation.
    for token, mime in _ATTACHMENT_MIME_CHECKS:
        if token in declared and not verify_file_signature(file_bytes, mime):
            raise HTTPException(415, f"File contents do not match the declared {mime} type.")

    safe_name = _sanitize_filename(file.filename or "attachment.bin")
    rel_path = f"{tenant_id}/action-plan/{uuid.uuid4().hex}_{safe_name}"
    full_path = Path(settings.UPLOADS_DIR) / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(file_bytes)

    attachment = ActionItemAttachment(
        tenant_id=tenant_id,
        action_item_id=item.id,
        name=file.filename or safe_name,
        description=description,
        file_name=file.filename or safe_name,
        file_path=rel_path,
        file_size_bytes=len(file_bytes),
        file_sha256=file_integrity.sha256_bytes(file_bytes),
        content_type=content_type,
        uploaded_by_id=current_user.id,
        is_visible_to_auditor=True,
    )
    db.add(attachment)
    try:
        await db.flush()
    except (OperationalError, ProgrammingError):
        # Same missing-table story as _attachment_rows, but a write cannot degrade
        # to "there is no proof": name the operator step instead of 500ing.
        await db.rollback()
        raise HTTPException(
            status_code=424,
            detail="Action-plan attachments are not available until the server has been "
                   "restarted once (action_item_attachments is created at startup).",
        )
    await file_integrity.record_version(
        db, tenant_id=tenant_id, entity_type=_ACTION_ATTACHMENT,
        entity_id=attachment.id, parent_type="action_item", parent_id=item.id,
        file_path=rel_path, file_name=attachment.file_name,
        file_sha256=attachment.file_sha256, file_size_bytes=len(file_bytes),
        content_type=content_type, uploaded_by_id=current_user.id,
    )
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    # created_at is a server default, so it is only populated once the row is read
    # back; in async that has to be an explicit refresh, never an attribute access.
    await db.refresh(attachment)
    return ActionItemAttachmentResponse.model_validate(attachment)


@router.get("/action-plan/{item_id}/attachments", response_model=list[ActionItemAttachmentResponse])
async def list_action_attachments(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
) -> list[ActionItemAttachmentResponse]:
    """Proof attached to one action."""
    await _load_action_item(db, item_id, tenant_id)
    stmt = (
        select(ActionItemAttachment)
        .where(
            ActionItemAttachment.action_item_id == item_id,
            ActionItemAttachment.tenant_id == tenant_id,
        )
        .order_by(ActionItemAttachment.created_at.desc())
    )
    # is_visible_to_auditor was written on every upload and read nowhere, so an
    # auditor — including an external firm's account (users.is_external) — was
    # handed every proof file whatever the flag said. The auditor portal has
    # always honoured it on evidence and on checklist documents; proof that a
    # corrective action was carried out is no different.
    if current_user.role == UserRole.AUDITOR:
        stmt = stmt.where(ActionItemAttachment.is_visible_to_auditor == True)  # noqa: E712
    rows = await _attachment_rows(db, stmt)
    return [ActionItemAttachmentResponse.model_validate(row) for row in rows]


@router.patch(
    "/action-plan/attachments/{attachment_id}/visibility",
    response_model=ActionItemAttachmentResponse,
)
async def toggle_action_attachment_visibility(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> ActionItemAttachmentResponse:
    """Hide a piece of proof from auditors, or show it again.

    Evidence and checklist documents both have this switch. Action-plan proof did
    not, so its is_visible_to_auditor flag had no writer at all and stayed True on
    every row — which is what made the filter above unusable rather than merely
    unused.
    """
    rows = await _attachment_rows(db, select(ActionItemAttachment).where(
        ActionItemAttachment.id == attachment_id,
        ActionItemAttachment.tenant_id == tenant_id,
    ))
    if not rows:
        raise HTTPException(404, "Attachment not found")
    attachment = rows[0]
    attachment.is_visible_to_auditor = not bool(attachment.is_visible_to_auditor)
    await db.commit()
    await db.refresh(attachment)
    return ActionItemAttachmentResponse.model_validate(attachment)


@router.get("/action-plan/attachments/{attachment_id}/download")
async def download_action_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    acknowledge_integrity_failure: bool = Query(
        False,
        description="CISO override: serve a file whose checksum no longer matches, "
                    "so a damaged or altered file can still be investigated.",
    ),
):
    """Download a piece of proof, refusing bytes that no longer match their checksum."""
    from fastapi.responses import FileResponse
    from pathlib import Path as _Path

    rows = await _attachment_rows(db, select(ActionItemAttachment).where(
        ActionItemAttachment.id == attachment_id,
        ActionItemAttachment.tenant_id == tenant_id,
    ))
    attachment = rows[0] if rows else None
    if not attachment or not attachment.file_path:
        raise HTTPException(status_code=404, detail="File not found")
    # Same rule as the listing, and deliberately the same 404: a hidden piece of
    # proof must not be reachable by guessing its id either.
    if current_user.role == UserRole.AUDITOR and not attachment.is_visible_to_auditor:
        raise HTTPException(status_code=404, detail="File not found")
    full = _Path(settings.UPLOADS_DIR) / attachment.file_path
    if not full.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    status_, actual = await asyncio.to_thread(
        file_integrity.verify_file, full, attachment.file_sha256
    )
    return await _integrity_response(
        FileResponse, full, attachment.file_name or "attachment", attachment.content_type,
        attachment.file_sha256, status_, actual, acknowledge_integrity_failure,
        current_user, tenant_id, label=f"action attachment {attachment.id}", db=db,
    )


@router.delete("/action-plan/attachments/{attachment_id}", status_code=204)
async def delete_action_attachment(
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Detach a piece of proof. The bytes are retired, not destroyed."""
    rows = await _attachment_rows(db, select(ActionItemAttachment).where(
        ActionItemAttachment.id == attachment_id,
        ActionItemAttachment.tenant_id == tenant_id,
    ))
    attachment = rows[0] if rows else None
    if not attachment:
        raise HTTPException(404, "Attachment not found")
    if attachment.file_path:
        await file_integrity.retire_versions(
            db, entity_type=_ACTION_ATTACHMENT, entity_id=attachment.id,
            note=f"Attachment deleted by {current_user.email}",
        )
    await db.delete(attachment)
    await db.commit()


@router.delete("/share-links/{link_id}", status_code=204)
async def revoke_share_link(
    link_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Revoke (delete) a share link. Same gate as minting one."""
    tok = (await db.execute(
        select(EvidenceUploadToken).where(
            EvidenceUploadToken.id == link_id,
            EvidenceUploadToken.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not tok:
        raise HTTPException(404, "Share link not found")
    await db.delete(tok)
    await db.commit()


# ─── Stored-file download guard ───────────────────────────────────────────────

async def _integrity_response(
    response_cls, full, filename, content_type, recorded_sha, status_, actual,
    acknowledged: bool, current_user, tenant_id: str, label: str, db=None,
):
    """Serve a stored file, refusing it when its checksum no longer matches.

    A file that fails verification is blocked by default: evidence that has
    changed since upload must not be handed over as if it were intact. But an
    outright block leaves nobody able to even look at a damaged file, and
    "investigate what happened" is the normal response to a corrupt artefact —
    so a CISO can pass ``acknowledge_integrity_failure=true`` to retrieve it
    anyway. The override is logged, and the response says plainly that the
    bytes are not the ones that were uploaded.
    """
    if status_ == file_integrity.MODIFIED:
        # Effective roles, not the scalar column: a CISO granted through a Group
        # must be able to override, and one carved out via excluded_roles must
        # not — these download routes have no require_roles() of their own, so
        # reading `role` directly would honour neither.
        may_override = False
        if current_user is not None:
            if getattr(current_user, "role", None) in (UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN):
                may_override = True
            elif db is not None:
                from app.services.authz import get_effective_roles
                may_override = UserRole.CISO.value in await get_effective_roles(current_user, db)
        if not (acknowledged and may_override):
            logger.error(
                "file.integrity.failed %s tenant=%s expected=%s actual=%s",
                label, tenant_id, recorded_sha, actual,
            )
            detail = (
                "This file no longer matches the checksum recorded when it was "
                "uploaded and may have been altered."
            )
            if may_override:
                detail += (" A CISO can retrieve it for investigation with "
                           "?acknowledge_integrity_failure=true.")
            else:
                detail += " Contact your administrator."
            raise HTTPException(status_code=409, detail=detail)
        logger.warning(
            "file.integrity.override %s tenant=%s by=%s expected=%s actual=%s",
            label, tenant_id, current_user.id, recorded_sha, actual,
        )

    response = response_cls(
        path=str(full),
        filename=filename,
        media_type=content_type or "application/octet-stream",
    )
    response.headers["X-Content-Integrity"] = status_
    if recorded_sha:
        response.headers["X-Content-SHA256"] = recorded_sha
    if actual and status_ == file_integrity.MODIFIED:
        response.headers["X-Content-SHA256-Actual"] = actual
    return response


# ─── Stored-file integrity report ─────────────────────────────────────────────
# Companion to GET /activity-log/verify: that endpoint proves the audit trail
# was not rewritten, this one proves the files it points at were not swapped.
# Together they answer "non-altération des données à toutes les étapes du
# traitement" — the record of what happened, and the artefacts themselves.

class FileIntegrityItem(BaseModel):
    kind: str            # evidence | document | contract
    id: str
    name: str | None
    status: str          # ok | modified | missing | unrecorded
    recorded_sha256: str | None
    actual_sha256: str | None


class FileIntegrityReport(BaseModel):
    checked: int
    ok: int
    modified: int
    missing: int
    unrecorded: int
    unreadable: int
    # True when a table hit `limit` and some files were NOT examined. Without
    # this an auditor reading "modified: 0" would take it as a clean estate
    # when it only ever describes the rows that fit under the cap.
    truncated: bool
    problems: list[FileIntegrityItem]
    verified_at: str


@router.get("/evidence/integrity-report", response_model=FileIntegrityReport)
async def evidence_integrity_report(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO, UserRole.AUDITOR, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
    limit: int = Query(2000, ge=1, le=20000),
):
    """Re-hash every stored file for this tenant and report any that changed.

    Covers evidence, checklist documents and vendor contracts. Digests are
    streamed off the event loop, so each file is read once without being loaded
    into memory. Only failures are listed — a clean estate returns counts and an
    empty ``problems`` list, which is the answer an auditor wants to see.

    ``unrecorded`` counts files stored before checksums existed. They are
    reported separately from failures on purpose: no digest was captured at the
    time, so nothing can be asserted about them either way, and backfilling one
    now would only certify whatever happens to be on disk today.

    ``limit`` caps rows examined per table and is reflected by ``truncated`` —
    a bounded report that says so beats an unbounded one that rehashes an
    entire estate on an unauthenticated-looking GET.
    """
    from pathlib import Path as _Path
    from app.models.vendor import Vendor, VendorContract

    root = _Path(settings.UPLOADS_DIR)
    problems: list[FileIntegrityItem] = []
    counts = {file_integrity.OK: 0, file_integrity.MODIFIED: 0, file_integrity.MISSING: 0,
              file_integrity.UNRECORDED: 0, file_integrity.UNREADABLE: 0}
    checked = 0
    truncated = False
    # Problems are capped independently of `limit` so a badly damaged estate
    # returns a usable report instead of a megabyte of JSON.
    max_problems = 500

    async def _sweep(kind: str, rows, path_of, name_of, hash_of, id_of, absolute=False):
        nonlocal checked
        for row in rows:
            rel = path_of(row)
            if not rel:
                continue
            checked += 1
            target = _Path(rel) if absolute else root / rel
            status_, actual = await asyncio.to_thread(
                file_integrity.verify_file, target, hash_of(row)
            )
            counts[status_] = counts.get(status_, 0) + 1
            if status_ != file_integrity.OK and len(problems) < max_problems:
                problems.append(FileIntegrityItem(
                    kind=kind, id=id_of(row), name=name_of(row), status=status_,
                    recorded_sha256=hash_of(row), actual_sha256=actual,
                ))

    ev_rows = (await db.execute(
        select(Evidence).where(Evidence.tenant_id == tenant_id)
        .order_by(Evidence.created_at.desc()).limit(limit)
    )).scalars().all()
    truncated = truncated or len(ev_rows) >= limit
    await _sweep("evidence", ev_rows,
                 lambda r: r.file_path, lambda r: r.file_name,
                 lambda r: r.file_sha256, lambda r: r.id)

    doc_rows = (await db.execute(
        select(UploadedDocument).where(UploadedDocument.tenant_id == tenant_id)
        .order_by(UploadedDocument.created_at.desc()).limit(limit)
    )).scalars().all()
    truncated = truncated or len(doc_rows) >= limit
    await _sweep("document", doc_rows,
                 lambda r: r.file_path, lambda r: r.file_name,
                 lambda r: r.file_sha256, lambda r: r.id)

    # Contracts are stored by absolute path and scoped through their vendor.
    con_rows = (await db.execute(
        select(VendorContract).join(Vendor, VendorContract.vendor_id == Vendor.id)
        .where(Vendor.tenant_id == tenant_id)
        .order_by(VendorContract.created_at.desc()).limit(limit)
    )).scalars().all()
    truncated = truncated or len(con_rows) >= limit
    await _sweep("contract", con_rows,
                 lambda r: r.file_path, lambda r: r.file_name,
                 lambda r: r.file_sha256, lambda r: r.id, absolute=True)

    return FileIntegrityReport(
        checked=checked,
        ok=counts[file_integrity.OK],
        modified=counts[file_integrity.MODIFIED],
        missing=counts[file_integrity.MISSING],
        unrecorded=counts[file_integrity.UNRECORDED],
        unreadable=counts[file_integrity.UNREADABLE],
        truncated=truncated,
        problems=problems,
        verified_at=datetime.utcnow().isoformat(timespec="seconds"),
    )


# ─── Stored-file version history ──────────────────────────────────────────────
# Files used to be unlinked on delete, so "show me the version that was attached
# in March" and "restore the file someone deleted by mistake" were both
# unanswerable. Every upload now records a version and a delete retires it
# instead of destroying the bytes; these endpoints read that history.

class FileVersionOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    version_number: int
    file_name: str | None
    file_sha256: str | None
    file_size_bytes: int | None
    content_type: str | None
    status: str
    note: str | None
    uploaded_by_id: str | None
    created_at: str
    integrity: str

    model_config = {"from_attributes": True}


def _version_abs_path(row) -> Path:
    return Path(row.file_path) if row.is_absolute_path else Path(settings.UPLOADS_DIR) / row.file_path


@router.get("/files/{parent_type}/{parent_id}/versions", response_model=list[FileVersionOut])
async def list_file_versions(
    parent_type: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO, UserRole.AUDITOR, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Every file ever attached to one parent, newest first, with its integrity state.

    ``parent_type``/``parent_id`` is what the files hang off — a control
    assessment, an assessment, a vendor — so this answers "what was attached
    here over time", including versions that were superseded or whose record
    was deleted.
    """
    from app.models.stored_file_version import StoredFileVersion

    rows = (await db.execute(
        select(StoredFileVersion)
        .where(
            StoredFileVersion.tenant_id == tenant_id,
            StoredFileVersion.parent_type == parent_type,
            StoredFileVersion.parent_id == parent_id,
        )
        .order_by(StoredFileVersion.version_number.desc())
        .limit(500)
    )).scalars().all()

    # A file withheld from the auditors must not be listed to one: the download
    # answers 404 for them, but this listing still printed the name, the size and
    # the version id of every hidden evidence, document and action-plan proof.
    # Same rule the assessment document-log applies. NULL has always meant visible.
    if current_user.role == UserRole.AUDITOR and rows:
        hidden: set[tuple[str, str]] = set()
        by_type = {
            file_integrity.EVIDENCE: (Evidence, set()),
            file_integrity.DOCUMENT: (UploadedDocument, set()),
            _ACTION_ATTACHMENT: (ActionItemAttachment, set()),
        }
        for row in rows:
            entry = by_type.get(row.entity_type)
            if entry and row.entity_id:
                entry[1].add(row.entity_id)
        for etype, (model, ids) in by_type.items():
            if not ids:
                continue
            stmt = select(model.id).where(
                model.id.in_(ids),
                model.tenant_id == tenant_id,
                model.is_visible_to_auditor == False,  # noqa: E712
            )
            # action_item_attachments is one of the tables create_all() only
            # builds at the next restart, so this read must tolerate its absence.
            found = (await _attachment_rows(db, stmt)) if etype == _ACTION_ATTACHMENT \
                else (await db.execute(stmt)).scalars().all()
            hidden |= {(etype, i) for i in found}
        rows = [r for r in rows if (r.entity_type, r.entity_id) not in hidden]

    out: list[FileVersionOut] = []
    for row in rows:
        status_, _actual = await asyncio.to_thread(
            file_integrity.verify_file, _version_abs_path(row), row.file_sha256
        )
        out.append(FileVersionOut(
            id=row.id, entity_type=row.entity_type, entity_id=row.entity_id,
            version_number=row.version_number, file_name=row.file_name,
            file_sha256=row.file_sha256, file_size_bytes=row.file_size_bytes,
            content_type=row.content_type, status=row.status, note=row.note,
            uploaded_by_id=row.uploaded_by_id,
            created_at=row.created_at.isoformat() if row.created_at else "",
            integrity=status_,
        ))
    return out


@router.get("/files/deleted", response_model=list[FileVersionOut])
async def list_deleted_files(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
    limit: int = Query(200, ge=1, le=2000),
):
    """Files whose record was deleted but whose bytes were kept — the recovery list."""
    from app.models.stored_file_version import StoredFileVersion

    rows = (await db.execute(
        select(StoredFileVersion)
        .where(
            StoredFileVersion.tenant_id == tenant_id,
            StoredFileVersion.status == file_integrity.DELETED,
        )
        .order_by(StoredFileVersion.updated_at.desc())
        .limit(limit)
    )).scalars().all()

    out: list[FileVersionOut] = []
    for row in rows:
        status_, _actual = await asyncio.to_thread(
            file_integrity.verify_file, _version_abs_path(row), row.file_sha256
        )
        out.append(FileVersionOut(
            id=row.id, entity_type=row.entity_type, entity_id=row.entity_id,
            version_number=row.version_number, file_name=row.file_name,
            file_sha256=row.file_sha256, file_size_bytes=row.file_size_bytes,
            content_type=row.content_type, status=row.status, note=row.note,
            uploaded_by_id=row.uploaded_by_id,
            created_at=row.created_at.isoformat() if row.created_at else "",
            integrity=status_,
        ))
    return out


@router.get("/files/versions/{version_id}/download")
async def download_file_version(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO, UserRole.AUDITOR, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
    acknowledge_integrity_failure: bool = Query(
        False,
        description="CISO override: serve a file whose checksum no longer matches, "
                    "so a damaged or altered file can still be investigated.",
    ),
):
    """Download one specific stored version — including a superseded or deleted one."""
    from fastapi.responses import FileResponse as _FR
    from app.models.stored_file_version import StoredFileVersion

    row = (await db.execute(
        select(StoredFileVersion).where(
            StoredFileVersion.id == version_id,
            StoredFileVersion.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="File version not found")

    # The auditor portal hides evidence flagged is_visible_to_auditor=False;
    # fetching the same bytes by version id must not be a way around that. The
    # same is true of action-plan proof, which now carries the same flag and is
    # recorded as a stored file version like everything else — without this an
    # auditor could read a hidden attachment through
    # GET /files/action_item/{id}/versions + this download.
    if current_user.role == UserRole.AUDITOR and row.entity_type in (
        file_integrity.EVIDENCE, file_integrity.DOCUMENT, _ACTION_ATTACHMENT,
    ):
        if row.entity_type == file_integrity.EVIDENCE:
            owner = (await db.execute(
                select(Evidence).where(Evidence.id == row.entity_id)
            )).scalar_one_or_none()
        elif row.entity_type == file_integrity.DOCUMENT:
            # A checklist document is recorded as a stored file version with
            # parent_type="assessment", so an auditor holding an assessment id
            # (the auditor portal gives them one) could list its versions and
            # pull the bytes of a document hidden from them — measured: both
            # documents flagged is_visible_to_auditor=0 came back 200 here while
            # /documents/{id}/download correctly answered 404.
            doc = (await db.execute(
                select(UploadedDocument).where(
                    UploadedDocument.id == row.entity_id,
                    UploadedDocument.tenant_id == tenant_id,
                )
            )).scalar_one_or_none()
            # NULL has always meant "visible" for a document, exactly as
            # /documents/{id}/download reads it — mirror that route rather than
            # the stricter test the evidence branch below applies.
            if doc is not None and doc.is_visible_to_auditor is False:
                raise HTTPException(status_code=404, detail="File version not found")
            owner = None
        else:
            attachments = await _attachment_rows(db, select(ActionItemAttachment).where(
                ActionItemAttachment.id == row.entity_id,
                ActionItemAttachment.tenant_id == tenant_id,
            ))
            owner = attachments[0] if attachments else None
        if owner is not None and not owner.is_visible_to_auditor:
            raise HTTPException(status_code=404, detail="File version not found")

    full = _version_abs_path(row)
    status_, actual = await asyncio.to_thread(
        file_integrity.verify_file, full, row.file_sha256
    )
    if status_ in (file_integrity.MISSING, file_integrity.UNREADABLE):
        raise HTTPException(status_code=404, detail="File not available on disk")

    return await _integrity_response(
        _FR, full, row.file_name or "file", row.content_type, row.file_sha256,
        status_, actual, acknowledge_integrity_failure, current_user, tenant_id,
        label=f"version {row.version_number} of {row.entity_type} {row.entity_id}", db=db,
    )


# ─── Stored-file retention ────────────────────────────────────────────────────
# Recoverable deletes mean nothing reclaims bytes on its own. These expose the
# policy: what is holding space, what a purge WOULD remove (with a reason per
# row), and the purge itself. See app/services/file_retention.py — purging is
# off by default because it destroys real client evidence.

@router.get("/files/storage-summary")
async def file_storage_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    """How much space this tenant's stored file versions occupy, by status."""
    from app.services import file_retention
    return await file_retention.storage_summary(db, tenant_id)


@router.get("/files/retention/preview")
async def file_retention_preview(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
    limit: int = Query(200, ge=1, le=2000),
):
    """Dry run — exactly what a purge would delete, and what it would skip and why.

    Nothing is removed. This is what an operator reads before turning retention
    on at all; a skip reason naming the record that still points at a file is
    the difference between a policy someone trusts and one they disable.
    """
    from app.services import file_retention
    return await file_retention.preview(db, tenant_id=tenant_id, limit=limit)


@router.post("/files/retention/purge")
async def file_retention_purge(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Run the retention policy now for this tenant. Requires FILE_RETENTION_ENABLED."""
    from app.services import file_retention
    if not settings.FILE_RETENTION_ENABLED:
        raise HTTPException(
            status_code=409,
            detail="File retention is disabled (FILE_RETENTION_ENABLED=false). "
                   "Review GET /compliance/files/retention/preview, then enable it.",
        )
    result = await file_retention.run_file_retention(db, tenant_id=tenant_id)
    logger.info(
        "file_retention.manual_run tenant=%s by=%s purged=%s skipped=%s failed=%s",
        tenant_id, current_user.id, result.get("purged"), result.get("skipped"), result.get("failed"),
    )
    return result
