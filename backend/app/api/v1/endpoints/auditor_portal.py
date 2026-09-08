"""Auditor portal endpoints — restricted view for external auditors.

The report generator (`generate_audit_report`, the only LLM call site in this file) is
built on the shared AI foundation (app.services.ai_prompts / ai_provider / ai_locale /
ai_chunking): the `audit_report` expert system prompt with explicit evaluation criteria
(finding vs. observation vs. not-assessed, a severity rule, a certification-opinion rule),
Accept-Language-aware output, delimited untrusted input (auditor notes, scope text), tuned
deterministic decoding and honest failure frames instead of a silently degraded report.

STB objectif 5 (« Réalisation de l'audit ») added the engagement half of this portal:
an auditor now sees the *audits* they were assigned (auditor_assignments.audit_id),
works through the audit's own customisable grid when one is set (audits.grid_id) with
today's framework-controls checklist as the fallback, records a verdict into the real
control_assessments.auditor_* columns instead of smuggling it into the N/A
justification, files constats, and attaches real evidence bytes through a route their
role is actually allowed to call.
"""
import asyncio
import logging
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated, Any
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, or_, select
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import get_db
from app.core import ai_quota
from app.core.security_utils import (
    assert_path_within,
    assert_safe_upload_name,
    assert_user_in_tenant,
    sanitize_filename,
    verify_file_signature,
)
from app.models.activity_log import ActivityLog
from app.models.audit import (
    Audit, AuditEvidence, AuditFinding, FindingSeverity, FindingStatus,
)
from app.models.audit_grid import (
    DEFAULT_GRID_LEVELS, AuditGrid, AuditGridItem, AuditGridResponse,
)
from app.models.compliance_scale import DEFAULT_SCALE_LEVELS, ComplianceScale
from app.models.user import User, UserRole
from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus, UploadedDocument, Evidence
from app.models.auditor_assignment import AuditorAssignment
from app.models.mandatory_document import MandatoryDocument
from app.models.framework import Framework, FrameworkControl
from app.api.v1.dependencies import get_current_user, get_tenant_id
from app.api.v1.dependencies.auth import require_roles
from app.services import ai_prompts, ai_provider, file_integrity
from app.services.activity_chain import chain_and_add
from app.services.ai_chunking import chunk_text, estimate_tokens, input_budget
from app.services.ai_locale import get_request_language

logger = logging.getLogger(__name__)

router = APIRouter()


_NOT_ASSIGNED = "Not assigned to this assessment"
_NOT_ASSIGNED_AUDIT = "Not assigned to this audit"
_FINDINGS_KEYS = frozenset({"verified", "finding", "observation", "na", "unreviewed"})
_AUDITOR_NOTE_RE = re.compile(r"\[AUDITOR:(\w+)\] ?(.*)", re.DOTALL)
_SLOT_RESERVE_TOKENS = 1_500   # template text + one-line slots, kept out of the body budget

# The four verdict tokens the shipped AuditChecklistPage has always sent, and the
# only ones the report's own buckets are named after. They stay valid whatever
# scale an engagement runs on: rejecting them would 422 every save the current
# frontend makes, and every legacy row already carries one of them.
_LEGACY_VERDICT_KEYS = frozenset({"verified", "finding", "observation", "na"})

# « Attribution d'un niveau de conformité ou de non-conformité » — what KIND of
# constat this is, as opposed to how bad it is. AuditFinding.finding_type is
# nullable, so a caller that sends nothing still gets a meaningful value rather
# than a blank column nobody can report on.
_FINDING_TYPE_FOR_SEVERITY = {
    "critical": "non_conformite_majeure",
    "high": "non_conformite_majeure",
    "medium": "non_conformite_mineure",
    "low": "non_conformite_mineure",
    "observation": "observation",
}

# Evidence an auditor may attach. Same spread compliance.py accepts, plus images:
# an auditor photographs a server room or a signed register far more often than
# they receive it as a PDF.
_EVIDENCE_EXTENSIONS = (".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".csv",
                        ".png", ".jpg", ".jpeg")


def _utcnow() -> datetime:
    """Naive UTC, matching how the rest of the app stores timestamps."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: Any) -> str | None:
    """ISO-8601 for a datetime column, tolerant of the string columns nearby."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _clean_levels(raw: Any) -> list[dict] | None:
    """Accept a JSON `levels` column only when it is really a list of level dicts
    carrying a key — a half-written custom grid must not silently become the scale
    every verdict is validated against."""
    if not isinstance(raw, list):
        return None
    levels = [lv for lv in raw if isinstance(lv, dict) and lv.get("key")]
    return levels or None


def _bucket_for_level(level: dict) -> str:
    """Map one scale level onto the report's four buckets, from the level's own
    data rather than a hard-coded name list — that is what makes a tenant-defined
    five-level maturity scale reportable without touching this file.

    `is_gap` is AuditGrid's flag and `counts_as_gap` is ComplianceScale's; both
    shapes are read so one function serves a grid and a scale.
    """
    weight = level.get("weight")
    if weight is None:                       # « non applicable » — excluded from scoring
        return "na"
    if not (level.get("is_gap") or level.get("counts_as_gap")):
        return "verified"
    try:
        numeric = float(weight)
    except (TypeError, ValueError):
        numeric = 0.0
    # A gap worth nothing is a non-conformity; a partial credit is an observation.
    return "finding" if numeric <= 0 else "observation"


def _bucket_for_verdict(verdict: str | None, levels: list[dict]) -> str | None:
    """The report bucket a recorded verdict belongs to, or None when the verdict
    is absent/unrecognised — never assumed to conform (same rule the report has
    always applied to a missing verdict).

    This engagement's own scale is consulted FIRST: a tenant is free to name a
    level "na" or "observation" and give it different weight/is_gap semantics,
    and the level's own definition has to win over the legacy token of the same
    name. The four legacy tokens remain the fallback, which is what keeps the
    1743 rows written before the scale existed reporting exactly as they did.
    """
    if not verdict:
        return None
    for level in levels:
        if level.get("key") == verdict:
            return _bucket_for_level(level)
    if verdict in _LEGACY_VERDICT_KEYS:
        return verdict
    return None


def _recorded_verdict(ca: Any) -> tuple[str | None, str]:
    """The auditor's verdict + note for one control assessment.

    Reads the dedicated columns first. Rows written before those columns existed
    kept the verdict inside not_applicable_justification as "[AUDITOR:x] note",
    so the regex stays as a READ-ONLY fallback — 1743 live control assessments
    would otherwise lose every verdict they carry.
    """
    verdict = (getattr(ca, "auditor_verdict", None) or "").strip()
    if verdict:
        return verdict, (getattr(ca, "auditor_note", None) or "")
    match = _AUDITOR_NOTE_RE.match(ca.not_applicable_justification or "")
    if match and match.group(1) in _LEGACY_VERDICT_KEYS:
        return match.group(1), (match.group(2) or "")
    return None, ""


def _legacy_auditor_notes(ca: Any) -> str | None:
    """The "[AUDITOR:x] note" string the shipped AuditChecklistPage still parses.

    Composed from the real columns when they are set, so the current frontend keeps
    working unchanged while the data lives where it belongs; otherwise the raw
    column is returned exactly as before.
    """
    verdict = (getattr(ca, "auditor_verdict", None) or "").strip()
    if verdict:
        return "[AUDITOR:%s] %s" % (verdict, getattr(ca, "auditor_note", None) or "")
    return ca.not_applicable_justification


def _scale_payload(levels: list[dict], source: str,
                   source_id: str | None = None, source_name: str | None = None) -> dict:
    """The verdict scale, shipped with the checklist so the UI renders the levels
    this engagement actually uses (with their fr/en/ar labels) instead of the four
    English tokens hard-coded in the page today."""
    return {
        "source": source,                # "grid" | "assessment_scale" | "default"
        "source_id": source_id,
        "source_name": source_name,
        "levels": levels,
        # Always accepted alongside the levels above — see _LEGACY_VERDICT_KEYS.
        "legacy_keys": sorted(_LEGACY_VERDICT_KEYS),
    }


def _validate_verdict(verdict: str, levels: list[dict], *, field: str = "verdict",
                     allow_legacy: bool = True) -> str:
    """Server-side check that a verdict is one this engagement's scale defines.

    Before this, any string at all was accepted and written into the justification
    column, so "Conforme", "ok" and a typo were all equally valid and nothing
    downstream could count them.
    """
    verdict = (verdict or "").strip()
    keys = {str(lv.get("key")) for lv in levels if lv.get("key")}
    # `allow_legacy` is False for a grid answer: audit_grid_responses is a brand
    # new table with no legacy rows to protect, and endpoints/audit_grids.py
    # validates the same column strictly against the grid's own keys. Accepting
    # "verified" there would store a key the grid cannot label.
    allowed = keys | (_LEGACY_VERDICT_KEYS if allow_legacy else set())
    if verdict in allowed:
        return verdict
    raise HTTPException(
        status_code=422,
        detail="%s: unknown verdict '%s'. Allowed: %s"
               % (field, verdict, sorted(allowed)),
    )


def _build_clause_doc_map(
    visible_docs: list,
    md_map: dict,
) -> dict[str, list[dict]]:
    """Map clause_ref → list of visible checklist document dicts."""
    result: dict[str, list[dict]] = {}
    for d in visible_docs:
        if d.document_type_key and d.document_type_key in md_map:
            md = md_map[d.document_type_key]
            result.setdefault(md.clause_ref, []).append({
                "id": d.id,
                "file_name": d.file_name,
                "document_name": md.document_name,
                "clause_ref": md.clause_ref,
                "content_type": d.content_type,
                "file_size_bytes": d.file_size_bytes,
            })
    return result


def _linked_docs_for_control(ctrl_id: str, clause_doc_map: dict[str, list[dict]]) -> list[dict]:
    """Return all checklist documents whose clause covers the given control identifier."""
    docs: list[dict] = []
    for clause_ref, doc_list in clause_doc_map.items():
        if ctrl_id == clause_ref or ctrl_id.startswith(clause_ref + "."):
            docs.extend(doc_list)
    return docs


def _build_checklist_row(ca: Any, ctrl: Any, clause_doc_map: dict[str, list[dict]], ca_evidence: list | None = None) -> dict:
    """Build a single checklist row dict for a control assessment."""
    ctrl_id = ctrl.control_id if ctrl else ca.control_id
    linked = _linked_docs_for_control(ctrl_id, clause_doc_map)
    for ev in (ca_evidence or []):
        linked.append({
            "id": ev.id,
            "file_name": ev.file_name or ev.name,
            "document_name": ev.name,
            "clause_ref": None,
            "content_type": ev.content_type,
            "file_size_bytes": ev.file_size_bytes,
            "is_evidence": True,
        })
    verdict, note = _recorded_verdict(ca)
    return {
        "control_assessment_id": ca.id,
        "control_identifier": ctrl_id,
        "control_title": ctrl.title if ctrl else "",
        "control_category": ctrl.category if ctrl else None,
        "control_description": ctrl.description if ctrl else None,
        "status": ca.status,
        "company_notes": ca.notes,
        "implementation_notes": ca.implementation_notes,
        # Kept in the legacy "[AUDITOR:x] note" shape the shipped checklist page
        # regex-parses, composed from the real columns when they carry the
        # verdict. Structured fields below are what new callers should read.
        "auditor_notes": _legacy_auditor_notes(ca),
        "auditor_verdict": verdict,
        "auditor_note": note or None,
        "auditor_verdict_at": _iso(getattr(ca, "auditor_verdict_at", None)),
        "auditor_verdict_by_id": getattr(ca, "auditor_verdict_by_id", None),
        # The owner's self-assessment on the assessment's own scale, distinct
        # from the auditor's verdict above.
        "status_key": getattr(ca, "status_key", None),
        "linked_checklist_documents": linked,
    }


def _build_document_row(d: Any, md_map: dict) -> dict:
    """Build a top-level document row dict for the auditor documents list."""
    md = md_map.get(d.document_type_key) if d.document_type_key else None
    return {
        "id": d.id,
        "file_name": d.file_name,
        "document_type_key": d.document_type_key,
        "clause_ref": md.clause_ref if md else None,
        "document_name": md.document_name if md else d.file_name,
        "content_type": d.content_type,
        "file_size_bytes": d.file_size_bytes,
        "created_at": d.created_at.isoformat() if hasattr(d.created_at, "isoformat") else str(d.created_at),
    }


async def _load_visible_evidence(
    db: AsyncSession, assessment_id: str, framework_id: str, ca_ids: list[str],
) -> tuple[dict[str, list[dict]], dict[str, list], list, dict, list]:
    """Load the auditor-visible evidence for one assessment: mandatory-document metadata for
    the framework, checklist uploads and per-control evidence marked visible to the auditor.
    Shared by the checklist route and the report generator so both draw from exactly the same
    evidence set. Returns (clause_doc_map, ca_evidence_map, visible_docs, md_map, all_evidence).
    """
    fw_short_result = await db.execute(select(Framework.short_name).where(Framework.id == framework_id))
    fw_short = fw_short_result.scalar_one_or_none() or ""

    md_result = await db.execute(select(MandatoryDocument).where(MandatoryDocument.framework_short_name == fw_short))
    md_map: dict[str, MandatoryDocument] = {md.document_type_key: md for md in md_result.scalars().all()}

    docs_result = await db.execute(select(UploadedDocument).where(
        UploadedDocument.assessment_id == assessment_id,
        UploadedDocument.is_visible_to_auditor == True,  # noqa: E712
        UploadedDocument.document_type_key.isnot(None),
    ))
    visible_docs = docs_result.scalars().all()

    evidence_result = await db.execute(select(Evidence).where(
        Evidence.control_assessment_id.in_(ca_ids),
        Evidence.is_visible_to_auditor == True,  # noqa: E712
    ))
    all_evidence = evidence_result.scalars().all()
    ca_evidence_map: dict[str, list] = {}
    for ev in all_evidence:
        ca_evidence_map.setdefault(ev.control_assessment_id, []).append(ev)

    clause_doc_map = _build_clause_doc_map(visible_docs, md_map)
    return clause_doc_map, ca_evidence_map, visible_docs, md_map, all_evidence


def _evidence_file_names(ca_id: str, ctrl_id: str, clause_doc_map: dict[str, list[dict]], ca_evidence_map: dict[str, list]) -> list[str]:
    """Deduplicated file names of every auditor-visible document linked to one control
    assessment (checklist uploads matched by clause, plus evidence uploaded directly to the
    control), in first-seen order."""
    names: list[str] = []
    for d in _linked_docs_for_control(ctrl_id, clause_doc_map):
        n = d.get("file_name")
        if n:
            names.append(n)
    for ev in ca_evidence_map.get(ca_id, []):
        n = ev.file_name or ev.name
        if n:
            names.append(n)
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _fmt_finding_line(ref: str, title: str, mandatory: bool, requirement: str, note: str, evidence: list[str]) -> str:
    """One report-ready line for a 'finding' or 'observation' verdict: control id, title, the
    mandatory flag the system prompt's severity rule needs, a one-line requirement, the
    auditor's own note verbatim (quoted, never paraphrased), and the evidence file names
    actually linked to that control (or an explicit 'none provided')."""
    ev_text = ", ".join(ai_provider.clean_field(n, 120) for n in evidence) if evidence else "none provided"
    return (
        "- [%s] %s (mandatory: %s)\n"
        "  requirement: %s\n"
        "  auditor note: \"%s\"\n"
        "  evidence: %s"
    ) % (
        ref, title or "(untitled control)", "yes" if mandatory else "no",
        requirement or "(no requirement text recorded)", note or "(no note recorded)", ev_text,
    )


def _classify_verdicts(
    cas: list, controls: list, ctrl_map: dict,
    clause_doc_map: dict[str, list[dict]], ca_evidence_map: dict[str, list],
    levels: list[dict] | None = None,
) -> dict[str, Any]:
    """Bucket each control assessment by the auditor's recorded verdict, in FRAMEWORK order
    (FrameworkControl.sort_order) rather than database row order, so the report follows the
    framework's own clause sequence. `verified` / `unreviewed` are plain identifier lists (the
    task's own evaluation criteria only need counts + identifiers for those); `finding` /
    `observation` are fully-detailed report lines (see `_fmt_finding_line`); `na` is
    "[ref] title: justification" lines. `n_mandatory` / `n_mandatory_unreviewed` feed the
    certification-opinion rule. A missing or unrecognised verdict token is bucketed as
    unreviewed — never assumed to conform (same fallback the removed `_build_findings` used)."""
    order_index = {c.id: i for i, c in enumerate(controls)}
    cas_ordered = sorted(cas, key=lambda ca: order_index.get(ca.control_id, len(controls)))
    out: dict[str, Any] = {
        "verified": [], "finding": [], "observation": [], "na": [], "unreviewed": [],
        "n_mandatory": sum(1 for c in controls if c.is_mandatory),
        "n_mandatory_unreviewed": 0,
    }
    for ca in cas_ordered:
        ctrl = ctrl_map.get(ca.control_id)
        ref = ctrl.control_id if ctrl else ca.control_id
        title = ctrl.title if ctrl else ""
        mandatory = bool(ctrl.is_mandatory) if ctrl else False
        requirement = (
            ai_provider.clean_field(ctrl.description, 300) if (ctrl and ctrl.description)
            else ai_provider.clean_field(title, 300)
        )
        # Dedicated columns first, legacy "[AUDITOR:x]" text as the read-only
        # fallback; a scale key ("partiellement_conforme") is mapped onto the
        # bucket its own level definition implies, so a custom grid reports
        # correctly without the prompt learning new vocabulary.
        raw_verdict, raw_note = _recorded_verdict(ca)
        verdict = _bucket_for_verdict(raw_verdict, levels or DEFAULT_SCALE_LEVELS)
        note = ai_provider.clean_field(raw_note, 600) if raw_note else ""
        if verdict == "verified":
            out["verified"].append(ref)
        elif verdict in ("finding", "observation"):
            evidence = _evidence_file_names(ca.id, ref, clause_doc_map, ca_evidence_map)
            out[verdict].append(_fmt_finding_line(ref, title, mandatory, requirement, note, evidence))
        elif verdict == "na":
            out["na"].append("- [%s] %s: %s" % (ref, title or "(untitled control)", note or "(no justification recorded)"))
        else:
            out["unreviewed"].append(ref)
            if mandatory:
                out["n_mandatory_unreviewed"] += 1
    return out


def _capped_lines(lines: list[str], max_tokens: int) -> tuple[str, int]:
    """Join ``lines`` (one report entry each) up to ``max_tokens`` (boundary-aware: an entry is
    never split, and the first is always kept even if it alone exceeds the budget). Returns
    (joined text, or "(none)" when empty; how many entries were kept) so the caller can note how
    many were left out instead of silently overflowing the model's context."""
    kept: list[str] = []
    used = 0
    for line in lines:
        t = estimate_tokens(line)
        if kept and used + t > max_tokens:
            break
        kept.append(line)
        used += t
    return ("\n".join(kept) if kept else "(none)"), len(kept)


def _cap_join(items: list[str], sep: str, max_tokens: int) -> tuple[str, int]:
    """Like `_capped_lines` but for compact identifier lists joined with `sep`."""
    kept: list[str] = []
    used = 0
    for it in items:
        t = estimate_tokens(it)
        if kept and used + t > max_tokens:
            break
        kept.append(it)
        used += t
    return (sep.join(kept) if kept else "(none)"), len(kept)


def _more_note(total: int, kept: int) -> str:
    return "" if kept >= total else " (+%d more not shown here)" % (total - kept)


def _delimit_capped(text: str | None, label: str, *, max_tokens: int) -> str:
    """delimit_untrusted(text) when it fits `max_tokens`; otherwise the first boundary-aware
    chunk (ai_chunking.chunk_text — never a mid-word slice) plus an explicit note, so the model
    never assumes it saw the whole text. "" for empty/blank input."""
    text = text or ""
    if not text.strip():
        return ""
    total = estimate_tokens(text)
    if total <= max_tokens:
        return ai_provider.delimit_untrusted(text, label, max_len=len(text) + 1)
    parts = chunk_text(text, max(200, max_tokens), overlap_tokens=0)
    kept = parts[0] if parts else ""
    body = (
        "NOTE: the %s text was longer than fits in one pass; only part 1 of %d is included below. "
        "Do not assume the remainder conforms.\n\n%s" % (label, len(parts), kept)
    )
    return ai_provider.delimit_untrusted(body, label, max_len=len(body) + 1)


async def _preflight_or_424(cfg: ai_provider.AIConfig, lang: str) -> None:
    """Reachability check BEFORE the StreamingResponse is returned, so an AI outage becomes a
    clean HTTP error (the frontend's pre-stream error banner) instead of an error frame glued
    into the report body that Copy / Download would still offer as the deliverable."""
    try:
        await ai_provider.preflight(cfg)
    except ai_provider.AICallError as exc:
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY, detail=exc.user_message(lang))

# ── Engagement / grid helpers ────────────────────────────────────────────────
#
# Every one of these touches a table or column only when the pointer that needs
# it is actually set (audit.grid_id, assessment.scale_id). The grid and scale
# tables are created by create_all() at the next restart and no live row points
# at them yet, so on today's data these helpers never query them — which is also
# why an absent new table cannot break an existing engagement.


async def _load_grid(db: AsyncSession, audit: Any | None) -> AuditGrid | None:
    """The audit's grid — loaded INSIDE the audit's own tenant.

    audits.grid_id is a plain foreign key with no cross-tenant guard of its own,
    so an id set by an import, a restored row or a future picker bug could point
    at another tenant's grid; endpoints/audit_grids.py applies exactly this
    filter for the same reason. A pointer that does not resolve inside the
    tenant degrades to the framework-controls fallback rather than serving
    another tenant's rows to this auditor.
    """
    grid_id = getattr(audit, "grid_id", None) if audit is not None else None
    if not grid_id:
        return None
    return (await db.execute(
        select(AuditGrid).where(
            AuditGrid.id == grid_id,
            AuditGrid.tenant_id == audit.tenant_id,
        )
    )).scalars().first()


async def _load_scale(db: AsyncSession, assessment: Any | None) -> ComplianceScale | None:
    """The assessment's conformity scale, tenant-scoped.

    A scale is either the tenant's own or a shared built-in (tenant_id NULL,
    is_builtin true) — the same visibility rule endpoints/compliance_scales.py
    and risk_matrices.py enforce.
    """
    scale_id = getattr(assessment, "scale_id", None) if assessment is not None else None
    if not scale_id:
        return None
    return (await db.execute(
        select(ComplianceScale).where(
            ComplianceScale.id == scale_id,
            or_(ComplianceScale.tenant_id == assessment.tenant_id,
                ComplianceScale.is_builtin == True),  # noqa: E712
        )
    )).scalars().first()


def _grid_levels(grid: Any) -> list[dict]:
    """A grid's verdict scale; a null/malformed `levels` means the default."""
    return _clean_levels(grid.levels) or list(DEFAULT_GRID_LEVELS)


async def _verdict_levels(
    db: AsyncSession, assessment: Any | None, audit: Any | None = None,
) -> list[dict]:
    """The verdict scale this engagement is graded on.

    Precedence: the audit's own grid (objectif 5, « une grille d'évaluation
    personnalisable ») → the assessment's conformity scale (objectif 2) → the
    default the tender names (conforme / partiellement conforme / non conforme /
    non applicable). A grid row whose `levels` is null means "use the default
    grid levels", exactly as the model documents.
    """
    grid = await _load_grid(db, audit)
    if grid is not None:
        return _grid_levels(grid)
    scale = await _load_scale(db, assessment)
    if scale is not None:
        return _clean_levels(scale.levels) or list(DEFAULT_SCALE_LEVELS)
    return list(DEFAULT_SCALE_LEVELS)


async def _scale_for(db: AsyncSession, assessment: Any | None, audit: Any | None) -> dict:
    """`_verdict_levels` plus the provenance the UI needs to label the scale."""
    grid = await _load_grid(db, audit)
    if grid is not None:
        return _scale_payload(_grid_levels(grid), "grid", grid.id, grid.name)
    scale = await _load_scale(db, assessment)
    if scale is not None:
        return _scale_payload(
            _clean_levels(scale.levels) or list(DEFAULT_SCALE_LEVELS),
            "assessment_scale", scale.id, scale.name,
        )
    return _scale_payload(list(DEFAULT_SCALE_LEVELS), "default")


async def _assigned_audit_ids(db: AsyncSession, user: User, tenant_id: str) -> list[str]:
    """Ids of the engagements this auditor may see.

    Three sources, because auditor_assignments.audit_id is brand new and NULL on
    all four live assignment rows: the new direct link, the legacy
    assessment-scoped assignment resolved through audits.assessment_id, and the
    engagement the person is named lead auditor on. Without the last two the
    route would correctly return an empty list to every real auditor on the
    live database.
    """
    rows = (await db.execute(
        select(AuditorAssignment.audit_id, AuditorAssignment.assessment_id).where(
            AuditorAssignment.auditor_id == user.id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.is_active == True,  # noqa: E712
        )
    )).all()
    direct = [r[0] for r in rows if r[0]]
    assessment_ids = [r[1] for r in rows if r[1]]

    conditions = [Audit.lead_auditor_id == user.id]
    if direct:
        conditions.append(Audit.id.in_(direct))
    if assessment_ids:
        conditions.append(Audit.assessment_id.in_(assessment_ids))

    ids = (await db.execute(
        select(Audit.id).where(
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
            or_(*conditions),
        )
    )).scalars().all()
    return list(ids)


async def _assigned_audit(db: AsyncSession, user: User, tenant_id: str, audit_id: str) -> Audit:
    """Load one engagement, 403 unless this auditor is assigned to it.

    Tenant-scoped in the same statement so a guessed id from another tenant is a
    403/404, never a read.
    """
    audit = (await db.execute(
        select(Audit).where(
            Audit.id == audit_id,
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
    if audit.id not in await _assigned_audit_ids(db, user, tenant_id):
        raise HTTPException(status_code=403, detail=_NOT_ASSIGNED_AUDIT)
    return audit


async def _grid_audit_for_assessment(
    db: AsyncSession, tenant_id: str, assessment_id: str,
) -> Audit | None:
    """The engagement whose grid governs verdicts on this assessment, if any.

    Only rows that actually point at a grid are considered, so an assessment
    with no grid-driven engagement never pays for this lookup twice.
    """
    return (await db.execute(
        select(Audit).where(
            Audit.tenant_id == tenant_id,
            Audit.assessment_id == assessment_id,
            Audit.grid_id.isnot(None),
            Audit.deleted_at.is_(None),
        ).order_by(Audit.created_at.desc()).limit(1)
    )).scalars().first()


async def _grid_payload(db: AsyncSession, audit: Any) -> dict | None:
    """The audit's grid as a checklist: its rows plus this engagement's answers.

    Returns None when the engagement has no grid, which is what makes the
    framework-controls checklist below the documented fallback rather than a
    special case.
    """
    grid = await _load_grid(db, audit)
    if grid is None:
        return None

    items = (await db.execute(
        select(AuditGridItem)
        .where(AuditGridItem.grid_id == grid.id)
        .order_by(AuditGridItem.sort_order, AuditGridItem.created_at)
    )).scalars().all()
    responses = (await db.execute(
        select(AuditGridResponse).where(AuditGridResponse.audit_id == audit.id)
    )).scalars().all()
    by_item = {r.item_id: r for r in responses}

    rows = []
    for item in items:
        response = by_item.get(item.id)
        rows.append({
            "item_id": item.id,
            "ref_code": item.ref_code,
            "title": item.title,
            "description": item.description,
            "guidance": item.guidance,
            "section": item.section,
            "sort_order": item.sort_order,
            "control_id": item.control_id,
            "is_mandatory": item.is_mandatory,
            "verdict": response.verdict if response else None,
            "note": response.note if response else None,
            "answered_at": _iso(response.answered_at) if response else None,
            "answered_by_id": response.answered_by_id if response else None,
        })
    answered = sum(1 for r in rows if r["verdict"])
    return {
        "grid_id": grid.id,
        "grid_name": grid.name,
        "grid_description": grid.description,
        "items_total": len(rows),
        "items_answered": answered,
        "items": rows,
    }


async def _assessment_checklist_payload(
    db: AsyncSession, assessment: Any,
) -> tuple[list[dict], list[dict], list]:
    """Today's checklist: one row per control assessment plus the auditor-visible
    document panel. Extracted verbatim from `get_audit_checklist` so the
    audit-scoped route can fall back to exactly the same behaviour rather than a
    second, drifting implementation. Returns (controls, documents, cas)."""
    cas = (await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
    )).scalars().all()

    controls = (await db.execute(
        select(FrameworkControl).where(FrameworkControl.framework_id == assessment.framework_id)
        .order_by(FrameworkControl.sort_order)
    )).scalars().all()
    ctrl_map = {c.id: c for c in controls}

    # Mandatory-document metadata and auditor-visible evidence, shared with the report route.
    clause_doc_map, ca_evidence_map, visible_docs, md_map, all_evidence = await _load_visible_evidence(
        db, assessment.id, assessment.framework_id, [ca.id for ca in cas]
    )

    checklist = [
        _build_checklist_row(ca, ctrl_map.get(ca.control_id), clause_doc_map, ca_evidence_map.get(ca.id))
        for ca in cas
    ]
    documents = [_build_document_row(d, md_map) for d in visible_docs]
    # Also surface evidence files in the top-level documents panel
    for ev in all_evidence:
        documents.append({
            "id": ev.id,
            "file_name": ev.file_name or ev.name,
            "document_type_key": None,
            "clause_ref": None,
            "document_name": ev.name,
            "content_type": ev.content_type,
            "file_size_bytes": ev.file_size_bytes,
            "created_at": _iso(ev.created_at),
            "is_evidence": True,
        })
    return checklist, documents, list(cas)


class AuditorControlUpdate(BaseModel):
    # A key from this engagement's scale — the legacy four ("verified" |
    # "finding" | "observation" | "na") or a level of the audit's grid /
    # the assessment's conformity scale ("conforme", "non_conforme", ...).
    # Validated server-side by _validate_verdict; free text is no longer accepted.
    verdict: str | None = None
    auditor_notes: str | None = None


@router.get("/my-assignments")
async def get_my_assignments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Return all active assessment assignments for the current auditor."""
    result = await db.execute(
        select(AuditorAssignment).where(
            AuditorAssignment.auditor_id == current_user.id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.is_active == True,  # noqa: E712
        )
    )
    assignments = result.scalars().all()

    items = []
    for asgn in assignments:
        assessment_result = await db.execute(
            select(ComplianceAssessment).where(ComplianceAssessment.id == asgn.assessment_id)
        )
        assessment = assessment_result.scalar_one_or_none()
        if not assessment:
            continue

        fw_result = await db.execute(select(Framework).where(Framework.id == assessment.framework_id))
        fw = fw_result.scalar_one_or_none()

        # Progress. This used to count control assessments whose `notes` — the
        # COMPANY's own commentary — happened to contain the substring
        # "verified", so it read ~0 on every real engagement and the portal's
        # progress bar never moved. Count the auditor's actual verdicts instead,
        # through the same scale the checklist validates against.
        ca_result = await db.execute(
            select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
        )
        cas = ca_result.scalars().all()
        total = len(cas)
        # The SAME scale the checklist validated those verdicts against. Without
        # the grid arm, a verdict recorded on a custom grid ("maitrise",
        # "a_confirmer", ...) matches no level here, buckets to None and counts
        # as un-reviewed — which would put the progress bar back at the 0% this
        # route was fixed to stop reporting, on exactly the grid-driven
        # engagements objectif 5 introduces.
        progress_audit = await _grid_audit_for_assessment(db, tenant_id, assessment.id)
        levels = await _verdict_levels(db, assessment, progress_audit)
        counts = {"verified": 0, "finding": 0, "observation": 0, "na": 0}
        reviewed = 0
        for ca in cas:
            raw_verdict, _note = _recorded_verdict(ca)
            bucket = _bucket_for_verdict(raw_verdict, levels)
            if not bucket:
                continue
            reviewed += 1
            counts[bucket] = counts.get(bucket, 0) + 1

        items.append({
            "assignment_id": asgn.id,
            "assessment_id": assessment.id,
            "assessment_name": assessment.name,
            "framework_name": fw.name if fw else "",
            "framework_short_name": fw.short_name if fw else "",
            "status": assessment.status,
            "compliance_score": assessment.compliance_score,
            "controls_total": total,
            # Conformant controls only — the field keeps the meaning its name
            # claims. `controls_reviewed` is the one a progress bar wants.
            "controls_verified": counts["verified"],
            "controls_reviewed": reviewed,
            "controls_findings": counts["finding"],
            "controls_observations": counts["observation"],
            "controls_na": counts["na"],
            # Set once the assignment is made against an engagement rather than
            # a bare assessment (auditor_assignments.audit_id); null on all
            # existing rows, which keeps this list exactly as it was.
            "audit_id": getattr(asgn, "audit_id", None),
            "reference_document_ids": asgn.reference_document_ids,
        })

    return items


@router.get("/assessments/{assessment_id}/checklist")
async def get_audit_checklist(
    assessment_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Return the audit checklist for an assigned assessment (auditor read-only view)."""
    # Verify auditor is assigned to this assessment
    asgn_result = await db.execute(
        select(AuditorAssignment).where(
            AuditorAssignment.auditor_id == current_user.id,
            AuditorAssignment.assessment_id == assessment_id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.is_active == True,  # noqa: E712
        )
    )
    # .first(), not .scalar_one_or_none(): an auditor can legitimately hold BOTH a
    # legacy assessment-scoped assignment and a new engagement-scoped one for the
    # same assessment, and scalar_one_or_none() raises MultipleResultsFound on two
    # rows — a 500 on a perfectly valid pair of assignments.
    if not asgn_result.scalars().first():
        raise HTTPException(status_code=403, detail=_NOT_ASSIGNED)

    assessment_result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = assessment_result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    checklist, documents, _cas = await _assessment_checklist_payload(db, assessment)

    # If an engagement covering this assessment runs on a custom grid, ship the
    # grid alongside the control rows and validate verdicts against its levels.
    # No grid, no engagement: identical response to before, plus the two additive
    # keys below (the current frontend ignores unknown keys).
    grid_audit = await _grid_audit_for_assessment(db, tenant_id, assessment_id)
    return {
        "assessment_id": assessment_id,
        "audit_id": grid_audit.id if grid_audit else None,
        "controls": checklist,
        "documents": documents,
        "verdict_scale": await _scale_for(db, assessment, grid_audit),
        "grid": await _grid_payload(db, grid_audit) if grid_audit else None,
    }


@router.patch("/control-assessments/{control_assessment_id}")
async def update_audit_verdict(
    control_assessment_id: str,
    body: AuditorControlUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Record auditor verdict and notes for a control assessment."""
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

    # Verify auditor is assigned (tenant-scoped to prevent cross-tenant IDOR)
    asgn_result = await db.execute(
        select(AuditorAssignment).where(
            AuditorAssignment.auditor_id == current_user.id,
            AuditorAssignment.assessment_id == assessment.id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.is_active == True,  # noqa: E712
        )
    )
    # .first(), not .scalar_one_or_none(): an auditor can legitimately hold BOTH a
    # legacy assessment-scoped assignment and a new engagement-scoped one for the
    # same assessment, and scalar_one_or_none() raises MultipleResultsFound on two
    # rows — a 500 on a perfectly valid pair of assignments.
    if not asgn_result.scalars().first():
        raise HTTPException(status_code=403, detail=_NOT_ASSIGNED)

    # The verdict is validated against the scale this engagement actually runs
    # on: the grid of an audit covering this assessment when one is set, else the
    # assessment's conformity scale, else the default the tender names.
    grid_audit = await _grid_audit_for_assessment(db, tenant_id, assessment.id)
    levels = await _verdict_levels(db, assessment, grid_audit)

    if body.verdict is not None:
        verdict = _validate_verdict(body.verdict, levels)
    elif body.auditor_notes is not None:
        # A note with no verdict is an observation, as before.
        verdict = "observation"
    else:
        raise HTTPException(status_code=422, detail="Provide a verdict or auditor_notes")

    # The verdict used to be written into not_applicable_justification as
    # "[AUDITOR:x] note" — a column that means something else entirely, whose
    # real content it destroyed, and which could only be read back by regex.
    # Write the dedicated columns instead.
    ca.auditor_verdict = verdict
    ca.auditor_note = body.auditor_notes or None
    ca.auditor_verdict_by_id = current_user.id
    ca.auditor_verdict_at = _utcnow()

    # A row whose justification still holds a legacy "[AUDITOR:...]" blob has now
    # been migrated into the real columns, so clear the blob and give the column
    # its own meaning back. Only ever touched when the regex matches, so a
    # genuine N/A justification written by the company is never lost.
    if _AUDITOR_NOTE_RE.match(ca.not_applicable_justification or ""):
        ca.not_applicable_justification = None

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    # « Traçabilité » — a verdict is an audit act, so it goes into the
    # hash-chained trail with the scale it was given on, not just a row update.
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
        action="auditor_verdict", entity_type="control_assessment",
        entity_id=ca.id, entity_name=assessment.name,
        details={
            "verdict": verdict,
            "assessment_id": assessment.id,
            "grid_id": getattr(grid_audit, "grid_id", None),
            "has_note": bool(body.auditor_notes),
        },
    ))
    return {
        "control_assessment_id": ca.id,
        "verdict": verdict,
        "auditor_note": ca.auditor_note,
        "auditor_verdict_at": _iso(ca.auditor_verdict_at),
        "updated": True,
    }


@router.post("/assessments/{assessment_id}/generate-report")
async def generate_audit_report(
    assessment_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    lang: Annotated[str, Depends(get_request_language)],
) -> StreamingResponse:
    """Stream an AI-generated formal audit report (foundation task `audit_report`, Markdown).

    Built ONLY from the auditor's recorded verdicts, the framework's mandatory-control flags
    and the evidence documents/files actually visible to the auditor — never invented. Each
    finding/observation cites the control identifier verbatim, a one-line requirement, the
    auditor's own note (quoted, never paraphrased) and the evidence file names linked to that
    control; verified and not-assessed controls are reported by identifier and count only
    (never assumed to conform), and the certification-opinion rule is stated with the numbers
    it used — all per the task's own evaluation criteria, so the model has no need to invent a
    methodology, scope or opinion the input does not support.

    Language: Accept-Language via `get_request_language` (en|fr|ar), the same header the SPA's
    axios client already sends for other AI calls. Decoding: the "report" preset (temperature
    0.1, fixed seed, bounded num_predict) instead of provider defaults, so regenerating the
    same recorded verdicts does not materially change the findings or the opinion. Long
    findings/observation/not-applicable lists are capped to the model's context budget with an
    explicit "N more not shown" note (never a silent context overflow); "not assessed" /
    "verified" only ever need identifiers, which is what keeps a 250-control framework's prompt
    small by design. Routed through `ai_provider.load_ai_config` (a tenant's bring-your-own
    endpoint, or the deployment default) instead of a hard-coded local Ollama URL, with a
    `preflight` check that turns an AI outage into a clean 424 before the stream starts rather
    than an error line glued into the report body. On a mid-stream failure the SSE `error`
    frame carries a localised, provider-detail-free message (never a raw upstream body or an
    internal URL) — same frame vocabulary the frontend already reads (`token` / `error` /
    `[DONE]`).
    """
    # Verify assignment
    asgn_result = await db.execute(
        select(AuditorAssignment).where(
            AuditorAssignment.auditor_id == current_user.id,
            AuditorAssignment.assessment_id == assessment_id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.is_active == True,  # noqa: E712
        )
    )
    # .first(), not .scalar_one_or_none(): an auditor can legitimately hold BOTH a
    # legacy assessment-scoped assignment and a new engagement-scoped one for the
    # same assessment, and scalar_one_or_none() raises MultipleResultsFound on two
    # rows — a 500 on a perfectly valid pair of assignments.
    if not asgn_result.scalars().first():
        raise HTTPException(status_code=403, detail=_NOT_ASSIGNED)

    assessment_result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = assessment_result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    fw_result = await db.execute(
        select(Framework).where(Framework.id == assessment.framework_id)
    )
    fw = fw_result.scalar_one_or_none()

    ca_result = await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
    )
    cas = list(ca_result.scalars().all())

    ctrl_result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.framework_id == assessment.framework_id
        ).order_by(FrameworkControl.sort_order)
    )
    controls = list(ctrl_result.scalars().all())
    ctrl_map = {c.id: c for c in controls}

    clause_doc_map, ca_evidence_map, visible_docs, _md_map, all_evidence = await _load_visible_evidence(
        db, assessment_id, assessment.framework_id, [ca.id for ca in cas]
    )

    # Same scale the checklist validated the verdicts against, so a grid key
    # ("partiellement_conforme") lands in the bucket its level defines instead of
    # being reported as never assessed.
    report_grid_audit = await _grid_audit_for_assessment(db, tenant_id, assessment_id)
    report_levels = await _verdict_levels(db, assessment, report_grid_audit)
    buckets = _classify_verdicts(
        cas, controls, ctrl_map, clause_doc_map, ca_evidence_map, report_levels,
    )
    n_verified = len(buckets["verified"])
    n_finding = len(buckets["finding"])
    n_observation = len(buckets["observation"])
    n_na = len(buckets["na"])
    n_unreviewed = len(buckets["unreviewed"])

    # Evidence documents visible to the auditor, for the report header line.
    doc_names_list: list[str] = []
    seen_docs: set[str] = set()
    for d in visible_docs:
        n = d.file_name
        if n and n not in seen_docs:
            seen_docs.add(n)
            doc_names_list.append(n)
    for ev in all_evidence:
        n = ev.file_name or ev.name
        if n and n not in seen_docs:
            seen_docs.add(n)
            doc_names_list.append(n)

    d = ai_prompts.task_defaults("audit_report")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"])
    today_str = date.today().isoformat()
    try:
        system = ai_prompts.system_prompt("audit_report", lang=lang, today=today_str)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=audit_report)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    num_ctx = int(decode.get("num_ctx") or 32768)
    num_predict = int(decode.get("num_predict") or 8192)
    budget = max(1_000, input_budget(num_ctx, system, reserve_output_tokens=num_predict) - _SLOT_RESERVE_TOKENS)

    # Priority allocation: real findings first, then observations, then N/A justifications;
    # verified/unreviewed are cheap (identifiers only) and share what is left.
    findings_text, f_kept = _capped_lines(buckets["finding"], max(500, int(budget * 0.55)))
    observations_text, o_kept = _capped_lines(buckets["observation"], max(300, int(budget * 0.20)))
    na_text, na_kept = _capped_lines(buckets["na"], max(300, int(budget * 0.15)))
    ids_budget = max(400, budget - int(budget * 0.55) - int(budget * 0.20) - int(budget * 0.15))
    verified_text, v_kept = _cap_join(buckets["verified"], ", ", ids_budget // 2)
    unreviewed_text, u_kept = _cap_join(buckets["unreviewed"], ", ", ids_budget - ids_budget // 2)

    findings_block = ai_provider.delimit_untrusted(
        "FINDINGS — NON-CONFORMITIES (%d%s):\n%s" % (n_finding, _more_note(n_finding, f_kept), findings_text),
        "FINDINGS",
    )
    observations_block = ai_provider.delimit_untrusted(
        "OBSERVATIONS (%d%s):\n%s" % (n_observation, _more_note(n_observation, o_kept), observations_text),
        "OBSERVATIONS",
    )
    na_block = ai_provider.delimit_untrusted(
        na_text + _more_note(n_na, na_kept), "NOT_APPLICABLE_NOTES",
    )

    doc_names_text, _kept_docs = _cap_join(
        [ai_provider.clean_field(n, 120) for n in doc_names_list], ", ", 800
    )

    scope_block = _delimit_capped(
        assessment.scope_description, "SCOPE", max_tokens=min(2000, max(300, budget // 6))
    ) or "not stated"

    period = (
        "%s to %s" % (assessment.assessment_start or "?", assessment.assessment_end or "?")
        if (assessment.assessment_start or assessment.assessment_end) else "not stated"
    )

    assessment_name = ai_provider.clean_field(assessment.name, 200) or "(untitled assessment)"
    framework_name = ai_provider.clean_field(fw.name, 200) if fw else "Unknown framework"
    framework_short_name = (ai_provider.clean_field(fw.short_name, 50) if fw else "") or framework_name
    framework_version = (ai_provider.clean_field(fw.version, 30) if fw else "") or "(edition not stated)"
    auditor_name = ai_provider.clean_field(current_user.name, 150) or "the auditor"

    try:
        user_prompt = ai_prompts.render_user_prompt(
            "audit_report",
            assessment_name=assessment_name,
            framework_name=framework_name,
            framework_short_name=framework_short_name,
            framework_version=framework_version,
            auditor_name=auditor_name,
            today=today_str,
            period=period,
            scope_block=scope_block,
            compliance_score=assessment.compliance_score or 0,
            doc_count=len(doc_names_list),
            doc_names=doc_names_text,
            n_verified=n_verified,
            n_finding=n_finding,
            n_observation=n_observation,
            n_na=n_na,
            n_unreviewed=n_unreviewed,
            n_mandatory_unreviewed=buckets["n_mandatory_unreviewed"],
            n_mandatory=buckets["n_mandatory"],
            verified_ids=verified_text + _more_note(n_verified, v_kept),
            na_lines=na_block,
            unreviewed_ids=unreviewed_text + _more_note(n_unreviewed, u_kept),
            findings_block=findings_block,
            observations_block=observations_block,
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=audit_report)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    ai_quota.check_quota_or_raise(current_user.id)
    cfg = await ai_provider.load_ai_config(db, tenant_id)
    await _preflight_or_424(cfg, lang)

    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_prompt}]
    return StreamingResponse(
        ai_provider.ai_stream_sse(
            messages, lang=lang, cfg=cfg, user_id=current_user.id, tenant_id=tenant_id,
            task="auditor_portal.generate_audit_report", **decode,
        ),
        media_type=ai_provider.SSE_MEDIA_TYPE,
        headers=ai_provider.SSE_HEADERS,
    )


# ─────────────────────────────────────────────────────────────────────────────
# STB objectif 5 — « Réalisation de l'audit »
#
# Everything below is engagement-scoped rather than assessment-scoped. An
# auditor could previously only ever reach a compliance ASSESSMENT: the audits
# they were actually appointed to were invisible from their portal, no grid
# could be worked through, no constat could be filed, and the one evidence
# upload route in the product is CISO-gated — which is exactly why audit_evidence
# has zero rows on the live database. Each route re-checks the assignment; none
# of them trusts an id from the client.
# ─────────────────────────────────────────────────────────────────────────────


class AuditorGridResponseUpdate(BaseModel):
    """One answer on one grid row. `verdict` is a key of the grid's own levels."""
    verdict: str | None = None
    note: str | None = None


class AuditorFindingCreate(BaseModel):
    """« Ajout de constats » — the auditor's own finding, filed from the portal."""
    title: str
    description: str
    severity: str = "medium"
    finding_type: str | None = None
    control_id: str | None = None
    recommendation: str | None = None
    due_date: str | None = None
    remediation_owner_id: str | None = None


async def _engagement_progress(db: AsyncSession, audit: Any, grid: Any | None = None) -> dict:
    """How far through the engagement the auditor is.

    Counted in SQL rather than by loading rows: the fallback branch covers 1743
    live control assessments and this runs once per listed audit. The
    LIKE '[AUDITOR:%' arm is the read-only legacy fallback — a verdict recorded
    before the dedicated columns existed still counts as reviewed.
    """
    if grid is not None:
        total = (await db.execute(
            select(func.count(AuditGridItem.id)).where(AuditGridItem.grid_id == grid.id)
        )).scalar() or 0
        answered = (await db.execute(
            select(func.count(AuditGridResponse.id)).where(
                AuditGridResponse.audit_id == audit.id,
                AuditGridResponse.verdict.isnot(None),
            )
        )).scalar() or 0
        return {"source": "grid", "items_total": int(total), "items_reviewed": int(answered)}

    if getattr(audit, "assessment_id", None):
        total = (await db.execute(
            select(func.count(ControlAssessment.id)).where(
                ControlAssessment.assessment_id == audit.assessment_id
            )
        )).scalar() or 0
        reviewed = (await db.execute(
            select(func.count(ControlAssessment.id)).where(
                ControlAssessment.assessment_id == audit.assessment_id,
                or_(
                    ControlAssessment.auditor_verdict.isnot(None),
                    ControlAssessment.not_applicable_justification.like("[AUDITOR:%"),
                ),
            )
        )).scalar() or 0
        return {"source": "controls", "items_total": int(total), "items_reviewed": int(reviewed)}

    return {"source": "none", "items_total": 0, "items_reviewed": 0}


async def _engagement_row(db: AsyncSession, audit: Any) -> dict:
    """One audit as the portal shows it: the engagement, its perimeter pointers,
    where its deliverable stands, and how far the fieldwork has got."""
    framework = None
    if audit.framework_id:
        framework = (await db.execute(
            select(Framework).where(Framework.id == audit.framework_id)
        )).scalar_one_or_none()
    assessment = None
    if getattr(audit, "assessment_id", None):
        assessment = (await db.execute(
            select(ComplianceAssessment).where(
                ComplianceAssessment.id == audit.assessment_id,
                ComplianceAssessment.tenant_id == audit.tenant_id,
            )
        )).scalar_one_or_none()
    # Loaded once, tenant-scoped, and reused for the name and the progress pair.
    grid = await _load_grid(db, audit)

    findings_total = (await db.execute(
        select(func.count(AuditFinding.id)).where(AuditFinding.audit_id == audit.id)
    )).scalar() or 0
    findings_open = (await db.execute(
        select(func.count(AuditFinding.id)).where(
            AuditFinding.audit_id == audit.id,
            AuditFinding.status.in_([FindingStatus.OPEN, FindingStatus.IN_REMEDIATION]),
        )
    )).scalar() or 0

    return {
        "audit_id": audit.id,
        "title": audit.title,
        "description": audit.description,
        "audit_type": audit.audit_type.value if hasattr(audit.audit_type, "value") else audit.audit_type,
        "status": audit.status.value if hasattr(audit.status, "value") else audit.status,
        "scope": audit.scope,
        "planned_start": audit.planned_start,
        "planned_end": audit.planned_end,
        "actual_start": audit.actual_start,
        "actual_end": audit.actual_end,
        "framework_id": audit.framework_id,
        "framework_name": framework.name if framework else None,
        "framework_short_name": framework.short_name if framework else None,
        "assessment_id": getattr(audit, "assessment_id", None),
        "assessment_name": assessment.name if assessment else None,
        "campaign_id": getattr(audit, "campaign_id", None),
        "grid_id": grid.id if grid is not None else None,
        "grid_name": grid.name if grid is not None else None,
        # Perimeter (objectif 4) — id lists, resolved by the pages that own them.
        "process_ids": getattr(audit, "process_ids", None) or [],
        "org_entity_ids": getattr(audit, "org_entity_ids", None) or [],
        "asset_ids": getattr(audit, "asset_ids", None) or [],
        "findings_total": int(findings_total),
        "findings_open": int(findings_open),
        "report_status": getattr(audit, "report_status", None) or "draft",
        "has_report": bool(audit.report_url),
        "report_submitted_at": _iso(getattr(audit, "report_submitted_at", None)),
        "report_approved_at": getattr(audit, "report_approved_at", None),
        "report_rejected_reason": getattr(audit, "report_rejected_reason", None),
        "progress": await _engagement_progress(db, audit, grid),
    }


@router.get("/audits")
async def get_my_audits(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """The engagements this auditor was given — « Affectation des auditeurs »
    seen from the auditor's side, which had no route at all before."""
    audit_ids = await _assigned_audit_ids(db, current_user, tenant_id)
    if not audit_ids:
        return []
    audits = (await db.execute(
        select(Audit)
        .where(Audit.id.in_(audit_ids))
        .order_by(Audit.created_at.desc())
    )).scalars().all()
    return [await _engagement_row(db, a) for a in audits]


@router.get("/audits/{audit_id}")
async def get_my_audit(
    audit_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """One assigned engagement, for the portal's detail view."""
    audit = await _assigned_audit(db, current_user, tenant_id, audit_id)
    return await _engagement_row(db, audit)


@router.get("/audits/{audit_id}/checklist")
async def get_engagement_checklist(
    audit_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """The engagement's checklist.

    « en suivant une grille d'évaluation personnalisable »: when the audit points
    at a grid, THAT is the checklist — its rows, its own verdict scale, and the
    answers already given. With no grid the response falls back to exactly
    today's behaviour, the linked assessment's framework controls, so nothing an
    existing engagement does changes.
    """
    audit = await _assigned_audit(db, current_user, tenant_id, audit_id)

    assessment = None
    if getattr(audit, "assessment_id", None):
        assessment = (await db.execute(
            select(ComplianceAssessment).where(
                ComplianceAssessment.id == audit.assessment_id,
                ComplianceAssessment.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()

    controls: list[dict] = []
    documents: list[dict] = []
    if assessment is not None:
        controls, documents, _cas = await _assessment_checklist_payload(db, assessment)

    return {
        "audit_id": audit.id,
        "audit_title": audit.title,
        "assessment_id": assessment.id if assessment else None,
        "verdict_scale": await _scale_for(db, assessment, audit),
        "grid": await _grid_payload(db, audit),
        "controls": controls,
        "documents": documents,
    }


@router.put("/audits/{audit_id}/grid-items/{item_id}")
async def record_grid_verdict(
    audit_id: str,
    item_id: str,
    body: AuditorGridResponseUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Record the auditor's verdict on one grid row.

    Upsert rather than insert: an auditor revises a line several times during
    fieldwork, and a second row per (audit, item) would make the grid's own
    progress count meaningless.
    """
    audit = await _assigned_audit(db, current_user, tenant_id, audit_id)
    # Tenant-scoped: a grid_id that does not resolve inside this tenant is not a
    # grid this engagement may be answered on.
    grid = await _load_grid(db, audit)
    if grid is None:
        raise HTTPException(status_code=400, detail="This audit is not conducted on a grid")

    item = (await db.execute(
        select(AuditGridItem).where(
            AuditGridItem.id == item_id,
            AuditGridItem.grid_id == grid.id,
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Grid item not found")

    # Strictly this grid's own keys — no legacy fallback. audit_grid_responses
    # has no rows predating the scale, and endpoints/audit_grids.py validates the
    # same column the same way; accepting "verified" here would persist a key the
    # grid cannot label.
    levels = _grid_levels(grid)
    verdict = (
        _validate_verdict(body.verdict, levels, allow_legacy=False)
        if body.verdict is not None else None
    )

    response = (await db.execute(
        select(AuditGridResponse).where(
            AuditGridResponse.audit_id == audit.id,
            AuditGridResponse.item_id == item.id,
        )
    )).scalar_one_or_none()
    if response is None:
        response = AuditGridResponse(audit_id=audit.id, item_id=item.id)
        db.add(response)
    if body.verdict is not None:
        response.verdict = verdict
    if body.note is not None:
        response.note = body.note or None
    response.answered_by_id = current_user.id
    response.answered_at = _utcnow()

    await db.flush()
    # Commit before the activity append for the same reason the verdict route
    # does: ActivityLogMiddleware opens its own connection afterwards and would
    # block on a write lock this session still held.
    await db.commit()
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
        action="auditor_grid_verdict", entity_type="audit",
        entity_id=audit.id, entity_name=audit.title,
        details={"grid_id": grid.id, "item_id": item.id,
                 "ref_code": item.ref_code, "verdict": response.verdict},
    ))
    return {
        "audit_id": audit.id,
        "item_id": item.id,
        "verdict": response.verdict,
        "note": response.note,
        "answered_at": _iso(response.answered_at),
    }


# ── Constats ─────────────────────────────────────────────────────────────────


def _finding_row(f: Any) -> dict:
    return {
        "id": f.id,
        "audit_id": f.audit_id,
        "title": f.title,
        "description": f.description,
        "severity": f.severity.value if hasattr(f.severity, "value") else f.severity,
        "status": f.status.value if hasattr(f.status, "value") else f.status,
        "finding_type": getattr(f, "finding_type", None),
        "control_id": f.control_id,
        "recommendation": f.recommendation,
        "management_response": f.management_response,
        "remediation_notes": f.remediation_notes,
        "remediation_owner_id": f.remediation_owner_id,
        "due_date": f.due_date,
        "closed_at": _iso(getattr(f, "closed_at", None)),
        "created_at": _iso(f.created_at),
    }


@router.get("/audits/{audit_id}/findings")
async def list_engagement_findings(
    audit_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """The constats raised on this engagement."""
    audit = await _assigned_audit(db, current_user, tenant_id, audit_id)
    rows = (await db.execute(
        select(AuditFinding)
        .where(AuditFinding.audit_id == audit.id)
        .order_by(AuditFinding.created_at.desc())
    )).scalars().all()
    return [_finding_row(f) for f in rows]


@router.post("/audits/{audit_id}/findings", status_code=status.HTTP_201_CREATED)
async def create_engagement_finding(
    audit_id: str,
    body: AuditorFindingCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """« Ajout de constats » — file a finding on an assigned engagement.

    /audits/{id}/findings already existed but is not assignment-scoped, so it
    hands any authenticated user every audit in the tenant; an auditor working
    from this portal needs a route that is bounded by their own appointment.
    """
    audit = await _assigned_audit(db, current_user, tenant_id, audit_id)

    severity = (body.severity or "medium").strip().lower()
    try:
        severity_enum = FindingSeverity(severity)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="severity must be one of %s" % [s.value for s in FindingSeverity],
        )

    # A control id is a client-supplied foreign key: check it exists and, when
    # the engagement names a framework, that it belongs to that framework —
    # otherwise a typo silently attaches the constat to another tenant's control.
    if body.control_id:
        ctrl_q = select(FrameworkControl.id).where(FrameworkControl.id == body.control_id)
        if audit.framework_id:
            ctrl_q = ctrl_q.where(FrameworkControl.framework_id == audit.framework_id)
        if (await db.execute(ctrl_q)).scalar_one_or_none() is None:
            raise HTTPException(status_code=422, detail="Invalid control_id for this audit")
    await assert_user_in_tenant(db, body.remediation_owner_id, tenant_id,
                                field_name="remediation_owner_id")

    # « niveau de conformité ou de non-conformité »: what kind of constat this is,
    # defaulted from severity so the column is never left blank for the report to
    # guess at. AuditFinding.finding_type is String(30).
    finding_type = (body.finding_type or _FINDING_TYPE_FOR_SEVERITY.get(severity) or "").strip()

    finding = AuditFinding(
        audit_id=audit.id,
        title=body.title,
        description=body.description,
        severity=severity_enum,
        status=FindingStatus.OPEN,
        control_id=body.control_id,
        recommendation=body.recommendation,
        due_date=body.due_date,
        remediation_owner_id=body.remediation_owner_id,
        finding_type=finding_type[:30] or None,
    )
    db.add(finding)
    await db.flush()
    await db.commit()
    await db.refresh(finding)

    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
        action="create", entity_type="audit_finding",
        entity_id=finding.id, entity_name=finding.title,
        details={"audit_id": audit.id, "severity": severity,
                 "finding_type": finding.finding_type},
    ))
    return _finding_row(finding)


# ── Preuves / pièces jointes ─────────────────────────────────────────────────


def _audit_evidence_row(e: Any) -> dict:
    return {
        "id": e.id,
        "audit_id": e.audit_id,
        "finding_id": getattr(e, "finding_id", None),
        "name": e.name,
        "description": e.description,
        "file_name": e.file_name,
        "content_type": getattr(e, "content_type", None),
        "file_size_bytes": getattr(e, "file_size_bytes", None),
        "file_sha256": getattr(e, "file_sha256", None),
        "record_version": getattr(e, "record_version", None),
        "uploaded_by_id": e.uploaded_by_id,
        "created_at": _iso(e.created_at),
    }


@router.get("/audits/{audit_id}/evidence")
async def list_engagement_evidence(
    audit_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Evidence attached to this engagement (or to one of its constats)."""
    audit = await _assigned_audit(db, current_user, tenant_id, audit_id)
    rows = (await db.execute(
        select(AuditEvidence)
        .where(AuditEvidence.audit_id == audit.id)
        .order_by(AuditEvidence.created_at.desc())
    )).scalars().all()
    return [_audit_evidence_row(e) for e in rows]


@router.post("/audits/{audit_id}/evidence", status_code=status.HTTP_201_CREATED)
async def upload_engagement_evidence(
    audit_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    file: Annotated[UploadFile, File()],
    name: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    finding_id: Annotated[str | None, Form()] = None,
):
    """« pièces jointes, preuves » — a real multipart upload the auditor's role
    is allowed to call.

    The only evidence upload in the product is
    POST /compliance/control-assessments/{id}/evidence, gated on CISO; an auditor
    gets a 403 there, which is why audit_evidence held no bytes and no rows at
    all. Storage, the extension denylist, the magic-byte check and the SHA-256
    version record are the same ones compliance.py uses — nothing new is
    invented here.
    """
    audit = await _assigned_audit(db, current_user, tenant_id, audit_id)

    if finding_id:
        owner = (await db.execute(
            select(AuditFinding.id).where(
                AuditFinding.id == finding_id, AuditFinding.audit_id == audit.id
            )
        )).scalar_one_or_none()
        if owner is None:
            raise HTTPException(status_code=404, detail="Finding not found on this audit")

    # Rejects every dangerous suffix, not only the last one — see
    # security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(file.filename, field_name="file")
    name_lower = (file.filename or "").lower()
    if not name_lower.endswith(_EVIDENCE_EXTENSIONS):
        raise HTTPException(
            status_code=422,
            detail="Supported evidence files: %s" % ", ".join(_EVIDENCE_EXTENSIONS),
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=422, detail="Empty file")
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)"
        )

    # A declared type that the bytes contradict is refused rather than stored:
    # evidence whose own header disagrees with its label is worthless in an audit.
    content_type = file.content_type or ""
    declared = content_type.lower()
    for needle, mime, label in (
        ("pdf", "application/pdf", "PDF"),
        ("spreadsheetml",
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "XLSX"),
        ("ms-excel", "application/vnd.ms-excel", "XLS"),
        ("image/png", "image/png", "PNG"),
        ("image/jpeg", "image/jpeg", "JPEG"),
    ):
        if needle in declared and not verify_file_signature(file_bytes, mime):
            raise HTTPException(415, f"File contents do not match the declared {label} type.")

    safe_name = sanitize_filename(file.filename, default="evidence")
    rel_path = f"{tenant_id}/audit-evidence/{uuid.uuid4().hex}_{safe_name}"
    full_path = Path(settings.UPLOADS_DIR) / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(file_bytes)

    digest = file_integrity.sha256_bytes(file_bytes)
    evidence = AuditEvidence(
        audit_id=audit.id,
        finding_id=finding_id or None,
        name=(name or file.filename or safe_name)[:255],
        description=description,
        file_name=(file.filename or safe_name)[:255],
        file_path=rel_path,
        file_size_bytes=len(file_bytes),
        content_type=content_type or None,
        file_sha256=digest,
        uploaded_by_id=current_user.id,
    )
    db.add(evidence)
    await db.flush()
    # AuditEvidence carries no tenant_id of its own; the engagement it hangs off
    # is the tenant boundary, and that is the id the version record needs.
    #
    # parent_type is "audit_finding"/"audit_evidence", NOT "audit": versions are
    # numbered per parent and record_version marks every other CURRENT row on
    # that parent as SUPERSEDED. parent_type "audit" is owned by the generated
    # report (endpoints/audits.py generate_audit_report_file, and the version
    # list + the scheduler that read it back), so sharing it would make each
    # preuve supersede the engagement's own report PDF — and file_retention
    # eventually reclaims superseded files. Same split endpoints/audits.py
    # already made for its own evidence upload.
    version = await file_integrity.record_version(
        db, tenant_id=tenant_id, entity_type=file_integrity.EVIDENCE,
        entity_id=evidence.id,
        parent_type=("audit_finding" if finding_id else "audit_evidence"),
        parent_id=(finding_id or audit.id),
        file_path=rel_path, file_name=evidence.file_name,
        file_sha256=digest, file_size_bytes=len(file_bytes),
        content_type=content_type or None, uploaded_by_id=current_user.id,
        note=f"Audit evidence uploaded by {current_user.email}",
    )
    # audit_evidence.record_version exists precisely to carry this number; left
    # at its default of 1 the column would be written by the schema and never by
    # the code that mints the version it is supposed to name.
    evidence.record_version = version.version_number
    await db.commit()
    await db.refresh(evidence)

    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
        action="upload", entity_type="audit_evidence",
        entity_id=evidence.id, entity_name=evidence.name,
        details={"audit_id": audit.id, "finding_id": finding_id or None,
                 "sha256": digest, "size_bytes": len(file_bytes)},
    ))
    return _audit_evidence_row(evidence)


@router.get("/evidence/{evidence_id}/download")
async def download_engagement_evidence(
    evidence_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.AUDITOR))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Read back one of the engagement's evidence files.

    The stored path is joined to UPLOADS_DIR and re-checked to be inside it
    (a path recorded years ago is still client-derived), and the recorded digest
    is verified before the bytes leave the building — an evidence file that no
    longer matches what was uploaded is refused rather than served silently.
    """
    row = (await db.execute(
        select(AuditEvidence, Audit)
        .join(Audit, AuditEvidence.audit_id == Audit.id)
        .where(AuditEvidence.id == evidence_id, Audit.tenant_id == tenant_id)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Evidence not found")
    evidence, audit = row
    if audit.id not in await _assigned_audit_ids(db, current_user, tenant_id):
        raise HTTPException(status_code=403, detail=_NOT_ASSIGNED_AUDIT)
    if not evidence.file_path:
        raise HTTPException(status_code=404, detail="This evidence record has no file")

    base = Path(settings.UPLOADS_DIR)
    full = assert_path_within(base, base / evidence.file_path)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="File not found on disk")

    integrity_status, _actual = await asyncio.to_thread(
        file_integrity.verify_file, full, evidence.file_sha256
    )
    if integrity_status == file_integrity.MODIFIED:
        raise HTTPException(
            status_code=409,
            detail="This file no longer matches the checksum recorded at upload.",
        )
    return FileResponse(
        path=str(full),
        filename=evidence.file_name or "evidence",
        media_type=evidence.content_type or "application/octet-stream",
    )


# ── Le livrable d'audit ──────────────────────────────────────────────────────
#
# Deliberately NOT re-implemented here. endpoints/audits.py owns the report's
# whole lifecycle (generate → submit → approve | reject → issue) together with
# the reviewer notification and the diffusion gate, and its routes are already
# callable by an auditor and already scoped to the engagements that auditor is
# assigned to. A second writer in this module would move report_status without
# telling the validators. The portal therefore READS the deliverable's state
# through _engagement_row (report_status / has_report / report_submitted_at) and
# sends the auditor to /audits/{id}/report/... to act on it.
