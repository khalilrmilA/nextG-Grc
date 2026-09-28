"""Scanner connector sync (Elite Pack, RFP module 3 — 'Collecte automatique').

Pulls findings from a configured scanner over its API and imports them through
the shared ingest pipeline (asset-match + dedup + ScanJournal). Adapters:

- demo    : simulated findings (matched to seeded assets) so the connector flow
            can be demonstrated without a live scanner. Clearly a simulation.
- tenable : Tenable.io REST API (X-ApiKeys) — workbench pull.
- nessus  : Nessus Professional / Manager REST API (X-ApiKeys) — completed
            scans, per-host findings, bounded plugin-detail enrichment.
- qualys  : Qualys VM API v2 (basic auth) — host detection list (XML), paged,
            with best-effort knowledgebase titles/CVEs.
- openvas : Greenbone/GVM speaks GMP over a socket, not HTTP, so there is
            nothing to pull from here — export the report and use file import.
- easm    : any External Attack Surface Management platform with a JSON REST
            API — auth style, endpoint paths and field mapping are configured
            per connector (ScannerConnectorSettings); see easm_connector.py.
            Also creates assets for newly discovered hosts/domains/IPs.

Sync never raises: fetch/import errors are recorded on the ScanJournal so the
caller returns a clean summary.

Every request is bounded (httpx timeouts, page/host/detail caps) and every
target URL — including a Qualys pagination URL handed back by the server — goes
through ``_check_target`` before a byte is sent.
"""
import asyncio
import ipaddress
import os
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from defusedxml.ElementTree import fromstring as safe_xml_fromstring

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.scan_journal import ScanJournal, SCAN_STATUS_FAILED
from sqlalchemy import select

from app.models.scanner_connector import ScannerConnector, ScannerConnectorSettings
from app.services.scanner_import import ParsedFinding, ingest_findings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# Tools whose connector can actually pull on its own. Anything else is
# file-import only, and must not be put on a schedule that can only ever fail.
PULL_TOOLS = frozenset({"demo", "tenable", "nessus", "qualys", "easm"})

_OPENVAS_MESSAGE = (
    "OpenVAS/Greenbone is reached over GMP (a socket protocol), not HTTP, so it cannot be "
    "pulled automatically. Export the report from Greenbone as XML or CSV and use "
    "'Import scanner results' instead."
)

_TIMEOUT = httpx.Timeout(45.0, connect=15.0)


# ---------------------------------------------------------------------------
# Outbound safety
# ---------------------------------------------------------------------------
def _private_targets_allowed() -> bool:
    """Whether a connector may reach a private/loopback address (default: yes).

    Scanners live on the internal network — a Nessus at 10.x:8834 is the normal
    case on the single-tenant installs this ships as. A shared deployment should
    turn it off; until config.py grows a dedicated setting this follows
    SCANNER_ALLOW_PRIVATE_TARGETS from the process environment, else the
    deployment's existing LDAP_ALLOW_PRIVATE_TARGETS answer to the same question.
    """
    raw = os.getenv("SCANNER_ALLOW_PRIVATE_TARGETS")
    if raw is not None:
        return raw.strip().lower() not in ("0", "false", "no", "off")
    return bool(getattr(settings, "LDAP_ALLOW_PRIVATE_TARGETS", True))


def _check_target_sync(url: str) -> None:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Scanner URL must start with http:// or https://.")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("Scanner URL has no host.")
    # Cloud metadata endpoints (169.254.169.254 and friends) are never a
    # scanner, whatever the deployment allows.
    if host.startswith("metadata") or (_looks_like_ip(host) and ipaddress.ip_address(host).is_link_local):
        raise ValueError("Scanner URL host is not allowed.")
    if not _private_targets_allowed():
        from fastapi import HTTPException
        from app.core.security_utils import validate_outbound_url
        try:
            validate_outbound_url(url)
        except HTTPException as exc:
            raise ValueError(f"Scanner URL rejected: {exc.detail}") from None


async def _check_target(url: str) -> None:
    # validate_outbound_url resolves DNS, which blocks — keep it off the loop.
    await asyncio.to_thread(_check_target_sync, url)


def _client(conn: ScannerConnector) -> httpx.AsyncClient:
    """One place to build the HTTP client (and the seam tests mock through).

    Redirects are not followed: a 30x to somewhere else would skip _check_target.
    """
    return httpx.AsyncClient(verify=conn.verify_ssl, timeout=_TIMEOUT, follow_redirects=False)


def _raise_for_status(r: httpx.Response, tool: str) -> None:
    """raise_for_status, with the two answers an admin can actually act on."""
    if r.status_code in (401, 403):
        raise PermissionError(f"{tool} rejected the credentials (HTTP {r.status_code}) — check the keys / account permissions.")
    r.raise_for_status()


def _describe(exc: Exception) -> str:
    """Journal/test text for an error — httpx timeouts stringify to nothing."""
    if isinstance(exc, httpx.TimeoutException):
        return f"{type(exc).__name__}: the scanner did not answer in time (check the URL, port and firewall)."
    if isinstance(exc, httpx.ConnectError):
        return f"ConnectError: could not connect to the scanner ({exc or 'connection refused'})."
    return f"{type(exc).__name__}: {exc}"


def _require_base(conn: ScannerConnector, tool: str) -> str:
    if not conn.base_url:
        raise ValueError(f"{tool} connector needs a base URL to a reachable instance.")
    return conn.base_url.strip().rstrip("/")


def _looks_like_ip(value: str | None) -> bool:
    try:
        ipaddress.ip_address((value or "").strip())
        return True
    except ValueError:
        return False


async def _gather_bounded(coros, limit: int = 5) -> list:
    """asyncio.gather with at most ``limit`` requests in flight at once."""
    sem = asyncio.Semaphore(limit)

    async def _run(c):
        async with sem:
            return await c
    return await asyncio.gather(*(_run(c) for c in coros))


# ---------------------------------------------------------------------------
# Adapters — each returns list[ParsedFinding]
# ---------------------------------------------------------------------------
def _demo_findings() -> list[ParsedFinding]:
    """Simulated pull. Hosts match seeded asset names so they auto-link."""
    return [
        ParsedFinding(title="Apache HTTP Server path traversal", ref_id="CVE-2021-41773", severity="critical", cvss_score=9.8, host_name="Internet Banking Portal", solution="Upgrade Apache to 2.4.51"),
        ParsedFinding(title="Spring4Shell remote code execution", ref_id="CVE-2022-22965", severity="critical", cvss_score=9.8, host_name="Core Banking Application", solution="Upgrade Spring Framework"),
        ParsedFinding(title="Oracle TNS listener poisoning", ref_id="CVE-2012-1675", severity="high", cvss_score=7.5, host_name="Customer Database (Oracle)", solution="Apply CPU + valid node checking"),
        ParsedFinding(title="Expired TLS certificate", ref_id="TLS-EXPIRED", severity="medium", cvss_score=5.3, host_name="SWIFT Gateway", solution="Renew the certificate"),
        ParsedFinding(title="Kerberos weak encryption (RC4)", ref_id="AD-RC4", severity="high", cvss_score=7.2, host_name="Domain Controller AD", solution="Disable RC4, enforce AES"),
    ]


_TENABLE_SEVERITY = {4: "critical", 3: "high", 2: "medium", 1: "low", 0: "informational"}


def _tenable_severity(raw) -> str:
    """Map Tenable's 0-4 index, tolerating a missing or non-numeric value.

    ``int(None)`` raises, and one such row used to abort the entire pull with a
    TypeError recorded as a failed journal — losing every other finding in the
    response over a single malformed entry.
    """
    try:
        return _TENABLE_SEVERITY.get(int(raw), "medium")
    except (TypeError, ValueError):
        return "medium"


def _x_api_keys(conn: ScannerConnector, tool: str) -> dict:
    if not (conn.api_key and conn.api_secret):
        raise ValueError(f"{tool} connector needs both an access key and a secret key.")
    return {
        "X-ApiKeys": f"accessKey={conn.api_key};secretKey={conn.api_secret}",
        "Accept": "application/json",
    }


async def _fetch_tenable(conn: ScannerConnector) -> list[ParsedFinding]:
    """Tenable.io workbenches API. Auth via X-ApiKeys (access/secret keys)."""
    headers = _x_api_keys(conn, "Tenable")
    base = (conn.base_url or "https://cloud.tenable.com").strip().rstrip("/")
    await _check_target(base)
    async with _client(conn) as client:
        r = await client.get(f"{base}/workbenches/vulnerabilities", headers=headers)
        _raise_for_status(r, "Tenable.io")
        data = r.json()
    findings: list[ParsedFinding] = []
    for v in data.get("vulnerabilities") or []:
        findings.append(ParsedFinding(
            title=(v.get("plugin_name") or "Tenable finding")[:500],
            ref_id=str(v.get("plugin_id") or "") or None,
            severity=_tenable_severity(v.get("severity")),
            cvss_score=None,
        ))
    return findings


# --- Nessus Professional / Manager -----------------------------------------
# Bounds on one pull: newest completed scans only, a host ceiling across them,
# and a ceiling on the per-plugin detail calls that supply CVE/CVSS/solution.
_NESSUS_MAX_SCANS = 20
_NESSUS_MAX_HOSTS = 1000
_NESSUS_MAX_PLUGIN_DETAILS = 200
_NESSUS_DONE = {"completed", "imported"}


async def _nessus_get(client: httpx.AsyncClient, url: str, headers: dict) -> dict:
    r = await client.get(url, headers=headers)
    if r.status_code == 412:
        # Nessus Professional answers 412 "API is not available" on editions
        # that restrict API access.
        raise PermissionError(
            "This Nessus edition does not allow API access (HTTP 412). Use Nessus Manager / "
            "Tenable.io, or export the scan as .nessus and use file import."
        )
    _raise_for_status(r, "Nessus")
    return r.json() or {}


def _nessus_plugin_details(payload: dict) -> dict:
    """Pull CVEs / CVSS / solution / description out of a plugin-detail payload."""
    attrs = (((payload.get("info") or {}).get("plugindescription") or {}).get("pluginattributes") or {})
    risk = attrs.get("risk_information") or {}
    cvss = None
    for key in ("cvss3_base_score", "cvss_base_score"):
        try:
            if risk.get(key) not in (None, ""):
                cvss = float(risk[key])
                break
        except (TypeError, ValueError):
            continue
    cves: list[str] = []
    refs = (attrs.get("ref_information") or {}).get("ref") or []
    if isinstance(refs, dict):
        refs = [refs]
    for ref in refs:
        if (ref or {}).get("name", "").lower() != "cve":
            continue
        values = ((ref.get("values") or {}).get("value")) or []
        if isinstance(values, str):
            values = [values]
        cves.extend(v.strip() for v in values if v and v.strip())
    see_also = attrs.get("see_also") or []
    if isinstance(see_also, str):
        see_also = [s for s in see_also.split() if s]
    return {
        "cves": cves,
        "cvss": cvss,
        "solution": (attrs.get("solution") or "").strip() or None,
        "description": (attrs.get("description") or attrs.get("synopsis") or "").strip() or None,
        "see_also": [s for s in see_also if isinstance(s, str)],
    }


async def _fetch_nessus(conn: ScannerConnector) -> list[ParsedFinding]:
    """Nessus REST API: latest run of each completed scan, per-host findings."""
    headers = _x_api_keys(conn, "Nessus")
    base = _require_base(conn, "Nessus")
    await _check_target(base)

    async with _client(conn) as client:
        listing = await _nessus_get(client, f"{base}/scans", headers)
        scans = [s for s in (listing.get("scans") or []) if (s.get("status") or "").lower() in _NESSUS_DONE]
        scans.sort(key=lambda s: s.get("last_modification_date") or 0, reverse=True)
        scans = scans[:_NESSUS_MAX_SCANS]

        # (scan_id, host_id, fallback hostname) for every host, capped overall.
        host_refs: list[tuple] = []
        for s in scans:
            detail = await _nessus_get(client, f"{base}/scans/{s['id']}", headers)
            for h in detail.get("hosts") or []:
                if len(host_refs) >= _NESSUS_MAX_HOSTS:
                    break
                if h.get("host_id") is not None:
                    host_refs.append((s["id"], h["host_id"], h.get("hostname")))

        host_payloads = await _gather_bounded(
            _nessus_get(client, f"{base}/scans/{sid}/hosts/{hid}", headers)
            for sid, hid, _ in host_refs
        )

        # Plugin detail is the same for every host, so fetch it once per plugin
        # (first host that reported it), within the cap.
        detail_targets: dict[int, tuple] = {}
        for (sid, hid, _), payload in zip(host_refs, host_payloads):
            for v in payload.get("vulnerabilities") or []:
                pid = v.get("plugin_id")
                if pid is None or _tenable_severity(v.get("severity")) == "informational":
                    continue
                if pid not in detail_targets and len(detail_targets) < _NESSUS_MAX_PLUGIN_DETAILS:
                    detail_targets[pid] = (sid, hid)

        async def _plugin(pid, sid, hid):
            try:
                return pid, _nessus_plugin_details(
                    await _nessus_get(client, f"{base}/scans/{sid}/hosts/{hid}/plugins/{pid}", headers)
                )
            except Exception:  # noqa: BLE001 — enrichment only; the finding stands without it
                return pid, None

        plugin_info = dict(await _gather_bounded(
            _plugin(pid, sid, hid) for pid, (sid, hid) in detail_targets.items()
        ))

    findings: list[ParsedFinding] = []
    seen: set[tuple] = set()
    for (_sid, _hid, fallback_name), payload in zip(host_refs, host_payloads):
        info = payload.get("info") or {}
        host_ip = (info.get("host-ip") or "").strip() or None
        if host_ip is None and _looks_like_ip(fallback_name):
            host_ip = fallback_name
        host_name = (
            (info.get("host-fqdn") or "").strip()
            or (info.get("netbios-name") or "").strip()
            or (None if _looks_like_ip(fallback_name) else fallback_name)
            or None
        )
        for v in payload.get("vulnerabilities") or []:
            severity = _tenable_severity(v.get("severity"))
            pid = v.get("plugin_id")
            if severity == "informational" or pid is None:
                continue  # host-info noise, same as the .nessus file import
            key = (host_ip or host_name, pid)  # same host+plugin across several scans
            if key in seen:
                continue
            seen.add(key)
            d = plugin_info.get(pid) or {}
            cves = d.get("cves") or []
            cvss = d.get("cvss")
            findings.append(ParsedFinding(
                title=(v.get("plugin_name") or f"Nessus plugin {pid}")[:500],
                ref_id=cves[0] if cves else f"NESSUS-{pid}",
                description=d.get("description"),
                severity=severity,
                cvss_score=cvss,
                host_ip=host_ip,
                host_name=host_name,
                references=[*cves, *(d.get("see_also") or [])],
                solution=d.get("solution"),
            ))
    return findings


# --- Qualys VM ---------------------------------------------------------------
_QUALYS_SEVERITY = {1: "informational", 2: "low", 3: "medium", 4: "high", 5: "critical"}
_QUALYS_MAX_PAGES = 20
_QUALYS_KB_BATCH = 300
_QUALYS_MAX_KB_CALLS = 5
_QUALYS_DETECTION_PATH = "/api/2.0/fo/asset/host/vm/detection/"


def _qualys_auth(conn: ScannerConnector) -> tuple[httpx.BasicAuth, dict]:
    if not (conn.api_key and conn.api_secret):
        raise ValueError("Qualys connector needs the API username and password.")
    return httpx.BasicAuth(conn.api_key, conn.api_secret), {"X-Requested-With": "GRCeye"}


def _qualys_severity(raw) -> str:
    try:
        return _QUALYS_SEVERITY.get(int(str(raw).strip()), "medium")
    except (TypeError, ValueError):
        return "medium"


def _qualys_xml(r: httpx.Response):
    """Parse a Qualys XML body, surfacing its SIMPLE_RETURN error text."""
    root = safe_xml_fromstring(r.content)
    if root.tag == "SIMPLE_RETURN":
        text = (root.findtext("RESPONSE/TEXT") or "").strip()
        code = (root.findtext("RESPONSE/CODE") or "").strip()
        if r.status_code >= 400 or code:
            raise ValueError(f"Qualys API error {code or r.status_code}: {text or 'no detail'}"[:300])
    return root


async def _qualys_get(client: httpx.AsyncClient, url: str, auth, headers, params=None):
    r = await client.get(url, auth=auth, headers=headers, params=params)
    if r.status_code in (401, 403):
        _raise_for_status(r, "Qualys")
    if r.status_code >= 400:
        _qualys_xml(r)  # raises with Qualys' own reason when the body carries one
        r.raise_for_status()
    return _qualys_xml(r)


def parse_qualys_detections(root) -> tuple[list[ParsedFinding], str | None]:
    """HOST_LIST_VM_DETECTION_OUTPUT -> findings, plus the next-page URL if any."""
    findings: list[ParsedFinding] = []
    for host in root.iter("HOST"):
        host_ip = (host.findtext("IP") or "").strip() or None
        host_name = (
            (host.findtext("DNS_DATA/FQDN") or "").strip()
            or (host.findtext("DNS") or "").strip()
            or (host.findtext("NETBIOS") or "").strip()
            or None
        )
        for det in host.iter("DETECTION"):
            qid = (det.findtext("QID") or "").strip()
            if not qid:
                continue
            results = (det.findtext("RESULTS") or "").strip() or None
            findings.append(ParsedFinding(
                title=f"Qualys QID {qid}",
                ref_id=f"QID-{qid}",
                description=results[:4000] if results else None,
                severity=_qualys_severity(det.findtext("SEVERITY")),
                host_ip=host_ip,
                host_name=host_name,
            ))
    next_url = None
    warning = root.find(".//WARNING")
    if warning is not None:
        next_url = (warning.findtext("URL") or "").strip() or None
    return findings, next_url


def _qualys_kb_index(root) -> dict[str, dict]:
    """KNOWLEDGE_BASE_VULN_LIST_OUTPUT -> {qid: {title, cves, solution, cvss}}."""
    out: dict[str, dict] = {}
    for vuln in root.iter("VULN"):
        qid = (vuln.findtext("QID") or "").strip()
        if not qid:
            continue
        cves = [(c.findtext("ID") or "").strip() for c in vuln.iter("CVE")]
        cvss = None
        for path in ("CVSS_V3/BASE", "CVSS/BASE"):
            try:
                val = (vuln.findtext(path) or "").strip()
                if val:
                    cvss = float(val)
                    break
            except ValueError:
                continue
        out[qid] = {
            "title": (vuln.findtext("TITLE") or "").strip() or None,
            "cves": [c for c in cves if c],
            "solution": (vuln.findtext("SOLUTION") or "").strip() or None,
            "cvss": cvss,
        }
    return out


async def _fetch_qualys(conn: ScannerConnector) -> list[ParsedFinding]:
    """Qualys VM host detection list (open detections), paged, KB-enriched."""
    auth, headers = _qualys_auth(conn)
    base = _require_base(conn, "Qualys")
    await _check_target(base)
    base_host = (urlparse(base).hostname or "").lower()

    findings: list[ParsedFinding] = []
    async with _client(conn) as client:
        url: str | None = f"{base}{_QUALYS_DETECTION_PATH}"
        params: dict | None = {
            "action": "list", "show_results": "1",
            "status": "New,Active,Re-Opened", "truncation_limit": "1000",
        }
        for _page in range(_QUALYS_MAX_PAGES):
            root = await _qualys_get(client, url, auth, headers, params)
            page, next_url = parse_qualys_detections(root)
            findings.extend(page)
            if not next_url:
                break
            # The next-page URL comes from the server: it must stay on the
            # configured platform, and pass the same target check as the base.
            if (urlparse(next_url).hostname or "").lower() != base_host:
                raise ValueError("Qualys returned a pagination URL on a different host; stopping.")
            await _check_target(next_url)
            url, params = next_url, None

        # Best-effort knowledgebase lookup: a detection carries only its QID, and
        # "Qualys QID 38170" means nothing in a register. Batched, capped, and a
        # failure (e.g. the account has no KB permission) keeps the QID titles.
        qids = sorted({f.ref_id[4:] for f in findings if f.ref_id})
        kb: dict[str, dict] = {}
        try:
            for i in range(0, min(len(qids), _QUALYS_KB_BATCH * _QUALYS_MAX_KB_CALLS), _QUALYS_KB_BATCH):
                root = await _qualys_get(
                    client, f"{base}/api/2.0/fo/knowledge_base/vuln/", auth, headers,
                    {"action": "list", "details": "All", "ids": ",".join(qids[i:i + _QUALYS_KB_BATCH])},
                )
                kb.update(_qualys_kb_index(root))
        except Exception:  # noqa: BLE001 — enrichment only
            pass

    for f in findings:
        info = kb.get(f.ref_id[4:]) if f.ref_id else None
        if not info:
            continue
        if info["title"]:
            f.title = info["title"][:500]
        f.references = list(info["cves"])
        f.solution = info["solution"]
        f.cvss_score = info["cvss"]
    return findings


async def _fetch_openvas(conn: ScannerConnector) -> list[ParsedFinding]:
    raise ValueError(_OPENVAS_MESSAGE)


_ADAPTERS = {
    "demo": lambda conn: _demo_findings(),
    "tenable": _fetch_tenable,
    "nessus": _fetch_nessus,
    "qualys": _fetch_qualys,
    "openvas": _fetch_openvas,
}


async def load_settings(db: AsyncSession, conn: ScannerConnector) -> dict | None:
    """The connector's stored non-secret config (EASM), or None."""
    row = (await db.execute(
        select(ScannerConnectorSettings.config).where(ScannerConnectorSettings.connector_id == conn.id)
    )).first()
    return dict(row[0] or {}) if row else None


def _easm_config(conn: ScannerConnector, config: dict | None) -> dict:
    from app.services.easm_connector import normalize_config
    if not config:
        raise ValueError("EASM connector is not configured: set the findings endpoint path.")
    return normalize_config(config, conn.base_url)


def _redact(text: str, conn: ScannerConnector) -> str:
    """Strip the connector's secrets out of an error text (a query-string API
    key would otherwise land in the journal via httpx's URL-bearing messages)."""
    for secret in (conn.api_key, conn.api_secret):
        if secret and len(secret) >= 4:
            text = text.replace(secret, "***")
    return text


async def _fetch_findings(conn: ScannerConnector) -> list[ParsedFinding]:
    adapter = _ADAPTERS.get((conn.tool or "").lower())
    if adapter is None:
        raise ValueError(f"Unknown scanner tool '{conn.tool}'.")
    result = adapter(conn)
    # demo adapter is sync; the rest are coroutines.
    if hasattr(result, "__await__"):
        return await result
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
async def test_connector(conn: ScannerConnector, config: dict | None = None, lang: str = "en") -> dict:
    """Authenticated connectivity check — does not import anything.

    ``config`` is the connector's stored settings (EASM only; the endpoint
    loads it with ``load_settings``). ``lang`` localises the EASM summary, which is
    composed from several sentences; the endpoint localises the other (single
    sentence) messages with ``i18n_messages.translate_text``.
    """
    tool = (conn.tool or "").lower()
    if tool == "demo":
        return {"ok": True, "message": "Demo connector ready (simulated pull)."}
    if tool == "openvas":
        return {"ok": False, "message": _OPENVAS_MESSAGE}
    try:
        if tool == "tenable":
            await _fetch_tenable(conn)  # a successful call implies valid creds
            return {"ok": True, "message": "Connected to Tenable.io."}
        if tool == "nessus":
            headers = _x_api_keys(conn, "Nessus")
            base = _require_base(conn, "Nessus")
            await _check_target(base)
            async with _client(conn) as client:
                listing = await _nessus_get(client, f"{base}/scans", headers)
            scans = listing.get("scans") or []
            done = sum(1 for s in scans if (s.get("status") or "").lower() in _NESSUS_DONE)
            return {"ok": True, "message": f"Connected to Nessus — {len(scans)} scan(s) visible, {done} completed."}
        if tool == "qualys":
            auth, headers = _qualys_auth(conn)
            base = _require_base(conn, "Qualys")
            await _check_target(base)
            async with _client(conn) as client:
                # The cheapest call that proves the exact permission a sync needs.
                await _qualys_get(
                    client, f"{base}{_QUALYS_DETECTION_PATH}", auth, headers,
                    {"action": "list", "truncation_limit": "1"},
                )
            return {"ok": True, "message": "Connected to Qualys (host detection API authorised)."}
        if tool == "easm":
            from app.services import easm_connector
            return await easm_connector.test(conn, _easm_config(conn, config), lang=lang)
        return {"ok": False, "message": f"Unknown scanner tool '{conn.tool}'."}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": _redact(_describe(exc), conn)[:400]}


async def sync_connector(db: AsyncSession, conn: ScannerConnector, created_by_id: str | None = None) -> ScanJournal:
    """Pull findings from the connector and ingest them; journal the run.

    For EASM connectors, hosts/domains/IPs that match no asset are created as
    assets first (when ``discover_assets`` is on) so the findings link to them;
    the count is recorded in the journal's filename line and returned on the
    journal object as the transient attribute ``discovered_assets``.
    """
    tool = (conn.tool or "").lower()
    asset_items: list[dict] = []
    easm_cfg: dict | None = None
    try:
        if tool == "easm":
            from app.services import easm_connector
            easm_cfg = _easm_config(conn, await load_settings(db, conn))
            findings, asset_items = await easm_connector.fetch_findings(conn, easm_cfg)
        else:
            findings = await _fetch_findings(conn)
    except Exception as exc:  # noqa: BLE001 — record a failed journal
        journal = ScanJournal(
            tenant_id=conn.tenant_id, tool=tool,
            filename=f"{conn.name} (connector sync)",
            started_at=_utcnow(), finished_at=_utcnow(),
            status=SCAN_STATUS_FAILED, error=_redact(_describe(exc), conn)[:2000],
            created_by_id=created_by_id,
            parsed_count=0, imported_count=0, matched_count=0, skipped_count=0,
        )
        db.add(journal)
        await db.commit()
        await db.refresh(journal)
        conn.last_sync_at = _utcnow()
        conn.last_status = "failed"
        await db.commit()
        return journal

    discovered = 0
    discovery_error = None
    if easm_cfg is not None and easm_cfg.get("discover_assets", True):
        from app.services import easm_connector
        try:
            # Savepoint: a failed discovery must not take the findings with it.
            async with db.begin_nested():
                discovered = await easm_connector.discover_assets(db, conn, findings, asset_items)
        except Exception as exc:  # noqa: BLE001
            discovered = 0
            discovery_error = _describe(exc)[:200]

    filename = f"{conn.name} (connector sync)"
    if discovered:
        filename = f"{conn.name} (connector sync, {discovered} new asset(s) discovered)"
    elif discovery_error:
        filename = f"{conn.name} (connector sync, asset discovery failed)"
    journal = await ingest_findings(
        db, tenant_id=conn.tenant_id, tool=tool,
        findings=findings, filename=filename[:255], created_by_id=created_by_id,
    )
    if discovery_error and not journal.error:
        journal.error = f"Asset discovery failed (findings were imported): {discovery_error}"
    conn.last_sync_at = _utcnow()
    conn.last_status = journal.status
    await db.commit()
    journal.discovered_assets = discovered
    return journal
