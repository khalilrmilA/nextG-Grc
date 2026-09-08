"""Scanner import service (Elite Pack, RFP module 3).

Parses vulnerability-scanner exports into ``Vulnerability`` rows:
- Nessus ``.nessus`` XML (parsed with defusedxml — safe against XXE/entity bombs)
- Generic CSV exports from Qualys / OpenVAS (and similar)

Findings are auto-matched to existing assets by IP / hostname where possible,
deduplicated by ``(ref_id-or-title, asset)`` against both the existing register
and within the same file, and every run writes a ``ScanJournal`` audit row.

RFP gap fix — auto-add remediation controls: "l'import de scanners ne crée que
des vulnérabilités" (scanner import only ever created Vulnerability rows, never
the resulting remediation action). When a finding carries a distinct fix
recommendation (Nessus <solution>, or a CSV solution/remediation/impact column
— see ``ParsedFinding.solution``), ``ingest_findings`` now also creates a
linked ``AppliedControl`` in ``planned`` status referencing the vulnerability
via ``AppliedControl.vulnerability_ids``. Dedup key: the *normalized*
remediation text (whitespace-collapsed, lowercased, hashed), stored on
``AppliedControl.ref_id`` as ``SCAN-REM-<hash>`` — so a re-sync of the same
scan, or a different scan recommending the identical fix, reuses the existing
control (appending the new vulnerability id) instead of creating a duplicate.
This is deliberately the simple version: one control per unique remediation
text, only for newly-imported (non-deduped) vulnerabilities in this run —
vulnerabilities skipped as duplicates in this run are not retroactively linked
to a control (their control, if any, would already exist from whichever
earlier sync first imported them).
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from defusedxml.ElementTree import fromstring as safe_xml_fromstring
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applied_control import AppliedControl, ControlStatus
from app.models.asset import Asset
from app.models.scan_journal import (
    ScanJournal,
    SCAN_STATUS_COMPLETED,
    SCAN_STATUS_FAILED,
    SCAN_STATUS_RUNNING,
)
from app.models.vulnerability import Vulnerability, VulnStatus

_REMEDIATION_KEY_PREFIX = "SCAN-REM-"


def _remediation_key(solution: str) -> str:
    """Stable dedup key for a remediation text: normalize whitespace/case, hash.

    Hashing (rather than storing the raw text) keeps the key short enough for
    AppliedControl.ref_id (VARCHAR(50)) regardless of how long the scanner's
    solution text is.
    """
    normalized = " ".join(solution.split()).strip().lower()
    return _REMEDIATION_KEY_PREFIX + hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --- Nessus severity index (0-4) -> our severity vocabulary ---
_NESSUS_SEVERITY = {
    "0": "informational",
    "1": "low",
    "2": "medium",
    "3": "high",
    "4": "critical",
}

# Qualys severity band (1-5) -> our vocabulary.
_QUALYS_SEVERITY = {1: "informational", 2: "low", 3: "medium", 4: "high", 5: "critical"}

_TEXT_SEVERITY = {
    "critical": "critical", "urgent": "critical",
    "high": "high", "important": "high",
    "medium": "medium", "moderate": "medium", "serious": "medium",
    "low": "low", "minor": "low",
    "info": "informational", "informational": "informational",
    "information": "informational", "log": "informational", "none": "informational",
}


@dataclass
class ParsedFinding:
    title: str
    ref_id: str | None = None
    description: str | None = None
    severity: str = "medium"
    cvss_score: float | None = None
    host_ip: str | None = None
    host_name: str | None = None
    references: list[str] = field(default_factory=list)
    solution: str | None = None


def _cvss_to_severity(score: float) -> str:
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    if score > 0.0:
        return "low"
    return "informational"


def _parse_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _normalize_severity(raw: str | None) -> str:
    """Best-effort map a scanner severity cell to our vocabulary.

    Handles text ("High"), Qualys 1-5 bands, and CVSS-like decimals ("7.5").
    """
    if raw is None:
        return "medium"
    raw = raw.strip().lower()
    if not raw:
        return "medium"
    if raw in _TEXT_SEVERITY:
        return _TEXT_SEVERITY[raw]
    num = _parse_float(raw)
    if num is None:
        return "medium"
    # A decimal like 7.5, or any value > 5, is a CVSS-style score.
    if "." in raw or num > 5:
        return _cvss_to_severity(num)
    # Otherwise an integer 1-5 is a Qualys-style band.
    return _QUALYS_SEVERITY.get(int(num), "medium")


# ---------------------------------------------------------------------------
# Nessus (.nessus XML)
# ---------------------------------------------------------------------------

def _looks_like_ip(value: str | None) -> bool:
    if not value:
        return False
    parts = value.split(".")
    return len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def parse_nessus(content: bytes, include_info: bool = False) -> list[ParsedFinding]:
    """Parse a Nessus v2 XML export into findings.

    ``include_info`` keeps severity-0 (informational) plugins; off by default to
    avoid importing pure host-info noise.
    """
    text = content.decode("utf-8", errors="replace") if isinstance(content, (bytes, bytearray)) else content
    root = safe_xml_fromstring(text)
    findings: list[ParsedFinding] = []

    for host in root.iter("ReportHost"):
        host_name_attr = host.get("name")
        host_ip = None
        host_fqdn = None
        netbios = None
        props = host.find("HostProperties")
        if props is not None:
            for tag in props.findall("tag"):
                name = (tag.get("name") or "").lower()
                if name == "host-ip":
                    host_ip = (tag.text or "").strip() or None
                elif name == "host-fqdn":
                    host_fqdn = (tag.text or "").strip() or None
                elif name == "netbios-name":
                    netbios = (tag.text or "").strip() or None
        if host_ip is None and _looks_like_ip(host_name_attr):
            host_ip = host_name_attr
        host_name = host_fqdn or netbios or (None if _looks_like_ip(host_name_attr) else host_name_attr)

        for item in host.iter("ReportItem"):
            sev_idx = (item.get("severity") or "0").strip()
            if sev_idx == "0" and not include_info:
                continue
            title = item.get("pluginName") or (item.findtext("synopsis") or "").strip() or "Unnamed finding"

            # CVE (may repeat) -> first; else pluginID.
            cve = None
            for cve_el in item.findall("cve"):
                if cve_el.text and cve_el.text.strip():
                    cve = cve_el.text.strip()
                    break
            ref_id = cve or item.get("pluginID")

            cvss = _parse_float(item.findtext("cvss3_base_score")) or _parse_float(item.findtext("cvss_base_score"))
            severity = _NESSUS_SEVERITY.get(sev_idx, "medium")

            description = (item.findtext("description") or item.findtext("synopsis") or "").strip() or None
            solution = (item.findtext("solution") or "").strip() or None
            refs = [ (r.text or "").strip() for r in item.findall("see_also") if r.text and r.text.strip() ]

            findings.append(ParsedFinding(
                title=title[:500],
                ref_id=(ref_id or None),
                description=description,
                severity=severity,
                cvss_score=cvss,
                host_ip=host_ip,
                host_name=host_name,
                references=refs,
                solution=solution,
            ))
    return findings


# ---------------------------------------------------------------------------
# Generic CSV (Qualys / OpenVAS / others)
# ---------------------------------------------------------------------------

_CSV_COLUMNS = {
    "host_ip": ["ip", "ip address", "host ip", "asset ip", "host"],
    "host_name": ["dns", "dns name", "fqdn", "hostname", "host name", "netbios", "asset name"],
    "title": ["title", "name", "nvt name", "vulnerability", "vuln title", "plugin name", "qid title", "summary"],
    "severity": ["severity", "risk", "threat", "qds severity", "severity level"],
    "cvss": ["cvss", "cvss score", "cvss base", "cvss base score", "cvss3", "cvss3 base", "cvss3 base score", "cvss_base_score", "cvss v3", "cvss3 score"],
    "cve": ["cve", "cve id", "cves", "cve ids"],
    "ref_id": ["qid", "plugin id", "oid", "nvt oid", "id"],
    "description": ["description", "synopsis", "threat"],
    "solution": ["solution", "remediation", "impact"],
}


def _pick(row: dict, keys: list[str]) -> str | None:
    for k in keys:
        if k in row and row[k] is not None and str(row[k]).strip():
            return str(row[k]).strip()
    return None


def parse_csv(content: bytes | str) -> list[ParsedFinding]:
    """Parse a generic scanner CSV export into findings."""
    if isinstance(content, (bytes, bytearray)):
        text = content.decode("utf-8-sig", errors="replace")
    else:
        text = content
    reader = csv.DictReader(io.StringIO(text))
    findings: list[ParsedFinding] = []
    for raw_row in reader:
        # Normalize header keys to lowercase/stripped.
        row = {(k or "").strip().lower(): v for k, v in raw_row.items() if k is not None}
        if not row:
            continue

        title = _pick(row, _CSV_COLUMNS["title"])
        cve = _pick(row, _CSV_COLUMNS["cve"])
        ref_id = cve or _pick(row, _CSV_COLUMNS["ref_id"])
        if not title and not ref_id:
            continue  # blank / structural line
        if not title:
            title = ref_id

        cvss = _parse_float(_pick(row, _CSV_COLUMNS["cvss"]))
        sev_raw = _pick(row, _CSV_COLUMNS["severity"])
        severity = _normalize_severity(sev_raw)
        if cvss is not None and not sev_raw:
            severity = _cvss_to_severity(cvss)

        # A CVE cell may hold several IDs — keep the first as ref, all as refs.
        refs: list[str] = []
        if cve:
            first = cve.replace(";", ",").split(",")[0].strip()
            ref_id = first or ref_id
            refs = [c.strip() for c in cve.replace(";", ",").split(",") if c.strip()]

        findings.append(ParsedFinding(
            title=(title or "Unnamed finding")[:500],
            ref_id=(ref_id or None),
            description=_pick(row, _CSV_COLUMNS["description"]),
            severity=severity,
            cvss_score=cvss,
            host_ip=_pick(row, _CSV_COLUMNS["host_ip"]),
            host_name=_pick(row, _CSV_COLUMNS["host_name"]),
            references=refs,
            solution=_pick(row, _CSV_COLUMNS["solution"]),
        ))
    return findings


# ---------------------------------------------------------------------------
# Asset matching + dedup + persistence
# ---------------------------------------------------------------------------

async def _build_asset_index(db: AsyncSession, tenant_id: str) -> dict[str, str]:
    """Map normalized identifiers (name / external_id / location) -> asset id.

    Columns only: a real scan import runs against the whole asset inventory and
    only ever reads these four fields, so hydrating entities (and filling the
    identity map with them) buys nothing.
    """
    result = await db.execute(
        select(Asset.id, Asset.name, Asset.external_id, Asset.location)
        .where(Asset.tenant_id == tenant_id)
    )
    index: dict[str, str] = {}
    for asset_id, name, external_id, location in result.all():
        for token in (name, external_id, location):
            if token:
                index.setdefault(token.strip().lower(), asset_id)
    return index


def _match_asset(index: dict[str, str], host_name: str | None, host_ip: str | None) -> str | None:
    for token in (host_name, host_ip):
        if token:
            hit = index.get(token.strip().lower())
            if hit:
                return hit
    return None


async def _existing_dedup_keys(db: AsyncSession, tenant_id: str) -> set[tuple[str, str | None]]:
    """Build the set of (ident, asset_id) keys already present for the tenant.

    Columns only, for the same reason as _build_asset_index: after a couple of
    real imports the register holds tens of thousands of rows, and this needs
    three fields of each — not the description and remediation text too.
    """
    result = await db.execute(
        select(Vulnerability.ref_id, Vulnerability.title, Vulnerability.affected_assets)
        .where(Vulnerability.tenant_id == tenant_id)
    )
    keys: set[tuple[str, str | None]] = set()
    for ref_id, title, affected_assets in result.all():
        ident = (ref_id or title or "").strip().lower()
        if not ident:
            continue
        assets = affected_assets or []
        if assets:
            for aid in assets:
                keys.add((ident, aid))
        else:
            keys.add((ident, None))
    return keys


async def _build_control_remediation_index(db: AsyncSession, tenant_id: str) -> dict[str, AppliedControl]:
    """Map remediation dedup key (AppliedControl.ref_id) -> existing control.

    Only controls this pipeline created (ref_id prefixed SCAN-REM-) — a
    tenant's manually-created controls are never matched/mutated here.
    """
    result = await db.execute(
        select(AppliedControl).where(
            AppliedControl.tenant_id == tenant_id,
            AppliedControl.ref_id.like(f"{_REMEDIATION_KEY_PREFIX}%"),
        )
    )
    return {c.ref_id: c for c in result.scalars().all() if c.ref_id}


def _parse_findings(tool: str, filename: str | None, content: bytes) -> list[ParsedFinding]:
    tool_l = (tool or "").strip().lower()
    fname = (filename or "").strip().lower()
    is_nessus = tool_l in ("nessus", "tenable") or fname.endswith(".nessus") or fname.endswith(".xml")
    if is_nessus:
        return parse_nessus(content)
    return parse_csv(content)


async def ingest_findings(
    db: AsyncSession,
    *,
    tenant_id: str,
    tool: str,
    findings: list[ParsedFinding],
    filename: str | None = None,
    created_by_id: str | None = None,
) -> ScanJournal:
    """Persist already-parsed findings (asset-match + dedup) and journal the run.

    Shared by file import and connector sync. Never raises: errors are recorded
    on the ScanJournal (status='failed', error=...).
    """
    journal = ScanJournal(
        tenant_id=tenant_id,
        tool=(tool or "csv").strip().lower(),
        filename=filename,
        started_at=_utcnow(),
        status=SCAN_STATUS_RUNNING,
        created_by_id=created_by_id,
    )
    db.add(journal)
    await db.flush()

    imported = matched = skipped = 0
    parsed = len(findings)
    try:
        asset_index = await _build_asset_index(db, tenant_id)
        seen = await _existing_dedup_keys(db, tenant_id)
        control_index = await _build_control_remediation_index(db, tenant_id)

        for f in findings:
            asset_id = _match_asset(asset_index, f.host_name, f.host_ip)
            ident = (f.ref_id or f.title or "").strip().lower()
            key = (ident, asset_id)
            if ident and key in seen:
                skipped += 1
                continue
            if ident:
                seen.add(key)

            # Generate the id up front (rather than relying on the column
            # default at flush time) so it's available immediately below to
            # link the auto-created remediation control.
            vuln_id = str(uuid.uuid4())
            system_label = f.host_name or f.host_ip
            refs = list(f.references or [])
            vuln = Vulnerability(
                id=vuln_id,
                tenant_id=tenant_id,
                ref_id=f.ref_id,
                title=f.title,
                description=f.description,
                severity=f.severity,
                status=VulnStatus.OPEN.value,
                cvss_score=f.cvss_score,
                affected_assets=[asset_id] if asset_id else [],
                affected_systems=[system_label] if system_label else [],
                remediation_plan=f.solution,
                source=journal.tool,
                references=refs,
                tags=[],
            )
            db.add(vuln)
            imported += 1
            if asset_id:
                matched += 1

            # Auto-add the remediation control this finding calls for (RFP gap
            # fix — see module docstring for the exact dedup behavior).
            solution = (f.solution or "").strip()
            if solution:
                rkey = _remediation_key(solution)
                control = control_index.get(rkey)
                if control is None:
                    control = AppliedControl(
                        tenant_id=tenant_id,
                        ref_id=rkey,
                        name=("Remediate: " + solution.splitlines()[0].strip())[:500],
                        description=solution,
                        status=ControlStatus.PLANNED.value,
                        vulnerability_ids=[vuln_id],
                    )
                    db.add(control)
                    control_index[rkey] = control
                elif vuln_id not in (control.vulnerability_ids or []):
                    control.vulnerability_ids = [*(control.vulnerability_ids or []), vuln_id]

        journal.status = SCAN_STATUS_COMPLETED
    except Exception as exc:  # noqa: BLE001 — record, don't leak a 500
        journal.status = SCAN_STATUS_FAILED
        journal.error = f"{type(exc).__name__}: {exc}"[:2000]

    journal.imported_count = imported
    journal.matched_count = matched
    journal.skipped_count = skipped
    journal.parsed_count = parsed
    journal.finished_at = _utcnow()

    await db.commit()
    await db.refresh(journal)
    return journal


async def import_scan(
    db: AsyncSession,
    *,
    tenant_id: str,
    tool: str,
    filename: str | None,
    content: bytes,
    created_by_id: str | None = None,
) -> ScanJournal:
    """Parse a scanner export file, then ingest the findings (file-import path)."""
    tool_l = (tool or "csv").strip().lower()
    try:
        # XML/CSV parsing is pure CPU over the whole upload; on the event loop it
        # stalls every other request this worker is serving. Same treatment the
        # contract text extraction in vendors.py already gets.
        findings = await asyncio.to_thread(_parse_findings, tool, filename, content)
    except Exception as exc:  # noqa: BLE001 — record a failed journal, don't 500
        journal = ScanJournal(
            tenant_id=tenant_id, tool=tool_l, filename=filename,
            started_at=_utcnow(), finished_at=_utcnow(),
            status=SCAN_STATUS_FAILED, error=f"{type(exc).__name__}: {exc}"[:2000],
            created_by_id=created_by_id,
            parsed_count=0, imported_count=0, matched_count=0, skipped_count=0,
        )
        db.add(journal)
        await db.commit()
        await db.refresh(journal)
        return journal
    return await ingest_findings(
        db, tenant_id=tenant_id, tool=tool_l, findings=findings,
        filename=filename, created_by_id=created_by_id,
    )
