"""Provision the role profiles the per-dashboard gates name — STB objectifs 1-8.

Why this exists
---------------
``api/v1/endpoints/dashboards.py`` now carries a role gate per objective, and
five of them are *strict* (``require_roles_strict``: no super_admin/tenant_admin
auto-pass) because the tender clauses are exclusions — « limité aux analystes
sécurité », « réservé aux responsables sécurité », « réservé aux fonctions de
direction ». Measured on the live database at the time of writing, that leaves a
hole on both sides:

  * **No account on the whole platform holds** ``security_analyst``,
    ``executive``, ``risk_manager``, ``control_owner`` or ``business_owner``, so
    every strict clause can only be demonstrated *negatively* (as a 403). There
    is nobody to log in as to show the screen opening for the profile the clause
    names.
  * The tenant ``elite-demo`` ("Elite Pack Demo") is one of the two Elite
    tenants — i.e. one of the only two where ``custom_dashboards`` is unlocked
    and these gates are reached at all — and its single active account is
    ``elite@grceye.com``, a **tenant_admin**. Under the strict gates that account
    sees /assets and /audit and gets 403 on the other five. A tenant_admin
    cannot repair that alone: ``PATCH /users/{id}`` refuses a self-edit and
    TENANT_ADMIN is not in ASSIGNABLE_ROLES, so a roles edit would demote the
    account instead of adding to it.

Creating the profiles is the fix that keeps the clause true. Widening the gate —
``allow_admin=True``, or dropping an extra role into the tuple — makes the tender
statement false again, so it is not the answer to this.

What it does
------------
Creates one account per missing profile in ONE demo tenant. Users only: no
tenant, no subscription, no framework, no group, no delegation. It never touches
an account that already exists, so a password changed later is never reset by a
re-run, and it is safe to run repeatedly.

Safety
------
These accounts share a weak, documented demo password, so the script refuses any
tenant outside DEMO_SLUGS unless ``--force`` is given. This working copy is the
live production server: do not point it at a tenant holding real client data.
``users.email`` is UNIQUE platform-wide, not per tenant, so an address already
taken by another tenant is reported and skipped rather than aborting the run
halfway through with an IntegrityError.

Usage
-----
    cd backend && venv/bin/python -m scripts.seed_stb_dashboard_profiles              # dry run, elite-demo
    cd backend && venv/bin/python -m scripts.seed_stb_dashboard_profiles --apply
    cd backend && venv/bin/python -m scripts.seed_stb_dashboard_profiles --tenant demo --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
"""
import argparse
import json
import os
import sqlite3
import sys
import uuid

from app.core.security import hash_password

# Tenants this script will touch without --force.
DEMO_SLUGS = {"demo", "elite-demo"}

# (local_part, first, last, role, which dashboards this profile is the answer to)
PROFILES = [
    ("analyste.securite", "Yassine", "Mejri", "security_analyst",
     "objectifs 2 & 3 — « accès limité aux analystes sécurité » "
     "(/dashboards/vulnerabilities, /dashboards/threats), gate STRICT"),
    ("resp.risques", "Ines", "Chaabane", "risk_manager",
     "objectifs 4 & 5 — « réservé aux responsables sécurité » "
     "(/dashboards/risks, /dashboards/controls), gate STRICT"),
    ("prop.controle", "Marwen", "Hamdi", "control_owner",
     "objectif 5 — propriétaire de contrôle, même gate STRICT que risk_manager"),
    ("direction", "Sonia", "Ben Salah", "executive",
     "objectif 6 — « réservé aux fonctions de direction » (/dashboards/governance), "
     "gate STRICT ; profil lecture seule imposé par get_current_user"),
    ("prop.metier", "Karim", "Zouari", "business_owner",
     "objectif 1 — propriétaire métier des actifs (/dashboards/assets)"),
    ("resp.conformite", "Rania", "Jelassi", "compliance_manager",
     "objectifs 1 & 8 — conformité et « accès filtré par profil » (/dashboards/audit)"),
]


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tenant", default="elite-demo",
                    help="tenant slug to seed (default: elite-demo, the Elite tenant whose "
                         "only active account is a tenant_admin)")
    ap.add_argument("--password", default="demo123", help="shared demo password")
    ap.add_argument("--apply", action="store_true", help="write (default: dry run)")
    ap.add_argument("--force", action="store_true",
                    help="allow a tenant outside DEMO_SLUGS — refuses by default")
    args = ap.parse_args(argv)

    if args.tenant not in DEMO_SLUGS and not args.force:
        print(f"REFUSED: {args.tenant!r} is not a known demo tenant ({sorted(DEMO_SLUGS)}).")
        print("         These accounts carry a documented password. Re-run with --force")
        print("         only if you are certain this tenant holds no real client data.")
        return 2

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: no database at {path}")
        return 1
    print(f"Database: {path}")

    conn = sqlite3.connect(path)
    cur = conn.cursor()

    row = cur.execute("SELECT id, name FROM tenants WHERE slug = ?", (args.tenant,)).fetchone()
    if not row:
        print(f"ERROR: no tenant with slug {args.tenant!r}")
        conn.close()
        return 1
    tenant_id, tenant_name = row
    print(f"Tenant: {tenant_name!r} (slug={args.tenant}, id={tenant_id})\n")

    print("Current roster:")
    for email, role, active in cur.execute(
        "SELECT email, role, is_active FROM users WHERE tenant_id = ? ORDER BY email", (tenant_id,)
    ).fetchall():
        print(f"   {email:<44} {role:<20} {'active' if active else 'INACTIVE'}")

    wanted = {f"{local}@{args.tenant}.grceye.com": (first, last, role, why)
              for local, first, last, role, why in PROFILES}

    # email is UNIQUE platform-wide: check the whole table, not just this tenant.
    existing = {
        email: (tid, role)
        for email, tid, role in cur.execute(
            "SELECT email, tenant_id, role FROM users WHERE email IN (%s)"
            % ",".join("?" * len(wanted)), tuple(wanted)
        ).fetchall()
    }
    to_add = [(e, *v) for e, v in wanted.items() if e not in existing]
    here_already = {e: v for e, v in existing.items() if v[0] == tenant_id}
    elsewhere = {e: v for e, v in existing.items() if v[0] != tenant_id}

    if here_already:
        print(f"\nAlready present in this tenant — untouched ({len(here_already)}):")
        for e, (_tid, role) in sorted(here_already.items()):
            print(f"   {e:<44} {role}")
    if elsewhere:
        print(f"\nSKIPPED — address already used by ANOTHER tenant ({len(elsewhere)}):")
        for e, (tid, role) in sorted(elsewhere.items()):
            print(f"   {e:<44} {role:<20} tenant={tid}")

    if not to_add:
        print("\nNothing to create.")
        conn.close()
        return 0

    print(f"\nTo create ({len(to_add)}):")
    for email, first, last, role, why in to_add:
        print(f"   {email:<44} {role:<20} {first} {last}")
        print(f"      {why}")

    if not args.apply:
        print("\nDry run — re-run with --apply to write.")
        conn.close()
        return 0

    # One hash for the one shared password: Argon2 is deliberately expensive.
    hashed = hash_password(args.password)
    for email, first, last, role, _why in to_add:
        cur.execute(
            "INSERT INTO users (id, tenant_id, email, hashed_password, first_name, last_name, "
            "role, roles, excluded_roles, custom_role_ids, is_active, is_verified, "
            "must_change_password, failed_login_count) "
            "VALUES (?,?,?,?,?,?,?,?,'[]','[]',1,1,0,0)",
            (str(uuid.uuid4()), tenant_id, email, hashed, first, last, role, json.dumps([role])),
        )
    conn.commit()
    conn.close()

    print(f"\nCreated {len(to_add)} account(s) in {tenant_name!r}, password: {args.password!r}")
    print("must_change_password is 0 on purpose: a forced password change at the first")
    print("screen would break the demo script.")
    print("\nThe tenant_admin of this tenant still gets 403 on /dashboards/{vulnerabilities,")
    print("threats,risks,controls,governance} — that is the tender clause working, not a")
    print("regression. Demonstrate each objective from the account named above.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
