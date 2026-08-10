"""One-off cleanup: delete expired *test* tenants and all their data.

SAFETY DESIGN
-------------
- Targets an EXPLICIT allow-list of 17 tenant-id prefixes (the keyboard-mash /
  temp-mail trial tenants whose trial already expired). Nothing else is touched.
- Re-verifies at runtime that each target is subscription.status == 'trialing'
  with a trial_ends_at in the past — refuses to delete anything Active/Enterprise.
- Hard-coded PROTECTED name set (real clients) — aborts if a target ever resolves
  to one of them.
- Dry-run by DEFAULT: prints exactly what would be deleted. Pass --apply to do it,
  which first writes a timestamped backup of the DB.

Run:
    venv/bin/python scripts/cleanup_expired_test_tenants.py            # dry-run
    venv/bin/python scripts/cleanup_expired_test_tenants.py --apply    # delete
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "grc_dev.db"

# Expired test tenants (8-char id prefixes) — the ONLY tenants this will delete.
TARGET_PREFIXES = {
    "a9508d2e", "fc1be2a7", "a392c427", "fe4e04b7", "509d8cbb", "5186bbea",
    "c4e7cd89", "64dcd29b", "fab2d478", "0635cc4a", "9dd9879c", "e9a09baa",
    "dc25fe6b", "236c9569", "4ec207bf", "06e07392", "3f0f5658",
}

# Real tenants that must NEVER be deleted (belt-and-suspenders guard), keyed by
# id prefix because names are NOT unique (three tenants are named "studient":
# one Enterprise/Active to keep, two expired trials to delete).
PROTECTED_ID_PREFIXES = {
    "97c606ea",  # Acme Corp (Demo)
    "1d09d523",  # Platform Owner
    "665dfb39",  # nextstep
    "4f75b182",  # studient (enterprise, active)
    "5a8cd615",  # GRCeye
    "aeea5b75",  # claude
    "5004913e",  # NEXT STEP
    "9b349939",  # bvmt
    "2df16445",  # Ben Marzou
}
# Static invariant: nothing can be both a target and protected.
assert not (TARGET_PREFIXES & PROTECTED_ID_PREFIXES), "target/protected overlap!"

# Grandchild/child deletes (run BEFORE deleting the tenant-scoped parent rows).
# Each: (table, fk_column, subquery_selecting_parent_ids_for_target_tenants)
CHILD_DELETES = [
    ("control_requirements", "control_id",
     "SELECT id FROM framework_controls WHERE framework_id IN "
     "(SELECT id FROM frameworks WHERE tenant_id IN (%s))"),
    ("compliance_gaps", "assessment_id",
     "SELECT id FROM compliance_assessments WHERE tenant_id IN (%s)"),
    ("control_assessments", "assessment_id",
     "SELECT id FROM compliance_assessments WHERE tenant_id IN (%s)"),
    ("risk_assessments", "risk_id", "SELECT id FROM risks WHERE tenant_id IN (%s)"),
    ("risk_treatments", "risk_id", "SELECT id FROM risks WHERE tenant_id IN (%s)"),
    ("policy_attestations", "policy_id", "SELECT id FROM policies WHERE tenant_id IN (%s)"),
    ("policy_versions", "policy_id", "SELECT id FROM policies WHERE tenant_id IN (%s)"),
    ("audit_findings", "audit_id", "SELECT id FROM audits WHERE tenant_id IN (%s)"),
    ("audit_evidence", "audit_id", "SELECT id FROM audits WHERE tenant_id IN (%s)"),
    ("incident_timeline_entries", "incident_id", "SELECT id FROM incidents WHERE tenant_id IN (%s)"),
    ("vendor_assessments", "vendor_id", "SELECT id FROM vendors WHERE tenant_id IN (%s)"),
    ("vendor_contracts", "vendor_id", "SELECT id FROM vendors WHERE tenant_id IN (%s)"),
    ("vendor_risks", "vendor_id", "SELECT id FROM vendors WHERE tenant_id IN (%s)"),
    ("contract_messages", "collaboration_id",
     "SELECT id FROM contract_collaborations WHERE tenant_id IN (%s)"),
    ("ticket_messages", "ticket_id", "SELECT id FROM support_tickets WHERE tenant_id IN (%s)"),
    ("chat_sessions", "ticket_id", "SELECT id FROM support_tickets WHERE tenant_id IN (%s)"),
    ("framework_controls", "framework_id", "SELECT id FROM frameworks WHERE tenant_id IN (%s)"),
    ("notification_preferences", "user_id", "SELECT id FROM users WHERE tenant_id IN (%s)"),
]


def table_exists(cur, t):
    return cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone() is not None


def resolve_targets(cur):
    rows = cur.execute(
        "SELECT t.id, t.name, s.status, s.trial_ends_at "
        "FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id"
    ).fetchall()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    targets, refused = [], []
    for tid, name, status, trial_end in rows:
        if tid[:8] not in TARGET_PREFIXES:
            continue
        if tid[:8] in PROTECTED_ID_PREFIXES:
            print(f"!! ABORT: target {tid[:8]} is PROTECTED ('{name}')")
            sys.exit(3)
        # Re-verify it really is an expired trial before allowing deletion.
        ok = (status == "trialing") and (trial_end is not None) and (str(trial_end)[:10] < today)
        (targets if ok else refused).append((tid, name, status, trial_end))
    if refused:
        print("!! ABORT: these targets are NOT expired trials (unexpected):")
        for tid, name, status, te in refused:
            print(f"     {tid[:8]} {name!r} status={status} trial_end={te}")
        sys.exit(4)
    return [t[0] for t in targets], targets


def tenant_id_tables(cur):
    # fetchall() the table names BEFORE issuing PRAGMA on the same cursor —
    # sqlite3 invalidates an in-progress result set if the cursor is re-executed.
    names = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    out = []
    for t in names:
        cols = [r[1] for r in cur.execute(f"PRAGMA table_info({t})").fetchall()]
        if "tenant_id" in cols:
            out.append(t)
    return out


def main():
    apply = "--apply" in sys.argv
    con = sqlite3.connect(DB)
    cur = con.cursor()
    ids, meta = resolve_targets(cur)
    if len(ids) != len(TARGET_PREFIXES):
        print(f"!! ABORT: resolved {len(ids)} targets but expected {len(TARGET_PREFIXES)}.")
        sys.exit(5)

    print(f"{'APPLY' if apply else 'DRY-RUN'} — {len(ids)} expired test tenants to delete:")
    for tid, name, status, te in meta:
        print(f"    {tid[:8]}  {name[:30]:30} {status} exp={str(te)[:10]}")

    ph = ",".join("?" * len(ids))

    if apply:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        backup = DB.with_name(f"grc_dev.db.pre-cleanup-{stamp}.bak")
        # Consistent snapshot via the backup API (the backend may be writing).
        bcon = sqlite3.connect(backup)
        con.backup(bcon)
        bcon.close()
        print(f"\nBackup written: {backup.name}")
        cur.execute("PRAGMA foreign_keys=OFF")

    print("\nRows deleted per table:")
    total = 0
    # 1) children / grandchildren
    for table, _fk, subq in CHILD_DELETES:
        if not table_exists(cur, table):
            continue
        where = f"{_fk} IN ({subq % ph})"
        n = cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", ids).fetchone()[0]
        if n:
            if apply:
                cur.execute(f"DELETE FROM {table} WHERE {where}", ids)
            print(f"    {table:28} {n}")
            total += n
    # 2) everything scoped directly by tenant_id (users, subs, risks, frameworks, …)
    for table in sorted(tenant_id_tables(cur)):
        n = cur.execute(f"SELECT COUNT(*) FROM {table} WHERE tenant_id IN ({ph})", ids).fetchone()[0]
        if n:
            if apply:
                cur.execute(f"DELETE FROM {table} WHERE tenant_id IN ({ph})", ids)
            print(f"    {table:28} {n}")
            total += n
    # 3) the tenants themselves
    n = cur.execute(f"SELECT COUNT(*) FROM tenants WHERE id IN ({ph})", ids).fetchone()[0]
    if apply:
        cur.execute(f"DELETE FROM tenants WHERE id IN ({ph})", ids)
    print(f"    {'tenants':28} {n}")
    total += n

    if apply:
        con.commit()
        con.execute("VACUUM")
        print(f"\nDONE — {total} rows deleted, {len(ids)} tenants removed. Backup: {backup.name}")
    else:
        print(f"\nDRY-RUN — would delete {total} rows across the above tables. "
              f"Re-run with --apply to execute.")
    con.close()


if __name__ == "__main__":
    main()
