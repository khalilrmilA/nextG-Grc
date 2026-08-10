"""
License Enforcement Middleware — blocks API access on unlicensed client installs.

Registered ALWAYS in main.py, but the first line of dispatch returns immediately
when enforcement is disabled (the default), so the SaaS deployment sees zero
overhead and zero behavior change.

Verdicts are cached in app.core.licensing.license_cache and re-derived from the
DB at most every LICENSE_CACHE_TTL_SECONDS; /license/activate calls
invalidate_license_cache() so activation takes effect instantly.
"""
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.licensing import (
    LICENSE_CACHE_TTL_SECONDS,
    effective_public_key,
    enforcement_enabled,
    license_cache,
    verify_license,
)
from app.models.license import LicenseActivation

logger = logging.getLogger(__name__)

# Paths that must stay reachable without a license (login, token refresh,
# profile read, and the license status/activation endpoints themselves).
# /auth/me is an EXACT match: its sub-paths (/auth/me/frameworks, …) mutate
# tenant data and must stay gated.
ALLOWED_EXACT = (
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/me",
)
ALLOWED_PREFIXES = (
    "/api/v1/license/",
)


def _is_allowed(path: str) -> bool:
    return path in ALLOWED_EXACT or path.startswith(ALLOWED_PREFIXES)

# Clock-rollback guard: last_seen_at may lag `now` by up to 1h (throttled
# writes); if `now` is ever more than 24h BEHIND last_seen_at the client
# rolled the clock back and the license is treated as invalid.
_ROLLBACK_TOLERANCE = timedelta(hours=24)
_LAST_SEEN_WRITE_INTERVAL = timedelta(hours=1)


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


async def _refresh_verdict() -> str:
    """Re-read the activation row and return "ok" | "license_required" | "license_expired".

    Uses its own DB session — never the request's.
    """
    public_key = effective_public_key()
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(LicenseActivation)
                .order_by(LicenseActivation.activated_at.desc())
                .limit(1)
            )
            activation = result.scalars().first()

            # No activation, or no public key to verify against ("unconfigured").
            if activation is None or not public_key:
                return "license_required"

            try:
                payload = verify_license(activation.license_key, public_key)
            except ValueError:
                return "license_required"

            now = datetime.now(timezone.utc)

            # Clock-rollback guard.
            last_seen = _parse_iso(activation.last_seen_at)
            if last_seen and now < last_seen - _ROLLBACK_TOLERANCE:
                logger.warning("License check: system clock is >24h behind last_seen_at")
                return "license_required"

            # Throttled heartbeat write (at most once per hour).
            if last_seen is None or now > last_seen + _LAST_SEEN_WRITE_INTERVAL:
                activation.last_seen_at = _iso_z(now)
                await db.commit()

            expires_at = _parse_iso(payload.get("expires_at"))
            if expires_at is None:
                return "license_required"
            if now >= expires_at:
                return "license_expired"
            return "ok"
    except Exception as exc:
        logger.warning("License check failed: %s", exc)
        return "license_required"


async def _get_verdict() -> str:
    """Cached verdict — hits the DB at most every LICENSE_CACHE_TTL_SECONDS."""
    now = time.monotonic()
    if (
        license_cache["verdict"] is not None
        and now - license_cache["checked_at"] < LICENSE_CACHE_TTL_SECONDS
    ):
        return license_cache["verdict"]
    verdict = await _refresh_verdict()
    license_cache["verdict"] = verdict
    license_cache["checked_at"] = time.monotonic()
    return verdict


class LicenseEnforcementMiddleware(BaseHTTPMiddleware):
    async def __call__(self, scope, receive, send):
        # BaseHTTPMiddleware only dispatches HTTP scopes — websocket routes
        # (e.g. support chat) would silently bypass enforcement, so gate them
        # here before delegating.
        if (
            scope["type"] == "websocket"
            and enforcement_enabled()
            and scope.get("path", "").startswith(settings.API_V1_PREFIX)
            and not _is_allowed(scope.get("path", ""))
            and await _get_verdict() != "ok"
        ):
            message = await receive()
            if message["type"] == "websocket.connect":
                await send({"type": "websocket.close", "code": 4402})
            return
        await super().__call__(scope, receive, send)

    async def dispatch(self, request: Request, call_next):
        # No-op unless this is a licensed client build (or explicitly enabled).
        if not enforcement_enabled():
            return await call_next(request)

        path = request.url.path

        # Only API routes are gated — /, /health, docs, static all pass.
        if not path.startswith(settings.API_V1_PREFIX):
            return await call_next(request)

        # CORS preflight always passes.
        if request.method == "OPTIONS":
            return await call_next(request)

        # Login / refresh / profile / license endpoints always pass.
        if _is_allowed(path):
            return await call_next(request)

        verdict = await _get_verdict()
        if verdict == "ok":
            return await call_next(request)

        return JSONResponse(status_code=402, content={"detail": verdict})
