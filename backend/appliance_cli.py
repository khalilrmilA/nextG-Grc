#!/usr/bin/env python3
"""Appliance command line entrypoint.

This module is the single executable the virtual appliance ships. It is
compiled by Nuitka into /opt/appliance/runtime/appliance-api, after which no
Python interpreter remains on the image, so every operation the appliance
performs outside the HTTP API has to be reachable as a subcommand here.

    appliance-api serve
    appliance-api migrate
    appliance-api create-admin --email a@b.c --generate --must-change-password
    appliance-api admin-reset --generate
    appliance-api support-verify <challenge> <response>
    appliance-api license-status
    appliance-api version

Design constraints worth knowing before editing:

1. No importlib, no __import__, no pkgutil. Nuitka follows static imports only;
   anything resolved by string at runtime is not compiled into the binary and
   fails at customer sites rather than at build time. The migration modules are
   therefore imported by name in MIGRATIONS below. Adding a migration to
   backend/scripts means adding it to that list too.
2. Secrets never travel on argv. /proc/<pid>/cmdline is readable and argv shows
   up in process listings, so --password is accepted for compatibility but
   --generate and --password-stdin are the paths firstboot actually uses.
3. Generated passwords must satisfy app.core.password_policy, which requires 12
   characters with an uppercase, a lowercase, a digit and a symbol. Generating
   here rather than in shell is what guarantees that.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import os
import secrets
import string
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# backend/ must be importable regardless of the working directory the service
# is started from. Harmless once compiled; load bearing when run from source.
_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Anchor the working directory before app.core.config is imported.
#
# config.py declares env_file=(".env", ".env.dev", ".env.local"): RELATIVE
# paths, which pydantic-settings resolves against the process working
# directory. A missing .env normally raises ENOENT and pydantic skips it, so
# this is invisible in development.
#
# On the appliance it is not invisible. The AppArmor profile permits only a
# short list of paths, and anything outside it returns EACCES rather than
# ENOENT. pydantic does not treat EACCES as "absent", so importing config
# raises and every subcommand dies with:
#
#   PermissionError: [Errno 13] Permission denied: '.env'
#
# The systemd unit sets WorkingDirectory=/var/lib/appliance, so the service was
# safe, but firstboot.sh and the console helpers inherit systemd's default of
# "/" and were not. Anchoring here fixes every caller at once.
_STATE_DIR = os.environ.get("APPLIANCE_STATE_DIR", "/var/lib/appliance")
if os.path.isdir(_STATE_DIR):
    try:
        os.chdir(_STATE_DIR)
    except OSError:
        # Not fatal: the env vars the appliance actually uses come from
        # systemd's EnvironmentFile, not from a .env on disk.
        pass

from app.core.config import settings  # noqa: E402
from app.core.password_policy import PasswordPolicyError, validate_password  # noqa: E402
from app.core.security import hash_password  # noqa: E402

# Imported by name so Nuitka compiles them in. Order is the order they run.
from scripts import (  # noqa: E402
    migrate_add_access_columns,
    migrate_add_action_item_start_date,
    migrate_add_activity_chain_columns,
    migrate_add_activity_origin_column,
    migrate_add_asset_columns,
    migrate_add_audit_recurrence,
    migrate_add_audit_report_approval,
    migrate_add_control_validation,
    migrate_add_incident_asset_links,
    migrate_add_incident_linked_vulns,
    migrate_add_license_plan,
    migrate_add_license_status,
    migrate_add_policy_dates,
    migrate_add_raci_group_id,
    migrate_add_risk_columns,
    migrate_add_scenario_linked_risk,
    migrate_add_scenario_priority,
    migrate_add_scenario_review_date,
    migrate_add_threat_columns,
    migrate_add_treatment_priority,
    migrate_add_treatment_scenario_links,
    migrate_add_user_excluded_roles,
    migrate_add_vuln_columns,
)

MIGRATIONS = (
    migrate_add_access_columns,
    migrate_add_action_item_start_date,
    migrate_add_activity_chain_columns,
    migrate_add_activity_origin_column,
    migrate_add_asset_columns,
    migrate_add_audit_recurrence,
    migrate_add_audit_report_approval,
    migrate_add_control_validation,
    migrate_add_incident_asset_links,
    migrate_add_incident_linked_vulns,
    migrate_add_license_plan,
    migrate_add_license_status,
    migrate_add_policy_dates,
    migrate_add_raci_group_id,
    migrate_add_risk_columns,
    migrate_add_scenario_linked_risk,
    migrate_add_scenario_priority,
    migrate_add_scenario_review_date,
    migrate_add_threat_columns,
    migrate_add_treatment_priority,
    migrate_add_treatment_scenario_links,
    migrate_add_user_excluded_roles,
    migrate_add_vuln_columns,
)

SUPPORT_PUBKEY_PATH = os.environ.get(
    "APPLIANCE_SUPPORT_PUBKEY", "/etc/appliance/support.pub"
)
VERSION_FILE = os.environ.get("APPLIANCE_VERSION_FILE", "/etc/appliance/version")
MACHINE_ID_FILE = os.environ.get("APPLIANCE_MACHINE_ID_FILE", "/etc/machine-id")

# How many hourly windows back a support response stays acceptable. The console
# builds its challenge from the current UTC hour; without a tolerance a response
# signed at :59 is dead by the time it is pasted back.
SUPPORT_WINDOW_HOURS = 3


def _err(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)


def quiet_sql() -> None:
    """Stop SQLAlchemy echoing statements to stdout.

    app.core.database builds the engine with echo=settings.DEBUG. When DEBUG is
    true that echo lands on stdout and corrupts the one thing stdout is for
    here: the generated password. The appliance sets DEBUG=false, but a channel
    carrying a credential must not depend on a setting somewhere else being
    right, so turn it off explicitly.
    """
    import logging  # noqa: PLC0415

    from app.core.database import engine  # noqa: PLC0415

    engine.sync_engine.echo = False
    engine.sync_engine.echo_pool = False
    for name in ("sqlalchemy.engine", "sqlalchemy.pool", "sqlalchemy.engine.Engine"):
        logging.getLogger(name).setLevel(logging.WARNING)


def emit_password(password: str, out_path: str | None) -> None:
    """Hand a generated password back to the caller.

    Two channels, because a shell capturing stdout is convenient but fragile:
    any library that logs to stdout silently poisons it. --password-out writes
    to a file the caller names (mode 0600, meant for tmpfs under /run) and is
    what firstboot.sh uses.
    """
    if out_path:
        fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(password + "\n")
        return
    print(password)


# ---------------------------------------------------------------------------
# password generation


def generate_password(length: int = 20) -> str:
    """Generate a password that satisfies app.core.password_policy.

    Built by construction rather than by rejection sampling: one character from
    each required class, the remainder from the full alphabet, then shuffled.
    The symbol set deliberately excludes quotes, backslashes and backticks so
    the result survives being displayed on a console banner and retyped.
    """
    symbols = "!#%*+-=?@_"
    alphabet = string.ascii_letters + string.digits + symbols
    if length < 12:
        length = 12
    chars = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice(symbols),
    ]
    chars += [secrets.choice(alphabet) for _ in range(length - len(chars))]
    # secrets.SystemRandom().shuffle is the CSPRNG-backed shuffle.
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def resolve_password(args: argparse.Namespace) -> tuple[str, bool]:
    """Return (password, was_generated) from --generate/--password-stdin/--password."""
    if args.generate:
        return generate_password(), True
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\n")
        if not password:
            raise SystemExit("no password on stdin")
        return password, False
    if args.password:
        return args.password, False
    raise SystemExit("one of --generate, --password-stdin or --password is required")


def add_password_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--password", help="literal password (visible in /proc, prefer --generate)")
    parser.add_argument("--password-stdin", action="store_true", help="read the password from stdin")
    parser.add_argument("--generate", action="store_true", help="generate one and print it to stdout")
    parser.add_argument("--password-out", default=None,
                        help="write the generated password to this file (mode 0600) instead of stdout")


# ---------------------------------------------------------------------------
# database helpers


def sqlite_path_from_url(url: str) -> str | None:
    """Filesystem path behind a SQLAlchemy SQLite URL, or None if not SQLite.

    Handles sqlite:/// and sqlite+aiosqlite:/// with absolute or relative paths.
    """
    if not url.startswith("sqlite"):
        return None
    _, _, remainder = url.partition(":///")
    if not remainder:
        return None
    # Strip any query string (?check_same_thread=... and friends).
    remainder = remainder.split("?", 1)[0]
    return str(Path(remainder).expanduser())


def cmd_migrate(args: argparse.Namespace) -> int:
    """Create every table, then apply the idempotent column migrations.

    Two stages, because the project has two migration mechanisms and neither one
    covers the other: SQLAlchemy create_all adds missing TABLES but never adds a
    column to a table that already exists, and the backend/scripts/migrate_add_*
    scripts add missing COLUMNS but cannot create anything.
    """
    from app.core.database import Base, engine  # noqa: PLC0415
    import app.models  # noqa: F401,PLC0415  populates Base.metadata

    async def create_all() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    print(f"[migrate] database: {settings.DATABASE_URL}")
    asyncio.run(create_all())
    print("[migrate] tables created or already present")

    db_path = sqlite_path_from_url(settings.DATABASE_URL)
    if db_path is None:
        # The column scripts speak raw sqlite3 (PRAGMA table_info, ALTER TABLE).
        # On any other backend they would fail rather than no-op, so skip them
        # loudly instead of pretending the schema is complete.
        print("[migrate] non-SQLite backend: skipping the SQLite column migrations")
        print("[migrate] apply column changes for this backend by hand before use")
        return 0

    failures = 0
    for module in MIGRATIONS:
        name = module.__name__.rsplit(".", 1)[-1]
        # Each script hardcodes backend/grc_dev.db in one of two shapes: a
        # module level DB constant, or a _db_path() helper. Redirect both at the
        # appliance database. A script with neither shape is a new pattern that
        # must be handled explicitly rather than silently written to the wrong
        # file, so it is treated as a failure.
        patched = False
        if hasattr(module, "DB"):
            module.DB = Path(db_path)
            patched = True
        if hasattr(module, "_db_path"):
            module._db_path = lambda _p=db_path: _p
            patched = True
        if not patched:
            _err(f"{name}: no DB or _db_path to redirect, refusing to run it")
            failures += 1
            continue
        try:
            print(f"[migrate] {name}")
            rc = module.main()
            if rc:
                failures += 1
                _err(f"{name}: returned {rc}")
        except Exception as exc:  # noqa: BLE001  one bad script must not stop the rest
            failures += 1
            _err(f"{name}: {exc}")

    if failures:
        _err(f"{failures} column migration(s) failed")
        return 1
    print(f"[migrate] {len(MIGRATIONS)} column migrations applied")
    return 0


# ---------------------------------------------------------------------------
# admin bootstrap


async def _ensure_tenant(db, company: str, rename: bool = False):
    """Return the tenant to attach the admin to, creating one if needed."""
    from sqlalchemy import select  # noqa: PLC0415

    from app.models.subscription import (  # noqa: PLC0415
        Subscription,
        SubscriptionStatus,
        SubscriptionTier,
    )
    from app.models.tenant import Tenant  # noqa: PLC0415

    result = await db.execute(select(Tenant).order_by(Tenant.created_at).limit(1))
    tenant = result.scalars().first()
    if tenant is not None:
        # The shipped seed database carries a placeholder organisation name. Only
        # rename it when the caller explicitly asks, so an operator re-running
        # create-admin later cannot silently overwrite the customer's own name.
        if rename and company and tenant.name != company:
            print(f"[create-admin] renaming organisation {tenant.name!r} to {company!r}",
                  file=sys.stderr)
            tenant.name = company
            await db.flush()
        return tenant

    slug = "".join(c if c.isalnum() else "-" for c in company.lower()).strip("-") or "appliance"
    tenant = Tenant(name=company, slug=slug, industry="", country="", is_active=True)
    db.add(tenant)
    await db.flush()

    # Enterprise tier so every module is reachable. Licence enforcement, not the
    # subscription row, is what actually gates a shipped appliance.
    db.add(
        Subscription(
            tenant_id=tenant.id,
            tier=SubscriptionTier.ENTERPRISE,
            status=SubscriptionStatus.ACTIVE,
            billing_cycle="annual",
        )
    )
    await db.flush()
    return tenant


def _role_from_arg(value):
    """Map a --role string onto UserRole, defaulting to tenant_admin.

    Kept tiny and explicit rather than UserRole(value): an unknown string would
    otherwise raise ValueError deep inside the transaction, after the tenant had
    already been created, leaving a half-provisioned appliance.
    """
    from app.models.user import UserRole  # noqa: PLC0415

    if not value:
        return UserRole.TENANT_ADMIN
    try:
        return UserRole(value)
    except ValueError:
        _err("unknown role %r, falling back to tenant_admin" % value)
        return UserRole.TENANT_ADMIN


def cmd_create_admin(args: argparse.Namespace) -> int:
    """Create (or repoint) the appliance administrator account.

    Idempotent: running it against an existing address resets that account's
    password rather than failing, so a re-run of firstboot cannot leave the
    appliance with no way in.
    """
    from sqlalchemy import select  # noqa: PLC0415

    from app.core.database import AsyncSessionLocal, engine  # noqa: PLC0415
    import app.models  # noqa: F401,PLC0415  registers every mapper before any ORM query
    from app.models.user import User, UserRole  # noqa: PLC0415

    quiet_sql()
    password, generated = resolve_password(args)
    try:
        validate_password(password)
    except PasswordPolicyError as exc:
        _err(str(exc))
        return 2

    async def run() -> int:
        async with AsyncSessionLocal() as db:
            tenant = await _ensure_tenant(db, args.company, args.rename_tenant)

            result = await db.execute(select(User).where(User.email == args.email))
            user = result.scalar_one_or_none()

            if user is None:
                user = User(
                    tenant_id=tenant.id,
                    email=args.email,
                    hashed_password=hash_password(password),
                    first_name=args.first_name,
                    last_name=args.last_name,
                    role=_role_from_arg(getattr(args, "role", None)),
                    is_active=True,
                    is_verified=True,
                    must_change_password=args.must_change_password,
                )
                db.add(user)
                action = "created"
            else:
                user.hashed_password = hash_password(password)
                user.is_active = True
                user.must_change_password = args.must_change_password
                action = "updated"

            await db.commit()
        await engine.dispose()
        print(f"[create-admin] {action} {args.email} (tenant: {tenant.name})", file=sys.stderr)
        if generated:
            emit_password(password, args.password_out)
        return 0

    return asyncio.run(run())


def cmd_admin_reset(args: argparse.Namespace) -> int:
    """Reset an administrator password. Backs the console menu's option 4."""
    from sqlalchemy import select  # noqa: PLC0415

    from app.core.database import AsyncSessionLocal, engine  # noqa: PLC0415
    import app.models  # noqa: F401,PLC0415  registers every mapper before any ORM query
    from app.models.user import User, UserRole  # noqa: PLC0415

    quiet_sql()
    password, generated = resolve_password(args)
    try:
        validate_password(password)
    except PasswordPolicyError as exc:
        _err(str(exc))
        return 2

    async def run() -> int:
        async with AsyncSessionLocal() as db:
            if args.email:
                result = await db.execute(select(User).where(User.email == args.email))
            else:
                result = await db.execute(
                    select(User)
                    .where(User.role == UserRole.TENANT_ADMIN)
                    .order_by(User.created_at)
                    .limit(1)
                )
            user = result.scalars().first()
            if user is None:
                _err("no administrator account found")
                return 1

            user.hashed_password = hash_password(password)
            user.is_active = True
            user.must_change_password = True
            user.failed_login_count = 0
            user.locked_until = None
            await db.commit()
            email = user.email
        await engine.dispose()
        print(f"[admin-reset] reset {email}", file=sys.stderr)
        if generated:
            emit_password(password, args.password_out)
        return 0

    return asyncio.run(run())


def cmd_prepare_seed(args: argparse.Namespace) -> int:
    """Strip shipped credentials out of the seed database.

    The reference database shipped in the image (77 frameworks, 3799 controls,
    691 threats) is built with one placeholder administrator so it is usable
    during development. Every OVA is byte identical, so leaving that account in
    place would hand the same login to every customer. This removes every user
    account and every licence activation, leaving only reference data; the real
    administrator is then created by create-admin with a per-deployment random
    password.
    """
    from sqlalchemy import delete, select  # noqa: PLC0415

    from app.core.database import AsyncSessionLocal, engine  # noqa: PLC0415
    import app.models  # noqa: F401,PLC0415  registers every mapper before any ORM query
    from app.models.license import LicenseActivation  # noqa: PLC0415
    from app.models.user import User  # noqa: PLC0415

    quiet_sql()

    async def run() -> int:
        async with AsyncSessionLocal() as db:
            existing = (await db.execute(select(User.email))).scalars().all()
            await db.execute(delete(User))
            await db.execute(delete(LicenseActivation))
            await db.commit()
        await engine.dispose()
        for email in existing:
            print(f"[prepare-seed] removed shipped account {email}", file=sys.stderr)
        print(f"[prepare-seed] removed {len(existing)} account(s)", file=sys.stderr)
        return 0

    return asyncio.run(run())


# ---------------------------------------------------------------------------
# support access


def _read_first_line(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.readline().strip()
    except OSError:
        return ""


def _appliance_version() -> str:
    """VERSION= out of /etc/appliance/version, matching the console's parsing."""
    try:
        with open(VERSION_FILE, encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VERSION="):
                    return line.partition("=")[2].strip()
    except OSError:
        pass
    return "unknown"


def expected_challenges(now: datetime | None = None) -> list[str]:
    """The challenge strings this appliance would print over the recent window.

    Mirrors files/console/appliance-console.sh exactly:

        sha256(machine-id|VERSION|YYYYMMDDHH) truncated to 32 hex characters

    Recomputing them here is what stops replay. Verifying only the signature
    would let any challenge and response pair captured once work forever, on
    this appliance and on every other one sharing the public key.
    """
    now = now or datetime.now(timezone.utc)
    machine_id = _read_first_line(MACHINE_ID_FILE)
    version = _appliance_version()
    out = []
    for back in range(SUPPORT_WINDOW_HOURS):
        stamp = (now - timedelta(hours=back)).strftime("%Y%m%d%H")
        raw = f"{machine_id}|{version}|{stamp}".encode()
        out.append(hashlib.sha256(raw).hexdigest()[:32])
    return out


def _b64_any(value: str) -> bytes:
    """Decode standard or URL-safe base64, with or without padding."""
    value = "".join(value.split())
    value = value.replace("-", "+").replace("_", "/")
    return base64.b64decode(value + "=" * (-len(value) % 4))


def cmd_support_verify(args: argparse.Namespace) -> int:
    """Verify an Ed25519 support response over a challenge this appliance issued.

    Exit 0 grants access. The private key never exists on the appliance: only
    the public key is baked into the image, so a customer who reads every byte
    of the disk still cannot mint a response.
    """
    from cryptography.exceptions import InvalidSignature  # noqa: PLC0415
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: PLC0415
        Ed25519PublicKey,
    )

    public_b64 = _read_first_line(SUPPORT_PUBKEY_PATH)
    if not public_b64:
        _err(f"no support public key at {SUPPORT_PUBKEY_PATH}")
        return 3

    challenge = args.challenge.strip()
    if challenge not in expected_challenges():
        _err("challenge is not one this appliance issued recently")
        return 4

    try:
        public = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_b64))
        public.verify(_b64_any(args.response), challenge.encode("ascii"))
    except InvalidSignature:
        _err("signature does not verify")
        return 5
    except Exception as exc:  # noqa: BLE001  malformed key or response
        _err(f"could not verify: {exc}")
        return 5

    return 0


# ---------------------------------------------------------------------------
# licence


def cmd_license_status(args: argparse.Namespace) -> int:
    """Print licence status on the console, without needing the web UI."""
    from sqlalchemy import select  # noqa: PLC0415

    from app.core.database import AsyncSessionLocal, engine  # noqa: PLC0415
    import app.models  # noqa: F401,PLC0415  registers every mapper before any ORM query
    from app.core.licensing import (  # noqa: PLC0415
        effective_public_key,
        enforcement_enabled,
        verify_license,
    )
    from app.models.license import LicenseActivation  # noqa: PLC0415

    async def run() -> int:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(LicenseActivation)
                .order_by(LicenseActivation.activated_at.desc())
                .limit(1)
            )
            activation = result.scalars().first()
        await engine.dispose()

        print(f"enforcement : {'on' if enforcement_enabled() else 'off'}")
        if activation is None:
            print("status      : not activated")
            return 1

        public_key = effective_public_key()
        if not public_key:
            print("status      : unconfigured (no public key in this build)")
            return 1
        try:
            payload = verify_license(activation.license_key, public_key)
        except ValueError:
            print("status      : invalid")
            return 1

        print(f"customer    : {activation.customer_name}")
        print(f"plan        : {payload.get('plan', 'enterprise')}")
        print(f"expires     : {payload.get('expires_at', 'unknown')}")
        print("status      : valid")
        return 0

    return asyncio.run(run())


# ---------------------------------------------------------------------------
# serve


def cmd_serve(args: argparse.Namespace) -> int:
    """Run the API under uvicorn.

    The app object is passed directly rather than as the "app.main:app" import
    string: the string form makes uvicorn resolve the module at runtime, which
    is exactly the dynamic import Nuitka cannot follow. One worker only, because
    JWT revocation, rate limiting and the background schedulers all keep state
    in process memory and split brain across workers.
    """
    import uvicorn  # noqa: PLC0415

    from app.main import app  # noqa: PLC0415

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        workers=1,
        log_level=args.log_level,
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
        server_header=False,
        date_header=True,
    )
    return 0


def cmd_version(args: argparse.Namespace) -> int:
    print(f"{settings.APP_NAME} {settings.APP_VERSION}")
    print(f"appliance {_appliance_version()}")
    return 0


# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="appliance-api", description="GRC appliance command line entrypoint"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_serve = sub.add_parser("serve", help="run the HTTP API")
    p_serve.add_argument("--host", default=os.environ.get("APP_HOST", "127.0.0.1"))
    p_serve.add_argument("--port", type=int, default=int(os.environ.get("APP_PORT", "8000")))
    p_serve.add_argument("--log-level", default=os.environ.get("APP_LOG_LEVEL", "info"))
    p_serve.set_defaults(func=cmd_serve)

    p_migrate = sub.add_parser("migrate", help="create tables and apply column migrations")
    p_migrate.set_defaults(func=cmd_migrate)

    p_admin = sub.add_parser("create-admin", help="create or repoint the administrator account")
    p_admin.add_argument("--email", required=True)
    p_admin.add_argument(
        "--role",
        default="tenant_admin",
        help=(
            "role for a NEWLY created account: tenant_admin (default) or "
            "super_admin. An existing account keeps the role it has; only its "
            "password is reset."
        ),
    )
    p_admin.add_argument("--first-name", default="Appliance")
    p_admin.add_argument("--last-name", default="Administrator")
    p_admin.add_argument("--company", default="Appliance")
    p_admin.add_argument("--must-change-password", action="store_true")
    p_admin.add_argument("--rename-tenant", action="store_true",
                         help="rename the existing organisation to --company (firstboot uses this)")
    add_password_arguments(p_admin)
    p_admin.set_defaults(func=cmd_create_admin)

    p_reset = sub.add_parser("admin-reset", help="reset an administrator password")
    p_reset.add_argument("--email", default="")
    add_password_arguments(p_reset)
    p_reset.set_defaults(func=cmd_admin_reset)

    p_support = sub.add_parser("support-verify", help="verify a support access response")
    p_support.add_argument("challenge")
    p_support.add_argument("response")
    p_support.set_defaults(func=cmd_support_verify)

    p_seed = sub.add_parser(
        "prepare-seed", help="remove shipped accounts from the seed database"
    )
    p_seed.set_defaults(func=cmd_prepare_seed)

    p_license = sub.add_parser("license-status", help="print licence status")
    p_license.set_defaults(func=cmd_license_status)

    p_version = sub.add_parser("version", help="print version information")
    p_version.set_defaults(func=cmd_version)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
