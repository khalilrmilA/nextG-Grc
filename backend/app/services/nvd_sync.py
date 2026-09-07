"""NVD CVE sync (Elite Pack, RFP module 3).

Pulls CVEs from the NVD REST API 2.0 and upserts them into the CveEntry catalog.
Defensive: network/parse errors are collected, never raised, so a scheduled or
manual sync degrades gracefully. Not called at import time.

Two passes, because one is not enough:

* **Publication pass** (:func:`sync_recent_cves`) brings in what NVD published
  recently. Filtering on publication date rather than last-modified is
  deliberate — NVD re-scores decade-old CVEs constantly, and a lastMod window
  floods the catalog with ancient entries while never surfacing new ones.
* **Refresh pass** (:func:`refresh_known_cves`) exists because the publication
  pass alone leaves the catalog permanently hollow. NVD publishes a CVE the
  moment it is reserved and only analyses it days later, so a CVE fetched on
  its publication day arrives with no CVSS score, no vector and no CWE — and
  the publication window has moved on by the time the analysis lands, so it is
  never revisited. Measured on this catalog before the fix: 1,969 of 8,404
  entries (23%) were stuck with no score forever. The refresh pass walks the
  last-modified window and updates **only rows already in the catalog**, which
  captures the analysis without reintroducing the flood.

Both passes paginate. The previous single request with ``resultsPerPage=500``
silently truncated: NVD publishes 300-450 CVEs on a weekday, so even a one-day
window overflowed a 500-row page and the surplus was dropped without a trace.
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.cve_entry import CveEntry

logger = logging.getLogger(__name__)

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"

# NVD's documented maximum page size for this endpoint.
_PAGE_SIZE = 2000
# Hard ceiling on pages per pass, so a wide window can never turn into an
# unbounded crawl against NVD.
_MAX_PAGES = 10

# NVD asks for 6s between requests without an API key, 0.6s with one. Honour it:
# being rate-limited mid-pass is how a sync silently returns half a window.
_SLEEP_NO_KEY = 6.0
_SLEEP_WITH_KEY = 0.6


def _api_key() -> str | None:
    key = os.getenv("NVD_API_KEY", "").strip()
    return key or None


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "")).replace(tzinfo=None)
    except ValueError:
        return None


def _extract_references(cve: dict) -> list[dict]:
    """NVD reference links, kept with their tags.

    The tags are the point: NVD marks a reference "Patch", "Mitigation" or
    "Vendor Advisory", which is what lets the CVE sheet show a route to a fix
    rather than an undifferentiated list of URLs.
    """
    refs: list[dict] = []
    seen: set[str] = set()
    for r in cve.get("references", []) or []:
        url = (r.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        tags = [str(t).strip() for t in (r.get("tags") or []) if str(t).strip()]
        refs.append({"url": url[:500], "source": (r.get("source") or "")[:120] or None, "tags": tags})
        # Bound the stored list: a handful of CVEs carry 60+ references and the
        # sheet shows a fraction of them.
        if len(refs) >= 25:
            break
    # Surface the actionable ones first so a truncated render still shows a fix.
    def _rank(ref: dict) -> int:
        tags = {t.lower() for t in ref["tags"]}
        if "patch" in tags:
            return 0
        if "mitigation" in tags:
            return 1
        if "vendor advisory" in tags:
            return 2
        if "exploit" in tags:
            return 3
        return 4
    refs.sort(key=_rank)
    return refs


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
        "references": _extract_references(cve),
        "published_at": _parse_dt(cve.get("published")),
        "last_modified": _parse_dt(cve.get("lastModified")),
        "source": "NVD",
    }


async def _fetch_window(params: dict, summary: dict, max_pages: int = _MAX_PAGES) -> list[dict]:
    """Fetch every page of one NVD query window. Returns raw ``vulnerabilities`` items.

    Errors are appended to ``summary["errors"]`` and whatever was fetched so far is
    returned — a partial window is more useful than nothing, and the caller reports
    the error either way.
    """
    try:
        import httpx  # lazy: keep app import safe if httpx is absent
    except ModuleNotFoundError:
        summary["errors"].append("httpx not installed")
        return []

    key = _api_key()
    headers = {"apiKey": key} if key else {}
    pause = _SLEEP_WITH_KEY if key else _SLEEP_NO_KEY

    items: list[dict] = []
    start_index = 0
    total = None
    try:
        async with httpx.AsyncClient(timeout=60, headers=headers) as client:
            for page in range(max_pages):
                page_params = dict(params, resultsPerPage=_PAGE_SIZE, startIndex=start_index)
                resp = await client.get(NVD_URL, params=page_params)
                resp.raise_for_status()
                payload = resp.json()
                batch = payload.get("vulnerabilities", []) or []
                items.extend(batch)
                total = payload.get("totalResults", len(items))
                start_index += len(batch)
                if not batch or start_index >= total:
                    break
                if page + 1 < max_pages:
                    await asyncio.sleep(pause)
    except Exception as exc:  # noqa: BLE001 - defensive by design
        logger.warning("nvd fetch failed: %s", exc)
        summary["errors"].append(str(exc))

    if total is not None and len(items) < total:
        # Say so rather than silently returning a slice — the old code's failure
        # mode was exactly this, unreported.
        summary["errors"].append(
            f"window truncated at {len(items)}/{total} results (page cap {max_pages})"
        )
    return items


async def sync_recent_cves(db: AsyncSession, days: int = 1) -> dict:
    """Upsert CVEs PUBLISHED in the last `days` days. Returns a summary dict.

    NVD caps a publication-date window at 120 days.
    """
    summary: dict = {"added": 0, "updated": 0, "errors": [], "fetched": 0}
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=min(max(1, days), 120))
    items = await _fetch_window({
        "pubStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000"),
        "pubEndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000"),
    }, summary)

    summary["fetched"] = len(items)
    if not items:
        return summary

    parsed = [_extract(i.get("cve", {})) for i in items]
    parsed = [f for f in parsed if f["cve_id"]]
    known = await _load_existing(db, [f["cve_id"] for f in parsed])
    for fields in parsed:
        try:
            existing = known.get(fields["cve_id"])
            if existing is None:
                entry = CveEntry(**fields)
                db.add(entry)
                known[fields["cve_id"]] = entry  # a window can repeat an id
                summary["added"] += 1
            else:
                for k, v in fields.items():
                    setattr(existing, k, v)
                summary["updated"] += 1
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(f"{fields['cve_id']}: {exc}")
    await db.commit()
    return summary


async def refresh_known_cves(db: AsyncSession, days: int = 2) -> dict:
    """Re-fetch CVEs modified in the last `days` days, updating **only** entries
    already held in the catalog.

    This is what makes a CVE fetched on publication day (no score, no CWE, no
    references) eventually carry NVD's analysis. Inserts are deliberately
    skipped: the last-modified feed is dominated by re-scored historic CVEs, and
    adding those is the flood the publication-date filter exists to prevent.
    """
    summary: dict = {"refreshed": 0, "skipped": 0, "errors": [], "fetched": 0}
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=min(max(1, days), 120))
    items = await _fetch_window({
        "lastModStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000"),
        "lastModEndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000"),
    }, summary)

    summary["fetched"] = len(items)
    if not items:
        return summary

    parsed = [_extract(i.get("cve", {})) for i in items]
    parsed = [f for f in parsed if f["cve_id"]]
    known = await _load_existing(db, [f["cve_id"] for f in parsed])
    for fields in parsed:
        existing = known.get(fields["cve_id"])
        if existing is None:
            summary["skipped"] += 1
            continue
        try:
            for k, v in fields.items():
                setattr(existing, k, v)
            summary["refreshed"] += 1
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(f"{fields['cve_id']}: {exc}")
    await db.commit()
    return summary


async def _load_existing(db: AsyncSession, cve_ids: list[str]) -> dict[str, CveEntry]:
    """Load the catalog rows for `cve_ids` in one pass, chunked for SQLite.

    Chunked at 500 because SQLite's compiled variable limit is 999 on older
    builds, and a 2000-id page would blow straight past it.
    """
    found: dict[str, CveEntry] = {}
    unique = list(dict.fromkeys(cve_ids))
    for i in range(0, len(unique), 500):
        chunk = unique[i:i + 500]
        rows = (await db.execute(select(CveEntry).where(CveEntry.cve_id.in_(chunk)))).scalars().all()
        for r in rows:
            found[r.cve_id] = r
    return found


async def sync_all(db: AsyncSession, days: int = 3, refresh_days: int = 2) -> dict:
    """Publication pass + refresh pass + the MITRE CWE catalog when stale.

    This is what both the scheduled loop and the manual "Sync" button call, so
    the button does the same work the nightly job does.
    """
    published = await sync_recent_cves(db, days=days)
    refreshed = await refresh_known_cves(db, days=refresh_days)

    cwe: dict = {"skipped": True}
    try:
        from app.services.mitre_cwe_sync import cwe_catalog_is_stale, sync_cwe_catalog
        if await cwe_catalog_is_stale(db):
            cwe = await sync_cwe_catalog(db)
    except Exception as exc:  # noqa: BLE001 — CWE is enrichment; never fail the CVE sync for it
        logger.warning("CWE sync skipped: %s", exc)
        cwe = {"skipped": True, "errors": [str(exc)]}

    return {
        # Flat keys the existing UI already reads.
        "added": published["added"],
        "updated": published["updated"],
        "fetched": published["fetched"],
        "refreshed": refreshed["refreshed"],
        "errors": published["errors"] + refreshed["errors"],
        "cwe": cwe,
    }


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
                    res = await sync_all(db, days=3, refresh_days=2)
                    logger.info(
                        "CVE auto-sync ran: added=%s updated=%s refreshed=%s fetched=%s",
                        res.get("added"), res.get("updated"),
                        res.get("refreshed"), res.get("fetched"),
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.warning("CVE auto-sync tick failed: %s", exc)
        await asyncio.sleep(6 * 3600)
