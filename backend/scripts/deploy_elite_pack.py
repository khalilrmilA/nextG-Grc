"""Run all Elite Pack column migrations idempotently, in dependency order.

New TABLES (mfa_devices, password_reset_tokens, control_evaluations, org_entities,
business_processes, cve_entries, cve_annotations, asset_valuation_history,
scan_journals, report_schedules, login_events) are auto-created by
Base.metadata.create_all on app startup. This runner handles the new COLUMNS added to
EXISTING tables (and the activity_logs hash-chain index).

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
    "scripts.migrate_add_activity_chain_columns",
]


def check_ocr_prerequisites() -> None:
    """OCR document capture needs OS packages, not just pip. Warn, never fail."""
    import shutil

    missing: list[str] = []
    if not shutil.which("tesseract"):
        missing.append("tesseract-ocr + tesseract-ocr-fra (apt)")
    if not shutil.which("pdftoppm"):
        missing.append("poppler-utils (apt)")
    for module, package in (("pytesseract", "pytesseract"), ("pypdf", "pypdf"), ("pdf2image", "pdf2image")):
        try:
            importlib.import_module(module)
        except ModuleNotFoundError:
            missing.append(f"{package} (pip)")
    if missing:
        print("WARNING: OCR document capture will return 503 until these are installed:")
        for item in missing:
            print(f"  - {item}")
    else:
        print("OCR prerequisites OK (tesseract, poppler, pytesseract, pypdf, pdf2image).")


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
    print("--- OCR prerequisites ---")
    check_ocr_prerequisites()
    print("\nDone. Restart the backend so create_all builds the new tables, "
          "then grant the pack with scripts.grant_elite_pack.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
