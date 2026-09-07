"""Idempotent migration for the CVE knowledge base + impact traceability pass.

Two new columns on existing tables (new *tables* — cwe_entries — are created by
``Base.metadata.create_all()`` on startup and need nothing here):

* ``cve_entries.references`` — NVD reference links with their Patch / Mitigation
  / Vendor Advisory tags, so a CVE sheet can show a route to a fix.
* ``vulnerability_impact_history.linked_scenario_ids`` — which risk scenarios the
  impact evaluation was attached to at the moment it was scored.

``references`` is a SQL reserved word, so every statement quotes it. Existing
rows get an empty JSON list, which renders exactly as today: no links, no
scenarios.

Usage:
    python -m scripts.migrate_add_cve_references_and_impact_scenarios
Safe to run repeatedly.
"""
import os
import sqlite3

# table -> {column: (ddl, backfill_value)}
COLUMNS = {
    "cve_entries": {
        "references": ("TEXT NOT NULL DEFAULT '[]'", "[]"),
    },
    "vulnerability_impact_history": {
        "linked_scenario_ids": ("TEXT NOT NULL DEFAULT '[]'", "[]"),
    },
}


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

    for table, cols in COLUMNS.items():
        tables = {r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if table not in tables:
            # create_all() will build it with the column already present.
            print(f"{table}: table absent — will be created by create_all(), skipping")
            continue

        existing = {row[1] for row in cur.execute(f'PRAGMA table_info("{table}")').fetchall()}
        added = []
        for col, (ddl, default) in cols.items():
            if col not in existing:
                cur.execute(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {ddl}')
                added.append(col)
        print(f"{table}: added {added}" if added else f"{table}: already up to date")

        # Normalise any NULLs a prior partial run could have left, so the column
        # is always valid JSON for the ORM to load.
        for col, (_ddl, default) in cols.items():
            cur.execute(f'UPDATE "{table}" SET "{col}" = ? WHERE "{col}" IS NULL', (default,))
            if cur.rowcount:
                print(f"{table}: normalised {cur.rowcount} NULL {col} to {default}")

    # One triage per CVE per tenant. The search LEFT JOINs cve_annotations, so a
    # duplicate row would double the CVE in the results; create_all() will not
    # add an index to a table that already exists, so it has to happen here.
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "cve_annotations" in tables:
        dupes = cur.execute(
            "SELECT tenant_id, cve_id, COUNT(*) c FROM cve_annotations "
            "GROUP BY tenant_id, cve_id HAVING c > 1"
        ).fetchall()
        if dupes:
            # Keep the most recently updated row of each group — that is the
            # triage the tenant last expressed.
            cur.execute(
                "DELETE FROM cve_annotations WHERE id NOT IN ("
                "  SELECT id FROM cve_annotations a WHERE a.rowid = ("
                "    SELECT b.rowid FROM cve_annotations b"
                "    WHERE b.tenant_id = a.tenant_id AND b.cve_id = a.cve_id"
                "    ORDER BY b.updated_at DESC, b.rowid DESC LIMIT 1"
                "  )"
                ")"
            )
            print(f"cve_annotations: removed {cur.rowcount} duplicate triage row(s) "
                  f"across {len(dupes)} (tenant, cve) pair(s)")
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_cve_annotation_tenant_cve "
            "ON cve_annotations (tenant_id, cve_id)"
        )
        print("cve_annotations: unique (tenant_id, cve_id) index in place")

    conn.commit()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
