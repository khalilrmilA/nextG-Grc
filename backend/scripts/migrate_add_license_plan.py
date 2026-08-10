"""Idempotent migration: add the `plan` column to the license tables.

Both issued_licenses and license_activations were created before the plan
field existed. SQLite create_all() never adds columns to existing tables, so
this adds them (defaulting to 'enterprise') if absent. Safe to re-run.
"""
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "grc_dev.db"


def has_column(cur, table: str, col: str) -> bool:
    return any(r[1] == col for r in cur.execute(f"PRAGMA table_info({table})"))


def table_exists(cur, table: str) -> bool:
    return cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone() is not None


def main() -> int:
    con = sqlite3.connect(DB)
    cur = con.cursor()
    changed = []
    for table in ("issued_licenses", "license_activations"):
        if not table_exists(cur, table):
            print(f"  {table}: table missing (will be created by app startup) — skipped")
            continue
        if has_column(cur, table, "plan"):
            print(f"  {table}: plan column already present — ok")
            continue
        cur.execute(
            f"ALTER TABLE {table} ADD COLUMN plan VARCHAR(20) NOT NULL DEFAULT 'enterprise'"
        )
        changed.append(table)
        print(f"  {table}: added plan column (default 'enterprise')")
    con.commit()
    con.close()
    print(f"Migration complete. Tables altered: {changed or 'none (already up to date)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
