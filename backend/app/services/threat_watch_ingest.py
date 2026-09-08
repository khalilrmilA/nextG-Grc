"""Route what the feeds bring in to where it belongs.

Replaces the previous behaviour, which appended every feed item to the threat
register as a candidate threat. See :mod:`app.models.threat_watch` for why that
was the wrong destination.

Two destinations:

* every item becomes a :class:`ThreatWatchItem` for the tenant to read;
* a CVE advisory additionally marks the shared CVE catalogue entry as *known
  exploited*, with CISA's required action and due date. That is the one piece
  of the feed that is directly actionable, and in the old design it had nowhere
  to go — it arrived as a row in the threat register, which cannot act on it.

Nothing is written to the threat register. Promoting an item into the register
is a deliberate, role-gated act (POST /threats/watch/{id}/promote), because a
genuinely new *kind* of threat appears a few times a year, not a few hundred
times a week.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cve_entry import CveEntry
from app.models.threat_watch import ThreatWatchItem
from app.services.threat_feeds import classify_item, stable_ref

logger = logging.getLogger(__name__)


async def apply_kev_flags(db: AsyncSession, items: list[dict]) -> int:
    """Mark CVE catalogue entries that CISA lists as actively exploited.

    The catalogue is platform-global, so this runs once per sync rather than
    once per tenant. Entries not yet pulled from NVD are skipped rather than
    invented — the NVD sync will bring them in, and the next watch cycle flags
    them then.
    """
    wanted = {
        (item.get("ref_id") or "").strip().upper(): item
        for item in items
        if classify_item(item) == "cve" and (item.get("ref_id") or "").strip()
    }
    if not wanted:
        return 0

    flagged = 0
    ids = list(wanted)
    for i in range(0, len(ids), 500):  # chunked for SQLite's variable limit
        chunk = ids[i:i + 500]
        rows = (await db.execute(select(CveEntry).where(CveEntry.cve_id.in_(chunk)))).scalars().all()
        for entry in rows:
            item = wanted.get(entry.cve_id.upper())
            if not item:
                continue
            entry.known_exploited = True
            entry.kev_added_at = item.get("kev_added_at") or entry.kev_added_at
            entry.kev_due_date = item.get("kev_due_date") or entry.kev_due_date
            entry.kev_action = item.get("kev_action") or entry.kev_action
            flagged += 1
    return flagged


def watch_key(item: dict) -> tuple[str, str]:
    """The (source, ref) pair a feed item is stored under.

    Exposed so a caller can ask "did *this* run file that item?" without
    re-deriving the truncations and drifting out of step with the unique
    (tenant, source, ref) index that makes ingestion idempotent.
    """
    return ((item.get("source") or "feed")[:60], stable_ref(item)[:80])


async def ingest_for_tenant(db: AsyncSession, tenant_id: str, items: list[dict]) -> dict:
    """Store feed items as watch entries for one tenant. Caller commits.

    Returns {"created": n, "skipped": n, "by_kind": {...}, "created_refs": {...}}.

    ``created_refs`` holds the watch_key() of every row this call actually
    inserted. Because the unique index admits exactly one of the two uvicorn
    workers per (tenant, source, ref), it is a cross-worker claim: a caller that
    only acts on ``created_refs`` acts once, not once per worker.
    """
    summary: dict = {"created": 0, "skipped": 0, "by_kind": {}, "created_refs": set()}
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for item in items:
        kind = classify_item(item)
        source, ref = watch_key(item)

        watch = ThreatWatchItem(
            tenant_id=tenant_id,
            kind=kind,
            source=source,
            ref=ref,
            title=(item.get("name") or "")[:500],
            summary=item.get("description") or None,
            url=item.get("url") or None,
            severity=(item.get("severity") or None),
            published_at=now,
            status="new",
            extra={
                k: v for k, v in item.items()
                if k in ("kev_added_at", "kev_due_date", "kev_action",
                         "typical_threat_actors", "typical_attack_vectors", "category")
                and v
            },
        )
        # A savepoint per row: the unique (tenant, source, ref) index is what
        # actually stops the two uvicorn workers duplicating each other, and one
        # collision must skip that item rather than abort the batch.
        try:
            async with db.begin_nested():
                db.add(watch)
                await db.flush()
        except IntegrityError:
            summary["skipped"] += 1
            continue
        summary["created"] += 1
        summary["created_refs"].add((source, ref))
        summary["by_kind"][kind] = summary["by_kind"].get(kind, 0) + 1

    return summary
