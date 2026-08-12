"""Idempotent migration: add Elite Pack threat-profile columns to threats.

Usage: python -m scripts.migrate_add_threat_columns
"""
import os
import sqlite3

COLUMNS = {
    "origin": "VARCHAR(20)",
    "objectives": "TEXT",
    "aggravating_factors": "TEXT",
    "occurrence_conditions": "TEXT",
    "estimated_frequency": "VARCHAR(50)",
    "mode_operatoire": "TEXT",
    "probability_level": "VARCHAR(30)",
    "severity_level": "VARCHAR(30)",
    "last_reviewed_at": "VARCHAR(30)",
    "reviewed_by_id": "VARCHAR(36)",
    "linked_asset_ids": "JSON",
    "linked_vulnerability_ids": "JSON",
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
    existing = {row[1] for row in cur.execute("PRAGMA table_info(threats)").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE threats ADD COLUMN {col} {ddl}")
            added.append(col)
    conn.commit()
    conn.close()
    print(f"threats: added {added}" if added else "threats: already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
