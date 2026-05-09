"""Compliance assessment endpoints — full implementation."""
import asyncio
import json
import re
import uuid
from datetime import datetime
from pathlib import Path

import requests
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.api.v1.dependencies.pagination import PaginationParams
from app.core.config import settings
from app.core.database import get_db
from app.core.security_utils import sanitize_for_prompt, verify_file_signature
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
from app.models.framework import Framework, FrameworkControl
from app.models.mandatory_document import MandatoryDocument
from app.models.tenant import Tenant
from app.models.action_item import ActionItem, ActionItemPriority, ActionItemStatus
from app.models.user import User, UserRole

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


def _extract_text(file_path: str, content_type: str) -> str:
    """Extract plain text from PDF, DOCX, or TXT files."""
    ct = (content_type or "").lower()
    try:
        if "pdf" in ct or file_path.endswith(".pdf"):
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        if "docx" in ct or "word" in ct or file_path.endswith(".docx"):
            from docx import Document as DocxDocument
            doc = DocxDocument(file_path)
            return "\n".join(p.text for p in doc.paragraphs)
        return Path(file_path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def _parse_ollama_json(content: str) -> list[dict]:
    """Parse JSON array from Ollama response, handling markdown fences."""
    content = content.strip()
    if "```" in content:
        for part in content.split("```"):
            clean = part.strip().lstrip("json").strip()
            if clean.startswith("["):
                content = clean
                break
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    return []


def _call_ollama_batch(doc_text: str, controls: list, model: str) -> list[dict]:
    """Synchronous Ollama call for one batch of controls. Runs in thread pool."""
    doc_excerpt = doc_text[:8000]

    controls_list = "\n".join(
        f"- [{c.control_id}] {c.title}: {(c.description or '')[:200]}"
        for c in controls
    )

    prompt = (
        "You are a compliance analyst. Analyze whether the following organizational "
        "document(s) provide evidence of implementing the listed compliance controls.\n\n"
        f"DOCUMENT CONTENT:\n---\n{doc_excerpt}\n---\n\n"
        f"CONTROLS TO EVALUATE:\n{controls_list}\n\n"
        "For each control respond with a JSON array. Each element MUST have:\n"
        '- "control_id": the exact control ID shown in brackets\n'
        '- "verdict": one of ["compliant", "partial", "not_covered", "not_applicable"]\n'
        '- "confidence": float 0.0-1.0\n'
        '- "explanation": one sentence max 100 words\n'
        '- "gap_description": describe what is missing if not_covered/partial, else null\n\n'
        "Respond ONLY with a valid JSON array. No markdown, no text outside the JSON."
    )

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"temperature": 0.1, "top_p": 0.95},
        "format": "json",
    }

    try:
        resp = requests.post(
            f"{settings.OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=(30, 300),
        )
        resp.raise_for_status()
        content = resp.json().get("message", {}).get("content", "[]")
        return _parse_ollama_json(content)
    except Exception:
        return [
            {
                "control_id": c.control_id,
                "verdict": "not_covered",
                "confidence": 0.0,
                "explanation": "Analysis failed — manual review required.",
                "gap_description": "Analysis could not be completed for this control.",
            }
            for c in controls
        ]


async def _run_batch_analysis(doc_text: str, controls: list, model: str) -> list[dict]:
    """Run analysis across all controls in batches."""
    batch_size = settings.OLLAMA_ANALYSIS_BATCH_SIZE
    all_results: list[dict] = []
    loop = asyncio.get_event_loop()
    for i in range(0, len(controls), batch_size):
        batch = controls[i: i + batch_size]
        results = await loop.run_in_executor(None, _call_ollama_batch, doc_text, batch, model)
        all_results.extend(results)
    return all_results


_CLAUSE_DETECTION_PROMPT = """\
You are an ISO 27001:2022 expert. Given the document text below, identify which ISO 27001:2022
clauses and Annex A controls the document covers. Return ONLY a JSON array of clause references
(e.g. ["4.3", "5.2", "6.1.3", "A.5.1", "A.8.7"]). Return an empty array [] if none apply.
Document text (excerpt):
{excerpt}"""


def _detect_clauses_sync(doc_text: str, doc_id: str, db_url: str) -> None:
    """Synchronous worker: call Ollama to detect clauses, then update the DB record."""
    excerpt = doc_text[:6000]
    payload = {
        "model": getattr(settings, "OLLAMA_CHAT_MODEL", "llama3.1:8b"),
        "stream": False,
        "messages": [{"role": "user", "content": _CLAUSE_DETECTION_PROMPT.format(excerpt=excerpt)}],
    }
    try:
        resp = requests.post(
            f"{settings.OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=(30, 120),
        )
        if resp.status_code != 200:
            return
        raw = resp.json().get("message", {}).get("content", "[]")
        # Strip markdown fences
        raw = re.sub(r"^```[a-z]*\n?", "", raw.strip(), flags=re.MULTILINE)
        raw = re.sub(r"\n?```$", "", raw.strip())
        clauses = json.loads(raw)
        if not isinstance(clauses, list):
            return
    except Exception:  # noqa: BLE001
        return

    # Write back to DB synchronously (separate sync connection)
    import sqlalchemy
    from sqlalchemy.orm import Session

    engine = sqlalchemy.create_engine(db_url.replace("+aiosqlite", "").replace("+asyncpg", ""))
    with Session(engine) as session:
        doc = session.get(UploadedDocument, doc_id)
        if doc:
            doc.clause_refs = clauses
            session.commit()
    engine.dispose()


def _schedule_clause_detection(doc_id: str, doc_text: str) -> None:
    """Spawn a background thread to detect clauses without blocking the response."""
    import threading

    db_url = settings.DATABASE_URL
    t = threading.Thread(
        target=_detect_clauses_sync,
        args=(doc_text, doc_id, db_url),
        daemon=True,
    )
    t.start()


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


@router.post("/assessments/{assessment_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    assessment_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    document_type_key: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> UploadedDocumentResponse:
    """Upload a document to an assessment for compliance analysis."""
    assessment_result = await db.execute(
        select(ComplianceAssessment).where(
            ComplianceAssessment.id == assessment_id,
            ComplianceAssessment.tenant_id == tenant_id,
        )
    )
    assessment = assessment_result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

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
    rel_path = f"{tenant_id}/{assessment_id}/{uuid.uuid4().hex}_{safe_name}"
    full_path = Path(settings.UPLOADS_DIR) / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(file_bytes)

    extracted = _extract_text(str(full_path), content_type or name_lower)

    doc = UploadedDocument(
        assessment_id=assessment_id,
        tenant_id=tenant_id,
        file_name=file.filename or safe_name,
        file_path=str(rel_path),
        content_type=content_type,
        file_size_bytes=len(file_bytes),
        extracted_text=extracted,
        uploaded_by_id=current_user.id,
        document_type_key=document_type_key,  # pre-assign if provided by the UI
    )
    db.add(doc)
    await db.flush()

    # Auto-update matching control statuses when a checklist document is uploaded.
    # A document uploaded for clause "4.1" automatically promotes any not_started or
    # not_implemented controls under clause "4.1", "4.1.1", "4.1.2", etc.
    if document_type_key:
        md_result = await db.execute(
            select(MandatoryDocument).where(MandatoryDocument.document_type_key == document_type_key)
        )
        md = md_result.scalar_one_or_none()
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

    # Fire-and-forget: detect which ISO 27001 clauses this document covers
    if extracted:
        background_tasks.add_task(_schedule_clause_detection, doc.id, extracted)

    return UploadedDocumentResponse(
        id=doc.id,
        file_name=doc.file_name,
        file_path=doc.file_path,
        file_size_bytes=doc.file_size_bytes,
        content_type=doc.content_type,
        is_visible_to_auditor=True,
        created_at=doc.created_at,
    )


@router.post("/assessments/{assessment_id}/analyze")
async def analyze_assessment(
    assessment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
) -> dict:
    """
    Trigger AI analysis of uploaded documents against framework controls.
    Synchronous — may take 1–5 minutes for large frameworks.
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

    docs_result = await db.execute(
        select(UploadedDocument).where(UploadedDocument.assessment_id == assessment_id)
    )
    docs = docs_result.scalars().all()
    if not docs:
        raise HTTPException(status_code=400, detail="No documents uploaded. Upload at least one document first.")

    doc_text = "\n\n---\n\n".join(d.extracted_text or "" for d in docs).strip()
    if not doc_text:
        raise HTTPException(status_code=400, detail="No text could be extracted from the uploaded documents.")

    ctrl_result = await db.execute(
        select(FrameworkControl)
        .where(FrameworkControl.framework_id == assessment.framework_id)
        .order_by(FrameworkControl.sort_order)
    )
    controls = ctrl_result.scalars().all()
    if not controls:
        raise HTTPException(status_code=400, detail="No controls found for this framework.")

    # Delete previous analysis results
    old_cas = (await db.execute(
        select(ControlAssessment).where(ControlAssessment.assessment_id == assessment_id)
    )).scalars().all()
    for ca in old_cas:
        await db.delete(ca)

    old_gaps = (await db.execute(
        select(ComplianceGap).where(ComplianceGap.assessment_id == assessment_id)
    )).scalars().all()
    for gap in old_gaps:
        await db.delete(gap)

    await db.flush()

    # Run AI analysis — guard against blowing the daily token budget. The
    # batch analysis is unmetered per-call (sync workers, no user context),
    # so we estimate up-front and record a lump sum after.
    from app.core import ai_quota
    estimated = ai_quota.estimate_tokens(doc_text) + len(controls) * 200
    ai_quota.check_quota_or_raise(current_user.id, estimated)
    model = settings.OLLAMA_CHAT_MODEL
    verdicts = await _run_batch_analysis(doc_text, controls, model)
    ai_quota.record_usage(current_user.id, estimated)

    verdict_map = {
        "compliant": ControlStatus.IMPLEMENTED,
        "partial": ControlStatus.PARTIALLY_IMPLEMENTED,
        "not_covered": ControlStatus.NOT_IMPLEMENTED,
        "not_applicable": ControlStatus.NOT_APPLICABLE,
    }

    verdict_by_cid: dict[str, dict] = {v.get("control_id", ""): v for v in verdicts}

    # Load requirement levels for severity calculation
    from app.models.framework import ControlRequirement
    req_result = await db.execute(
        select(ControlRequirement).where(
            ControlRequirement.control_id.in_([c.id for c in controls])
        )
    )
    req_levels: dict[str, list[str]] = {}
    for r in req_result.scalars().all():
        req_levels.setdefault(r.control_id, []).append(r.requirement_level)

    implemented = partial = not_applicable = 0

    for control in controls:
        v = verdict_by_cid.get(control.control_id, {})
        verdict_str = v.get("verdict", "not_covered")
        ctrl_status = verdict_map.get(verdict_str, ControlStatus.NOT_IMPLEMENTED)

        ca = ControlAssessment(
            assessment_id=assessment_id,
            control_id=control.id,
            status=ctrl_status,
            ai_confidence=float(v.get("confidence", 0.0)),
            implementation_notes=v.get("explanation"),
        )
        db.add(ca)

        if ctrl_status == ControlStatus.IMPLEMENTED:
            implemented += 1
        elif ctrl_status == ControlStatus.PARTIALLY_IMPLEMENTED:
            partial += 1
        elif ctrl_status == ControlStatus.NOT_APPLICABLE:
            not_applicable += 1

        if ctrl_status in (ControlStatus.NOT_IMPLEMENTED, ControlStatus.PARTIALLY_IMPLEMENTED):
            gap_desc = v.get("gap_description") or f"{control.title} is not adequately addressed."
            levels = req_levels.get(control.id, [])
            has_must = "must" in levels
            is_blocker = ctrl_status == ControlStatus.NOT_IMPLEMENTED and has_must
            if is_blocker:
                severity = "high"
                priority = 90
            elif ctrl_status == ControlStatus.NOT_IMPLEMENTED:
                severity = "medium"
                priority = 60
            elif has_must:
                severity = "medium"
                priority = 50
            else:
                severity = "low"
                priority = 30
            db.add(ComplianceGap(
                assessment_id=assessment_id,
                control_id=control.id,
                gap_description=gap_desc,
                severity=severity,
                remediation_steps=f"Implement {control.title} per framework guidance.",
                is_certification_blocker=is_blocker,
                remediation_priority=priority,
            ))

    total = len(controls)
    scoreable = total - not_applicable
    score = round((implemented + partial * 0.5) / scoreable * 100, 1) if scoreable > 0 else 0.0

    assessment.compliance_score = score
    assessment.status = AssessmentStatus.IN_PROGRESS
    await db.flush()

    return {
        "status": "completed",
        "compliance_score": score,
        "controls_analyzed": total,
        "implemented": implemented,
        "partial": partial,
        "not_covered": total - implemented - partial - not_applicable,
        "not_applicable": not_applicable,
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
    due_date: str | None = None
    notes: str | None = None


class BulkRecommendationRequest(BaseModel):
    gap_ids: list[str]
    action: str  # "accept" | "reject"
    owner_id: str | None = None
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
    rel_path = f"{tenant_id}/evidence/{uuid.uuid4().hex}_{safe_name}"
    full_path = Path(settings.UPLOADS_DIR) / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(file_bytes)

    evidence = Evidence(
        control_assessment_id=control_assessment_id,
        tenant_id=tenant_id,
        name=file.filename or safe_name,
        evidence_type=EvidenceType.DOCUMENT,
        file_name=file.filename or safe_name,
        file_path=rel_path,
        file_size_bytes=len(file_bytes),
        content_type=content_type,
        uploaded_by_id=current_user.id,
        is_visible_to_auditor=True,
    )
    db.add(evidence)
    await db.flush()

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
                                content_type=evidence.content_type,
                                uploaded_by_id=current_user.id,
                                is_visible_to_auditor=True,
                                shared_from_evidence_id=None,
                            )
                            db.add(shared)
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
    if evidence.file_path:
        from pathlib import Path as _Path
        full = _Path(settings.UPLOADS_DIR) / evidence.file_path
        full.unlink(missing_ok=True)
    await db.delete(evidence)
    await db.commit()


@router.get("/evidence/{evidence_id}/download")
async def download_evidence(
    evidence_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
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
    return FileResponse(
        path=str(full),
        filename=evidence.file_name or "evidence",
        media_type=evidence.content_type or "application/octet-stream",
    )


# ─── Uploaded Document (checklist) management ──────────────────────────────────


@router.get("/documents/{doc_id}/download")
async def download_uploaded_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
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
    return _FR(
        path=str(full),
        filename=doc.file_name or "document",
        media_type=doc.content_type or "application/octet-stream",
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
    if doc.file_path:
        from pathlib import Path as _Path3
        full = _Path3(settings.UPLOADS_DIR) / doc.file_path
        full.unlink(missing_ok=True)
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
