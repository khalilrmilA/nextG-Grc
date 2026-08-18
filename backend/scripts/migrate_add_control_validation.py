"""Idempotent migration: add Elite Pack applied-control validation-workflow columns.

Adds a security-referent approval gate to applied_controls, independent from
the existing implementation-lifecycle `status` (planned/in_progress/...):
  validation_status  - "pending" | "validated" | "rejected" (default "pending")
  validated_by_id     - user id of the security referent who decided
  validated_at        - timestamp of the decision
  validation_notes    - optional referent comments/justification

Mirrors the vulnerabilities validation-workflow migration
(scripts/migrate_add_vuln_columns.py).

NOTE (build-phase convention): do not run this against a live/dev DB as part
of an unrelated change — it is provided so the columns can be added in a
deliberate, reviewed step alongside the rest of the Elite Pack rollout.

Usage: python -m scripts.migrate_add_control_validation
"""
import os
import sqlite3

COLUMNS = {
    "validation_status": "VARCHAR(20) DEFAULT 'pending'",
    "validated_by_id": "VARCHAR(36)",
    "validated_at": "DATETIME",
    "validation_notes": "TEXT",
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
    existing = {row[1] for row in cur.execute("PRAGMA table_info(applied_controls)").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE applied_controls ADD COLUMN {col} {ddl}")
            added.append(col)
    conn.commit()
    conn.close()
    print(f"applied_controls: added {added}" if added else "applied_controls: already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
