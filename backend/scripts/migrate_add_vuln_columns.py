"""Idempotent migration: add Elite Pack vulnerability columns.

Adds the validation-workflow + composite-impact-scoring columns. The
'pending_validation'/'validated' status values need no migration (status is a
free VARCHAR). New table scan_journals is auto-created by create_all.

Usage: python -m scripts.migrate_add_vuln_columns
"""
import os
import sqlite3

COLUMNS = {
    "validated_by_id": "VARCHAR(36)",
    "validated_at": "DATETIME",
    "impact_score": "FLOAT",
    "impact_override": "FLOAT",
    "impact_justification": "TEXT",
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
    existing = {row[1] for row in cur.execute("PRAGMA table_info(vulnerabilities)").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE vulnerabilities ADD COLUMN {col} {ddl}")
            added.append(col)
    conn.commit()
    conn.close()
    print(f"vulnerabilities: added {added}" if added else "vulnerabilities: already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
