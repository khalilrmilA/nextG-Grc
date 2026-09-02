"""Auditor portal endpoints — restricted view for external auditors.

The report generator (`generate_audit_report`, the only LLM call site in this file) is
built on the shared AI foundation (app.services.ai_prompts / ai_provider / ai_locale /
ai_chunking): the `audit_report` expert system prompt with explicit evaluation criteria
(finding vs. observation vs. not-assessed, a severity rule, a certification-opinion rule),
Accept-Language-aware output, delimited untrusted input (auditor notes, scope text), tuned
deterministic decoding and honest failure frames instead of a silently degraded report.
"""
import logging
import re
from datetime import date
from typing import Annotated, Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.core import ai_quota
from app.models.user import User, UserRole
from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus, UploadedDocument, Evidence
from app.models.auditor_assignment import AuditorAssignment
from app.models.mandatory_document import MandatoryDocument
from app.models.framework import Framework, FrameworkControl
from app.api.v1.dependencies import get_current_user, get_tenant_id
from app.api.v1.dependencies.auth import require_roles
from app.services import ai_prompts, ai_provider
from app.services.ai_chunking import chunk_text, estimate_tokens, input_budget
from app.services.ai_locale import get_request_language

logger = logging.getLogger(__name__)

router = APIRouter()


_NOT_ASSIGNED = "Not assigned to this assessment"
_FINDINGS_KEYS = frozenset({"verified", "finding", "observation", "na", "unreviewed"})
_AUDITOR_NOTE_RE = re.compile(r"\[AUDITOR:(\w+)\] ?(.*)", re.DOTALL)
_SLOT_RESERVE_TOKENS = 1_500   # template text + one-line slots, kept out of the body budget


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
    return {
        "control_assessment_id": ca.id,
        "control_identifier": ctrl_id,
        "control_title": ctrl.title if ctrl else "",
        "control_category": ctrl.category if ctrl else None,
        "control_description": ctrl.description if ctrl else None,
        "status": ca.status,
        "company_notes": ca.notes,
        "implementation_notes": ca.implementation_notes,
        "auditor_notes": ca.not_applicable_justification,
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
        m = _AUDITOR_NOTE_RE.match(ca.not_applicable_justification or "")
        verdict = m.group(1) if (m and m.group(1) in _FINDINGS_KEYS) else None
        note = ai_provider.clean_field(m.group(2), 600) if m else ""
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


class AuditorControlUpdate(BaseModel):
    verdict: str | None = None          # "verified" | "finding" | "observation" | "na"
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

        # Progress: verified controls / total
        ca_result = await db.execute(
            select(ControlAssessment).where(ControlAssessment.assessment_id == assessment.id)
        )
        cas = ca_result.scalars().all()
        total = len(cas)
        verified = sum(1 for ca in cas if ca.notes and "verified" in (ca.notes or ""))

        items.append({
            "assignment_id": asgn.id,
            "assessment_id": assessment.id,
            "assessment_name": assessment.name,
            "framework_name": fw.name if fw else "",
            "framework_short_name": fw.short_name if fw else "",
            "status": assessment.status,
            "compliance_score": assessment.compliance_score,
            "controls_total": total,
            "controls_verified": verified,
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
    if not asgn_result.scalar_one_or_none():
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

    ca_result = await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
    )
    cas = ca_result.scalars().all()

    ctrl_result = await db.execute(
        select(FrameworkControl).where(FrameworkControl.framework_id == assessment.framework_id)
        .order_by(FrameworkControl.sort_order)
    )
    controls = ctrl_result.scalars().all()
    ctrl_map = {c.id: c for c in controls}

    # Mandatory-document metadata and auditor-visible evidence, shared with the report route.
    clause_doc_map, ca_evidence_map, visible_docs, md_map, all_evidence = await _load_visible_evidence(
        db, assessment_id, assessment.framework_id, [ca.id for ca in cas]
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
            "created_at": ev.created_at.isoformat() if hasattr(ev.created_at, "isoformat") else str(ev.created_at),
            "is_evidence": True,
        })

    return {"assessment_id": assessment_id, "controls": checklist, "documents": documents}


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
    if not asgn_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail=_NOT_ASSIGNED)

    if body.verdict is not None:
        # Store verdict prefixed in notes to distinguish auditor vs company notes
        ca.not_applicable_justification = f"[AUDITOR:{body.verdict}] {body.auditor_notes or ''}"
    elif body.auditor_notes is not None:
        ca.not_applicable_justification = f"[AUDITOR:observation] {body.auditor_notes}"

    await db.flush()
    return {"control_assessment_id": ca.id, "verdict": body.verdict, "updated": True}


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
    if not asgn_result.scalar_one_or_none():
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

    buckets = _classify_verdicts(cas, controls, ctrl_map, clause_doc_map, ca_evidence_map)
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
