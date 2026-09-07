"""
Threat feed parsers — shared by threats.py endpoint and threat_scheduler.py.
Sources:
  1. opensourcemalware.com API  (npm / pypi / repositories / github ecosystems)
  2. CISA Known Exploited Vulnerabilities JSON
  3. SANS ISC daily RSS
"""
import hashlib
import logging
import xml.etree.ElementTree as ET

import httpx

from app.core.config import settings
from app.models.threat import ThreatCategory

logger = logging.getLogger(__name__)

def classify_item(item: dict) -> str:
    """What kind of thing a feed item is, so it can be filed where it belongs.

    The source is a reliable discriminator here — each feed produces one kind
    of thing — so this is a classification, not a guess. Falls back to "news",
    which is the safe default: news is read, never filed as a threat.
    """
    source = (item.get("source") or "").lower()
    ref = (item.get("ref_id") or "").strip().upper()

    if ref.startswith("CVE-"):
        return "cve"
    if "opensourcemalware" in source:
        return "malicious_package"
    if "kev" in source or "cisa" in source:
        return "advisory"
    if "sans" in source or "isc" in source:
        return "news"
    return "news"


def stable_ref(item: dict) -> str:
    """A reference for a feed item that means the same thing on every run.

    Items that carry their own identifier (a CVE from CISA KEV) keep it. The
    rest used to get ``AUTO-{SOURCE}-{position in this batch}``, which is not an
    identifier at all: measured on the live register, ``AUTO-SANS-2`` had been
    handed to 48 different threats across 396 rows. That broke two things at
    once — the register's references were meaningless, and the duplicate check
    that compares references matched unrelated items while missing real repeats.

    Deriving it from the item's own identity makes it stable across runs and
    across both uvicorn workers, which is what the duplicate check needs.
    """
    ref = (item.get("ref_id") or "").strip()
    if ref:
        return ref[:50]
    source = (item.get("source") or "feed")
    digest = hashlib.sha1(f"{source}|{item.get('name', '')}".encode("utf-8")).hexdigest()[:10].upper()
    return f"FEED-{source[:4].upper()}-{digest}"


OSM_BASE = "https://api.opensourcemalware.com/functions/v1"
OSM_ECOSYSTEMS = ["npm", "pypi", "repositories", "github"]

# Tags that indicate threat actor groups
ACTOR_TAGS = {
    "dprk", "lazarus", "apt", "apt28", "apt29", "apt38", "apt41",
    "cobalt-group", "fin7", "scattered-spider", "contagious-interview",
    "stardrop", "nation-state", "ransomware-gang",
}


# ── opensourcemalware.com ─────────────────────────────────────────────────────

def _osm_severity_to_impact(level: str) -> str:
    return {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}.get(
        (level or "").lower(), "medium"
    )


def _osm_item_to_dict(t: dict, ecosystem: str) -> dict:
    """Map one OSM API threat object to our internal threat dict."""
    tags: list[str] = t.get("tags") or []
    actors = [tag for tag in tags if tag.lower() in ACTOR_TAGS]
    vectors = [tag for tag in tags if tag.lower() not in ACTOR_TAGS]

    pkg = t.get("package_name") or t.get("resource_identifier") or ""
    name = f"[{ecosystem.upper()}] {pkg}"[:500]

    parts = []
    if t.get("threat_description"):
        parts.append(t["threat_description"])
    if t.get("payload_description"):
        parts.append(f"Payload: {t['payload_description']}")
    if tags:
        parts.append(f"Tags: {', '.join(tags)}")
    description = " | ".join(parts)[:1000]

    url = t.get("osv_advisory_url") or t.get("ghsa_advisory_url") or None

    return {
        "ref_id": t.get("id", "")[:50],
        "name": name,
        "description": description,
        "url": url,
        "source": "opensourcemalware.com",
        "category": ThreatCategory.SUPPLY_CHAIN.value,
        "typical_threat_actors": actors,
        "typical_attack_vectors": vectors[:6],
        "severity": _osm_severity_to_impact(t.get("severity_level", "")),
    }


async def _fetch_osm(client: httpx.AsyncClient) -> list[dict]:
    """Fetch from all OSM ecosystems. Requires OPENSOURCEMALWARE API key in settings."""
    api_key = settings.OPENSOURCEMALWARE
    if not api_key:
        logger.warning("OPENSOURCEMALWARE API key not set — skipping OSM feed")
        return []

    items: list[dict] = []
    for eco in OSM_ECOSYSTEMS:
        try:
            url = f"{OSM_BASE}/query-latest?ecosystem={eco}&apikey={api_key}"
            resp = await client.get(url)
            if resp.status_code == 200:
                threats = resp.json().get("threats", [])
                items.extend(_osm_item_to_dict(t, eco) for t in threats)
                logger.debug("OSM %s: %d threats", eco, len(threats))
            else:
                logger.warning("OSM %s: HTTP %s", eco, resp.status_code)
        except Exception as exc:
            logger.warning("OSM fetch error (%s): %s", eco, exc)
    return items


# ── CISA KEV ──────────────────────────────────────────────────────────────────

async def _fetch_cisa_kev(client: httpx.AsyncClient) -> list[dict]:
    items: list[dict] = []
    try:
        url = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
        resp = await client.get(url)
        if resp.status_code != 200:
            return items
        vulns = sorted(
            resp.json().get("vulnerabilities", []),
            key=lambda v: v.get("dateAdded", ""),
            reverse=True,
        )
        for v in vulns[:30]:
            cve = v.get("cveID", "")
            name = v.get("vulnerabilityName", "")
            if not (cve and name):
                continue
            desc = (
                f"{v.get('shortDescription', '')} "
                f"Required action: {v.get('requiredAction', '')}"
            ).strip()
            items.append({
                "ref_id": cve,
                "name": name[:500],
                "description": desc[:800],
                "url": None,
                # Kept structured rather than mashed into the description: this
                # is what makes the CVE knowledge base able to say "actively
                # exploited, remediate by <date>".
                "kev_added_at": v.get("dateAdded") or None,
                "kev_due_date": v.get("dueDate") or None,
                "kev_action": (v.get("requiredAction") or "").strip() or None,
                "source": "CISA KEV",
                "category": ThreatCategory.CYBER_ATTACK.value,
                "typical_threat_actors": [v.get("vendorProject", "")],
                "typical_attack_vectors": [],
                "severity": "high",
            })
    except Exception as exc:
        logger.warning("CISA KEV fetch error: %s", exc)
    return items


# ── SANS ISC RSS ──────────────────────────────────────────────────────────────

async def _fetch_sans_isc(client: httpx.AsyncClient) -> list[dict]:
    items: list[dict] = []
    try:
        resp = await client.get("https://isc.sans.edu/rssfeed.xml")
        if resp.status_code != 200:
            return items
        root = ET.fromstring(resp.text)
        channel = root.find("channel")
        if channel is None:
            return items
        for entry in channel.findall("item")[:15]:
            title = (entry.findtext("title") or "").strip()
            if not title:
                continue
            items.append({
                "ref_id": "",
                "name": title[:500],
                "description": (entry.findtext("description") or "").strip()[:800],
                "url": (entry.findtext("link") or "").strip() or None,
                "source": "SANS ISC",
                "category": ThreatCategory.CYBER_ATTACK.value,
                "typical_threat_actors": [],
                "typical_attack_vectors": [],
                "severity": "medium",
            })
    except Exception as exc:
        logger.warning("SANS ISC fetch error: %s", exc)
    return items


# ── Combined fetch ────────────────────────────────────────────────────────────

async def fetch_all_threat_feeds() -> list[dict]:
    """Fetch all sources and return merged list of raw threat dicts."""
    async with httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": "GRC-Platform/1.0"},
    ) as client:
        osm   = await _fetch_osm(client)
        kev   = await _fetch_cisa_kev(client)
        sans  = await _fetch_sans_isc(client)

    logger.info(
        "Threat feeds: OSM=%d, CISA KEV=%d, SANS ISC=%d",
        len(osm), len(kev), len(sans),
    )
    return osm + kev + sans
