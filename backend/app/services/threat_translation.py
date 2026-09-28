"""Which threats are feed-imported, and how their text reaches FR/AR users.

Feed rows in the register carry no "source" column. They are recognised by the
references the feed code gave them, measured on the live register:

* ``AUTO-<SRC>-n`` / ``auto-...`` — the old positional references (SANS, OSM);
* ``FEED-<SRC>-...`` / ``feed-...`` — stable_ref() for items without an id;
* a bare UUID with an ``[NPM] pkg``-style name — opensourcemalware.com ids;
* ``CVE-YYYY-NNNN`` — CISA KEV entries (and watch items promoted from KEV).

A tenant *can* type such a reference by hand, so any threat whose history has
a hand-made "created" entry (create_threat writes one; the watch promotion
writes one noting its feed origin) is excluded: tenant-authored text is never
machine-translated. Built-in catalogue threats are not feed rows either.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.threat import Threat
from app.models.threat_history import ThreatHistory
from app.models.threat_watch import ThreatWatchItem
from app.services.content_translation import (
    LANGS, localize_fields, translate_entities,
)
from app.services.threat_feeds import clean_feed_text, is_podcast_item

logger = logging.getLogger(__name__)

_FEED_PREFIX = re.compile(r"^(AUTO|FEED)-", re.IGNORECASE)
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
_OSM_NAME = re.compile(r"^\[(NPM|PYPI|REPOSITORIES|GITHUB)\]\s", re.IGNORECASE)
_CVE_REF = re.compile(r"^CVE-\d{4}-\d{3,}$", re.IGNORECASE)
PROMOTED_NOTE = "Promoted from the threat watch"


def looks_like_feed_threat(ref_id: str | None, name: str | None, is_builtin: bool,
                           tenant_id: str | None) -> bool:
    """The reference-shape half of the rule (no DB access)."""
    if is_builtin or not tenant_id:
        return False
    ref = (ref_id or "").strip()
    if _FEED_PREFIX.match(ref) or _CVE_REF.match(ref):
        return True
    return bool(_UUID.match(ref) and _OSM_NAME.match(name or ""))


async def feed_threat_ids(db: AsyncSession, threats: Iterable[Threat]) -> set[str]:
    """Ids of the given threats that are feed-imported (see module docstring)."""
    candidates = {
        t.id for t in threats
        if looks_like_feed_threat(t.ref_id, t.name, bool(t.is_builtin), t.tenant_id)
    }
    if not candidates:
        return candidates
    ids = list(candidates)
    for i in range(0, len(ids), 500):
        rows = (await db.execute(
            select(ThreatHistory.threat_id, ThreatHistory.note).where(
                ThreatHistory.threat_id.in_(ids[i:i + 500]), ThreatHistory.action == "created",
            )
        )).all()
        for tid, note in rows:
            if not (note or "").startswith(PROMOTED_NOTE):
                candidates.discard(tid)   # typed by a person
    return candidates


async def localize_threats(db: AsyncSession, pairs: list[tuple[Threat, object]], lang: str) -> None:
    """Swap name/description of SYSTEM threats — the built-in catalogue (MITRE,
    BQ-*), feed imports, and a tenant's adopted copy of a built-in while its
    text is unchanged — for their cached translation, in place on the response
    models. Tenant-authored threats are left untouched, and so is a threat whose
    text is already in the reader's language (a French BQ-* threat for a French
    reader). Never raises: a failure leaves the stored text."""
    if lang not in LANGS or not pairs:
        return
    try:
        feed_ids = await feed_threat_ids(db, (t for t, _ in pairs))
        chosen = [(t, out) for t, out in pairs
                  if t.is_builtin or t.id in feed_ids or getattr(t, "adopted_from_id", None)]
        await localize_fields(db, lang, [
            (out, {"name": t.name, "description": t.description or ""}) for t, out in chosen])
    except Exception as exc:   # noqa: BLE001
        logger.warning("threat localisation failed (%s): %s", lang, exc)


async def localize_watch(db: AsyncSession, pairs: list[tuple[ThreatWatchItem, object]], lang: str) -> None:
    """Same for threat-watch items (all of which are feed content)."""
    if lang not in LANGS or not pairs:
        return
    await localize_fields(db, lang, [
        (out, {"title": w.title, "summary": w.summary or ""}) for w, out in pairs])


# ── Producing translations ────────────────────────────────────────────────────

def _prepare(text: str) -> str:
    # Rows stored before the ingest cleanup still carry entities; translate the
    # readable text, while the cache key stays the stored text's hash.
    return clean_feed_text(text, multiline=True)


async def feed_threat_rows(db: AsyncSession) -> list[tuple[str, dict[str, str]]]:
    threats = (await db.execute(
        select(Threat).where(Threat.is_builtin == False, Threat.tenant_id.isnot(None))  # noqa: E712
    )).scalars().all()
    ids = await feed_threat_ids(db, threats)
    # Podcast episodes are not worth a model call (cleanup_threat_feed_text removes them).
    return [(t.id, {"name": t.name, "description": t.description or ""})
            for t in sorted(threats, key=lambda x: str(x.created_at or ""), reverse=True)
            if t.id in ids and not is_podcast_item(t.name)]


async def watch_rows(db: AsyncSession, newest: int = 2000) -> list[tuple[str, dict[str, str]]]:
    items = (await db.execute(
        select(ThreatWatchItem).order_by(ThreatWatchItem.created_at.desc()).limit(newest)
    )).scalars().all()
    return [(w.id, {"title": w.title, "summary": w.summary or ""}) for w in items
            if not is_podcast_item(w.title, w.url)]


async def translate_pending_feed_content(
    *, max_texts: int = 150, langs: Iterable[str] | None = None, include_watch: bool = True,
    client=None, session_factory=None,
) -> dict:
    """Translate feed text that has no translation yet, newest first, at most
    ``max_texts`` texts per entity type. Opens its own session. Never raises.
    Used by scripts/translate_threat_feed_items.py; the app itself relies on
    app.services.translation_worker, which covers feed content automatically."""
    stats: dict = {}
    try:
        if session_factory is None:
            from app.core.database import AsyncSessionLocal as session_factory
        async with session_factory() as db:
            rows = await feed_threat_rows(db)
            stats["threat"] = await translate_entities(
                db, "threat", rows, langs=langs, max_texts=max_texts, prepare=_prepare, client=client)
            if include_watch:
                wrows = await watch_rows(db)
                stats["threat_watch"] = await translate_entities(
                    db, "threat_watch", wrows, langs=langs, max_texts=max_texts,
                    prepare=_prepare, client=client)
    except Exception as exc:   # noqa: BLE001
        logger.warning("feed translation run failed: %s", exc)
    logger.info("feed translation run: %s", stats)
    return stats


def schedule_feed_translation(**_kwargs) -> bool:
    """Ask the background translation worker to run a cycle now (it picks up the
    rows that just arrived). A no-op in the uvicorn worker that does not own the
    loop — the owner reaches the new rows on its next cycle within minutes.
    Kept under this name for the existing callers."""
    from app.services.translation_worker import nudge
    return nudge()
