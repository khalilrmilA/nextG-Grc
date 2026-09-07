"""Idempotent migration: control register traceability and evaluation follow-up.

Adds to ``control_evaluations``:
  method / evidence_ref / audit_id   what the evaluation rested on — an internal
                                     audit, a technical test, an indicator. Without
                                     it a score from a documented penetration test
                                     is indistinguishable from one given from memory.
  remediation_status / _plan /       the follow-up the requirement asks for on
  _owner_id / _due_date              controls declared obsolete or ineffective.

Adds to ``applied_controls``:
  risk_ids                           controls link to scenarios already; the risk
                                     register itself was not covered.

The ``applied_control_history`` table is new and is created by ``create_all()``
on startup, so nothing is needed for it here.

Usage:
    python -m scripts.migrate_add_control_evaluation_followup
Safe to run repeatedly.
"""
import os
import sqlite3

TABLES = {
    "control_evaluations": {
        "method": "TEXT",
        "evidence_ref": "TEXT",
        "audit_id": "TEXT",
        "remediation_status": "TEXT NOT NULL DEFAULT 'not_required'",
        "remediation_plan": "TEXT",
        "remediation_owner_id": "TEXT",
        "remediation_due_date": "TEXT",
    },
    "applied_controls": {
        "risk_ids": "TEXT NOT NULL DEFAULT '[]'",
    },
}
INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_control_eval_method ON control_evaluations (method)",
    "CREATE INDEX IF NOT EXISTS ix_control_eval_audit ON control_evaluations (audit_id)",
    "CREATE INDEX IF NOT EXISTS ix_control_eval_remediation ON control_evaluations (remediation_status)",
]


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

    for table, columns in TABLES.items():
        if table not in present:
            print(f"{table}: table absent — created by create_all(), skipping")
            continue
        existing = {r[1] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}
        added = [c for c in columns if c not in existing]
        for col in added:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {columns[col]}")
        print(f"{table}: added {added}" if added else f"{table}: already up to date")

    if "control_evaluations" in present:
        cur.execute("UPDATE control_evaluations SET remediation_status = 'not_required' "
                    "WHERE remediation_status IS NULL")
        # Existing evaluations that already came out non-performant have a
        # follow-up that was never opened — open it now rather than leaving the
        # rule retroactively unmet for them.
        cur.execute("UPDATE control_evaluations SET remediation_status = 'open' "
                    "WHERE performance_level = 'non_performant' AND remediation_status = 'not_required'")
        if cur.rowcount:
            print(f"control_evaluations: opened follow-up on {cur.rowcount} "
                  f"existing non-performant evaluation(s)")
    if "applied_controls" in present:
        cur.execute("UPDATE applied_controls SET risk_ids = '[]' WHERE risk_ids IS NULL")

    for ddl in INDEXES:
        try:
            cur.execute(ddl)
        except sqlite3.OperationalError as exc:
            print(f"  index skipped: {exc}")
    print("indexes in place")

    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
