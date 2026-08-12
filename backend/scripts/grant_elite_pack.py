"""Grant (or change) a tenant's subscription tier — used to enable the Elite Pack.

The Elite Pack (all STB / RFP cyber-risk capabilities) is unlocked by setting a
tenant's subscription tier to ``elite``. This script is idempotent and works
directly against the SQLite database (dev / on-prem / demo). For PostgreSQL prod,
run the equivalent UPDATE via your DB console.

Usage:
    python -m scripts.grant_elite_pack --tenant <slug-or-id>
    python -m scripts.grant_elite_pack --tenant acme --to enterprise   # downgrade
    python -m scripts.grant_elite_pack --list                          # show tiers
"""
import argparse
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

VALID_TIERS = {"starter", "professional", "enterprise", "elite"}


def _db_path() -> str:
    # Mirrors app.core.config default; override with GRC_DB_PATH if needed.
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
    return os.path.join(here, "grc_dev.db")


def _resolve_tenant(cur: sqlite3.Cursor, ident: str) -> tuple[str, str] | None:
    row = cur.execute(
        "SELECT id, name FROM tenants WHERE id = ? OR slug = ?", (ident, ident)
    ).fetchone()
    return (row[0], row[1]) if row else None


def main() -> int:
    ap = argparse.ArgumentParser(description="Enable the Elite Pack for a tenant.")
    ap.add_argument("--tenant", help="Tenant slug or id")
    ap.add_argument("--to", default="elite", help="Target tier (default: elite)")
    ap.add_argument("--list", action="store_true", help="List all tenants and tiers")
    args = ap.parse_args()

    target = args.to.lower()
    if target not in VALID_TIERS:
        print(f"ERROR: --to must be one of {sorted(VALID_TIERS)}", file=sys.stderr)
        return 2

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}", file=sys.stderr)
        return 2

    conn = sqlite3.connect(path)
    cur = conn.cursor()

    if args.list:
        rows = cur.execute(
            """SELECT t.slug, t.name, COALESCE(s.tier, '(none)')
               FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id
               ORDER BY t.slug"""
        ).fetchall()
        for slug, name, tier in rows:
            print(f"  {tier:14} {slug:24} {name}")
        conn.close()
        return 0

    if not args.tenant:
        ap.error("--tenant is required unless --list is given")

    resolved = _resolve_tenant(cur, args.tenant)
    if not resolved:
        print(f"ERROR: no tenant matching '{args.tenant}'", file=sys.stderr)
        conn.close()
        return 1
    tenant_id, tenant_name = resolved

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    existing = cur.execute(
        "SELECT id, tier FROM subscriptions WHERE tenant_id = ?", (tenant_id,)
    ).fetchone()

    if existing:
        sub_id, old_tier = existing
        cur.execute(
            "UPDATE subscriptions SET tier = ?, status = 'active', updated_at = ? WHERE id = ?",
            (target, now, sub_id),
        )
        print(f"Updated '{tenant_name}': {old_tier} -> {target}")
    else:
        cur.execute(
            """INSERT INTO subscriptions
               (id, tenant_id, tier, status, billing_cycle, currency, custom_limits,
                created_at, updated_at)
               VALUES (?, ?, ?, 'active', 'annual', 'USD', '{}', ?, ?)""",
            (str(uuid.uuid4()), tenant_id, target, now, now),
        )
        print(f"Created subscription for '{tenant_name}' at tier '{target}'")

    conn.commit()
    conn.close()
    if target == "elite":
        print("Elite Pack enabled. Restart the backend workers to apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
