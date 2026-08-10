"""
Build a CLEAN client seed database for on-prem releases.

Takes the (live) SaaS SQLite database as READ-ONLY input, produces a stripped
copy that contains ONLY built-in reference data (frameworks, controls, threats,
mandatory documents) plus one freshly created client tenant + tenant_admin user
+ enterprise subscription. Every other table is emptied so NO customer data can
ever ship inside a client release.

The source database is NEVER modified: it is opened read-only and snapshotted
into the output file via the sqlite3 backup API (consistent even while the
live app is writing).

Usage (run with backend/venv/bin/python):

    backend/venv/bin/python backend/scripts/make_client_seed_db.py \
        --source backend/grc_dev.db \
        --out release/seed/grc_seed.db \
        --company "Acme Corp" \
        --admin-email admin@acme.example \
        --admin-password 'S0me-Strong-Passw0rd'

Exits non-zero if any post-build safety assertion fails.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

# Make the backend package importable regardless of CWD (script lives in backend/scripts/)
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))

# Tables whose rows are (partially) KEPT. Everything else is wiped entirely.
#   frameworks           -> keep is_builtin=1 only
#   framework_controls   -> keep rows belonging to kept frameworks
#   control_requirements -> keep rows belonging to kept controls
#   threats              -> keep is_builtin=1 only (all rows if no such column)
#   mandatory_documents  -> keep rows with no tenant linkage (all rows if not tenant-scoped)
#   alembic_version      -> left untouched (migration bookkeeping, no customer data)
KEEP_TABLES = {
    "frameworks",
    "framework_controls",
    "control_requirements",
    "threats",
    "mandatory_documents",
    "alembic_version",
}

# Tables that MUST be empty in the output — verified again by the paranoid
# re-open pass at the end (a subset of "everything not in KEEP_TABLES").
# License tables may not exist yet in older source DBs; verify_output skips
# tables that are absent.
MUST_BE_EMPTY = [
    "risks",
    "vendors",
    "audits",
    "policies",
    "incidents",
    "activity_logs",
    "issued_licenses",
    "license_activations",
]


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')]


def _list_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    return [r[0] for r in rows]


def _slugify(name: str) -> str:
    value = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "client"


def snapshot_source(source: Path, out: Path) -> None:
    """Copy source -> out via the sqlite backup API. Source opened READ-ONLY."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    for suffix in ("-wal", "-shm"):
        stale = Path(str(out) + suffix)
        if stale.exists():
            stale.unlink()
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(str(out))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


def wipe_copy(out: Path) -> tuple[dict[str, int], list[str]]:
    """Operate ONLY on the copy: wipe every table except the keep-list.

    Returns ({kept_table: row_count}, [wiped table names]).
    """
    conn = sqlite3.connect(str(out))
    try:
        conn.execute("PRAGMA foreign_keys=OFF")  # wipe order must not matter
        tables = _list_tables(conn)

        wiped: list[str] = []
        for table in tables:
            if table in KEEP_TABLES:
                continue
            conn.execute(f'DELETE FROM "{table}"')
            wiped.append(table)

        # Keep-list pruning. Tenant clones of built-in frameworks/threats have
        # is_builtin=0, but also drop any row with a tenant_id as belt-and-braces.
        if "frameworks" in tables:
            conn.execute("DELETE FROM frameworks WHERE is_builtin IS NOT 1")
            if "tenant_id" in _table_columns(conn, "frameworks"):
                conn.execute("DELETE FROM frameworks WHERE tenant_id IS NOT NULL")
        if "framework_controls" in tables:
            conn.execute(
                "DELETE FROM framework_controls WHERE framework_id NOT IN (SELECT id FROM frameworks)"
            )
        if "control_requirements" in tables:
            conn.execute(
                "DELETE FROM control_requirements WHERE control_id NOT IN (SELECT id FROM framework_controls)"
            )
        if "threats" in tables:
            if "is_builtin" in _table_columns(conn, "threats"):
                conn.execute("DELETE FROM threats WHERE is_builtin IS NOT 1")
            if "tenant_id" in _table_columns(conn, "threats"):
                conn.execute("DELETE FROM threats WHERE tenant_id IS NOT NULL")
        if "mandatory_documents" in tables:
            if "tenant_id" in _table_columns(conn, "mandatory_documents"):
                conn.execute("DELETE FROM mandatory_documents WHERE tenant_id IS NOT NULL")

        # Reset autoincrement counters for wiped tables (present only when a
        # table uses AUTOINCREMENT — this schema uses UUID PKs, so usually absent)
        has_sequence = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='sqlite_sequence'"
        ).fetchone()[0]
        if has_sequence:
            for table in wiped:
                conn.execute("DELETE FROM sqlite_sequence WHERE name=?", (table,))

        conn.commit()

        kept_counts = {
            t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            for t in sorted(KEEP_TABLES)
            if t in tables
        }
        return kept_counts, wiped
    finally:
        conn.close()


def create_client_tenant(out: Path, company: str, admin_email: str, admin_password: str) -> str:
    """Create the client's tenant + tenant_admin user + enterprise subscription.

    Uses the app's own models and hash_password so the rows are exactly what
    the register endpoint would write (JSON defaults for features / settings /
    selected_framework_ids / roles included via the ORM column defaults).
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    import app.models  # noqa: F401 — register ALL models so string relationships resolve
    import app.models.ai_access  # noqa: F401 — not re-exported by app.models but referenced by Tenant/User relationships
    from app.core.security import hash_password
    from app.models.tenant import Tenant
    from app.models.user import User, UserRole
    from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus

    engine = create_engine(f"sqlite:///{out}")
    try:
        with Session(engine) as session:
            tenant = Tenant(
                name=company,
                slug=_slugify(company),
                selected_framework_ids=[],
            )
            session.add(tenant)
            session.flush()  # get tenant.id

            subscription = Subscription(
                tenant_id=tenant.id,
                tier=SubscriptionTier.ENTERPRISE,
                status=SubscriptionStatus.ACTIVE,
                current_period_start=datetime.now(timezone.utc).isoformat(),
            )
            session.add(subscription)

            user = User(
                tenant_id=tenant.id,
                email=admin_email.strip().lower(),
                hashed_password=hash_password(admin_password),
                first_name="Admin",
                last_name=company,
                role=UserRole.TENANT_ADMIN,
                is_active=True,
                is_verified=True,
            )
            session.add(user)
            session.commit()
            return user.email
    finally:
        engine.dispose()


def vacuum(out: Path) -> None:
    conn = sqlite3.connect(str(out))
    try:
        conn.execute("VACUUM")
    finally:
        conn.close()


def verify_output(out: Path, admin_email: str) -> list[str]:
    """Paranoid re-open of the finished file. Returns a list of failures."""
    failures: list[str] = []
    conn = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
    try:
        tables = set(_list_tables(conn))

        def count(table: str) -> int:
            return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

        if count("users") != 1:
            failures.append(f"users count is {count('users')}, expected exactly 1")
        if count("tenants") != 1:
            failures.append(f"tenants count is {count('tenants')}, expected exactly 1")
        for table in MUST_BE_EMPTY:
            if table not in tables:
                continue  # e.g. license tables absent in older source DBs
            n = count(table)
            if n != 0:
                failures.append(f"{table} still has {n} rows — CUSTOMER DATA WOULD LEAK")
        non_builtin = conn.execute(
            "SELECT COUNT(*) FROM frameworks WHERE is_builtin IS NOT 1"
        ).fetchone()[0]
        if non_builtin:
            failures.append(f"{non_builtin} non-builtin frameworks survived the wipe")
        if conn.execute("SELECT COUNT(*) FROM frameworks").fetchone()[0] == 0:
            failures.append("frameworks table is empty — seed would ship without reference data")
        row = conn.execute("SELECT email, role FROM users").fetchone()
        if row and row[0] != admin_email.strip().lower():
            failures.append(f"admin user email mismatch: {row[0]}")
    finally:
        conn.close()
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a clean client seed database.")
    parser.add_argument("--source", required=True, help="Path to the source SQLite DB (opened read-only)")
    parser.add_argument("--out", required=True, help="Path for the cleaned output DB")
    parser.add_argument("--company", required=True, help="Client company name (initial tenant)")
    parser.add_argument("--admin-email", required=True, help="Initial tenant_admin email")
    parser.add_argument("--admin-password", required=True, help="Initial tenant_admin password (min 12 chars)")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    out = Path(args.out).resolve()

    if not source.is_file():
        print(f"ERROR: source database not found: {source}", file=sys.stderr)
        return 1
    if out == source:
        print("ERROR: --out must not be the same file as --source. Refusing to run.", file=sys.stderr)
        return 1
    if len(args.admin_password) < 8:
        print("ERROR: --admin-password must be at least 8 characters.", file=sys.stderr)
        return 1
    if len(args.admin_password) < 12:
        print(
            "WARNING: --admin-password is shorter than 12 characters "
            "(the self-service register policy) — fine for test builds, "
            "use a stronger one for real client releases.",
            file=sys.stderr,
        )

    print(f"Snapshotting {source} -> {out} (source opened read-only)...")
    snapshot_source(source, out)

    print("Wiping all non-reference tables in the copy...")
    kept_counts, wiped = wipe_copy(out)

    print(f"Creating client tenant '{args.company}' + tenant_admin + enterprise subscription...")
    admin_email = create_client_tenant(out, args.company, args.admin_email, args.admin_password)

    print("VACUUM...")
    vacuum(out)

    print("Verifying output (paranoid re-open)...")
    failures = verify_output(out, admin_email)

    # ── Summary ──────────────────────────────────────────────────────────
    print()
    print("=" * 62)
    print("SEED DATABASE SUMMARY")
    print("=" * 62)
    print(f"{'table':<28} {'rows kept':>10}")
    print("-" * 40)
    for table, n in kept_counts.items():
        print(f"{table:<28} {n:>10}")
    print("-" * 40)
    conn = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
    try:
        print(f"{'users (created)':<28} {conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]:>10}")
        print(f"{'tenants (created)':<28} {conn.execute('SELECT COUNT(*) FROM tenants').fetchone()[0]:>10}")
        print(f"{'subscriptions (created)':<28} {conn.execute('SELECT COUNT(*) FROM subscriptions').fetchone()[0]:>10}")
        nonzero_wiped = []
        for table in wiped:
            if table in ("users", "tenants", "subscriptions"):
                continue  # repopulated above by design
            n = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            if n:
                nonzero_wiped.append((table, n))
        if nonzero_wiped:
            for table, n in nonzero_wiped:
                print(f"!! {table:<25} {n:>10}  <-- NOT EMPTY")
        else:
            print(f"All {len(wiped) - 3} other wiped tables confirmed at 0 rows.")
    finally:
        conn.close()
    print("-" * 40)
    print(f"Admin login: {admin_email}")
    print(f"Output: {out}")
    print("=" * 62)

    if failures or nonzero_wiped:
        print("\nFAILED SAFETY ASSERTIONS:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        for table, n in nonzero_wiped:
            print(f"  - {table} not empty ({n} rows)", file=sys.stderr)
        print("Aborting — DO NOT ship this file.", file=sys.stderr)
        try:
            out.unlink()
        except OSError:
            pass
        return 2

    print("\nAll safety assertions passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
