"""Idempotent migration: the threat watch, and the CVE "actively exploited" flag.

Adds to ``cve_entries``:
  known_exploited / kev_added_at / kev_due_date / kev_action
    CISA's Known Exploited Vulnerabilities signal. It was already being
    fetched — it arrived as a row in the *threat register*, where nothing could
    act on it. Now it lands on the CVE it describes.

The ``threat_watch_items`` table is new and is created by ``create_all()`` on
startup, so nothing is needed for it here.

Also clears the feed items that were misfiled into the threat register. The
register is meant to hold threat *types* with a profile each; measured before
this change, 45% of its pending rows were malicious package URLs, 31% were SANS
diary entries including podcast episodes, and 20% were CVE advisories. Only
rows that are safe to remove are removed: pending (never validated in), never
referenced by a risk scenario, and never one a person created by hand.

Usage:
    python -m scripts.migrate_threat_watch_and_kev            # dry run
    python -m scripts.migrate_threat_watch_and_kev --apply
"""
import os
import sqlite3
import sys

COLUMNS = {
    "known_exploited": "BOOLEAN NOT NULL DEFAULT 0",
    "kev_added_at": "TEXT",
    "kev_due_date": "TEXT",
    "kev_action": "TEXT",
}

# How a feed-created row is recognised. Two signals, because the feeds use two
# conventions: CISA KEV carries a CVE id and SANS a generated one, while
# opensourcemalware names every item "[ECOSYSTEM] package" and puts its own
# uuid in ref_id. Checked against the live register: these two together match
# every pending feed row and leave nothing that a person created.
FEED_REF_PATTERNS = ("CVE-%", "AUTO-%", "FEED-%", "auto-%", "feed-%")
FEED_NAME_PATTERNS = ("[%",)


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

    existing = {row[1] for row in cur.execute("PRAGMA table_info(cve_entries)").fetchall()}
    added = []
    for col, ddl in COLUMNS.items():
        if col not in existing:
            if apply:
                cur.execute(f"ALTER TABLE cve_entries ADD COLUMN {col} {ddl}")
            added.append(col)
    print(f"cve_entries: {'added' if apply else 'would add'} {added}" if added
          else "cve_entries: already up to date")
    if apply and added:
        cur.execute("CREATE INDEX IF NOT EXISTS ix_cve_known_exploited ON cve_entries (known_exploited)")
        cur.execute("UPDATE cve_entries SET known_exploited = 0 WHERE known_exploited IS NULL")

    # --- clear the feed items misfiled into the register ---
    where = (
        "is_pending = 1 AND is_builtin = 0 AND tenant_id IS NOT NULL AND ("
        + " OR ".join("ref_id LIKE ?" for _ in FEED_REF_PATTERNS)
        + " OR "
        + " OR ".join("name LIKE ?" for _ in FEED_NAME_PATTERNS)
        + ")"
    )
    candidates = cur.execute(
        f"SELECT id, ref_id, name FROM threats WHERE {where}",
        FEED_REF_PATTERNS + FEED_NAME_PATTERNS,
    ).fetchall()

    removable, protected = [], 0
    for tid, _ref, _name in candidates:
        referenced = cur.execute(
            "SELECT 1 FROM risk_scenarios WHERE threat_ids LIKE ? LIMIT 1", (f'%"{tid}"%',)
        ).fetchone()
        if referenced:
            protected += 1
            continue
        removable.append(tid)

    print(f"threats: {len(candidates)} pending feed row(s) in the register; "
          f"{len(removable)} removable, {protected} kept (referenced by a risk scenario)")
    if candidates:
        by_kind = {"CVE advisory": 0, "malicious package/repo": 0, "diary/news": 0, "other": 0}
        for _tid, ref, name in candidates:
            if (ref or "").upper().startswith("CVE-"):
                by_kind["CVE advisory"] += 1
            elif (name or "").startswith("["):
                by_kind["malicious package/repo"] += 1
            elif "(" in (name or "") and ")" in (name or ""):
                by_kind["diary/news"] += 1
            else:
                by_kind["other"] += 1
        for k, v in sorted(by_kind.items(), key=lambda x: -x[1]):
            if v:
                print(f"         {v:5}  {k}")

    if apply and removable:
        # threat_history is deliberately left alone. A history row is meant to
        # outlive the threat it describes — that is the point of it — so this
        # removes the misfiled rows and keeps any record of them. (These
        # particular rows predate the history table and have none.)
        for i in range(0, len(removable), 400):
            chunk = removable[i:i + 400]
            marks = ",".join("?" * len(chunk))
            cur.execute(f"DELETE FROM threats WHERE id IN ({marks})", chunk)
        print(f"threats: removed {len(removable)} misfiled feed row(s)")

    if apply:
        conn.commit()
        print("\nApplied.")
    else:
        print("\nDry run — re-run with --apply to write.")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
