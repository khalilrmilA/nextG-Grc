"""Shared helper for the STB tender migrations (bloc « conformité & audit »).

Every STB migration is a plain, idempotent `ALTER TABLE ... ADD COLUMN` pass built
on the same shape as migrate_add_action_item_start_date.py: read PRAGMA table_info,
add only what is missing, never rewrite or drop anything. Re-running is a no-op.

These are NOT run automatically. This working copy backs the live production
database for grceye.com, so the operator runs them explicitly:

    python -m scripts.migrate_add_stb_referential_columns

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
"""
import os
import sqlite3


def db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def run(table_columns: dict, indexes: dict | None = None) -> int:
    """Add every missing column, then every missing index. Returns an exit code.

    `table_columns` maps table -> {column: DDL}. `indexes` maps index name ->
    (table, column). A table that does not exist yet is skipped rather than
    failing the whole run: new tables are created by SQLAlchemy's create_all()
    at startup, so a fresh install may legitimately not have them at this point.
    """
    path = db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2

    conn = sqlite3.connect(path)
    cur = conn.cursor()
    known = {row[0] for row in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}

    for table, columns in table_columns.items():
        if table not in known:
            print(f"{table}: table absent — skipped (create_all() will build it)")
            continue
        existing = {row[1] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()}
        added = []
        for col, ddl in columns.items():
            if col not in existing:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
                added.append(col)
        print(f"{table}: added {added}" if added else f"{table}: already up to date")

    for name, (table, column) in (indexes or {}).items():
        if table not in known:
            continue
        cur.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({column})")
    if indexes:
        print(f"indexes: ensured {sorted(indexes)}")

    conn.commit()
    conn.close()
    return 0
