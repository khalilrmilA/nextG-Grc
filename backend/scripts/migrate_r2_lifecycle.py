"""Idempotent migration: columns added by the R2 lifecycle work (feat/r2-lifecycle).

New *tables* are created by ``create_all()`` at startup; this script only adds
*columns* to tables that already exist, which ``create_all()`` never does.

Every column is checked against the live schema before its ``ALTER TABLE ...
ADD COLUMN``, so the script can be run any number of times. It works on SQLite
and PostgreSQL alike: the schema is read through SQLAlchemy's inspector on the
same async drivers the application uses (aiosqlite / asyncpg).

Usage (from backend/):
    python -m scripts.migrate_r2_lifecycle                       # dry run on grc_dev.db
    python -m scripts.migrate_r2_lifecycle --apply               # write
    python -m scripts.migrate_r2_lifecycle --db /path/copy.db    # another SQLite file
    python -m scripts.migrate_r2_lifecycle --db postgresql+asyncpg://u:p@host/db --apply

Run it BEFORE restarting the backend on new code: the models already declare
these columns, so a backend started first would fail every query on the tables.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

# table -> {column: {dialect: DDL type}}. Nullable and default-less on purpose:
# existing rows stay valid and the ORM supplies defaults for new ones.
COLUMNS: dict[str, dict[str, dict[str, str]]] = {
    # Phase 2.4 — risk acceptance reject / revoke, and the risk statuses an
    # approval replaced (restored on revoke or expiry).
    "risk_acceptances": {
        "rejection_reason":    {"sqlite": "TEXT", "postgresql": "TEXT"},
        "revoked_by_id":       {"sqlite": "VARCHAR(36)", "postgresql": "VARCHAR(36)"},
        "revoked_at":          {"sqlite": "VARCHAR(30)", "postgresql": "VARCHAR(30)"},
        "revocation_reason":   {"sqlite": "TEXT", "postgresql": "TEXT"},
        "prior_risk_statuses": {"sqlite": "JSON", "postgresql": "JSON"},
    },
    # Phase 3.1 — vendor offboarding date / reason / actor.
    "vendors": {
        "offboarded_at":      {"sqlite": "VARCHAR(20)", "postgresql": "VARCHAR(20)"},
        "offboarding_reason": {"sqlite": "TEXT", "postgresql": "TEXT"},
        "offboarded_by_id":   {"sqlite": "VARCHAR(36)", "postgresql": "VARCHAR(36)"},
    },
    # Phase 3.3 — vendor assessment history (prescreen + AI analysis).
    "vendor_assessments": {
        "kind":               {"sqlite": "VARCHAR(30)", "postgresql": "VARCHAR(30)"},
        "risk_level":         {"sqlite": "VARCHAR(20)", "postgresql": "VARCHAR(20)"},
        "narrative":          {"sqlite": "TEXT", "postgresql": "TEXT"},
        "result":             {"sqlite": "JSON", "postgresql": "JSON"},
        "assessed_by_id":     {"sqlite": "VARCHAR(36)", "postgresql": "VARCHAR(36)"},
        "approved_by_id":     {"sqlite": "VARCHAR(36)", "postgresql": "VARCHAR(36)"},
        "approved_at":        {"sqlite": "VARCHAR(30)", "postgresql": "VARCHAR(30)"},
        "applied_risk_score": {"sqlite": "FLOAT", "postgresql": "DOUBLE PRECISION"},
    },
    # Phase 5.1 — an AI re-run merges instead of replacing: who set the status,
    # and the AI's own opinion kept beside a human decision.
    "control_assessments": {
        "status_source":           {"sqlite": "VARCHAR(10)", "postgresql": "VARCHAR(10)"},
        "ai_suggested_status":     {"sqlite": "VARCHAR(30)", "postgresql": "VARCHAR(30)"},
        "ai_suggested_status_key": {"sqlite": "VARCHAR(40)", "postgresql": "VARCHAR(40)"},
        "ai_suggested_notes":      {"sqlite": "TEXT", "postgresql": "TEXT"},
        "ai_suggested_at":         {"sqlite": "VARCHAR(30)", "postgresql": "VARCHAR(30)"},
    },
    # Phase 6.1 — the recommendation an action answers (finding_id follows it).
    "action_items": {
        "recommendation_id": {"sqlite": "VARCHAR(36)", "postgresql": "VARCHAR(36)"},
    },
    # Follow-up A-2 — policy periodic review: a hand-set review date survives a
    # publish, and the latest review is kept on the policy (history: policy_reviews,
    # a new table created by create_all()).
    "policies": {
        "next_review_date_manual": {"sqlite": "BOOLEAN", "postgresql": "BOOLEAN"},
        "last_reviewed_at":        {"sqlite": "VARCHAR(30)", "postgresql": "VARCHAR(30)"},
        "last_reviewed_by_id":     {"sqlite": "VARCHAR(36)", "postgresql": "VARCHAR(36)"},
        "last_review_comment":     {"sqlite": "TEXT", "postgresql": "TEXT"},
    },
}


def _url(db: str | None) -> str:
    if db and "://" in db:
        return db
    path = db or os.environ.get("GRC_DB_PATH") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "grc_dev.db")
    if not os.path.exists(path):
        raise SystemExit(f"ERROR: database not found at {path}")
    return f"sqlite+aiosqlite:///{os.path.abspath(path)}"


async def run(url: str, apply: bool) -> int:
    engine = create_async_engine(url)
    dialect = engine.dialect.name
    if dialect not in ("sqlite", "postgresql"):
        print(f"ERROR: unsupported dialect {dialect}")
        return 2
    planned = 0
    async with engine.begin() as conn:
        tables = set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
        for table, cols in COLUMNS.items():
            if table not in tables:
                # create_all() will build it with every column on first start.
                print(f"{table}: table absent — created by create_all() at startup, skipped")
                continue
            existing = set(await conn.run_sync(
                lambda c, t=table: [col["name"] for col in inspect(c).get_columns(t)]))
            missing = [c for c in cols if c not in existing]
            if not missing:
                print(f"{table}: already up to date")
                continue
            for col in missing:
                ddl = f"ALTER TABLE {table} ADD COLUMN {col} {cols[col][dialect]}"
                print(f"{table}: {'ADD' if apply else 'would add'} {col}  ({ddl})")
                if apply:
                    await conn.execute(text(ddl))
                planned += 1
    await engine.dispose()
    if not apply and planned:
        print(f"\nDry run: {planned} column(s) to add. Re-run with --apply to write.")
    elif apply:
        print(f"\nDone: {planned} column(s) added.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="SQLite file path or SQLAlchemy async URL (default: backend/grc_dev.db)")
    ap.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = ap.parse_args(argv)
    url = _url(args.db)
    print(f"{'APPLY' if args.apply else 'DRY RUN'} on {url.split('@')[-1]}")
    return asyncio.run(run(url, args.apply))


if __name__ == "__main__":
    sys.exit(main())
