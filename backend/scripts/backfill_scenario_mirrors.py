"""Idempotent backfill: close register entries left behind by deleted risk scenarios (follow-up C-5).

Creating a risk scenario adds a matching Risk to the register. Until follow-up
C-5, deleting the scenario left that Risk behind — open, scored, and impossible
to delete (risks.delete_risk refuses a scenario's register entry). From C-5 on,
the delete retires it (services/scenario_mirror.py). This script finds the ones
already orphaned.

How an orphan is recognised — the activity log keeps every scenario deletion
(entity_type "risk_scenario", action "delete"):
1. from C-5 on the entry records ``deleted.linked_risk_id`` — exact;
2. before that it records the scenario's name only: a Risk of the same tenant
   whose title equals that name, created no later than the deletion, is a
   candidate.
Either way the Risk must not be linked from any remaining scenario and must
still be open (closed / accepted ones record a decision and are left alone).

Dry run lists every candidate with how it was matched — review it, then
``--apply`` CLOSES them (never deletes: a close is reversible with Reopen, and
the risk's history is kept), with a risk version whose reason is "Scenario
deleted". Running it twice is a no-op. Works on SQLite and PostgreSQL.

Usage (from backend/):
    python -m scripts.backfill_scenario_mirrors                 # dry run on grc_dev.db
    python -m scripts.backfill_scenario_mirrors --apply
    python -m scripts.backfill_scenario_mirrors --db /path/copy.db --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from scripts.migrate_r2_lifecycle import _url


async def run(url: str, apply: bool) -> int:
    from app.models.activity_log import ActivityLog
    from app.models.risk import Risk, RiskStatus
    from app.models.risk_scenario import RiskScenario
    from app.services import risk_versioning, scenario_mirror
    import app.models  # noqa: F401

    engine = create_async_engine(url)
    found: dict[str, tuple[Risk, str]] = {}
    async with AsyncSession(engine, expire_on_commit=False) as db:
        linked = set((await db.execute(
            select(RiskScenario.linked_risk_id).where(RiskScenario.linked_risk_id.isnot(None))
        )).scalars().all())
        open_statuses = [s for s in RiskStatus if s not in (RiskStatus.CLOSED, RiskStatus.ACCEPTED)]
        deletions = (await db.execute(select(ActivityLog).where(
            ActivityLog.entity_type == "risk_scenario", ActivityLog.action == "delete"))).scalars().all()
        for entry in deletions:
            deleted = (entry.details or {}).get("deleted") or {}
            rid = deleted.get("linked_risk_id")
            if rid:
                risk = (await db.execute(select(Risk).where(
                    Risk.id == rid, Risk.tenant_id == entry.tenant_id, Risk.status.in_(open_statuses)))).scalar_one_or_none()
                how = "recorded link"
                candidates = [risk] if risk else []
            else:
                name = entry.entity_name or deleted.get("name")
                if not name:
                    continue
                candidates = (await db.execute(select(Risk).where(
                    Risk.tenant_id == entry.tenant_id, Risk.title == name,
                    Risk.status.in_(open_statuses), Risk.created_at <= entry.created_at,
                ))).scalars().all()
                how = f"title = deleted scenario “{name}”"
            for risk in candidates:
                if risk.id not in linked and risk.id not in found:
                    found[risk.id] = (risk, how)

        print(f"{len(deletions)} scenario deletion(s) in the activity log; {len(found)} orphaned register entr(y/ies)")
        for risk, how in found.values():
            why = await scenario_mirror.links(db, risk.tenant_id, risk)
            print(f"  {risk.id}  {risk.title[:60]!r}  [{how}]" + (f"  — also cited by: {', '.join(why)}" if why else ""))
            if apply:
                status = getattr(risk.status, "value", risk.status)
                await risk_versioning.archive(db, risk, None, change_reason=scenario_mirror.SCENARIO_DELETED,
                                              transition_from=status, transition_to=RiskStatus.CLOSED.value)
                risk.status = RiskStatus.CLOSED
        if apply and found:
            await db.commit()
    await engine.dispose()
    print(("closed " if apply else "would close ") + f"{len(found)} risk(s)."
          + ("" if apply or not found else " Review the list, then re-run with --apply."))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="SQLite file path or SQLAlchemy async URL (default: backend/grc_dev.db)")
    ap.add_argument("--apply", action="store_true", help="close the orphans (default: dry run)")
    args = ap.parse_args(argv)
    url = _url(args.db)
    print(f"{'APPLY' if args.apply else 'DRY RUN'} on {url.split('@')[-1]}")
    return asyncio.run(run(url, args.apply))


if __name__ == "__main__":
    sys.exit(main())
