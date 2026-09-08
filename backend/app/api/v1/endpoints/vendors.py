"""Third-Party Risk Management (TPRM) — Vendor endpoints.

AI call sites in this file (vendor risk analysis, background contract review, questionnaire
pre-screen) run on the shared AI foundation: expert system prompts + output schemas from
``app.services.ai_prompts``, validated structured calls from ``ai_structured`` (one repair retry,
consistency checks), chunk-and-merge from ``ai_chunking`` (no truncation), transport + untrusted-text
delimiting from ``ai_provider`` (tenant BYO-AI honoured, deterministic decoding, quota metering) and
language resolution from ``ai_locale`` (Accept-Language en|fr|ar). Only Ollama is ever called, and
only through ``ai_provider``. A failed call is surfaced explicitly — HTTP 424 on JSON routes,
``review_status="error"`` on the background review — never replaced by a default verdict.
"""
import asyncio
import calendar
import io
import logging
import re
import uuid
from collections import Counter
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path

from app.core.database import get_db
from app.core.security_utils import assert_path_within, sanitize_filename, verify_file_signature, assert_safe_upload_name
from app.core import ai_quota
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.vendor import (
    Vendor, VendorRiskTier, VendorStatus, VendorContract, ContractValidationStatus,
    VendorAssessment, VendorRisk,
)
from app.models.contract_collaboration import ContractCollaboration, ContractMessage
from app.core.config import settings
from app.services import ai_chunking, ai_prompts, ai_provider
from app.services.ai_locale import failure_message, get_request_language, guess_language
from app.services.ai_structured import AiResult, ai_structured
from app.services import file_integrity

router = APIRouter()
logger = logging.getLogger(__name__)


# ── AI foundation helpers (private to this file) ────────────────────────────

_YES_WORDS = frozenset({"yes", "oui", "نعم", "true"})
_NO_WORDS = frozenset({"no", "non", "لا", "false"})
_PARTIAL_WORDS = frozenset({"partial", "partially", "partiel", "partielle", "partiellement", "جزئي", "جزئيا", "جزئياً"})
_FIRST_WORD_RE = re.compile(r"[^\W_]+", re.U)
_SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
_RATING_WORDS = {
    "critical": "critical", "critique": "critical", "حرج": "critical", "شديد": "critical",
    "high": "high", "élevé": "high", "eleve": "high", "مرتفع": "high",
    "عالية": "high", "عالي": "high", "عالٍ": "high",
    "medium": "medium", "moyen": "medium", "متوسط": "medium",
    "low": "low", "faible": "low", "منخفض": "low",
}
_RATING_RE = re.compile(
    r"\b(critical|critique|high|élevé|eleve|medium|moyen|low|faible)\b"
    r"|(حرج|شديد|مرتفع|عالية|عالي|عالٍ|متوسط|منخفض)",
    re.I,
)
# The "Approve & Save" button in VendorAIModal.tsx reads the FIRST "Score: N/10" token in the whole
# rendered report as the overall score; vendor names are free text any VENDOR_MANAGER can set, so a
# name containing that exact token would be read ahead of the real score line (_render_vendor_report).
_FAKE_SCORE_TOKEN_RE = re.compile(r"Score:\s*\d+\s*/\s*10", re.I)
_BACKGROUND_TASKS: set = set()


def _answer_kind(answer) -> str:
    """'yes' | 'no' | 'partial' | 'na' from a free-form questionnaire answer (en/fr/ar words, bools)."""
    if isinstance(answer, bool):
        return "yes" if answer else "no"
    m = _FIRST_WORD_RE.search(" ".join(str(answer or "").split()).lower())
    word = m.group(0) if m else ""
    if word in _YES_WORDS:
        return "yes"
    if word in _NO_WORDS:
        return "no"
    if word in _PARTIAL_WORDS:
        return "partial"
    return "na"


def _bounded_responses(responses, *, max_items: int = 60, q_len: int = 300, a_len: int = 120) -> dict[str, str]:
    """One-line, control-char-free, length-capped copy of a client-supplied questionnaire.

    Question text is user-editable in the UI, so both keys and values are cleaned before they reach a
    prompt (the block is additionally delimited as untrusted). Keys stay unique; at most ``max_items``
    answers are kept so the counts shown to the model match the lines it sees.
    """
    out: dict[str, str] = {}
    for q, a in list((responses or {}).items())[:max_items]:
        key = ai_provider.clean_field(str(q), q_len) or "(blank question)"
        if key in out:
            key = "%s (%d)" % (key, len(out) + 1)
        out[key] = ai_provider.clean_field("" if a is None else str(a), a_len)
    return out


def _answer_counts(responses: dict) -> dict[str, int]:
    counts = {"total": len(responses), "yes": 0, "no": 0, "partial": 0, "na": 0}
    for a in responses.values():
        counts[_answer_kind(a)] += 1
    return counts


def _questionnaire_block(responses: dict) -> str:
    return ai_provider.delimit_untrusted(ai_prompts.qa_lines(responses), "QUESTIONNAIRE")


def _regimes_context(country: str | None) -> str:
    return "- Regulatory regimes to consider for country %s: %s" % (
        ai_provider.clean_field(country, 10) or "(not stated)", ai_prompts.regimes_for_country(country))


def _vendor_context(vendor: Vendor) -> str:
    """Platform-known facts for the system prompt's CONTEXT block (never third-party free text).

    ``system_prompt``'s CONTEXT header tells the model to "rely on [these facts] and cite them,
    never contradict them" — appropriate for facts like the DPA/contract-expiry records below, but
    NOT for the customer-assigned risk tier: the vendor_analysis rubric derives ``risk_classification``
    solely from the questionnaire evidence, so a pre-assigned tier framed as an uncontradictable fact
    would anchor the model toward it regardless of what the evidence shows. The tier/status lines are
    phrased below to make clear they describe the relationship, not a pre-judged assessment outcome.
    """
    tier = vendor.risk_tier.value if hasattr(vendor.risk_tier, "value") else str(vendor.risk_tier or "")
    vstatus = vendor.status.value if hasattr(vendor.status, "value") else str(vendor.status or "")
    lines = [
        "- Customer-assigned inherent criticality of this vendor relationship (reflects data/system "
        "access exposure at vendor onboarding) — this is NOT an assessment outcome and must NOT be used "
        "to set overall_score or risk_classification, which are derived only from the questionnaire "
        "evidence below: %s" % (tier or "not set"),
        "- Vendor record status (administrative field, not a risk finding): %s" % (vstatus or "not set"),
        "- Data processing agreement on file: %s" % ("yes" if vendor.has_data_processing_agreement else "no"),
        "- Contract expiry on record: %s" % (ai_provider.clean_field(vendor.contract_expiry, 20) or "not recorded"),
        _regimes_context(vendor.country),
    ]
    return "\n".join(lines)


def _ai_failure_detail(res: AiResult, lang: str) -> str:
    """Localised user sentence + the admin-safe cause (never a URL, key or upstream body)."""
    return "%s (%s)" % (res.user_message(lang), res.failure_detail())


def _spawn_background(coro) -> None:
    """create_task with a strong reference (a bare create_task can be garbage-collected mid-flight)."""
    task = asyncio.create_task(coro)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


_FINAL_RATING_TAIL_LINES = 3


def _final_rating(review: str | None) -> str | None:
    """'low' | 'medium' | 'high' | 'critical' stated near the end of a contract review (the
    contract_review task ends with ``OVERALL RISK: <RATING>``; FR/AR spellings accepted), else None.

    Scans the last few non-empty lines together (not only the very last one): the LANGUAGE block asks
    the model to translate headings, and in practice the heading ("OVERALL RISK ASSESSMENT" / its FR/AR
    translation) sometimes lands on its own line with the actual rating stated in prose on the next —
    the marker and the rating word need not share one line. Both singular and plural Arabic renderings
    of "risk" ("الخطر" / "المخاطر") are accepted as the marker. When several rating words appear in the
    scanned tail, the LAST one wins (closest to the true conclusion).
    """
    if not review:
        return None
    lines = [ln.strip() for ln in str(review).splitlines() if ln.strip()]
    if not lines:
        return None
    tail = " ".join(lines[-_FINAL_RATING_TAIL_LINES:])
    tail_upper = tail.upper()
    if ("OVERALL RISK" not in tail_upper and "RISQUE" not in tail_upper
            and "خطر" not in tail and "مخاطر" not in tail):
        return None
    matches = list(_RATING_RE.finditer(tail))
    if not matches:
        return None
    word = (matches[-1].group(1) or matches[-1].group(2) or "").lower()
    return _RATING_WORDS.get(word)


# ── Vendor risk report rendering (Markdown the modal renders; language-aware labels) ──

_VENDOR_DOMAIN_ORDER = ("compliance_standards", "data_protection", "access_control",
                        "incident_response", "business_continuity", "sub_processors")
_REVIEW_MONTHS = {"critical": 3, "high": 6, "medium": 12, "low": 12}

_VENDOR_REPORT_LABELS: dict[str, dict] = {
    "en": {
        "title": "Vendor Risk Assessment Report", "date": "Assessment date", "overall": "Overall risk",
        "classification": "Risk classification", "recommendation": "Recommendation",
        "confidence": "Evidence confidence", "coverage": "Questionnaire coverage",
        "coverage_fmt": "{total} answers — {yes} YES, {no} NO, {partial} PARTIAL, {na} N/A",
        "public": "Public information used", "review_date": "Next review date",
        "summary": "Executive Summary", "scoring": "Risk Scoring Overview",
        "bands": "Score bands: 1-3 LOW · 4-5 MEDIUM · 6-7 HIGH · 8-10 CRITICAL (10 = highest risk)",
        "domains": "Domain Assessment", "evidence": "Evidence", "priority": "Remediation priority",
        "findings": "Findings", "gaps": "Gaps", "key_risks": "Key Risks Identified",
        "recs": "Recommendations", "immediate": "Immediate actions (0-30 days)",
        "short_term": "Short-term actions (1-3 months)", "long_term": "Long-term actions (3-12 months)",
        "contract": "Contract & SLA Requirements", "monitoring": "Monitoring & Reassessment Plan",
        "warnings": "Analysis Warnings", "final": "Final Risk Decision",
        "none": "None identified from the evidence provided.", "yes": "yes", "no": "no",
        "footer": "Generated by GRCeye AI from the questionnaire answers{public}. Every finding cites the answer it relies on; unanswered and N/A questions are never scored as satisfactory.",
        "footer_public": " and {n} public finding(s) (unverified)",
        "band": {"low": "LOW", "medium": "MEDIUM", "high": "HIGH", "critical": "CRITICAL"},
        "domain": {"compliance_standards": "Compliance & Standards", "data_protection": "Data Protection & Encryption",
                   "access_control": "Access Controls & Authentication", "incident_response": "Incident Response & Breach Notification",
                   "business_continuity": "Business Continuity & Disaster Recovery", "sub_processors": "Third-Party & Sub-processor Management"},
        "status": {"answered": "answered", "partially_answered": "partially answered", "insufficient_evidence": "insufficient evidence"},
        "prio": {"immediate": "immediate", "30_days": "within 30 days", "90_days": "within 90 days", "monitor": "monitor", "none": "none"},
        "conf": {"high": "high", "medium": "medium", "low": "low"},
        "rec": {},
    },
    "fr": {
        "title": "Rapport d'évaluation des risques fournisseur", "date": "Date de l'évaluation", "overall": "Risque global",
        "classification": "Classification du risque", "recommendation": "Recommandation",
        "confidence": "Confiance dans les preuves", "coverage": "Couverture du questionnaire",
        "coverage_fmt": "{total} réponses — {yes} OUI, {no} NON, {partial} PARTIEL, {na} N/A",
        "public": "Informations publiques utilisées", "review_date": "Prochaine revue",
        "summary": "Synthèse", "scoring": "Vue d'ensemble des scores",
        "bands": "Bandes de score : 1-3 FAIBLE · 4-5 MOYEN · 6-7 ÉLEVÉ · 8-10 CRITIQUE (10 = risque maximal)",
        "domains": "Évaluation par domaine", "evidence": "Preuves", "priority": "Priorité de remédiation",
        "findings": "Constats", "gaps": "Écarts", "key_risks": "Principaux risques identifiés",
        "recs": "Recommandations", "immediate": "Actions immédiates (0-30 jours)",
        "short_term": "Actions à court terme (1-3 mois)", "long_term": "Actions à long terme (3-12 mois)",
        "contract": "Exigences contractuelles et SLA", "monitoring": "Plan de suivi et de réévaluation",
        "warnings": "Avertissements de l'analyse", "final": "Décision finale",
        "none": "Aucun élément identifié à partir des preuves fournies.", "yes": "oui", "no": "non",
        "footer": "Généré par l'IA GRCeye à partir des réponses au questionnaire{public}. Chaque constat cite la réponse sur laquelle il s'appuie ; les questions sans réponse ou N/A ne sont jamais notées comme satisfaisantes.",
        "footer_public": " et de {n} élément(s) public(s) (non vérifiés)",
        "band": {"low": "FAIBLE", "medium": "MOYEN", "high": "ÉLEVÉ", "critical": "CRITIQUE"},
        "domain": {"compliance_standards": "Conformité et normes", "data_protection": "Protection des données et chiffrement",
                   "access_control": "Contrôle d'accès et authentification", "incident_response": "Réponse aux incidents et notification des violations",
                   "business_continuity": "Continuité d'activité et reprise après sinistre", "sub_processors": "Gestion des tiers et sous-traitants"},
        "status": {"answered": "renseigné", "partially_answered": "partiellement renseigné", "insufficient_evidence": "preuves insuffisantes"},
        "prio": {"immediate": "immédiate", "30_days": "sous 30 jours", "90_days": "sous 90 jours", "monitor": "surveillance", "none": "aucune"},
        "conf": {"high": "élevée", "medium": "moyenne", "low": "faible"},
        "rec": {"APPROVED": "APPROVED (approuvé)", "APPROVED WITH CONDITIONS": "APPROVED WITH CONDITIONS (approuvé sous conditions)",
                "REJECTED": "REJECTED (rejeté)", "INSUFFICIENT EVIDENCE": "INSUFFICIENT EVIDENCE (preuves insuffisantes)"},
    },
    "ar": {
        "title": "تقرير تقييم مخاطر المورّد", "date": "تاريخ التقييم", "overall": "الخطر الإجمالي",
        "classification": "تصنيف الخطر", "recommendation": "التوصية",
        "confidence": "درجة الثقة في الأدلة", "coverage": "تغطية الاستبيان",
        "coverage_fmt": "{total} إجابة — {yes} نعم، {no} لا، {partial} جزئي، {na} غير منطبق",
        "public": "استُخدمت معلومات عامة", "review_date": "موعد المراجعة القادمة",
        "summary": "الملخص التنفيذي", "scoring": "نظرة عامة على الدرجات",
        "bands": "نطاقات الدرجات: 1-3 منخفض · 4-5 متوسط · 6-7 مرتفع · 8-10 حرج (10 = أعلى خطر)",
        "domains": "التقييم حسب المجال", "evidence": "الأدلة", "priority": "أولوية المعالجة",
        "findings": "النتائج", "gaps": "الفجوات", "key_risks": "المخاطر الرئيسية المحددة",
        "recs": "التوصيات", "immediate": "إجراءات فورية (0-30 يوماً)",
        "short_term": "إجراءات قصيرة المدى (1-3 أشهر)", "long_term": "إجراءات طويلة المدى (3-12 شهراً)",
        "contract": "متطلبات العقد واتفاقيات مستوى الخدمة", "monitoring": "خطة المراقبة وإعادة التقييم",
        "warnings": "تنبيهات التحليل", "final": "القرار النهائي",
        "none": "لم يُحدَّد أي عنصر استناداً إلى الأدلة المقدمة.", "yes": "نعم", "no": "لا",
        "footer": "تم إنشاؤه بواسطة الذكاء الاصطناعي في GRCeye استناداً إلى إجابات الاستبيان{public}. كل نتيجة تستشهد بالإجابة التي تعتمد عليها؛ ولا تُحتسب الأسئلة غير المُجابة أو غير المنطبقة أبداً كإجابات مُرضية.",
        "footer_public": " و{n} نتيجة عامة (غير مُتحقق منها)",
        "band": {"low": "منخفض", "medium": "متوسط", "high": "مرتفع", "critical": "حرج"},
        "domain": {"compliance_standards": "الامتثال والمعايير", "data_protection": "حماية البيانات والتشفير",
                   "access_control": "التحكم في الوصول والمصادقة", "incident_response": "الاستجابة للحوادث والإبلاغ عن الاختراقات",
                   "business_continuity": "استمرارية الأعمال والتعافي من الكوارث", "sub_processors": "إدارة الأطراف الثالثة والمعالجين من الباطن"},
        "status": {"answered": "مُجاب", "partially_answered": "مُجاب جزئياً", "insufficient_evidence": "أدلة غير كافية"},
        "prio": {"immediate": "فوري", "30_days": "خلال 30 يوماً", "90_days": "خلال 90 يوماً", "monitor": "مراقبة", "none": "لا شيء"},
        "conf": {"high": "عالية", "medium": "متوسطة", "low": "منخفضة"},
        "rec": {"APPROVED": "APPROVED (موافَق عليه)", "APPROVED WITH CONDITIONS": "APPROVED WITH CONDITIONS (موافَق عليه بشروط)",
                "REJECTED": "REJECTED (مرفوض)", "INSUFFICIENT EVIDENCE": "INSUFFICIENT EVIDENCE (أدلة غير كافية)"},
    },
}


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _md_bullets(items, empty_line: str) -> list[str]:
    lines = ["- %s" % " ".join(str(x).split()) for x in (items or ()) if str(x).strip()]
    return lines or ["- %s" % empty_line]


def _render_vendor_report(data: dict, *, vendor_name: str, today: date, lang: str,
                          counts: dict, public_count: int, extra_warnings: list[str]) -> str:
    """Render the validated ``vendor_analysis`` verdict as the Markdown report the frontend expects.

    Contract with the UI: ``safeMarkdown`` renders only ``##``/``###`` headings, ``**bold**``, ``- ``
    bullets and ``1.`` lists (no tables), and "Approve & Save" reads the FIRST ``Score: N/10`` match —
    so the overall score is the first such token, domain scores never use the ``Score:`` prefix, and
    the (free-text, customer-controlled) vendor name has any look-alike token stripped before it is
    rendered, since it appears above the real score line.
    Labels follow the UI language; enum values (recommendation) stay English with a local gloss.
    """
    L = _VENDOR_REPORT_LABELS.get(lang) or _VENDOR_REPORT_LABELS["en"]
    score = int(data.get("overall_score") or 0)
    band = str(data.get("risk_classification") or ai_prompts.vendor_band(score))
    band_label = L["band"].get(band, band.upper())
    rec = str(data.get("recommendation") or "")
    rec_label = L["rec"].get(rec, rec)
    conf = str(data.get("confidence") or "")
    review_on = _add_months(today, _REVIEW_MONTHS.get(band, 12)).isoformat()
    public_used = bool(data.get("public_information_used")) and public_count > 0
    # Vendor names are free text (any VENDOR_MANAGER can set them). The heading below is rendered
    # BEFORE the real "**Score: N/10**" line, and "Approve & Save" reads the FIRST such token in the
    # whole document — strip any look-alike token from the name so it can never be mistaken for the
    # real overall score.
    name = _FAKE_SCORE_TOKEN_RE.sub("", " ".join(str(vendor_name or "").split()))
    name = " ".join(name.split()) or "?"

    out: list[str] = [
        "# %s" % L["title"],
        "## %s" % name,
        "",
        "**%s:** %s" % (L["date"], today.isoformat()),
        "**%s** — **Score: %d/10** (%s)" % (L["overall"], score, band_label),
        "**%s:** %s" % (L["classification"], band_label),
        "**%s:** %s" % (L["recommendation"], rec_label),
        "**%s:** %s" % (L["confidence"], L["conf"].get(conf, conf)),
        "**%s:** %s" % (L["coverage"], L["coverage_fmt"].format(**counts)),
        "**%s:** %s" % (L["public"], L["yes"] if public_used else L["no"]),
        "**%s:** %s" % (L["review_date"], review_on),
        "",
        "## %s" % L["summary"],
        " ".join(str(data.get("executive_summary") or "").split()),
        "",
        "## %s" % L["scoring"],
        L["bands"],
    ]
    domains = {d.get("domain"): d for d in (data.get("domains") or []) if isinstance(d, dict)}
    for key in _VENDOR_DOMAIN_ORDER:
        d = domains.get(key) or {}
        ds = int(d.get("score") or 0)
        st = str(d.get("evidence_status") or "insufficient_evidence")
        out.append("- %s: %d/10 (%s) — %s" % (L["domain"].get(key, key), ds,
                                              L["band"].get(ai_prompts.vendor_band(ds), ""), L["status"].get(st, st)))
    out += ["", "## %s" % L["domains"]]
    for i, key in enumerate(_VENDOR_DOMAIN_ORDER, 1):
        d = domains.get(key) or {}
        ds = int(d.get("score") or 0)
        st = str(d.get("evidence_status") or "insufficient_evidence")
        prio = str(d.get("remediation_priority") or "none")
        out.append("### %d. %s — %d/10 (%s)" % (i, L["domain"].get(key, key), ds, L["band"].get(ai_prompts.vendor_band(ds), "")))
        out.append("**%s:** %s · **%s:** %s" % (L["evidence"], L["status"].get(st, st), L["priority"], L["prio"].get(prio, prio)))
        out.append("**%s:**" % L["findings"])
        out += _md_bullets(d.get("findings"), L["none"])
        gaps = [g for g in (d.get("gaps") or []) if str(g).strip()]
        if gaps:
            out.append("**%s:**" % L["gaps"])
            out += _md_bullets(gaps, L["none"])
        out.append("")
    out.append("## %s" % L["key_risks"])
    risks = [r for r in (data.get("key_risks") or []) if isinstance(r, dict) and str(r.get("risk") or "").strip()]
    if risks:
        risks.sort(key=lambda r: _SEVERITY_RANK.get(str(r.get("severity") or ""), 9))
        for r in risks:
            sev = str(r.get("severity") or "")
            out.append("- **%s** — %s" % (L["band"].get(sev, sev.upper()), " ".join(str(r["risk"]).split())))
    else:
        out.append("- %s" % L["none"])
    out += ["", "## %s" % L["recs"]]
    recs = [r for r in (data.get("recommendations") or []) if isinstance(r, dict) and str(r.get("action") or "").strip()]
    for horizon in ("immediate", "short_term", "long_term"):
        items = [" ".join(str(r["action"]).split()) for r in recs if str(r.get("horizon") or "") == horizon]
        out.append("### %s" % L[horizon])
        out += ["%d. %s" % (n, a) for n, a in enumerate(items, 1)] or ["- %s" % L["none"]]
    out += ["", "## %s" % L["contract"]]
    out += _md_bullets(data.get("contract_requirements"), L["none"])
    out += ["", "## %s" % L["monitoring"]]
    out += _md_bullets(data.get("monitoring"), L["none"])
    warnings = [str(w) for w in (data.get("warnings") or []) if str(w).strip()] + list(extra_warnings or [])
    if warnings:
        out += ["", "## %s" % L["warnings"]]
        out += _md_bullets(warnings, L["none"])
    out += [
        "", "## %s" % L["final"],
        "**%s** — **Score: %d/10** (%s)" % (L["overall"], score, band_label),
        "**%s:** %s" % (L["recommendation"], rec_label),
        "**%s:** %s" % (L["review_date"], review_on),
        "",
        L["footer"].format(public=(L["footer_public"].format(n=public_count) if public_used else "")),
    ]
    return "\n".join(out).strip() + "\n"


async def _public_findings(vendor_name: str) -> list[dict]:
    """Best-effort public lookup (DuckDuckGo Instant Answer API, no auth). Returns ``[]`` on any failure.

    Every field is reduced to one clean line here; the caller still wraps the block with
    ``delimit_untrusted`` so the model treats it as unverified third-party data, never instructions.
    The abstract (when DDG has one) is included because the ``Results`` array is empty for most companies.
    """
    import httpx
    from urllib.parse import quote_plus

    query = "%s security compliance certifications" % ai_provider.clean_field(vendor_name, 80)
    url = "https://api.duckduckgo.com/?q=%s&format=json&no_html=1" % quote_plus(query)
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return []
        data = resp.json()
        if not isinstance(data, dict):
            return []
    except Exception as exc:  # noqa: BLE001 — the search is optional; the report says so honestly
        logger.info("vendor.analyze.web_search_unavailable err=%s", type(exc).__name__)
        return []
    out: list[dict] = []
    abstract = ai_provider.clean_field(data.get("AbstractText"), 600)
    if abstract:
        out.append({"title": ai_provider.clean_field(data.get("Heading"), 200) or "Abstract",
                    "snippet": abstract, "url": ai_provider.clean_field(data.get("AbstractURL"), 300)})
    for r in (data.get("Results") or [])[:5]:
        if not isinstance(r, dict):
            continue
        out.append({"title": ai_provider.clean_field(r.get("Title"), 200),
                    "snippet": ai_provider.clean_field(r.get("Text"), 500),
                    "url": ai_provider.clean_field(r.get("FirstURL"), 300)})
    return out[:6]


def _public_findings_block(web_results: list[dict]) -> str:
    if not web_results:
        return "PUBLIC FINDINGS: none supplied."
    lines = ["%d. %s — %s (source: %s)" % (i, r.get("title") or "untitled", r.get("snippet") or "(no text)",
                                            r.get("url") or "unknown") for i, r in enumerate(web_results, 1)]
    return ai_provider.delimit_untrusted("\n".join(lines), "PUBLIC FINDINGS")

# ── User-facing messages (en | fr | ar) ─────────────────────────────────────
# The AI paths already answer in the caller's language (ai_locale); these are the
# plain workflow answers — not found, upload refused, approval gate — which the
# same users read in the same screens. Table + _msg() as in endpoints/regulatory.py.

_MESSAGES: dict[str, dict[str, str]] = {
    "vendor_not_found": {
        "en": "Vendor not found",
        "fr": "Fournisseur introuvable",
        "ar": "المورّد غير موجود",
    },
    "contract_not_found": {
        "en": "Contract not found",
        "fr": "Contrat introuvable",
        "ar": "العقد غير موجود",
    },
    "bad_tier_or_status": {
        "en": "Unknown risk tier or status. Accepted risk tiers: {tiers}. Accepted statuses: {statuses}.",
        "fr": "Niveau de risque ou statut inconnu. Niveaux acceptés : {tiers}. Statuts acceptés : {statuses}.",
        "ar": "مستوى الخطر أو الحالة غير معروف. المستويات المقبولة: {tiers}. الحالات المقبولة: {statuses}.",
    },
    "vendor_has_records": {
        "en": "This vendor cannot be deleted: {n} contract(s) already carry a CISO decision or a signature. "
              "Set the vendor's status to 'inactive' to retire the relationship and keep the record.",
        "fr": "Ce fournisseur ne peut pas être supprimé : {n} contrat(s) portent déjà une décision du RSSI ou une signature. "
              "Passez le statut du fournisseur à « inactive » pour clore la relation en conservant le dossier.",
        "ar": "لا يمكن حذف هذا المورّد: {n} من العقود تحمل بالفعل قرار مسؤول أمن المعلومات أو توقيعاً. "
              "غيّر حالة المورّد إلى \"inactive\" لإنهاء العلاقة مع الاحتفاظ بالسجل.",
    },
    "no_analysis": {
        "en": "No AI analysis is available to approve for this vendor. Run the AI risk assessment first.",
        "fr": "Aucune analyse IA n'est disponible pour approbation sur ce fournisseur. Lancez d'abord l'évaluation des risques par l'IA.",
        "ar": "لا يوجد تحليل بالذكاء الاصطناعي جاهز للاعتماد لهذا المورّد. شغّل تقييم المخاطر أولاً.",
    },
    "questionnaire_empty": {
        "en": "questionnaire_responses is empty: answer the questionnaire before running the analysis.",
        "fr": "Le questionnaire est vide : répondez au questionnaire avant de lancer l'analyse.",
        "ar": "الاستبيان فارغ: أجب عن الاستبيان قبل تشغيل التحليل.",
    },
    "prescreen_empty": {
        "en": "The questionnaire contains no answers to analyse.",
        "fr": "Le questionnaire ne contient aucune réponse à analyser.",
        "ar": "لا يحتوي الاستبيان على أي إجابات لتحليلها.",
    },
    "file_too_large": {
        "en": "File exceeds {mb} MB limit",
        "fr": "Le fichier dépasse la limite de {mb} Mo",
        "ar": "يتجاوز الملف الحد المسموح به وهو {mb} ميغابايت",
    },
    "unsupported_type": {
        "en": "Only PDF, DOCX, XLSX, XLS, and TXT files are supported",
        "fr": "Seuls les fichiers PDF, DOCX, XLSX, XLS et TXT sont acceptés",
        "ar": "الملفات المقبولة هي PDF وDOCX وXLSX وXLS وTXT فقط",
    },
    "signature_mismatch": {
        "en": "File contents do not match the declared {kind} type.",
        "fr": "Le contenu du fichier ne correspond pas au type {kind} déclaré.",
        "ar": "محتوى الملف لا يطابق النوع المُعلن {kind}.",
    },
    "upload_failed": {
        "en": "File upload failed",
        "fr": "Échec du téléversement du fichier",
        "ar": "فشل رفع الملف",
    },
    "bad_review_action": {
        "en": "Action must be 'approve' or 'reject'",
        "fr": "L'action doit être « approve » ou « reject »",
        "ar": "يجب أن يكون الإجراء \"approve\" أو \"reject\"",
    },
    "vendor_has_signed_negotiation": {
        "en": "This vendor cannot be deleted: {n} contract negotiation(s) already carry a signature or a "
              "mutual agreement. Set the vendor's status to 'inactive' to retire the relationship and keep the record.",
        "fr": "Ce fournisseur ne peut pas être supprimé : {n} négociation(s) de contrat portent déjà une signature ou "
              "un accord mutuel. Passez le statut du fournisseur à « inactive » pour clore la relation en conservant le dossier.",
        "ar": "لا يمكن حذف هذا المورّد: {n} من مفاوضات العقود تحمل بالفعل توقيعاً أو اتفاقاً متبادلاً. "
              "غيّر حالة المورّد إلى \"inactive\" لإنهاء العلاقة مع الاحتفاظ بالسجل.",
    },
    "needs_ciso_approval": {
        "en": "Contract must be approved by CISO before sending to vendor",
        "fr": "Le contrat doit être approuvé par le RSSI avant d'être envoyé au fournisseur",
        "ar": "يجب أن يوافق مسؤول أمن المعلومات على العقد قبل إرساله إلى المورّد",
    },
}


def _msg(key: str, lang: str, **values) -> str:
    table = _MESSAGES[key]
    text = table.get(lang) or table["en"]
    return text.format(**values) if values else text


# ── Request / Response schemas ──────────────────────────────────────────────

class VendorCreateRequest(BaseModel):
    name: str
    industry: str | None = None
    country: str | None = None
    website: str | None = None
    risk_tier: str = "medium"
    status: str = "active"
    risk_score: float | None = None
    services_provided: str | None = None
    has_data_processing_agreement: bool = False
    contract_expiry: str | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None


def _parse_tier_status(body: "VendorCreateRequest", lang: str) -> tuple[VendorRiskTier, VendorStatus]:
    """``(risk_tier, status)`` or HTTP 422 — never a ValueError.

    An unknown value used to escape as a 500, which the SPA turns into a hard redirect
    to /service-down instead of showing the field error.
    """
    try:
        return VendorRiskTier(body.risk_tier), VendorStatus(body.status)
    except ValueError:
        raise HTTPException(status_code=422, detail=_msg(
            "bad_tier_or_status", lang,
            tiers=", ".join(t.value for t in VendorRiskTier),
            statuses=", ".join(s.value for s in VendorStatus),
        ))


class VendorResponse(BaseModel):
    id: str
    name: str
    industry: str | None
    country: str | None
    website: str | None
    risk_tier: str
    status: str
    services_provided: str | None
    has_data_processing_agreement: bool
    contract_expiry: str | None
    risk_score: float | None
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class VendorListResponse(BaseModel):
    items: list[VendorResponse]
    total: int


class VendorApproveAnalysisRequest(BaseModel):
    """Request to approve analysis and update vendor risk score."""
    risk_score: float  # 1-10 scale from AI analysis
    analysis_notes: str | None = None


class VendorAnalysisRequest(BaseModel):
    """Request for AI web search + risk analysis."""
    questionnaire_responses: dict[str, str]  # Q&A from the frontend


class VendorAnalysisResponse(BaseModel):
    """Response from AI analysis with web search results.

    ``analysis`` stays the Markdown report the modal renders and "Approve & Save" parses (first
    ``Score: N/10`` = overall score). The remaining fields are additive: the validated structured
    verdict the report was rendered from, its headline values and the language it was written in.
    """
    vendor_id: str
    analysis: str  # The AI-generated analysis (Markdown rendered from the validated JSON verdict)
    web_search_results: list[dict] | None = None
    updated_at: datetime
    structured: dict | None = None
    overall_score: int | None = None
    risk_classification: str | None = None
    recommendation: str | None = None
    confidence: str | None = None
    language: str | None = None
    warnings: list[str] = []

class VendorContractResponse(BaseModel):
    """Response for uploaded contract."""
    id: str
    vendor_id: str
    file_name: str
    file_size: int | None
    ai_review: str | None
    review_status: str
    validation_status: str
    ciso_reviewer_id: str | None
    ciso_comments: str | None
    ciso_reviewed_at: str | None
    sent_to_vendor_at: str | None
    version: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CisoReviewRequest(BaseModel):
    """Request for CISO to approve/reject a contract."""
    action: str  # "approve" or "reject"
    comments: str | None = None


class RiskDimension(BaseModel):
    """A single risk dimension in the cartography."""
    category: str
    label: str
    likelihood: int  # 1-5
    impact: int      # 1-5
    score: int       # likelihood * impact (1-25)
    level: str       # "low", "medium", "high", "critical"
    description: str
    indicators: list[str]  # Key indicators supporting the score


class VendorRiskCartographyResponse(BaseModel):
    """Full risk cartography for a vendor."""
    vendor_id: str
    vendor_name: str
    overall_score: float  # 0-25 average
    overall_level: str    # low/medium/high/critical
    dimensions: list[RiskDimension]
    generated_at: datetime


class PrescreenQuestionnaireRequest(BaseModel):
    """Request to analyze a questionnaire for a new vendor (BEFORE save)."""
    vendor_name: str
    vendor_industry: str | None = None
    vendor_country: str | None = None
    responses: dict[str, str]  # question -> "yes"/"no"/"na"


class PrescreenQuestionnaireResponse(BaseModel):
    """Response with AI insights from prescreen questionnaire (additive fields after the original seven)."""
    initial_risk_score: float  # 1-10 scale
    risk_level: str  # low/medium/high/critical
    summary: str
    strengths: list[str]
    concerns: list[str]
    red_flags: list[str]
    recommendations: list[str]
    questionnaire_responses: dict[str, str]
    score_rationale: str | None = None      # the model's arithmetic / reason for moving off the baseline
    warnings: list[str] = []                # e.g. injection attempts noticed, answers omitted
    baseline_score: float | None = None     # deterministic platform baseline the model refined (±1.0)
    baseline_level: str | None = None
    language: str | None = None             # language the free text was written in (en|fr|ar)

# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=VendorListResponse)
async def list_vendors(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all vendors for the tenant."""
    result = await db.execute(
        select(Vendor).where(Vendor.tenant_id == tenant_id).order_by(Vendor.created_at.desc())
    )
    vendors = result.scalars().all()

    return VendorListResponse(
        items=[VendorResponse.model_validate(v) for v in vendors],
        total=len(vendors),
    )


@router.post("", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
async def create_vendor(
    body: VendorCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Create a new vendor."""
    risk_tier, vstatus = _parse_tier_status(body, lang)
    vendor = Vendor(
        tenant_id=tenant_id,
        name=body.name.strip(),
        industry=body.industry,
        country=body.country.upper() if body.country else None,
        website=body.website,
        risk_tier=risk_tier,
        status=vstatus,
        risk_score=body.risk_score,
        services_provided=body.services_provided,
        has_data_processing_agreement=body.has_data_processing_agreement,
        contract_expiry=body.contract_expiry,
        primary_contact_name=body.primary_contact_name,
        primary_contact_email=body.primary_contact_email,
        owner_id=current_user.id,
    )
    db.add(vendor)
    await db.flush()
    await db.commit()
    await db.refresh(vendor)

    return VendorResponse.model_validate(vendor)


@router.get("/{vendor_id}", response_model=VendorResponse)
async def get_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Get a specific vendor."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    return VendorResponse.model_validate(vendor)


@router.patch("/{vendor_id}", response_model=VendorResponse)
async def update_vendor(
    vendor_id: str,
    body: VendorCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Update a vendor."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    risk_tier, vstatus = _parse_tier_status(body, lang)

    # Update fields
    vendor.name = body.name.strip()
    vendor.industry = body.industry
    vendor.country = body.country.upper() if body.country else None
    vendor.website = body.website
    vendor.risk_tier = risk_tier
    vendor.status = vstatus
    vendor.services_provided = body.services_provided
    vendor.has_data_processing_agreement = body.has_data_processing_agreement
    vendor.contract_expiry = body.contract_expiry
    vendor.primary_contact_name = body.primary_contact_name
    vendor.primary_contact_email = body.primary_contact_email

    await db.flush()
    await db.commit()
    await db.refresh(vendor)

    return VendorResponse.model_validate(vendor)


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Delete a vendor."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    contracts = (await db.execute(
        select(VendorContract).where(VendorContract.vendor_id == vendor_id)
    )).scalars().all()

    # A contract that a CISO has approved/rejected, or that both parties have signed,
    # is a record of fact an auditor expects to still be there. Deleting the vendor
    # does not delete those rows — it only detaches them (every query reaches a
    # contract through its vendor, and SQLite has no FK enforcement here), so the
    # decision silently becomes unreachable. There is no deleted_at on this model to
    # soft-delete into, so the destructive path is refused instead: the vendor status
    # ('inactive') is the supported way to retire a relationship.
    decided_statuses = {
        ContractValidationStatus.APPROVED.value,
        ContractValidationStatus.REJECTED.value,
        ContractValidationStatus.SENT_TO_VENDOR.value,
        "signed",   # written by contract_collab when both parties have signed
    }
    of_record = [c for c in contracts if c.validation_status in decided_statuses or c.ciso_reviewed_at]
    if of_record:
        raise HTTPException(status_code=409, detail=_msg("vendor_has_records", lang, n=len(of_record)))

    collabs = (await db.execute(
        select(ContractCollaboration).where(ContractCollaboration.vendor_id == vendor_id)
    )).scalars().all()

    # The signature state of a negotiation lives on the collaboration, not on the
    # contract: a session both parties agreed to, or that either party has signed,
    # is a record of fact even when _create_signed_contract has not run yet (so the
    # 'signed' contract the check above looks for does not exist). Refuse the same way.
    signed_collabs = [c for c in collabs if c.ciso_signature or c.vendor_signature or c.agreed_at]
    if signed_collabs:
        raise HTTPException(status_code=409,
                            detail=_msg("vendor_has_signed_negotiation", lang, n=len(signed_collabs)))

    # Retire the file versions of this vendor's contracts. Without this their
    # rows vanish while the PDFs stay on disk with nothing referencing them —
    # unreachable through the app and invisible to retention, so the space is
    # never reclaimable. Retiring keeps them recoverable and lets the policy
    # decide when they go.
    for contract in contracts:
        await file_integrity.retire_versions(
            db, entity_type=file_integrity.CONTRACT, entity_id=contract.id,
            note=f"Vendor {vendor.name} deleted by {current_user.email}",
        )

    # Delete the children explicitly. SQLite runs here without PRAGMA foreign_keys
    # (core/database.py sets only journal_mode/busy_timeout) and none of these
    # relationships declares a cascade, so deleting the vendor alone leaves every
    # child row behind — unreachable through the app, because each of them is only
    # ever queried through its vendor. The collaboration rows matter most: their
    # share_token routes (/contract-collab/vendor/{share_token}) are UNAUTHENTICATED
    # and validate nothing but the token and its expiry, so an orphaned session would
    # keep serving the contract text, the AI suggestions and the message thread to
    # whoever holds the link — with no vendor left in the UI to revoke it from.
    for collab in collabs:
        await db.execute(
            delete(ContractMessage).where(ContractMessage.collaboration_id == collab.id)
        )
        await db.delete(collab)
    for child_model in (VendorAssessment, VendorRisk):
        await db.execute(delete(child_model).where(child_model.vendor_id == vendor_id))
    for contract in contracts:
        await db.delete(contract)

    await db.delete(vendor)
    await db.commit()
@router.post("/{vendor_id}/approve-analysis", response_model=VendorResponse)
async def approve_vendor_analysis(
    vendor_id: str,
    body: VendorApproveAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Approve AI analysis and update vendor risk score."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    # Guard against the frontend's silent fallback: VendorAIModal's Approve & Save defaults to
    # risk_score=5 with analysis_notes="" when the AI call actually failed (analyzeStream's catch
    # calls onDone() on a 424 with no output — see analyze_vendor_with_web_search). Before this
    # endpoint's 424 mapping existed such a failure hard-redirected the SPA to /service-down, so the
    # button never appeared. This must reject on blank analysis_notes unconditionally — NOT only
    # when the vendor has no prior stored description. body.risk_score is parsed client-side from
    # THIS call's report text, so a blank analysis_notes means risk_score has zero backing no matter
    # what an earlier, unrelated run may have left in vendor.description; a "regenerate" that fails
    # on an already-analyzed vendor hits exactly that case (old description non-blank, new notes
    # blank) and must 422 too, not silently overwrite risk_score with the fallback default.
    if not (body.analysis_notes or "").strip():
        raise HTTPException(status_code=422, detail=_msg("no_analysis", lang))

    # Update risk score + description together — both come from this call's analysis_notes, which
    # the guard above has just confirmed is non-blank, so neither is ever persisted unbacked.
    vendor.risk_score = body.risk_score
    vendor.description = body.analysis_notes

    await db.flush()
    await db.commit()
    await db.refresh(vendor)

    return VendorResponse.model_validate(vendor)


@router.post("/{vendor_id}/analyze", response_model=VendorAnalysisResponse)
async def analyze_vendor_with_web_search(
    vendor_id: str,
    body: VendorAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Full vendor risk assessment from the questionnaire (+ optional public findings) on the AI foundation.

    ``vendor_analysis`` task: a rubric-scored six-domain verdict as validated JSON (deterministic
    decoding, consistency check, one repair retry), rendered here into the Markdown report the modal
    shows and ``vendor.description`` stores. Failure is an explicit HTTP 424 — never a 5xx (the SPA
    would redirect to /service-down) and never a default verdict.
    """
    ai_quota.check_quota_or_raise(current_user.id)
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    responses = _bounded_responses(body.questionnaire_responses)
    if not responses:
        raise HTTPException(status_code=422, detail=_msg("questionnaire_empty", lang))
    counts = _answer_counts(responses)
    extra_warnings: list[str] = []
    if len(body.questionnaire_responses) > len(responses):
        extra_warnings.append("Only the first %d questionnaire answers were analysed (%d supplied)."
                              % (len(responses), len(body.questionnaire_responses)))

    # Step 1: optional public findings — unverified third-party text, delimited before the model sees it
    web_results = await _public_findings(vendor.name)

    # Step 2: expert system prompt (criteria + schema + language block) and the rendered user turn
    today = date.today()
    try:
        system = ai_prompts.system_prompt("vendor_analysis", lang=lang, extra_context=_vendor_context(vendor))
        user = ai_prompts.render_user_prompt(
            "vendor_analysis",
            today=today.isoformat(),
            vendor_name=ai_provider.clean_field(vendor.name) or "(unnamed vendor)",
            industry=ai_provider.clean_field(vendor.industry, 100) or "not stated",
            services=ai_provider.clean_field(vendor.services_provided, 400) or "not stated",
            country=ai_provider.clean_field(vendor.country, 10) or "not stated",
            total=counts["total"], yes=counts["yes"], no=counts["no"], partial=counts["partial"], na=counts["na"],
            questionnaire_block=_questionnaire_block(responses),
            public_findings_block=_public_findings_block(web_results),
        )
        d = ai_prompts.task_defaults("vendor_analysis")
        # Step 3: structured call — validation + one repair round live in ai_structured; tenant BYO-AI via db
        res = await ai_structured(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            ai_prompts.task_schema("vendor_analysis"), schema_in_prompt=False,
            check=lambda data: ai_prompts.consistency_issues("vendor_analysis", data),
            user_id=current_user.id, tenant_id=tenant_id, db=db, task="vendors.analyze",
            **ai_provider.decoding(d["preset"], temperature=d["temperature"]),
        )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — never a 5xx: the SPA redirects to /service-down
        logger.exception("vendor.analyze.error vendor_id=%s", vendor_id)
        raise HTTPException(status_code=424,
                            detail="%s (error: vendor analysis failed unexpectedly)" % failure_message("error", lang))

    if not res.ok:
        logger.warning("vendor.analyze.failed vendor_id=%s kind=%s attempts=%d: %s",
                       vendor_id, res.kind, res.attempts, res.error)
        raise HTTPException(status_code=424, detail=_ai_failure_detail(res, lang))

    # Step 4: deterministic honesty fix-ups (band/score coherence, recommendation rules); leftovers are shown
    data = ai_prompts.apply_fixups("vendor_analysis", res.data)
    leftover = ai_prompts.consistency_issues("vendor_analysis", data)
    if leftover:
        logger.warning("vendor.analyze.inconsistent vendor_id=%s: %s", vendor_id, " | ".join(leftover)[:500])
        extra_warnings.extend(i.lstrip("- ").strip() for i in leftover[:5])
    analysis_text = _render_vendor_report(data, vendor_name=vendor.name, today=today, lang=lang, counts=counts,
                                          public_count=len(web_results), extra_warnings=extra_warnings)

    # Step 5: persist in the same column as before; answer with today's shape plus additive fields
    vendor.description = analysis_text
    await db.flush()
    await db.commit()
    await db.refresh(vendor)

    warnings = [str(w) for w in (data.get("warnings") or []) if str(w).strip()] + extra_warnings
    return VendorAnalysisResponse(
        vendor_id=vendor.id,
        analysis=analysis_text,
        web_search_results=web_results,
        updated_at=datetime.utcnow(),
        structured=data,
        overall_score=int(data.get("overall_score") or 0),
        risk_classification=str(data.get("risk_classification") or ""),
        recommendation=str(data.get("recommendation") or ""),
        confidence=str(data.get("confidence") or ""),
        language=lang,
        warnings=warnings,
    )


# ── Contract text extraction + background AI review ────────────────────────
# map: contract_extract per excerpt (verbatim clause quotes + ratings) → reduce: contract_review

_CONTRACT_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "header": "AI CONTRACT REVIEW — {file} — {n} excerpt(s), full text covered — {date} — contract language: {cl}",
        "warnings": "ANALYSIS WARNINGS",
        "failed": "AI CONTRACT REVIEW FAILED — the contract text was NOT analysed.",
        "reason": "Reason: {reason}",
        "next": "Review the document manually or upload it again to retry the AI review.",
        "no_rating": "OVERALL RISK: NOT STATED — the AI review did not state an overall rating; rate the contract manually.",
    },
    "fr": {
        "header": "REVUE IA DU CONTRAT — {file} — {n} extrait(s), texte intégral couvert — {date} — langue du contrat : {cl}",
        "warnings": "AVERTISSEMENTS DE L'ANALYSE",
        "failed": "ÉCHEC DE LA REVUE IA DU CONTRAT — le texte du contrat N'A PAS été analysé.",
        "reason": "Motif : {reason}",
        "next": "Examinez le document manuellement ou téléversez-le à nouveau pour relancer la revue IA.",
        "no_rating": "OVERALL RISK: NOT STATED — la revue IA n'a pas indiqué de niveau de risque global ; évaluez le contrat manuellement.",
    },
    "ar": {
        "header": "مراجعة العقد بالذكاء الاصطناعي — {file} — {n} مقتطف، تمت تغطية النص الكامل — {date} — لغة العقد: {cl}",
        "warnings": "تنبيهات التحليل",
        "failed": "فشلت مراجعة العقد بالذكاء الاصطناعي — لم يتم تحليل نص العقد.",
        "reason": "السبب: {reason}",
        "next": "راجع المستند يدوياً أو أعد رفعه لإعادة تشغيل مراجعة الذكاء الاصطناعي.",
        "no_rating": "OVERALL RISK: NOT STATED — لم تحدد المراجعة مستوى الخطر الإجمالي؛ قيّم العقد يدوياً.",
    },
}


class _ContractReviewFailed(Exception):
    """The background review produced no review; ``kind`` follows the ai_locale failure kinds."""

    def __init__(self, kind: str, detail: str):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail


def _extract_contract_text(content: bytes, file_name: str, content_type: str) -> tuple[str, str]:
    """``(text, note)`` from an uploaded contract.

    PDF via pypdf (text layer; a scanned PDF is retried with OCR in the background task), DOCX via
    python-docx (paragraphs + table cells), XLSX via openpyxl, TXT with utf-8 then cp1252. Never
    raises: a failure yields ``("", note)`` and the caller records an explicit extraction failure
    instead of analysing an empty document.
    """
    name = (file_name or "").lower()
    ct = (content_type or "").lower()
    try:
        if name.endswith(".pdf") or "pdf" in ct:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            pages: list[str] = []
            for page in reader.pages:
                try:
                    pages.append((page.extract_text() or "").strip())
                except Exception:  # noqa: BLE001 — one unreadable page must not lose the others
                    pages.append("")
            text = "\n\n".join(p for p in pages if p)
            if not text.strip():
                return "", "the PDF has no text layer (scanned document)"
            return text, "pdf text layer, %d page(s)" % len(pages)
        if name.endswith(".docx") or "wordprocessingml" in ct or "docx" in ct:
            from docx import Document as DocxDocument
            doc = DocxDocument(io.BytesIO(content))
            parts = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
            for table in doc.tables:
                for row in table.rows:
                    cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
                    if cells:
                        parts.append(" | ".join(cells))
            return "\n".join(parts), "docx"
        if name.endswith(".doc") or "msword" in ct:
            return "", "legacy .doc documents cannot be read on this server; upload .docx, .pdf or .txt"
        if name.endswith(".xlsx") or "spreadsheetml" in ct:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            parts = []
            for ws in wb.worksheets:
                parts.append("[Sheet: %s]" % ws.title)
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
                    if cells:
                        parts.append(" | ".join(cells))
            return "\n".join(parts), "xlsx"
        if name.endswith(".xls") or "ms-excel" in ct:
            return "", "legacy .xls workbooks cannot be read on this server; upload .xlsx, .docx, .pdf or .txt"
        for enc in ("utf-8", "cp1252"):
            try:
                return content.decode(enc), "text (%s)" % enc
            except UnicodeDecodeError:
                continue
        return content.decode("utf-8", errors="ignore"), "text (lossy decode)"
    except Exception as exc:  # noqa: BLE001
        logger.warning("vendor.contract.text_extract_failed file=%s err=%s", file_name, type(exc).__name__)
        return "", "text extraction failed (%s)" % type(exc).__name__


def _ocr_pdf_text(content: bytes, lang: str) -> str:
    """Scanned-PDF fallback through the platform OCR service; ``""`` when OCR is not installed."""
    try:
        from app.services import ocr_service
        # contracts here are French/English/Arabic regardless of the UI language: use the combined packs
        tess = "ara+fra" if (lang or "en")[:2].lower() == "ar" else "fra+eng"
        result = ocr_service.ocr_pdf(content, lang=tess, max_pages=40)
        return str(result.get("text") or "")
    except Exception as exc:  # noqa: BLE001 — OcrUnavailableError or a rasteriser problem: reported by the caller
        logger.info("vendor.contract.ocr_unavailable err=%s", type(exc).__name__)
        return ""


def _plan_contract_chunks(text: str) -> list:
    """Chunk the WHOLE contract (default ~6000 tokens per excerpt with overlap). Widens the window before
    exceeding the per-job call budget and refuses explicitly when even the widest window needs too many calls."""
    max_calls = max(2, int(getattr(settings, "AI_MAX_CALLS_PER_JOB", 60) or 60)) - 1   # one call reserved for the reduce
    chunks = ai_chunking.chunk_document(text)
    if len(chunks) > max_calls:
        chunks = ai_chunking.chunk_document(text, ai_chunking.MAX_CHUNK_TOKENS)
    if len(chunks) > max_calls:
        raise _ContractReviewFailed(
            "input", "The contract is too long for one AI review (%d excerpts; the limit is %d)." % (len(chunks), max_calls))
    return chunks


def _consolidate_findings(results, text: str) -> tuple[list[dict], list[str], str, list[str]]:
    """``(findings, absent_topics, contract_language, warnings)`` merged over every excerpt.

    Duplicates produced by the excerpt overlap are dropped (same topic + clause_ref + quote head);
    findings are ordered critical → info (stable, so excerpt order survives within a rating) and keep
    the excerpt they came from so the reduce step can cite them. Absence is decided here, over the
    whole contract, never inside one excerpt.
    """
    findings: list[dict] = []
    seen: set[tuple] = set()
    warnings: list[str] = []
    langs: Counter = Counter()
    for chunk, res in results:
        data = res.data if isinstance(res.data, dict) else {}
        for f in data.get("findings") or []:
            if not isinstance(f, dict):
                continue
            topic = str(f.get("topic") or "other")
            ref = " ".join(str(f.get("clause_ref") or "unnumbered").split())[:120]
            quote = " ".join(str(f.get("quote") or "").split())[:400]
            key = (topic, ai_chunking.normalize_ws(ref).lower(), ai_chunking.normalize_ws(quote[:80]).lower())
            if key in seen:
                continue
            seen.add(key)
            findings.append({
                "excerpt": chunk.index, "topic": topic, "clause_ref": ref, "quote": quote,
                "reading": " ".join(str(f.get("reading") or "").split())[:400],
                "risk": str(f.get("risk") or "info"),
            })
        facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
        code = str(facts.get("language") or "").strip().lower()[:2]
        if code.isalpha():
            langs[code] += 1
        for w in data.get("warnings") or []:
            if str(w).strip():
                warnings.append("excerpt %d: %s" % (chunk.index, " ".join(str(w).split())[:300]))
        if getattr(res, "partial", False):
            warnings.append("excerpt %d: %d finding(s) failed validation and were dropped"
                            % (chunk.index, len(res.invalid_items)))
    findings.sort(key=lambda f: _SEVERITY_RANK.get(f["risk"], 9))
    found = {f["topic"] for f in findings}
    absent = [t for t in ai_prompts.CONTRACT_TOPICS if t != "other" and t not in found]
    contract_language = langs.most_common(1)[0][0] if langs else (guess_language(text) or "unknown")
    return findings, absent, contract_language, warnings


def _findings_json(findings: list[dict], budget_chars: int) -> tuple[str, int]:
    """Compact JSON of the findings that fits ``budget_chars``; the lowest-rated tail is dropped first."""
    kept = list(findings)
    dumped = json.dumps(kept, ensure_ascii=False, separators=(",", ":"))
    omitted = 0
    while len(dumped) > budget_chars and len(kept) > 1:
        drop = max(1, len(kept) // 10)
        kept, omitted = kept[:-drop], omitted + drop
        dumped = json.dumps(kept, ensure_ascii=False, separators=(",", ":"))
    return dumped, omitted


async def _review_contract_text(text: str, *, vendor_name: str, file_name: str, country: str | None, lang: str,
                                cfg, user_id: str | None, tenant_id: str | None) -> tuple[str, dict]:
    """Map-reduce review over the full contract text → ``(review_text, meta)``; raises ``_ContractReviewFailed``."""
    chunks = _plan_contract_chunks(text)
    regimes = ai_prompts.regimes_for_country(country)
    extract_system = ai_prompts.system_prompt("contract_extract", lang=lang)
    xd = ai_prompts.task_defaults("contract_extract")
    extract_kw = ai_provider.decoding(xd["preset"], temperature=xd["temperature"])
    extract_schema = ai_prompts.task_schema("contract_extract")

    async def _extract(chunk):
        user = ai_prompts.render_user_prompt(
            "contract_extract", vendor_name=vendor_name, file_name=file_name,
            chunk_index=chunk.index, chunk_total=chunk.total, regimes=regimes,
            contract_block=ai_provider.delimit_untrusted(chunk.text, "CONTRACT", max_len=len(chunk.text) + 1))
        res = await ai_structured(
            [{"role": "system", "content": extract_system}, {"role": "user", "content": user}],
            extract_schema, schema_in_prompt=False, partial_items="findings",
            user_id=user_id, tenant_id=tenant_id, cfg=cfg, task="vendors.contract_extract", **extract_kw)
        if not res.ok:
            raise _ContractReviewFailed(res.kind or "error",
                                        "excerpt %d of %d: %s" % (chunk.index, chunk.total, res.failure_detail()))
        return chunk, res

    results = await ai_chunking.map_reduce(chunks, _extract, lambda r: r)      # all-or-nothing: one failure fails the job
    findings, absent, contract_language, warnings = _consolidate_findings(results, text)

    rd = ai_prompts.task_defaults("contract_review")
    review_kw = ai_provider.decoding(rd["preset"], temperature=rd["temperature"])
    budget = ai_provider.prompt_char_budget(int(review_kw.get("num_ctx") or 32768),
                                            int(review_kw.get("num_predict") or 12288), reserve_tokens=3000)
    findings_dump, omitted = _findings_json(findings, budget)
    if omitted:
        warnings.append("%d lowest-rated finding(s) were omitted from the review input for length" % omitted)
    review_system = ai_prompts.system_prompt("contract_review", lang=lang)
    review_user = ai_prompts.render_user_prompt(
        "contract_review", vendor_name=vendor_name, file_name=file_name, contract_language=contract_language,
        chunk_total=len(chunks), absent_topics=", ".join(absent) or "none",
        findings_block=ai_provider.delimit_untrusted(findings_dump, "FINDINGS", max_len=len(findings_dump) + 1))
    msgs = [{"role": "system", "content": review_system}, {"role": "user", "content": review_user}]

    review, attempts, truncated = "", 0, False
    try:
        for attempt in (1, 2):
            attempts = attempt
            result = await ai_provider.ai_complete_full(msgs, user_id=user_id, tenant_id=tenant_id, cfg=cfg,
                                                        task="vendors.contract_review", **review_kw)
            review, truncated = result.content.strip(), result.truncated
            if not truncated and _final_rating(review):
                break
            # cut off, or no final rating line: ONE re-ask from the base prompt with a larger answer budget
            review_kw["num_predict"] = min(int(review_kw.get("num_predict") or 12288) * 2, 32768)
    except ai_provider.AICallError as exc:
        raise _ContractReviewFailed(exc.kind, exc.detail)
    if truncated:
        raise _ContractReviewFailed("truncated", "The consolidated review was cut off before completion (%d attempt(s))." % attempts)
    meta = {"chunks": len(chunks), "findings": len(findings), "absent_topics": absent,
            "contract_language": contract_language, "warnings": warnings,
            "rating": _final_rating(review), "attempts": attempts}
    return review, meta


def _contract_review_text(review: str, meta: dict, *, file_name: str, lang: str) -> str:
    """Plain text stored in ``ai_review`` (the UI renders it in a whitespace-pre-wrap div, no Markdown)."""
    L = _CONTRACT_LABELS.get(lang) or _CONTRACT_LABELS["en"]
    head = [L["header"].format(file=file_name, n=meta["chunks"], date=date.today().isoformat(),
                               cl=meta["contract_language"])]
    if meta.get("warnings"):
        head.append(L["warnings"])
        head += ["- %s" % w for w in meta["warnings"][:8]]
    body = review.strip()
    if not meta.get("rating"):
        body = body + "\n\n" + L["no_rating"]      # explicit, never a synthetic rating
    return "\n".join(head) + "\n\n" + body


def _contract_failure_notice(kind: str, detail: str, lang: str) -> str:
    L = _CONTRACT_LABELS.get(lang) or _CONTRACT_LABELS["en"]
    # "input" = nothing was sent to the model (no text / too long): the detail already says why
    reason = detail if kind == "input" else "%s (%s: %s)" % (failure_message(kind, lang), kind, detail)
    return "\n".join([L["failed"], L["reason"].format(reason=reason), L["next"]])


@router.post("/{vendor_id}/upload-contract", response_model=VendorContractResponse)
async def upload_vendor_contract(
    vendor_id: str,
    contract_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Upload a contract for a vendor and trigger the background AI review (written in the uploader's UI language)."""
    # Reject filenames whose extension must never reach the uploads
    # volume — see security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(contract_file.filename, field_name="contract_file")
    # Get vendor
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    # Create upload directory if it doesn't exist
    upload_dir = Path(settings.UPLOADS_DIR) / "contracts"
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Sanitize the client-supplied filename and verify the resolved path
    # cannot escape upload_dir (path-traversal defense).
    safe_name = sanitize_filename(contract_file.filename, default="contract")
    # Build display name: contrat_<vendeur>_<date>.<ext>
    date_str  = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    vendeur   = re.sub(r"[^\w]", "_", vendor.name or "vendeur")[:30].strip("_")
    ext       = Path(contract_file.filename or "").suffix[:10] or ".bin"
    display_name = f"contrat_{vendeur}_{date_str}{ext}"
    # Unique per upload. The previous "{vendor_id}_{safe_name}" collided as soon
    # as the same filename was uploaded twice for one vendor: v2 overwrote v1's
    # bytes in place while v1's row kept pointing at that path, silently
    # replacing an earlier contract version — and, now that versions carry a
    # digest, guaranteeing a false "modified" verdict on v1.
    candidate = upload_dir / f"{vendor_id}_{uuid.uuid4().hex}_{safe_name}"
    file_path = assert_path_within(upload_dir, candidate)
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    ct = (contract_file.content_type or "").lower()
    try:
        content = await contract_file.read()
        if len(content) > max_bytes:
            raise HTTPException(413, _msg("file_too_large", lang, mb=settings.MAX_UPLOAD_SIZE_MB))
        # Enforce PDF, DOCX, XLSX, XLS, TXT only.
        name_lower = safe_name.lower()
        type_allowed = (
            "pdf" in ct or "docx" in ct or "word" in ct
            or "spreadsheetml" in ct or "ms-excel" in ct
            or "text/plain" in ct
            or name_lower.endswith(".pdf") or name_lower.endswith(".docx")
            or name_lower.endswith(".xlsx") or name_lower.endswith(".xls")
            or name_lower.endswith(".txt")
        )
        if not type_allowed:
            raise HTTPException(422, _msg("unsupported_type", lang))
        # Magic-byte check on the EFFECTIVE type, not only on what the browser declared:
        # a file sent as application/octet-stream (or with no Content-Type at all) matched
        # none of the "declared" tests and used to skip every check, so arbitrary bytes
        # could land on disk under a .pdf/.xlsx name. The extension decides whenever the
        # declared type says nothing useful. .txt has no reliable magic and stays unchecked.
        expected: tuple[str, str] | None = None      # (label shown to the user, MIME to verify)
        if "pdf" in ct or name_lower.endswith(".pdf"):
            expected = ("PDF", "application/pdf")
        elif "spreadsheetml" in ct or name_lower.endswith(".xlsx"):
            expected = ("XLSX", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        elif "ms-excel" in ct or name_lower.endswith(".xls"):
            expected = ("XLS", "application/vnd.ms-excel")
        elif "wordprocessingml" in ct or "docx" in ct or name_lower.endswith(".docx"):
            expected = ("DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        if expected and not verify_file_signature(content, expected[1]):
            raise HTTPException(415, _msg("signature_mismatch", lang, kind=expected[0]))
        # Writing the bytes is blocking I/O: off the event loop, like the text extraction below.
        await asyncio.to_thread(file_path.write_bytes, content)
    except HTTPException:
        raise
    except Exception:
        logger.exception("vendor.contract.write_failed vendor_id=%s", vendor_id)
        raise HTTPException(status_code=500, detail=_msg("upload_failed", lang))

    # Extract the WHOLE text (PDF/DOCX/XLSX/TXT) off the event loop; an empty result is reported explicitly
    # by the background review instead of being analysed as if it were the contract.
    extracted_text, extraction_note = await asyncio.to_thread(_extract_contract_text, content, safe_name, ct)
    if not extracted_text.strip():
        logger.warning("vendor.contract.no_text vendor_id=%s file=%s note=%s", vendor_id, safe_name, extraction_note)

    # Determine version. Counting rows skipped/duplicated numbers as soon as anything
    # else added a contract row for this vendor (contract_collab files the signed
    # agreement as one), and it loaded every row — extracted_text and ai_review
    # included — only to take its length.
    last_version = (await db.execute(
        select(func.max(VendorContract.version)).where(VendorContract.vendor_id == vendor_id)
    )).scalar()
    next_version = int(last_version or 0) + 1

    # Create contract record
    contract = VendorContract(
        vendor_id=vendor_id,
        file_name=display_name,
        file_path=str(file_path),
        file_size=len(content),
        file_sha256=file_integrity.sha256_bytes(content),
        extracted_text=extracted_text,
        review_status="pending",
        validation_status=ContractValidationStatus.PENDING_AI.value,
        version=next_version,
    )

    db.add(contract)
    await db.flush()
    # Contract history already exists as separate rows (version N+1 per upload);
    # this records the FILE alongside it so an earlier contract's bytes stay
    # retrievable and checkable.
    await file_integrity.record_version(
        db, tenant_id=tenant_id, entity_type=file_integrity.CONTRACT,
        entity_id=contract.id, parent_type="vendor", parent_id=vendor_id,
        file_path=str(file_path), file_name=display_name,
        file_sha256=contract.file_sha256, file_size_bytes=len(content),
        content_type=ct, uploaded_by_id=current_user.id, is_absolute_path=True,
    )
    await db.commit()
    await db.refresh(contract)

    # Trigger AI review (async, strong task reference); the PDF bytes only travel along for the OCR fallback
    is_pdf = safe_name.lower().endswith(".pdf") or "pdf" in ct
    _spawn_background(analyze_contract_async(
        contract.id, extracted_text, ai_provider.clean_field(vendor.name),
        tenant_id=tenant_id, user_id=current_user.id, lang=lang, file_name=display_name,
        country=vendor.country, extraction_note=extraction_note,
        content=content if (is_pdf and not extracted_text.strip()) else None,
    ))

    return VendorContractResponse.model_validate(contract)


async def analyze_contract_async(contract_id: str, extracted_text: str, vendor_name: str, *,
                                 tenant_id: str | None = None, user_id: str | None = None, lang: str = "en",
                                 file_name: str = "", country: str | None = None,
                                 extraction_note: str = "", content: bytes | None = None) -> None:
    """Background AI contract review (creates its own DB sessions).

    The whole text, never truncated: ``contract_extract`` per excerpt (verbatim clause quotes and
    customer-risk ratings, bounded concurrency) then one ``contract_review`` reduce written in the
    uploader's UI language. The outcome is always explicit: ``review_status="completed"`` with the
    review, or ``review_status="error"`` with a labelled failure notice in ``ai_review``. In both cases
    ``validation_status`` moves to ``ai_reviewed`` so the contract reaches the CISO queue (who can then
    review manually or re-upload) instead of vanishing behind an endless "AI review in progress".
    """
    from app.core.database import AsyncSessionLocal

    text = extracted_text or ""
    review_text: str | None = None
    failure: tuple[str, str] | None = None
    ocr_text: str | None = None
    try:
        if not text.strip() and content is not None and (file_name or "").lower().endswith(".pdf"):
            ocr_text = await asyncio.to_thread(_ocr_pdf_text, content, lang)
            if ocr_text.strip():
                text, extraction_note = ocr_text, "OCR"
        if not text.strip():
            failure = ("input", "No readable text could be extracted from the contract file (%s)."
                       % (extraction_note or "unsupported format"))
        else:
            async with AsyncSessionLocal() as db:
                cfg = await ai_provider.load_ai_config(db, tenant_id) if tenant_id else ai_provider.env_ai_config()
            review, meta = await _review_contract_text(
                text, vendor_name=vendor_name or "(unnamed vendor)", file_name=file_name or "contract",
                country=country, lang=lang, cfg=cfg, user_id=user_id, tenant_id=tenant_id)
            review_text = _contract_review_text(review, meta, file_name=file_name or "contract", lang=lang)
            logger.info("vendor.contract.review_done contract_id=%s excerpts=%d findings=%d rating=%s attempts=%d",
                        contract_id, meta["chunks"], meta["findings"], meta.get("rating"), meta.get("attempts"))
    except _ContractReviewFailed as exc:
        failure = (exc.kind, exc.detail)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 — recorded as an explicit failure, never a silent "completed"
        logger.exception("vendor.contract.review_error contract_id=%s", contract_id)
        failure = ("error", "Unexpected error during the AI contract review (%s)." % type(exc).__name__)

    if failure is not None:
        logger.warning("vendor.contract.review_failed contract_id=%s kind=%s: %s", contract_id, failure[0], failure[1])
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(VendorContract).where(VendorContract.id == contract_id)
            )
            contract = result.scalar_one_or_none()
            if not contract:
                return
            if ocr_text and ocr_text.strip() and not (contract.extracted_text or "").strip():
                contract.extracted_text = ocr_text
            if failure is None:
                contract.ai_review = review_text
                contract.review_status = "completed"
            else:
                contract.ai_review = _contract_failure_notice(failure[0], failure[1], lang)
                contract.review_status = "error"
            contract.validation_status = ContractValidationStatus.AI_REVIEWED.value
            await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("vendor.contract.review_persist_failed contract_id=%s", contract_id)


# ── Contract Validation Workflow Endpoints ─────────────────────────────────

@router.get("/contracts/pending-review", response_model=list[VendorContractResponse])
async def list_contracts_pending_review(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all contracts pending CISO review (AI reviewed but not yet approved/rejected).

    Also returns contracts STRANDED in ``pending_ai``. analyze_contract_async is an
    in-process background task with no retry, so a worker restart (every
    `pm2 restart grceye-backend`) mid-review leaves the contract in ``pending_ai``
    for good — it then appears in no queue and can never be actioned, even though
    ciso_review_contract accepts it. Older rows carry the same shape from before that
    task learned to move a FAILED review to ``ai_reviewed``. The review is bounded by
    settings.AI_ANALYSIS_TIMEOUT_S (240 s), so anything still ``pending_ai`` an hour
    after upload is stranded, not running; ``review_status='error'`` is stranded
    whatever its age.
    """
    stranded_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
    result = await db.execute(
        select(VendorContract)
        .join(Vendor, VendorContract.vendor_id == Vendor.id)
        .where(
            Vendor.tenant_id == tenant_id,
            or_(
                VendorContract.validation_status.in_([
                    ContractValidationStatus.AI_REVIEWED.value,
                    ContractValidationStatus.PENDING_CISO.value,
                ]),
                and_(
                    VendorContract.validation_status == ContractValidationStatus.PENDING_AI.value,
                    or_(
                        VendorContract.review_status == "error",
                        VendorContract.created_at < stranded_cutoff,
                    ),
                ),
            ),
        )
        .order_by(VendorContract.created_at.desc())
    )
    contracts = result.scalars().all()
    return [VendorContractResponse.model_validate(c) for c in contracts]


@router.get("/{vendor_id}/contracts", response_model=list[VendorContractResponse])
async def list_vendor_contracts(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """List all contracts for a specific vendor."""
    # Verify vendor exists and belongs to tenant
    vendor_result = await db.execute(
        select(Vendor).where(Vendor.id == vendor_id, Vendor.tenant_id == tenant_id)
    )
    vendor = vendor_result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    result = await db.execute(
        select(VendorContract)
        .where(VendorContract.vendor_id == vendor_id)
        .order_by(VendorContract.version.desc())
    )
    contracts = result.scalars().all()
    return [VendorContractResponse.model_validate(c) for c in contracts]


@router.get("/contracts/{contract_id}", response_model=VendorContractResponse)
async def get_contract(
    contract_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Get a specific contract with full details."""
    result = await db.execute(
        select(VendorContract)
        .join(Vendor, VendorContract.vendor_id == Vendor.id)
        .where(
            VendorContract.id == contract_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail=_msg("contract_not_found", lang))

    return VendorContractResponse.model_validate(contract)


@router.post("/contracts/{contract_id}/ciso-review", response_model=VendorContractResponse)
async def ciso_review_contract(
    contract_id: str,
    body: CisoReviewRequest,
    db: AsyncSession = Depends(get_db),
    # CISO-only on purpose (tenant_admin/super_admin auto-pass in require_roles):
    # this is the maker-checker step between upload and send-to-vendor. Letting
    # VENDOR_MANAGER approve here would let the same account that uploads a
    # contract self-approve it and satisfy the "must be approved by CISO" gate in
    # send_contract_to_vendor.
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """CISO approves or rejects a contract after review."""
    result = await db.execute(
        select(VendorContract)
        .join(Vendor, VendorContract.vendor_id == Vendor.id)
        .where(
            VendorContract.id == contract_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    contract = result.scalar_one_or_none()

    if not contract:
        raise HTTPException(status_code=404, detail=_msg("contract_not_found", lang))

    if body.action not in ["approve", "reject"]:
        raise HTTPException(status_code=400, detail=_msg("bad_review_action", lang))

    # Update contract with CISO decision
    contract.ciso_reviewer_id = current_user.id
    contract.ciso_comments = body.comments
    contract.ciso_reviewed_at = datetime.utcnow().isoformat()

    if body.action == "approve":
        contract.validation_status = ContractValidationStatus.APPROVED.value
    else:
        contract.validation_status = ContractValidationStatus.REJECTED.value

    await db.commit()
    await db.refresh(contract)

    return VendorContractResponse.model_validate(contract)


@router.post("/contracts/{contract_id}/send-to-vendor", response_model=VendorContractResponse)
async def send_contract_to_vendor(
    contract_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Mark contract as sent to vendor after CISO approval."""
    result = await db.execute(
        select(VendorContract)
        .join(Vendor, VendorContract.vendor_id == Vendor.id)
        .where(
            VendorContract.id == contract_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    contract = result.scalar_one_or_none()

    if not contract:
        raise HTTPException(status_code=404, detail=_msg("contract_not_found", lang))

    if contract.validation_status != ContractValidationStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail=_msg("needs_ciso_approval", lang))

    contract.validation_status = ContractValidationStatus.SENT_TO_VENDOR.value
    contract.sent_to_vendor_at = datetime.utcnow().isoformat()

    await db.commit()
    await db.refresh(contract)

    return VendorContractResponse.model_validate(contract)


# ── Risk Cartography Endpoint ──────────────────────────────────────────────

def _compute_risk_level(score: int) -> str:
    """Convert numeric score (1-25) to risk level."""
    if score >= 16:
        return "critical"
    elif score >= 10:
        return "high"
    elif score >= 5:
        return "medium"
    else:
        return "low"


def _compute_vendor_cartography(vendor: Vendor, contracts: list[VendorContract]) -> list[RiskDimension]:
    """Compute risk dimensions for a vendor based on available data."""
    dimensions = []

    # Get risk tier multiplier
    tier_multipliers = {
        "critical": 1.5,
        "high": 1.2,
        "medium": 1.0,
        "low": 0.7,
    }
    tier_mult = tier_multipliers.get(vendor.risk_tier.value if hasattr(vendor.risk_tier, 'value') else str(vendor.risk_tier), 1.0)

    # Check if there's an approved contract
    has_approved_contract = any(
        c.validation_status == ContractValidationStatus.APPROVED.value or
        c.validation_status == ContractValidationStatus.SENT_TO_VENDOR.value
        for c in contracts
    )
    # Only reviews the AI actually produced count (a failed review carries an explicit failure notice)
    reviewed = [c for c in contracts if c.ai_review and c.review_status != "error"]
    has_ai_reviewed_contract = bool(reviewed)

    # Analyze AI review for keywords
    combined_review = " ".join([c.ai_review or "" for c in reviewed]).lower()

    # 1. DATA PROTECTION
    data_likelihood = 3
    data_impact = 4
    data_indicators = []
    if vendor.has_data_processing_agreement:
        data_likelihood -= 1
        data_indicators.append("✓ Data Processing Agreement signed")
    else:
        data_likelihood += 1
        data_indicators.append("✗ No DPA signed")
    if "gdpr" in combined_review or "encryption" in combined_review or "aes-256" in combined_review:
        data_likelihood -= 1
        data_indicators.append("✓ Encryption & privacy controls mentioned")
    if "data breach" in combined_review and "24 hours" in combined_review:
        data_indicators.append("✓ Breach notification SLA defined")
    data_likelihood = max(1, min(5, int(data_likelihood * tier_mult)))
    data_score = data_likelihood * data_impact
    dimensions.append(RiskDimension(
        category="data_protection",
        label="Data Protection",
        likelihood=data_likelihood,
        impact=data_impact,
        score=data_score,
        level=_compute_risk_level(data_score),
        description="Risk related to vendor's handling, storage, and protection of sensitive data.",
        indicators=data_indicators or ["No specific indicators available"],
    ))

    # 2. COMPLIANCE
    comp_likelihood = 3
    comp_impact = 4
    comp_indicators = []
    cert_keywords = ["iso 27001", "iso/iec 27001", "soc 2", "soc2", "pci dss", "hipaa"]
    cert_count = sum(1 for kw in cert_keywords if kw in combined_review)
    if cert_count >= 2:
        comp_likelihood -= 2
        comp_indicators.append(f"✓ {cert_count} security certifications identified")
    elif cert_count == 1:
        comp_likelihood -= 1
        comp_indicators.append("✓ 1 security certification identified")
    else:
        comp_likelihood += 1
        comp_indicators.append("✗ No certifications identified in contract")
    if vendor.industry and vendor.industry.lower() in ["financial services", "healthcare services", "payment processing"]:
        comp_impact = 5
        comp_indicators.append(f"⚠ High-regulation industry: {vendor.industry}")
    comp_likelihood = max(1, min(5, int(comp_likelihood * tier_mult)))
    comp_score = comp_likelihood * comp_impact
    dimensions.append(RiskDimension(
        category="compliance",
        label="Compliance & Standards",
        likelihood=comp_likelihood,
        impact=comp_impact,
        score=comp_score,
        level=_compute_risk_level(comp_score),
        description="Risk of non-compliance with regulations and industry standards.",
        indicators=comp_indicators,
    ))

    # 3. OPERATIONAL
    op_likelihood = 3
    op_impact = 3
    op_indicators = []
    if "99.9" in combined_review or "uptime" in combined_review:
        op_likelihood -= 1
        op_indicators.append("✓ SLA uptime guarantees defined")
    if "24/7" in combined_review or "24x7" in combined_review:
        op_indicators.append("✓ 24/7 support available")
    if vendor.status == "active":
        op_indicators.append("✓ Vendor currently active")
    elif vendor.status in ["under_review", "offboarding"]:
        op_likelihood += 1
        op_indicators.append(f"⚠ Status: {vendor.status}")
    op_likelihood = max(1, min(5, int(op_likelihood * tier_mult)))
    op_score = op_likelihood * op_impact
    dimensions.append(RiskDimension(
        category="operational",
        label="Operational",
        likelihood=op_likelihood,
        impact=op_impact,
        score=op_score,
        level=_compute_risk_level(op_score),
        description="Risk of service disruption or operational failures.",
        indicators=op_indicators or ["Standard operational risk"],
    ))

    # 4. FINANCIAL
    fin_likelihood = 2
    fin_impact = 3
    fin_indicators = []
    if vendor.contract_expiry:
        from datetime import datetime as dt
        try:
            expiry = dt.fromisoformat(vendor.contract_expiry)
            days_to_expiry = (expiry - dt.now()).days
            if days_to_expiry < 30:
                fin_likelihood += 2
                fin_indicators.append(f"⚠ Contract expires in {days_to_expiry} days")
            elif days_to_expiry < 90:
                fin_likelihood += 1
                fin_indicators.append(f"⚠ Contract expires in {days_to_expiry} days")
            else:
                fin_indicators.append(f"✓ Contract valid for {days_to_expiry} days")
        except (ValueError, TypeError):
            pass
    else:
        fin_likelihood += 1
        fin_indicators.append("⚠ No contract expiry date set")
    fin_likelihood = max(1, min(5, int(fin_likelihood * tier_mult)))
    fin_score = fin_likelihood * fin_impact
    dimensions.append(RiskDimension(
        category="financial",
        label="Financial",
        likelihood=fin_likelihood,
        impact=fin_impact,
        score=fin_score,
        level=_compute_risk_level(fin_score),
        description="Financial and contractual risk exposure.",
        indicators=fin_indicators or ["Standard financial risk"],
    ))

    # 5. LEGAL / CONTRACT
    legal_likelihood = 3
    legal_impact = 4
    legal_indicators = []
    if has_approved_contract:
        legal_likelihood -= 2
        legal_indicators.append("✓ Contract reviewed and approved by CISO")
    elif has_ai_reviewed_contract:
        legal_likelihood -= 1
        legal_indicators.append("✓ Contract under AI/CISO review")
    else:
        legal_likelihood += 1
        legal_indicators.append("✗ No contract reviewed")
    if "liability" in combined_review and "indemnif" in combined_review:
        legal_likelihood -= 1
        legal_indicators.append("✓ Liability & indemnification clauses present")
    ratings = [r for r in (_final_rating(c.ai_review) for c in reviewed) if r]
    if ratings:
        worst = min(ratings, key=lambda r: _SEVERITY_RANK.get(r, 9))
        if worst in ("high", "critical"):
            legal_likelihood += 1
            legal_indicators.append("⚠ AI contract review rated %s" % worst.upper())
        else:
            legal_indicators.append("✓ AI contract review rated %s" % worst.upper())
    elif "critical" in combined_review or "high risk" in combined_review:
        legal_likelihood += 1
        legal_indicators.append("⚠ AI flagged critical concerns")
    legal_likelihood = max(1, min(5, int(legal_likelihood * tier_mult)))
    legal_score = legal_likelihood * legal_impact
    dimensions.append(RiskDimension(
        category="legal",
        label="Legal & Contract",
        likelihood=legal_likelihood,
        impact=legal_impact,
        score=legal_score,
        level=_compute_risk_level(legal_score),
        description="Risk from contract terms, liability, and legal exposure.",
        indicators=legal_indicators,
    ))

    # 6. REPUTATIONAL
    rep_likelihood = 2
    rep_impact = 4
    rep_indicators = []
    if vendor.risk_tier.value == "critical" if hasattr(vendor.risk_tier, 'value') else str(vendor.risk_tier) == "critical":
        rep_likelihood += 2
        rep_impact = 5
        rep_indicators.append("⚠ Critical risk tier - high visibility")
    elif vendor.risk_tier.value == "high" if hasattr(vendor.risk_tier, 'value') else str(vendor.risk_tier) == "high":
        rep_likelihood += 1
        rep_indicators.append("⚠ High risk tier")
    if vendor.website:
        rep_indicators.append(f"✓ Public presence: {vendor.website}")
    rep_likelihood = max(1, min(5, rep_likelihood))
    rep_score = rep_likelihood * rep_impact
    dimensions.append(RiskDimension(
        category="reputational",
        label="Reputational",
        likelihood=rep_likelihood,
        impact=rep_impact,
        score=rep_score,
        level=_compute_risk_level(rep_score),
        description="Risk to brand and reputation from vendor incidents.",
        indicators=rep_indicators or ["Standard reputational risk"],
    ))

    return dimensions


@router.get("/{vendor_id}/cartography", response_model=VendorRiskCartographyResponse)
async def get_vendor_risk_cartography(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Compute and return risk cartography (6 dimensions) for a vendor."""
    # Get vendor
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail=_msg("vendor_not_found", lang))

    # Get vendor contracts
    contracts_result = await db.execute(
        select(VendorContract).where(VendorContract.vendor_id == vendor_id)
    )
    contracts = list(contracts_result.scalars().all())

    # Compute dimensions
    dimensions = _compute_vendor_cartography(vendor, contracts)

    # Compute overall score (average of all dimensions)
    overall_score = sum(d.score for d in dimensions) / len(dimensions) if dimensions else 0
    overall_level = _compute_risk_level(int(overall_score))

    return VendorRiskCartographyResponse(
        vendor_id=vendor.id,
        vendor_name=vendor.name,
        overall_score=round(overall_score, 1),
        overall_level=overall_level,
        dimensions=dimensions,
        generated_at=datetime.utcnow(),
    )


# ── Prescreen Questionnaire Endpoint ───────────────────────────────────────

@router.post("/prescreen", response_model=PrescreenQuestionnaireResponse)
async def prescreen_vendor_questionnaire(
    body: PrescreenQuestionnaireRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Analyze a vendor questionnaire BEFORE saving the vendor (``vendor_prescreen`` task).

    The platform first computes a deterministic, criticality-weighted baseline score; the model
    explains the posture, cites the answer behind every strength / concern / red flag and may move
    the score by at most ±1.0 (enforced by the consistency check and fix-ups). Same response fields
    as before plus additive ones; a failed call is an explicit HTTP 424 — the old keyword-heuristic
    fallback that faked a verdict is gone.
    """
    ai_quota.check_quota_or_raise(current_user.id)
    responses = _bounded_responses(body.responses)
    if not responses:
        raise HTTPException(status_code=422, detail=_msg("prescreen_empty", lang))
    counts = _answer_counts(responses)
    baseline_score, baseline_level, _tiers = ai_prompts.prescreen_baseline(responses)

    try:
        system = ai_prompts.system_prompt("vendor_prescreen", lang=lang,
                                          extra_context=_regimes_context(body.vendor_country))
        user = ai_prompts.render_user_prompt(
            "vendor_prescreen",
            vendor_name=ai_provider.clean_field(body.vendor_name) or "(unnamed vendor)",
            industry=ai_provider.clean_field(body.vendor_industry, 100) or "not stated",
            country=ai_provider.clean_field(body.vendor_country, 10) or "not stated",
            yes=counts["yes"], no=counts["no"], na=counts["na"] + counts["partial"], total=counts["total"],
            baseline_line="Platform baseline score: %.1f / 10 (level: %s)" % (baseline_score, baseline_level),
            questionnaire_block=_questionnaire_block(responses),
        )
        d = ai_prompts.task_defaults("vendor_prescreen")
        res = await ai_structured(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            ai_prompts.task_schema("vendor_prescreen"), schema_in_prompt=False,
            check=lambda data: ai_prompts.consistency_issues("vendor_prescreen", data, baseline=baseline_score),
            user_id=current_user.id, tenant_id=tenant_id, db=db, task="vendors.prescreen",
            **ai_provider.decoding(d["preset"], temperature=d["temperature"]),
        )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — never a 5xx: the SPA redirects to /service-down
        logger.exception("vendor.prescreen.error")
        raise HTTPException(status_code=424,
                            detail="%s (error: prescreen failed unexpectedly)" % failure_message("error", lang))

    if not res.ok:
        logger.warning("vendor.prescreen.failed kind=%s attempts=%d: %s", res.kind, res.attempts, res.error)
        raise HTTPException(status_code=424, detail=_ai_failure_detail(res, lang))

    data = ai_prompts.apply_fixups("vendor_prescreen", res.data, baseline=baseline_score)
    warnings = [str(w) for w in (data.get("warnings") or []) if str(w).strip()]
    if len(body.responses) > len(responses):
        warnings.append("Only the first %d answers were analysed (%d supplied)." % (len(responses), len(body.responses)))

    def _items(key: str) -> list[str]:
        return [" ".join(str(x).split()) for x in (data.get(key) or []) if str(x).strip()]

    return PrescreenQuestionnaireResponse(
        initial_risk_score=float(data["initial_risk_score"]),
        risk_level=str(data["risk_level"]),
        summary=" ".join(str(data.get("summary") or "").split()),
        strengths=_items("strengths"),
        concerns=_items("concerns"),
        red_flags=_items("red_flags"),
        recommendations=_items("recommendations"),
        questionnaire_responses=body.responses,
        score_rationale=(" ".join(str(data.get("score_rationale") or "").split()) or None),
        warnings=warnings,
        baseline_score=baseline_score,
        baseline_level=baseline_level,
        language=lang,
    )
