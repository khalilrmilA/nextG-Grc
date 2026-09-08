"""Scanner connector sync (Elite Pack, RFP module 3 — 'Collecte automatique').

Pulls findings from a configured scanner over its API and imports them through
the shared ingest pipeline (asset-match + dedup + ScanJournal). Adapters:

- demo    : simulated findings (matched to seeded assets) so the connector flow
            can be demonstrated without a live scanner. Clearly a simulation.
- tenable : Tenable.io REST API (X-ApiKeys) — real HTTP call.
- nessus  : Nessus Pro / Tenable.sc — reachable-instance required.
- qualys  : Qualys VM API — reachable-instance required.
- openvas : Greenbone/GVM speaks GMP (not HTTP); export .xml and use file import.

Sync never raises: fetch/import errors are recorded on the ScanJournal so the
caller returns a clean summary.
"""
from datetime import datetime, timezone

import httpx

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scan_journal import ScanJournal, SCAN_STATUS_FAILED
from app.models.scanner_connector import ScannerConnector
from app.services.scanner_import import ParsedFinding, ingest_findings, _cvss_to_severity


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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


async def _fetch_tenable(conn: ScannerConnector) -> list[ParsedFinding]:
    """Tenable.io workbenches API. Auth via X-ApiKeys (access/secret keys)."""
    if not (conn.api_key and conn.api_secret):
        raise ValueError("Tenable connector needs both an access key and a secret key.")
    base = (conn.base_url or "https://cloud.tenable.com").rstrip("/")
    headers = {
        "X-ApiKeys": f"accessKey={conn.api_key};secretKey={conn.api_secret}",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(verify=conn.verify_ssl, timeout=45) as client:
        r = await client.get(f"{base}/workbenches/vulnerabilities", headers=headers)
        r.raise_for_status()
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


async def _reachable(url: str, verify_ssl: bool) -> None:
    async with httpx.AsyncClient(verify=verify_ssl, timeout=15) as client:
        await client.get(url)


def _live_required(tool: str):
    async def _fetch(conn: ScannerConnector) -> list[ParsedFinding]:
        if not conn.base_url:
            raise ValueError(f"{tool} connector needs a base URL to a reachable instance.")
        # Best-effort reachability so the journal reflects the real connection state.
        await _reachable(conn.base_url, conn.verify_ssl)
        raise ValueError(
            f"Reached {conn.base_url}, but automated {tool} pull is not enabled in this build — "
            f"export the report and use file import, or use a Tenable.io connector."
        )
    return _fetch


_ADAPTERS = {
    "demo": lambda conn: _demo_findings(),
    "tenable": _fetch_tenable,
    "nessus": _live_required("Nessus"),
    "qualys": _live_required("Qualys"),
    "openvas": _live_required("OpenVAS (GMP)"),
}


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
async def test_connector(conn: ScannerConnector) -> dict:
    """Lightweight connectivity check — does not import anything."""
    tool = (conn.tool or "").lower()
    if tool == "demo":
        return {"ok": True, "message": "Demo connector ready (simulated pull)."}
    try:
        if tool == "tenable":
            await _fetch_tenable(conn)  # a successful call implies valid creds
            return {"ok": True, "message": "Connected to Tenable.io."}
        if not conn.base_url:
            return {"ok": False, "message": "A base URL is required."}
        await _reachable(conn.base_url, conn.verify_ssl)
        return {"ok": True, "message": f"Reached {conn.base_url}."}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": f"{type(exc).__name__}: {exc}"[:300]}


async def sync_connector(db: AsyncSession, conn: ScannerConnector, created_by_id: str | None = None) -> ScanJournal:
    """Pull findings from the connector and ingest them; journal the run."""
    try:
        findings = await _fetch_findings(conn)
    except Exception as exc:  # noqa: BLE001 — record a failed journal
        journal = ScanJournal(
            tenant_id=conn.tenant_id, tool=(conn.tool or "").lower(),
            filename=f"{conn.name} (connector sync)",
            started_at=_utcnow(), finished_at=_utcnow(),
            status=SCAN_STATUS_FAILED, error=f"{type(exc).__name__}: {exc}"[:2000],
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

    journal = await ingest_findings(
        db, tenant_id=conn.tenant_id, tool=(conn.tool or "").lower(),
        findings=findings, filename=f"{conn.name} (connector sync)", created_by_id=created_by_id,
    )
    conn.last_sync_at = _utcnow()
    conn.last_status = journal.status
    await db.commit()
    return journal
