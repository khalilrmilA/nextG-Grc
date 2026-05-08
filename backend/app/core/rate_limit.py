"""Rate-limiting setup using slowapi.

Each endpoint can opt-in by adding @limiter.limit("N/period") decorator.
Limits target login/register/refresh and AI endpoints to mitigate
credential stuffing and AI abuse.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


def _key_func(request: Request) -> str:
    """Use the user id when authenticated; else fall back to remote IP."""
    user = getattr(request.state, "user", None)
    if user is not None and getattr(user, "id", None):
        return f"user:{user.id}"
    return get_remote_address(request)


limiter = Limiter(key_func=_key_func, default_limits=[])


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):  # noqa: ARG001
    """Generic, no-leakage 429 response."""
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please slow down and try again."},
    )
