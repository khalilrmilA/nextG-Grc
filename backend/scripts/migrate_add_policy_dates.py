"""Idempotent migration: add policy lifecycle-date + org-linkage columns (RFP gap fix).

Adds:
  policies.effective_date        ISO date — "date de mise en vigueur"
  policies.expiration_date       ISO date — "date d'expiration"
  policies.business_process_id   FK -> business_processes.id (structured process linkage)
  policies.org_entity_id         FK -> org_entities.id (structured entity/department linkage)

NOT run automatically — this working copy backs a live production database
(grceye.com) and CLAUDE.md forbids mutating it directly. Run manually with:

  python -m scripts.migrate_add_policy_dates
"""
import os
import sqlite3

TABLE_COLUMNS = {
    "policies": {
        "effective_date": "VARCHAR(20)",
        "expiration_date": "VARCHAR(20)",
        "business_process_id": "VARCHAR(36)",
        "org_entity_id": "VARCHAR(36)",
    },
}


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
    for table, columns in TABLE_COLUMNS.items():
        existing = {row[1] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()}
        added = []
        for col, ddl in columns.items():
            if col not in existing:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
                added.append(col)
        print(f"{table}: added {added}" if added else f"{table}: already up to date")
    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
