"""Idempotent migration: add audit report-approval columns (RFP gap fix).

Adds:
  audits.report_approved_by_id   FK -> users.id — who signed off on the generated report
  audits.report_approved_at      ISO datetime — when it was approved

(``audits.report_url`` already exists on this table from an earlier migration/
create_all pass — nothing to do there; this script only adds the two new
approval columns.)

NOT run automatically — this working copy backs a live production database
(grceye.com) and CLAUDE.md forbids mutating it directly. Run manually with:

  python -m scripts.migrate_add_audit_report_approval
"""
import os
import sqlite3

TABLE_COLUMNS = {
    "audits": {
        "report_approved_by_id": "VARCHAR(36)",
        "report_approved_at": "VARCHAR(30)",
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
