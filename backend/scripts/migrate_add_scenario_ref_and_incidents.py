"""Idempotent migration: scenario reference numbers and incident links.

Adds to ``risk_scenarios``:
  ref_id               "RS-0001" — unique per tenant, backfilled by creation
                       order. The primary key is a uuid: unique, but not
                       something anyone cites in a committee paper or an audit
                       finding. The requirement asks for an identifier that
                       guarantees traceability, which means one a person can
                       carry between the platform and a document.
  linked_incident_ids  Incidents that actually happened against the scenario.

Usage:
    python -m scripts.migrate_add_scenario_ref_and_incidents            # dry run
    python -m scripts.migrate_add_scenario_ref_and_incidents --apply
Safe to run repeatedly: a scenario that already has a reference keeps it.
"""
import os
import sqlite3
import sys

COLUMNS = {
    "ref_id": "TEXT",
    "linked_incident_ids": "TEXT NOT NULL DEFAULT '[]'",
}


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main(apply: bool) -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    existing = {r[1] for r in cur.execute("PRAGMA table_info(risk_scenarios)").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            if apply:
                cur.execute(f"ALTER TABLE risk_scenarios ADD COLUMN {col} {ddl}")
            added.append(col)
    print(f"risk_scenarios: {'added' if apply else 'would add'} {added}" if added
          else "risk_scenarios: already up to date")

    if apply and added:
        cur.execute("UPDATE risk_scenarios SET linked_incident_ids = '[]' "
                    "WHERE linked_incident_ids IS NULL")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_scenario_tenant_ref "
                    "ON risk_scenarios (tenant_id, ref_id)")

    # Backfill references per tenant, in creation order, without disturbing any
    # that already exist.
    if "ref_id" in existing or apply:
        tenants = [r[0] for r in cur.execute(
            "SELECT DISTINCT tenant_id FROM risk_scenarios WHERE tenant_id IS NOT NULL").fetchall()]
        assigned = 0
        for tenant_id in tenants:
            taken = {r[0] for r in cur.execute(
                "SELECT ref_id FROM risk_scenarios WHERE tenant_id = ? AND ref_id IS NOT NULL",
                (tenant_id,)).fetchall()}
            rows = cur.execute(
                "SELECT id FROM risk_scenarios WHERE tenant_id = ? AND ref_id IS NULL "
                "ORDER BY created_at ASC, rowid ASC", (tenant_id,)).fetchall()
            counter = 0
            for (sid,) in rows:
                counter += 1
                ref = f"RS-{counter:04d}"
                while ref in taken:
                    counter += 1
                    ref = f"RS-{counter:04d}"
                taken.add(ref)
                if apply:
                    cur.execute("UPDATE risk_scenarios SET ref_id = ? WHERE id = ?", (ref, sid))
                assigned += 1
        print(f"risk_scenarios: {'assigned' if apply else 'would assign'} {assigned} reference(s) "
              f"across {len(tenants)} tenant(s)")

    if apply:
        conn.commit()
        print("\nApplied.")
    else:
        print("\nDry run — re-run with --apply to write.")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
