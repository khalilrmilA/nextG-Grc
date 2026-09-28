"""Idempotent migration: add the per-user Elite Pack grant to the users table.

Adds:
    elite_access  BOOLEAN NOT NULL DEFAULT 0

Set by a super admin from the Super Admin > Users tab; honored by
require_feature and GET /subscriptions/current/entitlements.

Usage:
    python -m scripts.migrate_add_user_elite_access
Safe to run repeatedly.
"""
import os
import sqlite3

COLUMNS = {
    "elite_access": "BOOLEAN NOT NULL DEFAULT 0",
}


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
    return os.path.join(here, "grc_dev.db")


def main() -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    existing = {row[1] for row in cur.execute("PRAGMA table_info(users)").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
            added.append(col)
    conn.commit()
    conn.close()
    print(f"users: added {added}" if added else "users: already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
