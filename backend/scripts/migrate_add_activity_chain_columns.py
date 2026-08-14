"""Idempotent migration: tamper-evidence hash-chain columns on activity_logs.

Adds activity_logs.(seq, prev_hash, entry_hash) and a UNIQUE(tenant_id, seq) index.
Existing rows keep seq=NULL (legacy/unchained) — the chain starts fresh at deploy, and
SQLite treats those NULLs as distinct so the unique index builds without collision.

Usage: python -m scripts.migrate_add_activity_chain_columns
"""
import os
import sqlite3

TABLE = "activity_logs"
COLUMNS = {"seq": "INTEGER", "prev_hash": "VARCHAR(64)", "entry_hash": "VARCHAR(64)"}
INDEX_SQL = "CREATE UNIQUE INDEX IF NOT EXISTS ix_activity_chain_tenant_seq ON activity_logs(tenant_id, seq)"


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
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE {TABLE} ADD COLUMN {col} {ddl}")
            added.append(col)
    cur.execute(INDEX_SQL)
    print(f"{TABLE}: added {added}" if added else f"{TABLE}: already up to date")
    print(f"{TABLE}: unique(tenant_id, seq) index ensured")
    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
