"""Idempotent migration: activity_logs.origin ("api" | "batch" | "manual").

Adds the origin column (RFP audit-trail gap: distinguish manual/batch/API
operations). Existing rows are backfilled to "api" — every entry ever written to
this table so far came from ActivityLogMiddleware or an explicit chain_and_add()
call inside an HTTP request handler, so that backfill value is factually correct,
not a guess.

Deliberately does NOT touch seq/prev_hash/entry_hash and origin is never included
in activity_chain.compute_entry_hash()'s payload — adding/backfilling this column
must not change any existing entry's hash or the chain would falsely appear
tampered from this deploy onward.

Usage: python -m scripts.migrate_add_activity_origin_column
"""
import os
import sqlite3

TABLE = "activity_logs"
COLUMN = "origin"
DDL = "VARCHAR(20)"


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main() -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    existing = {row[1] for row in cur.execute(f"PRAGMA table_info({TABLE})").fetchall()}
    if COLUMN not in existing:
        cur.execute(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} {DDL}")
        print(f"{TABLE}: added column {COLUMN}")
    else:
        print(f"{TABLE}: {COLUMN} already present")
    cur.execute(f"UPDATE {TABLE} SET {COLUMN} = 'api' WHERE {COLUMN} IS NULL")
    print(f"{TABLE}: backfilled {cur.rowcount} row(s) to origin='api'")
    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
