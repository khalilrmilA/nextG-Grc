"""Consistent, rotated backups of the live SQLite database.

Uses SQLite's online backup API, so it is safe to run while the app is serving (unlike a
plain file copy, which can catch a half-written WAL). Keeps the most recent KEEP snapshots
under backend/backups/ and prunes older ones.

Cron example (hourly):
    0 * * * * cd /root/Desktop/GRC/backend && venv/bin/python -m scripts.backup_db >> /var/log/grc-backup.log 2>&1

Env:
    GRC_DB_PATH   override the source DB path
    GRC_BACKUP_KEEP  how many snapshots to retain (default 48)
"""
import glob
import os
import sqlite3
from datetime import datetime, timezone


def main() -> int:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
    src = os.environ.get("GRC_DB_PATH") or os.path.join(here, "grc_dev.db")
    keep = int(os.environ.get("GRC_BACKUP_KEEP", "48"))

    if not os.path.exists(src):
        print(f"ERROR: no database at {src}")
        return 1

    outdir = os.path.join(here, "backups")
    os.makedirs(outdir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    dst = os.path.join(outdir, f"grc_dev-{stamp}.db")

    # Online, transactionally-consistent snapshot.
    con = sqlite3.connect(src)
    bck = sqlite3.connect(dst)
    try:
        with bck:
            con.backup(bck)
    finally:
        bck.close()
        con.close()
    print(f"backup -> {dst} ({os.path.getsize(dst) // 1024} KB)")

    # Rotation: keep the newest `keep`, prune the rest.
    snaps = sorted(glob.glob(os.path.join(outdir, "grc_dev-*.db")))
    for old in snaps[:-keep] if keep > 0 else []:
        os.remove(old)
        print(f"pruned {os.path.basename(old)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
