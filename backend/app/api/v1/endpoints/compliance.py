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
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.api.v1.dependencies.pagination import PaginationParams
from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.core.security_utils import verify_file_signature, assert_safe_upload_name
from app.services import file_integrity
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
from app.models.user import User, UserRole
from app.services import ai_chunking, ai_prompts, ai_provider
from app.services.ai_locale import get_request_language, normalize_language
from app.services.ai_structured import ai_structured, coerce_shape, extract_json, validate_against

router = APIRouter()

# ─── Request / Response schemas ────────────────────────────────────────────────


class AssessmentCreate(BaseModel):
    framework_id: str
    name: str
    description: str | None = None
    scope_description: str | None = None


class ControlAssessmentUpdate(BaseModel):
    status: ControlStatus | None = None
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
    notes: str | None = None
    implementation_notes: str | None = None
    not_applicable_justification: str | None = None
    ai_confidence: float | None = None
    cross_framework_coverage: list[dict] = []
    is_mandatory: bool = False
    linked_checklist_documents: list[LinkedChecklistDocument] = []

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
    created_at: datetime
    updated_at: datetime
    uploaded_documents: list[UploadedDocumentResponse] = []
    control_assessments: list[ControlAssessmentResponse] = []
    gaps: list[GapResponse] = []
    cross_framework_summary: dict = {}

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
    created_at: datetime

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

    ctrl_result = await db.execute(
        select(FrameworkControl).where(FrameworkControl.framework_id == assessment.framework_id)
    )
    controls = ctrl_result.scalars().all()
    controls_map: dict[str, FrameworkControl] = {c.id: c for c in controls}

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
            notes=ca.notes,
            implementation_notes=ca.implementation_notes,
            not_applicable_justification=ca.not_applicable_justification,
            ai_confidence=ca.ai_confidence,
            cross_framework_coverage=(
                controls_map[ca.control_id].mapped_controls
                if ca.control_id in controls_map
                else []
            ) or [],
            is_mandatory=(controls_map[ca.control_id].is_mandatory if ca.control_id in controls_map else False),
            linked_checklist_documents=linked_docs,
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
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> AssessmentDetailResponse:
    """Create a new compliance assessment. If an active assessment already exists for
    this framework, the existing one is returned instead of creating a duplicate."""
    fw_result = await db.execute(
        select(Framework).where(
            Framework.id == body.framework_id,
            (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id),  # noqa: E712
        )
    )
    if not fw_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Framework not found")

    # Return the existing active assessment rather than creating a duplicate.
    # Priority: in_progress > under_review > draft (most recent of each).
    from sqlalchemy import case as sa_case
    existing_result = await db.execute(
        select(ComplianceAssessment)
        .where(
            ComplianceAssessment.tenant_id == tenant_id,
            ComplianceAssessment.framework_id == body.framework_id,
            ComplianceAssessment.status != AssessmentStatus.ARCHIVED,
        )
        .order_by(
            sa_case(
                (ComplianceAssessment.status == AssessmentStatus.IN_PROGRESS, 0),
                (ComplianceAssessment.status == AssessmentStatus.UNDER_REVIEW, 1),
                (ComplianceAssessment.status == AssessmentStatus.COMPLETED, 2),
                else_=3,
            ),
            ComplianceAssessment.updated_at.desc(),
        )
        .limit(1)
    )
    existing = existing_result.scalar_one_or_none()
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
        in_scope_assets=[],
    )
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)
    return await _build_assessment_detail(db, assessment)


@router.get("/assessments")
async def list_assessments(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
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

    # Deduplicate: keep only the first (best) assessment per framework
    seen_fw: set[str] = set()
    deduped: list[ComplianceAssessment] = []
    for a in all_assessments:
        if a.framework_id not in seen_fw:
            seen_fw.add(a.framework_id)
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
            created_at=a.created_at,
        )
        for a in assessments
    ]

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
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
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


@router.post("/assessments/{assessment_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    assessment_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    document_type_key: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
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

            # ── Clear previous results ───────────────────────────────────────────────
            # Controls in ``missing_control_ids`` keep their previous ControlAssessment / Evidence /
            # ComplianceGap rows untouched — only controls this run actually produced a verdict for
            # (or controls whose old row no longer matches any current framework control) are
            # replaced.
            old_cas = (await db.execute(
                select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
            )).scalars().all()
            old_cas_by_control_id: dict[str, ControlAssessment] = {ca.control_id: ca for ca in old_cas}
            cas_to_replace = [ca for ca in old_cas if ca.control_id not in missing_control_ids]
            cas_to_replace_ids = [ca.id for ca in cas_to_replace]
            # Delete Evidence rows first — control_assessment_id is NOT NULL so
            # SQLAlchemy cannot null it out when the parent ControlAssessment is deleted.
            if cas_to_replace_ids:
                old_evidence = (await db.execute(
                    select(Evidence).where(Evidence.control_assessment_id.in_(cas_to_replace_ids))
                )).scalars().all()
                for ev in old_evidence:
                    # Re-running an analysis is routine, and it silently wiped
                    # every evidence row on the replaced control assessments.
                    # The bytes stay on disk either way; retiring the version
                    # is what makes them show up in the recovery list instead
                    # of becoming untraceable orphans.
                    await file_integrity.retire_versions(
                        db, entity_type=file_integrity.EVIDENCE, entity_id=ev.id,
                        note="Control assessment replaced by a re-run analysis",
                    )
                    await db.delete(ev)
                await db.flush()
            for ca in cas_to_replace:
                await db.delete(ca)
            old_gaps = (await db.execute(
                select(ComplianceGap).where(ComplianceGap.assessment_id == assessment_id)
            )).scalars().all()
            gaps_to_replace = [g for g in old_gaps if g.control_id not in missing_control_ids]
            gaps_to_replace_ids = [g.id for g in gaps_to_replace]
            # Remove stale ActionItems linked to these gaps so auto-sync recreates them
            if gaps_to_replace_ids:
                stale_items = (await db.execute(
                    select(ActionItem).where(ActionItem.gap_id.in_(gaps_to_replace_ids))
                )).scalars().all()
                for si in stale_items:
                    await db.delete(si)
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
            for key, rows in by_key.items():
                v = run.verdicts.get(key)
                for control in rows:
                    ctrl_status = _VERDICT_STATUS.get(v.verdict) if v is not None else None
                    if v is None or ctrl_status is None:
                        if control.id in old_cas_by_control_id:
                            # Kept untouched above: never overwrite a known result with a
                            # placeholder just because this run could not judge it again.
                            preserved_keys.add(key)
                            continue
                        # First-time assessment of this control: explicit "analysis_failed"
                        # outcome — no verdict, no confidence, no gap.
                        newly_not_started_keys.add(key)
                        db.add(ControlAssessment(
                            assessment_id=assessment_id,
                            control_id=control.id,
                            status=ControlStatus.NOT_STARTED,
                            ai_confidence=None,
                            implementation_notes=_t(lang, "not_analysed"),
                        ))
                        continue

                    db.add(ControlAssessment(
                        assessment_id=assessment_id,
                        control_id=control.id,
                        status=ctrl_status,
                        ai_confidence=round(max(0.0, min(1.0, float(v.confidence))), 3),
                        implementation_notes=_implementation_notes(v, lang) or None,
                        not_applicable_justification=(
                            (v.not_applicable_justification or "").strip() or None
                            if ctrl_status == ControlStatus.NOT_APPLICABLE else None
                        ),
                    ))

                    if ctrl_status in (ControlStatus.NOT_IMPLEMENTED, ControlStatus.PARTIALLY_IMPLEMENTED):
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
                        db.add(ComplianceGap(
                            assessment_id=assessment_id,
                            control_id=control.id,
                            gap_description=gap_desc,
                            severity=severity,
                            remediation_steps=remediation,
                            is_certification_blocker=is_blocker,
                            remediation_priority=_gap_priority(severity, is_blocker),
                        ))

            await db.flush()

            # Score from the final persisted state, so controls preserved above (untouched by this
            # run) still count under their real status instead of dropping out of the calculation —
            # matching how update_control_assessment recomputes the score after a manual edit.
            all_cas = (await db.execute(
                select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
            )).scalars().all()
            implemented = sum(1 for c in all_cas if c.status == ControlStatus.IMPLEMENTED)
            partial = sum(1 for c in all_cas if c.status == ControlStatus.PARTIALLY_IMPLEMENTED)
            not_applicable = sum(1 for c in all_cas if c.status == ControlStatus.NOT_APPLICABLE)
            total = len(controls)
            scoreable = total - not_applicable
            score = round((implemented + partial * 0.5) / scoreable * 100, 1) if scoreable > 0 else 0.0

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
    current_user: User = Depends(require_roles(UserRole.CISO)),
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
    _: User = Depends(require_roles(UserRole.CISO)),
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
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> AssessmentDetailResponse:
    """Get assessment results (alias for GET /assessments/{id})."""
    return await get_assessment(assessment_id, db, _, tenant_id)


@router.patch("/control-assessments/{control_assessment_id}")
async def update_control_assessment(
    control_assessment_id: str,
    body: ControlAssessmentUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> ControlAssessmentResponse:
    """Manually override a control assessment status."""
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

    if body.status is not None:
        # Block N/A on mandatory controls
        if body.status == ControlStatus.NOT_APPLICABLE and control.is_mandatory:
            raise HTTPException(
                status_code=400,
                detail=f"Control '{control.control_id}' is mandatory and cannot be marked as Not Applicable."
            )
        ca.status = body.status
    if body.notes is not None:
        ca.notes = body.notes
    if body.implementation_notes is not None:
        ca.implementation_notes = body.implementation_notes
    if body.not_applicable_justification is not None:
        ca.not_applicable_justification = body.not_applicable_justification

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    # Recalculate compliance score
    all_cas = (await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
    )).scalars().all()
    imp = sum(1 for c in all_cas if c.status == ControlStatus.IMPLEMENTED)
    par = sum(1 for c in all_cas if c.status == ControlStatus.PARTIALLY_IMPLEMENTED)
    na = sum(1 for c in all_cas if c.status == ControlStatus.NOT_APPLICABLE)
    scoreable = len(all_cas) - na
    if scoreable > 0:
        assessment.compliance_score = round((imp + par * 0.5) / scoreable * 100, 1)

    return ControlAssessmentResponse(
        id=ca.id,
        assessment_id=ca.assessment_id,
        control_id=ca.control_id,
        control_identifier=control.control_id,
        control_title=control.title,
        control_category=control.category,
        control_description=control.description,
        status=ca.status,
        notes=ca.notes,
        implementation_notes=ca.implementation_notes,
        not_applicable_justification=ca.not_applicable_justification,
        ai_confidence=ca.ai_confidence,
        cross_framework_coverage=control.mapped_controls or [],
        is_mandatory=control.is_mandatory,
    )


# ─── Document Checklist ────────────────────────────────────────────────────────


@router.get("/assessments/{assessment_id}/document-checklist")
async def get_document_checklist(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
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


class BulkRecommendationRequest(BaseModel):
    gap_ids: list[str]
    action: str  # "accept" | "reject"
    owner_id: str | None = None
    start_date: str | None = None
    due_date: str | None = None


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

    # Verify owner_id (if any) is in this tenant before assigning the action item.
    from app.core.security_utils import assert_user_in_tenant as _assert_user
    await _assert_user(db, body.owner_id, tenant_id, field_name="owner_id")

    gap.recommendation_status = body.action + "ed"  # "accepted" | "rejected"

    action_item_id = None
    if body.action == "accept":
        ctrl_result = await db.execute(
            select(FrameworkControl).where(FrameworkControl.id == gap.control_id)
        )
        ctrl = ctrl_result.scalar_one_or_none()
        ctrl_title = ctrl.title if ctrl else "Control"

        priority_map = {90: ActionItemPriority.CRITICAL, 60: ActionItemPriority.HIGH,
                        50: ActionItemPriority.MEDIUM, 30: ActionItemPriority.LOW}
        priority = priority_map.get(gap.remediation_priority, ActionItemPriority.MEDIUM)

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
    """Accept or reject multiple gap recommendations at once."""
    if body.action not in ("accept", "reject"):
        raise HTTPException(status_code=422, detail="action must be 'accept' or 'reject'")

    from app.core.security_utils import assert_user_in_tenant as _assert_user
    await _assert_user(db, body.owner_id, tenant_id, field_name="owner_id")

    result = await db.execute(
        select(ComplianceGap, ComplianceAssessment)
        .join(ComplianceAssessment, ComplianceGap.assessment_id == ComplianceAssessment.id)
        .where(
            ComplianceGap.id.in_(body.gap_ids),
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    rows = result.all()

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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> EvidenceResponse:
    """Upload evidence file for a specific control assessment."""
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
    )


@router.get("/control-assessments/{control_assessment_id}/evidence", response_model=list[EvidenceResponse])
async def list_control_evidence(
    control_assessment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all evidence files for a control assessment."""
    result = await db.execute(
        select(Evidence).where(Evidence.control_assessment_id == control_assessment_id)
        .order_by(Evidence.created_at)
    )
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
    ) for e in items]


@router.patch("/evidence/{evidence_id}/visibility", response_model=EvidenceResponse)
async def toggle_evidence_visibility(
    evidence_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Toggle whether an evidence file is visible to auditors."""
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
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete an evidence file."""
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
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Toggle whether a checklist document is visible to auditors."""
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
    _: User = Depends(get_current_user),
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

    docs = (await db.execute(
        select(UploadedDocument)
        .where(UploadedDocument.assessment_id == assessment_id)
        .order_by(UploadedDocument.created_at.desc())
    )).scalars().all()

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
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete a checklist document."""
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
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a shareable upload link for a control assessment."""
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
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all share links for a control assessment."""
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
    # owner
    owner_id: str | None
    owner_name: str | None
    model_config = {"from_attributes": True}


class ActionPlanUpdateBody(BaseModel):
    status: str | None = None          # open / in_progress / completed / cancelled
    start_date: str | None = None
    due_date: str | None = None
    owner_id: str | None = None
    notes: str | None = None
    priority: str | None = None


@router.get("/action-plan", response_model=list[ActionPlanItem])
async def list_action_plan(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    assessment_id: str | None = None,
):
    """Return action items for the tenant (or a single assessment if assessment_id given).

    Auto-creates ActionItem rows for any ComplianceGap that doesn't have one yet,
    so every gap is immediately visible without a manual 'accept' step.
    """
    # ── Auto-sync: create ActionItems for gaps that don't have one yet ──────────
    tenant_assessments = (await db.execute(
        select(ComplianceAssessment.id).where(ComplianceAssessment.tenant_id == tenant_id)
    )).scalars().all()

    if tenant_assessments:
        gap_filter = ComplianceGap.assessment_id.in_(tenant_assessments)
        all_gaps = (await db.execute(
            select(ComplianceGap).where(gap_filter)
        )).scalars().all()

        # Which gap_ids already have an ActionItem?
        covered_gap_ids: set[str] = set(
            (await db.execute(
                select(ActionItem.gap_id).where(
                    ActionItem.tenant_id == tenant_id,
                    ActionItem.gap_id.isnot(None),
                )
            )).scalars().all()
        )

        priority_map = {
            90: ActionItemPriority.CRITICAL, 60: ActionItemPriority.HIGH,
            50: ActionItemPriority.MEDIUM,   30: ActionItemPriority.LOW,
        }

        # Bulk-fetch controls for the orphaned gaps in one query
        orphan_gaps = [g for g in all_gaps if g.id not in covered_gap_ids]
        if orphan_gaps:
            orphan_ctrl_ids = {g.control_id for g in orphan_gaps if g.control_id}
            ctrl_map: dict = {}
            if orphan_ctrl_ids:
                ctrl_map = {
                    c.id: c for c in (await db.execute(
                        select(FrameworkControl).where(FrameworkControl.id.in_(orphan_ctrl_ids))
                    )).scalars().all()
                }
            for gap in orphan_gaps:
                ctrl = ctrl_map.get(gap.control_id or "")
                title = (
                    f"Remediate: {ctrl.title}" if ctrl
                    else (gap.gap_description or "")[:120]
                )
                db.add(ActionItem(
                    tenant_id=tenant_id,
                    assessment_id=gap.assessment_id,
                    gap_id=gap.id,
                    title=title,
                    description=gap.gap_description,
                    priority=priority_map.get(gap.remediation_priority or 30, ActionItemPriority.MEDIUM),
                    status=ActionItemStatus.OPEN,
                    ai_generated=True,
                ))
            await db.commit()

    # ── Fetch all items (including newly created ones) ───────────────────────────
    item_filter = [ActionItem.tenant_id == tenant_id]
    if assessment_id:
        item_filter.append(ActionItem.assessment_id == assessment_id)
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
            owner_id=r.owner_id,
            owner_name=f"{own.first_name} {own.last_name}".strip() if own else None,
        ))
    return items


@router.patch("/action-plan/{item_id}", response_model=ActionPlanItem)
async def update_action_plan_item(
    item_id: str,
    body: ActionPlanUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Update status, due date, owner, notes or priority of an action item."""
    item = (await db.execute(
        select(ActionItem).where(
            ActionItem.id == item_id,
            ActionItem.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Action item not found")

    if body.status is not None:
        try:
            item.status = ActionItemStatus(body.status)
        except ValueError:
            raise HTTPException(422, f"Invalid status: {body.status}")
    if body.priority is not None:
        try:
            item.priority = ActionItemPriority(body.priority)
        except ValueError:
            raise HTTPException(422, f"Invalid priority: {body.priority}")
    if body.start_date is not None:
        item.start_date = body.start_date or None
    if body.due_date is not None:
        item.due_date = body.due_date or None
    if body.notes is not None:
        item.notes = body.notes
    if body.owner_id is not None:
        from app.core.security_utils import assert_user_in_tenant as _assert_user
        await _assert_user(db, body.owner_id or None, tenant_id, field_name="owner_id")
        item.owner_id = body.owner_id or None

    await db.commit()
    await db.refresh(item)

    # Re-use list endpoint logic for single item response
    items = await list_action_plan(db=db, _=current_user, tenant_id=tenant_id)
    for i in items:
        if i.id == item_id:
            return i
    raise HTTPException(500, "Failed to return updated item")


@router.delete("/share-links/{link_id}", status_code=204)
async def revoke_share_link(
    link_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Revoke (delete) a share link."""
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
    _: User = Depends(require_roles(UserRole.CISO, UserRole.AUDITOR, UserRole.COMPLIANCE_MANAGER)),
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
    # fetching the same bytes by version id must not be a way around that.
    if row.entity_type == file_integrity.EVIDENCE and current_user.role == UserRole.AUDITOR:
        owner = (await db.execute(
            select(Evidence).where(Evidence.id == row.entity_id)
        )).scalar_one_or_none()
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
