"""Idempotent migration: threat classification, profile validation, review cadence.

Adds to ``threats``:
  threat_type              the 4-family classification (operationnelle / ...)
  profile_status           draft | validated
  validated_by_id/_at      who signed the profile off, and when
  review_frequency_months  periodic-revision cadence (default 12)
  next_review_due          the date that cadence lands on
  adopted_from_id          provenance when copied out of the built-in catalogue

The ``threat_history`` table is new and is created by ``create_all()`` on
startup, so nothing is needed for it here.

Existing rows get profile_status='draft' and a 12-month cadence with no due
date, which reads exactly as today: no threat has been validated, and none is
overdue for a review that was never scheduled.

Usage:
    python -m scripts.migrate_add_threat_profile_governance
Safe to run repeatedly.
"""
import os
import sqlite3

TABLE = "threats"
COLUMNS = {
    "threat_type": "TEXT",
    "profile_status": "TEXT NOT NULL DEFAULT 'draft'",
    "validated_by_id": "TEXT",
    "validated_at": "TEXT",
    "review_frequency_months": "INTEGER NOT NULL DEFAULT 12",
    "next_review_due": "TEXT",
    "adopted_from_id": "TEXT",
}
INDEXES = {
    "ix_threats_threat_type": f"CREATE INDEX IF NOT EXISTS ix_threats_threat_type ON {TABLE} (threat_type)",
    "ix_threats_next_review_due": f"CREATE INDEX IF NOT EXISTS ix_threats_next_review_due ON {TABLE} (next_review_due)",
}


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
    return os.path.join(here, "grc_dev.db")


def _dedupe_and_constrain(cur) -> None:
    """Remove duplicate feed rows, then make them impossible.

    Both uvicorn workers run the threat-feed scheduler, read the same "already
    known" set and commit independently, so the same item is inserted twice.
    A pre-check in application code cannot fix a race between processes; a
    unique index can. The key is (tenant_id, ref_id, name), which was chosen by
    measuring the alternatives against the live register: name alone would
    reject genuinely distinct threats (CISA gives CVE-2026-25089 and
    CVE-2026-39808 the same title), and reference alone produced 1,416 false
    collisions because feed items without an identifier used to be numbered by
    position in the batch. The pair leaves 212 rows, and those are real
    duplicates.

    Only rows that are safe to remove are removed: pending (never validated
    into the register), not referenced by any risk scenario, and never the
    oldest of a group — the survivor is the one anything else would have
    pointed at. If duplicates remain that do not meet those conditions, the
    index is skipped and reported rather than forced: a constraint is not worth
    deleting a threat somebody accepted.
    """
    groups = cur.execute(
        "SELECT tenant_id, ref_id, name, COUNT(*) c FROM threats "
        "WHERE tenant_id IS NOT NULL GROUP BY tenant_id, ref_id, name HAVING c > 1"
    ).fetchall()
    if not groups:
        print("threats: no duplicate (tenant, ref_id, name) rows")
    else:
        removed = 0
        blocked = 0
        for tenant_id, ref_id, name, _count in groups:
            rows = cur.execute(
                "SELECT id, is_pending, created_at FROM threats "
                "WHERE tenant_id = ? AND ref_id IS ? AND name = ? "
                "ORDER BY created_at ASC, rowid ASC",
                (tenant_id, ref_id, name),
            ).fetchall()
            for threat_id, is_pending, _created in rows[1:]:  # keep the oldest
                referenced = cur.execute(
                    "SELECT 1 FROM risk_scenarios WHERE threat_ids LIKE ? LIMIT 1",
                    (f'%"{threat_id}"%',),
                ).fetchone()
                if referenced or not is_pending:
                    blocked += 1
                    continue
                cur.execute("DELETE FROM threats WHERE id = ?", (threat_id,))
                removed += 1
        print(f"threats: removed {removed} duplicate feed row(s) across {len(groups)} (ref, name) pair(s)"
              + (f"; {blocked} kept (validated or referenced by a scenario)" if blocked else ""))

    try:
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_threat_tenant_ref_name "
            "ON threats (tenant_id, ref_id, name)"
        )
        print("threats: unique (tenant_id, ref_id, name) index in place")
    except Exception as exc:  # noqa: BLE001 — duplicates that could not be removed
        print(f"threats: WARNING — unique index NOT created: {exc}")
        print("         Duplicate rows remain that are validated or referenced by a")
        print("         risk scenario. Resolve them by hand, then re-run this script.")


def main() -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    existing = {row[1] for row in cur.execute(f"PRAGMA table_info({TABLE})").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE {TABLE} ADD COLUMN {col} {ddl}")
            added.append(col)
    print(f"{TABLE}: added {added}" if added else f"{TABLE}: already up to date")

    # Normalise NULLs a prior partial run could have left, so the ORM always
    # loads a usable value for the NOT NULL columns.
    cur.execute(f"UPDATE {TABLE} SET profile_status = 'draft' WHERE profile_status IS NULL")
    if cur.rowcount:
        print(f"{TABLE}: normalised {cur.rowcount} NULL profile_status to 'draft'")
    cur.execute(f"UPDATE {TABLE} SET review_frequency_months = 12 WHERE review_frequency_months IS NULL")
    if cur.rowcount:
        print(f"{TABLE}: normalised {cur.rowcount} NULL review_frequency_months to 12")

    for name, ddl in INDEXES.items():
        cur.execute(ddl)
    print(f"{TABLE}: indexes in place ({', '.join(INDEXES)})")

    _dedupe_and_constrain(cur)

    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
