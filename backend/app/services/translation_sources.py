"""Registry of the SYSTEM content that is machine-translated into en/fr/ar.

Each source says which rows to translate, which fields, what language to assume
for a text the detector cannot decide, and its priority for the background
worker (app.services.translation_worker — lower runs first). The read side
(the endpoints listed in each source's docstring) localises by text hash, so a
tenant clone whose text is still identical to the built-in shows the same
translation without anything stored for it, and an edited text simply has no
translation until the worker reaches it.

Only platform/feed content is registered. Tenant-authored text (a threat the
tenant typed, a regulatory update entered by hand, a tenant's own framework) is
never sent to the model.

Priorities:
  0  cve               — on demand only (queued by the CVE pages), never bulk
  1  threat_feed, threat_watch, regulatory_update — fresh feed content
  2  threat_builtin    — the built-in threat catalogue (MITRE + BQ-*)
  3  framework         — built-in framework names/descriptions
  4  framework_control — requirements of built-in frameworks, frameworks in use first
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

Rows = list[tuple[str, dict[str, str]]]


@dataclass(frozen=True)
class TranslationSource:
    key: str                 # registry key (status output)
    entity_type: str         # content_translations.entity_type
    priority: int
    fields: tuple[str, ...]
    rows: Callable[[AsyncSession], Awaitable[Rows]]
    default_lang: str = "en"
    on_demand: bool = False  # only rows queued in content_translation_requests
    prepare: Callable[[str], str] | None = None


# ── Threats ───────────────────────────────────────────────────────────────────

async def _threat_feed_rows(db: AsyncSession) -> Rows:
    from app.services.threat_translation import feed_threat_rows
    return await feed_threat_rows(db)


async def _threat_watch_rows(db: AsyncSession) -> Rows:
    from app.services.threat_translation import watch_rows
    return await watch_rows(db)


async def _threat_builtin_rows(db: AsyncSession) -> Rows:
    from app.models.threat import Threat
    rows = (await db.execute(
        select(Threat.id, Threat.name, Threat.description)
        .where(Threat.is_builtin == True)  # noqa: E712
        # BQ-* (the French banking catalogue) before T* (MITRE), then by ref.
        .order_by(Threat.ref_id)
    )).all()
    return [(tid, {"name": name or "", "description": desc or ""}) for tid, name, desc in rows]


def _prepare_feed(text: str) -> str:
    from app.services.threat_feeds import clean_feed_text
    return clean_feed_text(text, multiline=True)


# ── Regulatory updates ────────────────────────────────────────────────────────

_REG_NOTE_LABELS = ("AI triage rationale", "Justification du triage IA", "مبرر فرز الذكاء الاصطناعي")


def _default_regulatory_sources() -> set[str]:
    try:
        from app.api.v1.endpoints.regulatory import REGULATORY_FEEDS
        return {f["source"] for f in REGULATORY_FEEDS}
    except Exception:   # noqa: BLE001
        return {"CISA", "UK NCSC", "SANS ISC", "Krebs on Security"}


async def regulatory_feed_names(db: AsyncSession) -> dict[str, set[str]]:
    """{tenant_id: names of its configured regulatory sources} (+ "*": defaults)."""
    out: dict[str, set[str]] = {"*": _default_regulatory_sources()}
    try:
        from app.models.regulatory_feed import RegulatoryFeed
        for tid, name in (await db.execute(select(RegulatoryFeed.tenant_id, RegulatoryFeed.name))).all():
            out.setdefault(tid or "*", set()).add(name)
    except Exception:   # noqa: BLE001 — table not created yet
        await db.rollback()
    return out


def is_system_regulatory(update, feed_names: dict[str, set[str]]) -> bool:
    """Whether a regulatory update was filed by the feed fetch, not typed by a person.

    The row has no "created by" column. The feed path (regulatory._decision_to_row)
    always stores the item's URL and the source's name, and since the triage notes
    were introduced it also stores an "AI triage rationale: ..." note. A manual
    entry (POST /regulatory) has no such note and is only treated as feed content
    when it carries a URL AND names one of the organisation's configured sources —
    the shape a feed item has. Rows that match neither are never translated."""
    notes = (getattr(update, "notes", None) or "").strip()
    if notes and any(notes.startswith(label) for label in _REG_NOTE_LABELS):
        return True
    source = (getattr(update, "source", None) or "").strip()
    if not source or not (getattr(update, "url", None) or "").strip():
        return False
    return source in feed_names.get("*", set()) or source in feed_names.get(getattr(update, "tenant_id", None), set())


async def _regulatory_rows(db: AsyncSession) -> Rows:
    from app.models.regulatory_update import RegulatoryUpdate
    names = await regulatory_feed_names(db)
    ups = (await db.execute(
        select(RegulatoryUpdate).order_by(RegulatoryUpdate.created_at.desc())
    )).scalars().all()
    return [(u.id, {"title": u.title or "", "description": u.description or ""})
            for u in ups if is_system_regulatory(u, names)]


# ── Frameworks & requirements ─────────────────────────────────────────────────

async def _framework_rows(db: AsyncSession) -> Rows:
    from app.models.framework import Framework
    rows = (await db.execute(
        select(Framework.id, Framework.name, Framework.description)
        .where(Framework.is_builtin == True)  # noqa: E712
        .order_by(Framework.name)
    )).all()
    return [(fid, {"name": n or "", "description": d or ""}) for fid, n, d in rows]


async def frameworks_in_use(db: AsyncSession) -> list[str]:
    """Built-in framework ids that tenants actually read, most-used first: those
    assessed, cloned, or selected by a tenant."""
    from collections import Counter
    score: Counter = Counter()
    try:
        from app.models.compliance import ComplianceAssessment
        for (fid,) in (await db.execute(select(ComplianceAssessment.framework_id))).all():
            score[fid] += 3
    except Exception:   # noqa: BLE001
        await db.rollback()
    try:
        from app.models.framework import Framework
        for (fid,) in (await db.execute(
            select(Framework.cloned_from_framework_id).where(Framework.cloned_from_framework_id.isnot(None))
        )).all():
            score[fid] += 3
    except Exception:   # noqa: BLE001
        await db.rollback()
    try:
        from app.models.tenant import Tenant
        for (sel,) in (await db.execute(select(Tenant.selected_framework_ids))).all():
            for fid in sel or []:
                score[fid] += 1
    except Exception:   # noqa: BLE001
        await db.rollback()
    return [fid for fid, _ in score.most_common()]


async def _framework_control_rows(db: AsyncSession) -> Rows:
    from app.models.framework import Framework, FrameworkControl
    rows = (await db.execute(
        select(FrameworkControl.id, FrameworkControl.framework_id, FrameworkControl.title,
               FrameworkControl.description, FrameworkControl.guidance)
        .join(Framework, Framework.id == FrameworkControl.framework_id)
        .where(Framework.is_builtin == True)  # noqa: E712
        .order_by(FrameworkControl.framework_id, FrameworkControl.sort_order, FrameworkControl.control_id)
    )).all()
    rank = {fid: i for i, fid in enumerate(await frameworks_in_use(db))}
    rows = sorted(rows, key=lambda r: rank.get(r[1], len(rank)))   # stable: keeps control order
    return [(cid, {"title": t or "", "description": d or "", "guidance": g or ""})
            for cid, _fid, t, d, g in rows]


# ── CVE knowledge base (on demand) ────────────────────────────────────────────

async def _cve_rows(db: AsyncSession) -> Rows:
    from app.models.content_translation import ContentTranslationRequest as Q
    from app.models.cve_entry import CveEntry
    ids = (await db.execute(
        select(Q.entity_id).where(Q.entity_type == "cve").order_by(Q.created_at).limit(500)
    )).scalars().all()
    if not ids:
        return []
    got = {cid: (desc, action) for cid, desc, action in (await db.execute(
        select(CveEntry.id, CveEntry.description, CveEntry.kev_action).where(CveEntry.id.in_(list(ids)))
    )).all()}
    return [(i, {"description": got[i][0] or "", "kev_action": got[i][1] or ""})
            for i in dict.fromkeys(ids) if i in got]


SOURCES: tuple[TranslationSource, ...] = (
    TranslationSource("cve", "cve", 0, ("description", "kev_action"), _cve_rows, on_demand=True),
    TranslationSource("threat_feed", "threat", 1, ("name", "description"), _threat_feed_rows,
                      prepare=_prepare_feed),
    TranslationSource("threat_watch", "threat_watch", 1, ("title", "summary"), _threat_watch_rows,
                      prepare=_prepare_feed),
    TranslationSource("regulatory_update", "regulatory_update", 1, ("title", "description"), _regulatory_rows),
    TranslationSource("threat_builtin", "threat", 2, ("name", "description"), _threat_builtin_rows),
    TranslationSource("framework", "framework", 3, ("name", "description"), _framework_rows),
    TranslationSource("framework_control", "framework_control", 4, ("title", "description", "guidance"),
                      _framework_control_rows),
)


def sources_by_priority() -> list[TranslationSource]:
    return sorted(SOURCES, key=lambda s: s.priority)
