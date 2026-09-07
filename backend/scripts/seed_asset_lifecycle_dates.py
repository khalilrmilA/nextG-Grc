"""Populate acquisition and end-of-life dates on assets that have none.

The end-of-life alerting exists and is wired (notification_generator.
check_asset_eol), but every asset had a NULL end_of_life_at, so it had nothing
to fire on and the lifecycle screen demonstrated a working feature with an empty
table.

Dates are chosen per asset type from published vendor lifecycles where one
exists (Oracle 19c premier support, Windows Server) and from ordinary refresh
cycles otherwise. They are **plausible defaults for a demonstration estate, not
assessed facts** — before this platform holds a real inventory, each date has to
be replaced with the one from that organisation's actual support contract.

Only rows where ``end_of_life_at`` is NULL are touched, so a real date entered
later is never overwritten, and re-running changes nothing.

Usage:
    python -m scripts.seed_asset_lifecycle_dates            # dry run
    python -m scripts.seed_asset_lifecycle_dates --apply
"""
import os
import sqlite3
import sys
from datetime import date

# Anchor everything to a fixed date so a re-run cannot drift and so the "due
# soon" cases stay due soon rather than sliding into the past.
TODAY = date(2026, 9, 7)

# (acquired years before today, end-of-life date). Deliberately spread so the
# estate shows overdue, imminent, and comfortable cases — an alerting feature
# that only ever shows an empty list demonstrates nothing.
BY_NAME = {
    # Already retired: its end-of-life is history, not a forecast.
    "legacy mainframe":            (12, date(2025, 12, 31)),
    # In maintenance and on a refresh cycle — inside the 90-day alert window.
    "branch workstations":         (5,  date(2026, 11, 30)),
    # Oracle 19c premier support ends April 2027 (published).
    "customer database (oracle)":  (4,  date(2027, 4, 30)),
    # Windows Server lifecycle.
    "domain controller ad":        (6,  date(2027, 1, 14)),
    "firewall":                    (5,  date(2027, 6, 30)),
    "swift gateway":               (4,  date(2027, 9, 30)),
    "web server":                  (3,  date(2027, 12, 31)),
    "backup storage array":        (3,  date(2028, 3, 31)),
    "internet banking portal":     (2,  date(2028, 6, 30)),
    "core banking application":    (7,  date(2028, 12, 31)),
}

# Fallback by type for anything not named above.
BY_TYPE = {
    "server":         (4, date(2027, 12, 31)),
    "workstation":    (4, date(2027, 6, 30)),
    "network_device": (5, date(2028, 6, 30)),
    "database":       (4, date(2027, 12, 31)),
    "application":    (5, date(2028, 12, 31)),
    "cloud_service":  (2, date(2028, 12, 31)),
    "mobile_device":  (3, date(2027, 9, 30)),
    "iot_device":     (3, date(2027, 9, 30)),
}
DEFAULT = (4, date(2028, 6, 30))


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def _plan(name: str, asset_type: str):
    key = (name or "").strip().lower()
    if key in BY_NAME:
        return BY_NAME[key]
    return BY_TYPE.get((asset_type or "").lower(), DEFAULT)


def main(apply: bool) -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    rows = cur.execute(
        "SELECT id, name, asset_type, acquired_at, end_of_life_at FROM assets "
        "WHERE end_of_life_at IS NULL"
    ).fetchall()
    if not rows:
        print("Every asset already has an end-of-life date — nothing to do.")
        conn.close()
        return 0

    print(f"{len(rows)} asset(s) without an end-of-life date:\n")
    for aid, name, atype, acquired, _eol in rows:
        years, eol = _plan(name, atype)
        acq = acquired or f"{TODAY.year - years}-01-15 00:00:00"
        days = (eol - TODAY).days
        when = "OVERDUE" if days < 0 else (f"in {days}d" + (" — alerts" if days <= 90 else ""))
        print(f"  {(name or '')[:32]:34} {atype:14} eol={eol}  ({when})")
        if apply:
            cur.execute(
                "UPDATE assets SET end_of_life_at = ?, acquired_at = COALESCE(acquired_at, ?) "
                "WHERE id = ?",
                (f"{eol} 00:00:00", acq, aid),
            )

    if apply:
        conn.commit()
        print(f"\nApplied to {len(rows)} asset(s).")
    else:
        print("\nDry run — re-run with --apply to write.")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
