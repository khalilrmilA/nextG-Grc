"""
Activity Log Middleware — automatically logs all mutating API requests.
Covers POST / PUT / PATCH / DELETE across all endpoints with zero per-endpoint code.
"""
import logging
import re
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from jose import jwt, JWTError

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

logger = logging.getLogger(__name__)

# Only log write methods
LOGGED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Paths to skip (auth noise, health, reads, OpenAPI)
SKIP_PATTERNS = [
    r"^/health$",
    r"^/api/v1/auth/login",
    r"^/api/v1/auth/refresh",
    r"^/api/v1/openapi",
    r"^/api/v1/docs",
    r"^/api/v1/redoc",
    r"^/api/v1/activity-log",   # don't log viewing the log itself
    r"^/api/v1/notifications",  # high-frequency, low-value
]

# Map URL path segments → human-readable entity types
PATH_TO_ENTITY: dict[str, str] = {
    "risks":                "risk",
    "risk-scenarios":       "risk_scenario",
    "risk-matrices":        "risk_matrix",
    "compliance":           "compliance",
    "frameworks":           "framework",
    "audits":               "audit",
    "policies":             "policy",
    "vendors":              "vendor",
    "assets":               "asset",
    "incidents":            "incident",
    "vulnerabilities":      "vulnerability",
    "threats":              "threat",
    "applied-controls":     "applied_control",
    "security":             "security_exception",
    "regulatory":           "regulatory_update",
    "trust-center":         "trust_center",
    "webhooks":             "webhook",
    "users":                "user",
    "tenants":              "tenant",
    "subscriptions":        "subscription",
    "data":                 "data_import_export",
    "reports":              "report",
}

# Map method + path tail → action verb
def _derive_action(method: str, path: str) -> str:
    tail = path.rstrip("/").split("/")[-1].lower()
    if method == "DELETE":
        if tail == "reject":
            return "reject"
        return "delete"
    if method == "POST":
        if tail in ("approve", "submit", "accept", "close", "resolve"):
            return tail
        if tail in ("import-mitre", "fetch-news", "import", "export"):
            return tail.replace("-", "_")
        if tail == "quantify":
            return "quantify"
        if tail == "generate":
            return "generate"
        return "create"
    if method in ("PUT", "PATCH"):
        if tail in ("approve", "reject", "submit", "accept", "close", "resolve"):
            return tail
        return "update"
    return method.lower()


def _entity_type_from_path(path: str) -> str:
    parts = path.strip("/").split("/")
    # /api/v1/<resource>/...
    if len(parts) >= 3:
        resource = parts[2]
        return PATH_TO_ENTITY.get(resource, resource.replace("-", "_"))
    return "unknown"


def _entity_id_from_path(path: str) -> str | None:
    """Extract UUID-looking segment from path."""
    parts = path.strip("/").split("/")
    for part in reversed(parts):
        if len(part) == 36 and part.count("-") == 4:
            return part
    return None


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None


# STB requires every logged operation to declare its origin: manuel / batch / API.
# The SPA identifies itself with X-GRC-Client: web-ui, corroborated against the
# User-Agent so a plain scripted call is not credited as human.
#
# Be clear about what this is worth: both signals are client-supplied, so a
# caller that deliberately sends the header AND a browser User-Agent will be
# recorded as "manual". This distinguishes ordinary automation from ordinary
# people; it is not an authentication of humanity and must not be described as
# one. What it does guarantee is the safe direction of error — anything that
# does not actively claim to be the web UI is recorded as "api", so the log
# understates human involvement rather than overstating it. The actor identity
# on every entry is the JWT subject, which is authenticated.
_BROWSER_MARKERS = ("Mozilla/", "AppleWebKit", "Gecko/", "Chrome/", "Safari/", "Firefox/", "Edg/")

# Bulk data paths are machine work regardless of who kicked them off — this is
# the "batch" STB asks to see distinguished from an interactive edit.
_BATCH_PATH_MARKERS = ("/data/import", "/data/export", "/vuln-import", "/scanner-import")


def classify_origin(request: Request) -> str:
    """manual | batch | api — see the note above on why the hint is corroborated."""
    path = request.url.path
    if any(marker in path for marker in _BATCH_PATH_MARKERS):
        return "batch"
    client_hint = (request.headers.get("x-grc-client") or "").strip().lower()
    ua = request.headers.get("user-agent") or ""
    if client_hint == "web-ui" and any(m in ua for m in _BROWSER_MARKERS):
        return "manual"
    return "api"


class ActivityLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Only log write methods
        if request.method not in LOGGED_METHODS:
            return response

        path = request.url.path

        # Skip excluded paths
        if any(re.match(p, path) for p in SKIP_PATTERNS):
            return response

        # Only log successful responses (2xx)
        if not (200 <= response.status_code < 300):
            return response

        # Extract user info from JWT
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return response

        payload = _decode_token(auth_header[7:])
        if not payload:
            return response

        user_id = payload.get("sub")
        tenant_id = payload.get("tenant_id")
        if not (user_id and tenant_id):
            return response

        action = _derive_action(request.method, path)
        entity_type = _entity_type_from_path(path)
        entity_id = _entity_id_from_path(path)
        ip = request.client.host if request.client else None

        try:
            async with AsyncSessionLocal() as db:
                await chain_and_add(db, ActivityLog(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    user_email=payload.get("email", ""),
                    action=action,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    entity_name=None,
                    details={"method": request.method, "path": path},
                    ip_address=ip,
                    origin=classify_origin(request),
                ))
        except Exception as exc:
            logger.warning("ActivityLog write failed: %s", exc)

        return response
