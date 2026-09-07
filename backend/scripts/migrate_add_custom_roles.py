"""Idempotent migration: let a user hold tenant-defined custom roles.

Adds ``users.custom_role_ids`` (JSON array). The ``custom_roles`` table itself
is new and is created by ``Base.metadata.create_all()`` on startup, so only the
column on an existing table needs handling here.

Existing rows get an empty list, which resolves to exactly today's behaviour:
a user with no custom roles has the same effective roles as before.

Usage:
    python -m scripts.migrate_add_custom_roles
Safe to run repeatedly.
"""
import os
import sqlite3

TABLE = "users"
COLUMNS = {
    # Stored as TEXT holding a JSON array — matching how `roles` and
    # `excluded_roles` are already persisted on this table.
    "custom_role_ids": "TEXT NOT NULL DEFAULT '[]'",
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

    existing = {row[1] for row in cur.execute(f"PRAGMA table_info({TABLE})").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE {TABLE} ADD COLUMN {col} {ddl}")
            added.append(col)
    print(f"{TABLE}: added {added}" if added else f"{TABLE}: already up to date")

    # Normalise any NULLs a prior partial run could have left, so the column is
    # always valid JSON for the ORM to load.
    cur.execute(f"UPDATE {TABLE} SET custom_role_ids = '[]' WHERE custom_role_ids IS NULL")
    if cur.rowcount:
        print(f"{TABLE}: normalised {cur.rowcount} NULL custom_role_ids to []")

    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
