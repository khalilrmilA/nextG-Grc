"""Idempotent backfill: mark control rows a PERSON already edited as human-set (R2 5.1).

From R2 on, update_control_assessment marks the rows a person edits
(``status_source = "human"``) and an AI re-run only suggests on those rows.
Rows edited BEFORE the marker existed carry NULL, which the analysis treats as
its own — so the next re-run would overwrite them, exactly what R2 fixes.

Two footprints of a person's edit are used; every such row still NULL is
marked "human":

1. the activity log records every PATCH /compliance/control-assessments/{id}
   (ActivityLogMiddleware: entity_type "compliance", entity_id = the row id);
2. a row with NO ai_confidence whose status is not "not_started": the analysis
   always records a confidence, so such a status was set by a person (or by the
   completion of a remediation action / a checklist upload — neither is the AI's
   verdict either).

Conservative on purpose: a PATCH that only changed the notes counts too — the
cost is that the AI suggests instead of overwriting on that row, never that
human work is lost.

Rows already marked (human or ai) are never changed, so running it twice is a
no-op. Works on SQLite and PostgreSQL.

Usage (from backend/):
    python -m scripts.backfill_control_status_source               # dry run on grc_dev.db
    python -m scripts.backfill_control_status_source --apply
    python -m scripts.backfill_control_status_source --db /path/copy.db --apply

Run AFTER scripts.migrate_r2_lifecycle (it adds the column) and BEFORE the first
AI re-run on the new code.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from scripts.migrate_r2_lifecycle import _url


async def run(url: str, apply: bool) -> int:
    from app.models.activity_log import ActivityLog
    from app.models.compliance import ControlAssessment
    import app.models  # noqa: F401

    engine = create_async_engine(url)
    async with AsyncSession(engine) as db:
        logged = (await db.execute(
            select(ActivityLog.entity_id, ActivityLog.details).where(
                ActivityLog.entity_type == "compliance",
                ActivityLog.action == "update",
                ActivityLog.entity_id.isnot(None),
            )
        )).all()
        edited = {
            eid for eid, details in logged
            if "/control-assessments/" in str((details or {}).get("path", ""))
        }
        from_log = set((await db.execute(
            select(ControlAssessment.id).where(
                ControlAssessment.id.in_(list(edited) or [""]),
                ControlAssessment.status_source.is_(None),
            )
        )).scalars().all())
        from app.models.compliance import ControlStatus
        no_confidence = set((await db.execute(
            select(ControlAssessment.id).where(
                ControlAssessment.ai_confidence.is_(None),
                ControlAssessment.status != ControlStatus.NOT_STARTED,
                ControlAssessment.status_source.is_(None),
            )
        )).scalars().all())
        candidates = sorted(from_log | no_confidence)
        print(f"activity log: {len(edited)} row(s) edited by a person, {len(from_log)} unmarked; "
              f"status without AI confidence: {len(no_confidence)} unmarked; total {len(candidates)}")
        if apply and candidates:
            for i in range(0, len(candidates), 500):
                await db.execute(update(ControlAssessment)
                                 .where(ControlAssessment.id.in_(candidates[i:i + 500]))
                                 .values(status_source="human"))
            await db.commit()
    await engine.dispose()
    print(("marked " if apply else "would mark ") + f"{len(candidates)} row(s) as human-set."
          + ("" if apply or not candidates else " Re-run with --apply to write."))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="SQLite file path or SQLAlchemy async URL (default: backend/grc_dev.db)")
    ap.add_argument("--apply", action="store_true", help="write the marks (default: dry run)")
    args = ap.parse_args(argv)
    url = _url(args.db)
    print(f"{'APPLY' if args.apply else 'DRY RUN'} on {url.split('@')[-1]}")
    return asyncio.run(run(url, args.apply))


if __name__ == "__main__":
    sys.exit(main())
