"""Auditor portal endpoints — restricted view for external auditors."""
import json
import re
from typing import Annotated, AsyncGenerator, Any
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

import httpx

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus, UploadedDocument, Evidence
from app.models.auditor_assignment import AuditorAssignment
from app.models.mandatory_document import MandatoryDocument
from app.models.framework import Framework, FrameworkControl
from app.api.v1.dependencies import get_current_user, get_tenant_id
from app.api.v1.dependencies.auth import require_roles

_SSE_DONE = "data: [DONE]\n\n"

AUDIT_REPORT_SYSTEM_PROMPT = """You are a senior external auditor writing a formal audit report.
Write clear, professional, structured Markdown. Use ## for sections, ### for subsections.
Be objective, evidence-based, and actionable. Include:
- Executive Summary
- Audit Scope & Objectives
- Methodology
- Key Findings (by severity: Critical / High / Medium / Low / Observations)
- Positive Observations
- Recommendations (numbered, prioritised)
- Conclusion & Certification Opinion
Be concise but comprehensive. Flag certification blockers explicitly."""


async def _audit_report_generator(
    messages: list[dict],
    model: str,
) -> AsyncGenerator[str, None]:
    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    url = f"{base_url}/api/chat"
    payload = {
        "model": model,
        "stream": True,
        "messages": [{"role": "system", "content": AUDIT_REPORT_SYSTEM_PROMPT}, *messages],
    }
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    yield f"data: {json.dumps({'error': f'Ollama error: {body.decode()}'})}\n\n"
                    yield _SSE_DONE
                    return
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"
                    if chunk.get("done"):
                        break
    except Exception as exc:  # noqa: BLE001
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"
    finally:
        yield _SSE_DONE

router = APIRouter()


_NOT_ASSIGNED = "Not assigned to this assessment"
_FINDINGS_KEYS = frozenset({"verified", "finding", "observation", "na", "unreviewed"})
_AUDITOR_NOTE_RE = re.compile(r"\[AUDITOR:(\w+)\] ?(.*)", re.DOTALL)


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


def _build_findings(cas: list, ctrl_map: dict) -> dict[str, list[dict[str, Any]]]:
    """Parse auditor verdicts from control assessments into categorised findings dict."""
    findings: dict[str, list] = {k: [] for k in _FINDINGS_KEYS}
    for ca in cas:
        ctrl = ctrl_map.get(ca.control_id)
        ref = ctrl.control_id if ctrl else ca.control_id
        title = ctrl.title if ctrl else ""
        m = _AUDITOR_NOTE_RE.match(ca.not_applicable_justification or "")
        if m:
            verdict = m.group(1)
            key = verdict if verdict in _FINDINGS_KEYS else "unreviewed"
            findings[key].append({"ref": ref, "title": title, "notes": m.group(2).strip()})
        else:
            findings["unreviewed"].append({"ref": ref, "title": title, "notes": ""})
    return findings


def _fmt_list(items: list) -> str:
    return "\n".join(
        f"  - {i['ref']} {i['title']}" + (f": {i['notes']}" if i["notes"] else "")
        for i in items
    ) or "  None"


def _build_report_prompt(
    assessment_name: str,
    fw_name: str,
    fw_short: str,
    auditor_name: str,
    compliance_score: float,
    findings: dict[str, list],
) -> str:
    return f"""Generate a formal audit report for:
Assessment: {assessment_name}
Framework: {fw_name} ({fw_short})
Auditor: {auditor_name}
Compliance Score: {compliance_score}%

AUDIT FINDINGS SUMMARY:
Verified Controls ({len(findings['verified'])}):
{_fmt_list(findings['verified'])}

Findings — Non-Conformities ({len(findings['finding'])}):
{_fmt_list(findings['finding'])}

Observations ({len(findings['observation'])}):
{_fmt_list(findings['observation'])}

Not Applicable ({len(findings['na'])}):
{_fmt_list(findings['na'])}

Not Reviewed ({len(findings['unreviewed'])}):
{_fmt_list(findings['unreviewed'])}

Write the complete formal audit report in Markdown."""


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

    # Load mandatory document metadata and visible checklist uploads FIRST
    # so we can attach linked documents to each control row.
    fw_short_result = await db.execute(
        select(Framework.short_name).where(Framework.id == assessment.framework_id)
    )
    fw_short = fw_short_result.scalar_one_or_none() or ""

    md_result = await db.execute(
        select(MandatoryDocument).where(MandatoryDocument.framework_short_name == fw_short)
    )
    md_map: dict[str, MandatoryDocument] = {md.document_type_key: md for md in md_result.scalars().all()}

    # Only checklist documents that are marked visible to the auditor
    docs_result = await db.execute(
        select(UploadedDocument).where(
            UploadedDocument.assessment_id == assessment_id,
            UploadedDocument.is_visible_to_auditor == True,  # noqa: E712
            UploadedDocument.document_type_key.isnot(None),
        )
    )
    visible_docs = docs_result.scalars().all()

    # Load evidence uploaded directly to controls (e.g. via stakeholder share links)
    ca_ids = [ca.id for ca in cas]
    evidence_result = await db.execute(
        select(Evidence).where(
            Evidence.control_assessment_id.in_(ca_ids),
            Evidence.is_visible_to_auditor == True,  # noqa: E712
        )
    )
    all_evidence = evidence_result.scalars().all()
    ca_evidence_map: dict[str, list] = {}
    for ev in all_evidence:
        ca_evidence_map.setdefault(ev.control_assessment_id, []).append(ev)

    clause_doc_map = _build_clause_doc_map(visible_docs, md_map)
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
) -> StreamingResponse:
    """Stream an AI-generated audit report based on recorded verdicts."""
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
    cas = ca_result.scalars().all()

    ctrl_result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.framework_id == assessment.framework_id
        ).order_by(FrameworkControl.sort_order)
    )
    ctrl_map = {c.id: c for c in ctrl_result.scalars().all()}

    findings = _build_findings(list(cas), ctrl_map)
    prompt = _build_report_prompt(
        assessment_name=assessment.name,
        fw_name=fw.name if fw else "Unknown",
        fw_short=fw.short_name if fw else "",
        auditor_name=current_user.name,
        compliance_score=assessment.compliance_score or 0,
        findings=findings,
    )

    messages = [{"role": "user", "content": prompt}]
    model = getattr(settings, "OLLAMA_CHAT_MODEL", "llama3.1:8b")

    return StreamingResponse(
        _audit_report_generator(messages, model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
