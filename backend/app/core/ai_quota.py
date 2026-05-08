"""Per-user daily AI token quota.

Tracks Ollama token usage (prompt + completion) per user per UTC day. Endpoints
call ``check_quota_or_raise(user_id)`` BEFORE making the Ollama request, then
``record_usage(user_id, tokens)`` AFTER the response — using Ollama's
``prompt_eval_count`` and ``eval_count`` for accuracy.

Storage is in-process. For multi-worker deployments, swap ``_USAGE`` for a
Redis hash keyed by ``f"ai_quota:{user_id}:{date}"``.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException

# Daily token limit per user (prompt + completion combined). Adjust in one place.
DAILY_TOKEN_LIMIT = 100_000

# Tokenizer-free estimate: roughly 4 characters per token for English. Used to
# pre-block huge prompts before we hit Ollama; actual usage replaces the
# estimate via record_usage() once Ollama returns the real counts.
CHARS_PER_TOKEN = 4

_USAGE: dict[tuple[str, str], int] = defaultdict(int)
_LOCK = asyncio.Lock()


def _today_key() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _key(user_id: str) -> tuple[str, str]:
    return (user_id, _today_key())


def estimate_tokens(text: str | None) -> int:
    """Very rough token estimate from character length. Always at least 1."""
    if not text:
        return 1
    return max(1, len(text) // CHARS_PER_TOKEN)


def get_used(user_id: str) -> int:
    return _USAGE.get(_key(user_id), 0)


def get_remaining(user_id: str) -> int:
    return max(0, DAILY_TOKEN_LIMIT - get_used(user_id))


def check_quota_or_raise(user_id: str, estimated_tokens: int = 0) -> None:
    """Raise 429 if the user has already exceeded the daily limit, or if the
    estimated request would obviously blow past it."""
    used = get_used(user_id)
    if used >= DAILY_TOKEN_LIMIT:
        raise HTTPException(
            429,
            f"AI daily token limit reached ({DAILY_TOKEN_LIMIT:,} tokens). Resets at 00:00 UTC.",
        )
    # Block requests whose estimate alone would push the user well over the cap.
    if estimated_tokens > 0 and used + estimated_tokens > DAILY_TOKEN_LIMIT:
        raise HTTPException(
            429,
            f"This request would exceed your remaining daily AI quota "
            f"({get_remaining(user_id):,} tokens left).",
        )


def record_usage(user_id: str, tokens: int) -> None:
    """Increment the user's usage counter. Safe to call multiple times."""
    if tokens <= 0:
        return
    _USAGE[_key(user_id)] += tokens


def record_from_ollama_response(user_id: str, payload: dict | None) -> None:
    """Convenience: extract prompt_eval_count + eval_count from an Ollama
    response (final chunk in streaming, or the full response in non-streaming)
    and record both. Falls back silently if the keys are absent."""
    if not payload:
        return
    prompt = int(payload.get("prompt_eval_count") or 0)
    completion = int(payload.get("eval_count") or 0)
    if prompt or completion:
        record_usage(user_id, prompt + completion)
