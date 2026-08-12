"""Idempotent migration: add Elite Pack asset columns to the assets table.

Adds: asset_class, serves_asset_ids, business_process_id, org_entity_id,
lifecycle_state, acquired_at, end_of_life_at. (CIA/business_value/RTO/RPO/MTD
and security_objectives already exist on the table.)

New tables (asset_valuation_history, org_entities, business_processes) are
created by create_all on startup.

Usage: python -m scripts.migrate_add_asset_columns
"""
import os
import sqlite3

COLUMNS = {
    "asset_class": "VARCHAR(20)",
    "serves_asset_ids": "JSON",
    "business_process_id": "VARCHAR(36)",
    "org_entity_id": "VARCHAR(36)",
    "lifecycle_state": "VARCHAR(20)",
    "acquired_at": "DATETIME",
    "end_of_life_at": "DATETIME",
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
    existing = {row[1] for row in cur.execute("PRAGMA table_info(assets)").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE assets ADD COLUMN {col} {ddl}")
            added.append(col)
    conn.commit()
    conn.close()
    print(f"assets: added {added}" if added else "assets: already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
