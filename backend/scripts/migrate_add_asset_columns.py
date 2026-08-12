"""Idempotent migration: reconcile the assets table with the Asset model.

Adds the Elite Pack columns AND the older model columns that were declared on
Asset but never actually migrated into the DB (business_value, rto/rpo/mtd,
security_objectives, hosting/location, contains_pii/phi/pci, tags, integration
metadata) — their absence made GET /assets 500 with "no such column". The PRAGMA
check keeps this idempotent, so listing every column is safe.

New tables (asset_valuation_history, org_entities, business_processes) are
created by create_all on startup.

Usage: python -m scripts.migrate_add_asset_columns
"""
import os
import sqlite3

COLUMNS = {
    # Elite Pack columns
    "asset_class": "VARCHAR(20)",
    "serves_asset_ids": "JSON",
    "business_process_id": "VARCHAR(36)",
    "org_entity_id": "VARCHAR(36)",
    "lifecycle_state": "VARCHAR(20)",
    "acquired_at": "DATETIME",
    "end_of_life_at": "DATETIME",
    # Older Asset model columns that were never migrated into the table
    "hosting_type": "VARCHAR(50)",
    "cloud_provider": "VARCHAR(50)",
    "location": "VARCHAR(255)",
    "contains_pii": "BOOLEAN DEFAULT 0",
    "contains_phi": "BOOLEAN DEFAULT 0",
    "contains_pci": "BOOLEAN DEFAULT 0",
    "business_value": "VARCHAR(50)",
    "rto_seconds": "INTEGER",
    "rpo_seconds": "INTEGER",
    "mtd_seconds": "INTEGER",
    "security_objectives": "JSON",
    "tags": "JSON",
    "integration_source": "VARCHAR(100)",
    "external_id": "VARCHAR(255)",
    "raw_metadata": "JSON",
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
