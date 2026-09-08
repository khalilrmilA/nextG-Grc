"""MITRE CWE catalog sync — the second official source behind the knowledge base.

NVD supplies the CVEs; MITRE supplies the weakness taxonomy those CVEs are
classified against. Without this, ``CveEntry.cwe_ids`` is a list of opaque codes
and the "filter by flaw type" search is a filter over strings nobody can read.

Source: the official CWE list, ``cwec_latest.xml.zip`` from cwe.mitre.org — the
same file MITRE publishes for tool vendors. It is a zipped XML catalog of ~950
weaknesses, refreshed a few times a year, so this syncs on a 30-day staleness
check rather than daily: hammering MITRE nightly for a file that changes
quarterly is rude and buys nothing.

Defensive throughout, in the same style as :mod:`app.services.nvd_sync`: every
failure is collected into the summary and never raised, so a sync that cannot
reach MITRE degrades to "catalog unchanged" instead of taking down the caller.
"""
import asyncio
import io
import logging
import os
import zipfile
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cwe_entry import CweEntry

logger = logging.getLogger(__name__)

CWE_URL = "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip"

# The catalog is ~25 MB unzipped. Cap the download so a redirect to something
# unexpected can't exhaust memory on a 2-worker box.
_MAX_ZIP_BYTES = 40 * 1024 * 1024
_MAX_XML_BYTES = 120 * 1024 * 1024


def _local(tag: str) -> str:
    """Strip the XML namespace: MITRE namespaces every element, and matching on
    the local name keeps the parser working across CWE schema versions."""
    return tag.rsplit("}", 1)[-1]


def _text(el) -> str:
    """Flatten an element's text, including the xhtml markup MITRE embeds inside
    descriptions (``<xhtml:p>``, ``<xhtml:ul>``), into a single clean string."""
    if el is None:
        return ""
    return " ".join(" ".join(el.itertext()).split())


def _child(el, name: str):
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _parse_catalog(xml_bytes: bytes) -> tuple[list[dict], str | None]:
    """Parse the CWE XML into CweEntry field dicts + the catalog version."""
    from defusedxml.ElementTree import fromstring as safe_xml_fromstring

    root = safe_xml_fromstring(xml_bytes)
    version = root.get("Version")

    weaknesses = _child(root, "Weaknesses")
    if weaknesses is None:
        return [], version

    rows: list[dict] = []
    for w in weaknesses:
        if _local(w.tag) != "Weakness":
            continue
        wid = (w.get("ID") or "").strip()
        name = (w.get("Name") or "").strip()
        if not wid or not name:
            continue

        mitigations: list[dict] = []
        mit_parent = _child(w, "Potential_Mitigations")
        if mit_parent is not None:
            for m in mit_parent:
                if _local(m.tag) != "Mitigation":
                    continue
                desc = _text(_child(m, "Description"))
                if not desc:
                    continue
                mitigations.append({
                    "phase": _text(_child(m, "Phase")) or None,
                    "strategy": _text(_child(m, "Strategy")) or None,
                    "description": desc[:2000],
                })

        capec_ids: list[str] = []
        cap_parent = _child(w, "Related_Attack_Patterns")
        if cap_parent is not None:
            for c in cap_parent:
                cid = (c.get("CAPEC_ID") or "").strip()
                if cid:
                    token = f"CAPEC-{cid}"
                    if token not in capec_ids:
                        capec_ids.append(token)

        rows.append({
            "cwe_id": f"CWE-{wid}",
            "name": name[:500],
            "description": _text(_child(w, "Description"))[:4000] or None,
            "extended_description": _text(_child(w, "Extended_Description"))[:8000] or None,
            # Cap the stored mitigations: a handful of weaknesses carry 15+, and
            # the sheet shows the first few. Keeping every one bloats the row
            # for no reader benefit.
            "mitigations": mitigations[:8],
            "capec_ids": capec_ids[:20],
            "status": (w.get("Status") or None),
            "abstraction": (w.get("Abstraction") or None),
            "catalog_version": version,
            "source": "MITRE",
        })
    return rows, version


def _unzip_and_parse(blob: bytes) -> tuple[list[dict], str | None]:
    """Unzip the downloaded archive and parse the catalog. CPU-bound and slow.

    Measured on the current catalog (CWE 4.20): 18 MB of XML, ~1.2 s of pure
    CPU. Run on the event loop that stalls every request this worker is
    serving — including the other worker's share of a 2-worker box — for the
    whole of it, so :func:`sync_cwe_catalog` hands this to a thread.

    Raises ValueError for a refused archive; the caller records the message.
    """
    if len(blob) > _MAX_ZIP_BYTES:
        raise ValueError(f"catalog archive too large ({len(blob)} bytes)")
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
        if not names:
            raise ValueError("no XML file inside the CWE archive")
        info = zf.getinfo(names[0])
        # Guard the decompressed size too — a zip bomb is small on the wire.
        if info.file_size > _MAX_XML_BYTES:
            raise ValueError(f"catalog XML too large ({info.file_size} bytes)")
        xml_bytes = zf.read(names[0])
    return _parse_catalog(xml_bytes)


async def sync_cwe_catalog(db: AsyncSession) -> dict:
    """Download and upsert the MITRE CWE catalog. Returns a summary dict."""
    summary: dict = {"added": 0, "updated": 0, "fetched": 0, "version": None, "errors": []}
    try:
        import httpx  # lazy: keep app import safe if httpx is absent
    except ModuleNotFoundError:
        summary["errors"].append("httpx not installed")
        return summary

    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            resp = await client.get(CWE_URL)
            resp.raise_for_status()
            blob = resp.content
        rows, version = await asyncio.to_thread(_unzip_and_parse, blob)
    except Exception as exc:  # noqa: BLE001 — defensive by design
        logger.warning("CWE sync failed: %s", exc)
        summary["errors"].append(str(exc))
        return summary

    summary["fetched"] = len(rows)
    summary["version"] = version
    if not rows:
        summary["errors"].append("CWE catalog parsed to zero weaknesses")
        return summary

    existing = {
        e.cwe_id: e
        for e in (await db.execute(select(CweEntry))).scalars().all()
    }
    for fields in rows:
        current = existing.get(fields["cwe_id"])
        if current is None:
            db.add(CweEntry(**fields))
            summary["added"] += 1
        else:
            for k, v in fields.items():
                setattr(current, k, v)
            summary["updated"] += 1
    await db.commit()
    logger.info("CWE sync: added=%s updated=%s version=%s",
                summary["added"], summary["updated"], version)
    return summary


async def cwe_catalog_is_stale(db: AsyncSession, days: int = 30) -> bool:
    """True when the catalog is empty or older than `days`.

    Doubles as cross-worker coordination, the same way ``nvd_sync._recently_synced``
    does: once one uvicorn worker refreshes the catalog, the other sees a recent
    timestamp and skips its own download.
    """
    if os.getenv("ENABLE_CWE_SYNC", "1") == "0":
        return False
    newest = (await db.execute(select(func.max(CweEntry.updated_at)))).scalar()
    if not newest:
        return True
    if newest.tzinfo is None:
        newest = newest.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - newest).total_seconds() > days * 86400
