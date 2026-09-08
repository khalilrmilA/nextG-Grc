"""STB objectif 1 — assets.status, « leur statut » as its own indicator.

The tender asks the asset dashboard to show « leur statut » AND « le cycle de
vie » as two distinct indicators. The table had only `lifecycle_state`, so both
questions were being answered with the same column: an asset in the
`maintenance` phase could not say whether it was still serving (rolling patch)
or stopped on a bench, and a laptop `in_use` could not be declared lost.

Adds:

  assets.status   operational | degraded | out_of_service | quarantined | lost
                  (app.models.asset.AssetStatus — deliberately shares no value
                  with AssetLifecycleState, so the two columns cannot collapse
                  back into one)

and the index the model declares (`index=True` on a column added by ALTER TABLE
never materialises — ix_assets_asset_class and ix_assets_lifecycle_state are
both missing from the live database for exactly that reason).

BACKFILL — every existing row is given a value, so nothing reads as "unknown"
on the day this ships:

  * lifecycle_state retired / decommissioned  -> out_of_service
        Not a guess: an asset withdrawn from service is by definition no longer
        delivering it. On the live database this is 1 row of 11.
  * everything else (including a NULL lifecycle) -> operational
        The declared default meaning "in service". It is a declaration, not a
        measurement, and the operator can correct any row with
        PATCH /api/v1/assets/{id} {"status": "..."} — which writes the change to
        the hash-chained activity log, so the correction is itself auditable.

Only rows where status IS NULL are touched, so re-running is a no-op.

>>> ORDER MATTERS <<<
Run this BEFORE restarting the API, not after. The backend has no hot reload and
2 PM2 workers: the moment the new code loads, every ``select(Asset)`` in the app
asks for assets.status, and against a table that does not have it yet SQLite
raises OperationalError -> 500 -> the SPA hard-redirects the user to
/service-down. Adding the column first is backwards-compatible with the code
currently running (SQLAlchemy only selects the columns its model declares), so
migrating first leaves a zero-length window; restarting first breaks the asset
module, the asset dashboard, cartography and the CSV import until this is run.
assets.py answers 424 with this script's name if it is ever hit in that state.

    # rehearse on a snapshot first
    GRC_DB_PATH=/tmp/grc_rehearsal.db python -m scripts.migrate_add_asset_status
    # then, on the live database, BEFORE `pm2 restart grceye-backend`
    python -m scripts.migrate_add_asset_status
    # restart, then run it ONE more time (see below)
    python -m scripts.migrate_add_asset_status

The third run is not superstition. Between the ALTER and the restart the old
workers are still serving, and their Asset model has no `status`, so any asset
created through POST /assets in that window is inserted with status NULL — the
one case the backfill exists to prevent. Re-running afterwards is a no-op if
nothing was created (it only ever writes rows where status IS NULL) and repairs
those rows if something was. Until then such a row is reported as
"unspecified" by GET /assets/stats and is reachable with
GET /assets?status=unspecified, so it is visible rather than silently counted
as operational.
"""
import sqlite3

from scripts._stb_migrate_common import db_path, run

TABLE_COLUMNS = {
    "assets": {
        "status": "VARCHAR(20)",
    },
}

INDEXES = {
    "ix_assets_status": ("assets", "status"),
}

# The lifecycle phases that mean the asset has been withdrawn from service.
WITHDRAWN = ("retired", "decommissioned")

# The value that means "in service" — app.models.asset.AssetStatus.OPERATIONAL.
IN_SERVICE = "operational"
NOT_IN_SERVICE = "out_of_service"


def backfill() -> None:
    """Give every pre-existing row a status. Idempotent: only NULLs are written."""
    conn = sqlite3.connect(db_path())
    cur = conn.cursor()
    tables = {row[0] for row in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    if "assets" not in tables:
        print("assets: table absent — nothing to backfill")
        conn.close()
        return

    placeholders = ",".join("?" for _ in WITHDRAWN)
    cur.execute(
        f"UPDATE assets SET status = ? "
        f"WHERE status IS NULL AND lifecycle_state IN ({placeholders})",
        (NOT_IN_SERVICE, *WITHDRAWN),
    )
    withdrawn = cur.rowcount
    cur.execute("UPDATE assets SET status = ? WHERE status IS NULL", (IN_SERVICE,))
    in_service = cur.rowcount
    conn.commit()

    print(f"assets: backfilled {withdrawn} row(s) to status='{NOT_IN_SERVICE}' "
          f"(lifecycle {'/'.join(WITHDRAWN)})")
    print(f"assets: backfilled {in_service} row(s) to status='{IN_SERVICE}'")
    for value, count in cur.execute(
        "SELECT status, COUNT(*) FROM assets GROUP BY status ORDER BY status"
    ).fetchall():
        print(f"  status={value!r}: {count}")
    conn.close()


def main() -> int:
    code = run(TABLE_COLUMNS, INDEXES)
    if code != 0:
        return code
    backfill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
