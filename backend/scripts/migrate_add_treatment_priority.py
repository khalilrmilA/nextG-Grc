"""Idempotent migration: add columns for the 2nd RFP risk-refinement gap-fix pass.

Adds (one column per line, grouped by table):
  risk_treatments.priority          auto-derived critical/high/medium/low (gap 2)
  risk_treatments.actual_cost       actual spend vs estimated_cost, for budget-overrun
                                     alerts (gap 3)
  risk_scenarios.appetite_threshold per-scenario appetite threshold, independent of
                                     the linked Risk's (gap 4)
  assets.next_review_date           mandatory periodic asset review date (gap 5)

NOT run automatically — this working copy backs a live production database
(grceye.com) and CLAUDE.md forbids mutating it directly. Run manually with:

  python -m scripts.migrate_add_treatment_priority
"""
import os
import sqlite3

TABLE_COLUMNS = {
    "risk_treatments": {"priority": "VARCHAR(20)", "actual_cost": "FLOAT"},
    "risk_scenarios": {"appetite_threshold": "FLOAT"},
    "assets": {"next_review_date": "VARCHAR(20)"},
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
