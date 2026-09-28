"""Rate-limiting setup using slowapi.

Each endpoint can opt-in by adding @limiter.limit("N/period") decorator.
Limits target login/register/refresh and AI endpoints to mitigate
credential stuffing and AI abuse.
"""
import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings


def _key_func(request: Request) -> str:
    """Use the user id when authenticated; else fall back to remote IP."""
    user = getattr(request.state, "user", None)
    if user is not None and getattr(user, "id", None):
        return f"user:{user.id}"
    return get_remote_address(request)


def _storage_uri() -> str | None:
    """Back the limiter with Redis when one is configured and reachable.

    slowapi defaults to in-memory storage, which under the 2 uvicorn workers
    production runs means every "5/minute" login limit was really 5 per worker
    — a 2x margin on exactly the credential-stuffing protection these limits
    exist for. ``limits`` opens the connection lazily, so an unreachable Redis
    would only surface as an error on the first limited request; we probe it
    once here and fall back to in-memory (previous behaviour) instead.
    """
    uri = (settings.REDIS_URL or "").strip()
    if not uri:
        return None
    try:
        import redis

        client = redis.from_url(uri, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        client.close()
    except Exception as exc:  # noqa: BLE001 — any failure means "use memory"
        logging.getLogger(__name__).warning(
            "Rate limiter falling back to per-worker in-memory storage (%s).",
            exc.__class__.__name__,
        )
        return None
    return uri


limiter = Limiter(key_func=_key_func, default_limits=[], storage_uri=_storage_uri())


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):  # noqa: ARG001
    """Generic, no-leakage 429 response (text localised to the UI language)."""
    from app.core.i18n_messages import request_language, translate_text
    return JSONResponse(
        status_code=429,
        content={"detail": translate_text("Too many requests. Please slow down and try again.",
                                          request_language(request))},
    )
