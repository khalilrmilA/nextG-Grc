"""Idempotent migration: add risk_scenarios.regulatory_exposure_weight + priority_score.

RFP gap fix (M5.3): "l'alerte de depassement d'appetit existe, mais il n'y a pas
de critere de ponderation supplementaire (ex: exposition reglementaire) au-dela
de probabilite x impact." Adds regulatory_exposure_weight (0.0-1.0 bounded
multiplier, same convention as Vulnerability.context_weight) and the computed
priority_score = matrix_score * (1 + regulatory_exposure_weight) — see
_priority_score() in app/api/v1/endpoints/risk_scenarios.py for the formula.

NOT run automatically — this working copy backs a live production database
(grceye.com) and CLAUDE.md forbids mutating it directly. Run manually with:

  python -m scripts.migrate_add_scenario_priority
"""
import os
import sqlite3

TABLE_COLUMNS = {
    "risk_scenarios": {
        "regulatory_exposure_weight": "FLOAT",
        "priority_score": "FLOAT",
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
