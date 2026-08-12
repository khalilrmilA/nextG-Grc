"""Idempotent migration: add access-control columns to the users table.

Adds first-login + lockout columns used by the Phase-0 security hardening:
    must_change_password, failed_login_count, locked_until, password_changed_at

New tables (password_reset_tokens, mfa_devices) are created automatically by
Base.metadata.create_all on app startup, so they are not handled here.

Usage:
    python -m scripts.migrate_add_access_columns
Safe to run repeatedly.
"""
import os
import sqlite3

COLUMNS = {
    "must_change_password": "BOOLEAN NOT NULL DEFAULT 0",
    "failed_login_count": "INTEGER NOT NULL DEFAULT 0",
    "locked_until": "DATETIME",
    "password_changed_at": "DATETIME",
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
