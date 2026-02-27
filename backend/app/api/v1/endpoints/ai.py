"""
AI Assistant endpoint — streams responses from Ollama.
Provides GRC-context-aware chat using local LLM.
"""
import json
import asyncio
import requests
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()

OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL   = "deepseek-r1:1.5b"

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


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = DEFAULT_MODEL
    stream: bool = True


def _blocking_stream(messages: list[dict], model: str, queue: "asyncio.Queue[str | None]", loop: asyncio.AbstractEventLoop):
    """Run in a thread: call Ollama and push SSE lines into the queue."""
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
        "stream": True,
        "options": {"temperature": 0.7, "top_p": 0.9},
    }
    try:
        with requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            stream=True,
            timeout=(60, 120),   # (connect_timeout, read_timeout)
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


async def _sse_generator(messages: list[dict], model: str):
    """Async generator that yields SSE chunks from a background thread."""
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    # Run the blocking Ollama request in a thread pool
    loop.run_in_executor(None, _blocking_stream, messages, model, queue, loop)

    while True:
        item = await queue.get()
        if item is None:
            break
        yield item


@router.post("/chat")
async def chat(request: ChatRequest):
    """Stream a GRC-aware AI chat response from Ollama."""
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    return StreamingResponse(
        _sse_generator(messages, request.model),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
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
