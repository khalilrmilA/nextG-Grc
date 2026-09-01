"""Bring-your-own-AI: resolve which model endpoint to call, and how.

Customers who will not send their data to the bundled model can point the
platform at their own endpoint with their own API key. Two dialects are
supported, chosen by a plain if/else so Nuitka can follow every branch
statically (the appliance compiles this, and anything resolved by dynamic import
or a plugin registry would simply not be bundled):

    ollama   the existing native /api/chat + /api/tags path. THE DEFAULT.
    openai   OpenAI-compatible /chat/completions + /models, Bearer auth.
             Covers OpenAI, Azure OpenAI, vLLM, LiteLLM, Groq, Together, and
             Anthropic's OpenAI-compatible endpoint.

BACKWARD COMPATIBILITY IS THE POINT
This module ships to a live production server. With no new configuration set,
env_ai_config() returns exactly today's values and the ollama branch reproduces
today's request byte for byte, including NOT sending an Authorization header at
all rather than sending an empty one.

Configuration resolves in three layers, last wins:
    compiled defaults -> environment (per deployment) -> tenant row (per customer)
"""
from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from urllib.parse import urlparse

from app.core.config import settings

# Providers we can actually speak. Kept as a tuple, not an Enum, so a bad value
# in the database degrades to the default instead of raising on model load.
PROVIDERS = ("ollama", "openai")


class AIProviderError(RuntimeError):
    """Configuration is unusable. Callers should refuse rather than guess."""


def _host(url: str) -> str:
    """Host only, for log lines. Never log a full URL: it can carry credentials."""
    try:
        return urlparse(url).hostname or "?"
    except Exception:
        return "?"


@dataclass(frozen=True, repr=False)
class AIConfig:
    provider: str
    base_url: str
    model: str
    api_key: str = ""
    source: str = "default"          # default | env | tenant
    verify: bool | str = True        # False, or a path to a CA bundle

    def __repr__(self) -> str:
        # Masked on purpose. This object ends up in tracebacks and log records,
        # and an API key must not travel with it.
        return (
            "AIConfig(provider=%r, host=%r, model=%r, key=%s, source=%r)"
            % (self.provider, _host(self.base_url), self.model,
               "set" if self.api_key else "unset", self.source)
        )

    __str__ = __repr__


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def env_ai_config() -> AIConfig:
    """The deployment default.

    An empty AI_PROVIDER means "nothing configured", which must reproduce the
    behaviour that existed before this module: local Ollama, native API, no auth.
    """
    provider = (getattr(settings, "AI_PROVIDER", "") or "").strip().lower()
    if provider not in PROVIDERS:
        return AIConfig(
            provider="ollama",
            base_url=settings.OLLAMA_BASE_URL,
            model=settings.OLLAMA_CHAT_MODEL,
            api_key="",
            source="default",
        )
    return AIConfig(
        provider=provider,
        base_url=(getattr(settings, "AI_BASE_URL", "") or settings.OLLAMA_BASE_URL),
        model=(getattr(settings, "AI_MODEL", "") or settings.OLLAMA_CHAT_MODEL),
        api_key=getattr(settings, "AI_API_KEY", "") or "",
        source="env",
        verify=(getattr(settings, "AI_CA_BUNDLE", "") or True),
    )


def resolve_ai_config(row, *, requested_model: str | None = None) -> AIConfig:
    """Overlay a tenant's row on the deployment default.

    Only applied when the row exists AND is explicitly enabled. Emptiness is not
    treated as intent: a customer who clears their base URL must not silently
    start spending the vendor's own key.
    """
    cfg = env_ai_config()

    if row is not None and getattr(row, "enabled", False):
        if not getattr(settings, "AI_ALLOW_TENANT_OVERRIDE", True):
            # A locked-down deployment can forbid per-tenant endpoints entirely.
            pass
        else:
            from app.core.secret_box import decrypt  # noqa: PLC0415

            key = decrypt(row.api_key_encrypted or "") or ""
            provider = (row.provider or cfg.provider).strip().lower()
            if provider not in PROVIDERS:
                provider = cfg.provider
            cfg = AIConfig(
                provider=provider,
                base_url=(row.base_url or cfg.base_url),
                model=(row.model or cfg.model),
                api_key=key,
                source="tenant",
                verify=cfg.verify,
            )

    # A client-supplied model is honoured only when no customer key is in play.
    # With a paying key configured, letting the browser choose the model lets a
    # user spend the customer's money on whatever they like.
    if requested_model and not cfg.api_key:
        cfg = AIConfig(
            provider=cfg.provider,
            base_url=cfg.base_url,
            model=requested_model,
            api_key=cfg.api_key,
            source=cfg.source,
            verify=cfg.verify,
        )
    return cfg


async def load_ai_config(db, tenant_id: str) -> AIConfig:
    """Read the tenant's row (if any) and resolve the effective configuration."""
    if not tenant_id:
        return env_ai_config()
    try:
        from sqlalchemy import select  # noqa: PLC0415

        from app.models.tenant_ai_config import TenantAIConfig  # noqa: PLC0415

        result = await db.execute(
            select(TenantAIConfig).where(TenantAIConfig.tenant_id == tenant_id)
        )
        return resolve_ai_config(result.scalar_one_or_none())
    except Exception:
        # A missing table on an older database, or any query problem, must not
        # take AI down. Fall back to the deployment default.
        return env_ai_config()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _is_private_host(host: str) -> bool:
    if not host:
        return False
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local


def validate_endpoint(url: str) -> None:
    """Reject endpoints that would leak the key or send it in clear text.

    Raises AIProviderError with a message safe to show a tenant administrator.
    """
    if not url:
        raise AIProviderError("An endpoint URL is required.")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise AIProviderError("The endpoint must be an http or https URL.")
    if parsed.username or parsed.password:
        # Credentials in the URL end up in logs, proxies and Referer headers.
        raise AIProviderError(
            "Do not put credentials in the URL. Use the API key field."
        )
    if parsed.scheme == "http":
        if not (_is_private_host(parsed.hostname or "")
                or getattr(settings, "AI_ALLOW_INSECURE_ENDPOINTS", False)):
            raise AIProviderError(
                "Plain http is only allowed to a private address. "
                "Use https for a public endpoint."
            )


# ---------------------------------------------------------------------------
# Wire format
# ---------------------------------------------------------------------------

def chat_url(cfg: AIConfig) -> str:
    base = cfg.base_url.rstrip("/")
    if cfg.provider == "openai":
        # base_url is expected to include the version segment, e.g. .../v1
        return "%s/chat/completions" % base
    return "%s/api/chat" % base


def models_url(cfg: AIConfig) -> str:
    base = cfg.base_url.rstrip("/")
    if cfg.provider == "openai":
        return "%s/models" % base
    return "%s/api/tags" % base


def auth_headers(cfg: AIConfig) -> dict:
    """Auth headers, or an EMPTY dict.

    Empty matters: the caller must omit the headers kwarg entirely rather than
    send an empty Authorization, so the default Ollama request is unchanged.
    """
    if not cfg.api_key:
        return {}
    return {"Authorization": "Bearer %s" % cfg.api_key}


def request_kwargs(cfg: AIConfig, payload: dict) -> dict:
    """Keyword arguments for httpx, including headers only when there are any."""
    kwargs = {"json": payload}
    headers = auth_headers(cfg)
    if headers:
        kwargs["headers"] = headers
    # Never follow a redirect on an authenticated call: it would replay the
    # Authorization header to whatever host the redirect names.
    kwargs["follow_redirects"] = False
    return kwargs


def build_payload(
    cfg: AIConfig,
    messages: list[dict],
    *,
    stream: bool,
    system_prompt: str | None = None,
    json_mode: bool = False,
    options: dict | None = None,
) -> dict:
    """The request body for the chosen dialect.

    The ollama branch is deliberately identical to what the code sent before
    this module existed.
    """
    msgs = list(messages)
    if system_prompt:
        msgs = [{"role": "system", "content": system_prompt}, *msgs]

    payload = {"model": cfg.model, "stream": stream, "messages": msgs}

    if cfg.provider == "openai":
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        # Ollama's "options" bag is not valid OpenAI; promote the two fields
        # that have a standard equivalent and drop the rest. api.openai.com and
        # Azure both reject unknown body parameters with a 400.
        if options:
            for key in ("temperature", "top_p"):
                if key in options:
                    payload[key] = options[key]
        return payload

    if json_mode:
        payload["format"] = "json"
    if options:
        payload["options"] = options
    return payload


def extract_content(cfg: AIConfig, data: dict) -> str:
    """Assistant text from a non-streaming response."""
    if cfg.provider == "openai":
        choices = data.get("choices") or []
        if not choices:
            return ""
        return (choices[0].get("message") or {}).get("content", "") or ""
    return (data.get("message") or {}).get("content", "") or ""


def stream_token(cfg: AIConfig, chunk: dict) -> tuple[str, bool]:
    """One streamed chunk -> (text, finished).

    Ollama streams NDJSON with a "done" flag. OpenAI streams SSE "data:" lines
    whose delta carries the text and whose end is signalled by "[DONE]" (handled
    by the caller) or a non-null finish_reason.
    """
    if cfg.provider == "openai":
        choices = chunk.get("choices") or []
        if not choices:
            return "", False
        first = choices[0]
        token = (first.get("delta") or {}).get("content", "") or ""
        return token, first.get("finish_reason") is not None
    token = (chunk.get("message") or {}).get("content", "") or ""
    return token, bool(chunk.get("done"))


def iter_stream_payloads(cfg: AIConfig, line: str):
    """Normalise one raw stream line into zero or one JSON objects.

    OpenAI frames with "data: " and terminates with "data: [DONE]"; Ollama emits
    bare JSON per line. Returning a list keeps the call site free of dialect
    knowledge.
    """
    import json  # noqa: PLC0415

    if not line:
        return []
    if cfg.provider == "openai":
        if not line.startswith("data:"):
            return []
        body = line[5:].strip()
        if not body or body == "[DONE]":
            return []
        try:
            return [json.loads(body)]
        except ValueError:
            return []
    try:
        return [json.loads(line)]
    except ValueError:
        return []
