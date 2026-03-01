"""
AI Assistant endpoint — streams responses from Ollama (cloud models).
Uses Ollama's OpenAI-compatible /api/chat endpoint with streaming.
"""
import json
import asyncio
from collections.abc import AsyncGenerator
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
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


# ─── Core streaming helper ─────────────────────────────────────────────────────

_SSE_DONE = "data: [DONE]\n\n"


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
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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


@router.get("/health")
async def ai_health():
    """Check if Ollama is reachable."""
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
