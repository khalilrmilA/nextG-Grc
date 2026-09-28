"""Configurable EASM (External Attack Surface Management) connector.

EASM platforms have no common API. The admin gives the endpoint paths and how the
platform wants the API key sent, and this module works out the rest:

- **Auth** (``auth_style``): ``bearer`` (Authorization: Bearer <key>, default),
  ``header`` (``<auth_header>: <key>``, e.g. X-API-Key), ``basic``
  (api_key / api_secret) or ``query`` (``?<auth_query_param>=<key>``).
- **Where the list is**: ``results_key`` (a dotted path) if given, else the
  list at the root or under data / items / results / findings /
  vulnerabilities / issues / assets / records (one level of nesting too).
- **Pagination**: a ``next`` / ``next_url`` / ``links.next`` URL (or an RFC 5988
  ``Link: rel=next`` header) is followed when it stays on the configured host
  and passes ``_check_target``; otherwise ``page`` + ``total_pages``-style
  counters drive a ``page`` query parameter. Hard caps on pages and items.
- **Field mapping**: common synonyms per field (see ``_SYNONYMS``), overridable
  per field with ``field_map`` (dotted paths, ``cves.0`` or ``cves[0]``).
- **Asset discovery** (``discover_assets``, default on): before ingest, every
  host / domain / IP that matches no existing asset becomes a new asset, so the
  findings link to it.

Every request goes through ``scanner_connectors._check_target`` and the shared
client (timeouts, verify_ssl, no redirects). Nothing here stores or echoes the
credentials; error text is redacted by the caller.
"""
from __future__ import annotations

import ipaddress
import re
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n_messages import msg as i18n_msg
from app.services import scanner_connectors as sc
from app.services.scanner_import import (
    ParsedFinding,
    _TEXT_SEVERITY,
    _build_asset_index,
    _cvss_to_severity,
)

# ---------------------------------------------------------------------------
# Configuration schema
# ---------------------------------------------------------------------------
AUTH_STYLES = ("bearer", "header", "basic", "query")
FIELD_MAP_KEYS = (
    "title", "severity", "ref_id", "cvss", "host", "ip",
    "description", "solution", "references", "url",
)
DEFAULTS = {
    "auth_style": "bearer",
    "auth_header": "X-API-Key",
    "auth_query_param": "api_key",
    "findings_path": None,
    "assets_path": None,
    "results_key": None,
    "field_map": {},
    "discover_assets": True,
}

MAX_PAGES = 50
MAX_FINDINGS = 20_000
MAX_ASSET_ITEMS = 5_000
MAX_DISCOVERED_PER_RUN = 1_000

_HEADER_RE = re.compile(r"^[A-Za-z0-9-]{1,100}$")
_PARAM_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,100}$")
_PATH_EXPR_RE = re.compile(r"^[A-Za-z0-9_.\-\[\]@$ ]{1,200}$")
_FORBIDDEN_HEADERS = {"host", "content-length", "transfer-encoding", "connection", "cookie"}
_CVE_RE = re.compile(r"^CVE-\d{4}-\d{4,}$", re.IGNORECASE)
_CVE_SEARCH_RE = re.compile(r"CVE-\d{4}-\d{4,}", re.IGNORECASE)


def _clean_path(value, base_url: str | None, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    v = value.strip()
    if not v:
        return None
    if len(v) > 500 or any(ch.isspace() or ord(ch) < 32 for ch in v):
        raise ValueError(f"{field} must be a path without spaces (max 500 characters)")
    if v.startswith("/"):
        if v.startswith("//"):
            raise ValueError(f"{field} must start with a single '/'")
        return v
    if v.lower().startswith(("http://", "https://")):
        host = (urlparse(v).hostname or "").lower()
        base_host = (urlparse(base_url or "").hostname or "").lower()
        if not host or host != base_host:
            raise ValueError(f"{field} must be on the same host as the base URL ({base_host or 'none set'})")
        return v
    raise ValueError(f"{field} must start with '/' (e.g. /api/v1/findings) or be a full URL on the base URL's host")


def normalize_config(raw: dict | None, base_url: str | None) -> dict:
    """Validate an EASM config dict and return it with defaults filled in.

    Raises ValueError with an admin-readable message. Unknown keys are refused so
    a typo ("finding_path") fails loudly instead of being silently ignored.
    """
    raw = dict(raw or {})
    unknown = set(raw) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"Unknown EASM setting(s): {', '.join(sorted(unknown))}")
    cfg = dict(DEFAULTS)
    cfg["field_map"] = {}

    style = raw.get("auth_style")
    if style is not None:
        if not isinstance(style, str) or style.strip().lower() not in AUTH_STYLES:
            raise ValueError(f"auth_style must be one of: {', '.join(AUTH_STYLES)}")
        cfg["auth_style"] = style.strip().lower()

    header = raw.get("auth_header")
    if header not in (None, ""):
        if not isinstance(header, str) or not _HEADER_RE.match(header.strip()):
            raise ValueError("auth_header must be a header name (letters, digits and '-')")
        if header.strip().lower() in _FORBIDDEN_HEADERS:
            raise ValueError(f"auth_header cannot be '{header.strip()}'")
        cfg["auth_header"] = header.strip()

    qp = raw.get("auth_query_param")
    if qp not in (None, ""):
        if not isinstance(qp, str) or not _PARAM_RE.match(qp.strip()):
            raise ValueError("auth_query_param must be a parameter name (letters, digits, '_', '.', '-')")
        cfg["auth_query_param"] = qp.strip()

    cfg["findings_path"] = _clean_path(raw.get("findings_path"), base_url, "findings_path")
    if not cfg["findings_path"]:
        raise ValueError("findings_path is required for an EASM connector (e.g. /api/v1/findings)")
    cfg["assets_path"] = _clean_path(raw.get("assets_path"), base_url, "assets_path")

    rk = raw.get("results_key")
    if rk not in (None, ""):
        if not isinstance(rk, str) or not _PATH_EXPR_RE.match(rk.strip()):
            raise ValueError("results_key must be a key or dotted path, e.g. data.items")
        cfg["results_key"] = rk.strip()

    fm = raw.get("field_map")
    if fm not in (None, ""):
        if not isinstance(fm, dict):
            raise ValueError("field_map must be an object of field -> source key")
        bad = set(fm) - set(FIELD_MAP_KEYS)
        if bad:
            raise ValueError(f"field_map keys must be among: {', '.join(FIELD_MAP_KEYS)} (got {', '.join(sorted(bad))})")
        for k, v in fm.items():
            if v in (None, ""):
                continue
            if not isinstance(v, str) or not _PATH_EXPR_RE.match(v.strip()):
                raise ValueError(f"field_map.{k} must be a key or dotted path, e.g. asset.hostname")
            cfg["field_map"][k] = v.strip()

    da = raw.get("discover_assets")
    if da is not None:
        if not isinstance(da, bool):
            raise ValueError("discover_assets must be true or false")
        cfg["discover_assets"] = da
    return cfg


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------
def get_path(obj, path: str | None):
    """Dotted-path lookup: ``a.b``, ``cves.0``, ``cves[0]``; case-insensitive keys."""
    if obj is None or not path:
        return None
    cur = obj
    for seg in re.sub(r"\[(\d+)\]", r".\1", path).split("."):
        if seg == "":
            continue
        if isinstance(cur, list):
            if not seg.isdigit():
                return None
            i = int(seg)
            cur = cur[i] if i < len(cur) else None
        elif isinstance(cur, dict):
            if seg in cur:
                cur = cur[seg]
            else:
                low = seg.lower()
                cur = next((v for k, v in cur.items() if isinstance(k, str) and k.lower() == low), None)
        else:
            return None
        if cur is None:
            return None
    return cur


_LIST_KEYS = ("data", "items", "results", "findings", "vulnerabilities", "issues", "assets", "records")


def extract_items(payload, results_key: str | None) -> list:
    """Find the list of records in a response body."""
    if results_key:
        found = get_path(payload, results_key)
        if not isinstance(found, list):
            raise ValueError(f"results_key '{results_key}' does not point at a list in the response")
        return found
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in _LIST_KEYS:
            val = get_path(payload, key)
            if isinstance(val, list):
                return val
        for key in _LIST_KEYS:  # one level deeper: {"data": {"items": [...]}}
            val = get_path(payload, key)
            if isinstance(val, dict):
                for inner in _LIST_KEYS:
                    iv = get_path(val, inner)
                    if isinstance(iv, list):
                        return iv
        lists = [v for v in payload.values() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v)]
        if len(lists) == 1:
            return lists[0]
    raise ValueError(
        "Could not find the list of records in the EASM response — set 'Results key' "
        "(e.g. data.items) in the advanced field mapping."
    )


def _next_url(payload, response: httpx.Response) -> str | None:
    if isinstance(payload, dict):
        for path in ("next", "next_url", "nextUrl", "next_page_url", "links.next", "links.next.href",
                     "_links.next.href", "_links.next", "pagination.next", "pagination.next_url",
                     "meta.next", "meta.next_url", "paging.next"):
            val = get_path(payload, path)
            if isinstance(val, str) and val.strip():
                return val.strip()
    link = response.headers.get("link") if response is not None else None
    if link:
        for part in link.split(","):
            if 'rel="next"' in part or "rel=next" in part:
                m = re.search(r"<([^>]+)>", part)
                if m:
                    return m.group(1).strip()
    return None


def _page_counters(payload) -> tuple[int | None, int | None]:
    if not isinstance(payload, dict):
        return None, None

    def _int(paths):
        for p in paths:
            v = get_path(payload, p)
            if isinstance(v, bool):
                continue
            try:
                if v is not None and str(v).strip() != "":
                    return int(v)
            except (TypeError, ValueError):
                continue
        return None
    page = _int(("page", "current_page", "currentPage", "page_number", "meta.page", "meta.current_page",
                 "pagination.page", "pagination.current_page"))
    total = _int(("total_pages", "totalPages", "pages", "last_page", "page_count", "meta.total_pages",
                  "meta.last_page", "pagination.total_pages", "pagination.last_page", "pagination.pages"))
    return page, total


# ---------------------------------------------------------------------------
# Field auto-mapping
# ---------------------------------------------------------------------------
_SYNONYMS: dict[str, tuple[str, ...]] = {
    "title": ("title", "name", "issue", "issue_name", "vulnerability", "vulnerability_name", "summary", "finding", "check"),
    "severity": ("severity", "risk", "risk_level", "riskLevel", "priority", "level", "severity_level", "criticality", "risk_score"),
    "cve": ("cve", "cve_id", "cveId", "cves", "cve_ids", "cveIds"),
    "ref_id": ("id", "finding_id", "findingId", "issue_id", "plugin_id", "pluginId", "uid", "uuid", "key"),
    "cvss": ("cvss", "cvss_score", "cvssScore", "cvss3", "cvss_v3", "cvss3_score", "cvss_base_score", "score"),
    "host": ("host", "hostname", "domain", "fqdn", "subdomain", "asset", "asset_name", "assetName", "target", "url", "affected_url", "endpoint"),
    "ip": ("ip", "ip_address", "ipAddress", "ipv4", "address", "ips", "ip_addresses"),
    "description": ("description", "details", "detail", "long_description", "evidence"),
    "solution": ("remediation", "solution", "fix", "recommendation", "mitigation", "remediation_steps"),
    "references": ("references", "links", "urls", "reference", "see_also"),
    "url": ("url", "affected_url", "link"),
}

_EXTRA_SEVERITY = {
    "crit": "critical", "very high": "critical", "very_high": "critical", "severe": "critical",
    "hi": "high", "med": "medium", "lo": "low", "very low": "low", "very_low": "low",
    "p1": "critical", "p2": "high", "p3": "medium", "p4": "low", "p5": "informational",
    "warning": "medium", "notice": "low", "ok": "informational", "pass": "informational",
}
_PRIORITY_1_TO_5 = {1: "critical", 2: "high", 3: "medium", 4: "low", 5: "informational"}
_ASC_1_TO_5 = {1: "informational", 2: "low", 3: "medium", 4: "high", 5: "critical"}


def _first_scalar(value):
    """A list gives its first non-empty scalar; a dict its name-ish member."""
    if isinstance(value, list):
        for v in value:
            s = _first_scalar(v)
            if s not in (None, ""):
                return s
        return None
    if isinstance(value, dict):
        for k in ("name", "value", "hostname", "domain", "host", "id", "ip", "url", "score", "base_score", "label"):
            v = get_path(value, k)
            if v not in (None, "") and not isinstance(v, (dict, list)):
                return v
        return None
    return value


def _lookup(item: dict, field: str, field_map: dict) -> tuple[object, str | None]:
    """(value, source key) for a field — field_map override first, then synonyms."""
    override = field_map.get(field)
    if override:
        return get_path(item, override), override
    for key in _SYNONYMS.get(field, ()):
        val = get_path(item, key)
        if val not in (None, "", [], {}):
            return val, key
    return None, None


def normalize_severity(value, source_key: str | None = None) -> str | None:
    """Text (Critical/High/...), CVSS 0-10, 1-5 bands, 0-100 risk scores.

    A 1-5 integer is read ascending (5 = critical, Qualys-style) — except when
    it came from a ``priority`` field, where 1 is conventionally the highest.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (dict, list)):
        value = _first_scalar(value)
        if value is None:
            return None
    text = str(value).strip().lower()
    if not text:
        return None
    if text in _TEXT_SEVERITY:
        return _TEXT_SEVERITY[text]
    if text in _EXTRA_SEVERITY:
        return _EXTRA_SEVERITY[text]
    try:
        num = float(text)
    except ValueError:
        return None
    if num < 0:
        return None
    is_int = num == int(num) and "." not in text
    if is_int and 1 <= num <= 5:
        if (source_key or "").split(".")[-1].lower() == "priority":
            return _PRIORITY_1_TO_5[int(num)]
        return _ASC_1_TO_5[int(num)]
    if num <= 10:
        return _cvss_to_severity(num)
    if num <= 100:
        return _cvss_to_severity(num / 10.0)
    return None


def _to_float(value) -> float | None:
    value = _first_scalar(value) if isinstance(value, (dict, list)) else value
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(str(value).strip())
    except ValueError:
        return None
    return f if 0.0 <= f <= 10.0 else None


def _looks_like_ip(value: str | None) -> bool:
    try:
        ipaddress.ip_address((value or "").strip())
        return True
    except ValueError:
        return False


def host_from(value) -> str | None:
    """Hostname / domain from a host-ish value: strips scheme, path, port, user."""
    value = _first_scalar(value)
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if "://" in text:
        host = urlparse(text).hostname or ""
    else:
        host = text.split("/")[0].split("?")[0]
        if "@" in host:
            host = host.rsplit("@", 1)[1]
        if host.startswith("["):  # [v6]:port
            host = host[1:].split("]")[0]
        elif host.count(":") == 1:  # name:port (a bare IPv6 has several colons)
            host = host.split(":")[0]
    host = host.strip().strip(".").lower()
    if host.startswith("*."):
        host = host[2:]
    return host[:255] or None


def _strings(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [s for s in re.split(r"[\s,;]+", value) if s] if " " in value or "," in value else [value]
    if isinstance(value, list):
        out: list[str] = []
        for v in value:
            s = _first_scalar(v)
            if isinstance(s, (str, int, float)) and str(s).strip():
                out.append(str(s).strip())
        return out
    if isinstance(value, dict):
        s = _first_scalar(value)
        return [str(s)] if s not in (None, "") else []
    return [str(value)]


def map_finding(item, field_map: dict) -> tuple[ParsedFinding | None, dict]:
    """Map one EASM record to a ParsedFinding; also returns field -> source key."""
    if not isinstance(item, dict):
        return None, {}
    used: dict[str, str] = {}

    def take(field):
        val, src = _lookup(item, field, field_map)
        if src and val not in (None, "", [], {}):
            used[field] = src
        return val

    # ref_id: a CVE wins (the CVE field, a field_map'd ref_id that is a CVE, or a
    # CVE among the references); otherwise the platform's own id, prefixed.
    ref_id = None
    ref_src = None
    if field_map.get("ref_id"):
        raw = _first_scalar(get_path(item, field_map["ref_id"]))
        if raw not in (None, ""):
            ref_id, ref_src = str(raw).strip(), field_map["ref_id"]
            if _CVE_RE.match(ref_id):
                ref_id = ref_id.upper()
    else:
        cve_val, cve_src = _lookup(item, "cve", {})
        for cand in _strings(cve_val):
            if _CVE_RE.match(cand):
                ref_id, ref_src = cand.upper(), cve_src
                break
    refs_raw = take("references")
    url_val = take("url")
    references = _strings(refs_raw)
    for u in _strings(url_val):
        if u not in references:
            references.append(u)
    cves_in_refs = [m.group(0).upper() for r in references for m in [_CVE_SEARCH_RE.search(r)] if m]
    if ref_id is None and cves_in_refs:
        ref_id, ref_src = cves_in_refs[0], "references"
    if ref_id is None:
        raw_id, id_src = _lookup(item, "ref_id", {})
        raw_id = _first_scalar(raw_id)
        if raw_id not in (None, ""):
            ref_id, ref_src = str(raw_id).strip(), id_src
    if ref_id and not _CVE_RE.match(ref_id):
        ref_id = ref_id if ref_id.upper().startswith("EASM-") else f"EASM-{ref_id}"
    if ref_id:
        ref_id = ref_id[:50]
        used["ref_id"] = ref_src or "?"

    title_raw = _first_scalar(take("title"))
    title = str(title_raw).strip() if title_raw not in (None, "") else None

    cvss = _to_float(take("cvss"))
    sev_val, sev_src = _lookup(item, "severity", field_map)
    severity = normalize_severity(sev_val, sev_src)
    if severity is not None:
        used["severity"] = sev_src
    elif cvss is not None:
        severity = _cvss_to_severity(cvss)
    else:
        severity = "medium"

    host_val = take("host")
    host = host_from(host_val)
    if host is None and url_val is not None:
        host = host_from(url_val)
    ip_raw = _first_scalar(take("ip"))
    ip = str(ip_raw).strip() if ip_raw not in (None, "") else None
    if ip and not _looks_like_ip(ip):
        ip = None
    if host and _looks_like_ip(host):
        ip = ip or host
        host = None

    desc_raw = take("description")
    description = None
    if desc_raw not in (None, ""):
        description = desc_raw if isinstance(desc_raw, str) else str(_first_scalar(desc_raw) or "") or None
    sol_raw = take("solution")
    solution = None
    if sol_raw not in (None, ""):
        solution = sol_raw if isinstance(sol_raw, str) else "\n".join(_strings(sol_raw)) or None

    if not title:
        if not ref_id:
            return None, used
        title = ref_id
    return ParsedFinding(
        title=title[:500],
        ref_id=ref_id,
        description=(description or None) and description[:20000],
        severity=severity,
        cvss_score=cvss,
        host_ip=ip,
        host_name=host,
        references=references[:50],
        solution=(solution or None) and solution[:20000],
    ), used


def mapping_summary(used_list: list[dict]) -> tuple[str, bool]:
    """"title←name, severity←risk_level, host←domain" + whether a CVE field was seen."""
    order = ("title", "severity", "ref_id", "cvss", "host", "ip", "solution", "description")
    parts = []
    has_cve = False
    for f in order:
        c = Counter(u[f] for u in used_list if f in u)
        if not c:
            continue
        src = c.most_common(1)[0][0]
        parts.append(f"{f}←{src}")
    for u in used_list:
        src = (u.get("ref_id") or "").split(".")[0].split("[")[0].lower()
        if src in {s.lower() for s in _SYNONYMS["cve"]} or src == "references":
            has_cve = True
            break
    return ", ".join(parts), has_cve


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def _auth(conn, cfg) -> tuple[dict, dict, httpx.Auth | None]:
    key = (conn.api_key or "").strip()
    if not key:
        raise ValueError("EASM connector needs an API key.")
    headers = {"Accept": "application/json"}
    params: dict = {}
    auth = None
    style = cfg.get("auth_style") or "bearer"
    if style == "bearer":
        headers["Authorization"] = f"Bearer {key}"
    elif style == "header":
        headers[cfg.get("auth_header") or "X-API-Key"] = key
    elif style == "basic":
        auth = httpx.BasicAuth(key, conn.api_secret or "")
    elif style == "query":
        params[cfg.get("auth_query_param") or "api_key"] = key
    else:
        raise ValueError(f"Unknown auth_style '{style}'.")
    return headers, params, auth


def _resolve(base: str, path: str) -> str:
    if path.lower().startswith(("http://", "https://")):
        return path
    return base.rstrip("/") + path


async def _get_json(client: httpx.AsyncClient, url: str, headers, params, auth):
    await sc._check_target(url)
    r = await client.get(url, headers=headers, params=params or None, auth=auth)
    if r.status_code in (401, 403):
        raise PermissionError(
            f"The EASM platform rejected the credentials (HTTP {r.status_code}) — check the API key, "
            f"the auth style and the account's permissions."
        )
    if 300 <= r.status_code < 400:
        raise ValueError(
            f"The EASM API answered with a redirect (HTTP {r.status_code}) — use the final API URL "
            f"as base URL / path (redirects are not followed)."
        )
    if r.status_code == 404:
        raise ValueError(f"The EASM API returned 404 for {urlparse(url).path} — check the endpoint path.")
    r.raise_for_status()
    try:
        payload = r.json()
    except ValueError:
        ctype = (r.headers.get("content-type") or "unknown").split(";")[0]
        raise ValueError(
            f"The EASM API did not return JSON (HTTP {r.status_code}, content-type {ctype}) — "
            f"check the endpoint path: it must be the API, not the web interface."
        ) from None
    return payload, r


async def fetch_records(conn, cfg: dict, path: str, *, max_items: int, max_pages: int = MAX_PAGES,
                        client: httpx.AsyncClient | None = None) -> list:
    """GET ``path`` and follow pagination; returns the raw record dicts."""
    base = sc._require_base(conn, "EASM")
    base_host = (urlparse(base).hostname or "").lower()
    headers, auth_params, auth = _auth(conn, cfg)
    first_url = _resolve(base, path)
    if (urlparse(first_url).hostname or "").lower() != base_host:
        raise ValueError("EASM endpoint path must stay on the base URL's host.")

    records: list = []
    own_client = client is None
    client = client or sc._client(conn)
    try:
        url = first_url
        params = dict(auth_params)
        seen_urls: set[str] = set()
        for _ in range(max_pages):
            payload, resp = await _get_json(client, url, headers, params, auth)
            items = extract_items(payload, cfg.get("results_key"))
            records.extend(items[: max_items - len(records)])
            if len(records) >= max_items or not items:
                break
            nxt = _next_url(payload, resp)
            if nxt:
                nxt = urljoin(str(resp.url), nxt)
                if (urlparse(nxt).hostname or "").lower() != base_host:
                    raise ValueError("The EASM API returned a pagination URL on a different host; stopping.")
                if nxt in seen_urls:
                    break
                seen_urls.add(nxt)
                url, params = nxt, dict(auth_params)
                continue
            page, total = _page_counters(payload)
            if page is not None and total is not None and page < total:
                url = first_url
                params = {**auth_params, "page": page + 1}
                continue
            break
    finally:
        if own_client:
            await client.aclose()
    return records


# ---------------------------------------------------------------------------
# Adapter surface used by scanner_connectors
# ---------------------------------------------------------------------------
async def fetch_findings(conn, cfg: dict) -> tuple[list[ParsedFinding], list[dict]]:
    """Pull and map all findings; also the host records from ``assets_path``."""
    async with sc._client(conn) as client:
        raw = await fetch_records(conn, cfg, cfg["findings_path"], max_items=MAX_FINDINGS, client=client)
        asset_items: list[dict] = []
        if cfg.get("assets_path") and cfg.get("discover_assets", True):
            for item in await fetch_records(conn, cfg, cfg["assets_path"], max_items=MAX_ASSET_ITEMS, client=client):
                mapped = map_asset_item(item, cfg.get("field_map") or {})
                if mapped:
                    asset_items.append(mapped)
    findings = []
    fm = cfg.get("field_map") or {}
    for item in raw:
        f, _used = map_finding(item, fm)
        if f is not None:
            findings.append(f)
    return findings, asset_items


def map_asset_item(item, field_map: dict) -> dict | None:
    """An ``assets_path`` record -> {host, ip, kind}."""
    if isinstance(item, str):
        h = host_from(item)
        if not h:
            return None
        return {"host": None, "ip": h, "kind": None} if _looks_like_ip(h) else {"host": h, "ip": None, "kind": None}
    if not isinstance(item, dict):
        return None
    host_val, _ = _lookup(item, "host", field_map)
    if host_val is None:
        host_val = get_path(item, "name") or get_path(item, "value")
    host = host_from(host_val)
    ip_val, _ = _lookup(item, "ip", field_map)
    ip = _first_scalar(ip_val)
    ip = str(ip).strip() if ip not in (None, "") and _looks_like_ip(str(ip)) else None
    if host and _looks_like_ip(host):
        ip, host = ip or host, None
    if not host and not ip:
        return None
    kind = _first_scalar(get_path(item, "type") or get_path(item, "asset_type") or get_path(item, "kind"))
    return {"host": host, "ip": ip, "kind": str(kind).lower() if kind else None}


async def test(conn, cfg: dict, lang: str = "en") -> dict:
    """First page of findings only: auth, JSON, list location and mapping."""
    async with sc._client(conn) as client:
        raw = await fetch_records(conn, cfg, cfg["findings_path"], max_items=1000, max_pages=1, client=client)
    fm = cfg.get("field_map") or {}
    mapped = [map_finding(i, fm) for i in raw]
    findings = [f for f, _ in mapped if f is not None]
    summary, has_cve = mapping_summary([u for _, u in mapped])
    # Composed from separately translatable pieces (English output unchanged).
    msg = i18n_msg("Connected. {count} finding(s) on the first page.", lang, count=len(raw))
    if summary:
        msg += " " + i18n_msg("Mapped: {summary}", lang, summary=summary)
    notes = []
    if raw and not has_cve:
        notes.append(i18n_msg("no CVE field found", lang))
    if findings and not any(f.host_name or f.host_ip for f in findings):
        notes.append(i18n_msg("no host/IP field found — findings will not link to assets", lang))
    if raw and len(findings) < len(raw):
        notes.append(i18n_msg("{count} record(s) had no title or id and will be skipped", lang,
                          count=len(raw) - len(findings)))
    if notes:
        msg += f" ({'; '.join(notes)})"
    msg += "."
    preview = [
        {"title": f.title, "severity": f.severity, "ref_id": f.ref_id, "host": f.host_name,
         "ip": f.host_ip, "cvss": f.cvss_score}
        for f in findings[:3]
    ]
    return {"ok": True, "message": msg, "preview": preview}


# ---------------------------------------------------------------------------
# Asset discovery
# ---------------------------------------------------------------------------
def _asset_type_for(host: str | None, ip: str | None, kind: str | None) -> str:
    k = kind or ""
    if "cloud" in k or "bucket" in k:
        return "cloud_service"
    if host is None or "ip" == k or k.startswith("ip"):
        return "server"
    return "application"


async def discover_assets(db: AsyncSession, conn, findings: list[ParsedFinding],
                          asset_items: list[dict]) -> int:
    """Create an Asset for each host/domain/IP no existing asset matches.

    Uses the ingest's own asset index (name / external_id / location, lowered),
    so what is created here is exactly what ``ingest_findings`` will match. A
    hostname is looked up by name only — not by its IP, which on a CDN or
    shared hosting is common to many unrelated sites. Returns the count created.
    """
    from app.models.asset import Asset, AssetCriticality, AssetStatus, AssetType, AssetCategory

    index = await _build_asset_index(db, conn.tenant_id)
    candidates: list[tuple[str | None, str | None, str | None]] = []
    for f in findings:
        if f.host_name or f.host_ip:
            candidates.append((f.host_name, f.host_ip, None))
    for a in asset_items:
        candidates.append((a.get("host"), a.get("ip"), a.get("kind")))

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    created = 0
    for host, ip, kind in candidates:
        if created >= MAX_DISCOVERED_PER_RUN:
            break
        ident = (host or ip or "").strip()
        if not ident or ident.lower() in index:
            continue
        atype = _asset_type_for(host, ip, kind)
        asset = Asset(
            tenant_id=conn.tenant_id,
            name=ident[:255],
            asset_type=AssetType(atype),
            criticality=AssetCriticality.MEDIUM,
            description=(
                f"Discovered by EASM ({conn.name}) on {now:%Y-%m-%d}. Internet-facing "
                f"{'IP address' if host is None else 'host / domain'} reported by the external attack "
                f"surface platform. Review: assign a business owner and adjust type and criticality."
            ),
            owner_id=None,
            asset_class=AssetCategory.SUPPORT.value,
            lifecycle_state="in_use",
            status=AssetStatus.OPERATIONAL.value,
            tags=["easm", "internet-facing", "discovered"],
            integration_source="easm",
            external_id=ident[:255],
            raw_metadata={
                "discovered_by": "easm", "connector_id": conn.id, "connector_name": conn.name,
                "host": host, "ip": ip, "kind": kind, "first_seen": now.isoformat(timespec="seconds"),
            },
        )
        db.add(asset)
        index[ident.lower()] = asset.id or ""
        created += 1
    if created:
        await db.flush()
    return created
