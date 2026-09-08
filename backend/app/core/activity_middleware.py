"""
Activity Log Middleware — automatically logs API activity with zero per-endpoint code.

Two families of events land here:
  * every mutating request (POST / PUT / PATCH / DELETE), as before;
  * a *whitelist* of sensitive reads — "journalisation des accès": consulting an
    audit, downloading its report, downloading a piece of evidence, reading the
    trail itself. Before this, every GET returned before any logging, so
    "qui a consulté ce rapport ?" had no answer at all.

Reads are whitelisted rather than logged wholesale on purpose: the SPA issues
dozens of GETs per screen, and chaining an entry for each would both flood the
hash chain and put a second DB round-trip on the hot path of every request.
"""
import asyncio
import gzip
import json
import logging
import re
import time
from typing import NamedTuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy import text
from jose import jwt, JWTError

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

logger = logging.getLogger(__name__)

# How long the audit write may wait for the write lock before giving up.
_AUDIT_WRITE_TIMEOUT_S = 5.0

# Only log write methods
LOGGED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Paths to skip (auth noise, health, reads, OpenAPI).
#
# These apply to MUTATIONS only. A read is logged when — and only when — it
# matches READ_LOGGED below, so the activity-log entry here does not stop us
# recording who consulted the trail (that read is on the whitelist).
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

# ── Verb vocabulary ──────────────────────────────────────────────────────────
# STB asks for "journalisation des accès, des modifications et des validations".
# A trail where approving a report, closing a finding and renaming it are all
# "update" cannot answer that: the validations are not separable from ordinary
# edits. So workflow decisions get their own verb, and every verb belongs to
# exactly one category the API can filter on.
#
# ACCESS      — consultation / extraction of data (nothing changed)
# VALIDATION  — a decision by someone with the authority to take it
# CHANGE      — an ordinary content modification
ACCESS_ACTIONS = ("view", "download", "export")
VALIDATION_ACTIONS = (
    "approve", "reject", "validate", "verdict", "sign", "attest", "certify",
    "issue", "publish", "submit", "accept", "acknowledge", "revoke", "close",
    "reopen", "resolve", "waive", "escalate", "assign",
    # Verbs other modules already write with an explicit chain_and_add. They are
    # decisions, and leaving them out of the vocabulary was not neutral: the
    # eight access-review decisions in the live trail graded as "other" and were
    # unreachable from the ?category=validation filter the requirement is about.
    "auditor_verdict", "auditor_grid_verdict",
    "access_review_decision", "access_review_completed",
)
CHANGE_ACTIONS = (
    "create", "update", "delete", "restore", "archive", "import", "clone",
    "quantify", "generate", "import_mitre", "fetch_news", "sync",
    # Same reason — these are written today by access_governance, groups,
    # policies, archiving and the auditor portal.
    "upload", "purge", "link_controls", "lifecycle_change", "status_change",
    "rights_change",
    "access_review_opened", "delegation_granted", "delegation_revoked",
    "custom_role_created", "custom_role_deleted",
)

ACTION_CATEGORIES: dict[str, tuple[str, ...]] = {
    "access": ACCESS_ACTIONS,
    "validation": VALIDATION_ACTIONS,
    "change": CHANGE_ACTIONS,
}

# Every verb the platform knows how to grade. "other" is defined as its
# complement, so a module that invents a verb tomorrow is still filterable
# instead of silently invisible.
KNOWN_ACTIONS: frozenset[str] = frozenset(
    v for verbs in ACTION_CATEGORIES.values() for v in verbs
)
OTHER_CATEGORY = "other"


def action_category(action: str) -> str:
    """Which of access / validation / change a verb belongs to ('other' if new)."""
    for category, verbs in ACTION_CATEGORIES.items():
        if action in verbs:
            return category
    return OTHER_CATEGORY


# Path tails that name a decision rather than a resource. Hyphenated tails are
# normalised ("approve-report" → "approve") so a verb means the same thing
# whatever route shape a module chose.
_DECISION_TAILS: dict[str, str] = {
    "approve": "approve", "approve-report": "approve",
    "reject": "reject", "reject-report": "reject",
    "validate": "validate", "verdict": "verdict", "auditor-verdict": "verdict",
    "sign": "sign", "attest": "attest", "certify": "certify",
    "issue": "issue", "issue-report": "issue", "publish": "publish",
    "submit": "submit", "submit-report": "submit",
    "accept": "accept", "acknowledge": "acknowledge",
    "revoke": "revoke", "close": "close", "reopen": "reopen",
    "resolve": "resolve", "waive": "waive", "escalate": "escalate",
    "assign": "assign",
    "restore": "restore", "archive": "archive", "clone": "clone",
}


# Map method + path tail → action verb
def _derive_action(method: str, path: str) -> str:
    tail = path.rstrip("/").split("/")[-1].lower()
    if method == "DELETE":
        if tail == "reject":
            return "reject"
        return "delete"
    if method == "POST":
        if tail in _DECISION_TAILS:
            return _DECISION_TAILS[tail]
        if tail in ("import-mitre", "fetch-news", "import", "export"):
            return tail.replace("-", "_")
        if tail == "quantify":
            return "quantify"
        if tail == "generate":
            return "generate"
        return "create"
    if method in ("PUT", "PATCH"):
        if tail in _DECISION_TAILS:
            return _DECISION_TAILS[tail]
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


# ── Read whitelist — "journalisation des accès" ──────────────────────────────
# Every entry here is a consultation or an extraction an examiner may ask about
# by name. Two verbs are used so the question is answerable precisely:
#   view      — the record was displayed
#   download  — a file/PDF/CSV left the platform
#
# `id` / `name` named groups, when present, are used for entity_id / entity_name
# so a report type ("executive") is recorded even though it has no row of its own.
_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"


class _ReadRule(NamedTuple):
    pattern: re.Pattern[str]
    action: str
    entity_type: str


READ_LOGGED: tuple[_ReadRule, ...] = (
    # Audits: the record itself, its evidence list, and its report file.
    _ReadRule(re.compile(rf"^/api/v1/audits/(?P<id>{_UUID})$"), "view", "audit"),
    _ReadRule(re.compile(rf"^/api/v1/audits/(?P<id>{_UUID})/evidence$"), "view", "audit"),
    _ReadRule(re.compile(rf"^/api/v1/audits/(?P<id>{_UUID})/report/download$"), "download", "audit"),
    # ...and the evidence FILES themselves. Whitelisting only the list above
    # answered "who opened the evidence tab" while leaving "who took the
    # evidence out of the platform" — the question the requirement actually
    # names — untraced. The audit id is captured (not the evidence id) because
    # it is the tenant-scoped object: the file's own id is in details.path.
    _ReadRule(re.compile(rf"^/api/v1/audits/(?P<id>{_UUID})/evidence/{_UUID}/download$"),
              "download", "audit"),
    # Auditor portal: an external auditor opening a checklist is an access to
    # the tenant's compliance evidence and is recorded as such.
    _ReadRule(re.compile(rf"^/api/v1/auditor-portal/assessments/(?P<id>{_UUID})/checklist$"),
              "view", "compliance"),
    # The engagement side of the same portal. An external auditor reading the
    # organisation's audit file and pulling its evidence is the single access
    # an examiner is most likely to ask about by name.
    _ReadRule(re.compile(rf"^/api/v1/auditor-portal/audits/(?P<id>{_UUID})$"), "view", "audit"),
    _ReadRule(re.compile(rf"^/api/v1/auditor-portal/audits/(?P<id>{_UUID})/checklist$"),
              "view", "audit"),
    _ReadRule(re.compile(rf"^/api/v1/auditor-portal/audits/(?P<id>{_UUID})/evidence$"),
              "view", "audit"),
    _ReadRule(re.compile(rf"^/api/v1/auditor-portal/evidence/(?P<id>{_UUID})/download$"),
              "download", "audit_evidence"),
    # Evidence and documents leaving the platform.
    _ReadRule(re.compile(rf"^/api/v1/compliance/evidence/(?P<id>{_UUID})/download$"),
              "download", "evidence"),
    _ReadRule(re.compile(rf"^/api/v1/compliance/documents/(?P<id>{_UUID})/download$"),
              "download", "document"),
    _ReadRule(re.compile(rf"^/api/v1/compliance/files/versions/(?P<id>{_UUID})/download$"),
              "download", "file_version"),
    # The « pièces justificatives » proving a corrective action was performed.
    # Same class of artefact as the evidence above and served by the same
    # integrity path, but it was added after this whitelist was written, so the
    # one question the requirement names — who took the proof out of the
    # platform — had no answer for action-plan attachments.
    _ReadRule(re.compile(rf"^/api/v1/compliance/action-plan/attachments/(?P<id>{_UUID})/download$"),
              "download", "action_attachment"),
    # Generated reports (no row of their own — the type is the name).
    _ReadRule(re.compile(r"^/api/v1/reports/(?P<name>[a-z0-9_-]+)/generate$"), "download", "report"),
    _ReadRule(re.compile(r"^/api/v1/reports/(?P<name>[a-z0-9_-]+)/preview$"), "view", "report"),
    _ReadRule(re.compile(rf"^/api/v1/policies/(?P<id>{_UUID})/export-pdf$"), "download", "policy"),
    _ReadRule(re.compile(rf"^/api/v1/risk-cartographies/(?P<id>{_UUID})/pdf$"),
              "download", "risk_cartography"),
    _ReadRule(re.compile(r"^/api/v1/archiving/export/download$"), "download", "archive"),
    # Archived records: the snapshot payload (findings, recommendations, the
    # evidence manifest) and the archived preuves themselves. The archive is the
    # copy that outlives the live row, so consulting it is the access an
    # examiner asks about once the audit it came from has been deleted — and
    # neither route writes a trail entry of its own.
    _ReadRule(re.compile(rf"^/api/v1/archiving/(?P<id>{_UUID})/content$"), "view", "archive"),
    # GET /archiving/{id} returns ArchiveOut, and ArchiveOut carries the whole
    # `payload` — the same snapshot /content serves. Logging only /content left
    # the identical data reachable one route over with no entry at all, which is
    # not a trail an examiner can rely on.
    _ReadRule(re.compile(rf"^/api/v1/archiving/(?P<id>{_UUID})$"), "view", "archive"),
    # The evidence id is NOT constrained to a UUID: it comes from the archived
    # payload's manifest, and the free-form POST /archiving path (no entity_id)
    # lets a client write that JSON, so a manifest entry can be identified by any
    # string the download route will then match. A UUID-only pattern here meant
    # such a download served the file and recorded nothing — the one access the
    # requirement names by name. The tenant-scoped object is the ARCHIVE, so it
    # stays the captured group; the file's own id is in details.path.
    _ReadRule(re.compile(rf"^/api/v1/archiving/(?P<id>{_UUID})/evidence/[^/]+/download$"),
              "download", "archive"),
    # Not listed, deliberately: GET /reports/history/{id}/download already
    # appends its own "download" entry (reports.py) with the version number and
    # the integrity verdict. A rule here would chain a second, poorer entry for
    # the same access.
    # Bulk extraction of a whole module.
    _ReadRule(re.compile(r"^/api/v1/data/export/(?P<name>[a-z0-9_-]+)$"),
              "export", "data_import_export"),
    # Reading the trail is itself an access an examiner asks about. /actions is
    # excluded: it is a static filter catalogue fetched on page load, not data.
    _ReadRule(re.compile(r"^/api/v1/activity-log(?!/actions)(/.*)?$"), "view", "activity_log"),
)


def _match_read_rule(path: str) -> tuple[_ReadRule, re.Match[str]] | None:
    for rule in READ_LOGGED:
        m = rule.pattern.match(path)
        if m:
            return rule, m
    return None


# Repeat consultations of the same page by the same person, seconds apart, are
# one consultation. Without this a React re-render or a filter change writes a
# fresh chain entry each time and the real accesses drown in noise.
#
# In-memory and therefore per-worker (2 uvicorn workers ⇒ at most one extra
# entry per window). That is the safe direction of error for an audit trail:
# the cache can only cause a duplicate, never a missing access — and it is only
# ever consulted for `view`. A download is never suppressed.
_VIEW_DEDUPE_WINDOW_S = 30.0
_VIEW_DEDUPE_MAX_KEYS = 2000
_recent_views: dict[tuple[str, str], float] = {}


def _view_recently_logged(user_id: str, path: str) -> bool:
    now = time.monotonic()
    key = (user_id, path)
    last = _recent_views.get(key)
    if last is not None and (now - last) < _VIEW_DEDUPE_WINDOW_S:
        # The window is absolute, not sliding: the timestamp is deliberately NOT
        # refreshed here. Refreshing it would let someone reading a record every
        # 29 seconds for an hour leave a single entry behind — suppression must
        # be bounded to one window, whatever the traffic.
        return True
    if len(_recent_views) > _VIEW_DEDUPE_MAX_KEYS:
        # Crude bound rather than an LRU: dropping the cache costs a duplicate
        # entry, keeping an unbounded dict costs the worker.
        _recent_views.clear()
    _recent_views[key] = now
    return False


# ── Naming the thing that was touched ────────────────────────────────────────
# "L'audit 3f2a… a été modifié" is not traceability; "L'audit 'Revue ISO 27001
# T3' a été modifié" is. entity_name was NULL on 820 of 830 live rows because
# nothing ever filled it, so it is resolved here from the entity's own table.
#
# Only tenant-scoped tables are listed: the lookup always carries the actor's
# tenant_id, so a mistyped id can never pull a name out of another tenant.
#
# The third element is the tenant predicate. It defaults to a plain
# ``tenant_id`` column; a table that has none (audit_evidence hangs off its
# audit) supplies the scoping clause explicitly. Both are static strings from
# this map, never request input.
_TENANT_COL = "tenant_id = :tid"

_ENTITY_NAME_SOURCES: dict[str, tuple[str, str] | tuple[str, str, str]] = {
    "audit":              ("audits", "title"),
    "risk":               ("risks", "title"),
    "risk_scenario":      ("risk_scenarios", "name"),
    "risk_matrix":        ("risk_matrices", "name"),
    "policy":             ("policies", "title"),
    "vendor":             ("vendors", "name"),
    "asset":              ("assets", "name"),
    "incident":           ("incidents", "title"),
    "vulnerability":      ("vulnerabilities", "title"),
    "threat":             ("threats", "name"),
    "applied_control":    ("applied_controls", "name"),
    "framework":          ("frameworks", "name"),
    "compliance":         ("compliance_assessments", "name"),
    "security_exception": ("security_exceptions", "title"),
    "regulatory_update":  ("regulatory_updates", "title"),
    "evidence":           ("evidence", "name"),
    "user":               ("users", "email"),
    # Downloadable artefacts. Without these a "download" entry carried an id and
    # nothing else, which is the same complaint the requirement makes about
    # modifications.
    "document":           ("uploaded_documents", "file_name"),
    "file_version":       ("stored_file_versions", "file_name"),
    "risk_cartography":   ("risk_cartographies", "name"),
    "action_attachment":  ("action_item_attachments", "file_name"),
    # An ArchiveRecord has no name column — the label lives inside its JSON
    # payload, which is not portable SQL. `reason` is the next best identifier
    # and is the field the register itself displays, so a consultation reads
    # "l'archive « clôture de l'engagement PCI »" rather than a bare id.
    "archive":            ("archive_records", "reason"),
    # Same table under the entity_type the MUTATION path derives from the URL
    # ("/api/v1/archiving/..." → "archiving", while the read rules above say
    # "archive"). Without this row, creating an archive was recorded with a bare
    # id while consulting the very same record was recorded with its label.
    # A DELETE on /archiving/rules/{id} looks up a rule id here and simply finds
    # no row — the resolver's normal "no name" outcome.
    "archiving":          ("archive_records", "reason"),
    # audit_evidence has no tenant_id of its own — it is scoped through its audit.
    "audit_evidence":     ("audit_evidence", "name",
                           "audit_id IN (SELECT id FROM audits WHERE tenant_id = :tid)"),
}


async def _resolve_entity_name(db, entity_type: str, entity_id: str | None,
                               tenant_id: str) -> str | None:
    """Best-effort display name for the row this entry is about.

    Table and column come from the static map above — never from the request —
    so the interpolation below cannot carry user input into SQL.
    """
    source = _ENTITY_NAME_SOURCES.get(entity_type)
    if not source or not entity_id:
        return None
    table, column = source[0], source[1]
    scope = source[2] if len(source) > 2 else _TENANT_COL
    try:
        row = (await db.execute(
            text(f"SELECT {column} FROM {table} WHERE id = :id AND {scope}"),
            {"id": entity_id, "tid": tenant_id},
        )).first()
    except Exception:  # noqa: BLE001 — a missing table must not cost us the entry
        # A failed statement leaves the session needing a rollback; without this
        # the chained insert that follows would fail too.
        await db.rollback()
        return None
    value = row[0] if row else None
    return str(value)[:255] if value else None


async def _resolve_actor_email(db, user_id: str) -> str:
    """The actor's email, for the 96% of historical rows that had none.

    The access token carries no `email` claim, so every middleware-written entry
    was stored with user_email="" and the trail read "System did this". Resolved
    at WRITE time (never after the fact — user_email is inside the entry hash,
    so an existing row can never be corrected without breaking the chain).
    """
    try:
        row = (await db.execute(
            text("SELECT email FROM users WHERE id = :id"), {"id": user_id},
        )).first()
    except Exception:  # noqa: BLE001
        await db.rollback()
        return ""
    return str(row[0]) if row and row[0] else ""


# ── Naming what was just created ─────────────────────────────────────────────
# A create has no id in its URL, so path parsing yields nothing to identify.
# The response body has both — but buffering response bodies in a middleware is
# how production outages are made, so the gates below are deliberately narrow:
# only a `create`, only a JSON body, only when the length is known in advance
# (a streaming or file response never is), and only when it is small.
_CAPTURE_MAX_BYTES = 64 * 1024
_NAME_KEYS = ("title", "name", "ref_id", "subject", "short_name", "file_name", "email")


def _should_capture_body(action: str, response: Response) -> bool:
    if action != "create":
        return False
    if not (response.headers.get("content-type") or "").startswith("application/json"):
        return False
    raw_len = response.headers.get("content-length")
    if raw_len is None:
        return False  # chunked / streaming (AI SSE, file sends) — never buffer
    try:
        length = int(raw_len)
    except (TypeError, ValueError):
        return False
    return 0 < length <= _CAPTURE_MAX_BYTES


async def _buffer_response(response: Response) -> tuple[Response, bytes]:
    """Drain the streamed body and hand back an identical, replayable response.

    raw_headers are copied verbatim rather than through dict(): collapsing
    repeated headers (set-cookie) would silently change the response.

    This function does not raise. Once the first chunk has been pulled the
    original response can no longer be replayed, so an error while draining
    must still produce a response built from what was read — abandoning the
    drained original would send the client an empty 201 for a create that
    actually succeeded.
    """
    chunks: list[bytes] = []
    failed: Exception | None = None
    try:
        async for chunk in response.body_iterator:
            if isinstance(chunk, bytes):
                chunks.append(chunk)
    except Exception as exc:  # noqa: BLE001
        failed = exc
    body = b"".join(chunks)
    rebuilt = Response(content=body, status_code=response.status_code,
                       background=getattr(response, "background", None))
    rebuilt.raw_headers = list(response.raw_headers)
    if failed is not None:
        logger.warning("ActivityLog response drain failed: %s", failed)
        return rebuilt, b""
    return rebuilt, body


def _entity_from_body(body: bytes, response: Response) -> tuple[str | None, str | None]:
    """(id, name) of the object a create returned, or (None, None)."""
    try:
        raw = body
        if (response.headers.get("content-encoding") or "").lower() == "gzip":
            # GZipMiddleware sits *inside* this one, so anything over 1 KB
            # arrives already compressed.
            raw = gzip.decompress(body)
        data = json.loads(raw)
    except Exception:  # noqa: BLE001 — an unreadable body is simply not a name
        return None, None
    if not isinstance(data, dict):
        return None, None
    new_id = data.get("id")
    if not isinstance(new_id, str) or not (0 < len(new_id) <= 64):
        new_id = None
    name = None
    for key in _NAME_KEYS:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            name = value.strip()[:255]
            break
    return new_id, name


# Query strings are recorded (an export's filters are part of what left the
# platform) but never verbatim: some routes accept one-time tokens as params.
_REDACTED_QUERY_KEYS = ("token", "password", "secret", "key", "code", "signature")


def _safe_query(query: str) -> str | None:
    if not query:
        return None
    parts = []
    for pair in query.split("&")[:20]:
        name, _, value = pair.partition("=")
        low = name.lower()
        parts.append(f"{name}=***" if any(k in low for k in _REDACTED_QUERY_KEYS)
                     else f"{name}={value[:80]}")
    return "&".join(parts)[:500]


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

# Bulk data movement is machine work regardless of who kicked it off — this is
# the "batch" STB asks to see distinguished from an interactive edit.
#
# Matched as exact path prefixes, not loose substrings. "/vuln-import" as a
# substring also swallowed POST /vuln-import/connectors, which is a person
# configuring a scanner connection — an interactive edit reported as batch is
# a wrong answer to the requirement, not a harmless approximation.
_BATCH_PATH_PREFIXES = (
    "/api/v1/data/import",
    "/api/v1/data/export",
    "/api/v1/vuln-import/upload",
    "/api/v1/threats/import-mitre",
    "/api/v1/cve/sync",
    "/api/v1/report-builder/export",
)
# ...with one nested exception: syncing an existing connector pulls findings in
# bulk, while creating/testing that connector does not.
_BATCH_PATH_SUFFIXES = ("/sync",)


def classify_origin(request: Request) -> str:
    """manual | batch | api — see the note above on why the hint is corroborated."""
    path = request.url.path
    if path.startswith(_BATCH_PATH_PREFIXES) or path.endswith(_BATCH_PATH_SUFFIXES):
        return "batch"
    client_hint = (request.headers.get("x-grc-client") or "").strip().lower()
    ua = request.headers.get("user-agent") or ""
    if client_hint == "web-ui" and any(m in ua for m in _BROWSER_MARKERS):
        return "manual"
    return "api"


async def _prefetch_entity_name(request: Request, path: str) -> str | None:
    """Name of a row about to be deleted, read while it still exists.

    A hard delete leaves the log with an id and nothing else — "supprimé
    3f2a…" tells an examiner nothing. Only runs on DELETE (rare), bounded, and
    every failure mode is "no name", never a failed request.
    """
    entity_type = _entity_type_from_path(path)
    entity_id = _entity_id_from_path(path)
    if entity_type not in _ENTITY_NAME_SOURCES or not entity_id:
        return None
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    payload = _decode_token(auth_header[7:])
    tenant_id = (payload or {}).get("tenant_id")
    if not tenant_id:
        return None

    async def _lookup() -> str | None:
        async with AsyncSessionLocal() as db:
            return await _resolve_entity_name(db, entity_type, entity_id, tenant_id)

    try:
        return await asyncio.wait_for(_lookup(), timeout=2.0)
    except Exception:  # noqa: BLE001 — including TimeoutError
        return None


async def _record(db, *, tenant_id: str, user_id: str, user_email: str, action: str,
                  entity_type: str, entity_id: str | None, entity_name: str | None,
                  details: dict, ip: str | None, origin: str) -> None:
    """Fill in the actor and the subject, then append to the tenant's chain."""
    if not user_email:
        user_email = await _resolve_actor_email(db, user_id)
    if not entity_name:
        entity_name = await _resolve_entity_name(db, entity_type, entity_id, tenant_id)
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id,
        user_id=user_id,
        user_email=user_email,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        details=details,
        ip_address=ip,
        origin=origin,
    ))


class ActivityLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        # Decided before the handler runs: a whitelisted read is logged even
        # though it is a GET, and a delete needs its target's name while the
        # row still exists.
        read_match = _match_read_rule(path) if method == "GET" else None
        will_log = method in LOGGED_METHODS or read_match is not None
        pre_name: str | None = None
        if will_log and method == "DELETE":
            pre_name = await _prefetch_entity_name(request, path)

        response = await call_next(request)

        if not will_log:
            return response

        # Skip excluded paths (mutations only — a whitelisted read has already
        # been judged worth recording, including reads of the log itself)
        if read_match is None and any(re.match(p, path) for p in SKIP_PATTERNS):
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

        entity_name = pre_name
        if read_match is not None:
            rule, match = read_match
            action = rule.action
            entity_type = rule.entity_type
            groups = match.groupdict()
            # Only what the rule explicitly captured. Scanning the path for any
            # UUID would tag a read of /activity-log/access/audit/<id> as an
            # entry ABOUT the activity log with the audit's id — a wrong answer
            # in the one place that must not give one.
            entity_id = groups.get("id")
            entity_name = entity_name or groups.get("name")
        else:
            action = _derive_action(method, path)
            entity_type = _entity_type_from_path(path)
            entity_id = _entity_id_from_path(path)

        # Repeat consultations collapse; extractions never do.
        if action == "view" and _view_recently_logged(user_id, path):
            return response

        details: dict = {"method": method, "path": path}
        query = _safe_query(request.url.query)
        if query:
            details["query"] = query

        # A create carries its identity only in its response body.
        if _should_capture_body(action, response):
            try:
                response, body = await _buffer_response(response)
                created_id, created_name = _entity_from_body(body, response)
                entity_id = entity_id or created_id
                entity_name = entity_name or created_name
            except Exception as exc:  # noqa: BLE001
                logger.warning("ActivityLog response capture failed for %s: %s", path, exc)

        # Bounded on purpose. This opens a SECOND connection while the request's
        # own session may still hold SQLite's single write lock (get_db commits
        # at teardown, which runs after this middleware). A handler that forgets
        # to commit would otherwise wedge the request here for the full 30s busy
        # timeout — and, as seen in production, hold the lock long enough to
        # block every other write including logins.
        #
        # An audit entry is important, but never more important than the request
        # completing: a missed entry is a logged warning, a wedged worker is an
        # outage. The handlers themselves commit (see risks.py); this is the net
        # under that, not a substitute for it.
        try:
            async with AsyncSessionLocal() as db:
                await asyncio.wait_for(_record(
                    db,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    user_email=payload.get("email", ""),
                    action=action,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    entity_name=entity_name,
                    details=details,
                    ip=request.client.host if request.client else None,
                    origin=classify_origin(request),
                ), timeout=_AUDIT_WRITE_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.error(
                "ActivityLog write timed out after %ss for %s %s — the request's own "
                "session is probably still holding the write lock (missing commit in "
                "the handler). Audit entry NOT recorded.",
                _AUDIT_WRITE_TIMEOUT_S, request.method, path,
            )
        except Exception as exc:
            logger.warning("ActivityLog write failed: %s", exc)

        return response
