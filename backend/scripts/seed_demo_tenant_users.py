"""Give the demo tenant the roles its documented screens need — STB objectif 4.

Measured on the live database: the tenant behind the documented login
``admin@demo.com`` (slug ``demo``, "Acme Corp (Demo)") contains exactly two users —
that CISO and a disabled ``system+…@grceye.local`` viewer. It has **no
tenant_admin and no auditor at all**. The consequences are not cosmetic:

  * « Affectation des auditeurs » lists an empty roster with no explanation, so
    the objectif-4 workflow cannot be shown at all;
  * ``/company-admin`` and every tenant-admin-gated route answer 403 to the
    documented login;
  * the auditor portal cannot be opened, because no account can reach it;
  * ``ciso@demo.com`` and ``auditor@demo.com``, both printed in CLAUDE.md as
    working demo logins, do not exist.

This adds the missing accounts to that one tenant. It creates users only — no
tenant, no subscription, no framework — and it never touches an account that
already exists, so a password changed later is never reset by a re-run.

One auditor is internal and one is external (``is_external`` / ``external_org``,
added by migrate_add_stb_actor_columns.py), because objectif 4 asks for
« auditeurs internes ou externes » and a bank has to be able to show its
regulator which is which.

Safety: these accounts share the weak, publicly documented demo password, so the
script refuses to run against any tenant outside DEMO_SLUGS unless ``--force`` is
given. This working copy is the live production server; do not point it at a
tenant holding real client data.

Usage:
    cd backend && venv/bin/python -m scripts.seed_demo_tenant_users
    cd backend && venv/bin/python -m scripts.seed_demo_tenant_users --apply
    cd backend && venv/bin/python -m scripts.seed_demo_tenant_users --tenant demo --password 'demo123' --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
Safe to re-run: matches on email and skips anything already present.
"""
import argparse
import json
import os
import sqlite3
import sys
import uuid

from app.core.security import hash_password

# Tenants this script will touch without --force. Anything else is presumed to
# hold real data, and a documented password must never land there.
DEMO_SLUGS = {"demo", "elite-demo"}

# (email, first, last, role, is_external, external_org, why)
DEMO_USERS = [
    ("tenantadmin@demo.com", "Amine", "Trabelsi", "tenant_admin", False, None,
     "objectif 4 : le poste qui affecte les auditeurs et administre l'organisation"),
    ("ciso@demo.com", "Leïla", "Gharbi", "ciso", False, None,
     "login documenté dans CLAUDE.md qui n'existait pas"),
    ("auditor@demo.com", "Sami", "Bouzid", "auditor", False, None,
     "auditeur interne — login documenté dans CLAUDE.md qui n'existait pas"),
    ("auditeur.externe@demo.com", "Nadia", "Karoui", "auditor", True,
     "Cabinet d'audit externe (démonstration)",
     "objectif 4 : « auditeurs internes ou externes » — le cas externe"),
]


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tenant", default="demo", help="tenant slug to seed (default: demo)")
    ap.add_argument("--password", default="demo123",
                    help="password for the created accounts (default: the documented demo password)")
    ap.add_argument("--force", action="store_true",
                    help="allow a tenant outside DEMO_SLUGS — refuses by default")
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry run")
    args = ap.parse_args(argv)

    if args.tenant not in DEMO_SLUGS and not args.force:
        print(f"REFUSED: {args.tenant!r} is not a known demo tenant ({sorted(DEMO_SLUGS)}).")
        print("         These accounts use a publicly documented password. Pass --force")
        print("         only if you are certain this tenant holds no real client data.")
        return 2

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    row = cur.execute("SELECT id, name FROM tenants WHERE slug = ?", (args.tenant,)).fetchone()
    if not row:
        print(f"ERROR: no tenant with slug {args.tenant!r}")
        conn.close()
        return 2
    tenant_id, tenant_name = row

    user_cols = {r[1] for r in cur.execute("PRAGMA table_info(users)").fetchall()}
    # is_external/external_org come from migrate_add_stb_actor_columns.py. Without
    # them the internal/external distinction cannot be recorded, and seeding two
    # indistinguishable auditors would misrepresent the capability.
    has_external = {"is_external", "external_org"} <= user_cols
    if not has_external:
        print("WARNING: users.is_external / external_org are missing — run")
        print("         scripts/migrate_add_stb_actor_columns.py first for the")
        print("         internal/external distinction. Seeding without it.")

    print(f"Tenant: {tenant_name!r} (slug={args.tenant}, id={tenant_id})")
    existing = cur.execute(
        "SELECT email, role, is_active FROM users WHERE tenant_id = ? ORDER BY email",
        (tenant_id,),
    ).fetchall()
    print(f"Current members ({len(existing)}):")
    for email, role, active in existing:
        print(f"   {email:<40} {role:<14} {'active' if active else 'INACTIVE'}")

    present = {e for e, _r, _a in existing}

    # users.email is UNIQUE across the WHOLE platform, not per tenant. Matching
    # only on this tenant's roster hands sqlite an IntegrityError halfway through
    # the loop — aborting the run with a traceback and writing nothing — as soon
    # as one of these addresses exists elsewhere. That is not hypothetical: it is
    # exactly what `--tenant elite-demo` does once `demo` has been seeded, and
    # elite-demo is an allowed slug. Report the clash, skip the row, keep going.
    taken_elsewhere = {
        email: (tid, role)
        for email, tid, role in cur.execute(
            "SELECT email, tenant_id, role FROM users WHERE email IN (%s)"
            % ",".join("?" * len(DEMO_USERS)),
            [u[0] for u in DEMO_USERS],
        ).fetchall()
        if tid != tenant_id
    }

    to_add = [u for u in DEMO_USERS
              if u[0] not in present and u[0] not in taken_elsewhere]

    print(f"\n{len(DEMO_USERS)} demo accounts defined; {len(to_add)} missing:")
    for email, first, last, role, is_ext, org, why in to_add:
        kind = f"externe ({org})" if is_ext else "interne"
        print(f"   {email:<40} {role:<14} {kind}")
        print(f"      → {why}")
    if taken_elsewhere:
        print(f"\nSKIPPED — {len(taken_elsewhere)} address(es) already used by ANOTHER tenant")
        print("   (users.email is globally unique, so these cannot be created here):")
        for email, (tid, role) in sorted(taken_elsewhere.items()):
            print(f"   {email:<40} {role:<14} tenant={tid}")
    if not to_add:
        print("   (none — nothing to do)")
        conn.close()
        return 0

    if not args.apply:
        print("\nDry run — re-run with --apply to write.")
        conn.close()
        return 0

    # One hash per distinct password, not one per user: Argon2 is deliberately
    # expensive and every account here shares the same demo password.
    hashed = hash_password(args.password)

    for email, first, last, role, is_ext, org, _why in to_add:
        if has_external:
            cur.execute(
                "INSERT INTO users (id, tenant_id, email, hashed_password, first_name, last_name, "
                "role, roles, excluded_roles, custom_role_ids, is_active, is_verified, "
                "must_change_password, failed_login_count, is_external, external_org) "
                "VALUES (?,?,?,?,?,?,?,?,'[]','[]',1,1,0,0,?,?)",
                (str(uuid.uuid4()), tenant_id, email, hashed, first, last, role,
                 json.dumps([role]), 1 if is_ext else 0, org),
            )
        else:
            cur.execute(
                "INSERT INTO users (id, tenant_id, email, hashed_password, first_name, last_name, "
                "role, roles, excluded_roles, custom_role_ids, is_active, is_verified, "
                "must_change_password, failed_login_count) "
                "VALUES (?,?,?,?,?,?,?,?,'[]','[]',1,1,0,0)",
                (str(uuid.uuid4()), tenant_id, email, hashed, first, last, role,
                 json.dumps([role])),
            )

    conn.commit()
    conn.close()
    print(f"\nCreated {len(to_add)} account(s) in {tenant_name!r}, password: {args.password!r}")
    print("must_change_password is 0 on purpose: these are documented demo logins and a")
    print("forced password change at the first screen would break the demo script.")
    print("Assigning an auditor to an engagement stays a manual act by the tenant_admin/CISO")
    print("— this script only makes the roster non-empty.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
