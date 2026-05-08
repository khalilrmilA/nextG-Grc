"""
AI Assistant endpoint — streams responses from Ollama (cloud models).
Uses Ollama's OpenAI-compatible /api/chat endpoint with streaming.
"""
import json
import asyncio
from collections.abc import AsyncGenerator
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, bearer_scheme_optional
from app.models.user import User
from app.models.ai_access import AiUsageQuota
from pydantic import BaseModel
import httpx

from app.core.config import settings
from app.core import ai_quota

router = APIRouter()


# ─── Access control helpers ────────────────────────────────────────────────────

async def _get_or_create_quota(db: AsyncSession, user: User) -> AiUsageQuota:
    """Return the user's quota row, auto-creating one if missing.
    Since this platform uses local Ollama (no API cost), every authenticated
    user gets generous limits automatically.  Limits reset monthly."""
    from datetime import datetime, timedelta, timezone

    result = await db.execute(
        select(AiUsageQuota).where(AiUsageQuota.user_id == user.id)
    )
    quota = result.scalar_one_or_none()

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    if quota is None:
        # Auto-provision: 1 M tokens / 10 K requests per month
        from uuid import uuid4
        quota = AiUsageQuota(
            id=str(uuid4()),
            tenant_id=user.tenant_id,
            user_id=user.id,
            feature="all",
            monthly_limit_tokens=1_000_000,
            monthly_limit_requests=10_000,
            monthly_used_tokens=0,
            monthly_used_requests=0,
            reset_date=now + timedelta(days=30),
            is_approved=True,
        )
        db.add(quota)
        await db.commit()
        await db.refresh(quota)

    # Auto-reset if past reset date
    if quota.reset_date and now > quota.reset_date:
        quota.monthly_used_tokens = 0
        quota.monthly_used_requests = 0
        quota.reset_date = now + timedelta(days=30)
        quota.is_approved = True
        await db.commit()

    return quota


async def _require_ai_access(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> tuple[User, AiUsageQuota]:
    """Dependency: ensure the user has AI access AND has not exceeded the
    daily 100k-token cap (see app.core.ai_quota.DAILY_TOKEN_LIMIT)."""
    # Daily-token guardrail: hard 429 when exceeded. Resets at 00:00 UTC.
    ai_quota.check_quota_or_raise(current_user.id)

    quota = await _get_or_create_quota(db, current_user)

    # Soft monthly limits: reset usage instead of blocking (local Ollama has no cost)
    if quota.monthly_used_tokens >= quota.monthly_limit_tokens:
        from datetime import datetime, timedelta, timezone
        quota.monthly_used_tokens = 0
        quota.monthly_used_requests = 0
        quota.reset_date = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)
        await db.commit()

    return current_user, quota


async def _increment_usage(db: AsyncSession, quota: AiUsageQuota, token_estimate: int) -> None:
    """Increment monthly usage counters after a request completes."""
    # Only add tokens up to the limit - don't allow exceeding it
    remaining_tokens = quota.monthly_limit_tokens - quota.monthly_used_tokens
    tokens_to_add = min(token_estimate, max(0, remaining_tokens))

    quota.monthly_used_tokens += tokens_to_add
    quota.monthly_used_requests += 1
    await db.commit()


async def _tracked_sse_generator(
    messages: list[dict],
    model: str,
    system_prompt: str,
    db: AsyncSession,
    quota: AiUsageQuota,
) -> AsyncGenerator[str, None]:
    """Wrap _ollama_sse_generator and increment both monthly DB quota AND
    daily ai_quota counter when stream ends."""
    total_chars = 0
    async for chunk in _ollama_sse_generator(messages, model, system_prompt):
        total_chars += len(chunk)
        yield chunk
    # Estimate tokens from chars (~4 chars per token) and record usage in
    # both the monthly DB-backed quota and the daily ai_quota counter.
    estimated_tokens = max(1, total_chars // 4)
    await _increment_usage(db, quota, estimated_tokens)
    if quota.user_id:
        ai_quota.record_usage(quota.user_id, estimated_tokens)

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


async def _quota_only_sse_generator(
    messages: list[dict],
    model: str,
    system_prompt: str,
    user_id: str,
) -> AsyncGenerator[str, None]:
    """Wrap _ollama_sse_generator and record only the daily ai_quota counter
    (used by /chat which has no DB-backed monthly quota row)."""
    total_chars = 0
    async for chunk in _ollama_sse_generator(messages, model, system_prompt):
        total_chars += len(chunk)
        yield chunk
    ai_quota.record_usage(user_id, max(1, total_chars // 4))


@router.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Stream a GRC-aware AI chat response from Ollama. Subject to the daily
    ai_quota.DAILY_TOKEN_LIMIT per user."""
    estimated = ai_quota.estimate_tokens(
        " ".join(m.content for m in request.messages)
    )
    ai_quota.check_quota_or_raise(current_user.id, estimated)
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    return StreamingResponse(
        _quota_only_sse_generator(messages, request.model, SYSTEM_PROMPT, current_user.id),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/generate-policy")
async def generate_policy(
    request: PolicyGenerateRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Stream a generated policy/procedure document for a specific compliance gap.
    Uses Ollama with a specialized policy-writing system prompt.
    """
    _, quota = access
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
        _tracked_sse_generator(messages, request.model, POLICY_SYSTEM_PROMPT, db, quota),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.get("/models")
async def list_models(current_user: Annotated[User, Depends(get_current_user)]):
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
async def analyze_risk(
    request: RiskAnalyzeRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Stream AI-generated risk treatment suggestions, likelihood/impact scores, and linked controls."""
    _, quota = access
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
        _tracked_sse_generator(messages, request.model, SYSTEM_PROMPT, db, quota),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/analyze-evidence")
async def analyze_evidence(
    request: EvidenceAnalyzeRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Stream AI analysis of uploaded document against framework controls."""
    _, quota = access
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
        _tracked_sse_generator(messages, request.model, SYSTEM_PROMPT, db, quota),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/generate-audit-plan")
async def generate_audit_plan(
    request: AuditPlanRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Stream an AI-generated audit program with test steps and evidence requirements."""
    _, quota = access
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
        _tracked_sse_generator(messages, request.model, SYSTEM_PROMPT, db, quota),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.post("/analyze-vendor")
async def analyze_vendor(
    request: VendorRiskRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Analyze vendor with web search and return full analysis as JSON."""
    ai_quota.check_quota_or_raise(current_user.id)
    # Perform web search for vendor information
    web_context = ""
    try:
        import httpx
        from urllib.parse import quote_plus
        search_query = f"{request.vendor_name} security compliance certifications"
        search_url = f"https://api.duckduckgo.com/?q={quote_plus(search_query)}&format=json&no_html=1"
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as http_client:
            resp = await http_client.get(search_url)
            if resp.status_code == 200:
                data = resp.json()
                if 'Results' in data and data['Results']:
                    web_context = "\n\n### Web Search Findings:\n"
                    for i, result in enumerate(data['Results'][:5], 1):
                        title = result.get("Title", "No title")
                        snippet = result.get("Text", "")
                        url = result.get("FirstURL", "")
                        web_context += f"**{i}. {title}**\n"
                        if snippet:
                            web_context += f"{snippet}\n"
                        if url:
                            web_context += f"*Source: {url}*\n\n"
    except Exception as e:
        # Continue without web search if it fails
        import logging
        logging.warning(f"Web search failed: {e}")
        web_context = "\n\n*Note: Web search unavailable*\n"

    qa_text = "\n".join(
        f"Q: {q}\nA: {a}"
        for q, a in list(request.questionnaire_responses.items())[:30]
    )
    prompt = f"""You are a senior cybersecurity risk analyst conducting a comprehensive third-party risk assessment. Analyze the following vendor security questionnaire responses and web search findings to produce a detailed, production-grade risk assessment.

VENDOR INFORMATION:
- Name: {request.vendor_name}
- Industry: {request.vendor_industry or "Technology"}
- Services: {request.vendor_services or "Not specified"}

QUESTIONNAIRE RESPONSES:
{qa_text}

{web_context}

---

INSTRUCTIONS: Provide a comprehensive vendor risk assessment following this EXACT structure. Be specific, data-driven, and production-ready.

# Vendor Risk Assessment Report
## {request.vendor_name}

**Assessment Date:** [Current Date]
**Risk Classification:** [CRITICAL/HIGH/MEDIUM/LOW]

---

## Executive Summary

[Provide 3-4 sentences summarizing the vendor's overall security posture, key risks, and business impact. Include specific evidence from both questionnaire and web research.]

---

## Risk Scoring Overview

| Metric | Score | Interpretation |
|--------|-------|-----------------|
| **Overall Risk Score** | X/10 | [Justification based on weighted domain scores] |
| **Compliance Readiness** | X/10 | [GDPR/SOC2/ISO27001 alignment] |
| **Incident Response Maturity** | X/10 | [Based on documented processes] |
| **Data Protection Level** | X/10 | [Encryption and access controls] |
| **Third-Party Management** | X/10 | [Subprocessor oversight and SLAs] |

**Risk Tier Decision Matrix:**
- 9-10: CRITICAL - Do not engage without immediate risk mitigation
- 7-8: HIGH - Engage with strict controls and frequent monitoring
- 5-6: MEDIUM - Engage with standard controls and quarterly reviews
- 1-4: LOW - Engage with standard contracts and annual reviews

---

## Detailed Domain Assessment

### 1. Access Control & Identity Management
**Risk Score: X/10** | Status: 🔴/🟡/🟢

**Questionnaire Findings:**
- MFA Implementation: [Yes/No/Partial] - Evidence: [specific response]
- Background Checks: [Yes/No/Partial] - Evidence: [specific response]
- Privileged Access Management: [Yes/No/Partial] - Evidence: [specific response]

**Web Research Findings:**
- [Any public security incidents related to access control]
- [Industry reputation for access security]

**Risk Assessment:**
[2-3 sentences analyzing access control maturity]

**Remediation Priority:** [Critical/High/Medium]

---

### 2. Data Protection & Encryption
**Risk Score: X/10** | Status: 🔴/🟡/🟢

**Questionnaire Findings:**
- Data at Rest Encryption: [Yes/No/Unknown] - [AES-256/AES-128/None]
- Data in Transit Encryption: [Yes/No/Unknown] - [TLS 1.2+/SSL/None]
- Encryption Key Management: [Yes/No/Partial] - Evidence: [specific response]

**Web Research Findings:**
- [Any data breach history or encryption failures]
- [Industry standards compliance]

**Risk Assessment:**
[2-3 sentences analyzing data protection maturity]

**Remediation Priority:** [Critical/High/Medium]

---

### 3. Incident Response & Business Continuity
**Risk Score: X/10** | Status: 🔴/🟡/🟢

**Questionnaire Findings:**
- Documented IR Plan: [Yes/No/Partial]
- Penetration Testing: [Yes/No/Frequency: ___]
- Business Continuity/DR Plan: [Yes/No/RTO: ___/RPO: ___]

**Web Research Findings:**
- [Public incident disclosures or breach history]
- [Industry track record for uptime/availability]

**Risk Assessment:**
[2-3 sentences analyzing incident response maturity]

**Remediation Priority:** [Critical/High/Medium]

---

### 4. Compliance & Security Certifications
**Risk Score: X/10** | Status: 🔴/🟡/🟢

**Questionnaire Findings:**
- ISO 27001: [Certified/Not Certified/In Progress] - [Year: ___]
- SOC 2 Type II: [Certified/Not Certified/In Progress]
- GDPR Compliance: [Yes/No/Unknown]
- Other Relevant Certifications: [List]

**Web Research Findings:**
- [Verified certifications found]
- [Compliance audit reports available]
- [Regulatory actions or warnings]

**Risk Assessment:**
[2-3 sentences analyzing compliance posture]

**Remediation Priority:** [Critical/High/Medium]

---

### 5. Third-Party & Subprocessor Management
**Risk Score: X/10** | Status: 🔴/🟡/🟢

**Questionnaire Findings:**
- Subprocessor List Maintained: [Yes/No]
- Subprocessor Vetting Process: [Yes/No/Description: ___]
- Written Agreements with Subprocessors: [Yes/No]

**Risk Assessment:**
[2-3 sentences analyzing third-party management]

**Remediation Priority:** [Critical/High/Medium]

---

## Critical Risk Items (Ranked by Severity)

| # | Risk | Impact | Evidence | Remediation | Timeline |
|---|------|--------|----------|------------|----------|
| 1 | [Risk Name] | [Critical/High/Medium] | [Source: Questionnaire/Web] | [Required Action] | [Immediate/30 days/90 days] |
| 2 | [Risk Name] | [Critical/High/Medium] | [Source: Questionnaire/Web] | [Required Action] | [Immediate/30 days/90 days] |
| 3 | [Risk Name] | [Critical/High/Medium] | [Source: Questionnaire/Web] | [Required Action] | [Immediate/30 days/90 days] |

---

## Recommended Contract Clauses & SLAs

### Data Security Requirements
- Data Encryption: "Vendor shall encrypt all data at rest using AES-256 and in transit using TLS 1.2+"
- Encryption Key Management: "Vendor maintains encryption keys separately from data and implements key rotation annually"
- Data Residency: "[Specify geographic requirements]"

### Compliance & Audit Rights
- Certification Requirements: "Vendor shall maintain ISO 27001 or SOC 2 Type II certification"
- Right to Audit: "Customer may conduct annual security audits or require third-party penetration testing"
- Compliance Reporting: "Vendor provides quarterly security posture reports"

### Incident Management
- Breach Notification: "Vendor notifies customer within 24 hours of any confirmed security incident"
- Root Cause Analysis: "Vendor provides RCA within 10 business days of incident"
- Remediation SLA: "Critical incidents remediated within 48 hours"

### Service Level Agreements
- Uptime: "99.5% monthly uptime with [RTO/RPO] for disaster recovery"
- Incident Response: "Critical incidents acknowledged within 2 hours, resolved within 4 hours"
- Patch Management: "Critical security patches applied within 48 hours"

---

## Monitoring & Reassessment Plan

### Risk Tier → Monitoring Frequency
- **CRITICAL**: Monthly reviews + immediate action on any incident
- **HIGH**: Quarterly reviews + bi-annual security assessments
- **MEDIUM**: Semi-annual reviews + annual security assessments
- **LOW**: Annual reviews + standard contract compliance checks

### Reassessment Triggers
- [ ] Security incident or breach notification
- [ ] Loss or expiration of required certifications
- [ ] Major service outage or availability issue
- [ ] Regulatory requirement changes (GDPR, PCI-DSS, etc.)
- [ ] Change in ownership or corporate structure
- [ ] Negative security news or public vulnerabilities

### Key Metrics to Track
1. **Security Posture**: Vulnerability scan results, patch compliance rate
2. **Operational**: Uptime percentage, incident response times
3. **Compliance**: Certification status, audit readiness, policy updates
4. **Financial**: SLA credits, penalty assessments, contract performance

---

## Risk Acceptance Decision

**Recommendation:** [ACCEPT / ACCEPT WITH CONDITIONS / REJECT / ESCALATE]

**Justification:** [2-3 sentences on the decision]

**Required Conditions (if applicable):**
- [ ] Condition 1
- [ ] Condition 2
- [ ] Condition 3

**Escalation (if needed):** [Who should approve this decision]

---

## Appendix: Web Research Summary

**Findings:**
{web_context}

**Sources Checked:** DuckDuckGo public search, industry databases, certification registries

---

**Report Prepared By:** Automated Risk Assessment System
**Confidence Level:** [High/Medium/Low] based on questionnaire completeness and web data availability
**Next Review Date:** [Calculated based on risk tier]"""

    messages = [{"role": "user", "content": prompt}]

    # Get response from Ollama
    full_response = ""
    async for chunk in _ollama_sse_generator(messages, request.model, SYSTEM_PROMPT):
        # Extract text from SSE chunk format
        if chunk.startswith("data: "):
            data_str = chunk[6:].strip()
            try:
                data = json.loads(data_str)
                # Check for token (streaming data) or error
                if "token" in data:
                    full_response += data["token"]
                elif "error" in data:
                    full_response += f"\n\n**Error**: {data['error']}\n"
            except Exception as e:
                # Ignore parse errors and continue
                pass

    return {"message": full_response}


class RemediationPlanRequest(BaseModel):
    assessment_id: str
    framework_short_name: str | None = None
    gaps: list[dict] = []    # optional — if empty, fetched from DB
    model: str = DEFAULT_MODEL


@router.post("/stream-remediation-plan")
async def stream_remediation_plan(
    request: RemediationPlanRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Stream a prioritized 90-day remediation plan based on open compliance gaps.
    Gaps are sorted by severity/blocker status and organized into monthly phases.
    If gaps not provided, fetches them from the database for the given assessment.
    """
    _, quota = access
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
        _tracked_sse_generator(messages, request.model, SYSTEM_PROMPT, db, quota),
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
async def generate_document(
    request: DocumentGenerateRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Stream a complete GRC document (policy, procedure, plan) tailored to the
    organization's context, size, industry, and target compliance framework(s).
    """
    _, quota = access
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
        _tracked_sse_generator(messages, request.model, DOCUMENT_GENERATION_SYSTEM_PROMPT, db, quota),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )


@router.get("/access-check")
async def ai_access_check(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Return the user's AI access status and current quota usage."""
    quota = await _check_ai_quota(db, current_user)
    if not quota:
        return {"has_access": False, "tokens_used": 0, "tokens_limit": 0, "requests_used": 0, "requests_limit": 0, "percentage_used": 0, "reset_at": None}
    pct = int(quota.monthly_used_tokens / quota.monthly_limit_tokens * 100) if quota.monthly_limit_tokens else 0
    return {
        "has_access": True,
        "tokens_used": quota.monthly_used_tokens,
        "tokens_limit": quota.monthly_limit_tokens,
        "requests_used": quota.monthly_used_requests,
        "requests_limit": quota.monthly_limit_requests,
        "percentage_used": pct,
        "reset_at": quota.reset_date.isoformat() if quota.reset_date else None,
    }


@router.get("/health")
async def ai_health(current_user: Annotated[User, Depends(get_current_user)]):
    """Check if Ollama is reachable. Authenticated; does not leak the
    internal Ollama URL (was an information disclosure pre-fix)."""
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
        "reachable": reachable,
    }


# ── Contract Collaboration Analysis ──────────────────────────────────────────

class ContractAnalysisRequest(BaseModel):
    contract_text: str
    ai_review: str | None = None   # existing review text if available
    vendor_name: str = "Vendor"
    model: str = DEFAULT_MODEL


@router.post("/stream-contract-analysis")
async def stream_contract_analysis(
    request: ContractAnalysisRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Stream a structured contract analysis with:
    1. Inline fix suggestions per clause (JSON array)
    2. A prioritised vendor action plan (JSON array)

    The response streams two JSON blocks separated by a sentinel line:
      --- SUGGESTIONS ---
      [{"id":1,"clause":"...","severity":"critical","issue":"...","fix":"...","status":"open"}, ...]
      --- ACTION_PLAN ---
      [{"id":1,"priority":"high","action":"...","responsible":"Vendor","deadline":"30 days","done":false}, ...]
    """
    _, quota = access

    contract_snippet = request.contract_text[:6000] if request.contract_text else ""
    review_context = f"\n\nExisting AI review summary:\n{request.ai_review[:2000]}" if request.ai_review else ""

    system = (
        "You are a senior legal and cybersecurity contract analyst specialising in IT vendor "
        "agreements, GDPR, DORA, NIS2, and ISO 27001. You produce precise, structured JSON output."
    )

    prompt = f"""Analyse the following vendor contract for {request.vendor_name} and produce TWO JSON outputs.

CONTRACT TEXT (excerpt):
{contract_snippet}{review_context}

OUTPUT FORMAT — respond with EXACTLY this structure, nothing else:

--- SUGGESTIONS ---
[
  {{
    "id": 1,
    "clause": "Section X.Y - Title",
    "severity": "critical|high|medium|low",
    "issue": "One sentence describing the problem",
    "fix": "Exact replacement or addition text the vendor should apply to the contract",
    "status": "open"
  }}
]
--- ACTION_PLAN ---
[
  {{
    "id": 1,
    "priority": "critical|high|medium|low",
    "action": "Concrete action the vendor must take",
    "responsible": "Vendor Legal Team|Vendor CISO|Vendor DPO|Vendor CEO",
    "deadline": "Immediate|7 days|14 days|30 days|60 days|90 days",
    "done": false
  }}
]

Rules:
- Suggestions: 5-10 items, ordered by severity descending
- Action plan: 6-12 items covering legal, security, compliance, and operational gaps
- Be specific — reference actual clauses and article numbers
- Fix text should be ready to insert directly into the contract
- Focus on: liability caps, data protection (GDPR/DORA), SLA penalties, termination rights, audit rights, sub-processor controls, incident notification timelines, IP ownership"""

    messages = [{"role": "user", "content": prompt}]

    return StreamingResponse(
        _tracked_sse_generator(messages, request.model, system, db, quota),
        media_type=_SSE_MEDIA_TYPE,
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
