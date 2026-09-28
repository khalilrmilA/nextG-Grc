"""
Threat feed parsers — shared by threats.py endpoint and threat_scheduler.py.
Sources:
  1. opensourcemalware.com API  (npm / pypi / repositories / github ecosystems)
  2. CISA Known Exploited Vulnerabilities JSON
  3. SANS ISC daily RSS
"""
import hashlib
import html
import logging
import re
import xml.etree.ElementTree as ET

import httpx

from app.core.config import settings
from app.models.threat import ThreatCategory

logger = logging.getLogger(__name__)

# ── Feed text hygiene ─────────────────────────────────────────────────────────
#
# SANS ISC ships its RSS <title>/<description> with *every* punctuation mark as
# a numeric entity (``&#x3f;`` for "?", ``&#x2b;`` for "+"), sometimes encoded
# twice, and some diaries pass through a pipeline that also encoded the "#" and
# ";" of entities it had already produced — measured on the live register:
# ``&&#x23&#x3b;x26&#x3b;&#x23&#x3b;xc2&#x3b;`` for what was a UTF-8 NBSP. The
# raw strings were stored verbatim, so the Threat Library showed the entities.

# What a "#" looks like once the broken pipeline has encoded it (``&#x23&#x3b;``
# decodes to "#;"): a "#;" sitting where an entity's "#" belongs.
_BROKEN_ENTITY_HASH = re.compile(r"#;(?=(?:x[0-9a-fA-F]{1,6}|[0-9]{1,7});)")
# UTF-8 byte sequences that were decoded one byte per character ("â€œ" for a
# curly quote, "Â\xa0" for an NBSP) — what numeric entities of raw bytes turn
# into, since HTML maps &#x80;..&#x9f; to their Windows-1252 characters.
def _byte_char(b: int) -> str:
    try:
        return bytes([b]).decode("cp1252")
    except UnicodeDecodeError:
        return chr(b)   # 0x81, 0x8d, 0x8f, 0x90, 0x9d: undefined in cp1252


_CONT = "".join(sorted({_byte_char(b) for b in range(0x80, 0xC0)} | {chr(b) for b in range(0x80, 0xC0)}))
_CONT_CLASS = "[" + re.escape(_CONT) + "]"
_MOJIBAKE = re.compile(
    "[\xc2-\xdf]" + _CONT_CLASS
    + "|[\xe0-\xef]" + _CONT_CLASS + "{2}"
    + "|[\xf0-\xf4]" + _CONT_CLASS + "{3}"
)
# Real HTML tags only. OSM payload notes contain literal placeholders such as
# "a DNS lookup for <identifier>.example.co", which a generic "<[^>]+>" strip
# would silently delete.
_HTML_TAG = re.compile(
    r"</?(?:a|abbr|b|blockquote|br|code|dd|div|dl|dt|em|font|h[1-6]|hr|i|img|li|ol|p|pre|"
    r"s|small|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul)\b[^<>]*/?>",
    re.IGNORECASE,
)
_BLOCK_TAG = re.compile(r"</?(?:br|p|div|li|tr|h[1-6]|blockquote|pre|hr)\b[^<>]*/?>", re.IGNORECASE)


def _fix_mojibake(match: re.Match) -> str:
    raw = bytearray()
    for ch in match.group(0):
        try:
            raw += ch.encode("cp1252")
        except UnicodeEncodeError:
            if ord(ch) > 0xFF:
                return match.group(0)
            raw.append(ord(ch))
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return match.group(0)


def clean_feed_text(text: str | None, *, multiline: bool = False) -> str:
    """Plain, readable text from a feed field: entities fully decoded (repeated
    until stable, since some are double-encoded), HTML tags removed, whitespace
    collapsed. ``multiline`` keeps paragraph breaks (descriptions); otherwise
    everything collapses to one line (titles). Never raises; idempotent."""
    if not text:
        return ""
    s = str(text)
    for _ in range(8):   # bounded: each pass removes one layer of encoding
        before = s
        s = _BROKEN_ENTITY_HASH.sub("#", s)
        s = html.unescape(s)
        s = _MOJIBAKE.sub(_fix_mojibake, s)
        if s == before:
            break
    s = _BLOCK_TAG.sub("\n" if multiline else " ", s)
    s = _HTML_TAG.sub("", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ").replace("\u200b", "")
    if multiline:
        s = re.sub(r"[ \t\f\v]+", " ", s)
        s = re.sub(r" *\n *", "\n", s)
        s = re.sub(r"\n{3,}", "\n\n", s)
    else:
        s = re.sub(r"\s+", " ", s)
    return s.strip()


# ── Items that are not threat intelligence ────────────────────────────────────
#
# Rule (deliberately narrow): the SANS ISC feed interleaves its daily podcast,
# "ISC Stormcast For <weekday>, <date> https://isc.sans.edu/podcastdetail/NNNN",
# with the handler diaries. A podcast episode title carries no threat content —
# the register had dozens of them. We drop an item only when its title starts
# with "ISC Stormcast" or its link is an isc.sans.edu podcast page. Diaries
# (e.g. "Scans for EncystPHP Webshell", "Microsoft Patch Tuesday") are kept,
# even when they are not strictly about an attack: judging relevance is the
# reviewer's job in the threat watch, not a keyword filter's.
_PODCAST_TITLE = re.compile(r"^\s*ISC\s+Stormcast\b", re.IGNORECASE)
_PODCAST_URL = re.compile(r"isc\.sans\.edu/podcast", re.IGNORECASE)


def is_podcast_item(title: str | None, url: str | None = None) -> bool:
    """True for a SANS ISC Stormcast podcast episode (see the rule above)."""
    t = clean_feed_text(title)
    if _PODCAST_TITLE.match(t):
        return True
    return bool(url and _PODCAST_URL.search(url) and "stormcast" in t.lower())


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

    pkg = clean_feed_text(t.get("package_name") or t.get("resource_identifier") or "")
    name = f"[{ecosystem.upper()}] {pkg}"[:500]

    parts = []
    if t.get("threat_description"):
        parts.append(clean_feed_text(t["threat_description"], multiline=True))
    if t.get("payload_description"):
        parts.append(f"Payload: {clean_feed_text(t['payload_description'], multiline=True)}")
    if tags:
        parts.append(f"Tags: {', '.join(tags)}")
    description = " | ".join(p for p in parts if p)[:1000]

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
            name = clean_feed_text(v.get("vulnerabilityName", ""))
            if not (cve and name):
                continue
            desc = (
                f"{clean_feed_text(v.get('shortDescription', ''), multiline=True)} "
                f"Required action: {clean_feed_text(v.get('requiredAction', ''))}"
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
                "kev_action": clean_feed_text(v.get("requiredAction")) or None,
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
            title = clean_feed_text(entry.findtext("title"))
            if not title:
                continue
            link = (entry.findtext("link") or "").strip() or None
            if is_podcast_item(title, link):
                continue   # a Stormcast episode, not a threat — see is_podcast_item
            items.append({
                "ref_id": "",
                "name": title[:500],
                "description": clean_feed_text(entry.findtext("description"), multiline=True)[:800],
                "url": link,
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
