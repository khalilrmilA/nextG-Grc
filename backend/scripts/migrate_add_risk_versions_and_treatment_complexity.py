"""Idempotent migration: risk versioning, and the treatment ranking inputs.

Adds to ``risk_treatments``:
  complexity            the second half of "priorité en fonction de la
                        criticité **et la complexité**" — priority was derived
                        from criticality alone because there was nothing to
                        weigh against it.
  delay_justification   why a plan slipped. The tracking view could flag a plan
  delay_reported_at     overdue but had nowhere for the owner to say why.

The ``risk_versions`` table is new and is created by ``create_all()`` on
startup, so nothing is needed for it here.

Usage:
    python -m scripts.migrate_add_risk_versions_and_treatment_complexity
Safe to run repeatedly.
"""
import os
import sqlite3

COLUMNS = {
    "risk_treatments": {
        "complexity": "TEXT",
        "delay_justification": "TEXT",
        "delay_reported_at": "TEXT",
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

    present = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

    for table, cols in COLUMNS.items():
        if table not in present:
            print(f"{table}: absent — created by create_all(), skipping")
            continue
        existing = {r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}
        added = [c for c in cols if c not in existing]
        for col in added:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {cols[col]}")
        print(f"{table}: added {added}" if added else f"{table}: already up to date")

    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
