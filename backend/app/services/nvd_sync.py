"""NVD CVE sync (Elite Pack, RFP module 3).

Pulls recently-modified CVEs from the NVD REST API 2.0 and upserts them into the
CveEntry catalog. Defensive: network/parse errors are collected, never raised, so
a scheduled or manual sync degrades gracefully. Not called at import time.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.cve_entry import CveEntry

logger = logging.getLogger(__name__)

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "")).replace(tzinfo=None)
    except ValueError:
        return None


def _extract(cve: dict) -> dict:
    """Flatten one NVD CVE record into CveEntry columns (defensive)."""
    cve_id = cve.get("id", "")
    description = ""
    for d in cve.get("descriptions", []):
        if d.get("lang") == "en":
            description = d.get("value", "")
            break
    score = None
    vector = None
    metrics = cve.get("metrics", {})
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        if metrics.get(key):
            data = metrics[key][0].get("cvssData", {})
            score = data.get("baseScore")
            vector = data.get("vectorString")
            break
    cwe_ids = []
    for w in cve.get("weaknesses", []):
        for d in w.get("description", []):
            val = d.get("value", "")
            if val.startswith("CWE-") and val not in cwe_ids:
                cwe_ids.append(val)
    return {
        "cve_id": cve_id,
        "description": description,
        "cvss_score": score,
        "cvss_vector": vector,
        "cwe_ids": cwe_ids,
        "published_at": _parse_dt(cve.get("published")),
        "last_modified": _parse_dt(cve.get("lastModified")),
        "source": "NVD",
    }


async def sync_recent_cves(db: AsyncSession, days: int = 1) -> dict:
    """Upsert CVEs PUBLISHED in the last `days` days. Returns a summary dict.

    Filters by publication date (pubStartDate/pubEndDate), not last-modified — NVD
    re-scores decade-old CVEs constantly, so a lastMod window floods the catalog with
    ancient entries and never surfaces genuinely new ones. Publication date gives the
    actual latest CVEs. NVD caps a pub-date window at 120 days.
    """
    summary = {"added": 0, "updated": 0, "errors": [], "fetched": 0}
    try:
        import httpx  # lazy: keep app import safe if httpx is absent
    except ModuleNotFoundError:
        summary["errors"].append("httpx not installed")
        return summary

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=min(max(1, days), 120))
    params = {
        "pubStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000"),
        "pubEndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000"),
        "resultsPerPage": 500,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(NVD_URL, params=params)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:  # noqa: BLE001 - defensive by design
        logger.warning("nvd sync failed: %s", exc)
        summary["errors"].append(str(exc))
        return summary

    items = payload.get("vulnerabilities", [])
    summary["fetched"] = len(items)
    for item in items:
        cve = item.get("cve", {})
        fields = _extract(cve)
        if not fields["cve_id"]:
            continue
        try:
            existing = (await db.execute(
                select(CveEntry).where(CveEntry.cve_id == fields["cve_id"])
            )).scalar_one_or_none()
            if existing is None:
                db.add(CveEntry(**fields))
                summary["added"] += 1
            else:
                for k, v in fields.items():
                    setattr(existing, k, v)
                summary["updated"] += 1
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(f"{fields['cve_id']}: {exc}")
    await db.commit()
    return summary


async def _recently_synced(db: AsyncSession, hours: int = 20) -> bool:
    """True if the catalog gained a CVE within the last `hours` (a sync ran recently).

    Also serves as cross-worker coordination: once one uvicorn worker syncs and adds
    fresh CVEs, the other worker sees a recent newest-entry and skips its own run.
    """
    newest = (await db.execute(select(func.max(CveEntry.created_at)))).scalar()
    if not newest:
        return False
    if newest.tzinfo is None:
        newest = newest.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - newest).total_seconds() < hours * 3600


async def start_cve_auto_sync() -> None:
    """In-process daily NVD sync (no Redis/beat needed). Disable with ENABLE_CVE_AUTOSYNC=0.

    Wakes every 6h but only calls NVD when the catalog is stale (>20h since the newest
    entry), so it settles to roughly once a day and won't hit NVD's rate limit.
    """
    if os.getenv("ENABLE_CVE_AUTOSYNC", "1") == "0":
        logger.info("CVE auto-sync disabled via ENABLE_CVE_AUTOSYNC=0")
        return
    await asyncio.sleep(180)  # let startup settle + stagger the two workers
    logger.info("CVE auto-sync started (checks every 6h, syncs when stale)")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                if not await _recently_synced(db, hours=20):
                    res = await sync_recent_cves(db, days=3)
                    logger.info("CVE auto-sync ran: added=%s updated=%s fetched=%s",
                                res.get("added"), res.get("updated"), res.get("fetched"))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.warning("CVE auto-sync tick failed: %s", exc)
        await asyncio.sleep(6 * 3600)
