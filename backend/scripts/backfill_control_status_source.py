"""Idempotent backfill: mark control rows a PERSON already edited as human-set (R2 5.1).

From R2 on, update_control_assessment marks the rows a person edits
(``status_source = "human"``) and an AI re-run only suggests on those rows.
Rows edited BEFORE the marker existed carry NULL, which the analysis treats as
its own — so the next re-run would overwrite them, exactly what R2 fixes.

Four footprints of a person's decision are used; every such row still NULL is
marked "human":

1. the activity log records every PATCH /compliance/control-assessments/{id}
   (ActivityLogMiddleware: entity_type "compliance", entity_id = the row id);
2. a row with NO ai_confidence whose status is not "not_started": the analysis
   always records a confidence, so such a status was set by a person (or by the
   completion of a remediation action / a checklist upload — neither is the AI's
   verdict either);
3. (follow-up B-2) the activity log records every PATCH
   /compliance/action-plan/{item_id}: completing or reopening an action linked
   to a gap closes or reopens that gap's control row;
4. (follow-up B-2) a COMPLETED action item linked to a gap: its completion is
   what closed the gap's control row, a person's act even when the log entry
   is gone.

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
        # 3 + 4: rows reached through the action plan (item → gap → control row).
        from app.models.action_item import ActionItem, ActionItemStatus
        from app.models.compliance import ComplianceGap
        action_logged = {
            eid for eid, details in (await db.execute(
                select(ActivityLog.entity_id, ActivityLog.details).where(
                    ActivityLog.entity_type == "compliance",
                    ActivityLog.action == "update",
                    ActivityLog.entity_id.isnot(None),
                ))).all()
            if "/action-plan/" in str((details or {}).get("path", ""))
        }

        async def rows_for(items_where) -> set[str]:
            return set((await db.execute(
                select(ControlAssessment.id)
                .join(ComplianceGap, (ComplianceGap.assessment_id == ControlAssessment.assessment_id)
                      & (ComplianceGap.control_id == ControlAssessment.control_id))
                .join(ActionItem, ActionItem.gap_id == ComplianceGap.id)
                .where(items_where, ControlAssessment.status_source.is_(None))
            )).scalars().all())

        from_action_log = await rows_for(ActionItem.id.in_(list(action_logged) or [""]))
        from_completed = await rows_for(ActionItem.status == ActionItemStatus.COMPLETED)
        candidates = sorted(from_log | no_confidence | from_action_log | from_completed)
        print("unmarked rows per source (a row can appear under several):")
        print(f"  1. control row edited (activity log): {len(from_log)}  [{len(edited)} edit(s) logged]")
        print(f"  2. status without AI confidence:     {len(no_confidence)}")
        print(f"  3. action plan closure/reopen (log): {len(from_action_log)}  [{len(action_logged)} action edit(s) logged]")
        print(f"  4. completed remediation action:     {len(from_completed)}")
        print(f"  total distinct rows:                 {len(candidates)}")
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
