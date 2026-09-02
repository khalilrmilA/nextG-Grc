"""
AI Assistant endpoint — streams responses from the configured AI provider
(local Ollama by default, or a tenant's bring-your-own endpoint) as SSE frames.

The chat / policy / document routes in this file are built on the shared AI
foundation (app.services.ai_prompts / ai_provider / ai_locale / ai_chunking):
expert system prompts with evaluation criteria, Accept-Language-aware output,
delimited untrusted input, tuned decoding presets and honest failure frames.
"""
import json
import asyncio
import logging
import re
from collections import Counter
from collections.abc import AsyncGenerator, Callable
from datetime import date
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, bearer_scheme_optional
from app.models.user import User
from app.models.ai_access import AiUsageQuota
from pydantic import BaseModel
import httpx

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core import ai_quota
from app.core.security_utils import sanitize_for_prompt
from app.services import ai_prompts, ai_provider
from app.services.ai_chunking import (
    assess_controls_over_document,
    chunk_document,
    chunk_text,
    control_spec_from_model,
    estimate_tokens,
    input_budget,
    map_reduce,
    MAX_CHUNK_TOKENS,
)
from app.services.ai_locale import get_request_language, guess_language, normalize_language
from app.services.ai_structured import ai_structured

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
    model: str | None,
    system_prompt: str,
    db: AsyncSession,
    quota: AiUsageQuota,
    *,
    on_finish: Callable[[ai_provider.AIResult], None] | None = None,
    **kw,
) -> AsyncGenerator[str, None]:
    """Wrap _ollama_sse_generator and record usage when the stream ends.

    The daily ai_quota counter is recorded inside ai_provider.ai_stream (real
    prompt+completion counts, chars//4 fallback) because `user_id` is passed;
    the monthly DB-backed quota row is updated here from the same numbers.
    Extra keyword arguments (cfg, lang, task, tenant_id, decoding options)
    are forwarded to _ollama_sse_generator.
    """
    final: dict = {}

    def _capture(res: ai_provider.AIResult) -> None:
        final["r"] = res
        if on_finish is not None:
            on_finish(res)

    total_chars = 0
    async for chunk in _ollama_sse_generator(
        messages, model, system_prompt, user_id=quota.user_id, on_finish=_capture, **kw
    ):
        total_chars += len(chunk)
        yield chunk
    res = final.get("r")
    estimated_tokens = (
        res.total_tokens if res is not None and res.total_tokens > 0 else max(1, total_chars // 4)
    )
    try:
        await _increment_usage(db, quota, estimated_tokens)
    except Exception:  # noqa: BLE001 — the client already has [DONE]; never fail the stream
        logger.exception("monthly AI usage recording failed")

DEFAULT_MODEL = settings.OLLAMA_CHAT_MODEL  # e.g. deepseek-v3.1:671b-cloud

SYSTEM_PROMPT = """You are a concise GRC AI assistant (Governance, Risk & Compliance).

Rules — follow strictly:
- ALWAYS be brief: max 3-5 bullet points or 2-3 short paragraphs. Never write walls of text.
- If asked about a framework or acronym (e.g. "NCA ECC", "ISO 27001", "NIST"), give a 2-3 line summary only.
- Only expand with details if the user explicitly asks ("explain more", "give me details", "list all controls").
- For short inputs (a few words), give a short answer. Match the length of your response to the complexity of the question.
- Reference specific controls only when directly relevant to the question.
- Redirect off-topic questions politely in one sentence.
"""

# The policy / document system prompts now come from the foundation registry:
# ai_prompts.system_prompt("policy_generation" | "document_generation" | "assistant_chat", ...)


# ─── Schemas ───────────────────────────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = DEFAULT_MODEL
    stream: bool = True
    # "en" | "fr" | "ar" (the UI language). When absent, the language of the last
    # user message is guessed, then the Accept-Language header decides.
    language: str | None = None


class PolicyGenerateRequest(BaseModel):
    control_identifier: str
    control_title: str
    framework_short_name: str
    control_description: str | None = None
    gap_description: str | None = None
    existing_context: str | None = None
    organization_context: str | None = None
    model: str = DEFAULT_MODEL
    language: str | None = None   # additive: "en" | "fr" | "ar"; Accept-Language otherwise


class RiskAnalyzeRequest(BaseModel):
    title: str
    description: str | None = None
    risk_category: str | None = None
    model: str = DEFAULT_MODEL
    language: str | None = None   # additive: "en" | "fr" | "ar"; Accept-Language otherwise


class EvidenceAnalyzeRequest(BaseModel):
    document_text: str          # extracted text from uploaded file
    framework_short_name: str
    controls: list[dict]        # list of {control_id, title, description}
    model: str = DEFAULT_MODEL
    language: str | None = None   # additive: "en" | "fr" | "ar"; Accept-Language otherwise


class AuditPlanRequest(BaseModel):
    framework_name: str
    framework_short_name: str
    audit_title: str
    audit_scope: str | None = None
    audit_objective: str | None = None
    audit_type: str | None = None   # additive: "internal" | "external" | "regulatory" | ...
    controls: list[dict]        # list of {control_id, title, category}
    model: str = DEFAULT_MODEL
    language: str | None = None   # additive: "en" | "fr" | "ar"; Accept-Language otherwise


class VendorRiskRequest(BaseModel):
    vendor_name: str
    vendor_industry: str | None = None
    vendor_services: str | None = None
    questionnaire_responses: dict   # {question: answer}
    model: str = DEFAULT_MODEL
    language: str | None = None   # additive: "en" | "fr" | "ar"; Accept-Language otherwise


# ─── Core streaming helper ─────────────────────────────────────────────────────

_SSE_DONE = "data: [DONE]\n\n"
_SSE_MEDIA_TYPE = "text/event-stream"
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _ollama_sse_generator(
    messages: list[dict],
    model: str | None,
    system_prompt: str,
    cfg: ai_provider.AIConfig | None = None,
    *,
    user_id: str | None = None,
    tenant_id: str | None = None,
    lang: str = "en",
    task: str = "ai.stream",
    on_finish: Callable[[ai_provider.AIResult], None] | None = None,
    **decode,
) -> AsyncGenerator[str, None]:
    """Stream SSE frames (`data: {"token"}` / `data: {"error", "code"}` / `data: [DONE]`)
    from the configured AI provider.

    Name and positional signature kept for the callers in this file; the body is
    now a thin wrapper over ai_provider.ai_stream_sse, which adds: tuned decoding
    options (`**decode`, default = the "drafting" preset — the old call sent no
    options at all, i.e. Ollama's creative temperature), correct httpx timeout
    handling (the old `except asyncio.TimeoutError` branch was dead code), an
    explicit `truncated` / `empty` error frame instead of a silent cut, localised
    error text (`lang`), an additive `code` on error frames, real-count quota
    recording when `user_id` is given, and a tenant's bring-your-own endpoint via
    `cfg` (ai_provider.load_ai_config). With `cfg=None` the deployment default is
    used and a client `model` is honoured only when no tenant API key is in play.
    Never yields a URL or an upstream body; always ends with [DONE] exactly once.
    """
    msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + list(messages)
    kwargs = dict(decode) if decode else ai_provider.decoding("drafting")
    async for frame in ai_provider.ai_stream_sse(
        msgs, lang=lang, on_finish=on_finish, cfg=cfg, model=model,
        user_id=user_id, tenant_id=tenant_id, task=task, **kwargs,
    ):
        yield frame


# ─── Foundation helpers shared by the migrated routes in this file ─────────────

_NOT_STATED = "not stated"
_CHAT_MAX_TURNS = 30          # conversation window forwarded to the model
_CHAT_MAX_CHARS = 16_000      # per-turn cap (control characters stripped)
_SLOT_RESERVE_TOKENS = 1_500  # template text + one-line slots, kept out of the body budget

# num_predict per organisation size for document generation: reasoning tokens
# count against it and an enterprise document is 15-25 pages, so the default
# "drafting" budget (16384) is raised for the two larger tiers (cap 32768).
_DOC_NUM_PREDICT = {"startup": 16384, "smb": 16384, "midmarket": 20480, "enterprise": 24576}


def _requested_model(model: str | None) -> str | None:
    """A client-chosen model is forwarded only when it differs from the deployment
    default: every request schema defaults `model` to settings.OLLAMA_CHAT_MODEL, and
    forwarding that default would override a keyless tenant / env AI configuration."""
    m = (model or "").strip()
    return m if m and m != DEFAULT_MODEL else None


def _ws(value) -> str:
    """Whitespace-collapsed str; None -> ''."""
    return " ".join(str(value).split()) if value is not None else ""


async def _org_profile(db: AsyncSession, tenant_id: str | None) -> dict:
    """Platform-known facts about the caller's organisation, for prompt grounding.

    {"name", "industry", "country", "org_size", "frameworks": ["ISO27001 (edition 2022)", ...]}
    with "" for unknown values; {} when nothing is known or on any DB problem
    (grounding must never take an AI feature down). Values are clean_field'ed.
    """
    if not tenant_id:
        return {}
    try:
        from app.models.tenant import Tenant  # noqa: PLC0415
        from app.models.framework import Framework  # noqa: PLC0415

        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
        if tenant is None:
            return {}
        ids = [i for i in (tenant.selected_framework_ids or []) if isinstance(i, str)][:50]
        labels: list[str] = []
        if ids:
            rows = (await db.execute(select(Framework).where(Framework.id.in_(ids)))).scalars().all()
            for fw in rows:
                label = ai_provider.clean_field(fw.short_name, 50)
                if fw.version:
                    label += " (edition %s)" % ai_provider.clean_field(fw.version, 30)
                if label:
                    labels.append(label)
        return {
            "name": ai_provider.clean_field(tenant.name, 120),
            "industry": ai_provider.clean_field(tenant.industry, 80),
            "country": ai_provider.clean_field(tenant.country, 10),
            "org_size": ai_provider.clean_field(tenant.org_size, 20),
            "frameworks": labels,
        }
    except Exception:  # noqa: BLE001
        logger.exception("organisation profile lookup failed (tenant=%s)", tenant_id)
        return {}


def _regimes_line(country: str | None) -> str:
    """'Regulatory regimes commonly applicable in <cc>: ...' when the country maps to a
    specific entry of ai_prompts.REGIMES_BY_COUNTRY; '' for unknown / free-text values."""
    if not country:
        return ""
    text = ai_prompts.regimes_for_country(country)
    if text == ai_prompts.REGIMES_BY_COUNTRY["default"]:
        return ""
    return "Regulatory regimes commonly applicable in %s: %s." % (_ws(country), text)


def _org_context(profile: dict) -> str:
    """The CONTEXT block recommended by the foundation spec (§4.18) for the chat and
    authoring tasks: organisation facts + the regimes line. '' when nothing is known."""
    if not profile:
        return ""
    frameworks = ", ".join(profile.get("frameworks") or []) or "none selected"
    lines = [
        "Organisation: %s; industry: %s; country: %s; size: %s; frameworks selected in GRCeye: %s."
        % (profile.get("name") or _NOT_STATED, profile.get("industry") or _NOT_STATED,
           profile.get("country") or _NOT_STATED, profile.get("org_size") or _NOT_STATED, frameworks)
    ]
    regimes = _regimes_line(profile.get("country"))
    if regimes:
        lines.append(regimes)
    return "\n".join(lines)


def _size_key(org_size: str | None) -> str | None:
    """Tenant.org_size ("1-50", "51-200", "201-1000", "1000+") or a Doc Generator size
    key -> _SIZE_DETAIL key; None when unknown."""
    s = (org_size or "").strip().lower()
    if not s:
        return None
    if s in _SIZE_DETAIL:
        return s
    digits = re.findall(r"\d+", s)
    if not digits:
        return None
    upper = 10**9 if s.endswith("+") else int(digits[-1])
    if upper <= 50:
        return "startup"
    if upper <= 500:
        return "smb"
    if upper <= 5000:
        return "midmarket"
    return "enterprise"


def _body_budget(system: str, decode: dict) -> int:
    """Tokens available for the untrusted bodies of one user turn under the preset's
    num_ctx once the system prompt, the answer budget and the template are set aside."""
    num_ctx = int(decode.get("num_ctx") or 32768)
    num_predict = int(decode.get("num_predict") or 8192)
    return max(1_000, input_budget(num_ctx, system, reserve_output_tokens=num_predict) - _SLOT_RESERVE_TOKENS)


def _delimit_within_budget(text: str | None, label: str, *, max_tokens: int) -> tuple[str, str]:
    """delimit_untrusted(text) when it fits `max_tokens`; otherwise the boundary-aware
    FIRST chunk (ai_chunking.chunk_text — never a mid-word slice) plus an explicit note
    saying how much was left out, so the model never assumes it saw the whole text.
    Returns (block, note); ("", "") for empty text. Length-transparent otherwise."""
    text = text or ""
    if not text.strip():
        return "", ""
    total = estimate_tokens(text)
    if total <= max_tokens:
        return ai_provider.delimit_untrusted(text, label, max_len=len(text) + 1), ""
    parts = chunk_text(text, max_tokens, overlap_tokens=0)
    kept = parts[0] if parts else ""
    note = (
        "NOTE: the %s block was longer than fits in one pass; only part 1 of %d (about %d of %d tokens) "
        "is included below. Refer to the remainder by name only and do not assume its content."
        % (label, len(parts), estimate_tokens(kept), total)
    )
    return ai_provider.delimit_untrusted(kept, label, max_len=len(kept) + 1), note


def _compose(task: str, *, lang: str, extra_context: str | None = None, **slots) -> tuple[str, str]:
    """(system, user) for a templated foundation task. A PromptError is a programming
    error, but it must still not surface as an uncaught 5xx (the SPA redirects the whole
    app to /service-down on any >= 500)."""
    try:
        system = ai_prompts.system_prompt(task, lang=lang, extra_context=extra_context or None)
        user = ai_prompts.render_user_prompt(task, **slots)
        return system, user
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=%s)", task)
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail=ai_provider.failure_message("bad_config", lang),
        )


async def _preflight_or_424(cfg: ai_provider.AIConfig, lang: str) -> None:
    """Reachability check BEFORE the StreamingResponse is returned, so an outage
    becomes an HTTP error (the SPA's `!resp.ok` branch) instead of an error frame
    glued into a document body that the Doc Generator / gap-policy modal would then
    save as a Policy. 424 (never 5xx: client.ts redirects to /service-down)."""
    try:
        await ai_provider.preflight(cfg)
    except ai_provider.AICallError as exc:
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY, detail=exc.user_message(lang))


def _chat_turns(messages: list[ChatMessage]) -> list[dict]:
    """Client conversation history -> provider turns.

    Roles are restricted to user/assistant (a client-sent "system" turn would sit
    after the server system prompt and override it), control characters are
    stripped and each turn is capped, the window is limited to the most recent
    turns, and the history is trimmed to open with a user turn (this also drops
    the widget's canned welcome message). Chat turns are deliberately NOT wrapped
    with delimit_untrusted: the foundation passes chat turns as-is (ai_prompts
    USER_TEMPLATES) because the user's question IS the instruction to answer;
    ASSISTANT_CORE carries the data-not-instructions rule for delimited blocks.
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


async def _lookup_control(db: AsyncSession, tenant_id: str | None, short_name: str, control_identifier: str):
    """(Framework, FrameworkControl, [ControlRequirement]) behind a gap, from the DB.

    The tenant's own clone of the framework is preferred over the shared built-in
    (both are visible to the tenant; another tenant's custom framework never is).
    (None, None, []) when not found or on any DB problem."""
    try:
        from app.models.framework import ControlRequirement, Framework, FrameworkControl  # noqa: PLC0415

        sn = (short_name or "").strip()
        cid = (control_identifier or "").strip()
        if not sn:
            return None, None, []
        rows = (await db.execute(
            select(Framework).where(
                Framework.short_name == sn,
                or_(Framework.is_builtin.is_(True), Framework.tenant_id == tenant_id),
            )
        )).scalars().all()
        fw = next((f for f in rows if not f.is_builtin and f.tenant_id == tenant_id), None) or (rows[0] if rows else None)
        if fw is None:
            return None, None, []
        ctrl = None
        if cid:
            ctrl = (await db.execute(
                select(FrameworkControl).where(FrameworkControl.framework_id == fw.id, FrameworkControl.control_id == cid)
            )).scalars().first()
        reqs = []
        if ctrl is not None:
            reqs = list((await db.execute(
                select(ControlRequirement).where(ControlRequirement.control_id == ctrl.id)
            )).scalars().all())
        return fw, ctrl, reqs
    except Exception:  # noqa: BLE001
        logger.exception("control lookup failed (framework=%s control=%s)", short_name, control_identifier)
        return None, None, []


def _control_requirement_text(ctrl, reqs: list, client_description: str | None) -> str:
    """The CONTROL REQUIREMENT slot for policy_generation.

    From the framework record when the control was found (description, guidance,
    must/should statements, category, mandatory flag); otherwise the description
    supplied with the request — delimited as untrusted, because it did not come
    from the framework database — or an explicit "no description" line. Never
    silently blank: the model is told which case applies."""
    lines: list[str] = []
    if ctrl is not None:
        desc = _ws(sanitize_for_prompt(ctrl.description, max_len=4000))
        lines.append("Requirement: " + (desc or "(no description in the framework — apply the standard's actual requirement for this clause)"))
        guidance = _ws(sanitize_for_prompt(ctrl.guidance, max_len=2000))
        if guidance:
            lines.append("Guidance: " + guidance)
        stmts = []
        for r in reqs[:8]:
            text = _ws(sanitize_for_prompt(getattr(r, "requirement_text", ""), max_len=600))
            if text:
                stmts.append("(%s) %s" % (_ws(getattr(r, "requirement_level", "")) or "statement", text))
        if stmts:
            lines.append("Statements: " + " ; ".join(stmts))
        lines.append("Category: %s | Mandatory: %s" % (_ws(ctrl.category) or _NOT_STATED, "yes" if ctrl.is_mandatory else "no"))
        lines.append("Source: the framework record in GRCeye.")
    elif client_description and client_description.strip():
        lines.append(ai_provider.delimit_untrusted(client_description, "CONTROL DESCRIPTION", max_len=6000))
        lines.append("Source: description supplied with the request (the control was not found in the framework "
                     "database); apply the standard's actual requirement for this clause and name the edition you rely on.")
    else:
        lines.append("(no description available — apply the standard's actual requirement for this clause and name the edition you rely on)")
    return "\n".join(lines)


# ─── Helpers for analyze_risk / analyze_evidence / generate_audit_plan /
# stream_remediation_plan (foundation tasks risk_analysis, control_assessment via
# ai_chunking.assess_controls_over_document, audit_plan, remediation_plan) ─────

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

#: risk_analysis's own $gap_note slot text (foundation spec, USER_TEMPLATES["risk_analysis"]
#: comment) — verbatim, %s filled with the control title, for GapConfirmModal's call
#: (risk_category == "compliance", the literal value that modal sends).
_GAP_NOTE_TEMPLATE = (
    'NOTE: The item below is a compliance GAP for control "%s", not a risk register entry. '
    'Treat the description as the gap statement, score the risk of leaving the gap open, and '
    'make Mitigate the plan that closes the gap.\n'
)

#: remediation_plan's $available_roles slot: the organisational-function vocabulary the task
#: block itself sanctions ("a role such as CISO, IT Operations, HR, Legal, DPO, Procurement —
#: never a person"), not tenant-specific data (the platform has no such registry to query).
_REMEDIATION_OWNER_ROLES = ("CISO, IT Operations, Legal, HR, DPO, Procurement, Risk Manager, "
                           "Compliance Manager, Control Owner, Business Owner")

_EVIDENCE_STATUS_LABEL = {
    "implemented": "Compliant",
    "partially_implemented": "Partial",
    "not_implemented": "Gap",
    "not_applicable": "Not Applicable",
    "insufficient_evidence": "Insufficient Evidence",
}
_GAP_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


async def _tenant_default_risk_scales(db: AsyncSession, tenant_id: str | None) -> str:
    """``ai_prompts.risk_scale_context`` for the tenant's default RiskMatrix (risk_analysis's
    $scales slot); "" when the tenant has none, its definition lacks usable labels, or on any
    DB problem — the task's own built-in 5x5 scale then applies (never a silent 500)."""
    if not tenant_id:
        return ""
    try:
        from app.models.risk_matrix import RiskMatrix  # noqa: PLC0415

        matrix = (await db.execute(
            select(RiskMatrix).where(RiskMatrix.tenant_id == tenant_id, RiskMatrix.is_default.is_(True))
        )).scalars().first()
        return ai_prompts.risk_scale_context(matrix.definition if matrix is not None else None)
    except Exception:  # noqa: BLE001
        logger.exception("risk matrix lookup failed (tenant=%s)", tenant_id)
        return ""


def _capped_lines(lines: list[str], max_tokens: int) -> tuple[str, int]:
    """Join ``lines`` (one bullet each) up to ``max_tokens`` (boundary-aware: an item is never
    split, and the first item is always kept even if it alone exceeds the budget). Returns
    (joined text or "(none)", how many were kept) — the caller decides how to note the rest."""
    kept: list[str] = []
    used = 0
    for line in lines:
        t = estimate_tokens(line)
        if kept and used + t > max_tokens:
            break
        kept.append(line)
        used += t
    return ("\n".join(kept) if kept else "(none)"), len(kept)


async def _resolve_framework(db: AsyncSession, tenant_id: str | None, *candidates: str | None):
    """Best-effort Framework row matched, in order, against any of ``candidates`` by id, by
    short_name or by name (AuditPlanModal currently sends the framework's id as the
    "framework_name" field with an empty short name — matching by id is what recovers the real
    framework for that call). The tenant's own clone is preferred over the shared built-in.
    None when nothing matches or on any DB problem."""
    try:
        from app.models.framework import Framework  # noqa: PLC0415

        for value in candidates:
            v = (value or "").strip()
            if not v:
                continue
            rows = (await db.execute(
                select(Framework).where(
                    or_(Framework.id == v, Framework.short_name == v, Framework.name == v),
                    or_(Framework.is_builtin.is_(True), Framework.tenant_id == tenant_id),
                )
            )).scalars().all()
            if rows:
                return next((f for f in rows if not f.is_builtin and f.tenant_id == tenant_id), None) or rows[0]
        return None
    except Exception:  # noqa: BLE001
        logger.exception("framework lookup failed (tenant=%s)", tenant_id)
        return None


async def _audit_framework_controls(db: AsyncSession, fw) -> list[tuple[str, str, str]]:
    """``[(control_id, title, category), ...]`` for every FrameworkControl of ``fw``, in the
    framework's own order. `[]` on any DB problem — the caller falls back to whatever the
    client supplied rather than failing the request."""
    try:
        from app.models.framework import FrameworkControl  # noqa: PLC0415

        rows = (await db.execute(
            select(FrameworkControl).where(FrameworkControl.framework_id == fw.id).order_by(FrameworkControl.sort_order)
        )).scalars().all()
        return [
            (ai_provider.clean_field(r.control_id, 50) or "?",
             ai_provider.clean_field(r.title, 300) or "(untitled control)",
             ai_provider.clean_field(r.category, 60))
            for r in rows
        ]
    except Exception:  # noqa: BLE001
        logger.exception("audit-plan control lookup failed (framework=%s)", getattr(fw, "id", None))
        return []


def _fmt_gap_line(g: dict) -> str:
    """remediation_plan's own per-gap line format (USER_TEMPLATES["remediation_plan"] comment):
    ``- [$control_id] $control_title (severity $severity): $gap_description``."""
    cid = ai_provider.clean_field(g.get("control_identifier"), 50) or "?"
    title = ai_provider.clean_field(g.get("control_title"), 200) or "(untitled control)"
    severity = ai_provider.clean_field(g.get("severity"), 20) or "not stated"
    desc = ai_provider.clean_field(g.get("gap_description"), 400) or "(no description provided)"
    return "- [%s] %s (severity %s): %s" % (cid, title, severity, desc)


def _confidence_label(value) -> str:
    v = value if isinstance(value, (int, float)) else 0.0
    if v >= 0.7:
        return "High"
    if v >= 0.4:
        return "Medium"
    return "Low"


def _evidence_analysis_markdown(framework_label: str, specs: list, run) -> str:
    """Render an ``ai_chunking.ControlAssessmentRun`` (validated, quote-verified verdicts) as
    the same Markdown shape the route always returned, so any future consumer sees a familiar
    structure — but every row now comes from a real, checked verdict: a control the model could
    not judge is reported "Insufficient Evidence", never silently as a default status."""
    counts: dict[str, int] = {}
    rows: list[str] = []
    gaps: list[tuple[str, str, str]] = []   # (severity, control_id, text)
    for spec in specs:
        v = run.verdicts.get(spec.control_id)
        if v is None:
            rows.append("%s | %s | %s | %s" % (spec.control_id, "Insufficient Evidence", "Low",
                                                "Analysis could not be completed for this control (see Notes)."))
            counts["insufficient_evidence"] = counts.get("insufficient_evidence", 0) + 1
            continue
        counts[v.verdict] = counts.get(v.verdict, 0) + 1
        note = _ws(v.rationale) or _ws(v.gap_description) or "-"
        rows.append("%s | %s | %s | %s" % (spec.control_id, _EVIDENCE_STATUS_LABEL.get(v.verdict, v.verdict),
                                           _confidence_label(v.confidence), note[:200]))
        if v.verdict in ("not_implemented", "partially_implemented", "insufficient_evidence") and v.gap_description:
            gaps.append((v.gap_severity or "medium", spec.control_id, _ws(v.gap_description)))
    total = len(specs)
    # `counts["insufficient_evidence"]` already includes both real insufficient_evidence
    # verdicts AND controls in run.missing_ids (folded in above when `v is None`) — do not
    # add len(run.missing_ids) again, that would double-count the same controls.
    insufficient = counts.get("insufficient_evidence", 0)
    overall = ("%d controls assessed against %s: %d compliant, %d partial, %d gap, %d not applicable, "
              "%d with insufficient evidence." % (
                  total, framework_label, counts.get("implemented", 0), counts.get("partially_implemented", 0),
                  counts.get("not_implemented", 0), counts.get("not_applicable", 0), insufficient))
    gaps.sort(key=lambda g: _GAP_SEVERITY_ORDER.get(g[0], 4))
    key_gaps = ["- [%s] (%s) %s" % (cid, sev, text[:200]) for sev, cid, text in gaps[:5]] or ["- No material gaps identified."]
    steps = ["Close the gap on %s: %s" % (cid, text[:160]) for sev, cid, text in gaps[:5]] or \
            ["No further action required based on the evidence assessed."]
    notes = list((run.warnings or [])[:10])
    if run.failures:
        notes.append("Some batches could not be judged; their controls are reported Insufficient Evidence: "
                     + "; ".join(run.failures[:5]))
    notes_block = ("\n\n### Notes\n" + "\n".join("- %s" % _ws(n) for n in notes)) if notes else ""
    return (
        "## Evidence Analysis — %s\n\n"
        "### Overall Coverage\n%s\n\n"
        "### Control Coverage Table\nCONTROL_ID | STATUS | CONFIDENCE | NOTES\n%s\n\n"
        "### Key Gaps Identified\n%s\n\n"
        "### Recommended Next Steps\n%s%s"
    ) % (framework_label, overall, "\n".join(rows), "\n".join(key_gaps),
         "\n".join("%d. %s" % (i + 1, s) for i, s in enumerate(steps)), notes_block)


# ─── Helpers for analyze_vendor (foundation task vendor_analysis) ──────────────
# Deliberately self-contained rather than importing vendors.py's private helpers of the same
# shape (_answer_kind / _public_findings / ...): this route serves ad hoc, unsaved vendor data
# (no Vendor row, no tenant context to ground on) where vendors.py's analyse the stored record.

_VENDOR_YES_WORDS = frozenset({"yes", "oui", "نعم", "true"})
_VENDOR_NO_WORDS = frozenset({"no", "non", "لا", "false"})
_VENDOR_PARTIAL_WORDS = frozenset({"partial", "partially", "partiel", "partielle", "partiellement", "جزئي", "جزئيا", "جزئياً"})
_FIRST_WORD_RE = re.compile(r"[^\W_]+", re.U)
_VENDOR_DOMAIN_ORDER = ("compliance_standards", "data_protection", "access_control",
                        "incident_response", "business_continuity", "sub_processors")


def _vendor_answer_kind(answer) -> str:
    """'yes' | 'no' | 'partial' | 'na' from a free-form questionnaire answer (en/fr/ar words, bools)."""
    if isinstance(answer, bool):
        return "yes" if answer else "no"
    m = _FIRST_WORD_RE.search(_ws(answer).lower())
    word = m.group(0) if m else ""
    if word in _VENDOR_YES_WORDS:
        return "yes"
    if word in _VENDOR_NO_WORDS:
        return "no"
    if word in _VENDOR_PARTIAL_WORDS:
        return "partial"
    return "na"


def _vendor_bounded_responses(responses: dict, *, max_items: int = 30, q_len: int = 300, a_len: int = 300) -> dict[str, str]:
    """One-line, control-char-free, length-capped copy of the client-supplied questionnaire (keys
    stay unique; capped at ``max_items`` so the counts shown to the model match what it sees)."""
    out: dict[str, str] = {}
    for q, a in list((responses or {}).items())[:max_items]:
        key = ai_provider.clean_field(str(q), q_len) or "(blank question)"
        if key in out:
            key = "%s (%d)" % (key, len(out) + 1)
        out[key] = ai_provider.clean_field("" if a is None else str(a), a_len)
    return out


def _vendor_answer_counts(responses: dict) -> dict[str, int]:
    counts = {"total": len(responses), "yes": 0, "no": 0, "partial": 0, "na": 0}
    for a in responses.values():
        counts[_vendor_answer_kind(a)] += 1
    return counts


async def _vendor_public_findings(vendor_name: str) -> list[dict]:
    """Best-effort public lookup (DuckDuckGo Instant Answer API, no auth); ``[]`` on any failure.
    Every field is length-capped here; the caller still wraps the block with delimit_untrusted so
    the model treats it as unverified third-party data, never instructions."""
    from urllib.parse import quote_plus

    query = "%s security compliance certifications" % ai_provider.clean_field(vendor_name, 80)
    url = "https://api.duckduckgo.com/?q=%s&format=json&no_html=1" % quote_plus(query)
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return []
        data = resp.json()
        if not isinstance(data, dict):
            return []
    except Exception as exc:  # noqa: BLE001 — the search is optional; the report says so honestly
        logger.info("ai.analyze_vendor.web_search_unavailable err=%s", type(exc).__name__)
        return []
    out: list[dict] = []
    abstract = ai_provider.clean_field(data.get("AbstractText"), 600)
    if abstract:
        out.append({"title": ai_provider.clean_field(data.get("Heading"), 200) or "Abstract",
                    "snippet": abstract, "url": ai_provider.clean_field(data.get("AbstractURL"), 300)})
    for r in (data.get("Results") or [])[:5]:
        if not isinstance(r, dict):
            continue
        out.append({"title": ai_provider.clean_field(r.get("Title"), 200),
                    "snippet": ai_provider.clean_field(r.get("Text"), 500),
                    "url": ai_provider.clean_field(r.get("FirstURL"), 300)})
    return out[:6]


def _vendor_public_findings_block(web_results: list[dict]) -> str:
    if not web_results:
        return "PUBLIC FINDINGS: none supplied."
    lines = ["%d. %s — %s (source: %s)" % (i, r.get("title") or "untitled", r.get("snippet") or "(no text)",
                                           r.get("url") or "unknown") for i, r in enumerate(web_results, 1)]
    return ai_provider.delimit_untrusted("\n".join(lines), "PUBLIC FINDINGS")


def _render_vendor_analysis_markdown(data: dict, *, vendor_name: str, today: date, counts: dict,
                                     public_count: int, extra_warnings: list[str]) -> str:
    """Render the validated ``vendor_analysis`` verdict as the Markdown report this route has always
    returned in ``message``. Every figure now comes from a rubric-scored, schema-validated verdict —
    a domain the model could not evidence is reported "insufficient evidence", never invented (the
    old 230-line template demanded a "Web Research Findings" entry and certification years for every
    domain regardless of what evidence actually existed)."""
    score = int(data.get("overall_score") or 0)
    band = str(data.get("risk_classification") or ai_prompts.vendor_band(score))
    rec = str(data.get("recommendation") or "")
    conf = str(data.get("confidence") or "")
    name = _ws(vendor_name) or "?"
    public_used = bool(data.get("public_information_used")) and public_count > 0
    out: list[str] = [
        "# Vendor Risk Assessment Report",
        "## %s" % name,
        "",
        "**Assessment date:** %s" % today.isoformat(),
        "**Overall risk** — **Score: %d/10** (%s)" % (score, band.upper()),
        "**Risk classification:** %s" % band.upper(),
        "**Recommendation:** %s" % rec,
        "**Evidence confidence:** %s" % conf,
        "**Questionnaire coverage:** %d answers — %d YES, %d NO, %d PARTIAL, %d N/A"
        % (counts["total"], counts["yes"], counts["no"], counts["partial"], counts["na"]),
        "**Public information used:** %s" % ("yes" if public_used else "no"),
        "",
        "## Executive Summary",
        _ws(data.get("executive_summary")),
        "",
        "## Risk Scoring Overview",
        "Score bands: 1-3 LOW · 4-5 MEDIUM · 6-7 HIGH · 8-10 CRITICAL (10 = highest risk)",
    ]
    domains = {d.get("domain"): d for d in (data.get("domains") or []) if isinstance(d, dict)}
    for key in _VENDOR_DOMAIN_ORDER:
        d = domains.get(key) or {}
        ds = int(d.get("score") or 0)
        st = str(d.get("evidence_status") or "insufficient_evidence")
        prio = str(d.get("remediation_priority") or "none")
        out.append("### %s — %d/10 (%s)" % (key.replace("_", " ").title(), ds, ai_prompts.vendor_band(ds).upper()))
        out.append("Evidence: %s · Remediation priority: %s" % (st.replace("_", " "), prio.replace("_", " ")))
        findings = [f for f in (d.get("findings") or []) if _ws(f)]
        out += (["- %s" % _ws(f) for f in findings] or ["- No findings recorded."])
        gaps = [g for g in (d.get("gaps") or []) if _ws(g)]
        if gaps:
            out.append("Gaps:")
            out += ["- %s" % _ws(g) for g in gaps]
        out.append("")
    out.append("## Key Risks Identified")
    risks = [r for r in (data.get("key_risks") or []) if isinstance(r, dict) and _ws(r.get("risk"))]
    out += (["- **%s** — %s" % (str(r.get("severity") or "").upper(), _ws(r["risk"])) for r in risks]
           or ["- None identified from the evidence provided."])
    out += ["", "## Recommendations"]
    recs = [r for r in (data.get("recommendations") or []) if isinstance(r, dict) and _ws(r.get("action"))]
    for horizon, label in (("immediate", "Immediate actions (0-30 days)"), ("short_term", "Short-term actions (1-3 months)"),
                           ("long_term", "Long-term actions (3-12 months)")):
        items = [_ws(r["action"]) for r in recs if str(r.get("horizon") or "") == horizon]
        out.append("### %s" % label)
        out += (["%d. %s" % (n, a) for n, a in enumerate(items, 1)] or ["- None."])
    out += ["", "## Contract & SLA Requirements"]
    out += (["- %s" % _ws(c) for c in (data.get("contract_requirements") or []) if _ws(c)] or ["- None identified."])
    out += ["", "## Monitoring & Reassessment Plan"]
    out += (["- %s" % _ws(m) for m in (data.get("monitoring") or []) if _ws(m)] or ["- None identified."])
    warnings = [str(w) for w in (data.get("warnings") or []) if _ws(w)] + list(extra_warnings or [])
    if warnings:
        out += ["", "## Analysis Warnings"]
        out += ["- %s" % _ws(w) for w in warnings]
    out += [
        "",
        "## Final Risk Decision",
        "**Score: %d/10** (%s) — Recommendation: %s" % (score, band.upper(), rec),
        "",
        "Generated by GRCeye AI from the questionnaire answers%s. Every finding cites the answer it "
        "relies on; unanswered and N/A questions are never scored as satisfactory."
        % (" and %d public finding(s) (unverified)" % public_count if public_used else ""),
    ]
    return "\n".join(out).strip() + "\n"


# ─── Helpers for stream_contract_analysis (foundation tasks contract_extract map
# → contract_analysis reduce) ───────────────────────────────────────────────────
# Self-contained rather than importing vendors.py's map-reduce contract review (which reduces to
# contract_review, a plain-text consolidated review): this route needs contract_analysis's JSON
# reduce (suggestions[] + action_plan[]) instead, and vendors.py does not use that task.

class _ContractAnalysisFailed(Exception):
    """One phase of the contract_analysis map-reduce failed; ``kind`` follows ai_locale's failure kinds."""

    def __init__(self, kind: str, detail: str):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail


def _plan_contract_analysis_chunks(text: str) -> list:
    """Boundary-aware chunks of the WHOLE contract text (never the old 6,000-character excerpt),
    widening the window before exceeding the per-job call budget; ``[]`` when even the widest
    window still needs too many calls — the caller reports an explicit "too long" failure instead
    of silently analysing a slice."""
    max_calls = max(2, int(getattr(settings, "AI_MAX_CALLS_PER_JOB", 60) or 60)) - 1   # one call reserved for the reduce
    chunks = chunk_document(text)
    if len(chunks) > max_calls:
        chunks = chunk_document(text, MAX_CHUNK_TOKENS)
    if len(chunks) > max_calls:
        return []
    return chunks


def _consolidate_contract_findings(results, text: str) -> tuple[list[dict], list[str], str, list[str]]:
    """``(findings, absent_topics, contract_language, warnings)`` merged over every excerpt.

    Duplicates produced by the excerpt overlap are dropped (same topic + clause_ref + quote head);
    findings are ordered critical → info (reusing ``_GAP_SEVERITY_ORDER``, "info" sorts last via the
    default). Absence is decided here, over the whole contract, never inside one excerpt."""
    findings: list[dict] = []
    seen: set[tuple] = set()
    warnings: list[str] = []
    langs: Counter = Counter()
    for chunk, res in results:
        data = res.data if isinstance(res.data, dict) else {}
        for f in data.get("findings") or []:
            if not isinstance(f, dict):
                continue
            topic = str(f.get("topic") or "other")
            ref = _ws(f.get("clause_ref") or "unnumbered")[:120]
            quote = _ws(f.get("quote") or "")[:400]
            key = (topic, ref.lower(), quote[:80].lower())
            if key in seen:
                continue
            seen.add(key)
            findings.append({
                "excerpt": chunk.index, "topic": topic, "clause_ref": ref, "quote": quote,
                "reading": _ws(f.get("reading"))[:400], "risk": str(f.get("risk") or "info"),
            })
        facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
        code = _ws(facts.get("language")).lower()[:2]
        if code.isalpha():
            langs[code] += 1
        for w in data.get("warnings") or []:
            if _ws(w):
                warnings.append("excerpt %d: %s" % (chunk.index, _ws(w)[:300]))
        if getattr(res, "partial", False):
            warnings.append("excerpt %d: %d finding(s) failed validation and were dropped"
                            % (chunk.index, len(res.invalid_items)))
    findings.sort(key=lambda f: _GAP_SEVERITY_ORDER.get(f["risk"], 4))
    found = {f["topic"] for f in findings}
    absent = [t for t in ai_prompts.CONTRACT_TOPICS if t != "other" and t not in found]
    contract_language = langs.most_common(1)[0][0] if langs else (guess_language(text) or "unknown")
    return findings, absent, contract_language, warnings


def _findings_json_within_chars(findings: list[dict], budget_chars: int) -> tuple[str, int]:
    """Compact JSON of ``findings`` (already sorted critical → info) that fits ``budget_chars``;
    the lowest-rated tail is dropped first. Returns ``(json_text, n_omitted)``."""
    kept = list(findings)
    dumped = json.dumps(kept, ensure_ascii=False, separators=(",", ":"))
    omitted = 0
    while len(dumped) > budget_chars and len(kept) > 1:
        drop = max(1, len(kept) // 10)
        kept, omitted = kept[:-drop], omitted + drop
        dumped = json.dumps(kept, ensure_ascii=False, separators=(",", ":"))
    return dumped, omitted


async def _analyze_contract_text(text: str, *, vendor_name: str, prior_review: str | None, lang: str,
                                 cfg: ai_provider.AIConfig, user_id: str | None, tenant_id: str | None) -> tuple[dict, list[str]]:
    """Map-reduce ``contract_analysis`` over the FULL contract text → ``(validated data, warnings)``.

    Map: ``contract_extract`` per boundary-aware excerpt (verbatim clause quotes + a customer-risk
    rating each — the whole contract is read, never a 6,000-character prefix; a bad excerpt fails
    the whole job — see ``map_reduce(..., allow_partial=False)``). Reduce: ``contract_analysis`` over
    the consolidated findings (validated JSON, consistency check, one repair retry, deterministic
    decoding) instead of a hand-rolled sentinel-delimited blob with no server-side validation.
    Raises ``_ContractAnalysisFailed`` on any phase failure; never raises for a normal AI failure
    that ``ai_structured`` itself already turned into ``AiResult.ok=False``.
    """
    chunks = _plan_contract_analysis_chunks(text)
    if not chunks:
        raise _ContractAnalysisFailed("input", "The contract is too long for one AI review.")

    extract_system = ai_prompts.system_prompt("contract_extract", lang=lang)
    xd = ai_prompts.task_defaults("contract_extract")
    extract_kw = ai_provider.decoding(xd["preset"], temperature=xd["temperature"])
    extract_schema = ai_prompts.task_schema("contract_extract")

    async def _extract(chunk):
        user = ai_prompts.render_user_prompt(
            "contract_extract", vendor_name=vendor_name, file_name="uploaded contract",
            chunk_index=chunk.index, chunk_total=chunk.total, regimes="not stated",
            contract_block=ai_provider.delimit_untrusted(chunk.text, "CONTRACT", max_len=len(chunk.text) + 1))
        res = await ai_structured(
            [{"role": "system", "content": extract_system}, {"role": "user", "content": user}],
            extract_schema, schema_in_prompt=False, partial_items="findings",
            user_id=user_id, tenant_id=tenant_id, cfg=cfg, task="ai.stream_contract_analysis.extract", **extract_kw)
        if not res.ok:
            raise _ContractAnalysisFailed(res.kind or "error",
                                          "excerpt %d of %d: %s" % (chunk.index, chunk.total, res.failure_detail()))
        return chunk, res

    try:
        results = await map_reduce(chunks, _extract, lambda r: r)   # all-or-nothing: one bad excerpt fails the job
    except _ContractAnalysisFailed:
        raise
    except Exception as exc:  # noqa: BLE001 — never leak a raw exception past this call
        raise _ContractAnalysisFailed("error", "contract analysis failed unexpectedly (%s)" % type(exc).__name__)

    findings, absent, contract_language, warnings = _consolidate_contract_findings(results, text)

    rd = ai_prompts.task_defaults("contract_analysis")
    reduce_kw = ai_provider.decoding(rd["preset"], temperature=rd["temperature"])
    budget_chars = ai_provider.prompt_char_budget(int(reduce_kw.get("num_ctx") or 32768),
                                                  int(reduce_kw.get("num_predict") or 8192), reserve_tokens=2500)
    findings_dump, n_omitted = _findings_json_within_chars(findings, budget_chars)
    if n_omitted:
        warnings.append("%d lowest-rated finding(s) were omitted from the analysis input for length" % n_omitted)

    prior_review_block = ""
    if prior_review and prior_review.strip():
        prior_review_block, note = _delimit_within_budget(prior_review, "EXISTING AI REVIEW", max_tokens=2000)
        if note:
            warnings.append(note)

    analysis_system = ai_prompts.system_prompt("contract_analysis", lang=lang)
    analysis_user = ai_prompts.render_user_prompt(
        "contract_analysis", vendor_name=vendor_name, contract_language=contract_language,
        chunk_total=str(len(chunks)), absent_topics=", ".join(absent) or "none",
        prior_review_block=prior_review_block,
        findings_block=ai_provider.delimit_untrusted(findings_dump, "FINDINGS", max_len=len(findings_dump) + 1))

    res = await ai_structured(
        [{"role": "system", "content": analysis_system}, {"role": "user", "content": analysis_user}],
        ai_prompts.task_schema("contract_analysis"), schema_in_prompt=False,
        check=lambda data: ai_prompts.consistency_issues("contract_analysis", data),
        user_id=user_id, tenant_id=tenant_id, cfg=cfg, task="ai.stream_contract_analysis.reduce", **reduce_kw,
    )
    if not res.ok:
        raise _ContractAnalysisFailed(res.kind or "error", res.failure_detail())

    data = ai_prompts.apply_fixups("contract_analysis", res.data)
    leftover = ai_prompts.consistency_issues("contract_analysis", data)
    if leftover:
        warnings.extend(i.lstrip("- ").strip() for i in leftover[:5])
    return data, warnings


def _contract_analysis_sse_text(data: dict) -> str:
    """The two-sentinel text ``ContractCollaborationPage.parseSuggestionsAndPlan`` expects, built
    from the validated ``contract_analysis`` verdict.

    ``id`` / ``status`` / ``done`` are UI bookkeeping the schema itself does not carry (they are not
    an analysis fact) — assigned here so the parsed objects still satisfy the frontend's
    AISuggestion / ActionItem shape exactly as before; ``topic`` / ``evidence_quote`` are additive
    extra fields (harmless to a plain ``JSON.parse``)."""
    suggestions = []
    for i, s in enumerate(data.get("suggestions") or [], start=1):
        if not isinstance(s, dict):
            continue
        suggestions.append({
            "id": i, "clause": s.get("clause"), "severity": s.get("severity"), "issue": s.get("issue"),
            "fix": s.get("fix"), "status": "open", "topic": s.get("topic"), "evidence_quote": s.get("evidence_quote"),
        })
    actions = []
    for i, a in enumerate(data.get("action_plan") or [], start=1):
        if not isinstance(a, dict):
            continue
        actions.append({
            "id": i, "priority": a.get("priority"), "action": a.get("action"),
            "responsible": a.get("responsible"), "deadline": a.get("deadline"), "done": False, "topic": a.get("topic"),
        })
    return "--- SUGGESTIONS ---\n%s\n--- ACTION_PLAN ---\n%s" % (
        json.dumps(suggestions, ensure_ascii=False), json.dumps(actions, ensure_ascii=False))


def _sse_response(generator: AsyncGenerator[str, None]) -> StreamingResponse:
    return StreamingResponse(generator, media_type=_SSE_MEDIA_TYPE, headers=_SSE_HEADERS)


# ─── Endpoints ─────────────────────────────────────────────────────────────────


async def _quota_only_sse_generator(
    messages: list[dict],
    model: str | None,
    system_prompt: str,
    user_id: str,
    **kw,
) -> AsyncGenerator[str, None]:
    """Wrap _ollama_sse_generator for routes without a DB-backed monthly quota row
    (/chat). The daily ai_quota counter is recorded by ai_provider.ai_stream from
    real token counts because `user_id` is passed. Extra keyword arguments (cfg,
    lang, task, decoding options) are forwarded."""
    async for chunk in _ollama_sse_generator(messages, model, system_prompt, user_id=user_id, **kw):
        yield chunk


@router.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """Stream a GRC-assistant reply (foundation task `assistant_chat`).

    Expert, edition-aware, cite-or-say-so system prompt (ai_prompts.ASSISTANT_CORE)
    grounded with the tenant's profile and selected frameworks; language = body
    `language` > guessed from the last user message > Accept-Language; client roles
    restricted to user/assistant; "chat" decoding preset; tenant BYO-AI honoured.
    Subject to the daily ai_quota.DAILY_TOKEN_LIMIT per user. SSE contract unchanged
    (token / error / [DONE]; error frames carry an additive `code`).
    """
    estimated = ai_quota.estimate_tokens(
        " ".join(m.content for m in request.messages)
    )
    ai_quota.check_quota_or_raise(current_user.id, estimated)
    turns = _chat_turns(request.messages)
    if not turns:
        raise HTTPException(status_code=422, detail="No user message to answer.")
    last_user = next((t["content"] for t in reversed(turns) if t["role"] == "user"), "")
    lang = normalize_language(request.language) or guess_language(last_user) or header_lang
    tenant_id = current_user.tenant_id
    profile = await _org_profile(db, tenant_id)
    cfg = await ai_provider.load_ai_config(db, tenant_id)
    try:
        system_prompt = ai_prompts.system_prompt("assistant_chat", lang=lang, extra_context=_org_context(profile) or None)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=assistant_chat)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))
    d = ai_prompts.task_defaults("assistant_chat")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"])
    await _preflight_or_424(cfg, lang)
    return _sse_response(
        _quota_only_sse_generator(
            turns, _requested_model(request.model), system_prompt, current_user.id,
            cfg=cfg, tenant_id=tenant_id, lang=lang, task="ai.chat", **decode,
        )
    )


@router.post("/generate-policy")
async def generate_policy(
    request: PolicyGenerateRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Stream a policy/procedure document that closes ONE compliance gap (foundation
    task `policy_generation`, Markdown).

    The organisation profile comes from the tenant record (no more "Technology
    company." default), the control requirement is re-read from the framework
    database (description, guidance, must/should statements, mandatory flag) with
    the client text used only as a delimited fallback, the gap text / assessment
    scope / organisation context are delimited untrusted blocks (boundary-aware
    chunking with an explicit note when too long — never a silent slice), the
    output language follows body `language` > Accept-Language, and the "drafting"
    preset is used. SSE contract unchanged.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    profile = await _org_profile(db, tenant_id)
    cfg = await ai_provider.load_ai_config(db, tenant_id)
    fw, ctrl, reqs = await _lookup_control(db, tenant_id, request.framework_short_name, request.control_identifier)

    d = ai_prompts.task_defaults("policy_generation")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"])
    try:
        system_prompt = ai_prompts.system_prompt("policy_generation", lang=lang, extra_context=_org_context(profile) or None)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=policy_generation)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))
    budget = _body_budget(system_prompt, decode)

    # Untrusted bodies: gap statement, organisation context, existing documentation.
    if request.gap_description and request.gap_description.strip():
        gap_body, gap_note = _delimit_within_budget(request.gap_description, "GAP", max_tokens=min(budget, 6000))
        gap_block = (gap_note + "\n" if gap_note else "") + gap_body
    else:
        gap_block = ("GAP: no gap description was recorded; the control is not covered at all — "
                     "close the complete CONTROL REQUIREMENT.")
    remaining = budget - estimate_tokens(gap_block)
    blocks: list[str] = []
    if request.organization_context and request.organization_context.strip():
        blk, note = _delimit_within_budget(request.organization_context, "ORGANISATION CONTEXT",
                                           max_tokens=max(500, min(remaining, 4000)))
        blocks.append((note + "\n" if note else "") + blk)
        remaining -= estimate_tokens(blk)
    if request.existing_context and request.existing_context.strip():
        blk, note = _delimit_within_budget(request.existing_context, "EXISTING DOCUMENTATION",
                                           max_tokens=max(500, remaining))
        blocks.append((note + "\n" if note else "") + blk)
    existing_block = "\n\n".join(blocks) if blocks else "EXISTING DOCUMENTATION: none supplied."

    short_name = ai_provider.clean_field(fw.short_name if fw is not None else request.framework_short_name, 50) or _NOT_STATED
    framework_name = ai_provider.clean_field(fw.name, 200) if fw is not None else short_name
    framework_version = (ai_provider.clean_field(fw.version, 30) if fw is not None and fw.version else "") or "(edition not stated)"
    control_title = ai_provider.clean_field(ctrl.title if ctrl is not None else request.control_title, 300) or _NOT_STATED

    try:
        user_prompt = ai_prompts.render_user_prompt(
            "policy_generation",
            org_name=profile.get("name") or _NOT_STATED,
            industry=profile.get("industry") or _NOT_STATED,
            org_size=profile.get("org_size") or _NOT_STATED,
            country=profile.get("country") or _NOT_STATED,
            framework_name=framework_name,
            framework_version=framework_version,
            framework_short_name=short_name,
            control_id=ai_provider.clean_field(request.control_identifier, 50) or "?",
            control_title=control_title,
            control_requirement=_control_requirement_text(ctrl, reqs, request.control_description),
            gap_block=gap_block,
            existing_block=existing_block,
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=policy_generation)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    await _preflight_or_424(cfg, lang)
    messages = [{"role": "user", "content": user_prompt}]
    return _sse_response(
        _tracked_sse_generator(
            messages, _requested_model(request.model), system_prompt, db, quota,
            cfg=cfg, tenant_id=tenant_id, lang=lang, task="ai.generate_policy", **decode,
        )
    )


class PolicyContentRequest(BaseModel):
    title: str
    category: str | None = None
    description: str | None = None
    language: str | None = None  # "ar" | "fr" | None (English)
    model: str = DEFAULT_MODEL


@router.post("/generate-policy-content")
async def generate_policy_content(
    request: PolicyContentRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """Stream a full policy body for an existing Policy record from its title,
    category and description (foundation task `document_generation`, POLICY family).

    Grounded with the tenant profile and its selected frameworks (name, industry,
    size, country, editions) so the document is written for THIS organisation and
    cites its frameworks; the user-authored description is a delimited untrusted
    block; language = body `language` > Accept-Language (the LANGUAGE block sits in
    the system prompt, so FR/AR headings follow); "drafting" preset. SSE contract
    unchanged.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    profile = await _org_profile(db, tenant_id)
    cfg = await ai_provider.load_ai_config(db, tenant_id)

    d = ai_prompts.task_defaults("document_generation")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"])
    try:
        system_prompt = ai_prompts.system_prompt("document_generation", lang=lang, extra_context=_org_context(profile) or None)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=document_generation)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))
    budget = _body_budget(system_prompt, decode)

    size_key = _size_key(profile.get("org_size"))
    size_detail = _SIZE_DETAIL[size_key] if size_key else "not stated — assume SMB (51-500 employees) and write [Organisation size] in the header"
    title = ai_provider.clean_field(request.title, 200) or "Policy"
    category = ai_provider.clean_field(request.category, 80) or "General"
    parts = ["DOCUMENT FAMILY: POLICY (category: %s)" % category]
    if request.description and request.description.strip():
        blk, note = _delimit_within_budget(request.description, "POLICY BRIEF", max_tokens=min(budget, 6000))
        if note:
            parts.append(note)
        parts.append("SPECIFIC REQUIREMENTS (the policy's recorded purpose / description — every point must be addressed):")
        parts.append(blk)
    else:
        parts.append("SPECIFIC REQUIREMENTS: none supplied — derive the scope from the document type and the organisation profile.")

    try:
        user_prompt = ai_prompts.render_user_prompt(
            "document_generation",
            document_type=title,
            org_name=profile.get("name") or _NOT_STATED,
            industry=profile.get("industry") or _NOT_STATED,
            size_detail=size_detail,
            country=profile.get("country") or _NOT_STATED,
            frameworks=", ".join(profile.get("frameworks") or []) or "none specified",
            effective_date=date.today().isoformat(),
            requirements_block="\n".join(parts),
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=document_generation)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    await _preflight_or_424(cfg, lang)
    messages = [{"role": "user", "content": user_prompt}]
    return _sse_response(
        _tracked_sse_generator(
            messages, _requested_model(request.model), system_prompt, db, quota,
            cfg=cfg, tenant_id=tenant_id, lang=lang, task="ai.generate_policy_content", **decode,
        )
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
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Stream a structured risk analysis (foundation task `risk_analysis`, Markdown):
    likelihood/impact scored against the tenant's own risk matrix when one is
    configured (instead of an unstated, uncalibrated "X/5"), treatment options,
    controls recommended from the tenant's own selected frameworks (instead of
    a hard-coded ISO 27001 list regardless of framework in use), and key risk
    indicators — with an explicit "not stated" + conservative scoring for
    anything not given, rather than invented business impact.

    Also reused by GapConfirmModal to score a compliance gap as the risk of
    leaving it open — detected from `risk_category == "compliance"` (the exact
    value GapConfirmModal sends; no real risk-register category collides with
    it) and given the task's own $gap_note so the model is not asked to
    analyse a control as if it were a risk register entry. Language = body
    `language` > Accept-Language. SSE contract unchanged.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    profile = await _org_profile(db, tenant_id)
    cfg = await ai_provider.load_ai_config(db, tenant_id)

    d = ai_prompts.task_defaults("risk_analysis")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"])
    try:
        system_prompt = ai_prompts.system_prompt("risk_analysis", lang=lang)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=risk_analysis)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))
    budget = _body_budget(system_prompt, decode)

    is_gap = (request.risk_category or "").strip().lower() == "compliance"
    title = ai_provider.clean_field(request.title, 300) or _NOT_STATED
    category = ai_provider.clean_field(request.risk_category, 80) or _NOT_STATED
    plain = "Title: %s\nCategory: %s\nDescription: %s" % (
        title, category, request.description or "(no description provided)")
    risk_body, note = _delimit_within_budget(plain, "RISK", max_tokens=min(budget, 6000))
    risk_block = (note + "\n" if note else "") + risk_body
    gap_note = (_GAP_NOTE_TEMPLATE % title) if is_gap else ""
    scales = await _tenant_default_risk_scales(db, tenant_id)

    try:
        user_prompt = ai_prompts.render_user_prompt(
            "risk_analysis",
            gap_note=gap_note,
            risk_block=risk_block,
            org_context=_org_context(profile) or _NOT_STATED,
            framework_list=", ".join(profile.get("frameworks") or []) or "none selected",
            scales=scales,
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=risk_analysis)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    await _preflight_or_424(cfg, lang)
    messages = [{"role": "user", "content": user_prompt}]
    return _sse_response(
        _tracked_sse_generator(
            messages, _requested_model(request.model), system_prompt, db, quota,
            cfg=cfg, tenant_id=tenant_id, lang=lang, task="ai.analyze_risk", **decode,
        )
    )


@router.post("/analyze-evidence")
async def analyze_evidence(
    request: EvidenceAnalyzeRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Assess an uploaded document extract against a list of framework controls
    (foundation task `control_assessment`, JSON) via
    `ai_chunking.assess_controls_over_document` — the same chunking +
    verified-quotation assessor compliance.py's document analysis already
    ships with, so the whole document is judged (no more silent 4,000-character
    truncation) and a control the model could not judge is reported
    "Insufficient Evidence" with a verified quotation required for any other
    verdict — never a default status. Language = body `language` >
    Accept-Language. A job failure raises HTTP 424 (never glued into the body
    as text). This route is unreachable from the current UI (dead client
    stub); the SSE `token`/`[DONE]` shape is preserved regardless.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    profile = await _org_profile(db, tenant_id)

    document_text = (request.document_text or "").strip()
    if not document_text:
        raise HTTPException(status_code=422, detail="document_text is required.")

    specs = []
    seen_ids: set[str] = set()
    for i, c in enumerate(request.controls or [], start=1):
        cid = ai_provider.clean_field(c.get("control_id"), 50) or ("CTRL-%d" % i)
        base_cid, n = cid, 2
        while cid in seen_ids:
            cid = "%s (%d)" % (base_cid, n)
            n += 1
        seen_ids.add(cid)
        specs.append(control_spec_from_model({
            "control_id": cid,
            "title": c.get("title") or "(untitled control)",
            "description": c.get("description") or "",
        }))
    if not specs:
        raise HTTPException(status_code=422, detail="At least one control is required.")

    fw, _ctrl, _reqs = await _lookup_control(db, tenant_id, request.framework_short_name, "")
    short_name = ai_provider.clean_field(fw.short_name if fw is not None else request.framework_short_name, 50) or _NOT_STATED
    if fw is not None:
        framework_label = "%s%s (%s)" % (
            ai_provider.clean_field(fw.name, 200) or short_name,
            (" %s" % ai_provider.clean_field(fw.version, 30)) if fw.version else "",
            short_name,
        )
    else:
        framework_label = short_name

    cfg = ai_provider.env_ai_config()   # the config assess_controls_over_document actually uses (see below)
    await _preflight_or_424(cfg, lang)

    run_res = await assess_controls_over_document(
        [("uploaded document", document_text)],
        specs,
        lang=lang,
        framework_label=framework_label,
        context=_org_context(profile) or None,
        user_id=current_user.id,
        tenant_id=tenant_id,
        model=_requested_model(request.model),
        allow_partial=True,
    )
    if not run_res.ok:
        logger.warning("analyze-evidence failed (tenant=%s): %s", tenant_id, run_res.failure_detail())
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY, detail=run_res.user_message(lang))

    final_text = _evidence_analysis_markdown(framework_label, specs, run_res.data)
    try:
        await _increment_usage(db, quota, max(1, len(final_text) // 4))
    except Exception:  # noqa: BLE001 — never fail the response over a bookkeeping write
        logger.exception("monthly AI usage recording failed")

    async def _one_shot() -> AsyncGenerator[str, None]:
        yield ai_provider.sse_token(final_text)
        yield ai_provider.SSE_DONE

    return _sse_response(_one_shot())


@router.post("/generate-audit-plan")
async def generate_audit_plan(
    request: AuditPlanRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Stream an audit programme for the engagement (foundation task `audit_plan`,
    Markdown). The framework is re-resolved from the platform database by id,
    short name or name — AuditPlanModal's live call sends the framework's UUID
    as `framework_name` with an empty short name, which this now matches on
    `Framework.id` — so the programme is written for the framework actually
    being audited, never a raw UUID string; when resolved, ITS OWN control
    list is loaded from the database and used instead of whatever the client
    sent (today: a hard-coded 10-control ISO 27001 default regardless of the
    real framework), with an explicit "N more not listed" note when the list
    does not fit the model's context rather than a silent 40-item cut. The
    scope statement is a delimited, chunking-aware untrusted block. Language =
    body `language` > Accept-Language; "report" preset (tables allowed).
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    cfg = await ai_provider.load_ai_config(db, tenant_id)

    d = ai_prompts.task_defaults("audit_plan")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"])
    try:
        system_prompt = ai_prompts.system_prompt("audit_plan", lang=lang)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=audit_plan)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))
    budget = _body_budget(system_prompt, decode)

    fw = await _resolve_framework(db, tenant_id, request.framework_short_name, request.framework_name)
    db_rows: list[tuple[str, str, str]] = []
    if fw is not None:
        framework_name = ai_provider.clean_field(fw.name, 200) or ai_provider.clean_field(fw.short_name, 50) or _NOT_STATED
        framework_short_name = ai_provider.clean_field(fw.short_name, 50) or framework_name
        framework_version = ai_provider.clean_field(fw.version, 30) or "(edition not stated)"
        db_rows = await _audit_framework_controls(db, fw)
    else:
        raw_name = (request.framework_name or "").strip()
        framework_name = _NOT_STATED if _UUID_RE.match(raw_name) else (ai_provider.clean_field(raw_name, 200) or _NOT_STATED)
        framework_short_name = ai_provider.clean_field(request.framework_short_name, 50) or _NOT_STATED
        framework_version = "(edition not stated)"

    if db_rows:
        rows = db_rows
    else:
        rows = [
            (ai_provider.clean_field(c.get("control_id"), 50) or "?",
             ai_provider.clean_field(c.get("title"), 300) or "(untitled control)",
             ai_provider.clean_field(c.get("category"), 60))
            for c in (request.controls or [])
        ]
    if not rows:
        raise HTTPException(status_code=422,
                            detail="No controls in scope: select a framework with controls, or supply controls explicitly.")

    rendered = ["- [%s] %s%s" % (cid, title, (" (category: %s)" % cat) if cat else "") for cid, title, cat in rows]
    control_lines, included = _capped_lines(rendered, min(budget, 6000))
    more_note = "; %d more not listed" % (len(rows) - included) if included < len(rows) else ""

    audit_title = ai_provider.clean_field(request.audit_title, 200) or "Audit"
    audit_type = ai_provider.clean_field(request.audit_type, 40) or _NOT_STATED
    objective = ai_provider.clean_field(request.audit_objective, 800) or (
        "Assess conformance with %s requirements." % framework_name)
    if request.audit_scope and request.audit_scope.strip():
        scope_body, note = _delimit_within_budget(
            request.audit_scope, "SCOPE", max_tokens=max(500, budget - estimate_tokens(control_lines)))
        scope_block = "Scope:\n" + (note + "\n" if note else "") + scope_body
    else:
        scope_block = "Scope: not stated — cover the full framework scope."

    try:
        user_prompt = ai_prompts.render_user_prompt(
            "audit_plan",
            audit_title=audit_title,
            framework_name=framework_name,
            framework_short_name=framework_short_name,
            framework_version=framework_version,
            audit_type=audit_type,
            scope_block=scope_block,
            audit_objective=objective,
            control_count=str(included),
            more_note=more_note,
            control_lines=control_lines,
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=audit_plan)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    await _preflight_or_424(cfg, lang)
    messages = [{"role": "user", "content": user_prompt}]
    return _sse_response(
        _tracked_sse_generator(
            messages, _requested_model(request.model), system_prompt, db, quota,
            cfg=cfg, tenant_id=tenant_id, lang=lang, task="ai.generate_audit_plan", **decode,
        )
    )


@router.post("/analyze-vendor")
async def analyze_vendor(
    request: VendorRiskRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Full third-party risk assessment from a vendor questionnaire (+ best-effort public lookup),
    on the foundation task ``vendor_analysis`` — the same rubric-scored six-domain verdict
    vendors.py's ``POST /vendors/{id}/analyze`` uses for a stored Vendor record; this route serves
    ad hoc (unsaved) vendor data instead, so there is no Vendor row or tenant context to ground on.

    The old 230-line free-form template that demanded a "Web Research Findings" entry, certification
    years and breach history for every one of five domains regardless of what evidence existed —
    the most hallucination-prone prompt in this file — is gone: the model now scores strictly from
    the questionnaire answers it is given (deterministic decoding, one repair retry, a consistency
    check on the band/score/recommendation rules), cites the exact answer behind every finding, and
    the optional DuckDuckGo public lookup (still best-effort; delimited as untrusted third-party
    text before the model ever sees it, where before it was interpolated raw) can raise no score the
    questionnaire does not support.

    Response shape is unchanged (``{"message": <markdown report>}``); a provider/validation failure
    that survives the one repair retry now raises HTTP 424 with an honest, localised reason instead
    of the old behaviour of embedding "**Error**: ..." text inside a 200 report. Language = body
    `language` > Accept-Language. Additive fields: `structured`, `overall_score`,
    `risk_classification`, `recommendation`, `confidence`, `web_search_results`, `language`,
    `warnings`.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    cfg = await ai_provider.load_ai_config(db, tenant_id)

    responses = _vendor_bounded_responses(request.questionnaire_responses)
    if not responses:
        raise HTTPException(status_code=422,
                            detail="questionnaire_responses is empty: answer the questionnaire before running the analysis.")
    counts = _vendor_answer_counts(responses)
    extra_warnings: list[str] = []
    if len(request.questionnaire_responses) > len(responses):
        extra_warnings.append("Only the first %d questionnaire answers were analysed (%d supplied)."
                              % (len(responses), len(request.questionnaire_responses)))

    web_results = await _vendor_public_findings(request.vendor_name)

    today = date.today()
    vendor_name = ai_provider.clean_field(request.vendor_name, 200) or "(unnamed vendor)"
    d = ai_prompts.task_defaults("vendor_analysis")
    try:
        system_prompt = ai_prompts.system_prompt("vendor_analysis", lang=lang)
        user_prompt = ai_prompts.render_user_prompt(
            "vendor_analysis",
            today=today.isoformat(),
            vendor_name=vendor_name,
            industry=ai_provider.clean_field(request.vendor_industry, 100) or "not stated",
            services=ai_provider.clean_field(request.vendor_services, 400) or "not stated",
            country="not stated",
            total=counts["total"], yes=counts["yes"], no=counts["no"], partial=counts["partial"], na=counts["na"],
            questionnaire_block=ai_provider.delimit_untrusted(ai_prompts.qa_lines(responses), "QUESTIONNAIRE"),
            public_findings_block=_vendor_public_findings_block(web_results),
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=vendor_analysis)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    await _preflight_or_424(cfg, lang)
    try:
        res = await ai_structured(
            [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            ai_prompts.task_schema("vendor_analysis"), schema_in_prompt=False,
            check=lambda data: ai_prompts.consistency_issues("vendor_analysis", data),
            user_id=current_user.id, tenant_id=tenant_id, cfg=cfg, task="ai.analyze_vendor",
            model=_requested_model(request.model), **ai_provider.decoding(d["preset"], temperature=d["temperature"]),
        )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — never a 5xx: client.ts redirects the whole app to /service-down
        logger.exception("ai.analyze_vendor.error vendor=%s", vendor_name)
        raise HTTPException(status_code=424,
                            detail="%s (error: vendor analysis failed unexpectedly)" % ai_provider.failure_message("error", lang))

    if not res.ok:
        logger.warning("ai.analyze_vendor.failed vendor=%s kind=%s attempts=%d: %s",
                       vendor_name, res.kind, res.attempts, res.error)
        raise HTTPException(status_code=424, detail=res.user_message(lang))

    data = ai_prompts.apply_fixups("vendor_analysis", res.data)
    leftover = ai_prompts.consistency_issues("vendor_analysis", data)
    if leftover:
        logger.warning("ai.analyze_vendor.inconsistent vendor=%s: %s", vendor_name, " | ".join(leftover)[:500])
        extra_warnings.extend(i.lstrip("- ").strip() for i in leftover[:5])

    report = _render_vendor_analysis_markdown(data, vendor_name=vendor_name, today=today, counts=counts,
                                              public_count=len(web_results), extra_warnings=extra_warnings)
    try:
        await _increment_usage(db, quota, max(1, len(report) // 4))
    except Exception:  # noqa: BLE001 — never fail the response over a bookkeeping write
        logger.exception("monthly AI usage recording failed")

    warnings = [str(w) for w in (data.get("warnings") or []) if str(w).strip()] + extra_warnings
    return {
        "message": report,
        "structured": data,
        "overall_score": int(data.get("overall_score") or 0),
        "risk_classification": str(data.get("risk_classification") or ""),
        "recommendation": str(data.get("recommendation") or ""),
        "confidence": str(data.get("confidence") or ""),
        "web_search_results": web_results,
        "language": lang,
        "warnings": warnings,
    }


class RemediationPlanRequest(BaseModel):
    assessment_id: str
    framework_short_name: str | None = None
    gaps: list[dict] = []    # optional — if empty, fetched from DB
    horizon_days: int | None = None   # additive: default 90 (clamped 7-730)
    model: str = DEFAULT_MODEL
    language: str | None = None       # additive: "en" | "fr" | "ar"; Accept-Language otherwise


@router.post("/stream-remediation-plan")
async def stream_remediation_plan(
    request: RemediationPlanRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Stream a prioritised remediation plan for every open gap of one compliance
    assessment (foundation task `remediation_plan`, Markdown).

    The assessment is now loaded WITH a tenant_id filter — previously any
    authenticated user could pass another tenant's `assessment_id` and have
    that tenant's gap descriptions streamed back into their own plan (a
    cross-tenant data leak); a 404 replaces that silent cross-tenant read.
    Every gap is now passed to the model: the old silent 10/10/15-item,
    150-character caps are gone; when the full list still does not fit the
    model's context an explicit "not itemised individually — group them"
    note is appended per bucket (matching the task's own grouping rule)
    instead of dropping gaps with no signal. Language = body `language` >
    Accept-Language; "report" preset (tables allowed). SSE contract unchanged.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    cfg = await ai_provider.load_ai_config(db, tenant_id)

    from sqlalchemy import select as sa_select
    from app.models.compliance import ComplianceAssessment, ComplianceGap
    from app.models.framework import Framework, FrameworkControl

    gaps = list(request.gaps or [])
    framework_short_name = ai_provider.clean_field(request.framework_short_name, 50)
    framework_name = ""

    # If no gaps or framework provided, load from DB (tenant-scoped).
    if not gaps or not framework_short_name:
        assessment = (await db.execute(
            sa_select(ComplianceAssessment).where(
                ComplianceAssessment.id == request.assessment_id,
                ComplianceAssessment.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if assessment is None:
            raise HTTPException(status_code=404, detail="Assessment not found.")

        fw = (await db.execute(
            sa_select(Framework).where(Framework.id == assessment.framework_id)
        )).scalar_one_or_none()
        if not framework_short_name:
            framework_short_name = ai_provider.clean_field(fw.short_name if fw else "", 50)
        framework_name = ai_provider.clean_field(fw.name, 200) if fw is not None else ""

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

    framework_short_name = framework_short_name or _NOT_STATED
    framework_name = framework_name or framework_short_name
    horizon_days = request.horizon_days if request.horizon_days and 7 <= request.horizon_days <= 730 else 90

    blockers = [g for g in gaps if g.get("is_certification_blocker")]
    high = [g for g in gaps if not g.get("is_certification_blocker") and g.get("severity") in ("critical", "high")]
    others = [g for g in gaps if not g.get("is_certification_blocker") and g.get("severity") not in ("critical", "high")]

    d = ai_prompts.task_defaults("remediation_plan")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"])
    try:
        system_prompt = ai_prompts.system_prompt("remediation_plan", lang=lang)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=remediation_plan)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))
    budget = _body_budget(system_prompt, decode)

    def bucket(items: list[dict], label: str) -> tuple[str, int]:
        nonlocal budget
        lines, included = _capped_lines([_fmt_gap_line(g) for g in items], budget)
        if included < len(items):
            lines += ("\n- (%d further %s not itemised individually here — group them by control family "
                      "under this heading and name each identifier)" % (len(items) - included, label))
        budget = max(500, budget - estimate_tokens(lines))
        return lines, len(items)

    blocker_lines, n_blockers = bucket(blockers, "certification blockers")
    high_lines, n_high = bucket(high, "critical/high gaps")
    other_lines, n_other = bucket(others, "medium/low gaps")

    try:
        user_prompt = ai_prompts.render_user_prompt(
            "remediation_plan",
            framework_name=framework_name,
            framework_short_name=framework_short_name,
            horizon_days=str(horizon_days),
            available_roles=_REMEDIATION_OWNER_ROLES,
            n_blockers=str(n_blockers),
            blocker_lines=blocker_lines,
            n_high=str(n_high),
            high_lines=high_lines,
            n_other=str(n_other),
            other_lines=other_lines,
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=remediation_plan)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    await _preflight_or_424(cfg, lang)
    messages = [{"role": "user", "content": user_prompt}]
    return _sse_response(
        _tracked_sse_generator(
            messages, _requested_model(request.model), system_prompt, db, quota,
            cfg=cfg, tenant_id=tenant_id, lang=lang, task="ai.stream_remediation_plan", **decode,
        )
    )


# The document-generation system prompt is ai_prompts.system_prompt("document_generation", ...)
# (ROLE_POLICY_WRITER + AUTHOR_CORE + TASK_DOCUMENT_GENERATION + Markdown rules + LANGUAGE block).

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
    language: str | None = None   # additive: "en" | "fr" | "ar"; Accept-Language otherwise


@router.post("/generate-document")
async def generate_document(
    request: DocumentGenerateRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Stream a complete governance document (one of the Doc Generator's 29 types)
    tailored to the organisation profile from the form (foundation task
    `document_generation`, Markdown).

    The form is authoritative for the profile (name, industry, size, country,
    frameworks); the specific requirements / target controls are a delimited
    untrusted block that the document must address and map under "Requirement
    Coverage"; today's date is supplied (no guessed effective date); the answer
    budget scales with the organisation size so long documents are not silently
    cut (a cut now surfaces as an explicit `truncated` error frame); language =
    body `language` > Accept-Language; "drafting" preset. On completion the page
    saves the text as a Policy — a provider outage is therefore refused up front
    with HTTP 424 rather than streamed as an error frame into the body.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    cfg = await ai_provider.load_ai_config(db, tenant_id)
    size_key = request.size if request.size in _SIZE_DETAIL else "smb"

    d = ai_prompts.task_defaults("document_generation")
    decode = ai_provider.decoding(d["preset"], temperature=d["temperature"], num_predict=_DOC_NUM_PREDICT[size_key])
    country = ai_provider.clean_field(request.country, 60) or _NOT_STATED
    try:
        system_prompt = ai_prompts.system_prompt("document_generation", lang=lang, extra_context=_regimes_line(country) or None)
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=document_generation)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))
    budget = _body_budget(system_prompt, decode)

    document_type = ai_provider.clean_field(request.document_type, 120) or "governance document"
    frameworks = (ai_provider.clean_field(request.frameworks, 400)
                  or "none specified — write framework-agnostic best-practice content")
    requirements_block = ""
    if request.specific_requirements and request.specific_requirements.strip():
        blk, note = _delimit_within_budget(request.specific_requirements, "SPECIFIC REQUIREMENTS",
                                           max_tokens=min(budget, 8000))
        requirements_block = ("SPECIFIC REQUIREMENTS / TARGET CONTROLS (each must be addressed by a specific "
                              "statement and mapped under Requirement Coverage):\n" + (note + "\n" if note else "") + blk)

    try:
        user_prompt = ai_prompts.render_user_prompt(
            "document_generation",
            document_type=document_type,
            org_name=ai_provider.clean_field(request.org_name, 120) or _NOT_STATED,
            industry=ai_provider.clean_field(request.industry, 80) or _NOT_STATED,
            size_detail=_SIZE_DETAIL[size_key],
            country=country,
            frameworks=frameworks,
            effective_date=date.today().isoformat(),
            requirements_block=requirements_block,
        )
    except ai_prompts.PromptError:
        logger.exception("prompt composition failed (task=document_generation)")
        raise HTTPException(status_code=status.HTTP_424_FAILED_DEPENDENCY,
                            detail=ai_provider.failure_message("bad_config", lang))

    await _preflight_or_424(cfg, lang)
    messages = [{"role": "user", "content": user_prompt}]
    return _sse_response(
        _tracked_sse_generator(
            messages, _requested_model(request.model), system_prompt, db, quota,
            cfg=cfg, tenant_id=tenant_id, lang=lang, task="ai.generate_document", **decode,
        )
    )


@router.get("/access-check")
async def ai_access_check(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Return the user's AI access status and current quota usage."""
    quota = await _get_or_create_quota(db, current_user)
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
    language: str | None = None   # additive: "en" | "fr" | "ar"; Accept-Language otherwise


@router.post("/stream-contract-analysis")
async def stream_contract_analysis(
    request: ContractAnalysisRequest,
    access: Annotated[tuple, Depends(_require_ai_access)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
):
    """
    Stream a structured contract analysis (foundation tasks ``contract_extract`` map →
    ``contract_analysis`` reduce): clause-level fix suggestions the customer sends to the vendor,
    plus a prioritised vendor action plan.

    The WHOLE contract is read via boundary-aware chunking — never the old 6,000-character excerpt,
    the single largest accuracy defect on this route: a multi-page MSA/DPA was analysed from its
    first page only while the prompt still demanded "reference actual clauses and article numbers"
    for the whole document. Findings are extracted per excerpt with a verbatim-quote requirement,
    consolidated over the whole contract (absence of a topic is decided only once every excerpt has
    been read), then reduced into schema-validated JSON (severity order, a fix for every suggestion,
    every action traceable to a suggestion — checked and, on the one repair retry, fed back to the
    model) instead of a hand-rolled sentinel-delimited blob with no server-side validation that a
    single unescaped quote or trailing prose silently turned into "no issues found". The vendor-
    supplied / OCR'd contract text — the highest-value prompt-injection surface in this file — is
    delimited untrusted before the model ever sees it; it was interpolated raw. A job failure raises
    HTTP 424 with an honest, localised reason instead of streaming into a 200 that the client's own
    parser would silently turn into empty arrays. Language = body `language` > Accept-Language
    (governs `issue` / `action` prose; the task's own rule keeps `fix` wording in the CONTRACT's own
    detected language and drafting register, quoted terms included).

    Response shape is unchanged: the same two-sentinel SSE text the client parses —
      --- SUGGESTIONS ---
      [{"id":1,"clause":"...","severity":"critical","issue":"...","fix":"...","status":"open"}, ...]
      --- ACTION_PLAN ---
      [{"id":1,"priority":"high","action":"...","responsible":"...","deadline":"30 days","done":false}, ...]
    `id` / `status` / `done` (UI bookkeeping the schema does not carry) are assigned server-side so
    the parsed objects still match AISuggestion / ActionItem exactly; `topic` / `evidence_quote` are
    additive extra fields on each item.
    """
    current_user, quota = access
    lang = normalize_language(request.language) or header_lang
    tenant_id = current_user.tenant_id
    cfg = await ai_provider.load_ai_config(db, tenant_id)

    contract_text = (request.contract_text or "").strip()
    if not contract_text:
        raise HTTPException(status_code=422, detail="contract_text is required.")
    vendor_name = ai_provider.clean_field(request.vendor_name, 200) or "Vendor"

    await _preflight_or_424(cfg, lang)
    try:
        data, warnings = await _analyze_contract_text(
            contract_text, vendor_name=vendor_name, prior_review=request.ai_review, lang=lang,
            cfg=cfg, user_id=current_user.id, tenant_id=tenant_id,
        )
    except _ContractAnalysisFailed as exc:
        logger.warning("ai.stream_contract_analysis.failed vendor=%s kind=%s: %s", vendor_name, exc.kind, exc.detail)
        raise HTTPException(status_code=424,
                            detail="%s (%s)" % (ai_provider.failure_message(exc.kind, lang), exc.detail))

    if warnings:
        logger.info("ai.stream_contract_analysis.warnings vendor=%s: %s", vendor_name, " | ".join(warnings)[:500])

    final_text = _contract_analysis_sse_text(data)
    try:
        await _increment_usage(db, quota, max(1, len(final_text) // 4))
    except Exception:  # noqa: BLE001 — never fail the response over a bookkeeping write
        logger.exception("monthly AI usage recording failed")

    async def _one_shot() -> AsyncGenerator[str, None]:
        yield ai_provider.sse_token(final_text)
        yield ai_provider.SSE_DONE

    return _sse_response(_one_shot())
