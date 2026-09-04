"""Idempotent migration: record a SHA-256 for stored uploads.

Adds ``file_sha256`` to the tables that reference a file on disk, so a later
read can prove the bytes were not altered (see services/file_integrity.py):

    evidence.file_sha256
    uploaded_documents.file_sha256
    vendor_contracts.file_sha256

Existing rows keep NULL. That is deliberate — a file uploaded before checksums
existed has no trustworthy digest to backfill (computing one now would only
certify whatever is on disk today, including a file that had already been
altered), so those rows are reported as "unrecorded" rather than "verified".

Usage:
    python -m scripts.migrate_add_file_checksums
Safe to run repeatedly.
"""
import os
import sqlite3

TABLES = {
    "evidence": {"file_sha256": "VARCHAR(64)"},
    "uploaded_documents": {"file_sha256": "VARCHAR(64)"},
    "vendor_contracts": {"file_sha256": "VARCHAR(64)"},
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
    for table, columns in TABLES.items():
        tables = {r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if table not in tables:
            print(f"{table}: table not present — skipped")
            continue
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
