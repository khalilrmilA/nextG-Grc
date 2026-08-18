"""Idempotent migration: add columns for the treatment-refinement RFP gap-fix pass.

Adds (one column per line, grouped by table):
  risk_treatments.linked_scenario_ids   direct plan -> risk-scenario(s) association
                                         (gap: "pas d'association directe du plan a
                                         un ou plusieurs scenarios de risque")
  risks.target_validated_at             timestamp of the final target-validation gate
  risks.target_calculation_notes        hypotheses/notes behind the target calculation
                                         (gap: "tracabilite du calcul et des hypotheses")

Deliberately NOT included: dropping the `unique=True` constraint on
risk_treatments.risk_id (the "one plan per risk" limit). SQLite has no
`ALTER TABLE ... DROP CONSTRAINT`; an inline column UNIQUE becomes part of the
table's original CREATE-TABLE DDL (an internal sqlite_autoindex_*), so removing
it needs a full table rebuild (create new table without the constraint, copy
rows, drop old, rename). That rebuild is out of scope for an additive,
low-risk migration against a database backing live production data — see the
`fix(treatment-refinement)` commit message for the full reasoning. The model
docstring on RiskTreatment (app/models/risk.py) documents the same deferral.

NOT run automatically — this working copy backs a live production database
(grceye.com) and CLAUDE.md forbids mutating it directly. Run manually with:

  python -m scripts.migrate_add_treatment_scenario_links
"""
import os
import sqlite3

TABLE_COLUMNS = {
    "risk_treatments": {"linked_scenario_ids": "JSON"},
    "risks": {"target_validated_at": "VARCHAR(30)", "target_calculation_notes": "TEXT"},
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
