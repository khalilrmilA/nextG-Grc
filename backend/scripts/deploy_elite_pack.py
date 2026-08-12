"""Run all Elite Pack column migrations idempotently, in dependency order.

New TABLES (mfa_devices, password_reset_tokens, control_evaluations, org_entities,
business_processes, cve_entries, cve_annotations, asset_valuation_history,
scan_journals) are auto-created by Base.metadata.create_all on app startup.
This runner handles the new COLUMNS added to EXISTING tables.

Deploy sequence:
    cd backend
    python -m scripts.deploy_elite_pack        # add columns (idempotent)
    pm2 restart grceye-backend                 # create_all builds new tables
    python -m scripts.grant_elite_pack --tenant <slug>   # enable the pack

Set GRC_DB_PATH to target a non-default database.
"""
import importlib

MIGRATIONS = [
    "scripts.migrate_add_access_columns",
    "scripts.migrate_add_asset_columns",
    "scripts.migrate_add_risk_columns",
    "scripts.migrate_add_threat_columns",
    "scripts.migrate_add_vuln_columns",
]


def main() -> int:
    rc = 0
    for name in MIGRATIONS:
        print(f"--- {name} ---")
        try:
            mod = importlib.import_module(name)
            result = mod.main() or 0
            rc = rc or result
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f"ERROR in {name}: {exc}")
            rc = 1
    print("\nDone. Restart the backend so create_all builds the new tables, "
          "then grant the pack with scripts.grant_elite_pack.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
