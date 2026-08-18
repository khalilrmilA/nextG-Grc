"""Idempotent migration: add ActionItem.start_date (RFP gap fix).

RFP gap analysis flagged that remediation action items only track a due date
("Seule la date d'echeance est geree, pas de champ date de debut") — there was
no way to record when remediation work actually started. Adds:

  action_items.start_date  (VARCHAR(20), ISO date string — same convention as
                             the existing due_date column)

NOT run automatically — this working copy backs a live production database
(grceye.com) and CLAUDE.md forbids mutating it directly. Run manually with:

  python -m scripts.migrate_add_action_item_start_date
"""
import os
import sqlite3

TABLE_COLUMNS = {
    "action_items": {"start_date": "VARCHAR(20)"},
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
