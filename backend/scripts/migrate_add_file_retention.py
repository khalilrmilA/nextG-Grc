"""Idempotent migration: retention columns + the indexes stored_file_versions declares.

Adds to stored_file_versions:
    retired_at   DATETIME  — when the version stopped being current, which is the
                             clock a retention policy counts from. updated_at is
                             not usable for this: any later write moves it.
    legal_hold   BOOLEAN   — exempt this version from every purge, regardless of
                             policy. A file under legal hold or subject to an
                             open audit must survive retention.

And creates the indexes the model declares but the live table never got — the
table was created before those declarations existed, so create_all() had already
made it and never revisited:
    ix_file_versions_parent  (tenant_id, parent_type, parent_id)
    ix_file_versions_seq     UNIQUE (parent_type, parent_id, version_number)
    ix_file_versions_purge   (status, retired_at)          -- purge candidate scan

The unique index is the one that matters: two uploads racing for the same parent
would otherwise both claim the same version_number. Creating it is only safe
while the table is small — this script refuses rather than silently skipping if
duplicates already exist, because a partially-unique history is worse than a
loud failure.

Usage:
    python -m scripts.migrate_add_file_retention
Safe to run repeatedly.
"""
import os
import sqlite3

TABLE = "stored_file_versions"

COLUMNS = {
    "retired_at": "DATETIME",
    "legal_hold": "BOOLEAN NOT NULL DEFAULT 0",
}

INDEXES = [
    ("ix_file_versions_parent", f"ON {TABLE} (tenant_id, parent_type, parent_id)", False),
    ("ix_file_versions_seq", f"ON {TABLE} (parent_type, parent_id, version_number)", True),
    ("ix_file_versions_purge", f"ON {TABLE} (status, retired_at)", False),
]


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
    return os.path.join(here, "grc_dev.db")


def main() -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    tables = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if TABLE not in tables:
        print(f"{TABLE}: table not present — nothing to do (create_all makes it on boot)")
        conn.close()
        return 0

    existing = {row[1] for row in cur.execute(f"PRAGMA table_info({TABLE})").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE {TABLE} ADD COLUMN {col} {ddl}")
            added.append(col)
    print(f"{TABLE}: added columns {added}" if added else f"{TABLE}: columns already up to date")

    # Backfill the retention clock for versions that are already retired. Their
    # updated_at is the best available approximation of when that happened.
    if "retired_at" in added:
        cur.execute(
            f"UPDATE {TABLE} SET retired_at = updated_at "
            f"WHERE retired_at IS NULL AND status IN ('deleted', 'superseded')"
        )
        print(f"{TABLE}: backfilled retired_at on {cur.rowcount} already-retired rows")

    have = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?", (TABLE,)).fetchall()}
    for name, spec, unique in INDEXES:
        if name in have:
            print(f"{TABLE}: index {name} already present")
            continue
        if unique:
            dupes = cur.execute(
                f"SELECT COUNT(*) FROM (SELECT parent_type, parent_id, version_number "
                f"FROM {TABLE} GROUP BY 1,2,3 HAVING COUNT(*) > 1)"
            ).fetchone()[0]
            if dupes:
                print(f"ERROR: {dupes} duplicate (parent_type, parent_id, version_number) "
                      f"groups — refusing to create {name}. Resolve the duplicates first.")
                conn.rollback()
                conn.close()
                return 1
        cur.execute(f"CREATE {'UNIQUE ' if unique else ''}INDEX {name} {spec}")
        print(f"{TABLE}: created index {name}")

    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
