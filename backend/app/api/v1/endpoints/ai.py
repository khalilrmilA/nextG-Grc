"""
AI Assistant endpoint — streams responses from Ollama.
Provides GRC-context-aware chat and policy generation using local LLM.
"""
import json
import asyncio
import requests
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()

OLLAMA_BASE_URL = settings.OLLAMA_BASE_URL
DEFAULT_MODEL   = settings.OLLAMA_CHAT_MODEL

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
    control_identifier: str       # e.g., "A.8.1"
    control_title: str
    framework_short_name: str     # e.g., "ISO27001"
    control_description: str | None = None
    gap_description: str | None = None
    existing_context: str | None = None
    organization_context: str | None = None
    model: str = DEFAULT_MODEL


# ─── Core streaming helpers ────────────────────────────────────────────────────


def _blocking_stream(
    messages: list[dict],
    model: str,
    queue: "asyncio.Queue[str | None]",
    loop: asyncio.AbstractEventLoop,
    system_prompt: str | None = None,
):
    """Run in a thread: call Ollama and push SSE lines into the async queue."""
    effective_system = system_prompt if system_prompt is not None else SYSTEM_PROMPT
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": effective_system}] + messages,
        "stream": True,
        "options": {"temperature": 0.7, "top_p": 0.9},
    }
    try:
        with requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            stream=True,
            timeout=(60, 120),
        ) as resp:
            if resp.status_code != 200:
                error = resp.text
                try:
                    error = json.loads(resp.text).get("error", resp.text)
                except Exception:
                    pass
                asyncio.run_coroutine_threadsafe(
                    queue.put(f"data: {json.dumps({'error': error})}\n\n"), loop
                ).result()
                return
            for raw_line in resp.iter_lines():
                if not raw_line:
                    continue
                try:
                    data = json.loads(raw_line)
                    token = data.get("message", {}).get("content", "")
                    if token:
                        asyncio.run_coroutine_threadsafe(
                            queue.put(f"data: {json.dumps({'token': token})}\n\n"), loop
                        ).result()
                    if data.get("done"):
                        asyncio.run_coroutine_threadsafe(
                            queue.put("data: [DONE]\n\n"), loop
                        ).result()
                        return
                except json.JSONDecodeError:
                    continue
    except requests.exceptions.ConnectionError:
        asyncio.run_coroutine_threadsafe(
            queue.put(f"data: {json.dumps({'error': 'Cannot connect to Ollama on port 11434.'})}\n\n"), loop
        ).result()
    except Exception as exc:
        asyncio.run_coroutine_threadsafe(
            queue.put(f"data: {json.dumps({'error': str(exc)})}\n\n"), loop
        ).result()
    finally:
        asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()


async def _sse_generator(messages: list[dict], model: str, system_prompt: str | None = None):
    """Async generator that yields SSE chunks from a background thread."""
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop.run_in_executor(None, _blocking_stream, messages, model, queue, loop, system_prompt)
    while True:
        item = await queue.get()
        if item is None:
            break
        yield item


# ─── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/chat")
async def chat(request: ChatRequest):
    """Stream a GRC-aware AI chat response from Ollama."""
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    return StreamingResponse(
        _sse_generator(messages, request.model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/generate-policy")
async def generate_policy(request: PolicyGenerateRequest):
    """
    Stream a generated policy/procedure document for a specific compliance gap.
    Uses a specialized policy-writing system prompt for higher quality output.
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
        _sse_generator(messages, request.model, system_prompt=POLICY_SYSTEM_PROMPT),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/models")
async def list_models():
    """Return available Ollama models."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            models = [m["name"] for m in resp.json().get("models", [])]
            return {"models": models, "default": DEFAULT_MODEL}
    except Exception:
        return {"models": [DEFAULT_MODEL], "default": DEFAULT_MODEL}


@router.get("/health")
async def ai_health():
    """Check if Ollama is reachable."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            return {"status": "ok", "ollama": resp.status_code == 200}
    except Exception:
        return {"status": "error", "ollama": False}
