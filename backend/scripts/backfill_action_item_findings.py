"""Idempotent backfill: link action items to the audit finding they answer (R2 6.1).

ActionItem.finding_id existed and was never written, so the finding progress
roll-up (audits.py _action_rollup) and the « plan d'action » section of the
audit report (report_generator) were always empty. From R2 on, an action raised
for an audit recommendation records ``recommendation_id`` and takes
``finding_id`` from that recommendation.

This script fills ``finding_id`` on existing items that know their
recommendation but not its finding — e.g. the recommendation was linked to a
finding after the action was created. Items that already have a finding_id are
never touched, so running it twice is a no-op. Works on SQLite and PostgreSQL.

Usage (from backend/):
    python -m scripts.backfill_action_item_findings              # dry run on grc_dev.db
    python -m scripts.backfill_action_item_findings --apply
    python -m scripts.backfill_action_item_findings --db /path/copy.db --apply

Run AFTER scripts.migrate_r2_lifecycle (it adds action_items.recommendation_id).
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from scripts.migrate_r2_lifecycle import _url


async def run(url: str, apply: bool) -> int:
    from app.models.action_item import ActionItem
    from app.models.audit_recommendation import AuditRecommendation
    import app.models  # noqa: F401

    engine = create_async_engine(url)
    linked = 0
    async with AsyncSession(engine) as db:
        rows = (await db.execute(
            select(ActionItem, AuditRecommendation)
            .join(AuditRecommendation, AuditRecommendation.id == ActionItem.recommendation_id)
            .where(ActionItem.finding_id.is_(None),
                   AuditRecommendation.finding_id.isnot(None),
                   AuditRecommendation.tenant_id == ActionItem.tenant_id)
        )).all()
        for item, rec in rows:
            print(f"  {item.id}  {item.title[:60]!r} → finding {rec.finding_id}")
            if apply:
                item.finding_id = rec.finding_id
            linked += 1
        if apply and linked:
            await db.commit()
    await engine.dispose()
    print(("linked " if apply else "would link ") + f"{linked} action item(s) to their finding."
          + ("" if apply or not linked else " Re-run with --apply to write."))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="SQLite file path or SQLAlchemy async URL (default: backend/grc_dev.db)")
    ap.add_argument("--apply", action="store_true", help="write the links (default: dry run)")
    args = ap.parse_args(argv)
    url = _url(args.db)
    print(f"{'APPLY' if args.apply else 'DRY RUN'} on {url.split('@')[-1]}")
    return asyncio.run(run(url, args.apply))


if __name__ == "__main__":
    sys.exit(main())
