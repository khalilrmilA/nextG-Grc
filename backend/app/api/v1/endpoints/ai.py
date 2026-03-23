"""
AI Assistant endpoint — streams responses from Ollama (cloud models).
Uses Ollama's OpenAI-compatible /api/chat endpoint with streaming.
"""
import json
import asyncio
from collections.abc import AsyncGenerator
from typing import Annotated
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from pydantic import BaseModel
import httpx

from app.core.config import settings

router = APIRouter()

DEFAULT_MODEL = settings.OLLAMA_CHAT_MODEL  # e.g. deepseek-v3.1:671b-cloud

SYSTEM_PROMPT = """You are an expert GRC (Governance, Risk & Compliance) AI assistant embedded in a professional GRC SaaS platform.

You help security, compliance, and risk management teams with:
- ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, NIST CSF, NIST 800-53, CIS Controls
- Risk assessment, risk treatment, and risk registers
- Compliance gap analysis and control implementation
- Audit planning, evidence collection, and finding remediation
- Policy drafting, review cycles, and employee attestation
- Vendor risk management and third-party due diligence
- Incident response and business continuity planning
- Security awareness and regulatory interpretation

Guidelines:
- Be concise, professional, and practical
- Reference specific framework controls when relevant (e.g., ISO 27001 A.8.1, NIST CSF ID.AM-1)
- Provide actionable advice, not just theory
- When asked to draft a policy or document, produce a clean structured output
- Always clarify if something requires legal or specialized professional advice
- Keep responses focused on GRC topics; politely redirect off-topic questions
"""

POLICY_SYSTEM_PROMPT = """You are an expert GRC consultant specializing in writing clear, actionable security policies and procedures for organizations.

When asked to generate a policy, produce a complete, professional document with:
- Policy title and version
- Purpose and scope
- Policy statements (specific, measurable)
- Procedures and implementation steps
- Roles and responsibilities
- Review cycle

Format in clear Markdown. Be specific and actionable, not generic. Avoid vague language like "should consider" — use direct statements like "must" and "shall"."""


# ─── Schemas ───────────────────────────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = DEFAULT_MODEL
    stream: bool = True


class PolicyGenerateRequest(BaseModel):
    control_identifier: str
    control_title: str
    framework_short_name: str
    control_description: str | None = None
    gap_description: str | None = None
    existing_context: str | None = None
    organization_context: str | None = None
    model: str = DEFAULT_MODEL


class RiskAnalyzeRequest(BaseModel):
    title: str
    description: str | None = None
    risk_category: str | None = None
    model: str = DEFAULT_MODEL


class EvidenceAnalyzeRequest(BaseModel):
    document_text: str          # extracted text from uploaded file
    framework_short_name: str
    controls: list[dict]        # list of {control_id, title, description}
    model: str = DEFAULT_MODEL


class AuditPlanRequest(BaseModel):
    framework_name: str
    framework_short_name: str
    audit_title: str
    audit_scope: str | None = None
    audit_objective: str | None = None
    controls: list[dict]        # list of {control_id, title, category}
    model: str = DEFAULT_MODEL


class VendorRiskRequest(BaseModel):
    vendor_name: str
    vendor_industry: str | None = None
    vendor_services: str | None = None
    questionnaire_responses: dict   # {question: answer}
    model: str = DEFAULT_MODEL


# ─── Core streaming helper ─────────────────────────────────────────────────────

_SSE_DONE = "data: [DONE]\n\n"
_SSE_MEDIA_TYPE = "text/event-stream"
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _ollama_sse_generator(
    messages: list[dict],
    model: str,
    system_prompt: str,
) -> AsyncGenerator[str, None]:
    """Async generator that yields SSE chunks from Ollama streaming API."""
    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    url = f"{base_url}/api/chat"

    payload = {
        "model": model,
        "stream": True,
        "messages": [{"role": "system", "content": system_prompt}, *messages],
    }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    yield f"data: {json.dumps({'error': f'Ollama error {response.status_code}: {body.decode()}'})}\n\n"
                    yield _SSE_DONE
                    return

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    # Ollama streams: {"message": {"role": "assistant", "content": "..."}, "done": false}
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield f"data: {json.dumps({'token': token})}\n\n"

                    if chunk.get("done"):
                        break

        yield _SSE_DONE

    except httpx.ConnectError:
        yield f"data: {json.dumps({'error': f'Cannot connect to Ollama at {base_url}. Make sure Ollama is running.'})}\n\n"
        yield _SSE_DONE
    except asyncio.TimeoutError:
        yield f"data: {json.dumps({'error': 'Ollama request timed out (300s). The cloud model may be loading.'})}\n\n"
        yield _SSE_DONE
    except Exception as exc:
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield _SSE_DONE


# ─── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/chat")
async def chat(request: ChatRequest):
    """Stream a GRC-aware AI chat response from Ollama."""
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/generate-policy")
async def generate_policy(request: PolicyGenerateRequest):
    """
    Stream a generated policy/procedure document for a specific compliance gap.
    Uses Ollama with a specialized policy-writing system prompt.
    """
    user_prompt = (
        f"Generate a complete policy/procedure document to address the following compliance requirement:\n\n"
        f"Framework: {request.framework_short_name}\n"
        f"Control: {request.control_identifier} — {request.control_title}\n"
        f"Control Description: {request.control_description or 'N/A'}\n\n"
        f"COMPLIANCE GAP IDENTIFIED:\n{request.gap_description or 'This control is not currently covered.'}\n\n"
        f"EXISTING DOCUMENTATION (do not repeat, only fill gaps):\n{request.existing_context or 'None provided.'}\n\n"
        f"ORGANIZATION CONTEXT:\n{request.organization_context or 'Technology company.'}\n\n"
        "Write a complete, ready-to-adopt policy document that closes this gap. "
        "Include specific procedures that can be implemented immediately."
    )
    messages = [{"role": "user", "content": user_prompt}]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, POLICY_SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.get("/models")
async def list_models():
    """Return available Ollama models by querying the local Ollama instance."""
    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{base_url}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                model_names = [m["name"] for m in data.get("models", [])]
                return {"models": model_names, "default": DEFAULT_MODEL, "provider": "ollama"}
    except Exception:
        pass
    # Fallback: return the configured model
    return {"models": [DEFAULT_MODEL], "default": DEFAULT_MODEL, "provider": "ollama"}


@router.post("/analyze-risk")
async def analyze_risk(request: RiskAnalyzeRequest):
    """Stream AI-generated risk treatment suggestions, likelihood/impact scores, and linked controls."""
    prompt = f"""Analyze this GRC risk and provide structured guidance:

Risk Title: {request.title}
Description: {request.description or "No description provided."}
Category: {request.risk_category or "General"}

Provide your analysis in exactly this Markdown structure:

## Risk Summary
One paragraph summarizing the risk and its business impact.

## Suggested Likelihood Score
Score: X/5
Justification: (brief reason)

## Suggested Impact Score
Score: X/5
Justification: (brief reason)

## Treatment Options
### Option 1: Mitigate
**Effort:** Low/Medium/High | **Effectiveness:** Low/Medium/High
Steps:
- Step 1
- Step 2

### Option 2: Transfer
**Effort:** Low/Medium/High | **Effectiveness:** Low/Medium/High
Steps:
- Step 1

### Option 3: Accept (if applicable)
Criteria for acceptance and residual risk justification.

## Recommended ISO 27001 Controls
- A.X.X — Control name (brief explanation of relevance)

## Key Risk Indicators (KRIs)
- KRI 1: what to monitor
- KRI 2: what to monitor

Be concise and actionable. Focus on practical steps."""

    messages = [{"role": "user", "content": prompt}]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/analyze-evidence")
async def analyze_evidence(request: EvidenceAnalyzeRequest):
    """Stream AI analysis of uploaded document against framework controls."""
    controls_text = "\n".join(
        f"- {c.get('control_id','?')} — {c.get('title','?')}: {c.get('description','')[:120]}"
        for c in request.controls[:30]  # cap to avoid huge prompts
    )
    prompt = f"""You are a compliance analyst. Analyze the following document extract against {request.framework_short_name} controls.

DOCUMENT EXTRACT:
---
{request.document_text[:4000]}
---

CONTROLS TO ASSESS:
{controls_text}

For each control, assess coverage and output in this exact Markdown format:

## Evidence Analysis — {request.framework_short_name}

### Overall Coverage
Provide a brief (2-3 sentence) summary of how well the document covers the framework.

### Control Coverage Table
For each control listed, output one line:
`CONTROL_ID | STATUS | CONFIDENCE | NOTES`

Where:
- STATUS: Compliant / Partial / Gap / Not Applicable
- CONFIDENCE: High / Medium / Low
- NOTES: one short sentence explaining the finding

### Key Gaps Identified
List the top 3-5 most critical gaps found with brief remediation suggestions.

### Recommended Next Steps
Numbered list of 3-5 actionable next steps."""

    messages = [{"role": "user", "content": prompt}]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/generate-audit-plan")
async def generate_audit_plan(request: AuditPlanRequest):
    """Stream an AI-generated audit program with test steps and evidence requirements."""
    controls_text = "\n".join(
        f"- {c.get('control_id','?')} [{c.get('category','?')}] — {c.get('title','?')}"
        for c in request.controls[:40]
    )
    prompt = f"""Generate a complete, professional audit program for the following engagement:

Audit Title: {request.audit_title}
Framework: {request.framework_name} ({request.framework_short_name})
Scope: {request.audit_scope or "All systems and processes covered by the framework."}
Objective: {request.audit_objective or f"Assess conformance with {request.framework_name} requirements."}

CONTROLS IN SCOPE:
{controls_text}

Generate the audit program in this Markdown structure:

## Audit Program — {request.audit_title}

### Executive Summary
Brief description of audit objectives, scope, and approach.

### Audit Methodology
How the audit will be conducted (interviews, document review, technical testing, sampling).

### Audit Program

For each major control area, provide:

#### [Control Area Name]
| Control ID | Test Objective | Test Procedure | Evidence Required | Sample Size |
|-----------|---------------|----------------|-------------------|-------------|
| A.X.X | What to test | How to test it | What to collect | N items |

### Fieldwork Schedule
| Phase | Activities | Duration | Resources |
|-------|-----------|----------|-----------|
| Planning | ... | Week 1 | ... |
| Fieldwork | ... | Weeks 2-4 | ... |
| Reporting | ... | Week 5 | ... |

### Reporting & Findings Template
Brief guidance on finding severity classification and report structure.

Be practical and specific. Focus on actionable test steps that an auditor can execute immediately."""

    messages = [{"role": "user", "content": prompt}]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/analyze-vendor")
async def analyze_vendor(request: VendorRiskRequest):
    """Stream AI vendor risk scoring from questionnaire responses."""
    qa_text = "\n".join(
        f"Q: {q}\nA: {a}"
        for q, a in list(request.questionnaire_responses.items())[:30]
    )
    prompt = f"""Analyze the following vendor security questionnaire responses and provide a comprehensive risk assessment.

Vendor: {request.vendor_name}
Industry: {request.vendor_industry or "Technology"}
Services Provided: {request.vendor_services or "Not specified"}

QUESTIONNAIRE RESPONSES:
---
{qa_text}
---

Provide your assessment in this exact Markdown structure:

## Vendor Risk Assessment — {request.vendor_name}

### Overall Risk Score
**Score: X/10** (where 10 = highest risk)
**Risk Tier: Critical / High / Medium / Low**

### Executive Summary
2-3 sentences summarizing the vendor's security posture.

### Domain Scores
| Domain | Score | Status | Key Finding |
|--------|-------|--------|-------------|
| Access Control | X/10 | 🔴/🟡/🟢 | ... |
| Data Protection | X/10 | 🔴/🟡/🟢 | ... |
| Incident Response | X/10 | 🔴/🟡/🟢 | ... |
| Business Continuity | X/10 | 🔴/🟡/🟢 | ... |
| Compliance & Certifications | X/10 | 🔴/🟡/🟢 | ... |
| Third-Party Management | X/10 | 🔴/🟡/🟢 | ... |

### Critical Findings
List top 3-5 critical or high-severity findings with brief remediation.

### Recommended Contract Clauses
List 3-5 specific contract/DPA clauses to add based on identified risks.

### Monitoring Recommendations
How frequently to reassess this vendor and what triggers immediate reassessment.

Be direct and specific. Base scoring strictly on the responses provided."""

    messages = [{"role": "user", "content": prompt}]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


class RemediationPlanRequest(BaseModel):
    assessment_id: str
    framework_short_name: str | None = None
    gaps: list[dict] = []    # optional — if empty, fetched from DB
    model: str = DEFAULT_MODEL


@router.post("/stream-remediation-plan")
async def stream_remediation_plan(request: RemediationPlanRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    """
    Stream a prioritized 90-day remediation plan based on open compliance gaps.
    Gaps are sorted by severity/blocker status and organized into monthly phases.
    If gaps not provided, fetches them from the database for the given assessment.
    """
    from sqlalchemy import select as sa_select
    from app.models.compliance import ComplianceAssessment, ComplianceGap, ControlAssessment
    from app.models.framework import Framework, FrameworkControl

    gaps = list(request.gaps)
    framework_short_name = request.framework_short_name or ""

    # If no gaps or framework provided, load from DB
    if not gaps or not framework_short_name:
        assessment = (await db.execute(
            sa_select(ComplianceAssessment).where(ComplianceAssessment.id == request.assessment_id)
        )).scalar_one_or_none()
        if assessment:
            if not framework_short_name:
                fw = (await db.execute(
                    sa_select(Framework).where(Framework.id == assessment.framework_id)
                )).scalar_one_or_none()
                framework_short_name = fw.short_name if fw else ""

            if not gaps:
                db_gaps = (await db.execute(
                    sa_select(ComplianceGap).where(
                        ComplianceGap.assessment_id == request.assessment_id,
                        ComplianceGap.is_resolved == False,  # noqa: E712
                    )
                )).scalars().all()

                controls = (await db.execute(
                    sa_select(FrameworkControl).where(FrameworkControl.framework_id == assessment.framework_id)
                )).scalars().all()
                ctrl_map = {c.id: c for c in controls}

                for g in db_gaps:
                    ctrl = ctrl_map.get(g.control_id)
                    gaps.append({
                        "control_identifier": ctrl.control_id if ctrl else g.control_id,
                        "control_title": ctrl.title if ctrl else "",
                        "severity": g.severity,
                        "gap_description": g.gap_description,
                        "is_certification_blocker": bool(g.is_certification_blocker),
                    })

    blockers = [g for g in gaps if g.get("is_certification_blocker")]
    high = [g for g in gaps if not g.get("is_certification_blocker") and g.get("severity") in ("critical", "high")]
    others = [g for g in gaps if not g.get("is_certification_blocker") and g.get("severity") not in ("critical", "high")]

    def fmt_gap(g: dict) -> str:
        return f"- [{g.get('control_identifier','')}] {g.get('control_title','')}: {g.get('gap_description','')[:150]}"

    blockers_text = "\n".join(fmt_gap(g) for g in blockers[:10]) or "None"
    high_text = "\n".join(fmt_gap(g) for g in high[:10]) or "None"
    others_text = "\n".join(fmt_gap(g) for g in others[:15]) or "None"

    prompt = f"""Create a detailed, actionable 90-day remediation plan to achieve {framework_short_name} certification readiness.

CERTIFICATION BLOCKERS (must fix first):
{blockers_text}

HIGH PRIORITY GAPS:
{high_text}

MEDIUM/LOW PRIORITY GAPS:
{others_text}

Generate the plan in this exact Markdown structure:

# 90-Day {framework_short_name} Remediation Plan

## Executive Summary
2-3 sentences on the overall remediation strategy and certification timeline.

## Month 1 (Days 1–30): Critical Foundations
Focus on all certification blockers and critical gaps.

### Week 1-2
| Control | Action | Owner Role | Deliverable |
|---------|--------|-----------|-------------|
| ...     | ...    | CISO/IT   | ...         |

### Week 3-4
| Control | Action | Owner Role | Deliverable |
|---------|--------|-----------|-------------|

## Month 2 (Days 31–60): Core Controls
Address high-priority gaps and begin documentation.

### Week 5-6
| Control | Action | Owner Role | Deliverable |
|---------|--------|-----------|-------------|

### Week 7-8
| Control | Action | Owner Role | Deliverable |
|---------|--------|-----------|-------------|

## Month 3 (Days 61–90): Finalization & Readiness
Complete remaining gaps, internal audit, management review.

### Week 9-10
| Control | Action | Owner Role | Deliverable |
|---------|--------|-----------|-------------|

### Week 11-12
| Control | Action | Owner Role | Deliverable |
|---------|--------|-----------|-------------|

## Key Milestones
| Date | Milestone | Success Criteria |
|------|-----------|-----------------|
| Day 30 | ... | ... |
| Day 60 | ... | ... |
| Day 90 | ... | ... |

## Resource Requirements
- Personnel: roles needed
- Tools: any tooling recommendations
- Budget estimate: rough ranges

## Risk to Plan
Top 2-3 risks that could delay the plan and mitigations.

Be specific, practical, and directly tied to the gaps listed above."""

    messages = [{"role": "user", "content": prompt}]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


DOCUMENT_GENERATION_SYSTEM_PROMPT = """You are a senior GRC consultant with 20+ years of experience writing complete, professional, audit-ready security governance documents for organizations of all sizes.

Rules you MUST follow:
- Output ONLY the document itself in clean Markdown. No preamble, no meta-commentary, no "here is your document".
- Start directly with the document title as an H1 heading.
- Use "shall" and "must" for mandatory requirements. Never use "should consider" or "may want to".
- Include a document header block after the title: Version (1.0), Classification (Internal — Confidential), Owner (appropriate role), Review Cycle (Annual), Effective Date (current month/year).
- Every section must have concrete, implementable content specific to the organization described. Zero generic filler.
- Calibrate depth and formality precisely to the organization size:
  - Startup (1-50): 2-4 pages, combine roles, pragmatic and lean, CEO/CTO owns security.
  - SMB (51-500): 4-8 pages, defined ownership per department, small IT team.
  - Mid-Market (501-5000): 8-15 pages, full departmental structure, formal approval chains, likely a CISO.
  - Enterprise (5000+): 15-25 pages, governance committees, legal/regulatory depth, dedicated security org.
- Where a framework is specified, cite the relevant controls in parentheses inline (e.g., ISO 27001:2022 A.5.1, NIST CSF PR.AC-1, SOC 2 CC6.1).
- Use real, concrete examples relevant to the organization's industry.
- End with a Revision History table: Version | Date | Author | Change Summary — one initial row."""

_SIZE_DETAIL = {
    "startup": "1-50 employees — no dedicated security team, the CEO or CTO owns security and compliance",
    "smb": "51-500 employees — small IT team, likely no dedicated CISO, compliance managed by IT manager or operations",
    "midmarket": "501-5000 employees — IT and security teams exist, likely a CISO or vCISO, formal procurement and HR processes",
    "enterprise": "5000+ employees — dedicated security organization, legal/compliance teams, board-level oversight",
}


class DocumentGenerateRequest(BaseModel):
    document_type: str
    org_name: str
    industry: str
    size: str = "smb"
    country: str = "US"
    frameworks: str | None = None
    specific_requirements: str | None = None
    model: str = DEFAULT_MODEL


@router.post("/generate-document")
async def generate_document(request: DocumentGenerateRequest):
    """
    Stream a complete GRC document (policy, procedure, plan) tailored to the
    organization's context, size, industry, and target compliance framework(s).
    """
    size_detail = _SIZE_DETAIL.get(request.size, _SIZE_DETAIL["smb"])
    framework_instruction = (
        f"Target Compliance Framework(s): {request.frameworks} — cite relevant controls inline."
        if request.frameworks
        else "No specific framework required — write framework-agnostic best-practice content."
    )

    user_prompt = f"""Generate a complete, ready-to-adopt {request.document_type} for the following organization.

ORGANIZATION PROFILE
- Company Name: {request.org_name}
- Industry: {request.industry}
- Size: {size_detail}
- Country / Jurisdiction: {request.country}
- {framework_instruction}
{f"- Specific Requirements: {request.specific_requirements}" if request.specific_requirements else ""}

Generate the complete {request.document_type} now. Start directly with the document title as an H1."""

    messages = [{"role": "user", "content": user_prompt}]
    return StreamingResponse(
        _ollama_sse_generator(messages, request.model, DOCUMENT_GENERATION_SYSTEM_PROMPT),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.get("/health")
async def ai_health():
    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/api/tags")
            reachable = resp.status_code == 200
    except Exception:
        pass
    return {
        "status": "ok" if reachable else "ollama_unreachable",
        "provider": "ollama",
        "model": DEFAULT_MODEL,
        "ollama_url": base_url,
        "reachable": reachable,
    }
