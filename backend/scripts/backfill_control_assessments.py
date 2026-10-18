"""Idempotent backfill: control rows for assessments that have none (R2 5.2).

POST /compliance/assessments used to create an assessment with NO
ControlAssessment rows; they only appeared with the first AI analysis. An
appliance tenant, or a framework added after registration, therefore had an
assessment nobody could fill in by hand. New assessments now get one
NOT_STARTED row per requirement at creation; this script gives the same rows
to the existing assessments that have zero.

An assessment with at least one row is never touched, so running it twice is a
no-op. Works on SQLite and PostgreSQL (same async drivers as the app).

Usage (from backend/):
    python -m scripts.backfill_control_assessments                    # dry run on grc_dev.db
    python -m scripts.backfill_control_assessments --apply
    python -m scripts.backfill_control_assessments --db /path/copy.db --apply
    python -m scripts.backfill_control_assessments --db postgresql+asyncpg://u:p@h/db --apply

Run AFTER scripts.migrate_r2_lifecycle (the rows carry the new columns).
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from scripts.migrate_r2_lifecycle import _url


async def run(url: str, apply: bool) -> int:
    # Imported here so --help works without loading the application.
    from app.api.v1.endpoints.compliance import _load_scale, _status_key_for
    from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus
    from app.models.framework import FrameworkControl
    import app.models  # noqa: F401 — register every mapper

    engine = create_async_engine(url)
    total_rows = 0
    touched = 0
    async with AsyncSession(engine, expire_on_commit=False) as db:
        counts = dict((await db.execute(
            select(ControlAssessment.assessment_id, func.count()).group_by(ControlAssessment.assessment_id)
        )).all())
        assessments = (await db.execute(select(ComplianceAssessment))).scalars().all()
        empty = [a for a in assessments if not counts.get(a.id)]
        print(f"{len(assessments)} assessment(s), {len(empty)} without control rows")
        for a in empty:
            control_ids = (await db.execute(
                select(FrameworkControl.id).where(FrameworkControl.framework_id == a.framework_id)
            )).scalars().all()
            if not control_ids:
                print(f"  {a.id}  {a.name!r}: framework has no controls — skipped")
                continue
            scale = await _load_scale(db, a)
            key = _status_key_for(scale, ControlStatus.NOT_STARTED)
            print(f"  {a.id}  {a.name!r}: {'add' if apply else 'would add'} {len(control_ids)} row(s)")
            touched += 1
            total_rows += len(control_ids)
            if apply:
                for cid in control_ids:
                    db.add(ControlAssessment(assessment_id=a.id, control_id=cid,
                                             status=ControlStatus.NOT_STARTED, status_key=key))
        if apply:
            await db.commit()
    await engine.dispose()
    verb = "added" if apply else "would add"
    print(f"\n{verb} {total_rows} row(s) to {touched} assessment(s)."
          + ("" if apply or not touched else " Re-run with --apply to write."))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="SQLite file path or SQLAlchemy async URL (default: backend/grc_dev.db)")
    ap.add_argument("--apply", action="store_true", help="write the rows (default: dry run)")
    args = ap.parse_args(argv)
    url = _url(args.db)
    print(f"{'APPLY' if args.apply else 'DRY RUN'} on {url.split('@')[-1]}")
    return asyncio.run(run(url, args.apply))


if __name__ == "__main__":
    sys.exit(main())
