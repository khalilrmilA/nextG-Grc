"""Idempotent migration: add the `status` column to issued_licenses.

issued_licenses was created before revocation existed. SQLite create_all()
never adds columns to existing tables, so this adds it (defaulting to
'active') if absent. Safe to re-run. license_activations does not need this
column — revocation is applied there by expiring the row, not by a status
flag (see license_phone_home.py).
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
    table = "issued_licenses"
    if not table_exists(cur, table):
        print(f"  {table}: table missing (will be created by app startup) — skipped")
    elif has_column(cur, table, "status"):
        print(f"  {table}: status column already present — ok")
    else:
        cur.execute(
            f"ALTER TABLE {table} ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'"
        )
        con.commit()
        print(f"  {table}: added status column (default 'active')")
    con.close()
    print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
