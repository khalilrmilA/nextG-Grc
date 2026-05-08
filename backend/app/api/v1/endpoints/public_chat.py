"""
Public support chatbot endpoint — no authentication required.
Restricted to GRCEye platform questions and general GRC topics only.
Rate-limited by IP using a simple in-memory sliding window.
"""
import json
import asyncio
import time
from collections import defaultdict
from collections.abc import AsyncGenerator
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

from app.core.config import settings

router = APIRouter()

# ── In-memory rate limiter (per IP, 20 requests per 10 minutes) ───────────────
_rate_store: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = 20
_RATE_WINDOW = 600  # 10 minutes in seconds


def _check_rate_limit(ip: str) -> None:
    now = time.time()
    timestamps = _rate_store[ip]
    # Evict old timestamps outside the window
    _rate_store[ip] = [t for t in timestamps if now - t < _RATE_WINDOW]
    if len(_rate_store[ip]) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a few minutes before sending more messages.",
        )
    _rate_store[ip].append(now)


# ── System prompt ─────────────────────────────────────────────────────────────

SUPPORT_SYSTEM_PROMPT = """You are GRCEye Support, a friendly and professional support assistant for the GRCEye platform.

You help visitors understand and use GRCEye — a GRC (Governance, Risk & Compliance) SaaS platform.

== WHAT YOU CAN ANSWER ==

1. GRCEye platform questions:
   - Features: Risk Management, Compliance, Audit Management, Policy Management, Vendor Risk (TPRM), AI capabilities, Reporting
   - Modules: how they work, what they do, how to use them
   - Frameworks: ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, NIST CSF, NIST 800-53, CIS Controls, DORA, NIS2, AI Act, and 64+ more
   - Roles: CISO, Risk Manager, Compliance Manager, Auditor, Policy Manager, and the other 9 built-in roles
   - Getting started, trial, onboarding
   - Trust Center, reports, dashboards, evidence collection
   - AI features: document generator (29 types), contract review, vendor prescreening, gap analysis

2. General GRC topics:
   - Risk management concepts, frameworks, methodologies
   - Compliance program design
   - Audit best practices
   - Policy lifecycle and attestation
   - Vendor risk / third-party risk management
   - Information security governance
   - Regulatory requirements (GDPR, HIPAA, DORA, NIS2, PCI DSS, etc.)

== WHAT YOU MUST REFUSE ==

You must NEVER answer questions about:
- Programming, code, software development, or coding languages
- How AI models are built, trained, or how they work internally
- API keys, API tokens, API endpoints, authentication secrets, or credentials
- The website's source code, backend architecture, or database structure
- Any technical implementation details of how GRCEye is built
- Hacking, exploits, vulnerabilities in software systems
- Topics completely unrelated to GRC (cooking, sports, entertainment, etc.)

If someone asks about restricted topics, respond politely:
"I can only help with GRC topics and GRCEye platform questions. For technical or developer questions, please contact our support team at support@grceye.io."

== TONE ==
- Friendly, concise, and professional
- Use bullet points for lists
- Keep responses focused — don't over-explain
- Always offer to help with something else at the end if the question was short
"""

# ── Blocked keywords (client-side backup — server-side enforcement) ────────────
BLOCKED_PATTERNS = [
    "api key", "api token", "secret key", "source code", "how does the ai work",
    "how is it built", "what model", "which model", "openai", "anthropic",
    "gpt", "llm", "training data", "python code", "javascript", "sql injection",
    "backend", "database schema", "endpoint url", "how to hack",
]


def _is_blocked(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in BLOCKED_PATTERNS)


# ── SSE streaming helper ───────────────────────────────────────────────────────

_SSE_DONE = "data: [DONE]\n\n"
_SSE_MEDIA_TYPE = "text/event-stream"
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _support_sse_generator(messages: list[dict]) -> AsyncGenerator[str, None]:
    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    url = f"{base_url}/api/chat"
    model = settings.OLLAMA_CHAT_MODEL

    payload = {
        "model": model,
        "stream": True,
        "messages": [{"role": "system", "content": SUPPORT_SYSTEM_PROMPT}, *messages],
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    yield f"data: {json.dumps({'error': 'AI service unavailable. Please try again later.'})}\n\n"
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

        yield _SSE_DONE

    except httpx.ConnectError:
        yield f"data: {json.dumps({'error': 'Support chat is temporarily unavailable. Please email support@grceye.io.'})}\n\n"
        yield _SSE_DONE
    except asyncio.TimeoutError:
        yield f"data: {json.dumps({'error': 'Response timed out. Please try a shorter question.'})}\n\n"
        yield _SSE_DONE
    except Exception as exc:
        yield f"data: {json.dumps({'error': 'Something went wrong. Please try again.'})}\n\n"
        yield _SSE_DONE


# ── Schema ─────────────────────────────────────────────────────────────────────

class SupportMessage(BaseModel):
    role: str
    content: str


class SupportChatRequest(BaseModel):
    messages: list[SupportMessage]


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/support-chat")
async def public_support_chat(request: Request, body: SupportChatRequest):
    """
    Public support chatbot — no auth required.
    Restricted to GRCEye + GRC topics. Rate-limited to 20 req/10 min per IP.
    """
    # Rate limit by client IP
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    # Validate message count (max 20 turns to prevent abuse)
    if len(body.messages) > 40:
        raise HTTPException(status_code=400, detail="Conversation too long. Please start a new chat.")

    # Server-side content filter on the last user message
    last_user = next(
        (m.content for m in reversed(body.messages) if m.role == "user"), ""
    )
    if _is_blocked(last_user):
        async def _refused() -> AsyncGenerator[str, None]:
            msg = "I can only help with GRC topics and GRCEye platform questions. For technical or developer questions, please contact our team at support@grceye.io."
            yield f"data: {json.dumps({'token': msg})}\n\n"
            yield _SSE_DONE
        return StreamingResponse(_refused(), media_type=_SSE_MEDIA_TYPE, headers=_SSE_HEADERS)

    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    return StreamingResponse(
        _support_sse_generator(messages),
        media_type=_SSE_MEDIA_TYPE,
        headers=_SSE_HEADERS,
    )
