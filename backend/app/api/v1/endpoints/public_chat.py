"""
Public support chatbot endpoint — no authentication required.
Restricted to GRCEye platform questions and general GRC topics only.
Rate-limited by IP via shared state, so the limit holds across all workers.

Built on the shared AI foundation (app.services.ai_prompts / ai_provider / ai_locale):
the expert `public_support` system prompt owns the product-facts grounding, the
refusal rules and the visitor-facing tone (app.services.ai_prompts.SUPPORT_CORE /
PRODUCT_FACTS) — this route no longer keeps its own copy of any of that, and no
longer pre-filters visitor text with an English-only keyword blocklist (that
blocklist used to reject legitimate questions such as "do you support penetration
testing / vulnerability management?" or "which AI model do you use?"; the system
prompt's own, more precise refusal criteria replace it). The reply language follows
the visitor's own message, then the request body, then Accept-Language (see
`public_support_chat`). Calls go through `ai_provider.ai_stream_sse`, so the SSE
stream carries tuned decoding, correct timeout handling, honest truncated/empty
error frames and localised (en/fr/ar) error text instead of a silent empty bubble.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core import shared_state
from app.core.security_utils import sanitize_for_prompt
from app.services import ai_prompts, ai_provider
from app.services.ai_locale import get_request_language, guess_language, normalize_language

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Rate limiter (per IP, 20 requests per 10 minutes) ─────────────────────────
# Counted in shared state so the limit is 20 across the whole deployment, not
# 20 per uvicorn worker. This endpoint is unauthenticated, so the per-worker
# multiplier was a real abuse margin — and the previous in-process store kept
# one growing list per IP forever, since a bucket was only pruned if that same
# IP came back. See app/core/shared_state.py.
_RATE_LIMIT = 20
_RATE_WINDOW = 600  # 10 minutes in seconds


# ── Visitor-facing refusals ───────────────────────────────────────────────────
# The AI failures on this route already answer in the visitor's language via
# ai_provider.failure_message(); these three were the only sentences left in
# English, and this is the widget on the public site of a francophone market.
# Same shape as ai_locale.FAILURE_MESSAGES (kind -> lang -> text) and resolved
# with the same normalize_language; kept here because those are AI-failure kinds
# and these are not.
_REFUSALS: dict[str, dict[str, str]] = {
    "rate_limited": {
        "en": "Too many requests. Please wait a few minutes before sending more messages.",
        "fr": "Trop de messages. Veuillez patienter quelques minutes avant d'en envoyer d'autres.",
        "ar": "عدد الرسائل كبير جدًا. يرجى الانتظار بضع دقائق قبل إرسال المزيد.",
    },
    "too_long": {
        "en": "Conversation too long. Please start a new chat.",
        "fr": "Conversation trop longue. Veuillez démarrer une nouvelle discussion.",
        "ar": "المحادثة طويلة جدًا. يرجى بدء محادثة جديدة.",
    },
    "empty": {
        "en": "No message to answer.",
        "fr": "Aucun message auquel répondre.",
        "ar": "لا توجد رسالة للرد عليها.",
    },
}


def _refusal(kind: str, lang: str) -> str:
    table = _REFUSALS[kind]
    return table.get(normalize_language(lang) or "en") or table["en"]


async def _check_rate_limit(ip: str, lang: str) -> None:
    hits = await shared_state.incr(f"ratelimit:public_chat:{ip}", 1, _RATE_WINDOW)
    if hits > _RATE_LIMIT:
        raise HTTPException(status_code=429, detail=_refusal("rate_limited", lang))


# ── Schema ─────────────────────────────────────────────────────────────────────

class SupportMessage(BaseModel):
    role: str
    content: str


class SupportChatRequest(BaseModel):
    messages: list[SupportMessage]
    # Additive: "en" | "fr" | "ar". The widget does not send this today — when
    # absent, the language is guessed from the visitor's latest message and
    # otherwise taken from Accept-Language (see public_support_chat).
    language: str | None = None


# ── Chat turn hygiene ────────────────────────────────────────────────────────
# Mirrors ai.py:_chat_turns (the authenticated in-app assistant) for the same
# reasons; kept as a local, private helper because ai.py is a sibling endpoint
# module, not one of the foundation services this file may reach into.
_CHAT_MAX_TURNS = 30       # conversation window forwarded to the model
_CHAT_MAX_CHARS = 4_000    # per-turn cap (control characters stripped) — a public
                           # support question never needs the in-app assistant's budget
_MAX_INCOMING_MESSAGES = 40  # hard cap before any processing (abuse guard)


def _support_chat_turns(messages: list[SupportMessage]) -> list[dict]:
    """Client conversation history -> provider turns.

    Roles are restricted to user/assistant (a client-sent "system" turn would sit
    after the server system prompt and try to override it — the old code accepted
    any string here), control characters are stripped and each turn is length-
    capped, the window is limited to the most recent turns, and the history is
    trimmed to open with a user turn (this also drops the widget's own localized
    "welcome" assistant message, which used to be forwarded to the model as real
    conversation history). Turns are deliberately NOT wrapped with
    delimit_untrusted: the foundation passes chat turns as-is because the user's
    question IS the instruction to answer; SUPPORT_CORE carries the
    data-not-instructions rule for the BEGIN/END delimited blocks it may show
    elsewhere in the system prompt.
    """
    turns: list[dict] = []
    for m in messages:
        role = (m.role or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = sanitize_for_prompt(m.content, max_len=_CHAT_MAX_CHARS)
        if content.strip():
            turns.append({"role": role, "content": content})
    turns = turns[-_CHAT_MAX_TURNS:]
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return turns


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/support-chat")
async def public_support_chat(
    request: Request,
    body: SupportChatRequest,
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Public support chatbot — no auth required (foundation task `public_support`).

    Restricted to GRCEye + GRC topics by the `public_support` system prompt's own
    refusal rules (source code / credentials / API keys / internal architecture /
    off-topic), not by a keyword blocklist. Rate-limited to 20 req/10 min per IP.
    """
    # Language for the refusals below: the visitor's own message is not available
    # yet (and is empty in the 422 case), so this is the body field then the
    # header — the same first two signals resolve_language uses.
    err_lang = normalize_language(body.language) or header_lang

    # Rate limit by client IP
    client_ip = request.client.host if request.client else "unknown"
    await _check_rate_limit(client_ip, err_lang)

    # Validate message count (max 40 messages to prevent abuse)
    if len(body.messages) > _MAX_INCOMING_MESSAGES:
        raise HTTPException(status_code=400, detail=_refusal("too_long", err_lang))

    turns = _support_chat_turns(body.messages)
    if not turns:
        raise HTTPException(status_code=422, detail=_refusal("empty", err_lang))

    last_user = next((t["content"] for t in reversed(turns) if t["role"] == "user"), "")
    lang = normalize_language(body.language) or guess_language(last_user) or header_lang

    # Public + unauthenticated: there is no tenant to resolve a bring-your-own-AI
    # endpoint for, so the deployment default is used directly (still honours
    # AI_PROVIDER/AI_BASE_URL/AI_MODEL/AI_CA_BUNDLE when the deployment sets them —
    # the old code always spoke raw Ollama and ignored those settings entirely).
    cfg = ai_provider.env_ai_config()

    try:
        system_prompt = ai_prompts.system_prompt("public_support", lang=lang)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=public_support)")
        raise HTTPException(status_code=424, detail=ai_provider.failure_message("bad_config", lang))

    # Reachability check BEFORE the StreamingResponse is returned, so an outage
    # becomes an HTTP error (the widget's `!resp.ok` branch) instead of an error
    # frame glued into the stream. 424, never 5xx: client.ts redirects the whole
    # SPA to /service-down on any >=500.
    try:
        await ai_provider.preflight(cfg)
    except ai_provider.AICallError as exc:
        raise HTTPException(status_code=424, detail=exc.user_message(lang))

    defaults = ai_prompts.task_defaults("public_support")
    decode = ai_provider.decoding(defaults["preset"], temperature=defaults["temperature"])
    msgs = [{"role": "system", "content": system_prompt}, *turns]

    return StreamingResponse(
        ai_provider.ai_stream_sse(msgs, lang=lang, cfg=cfg, task="public.support_chat", **decode),
        media_type=ai_provider.SSE_MEDIA_TYPE,
        headers=ai_provider.SSE_HEADERS,
    )
