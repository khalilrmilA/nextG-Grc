"""NVD CVE sync (Elite Pack, RFP module 3).

Pulls recently-modified CVEs from the NVD REST API 2.0 and upserts them into the
CveEntry catalog. Defensive: network/parse errors are collected, never raised, so
a scheduled or manual sync degrades gracefully. Not called at import time.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    """Upsert CVEs modified in the last `days` days. Returns a summary dict."""
    summary = {"added": 0, "updated": 0, "errors": [], "fetched": 0}
    try:
        import httpx  # lazy: keep app import safe if httpx is absent
    except ModuleNotFoundError:
        summary["errors"].append("httpx not installed")
        return summary

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=max(1, days))
    params = {
        "lastModStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000"),
        "lastModEndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000"),
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
