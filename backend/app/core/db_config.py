"""Operator-configurable datastore — STB « SGBD : Oracle 19C et SQL Server 2019 ».

The tender requires the appliance to run against the bank's own database standard.
This module lets an administrator declare that connection from the web interface,
validate it before committing to it, and have the next start-up use it.

WHY A FILE AND NOT A TABLE
--------------------------
The connection settings cannot live in the database they configure. If an operator
points the appliance at an Oracle instance that is unreachable, the application
would need that same database in order to read the setting that has to be corrected.
So the configuration is a small JSON file, read during settings construction —
before the engine exists — and the password inside it is encrypted with
app.core.secret_box (AES-256-GCM), never written in clear.

WHAT THIS DOES AND DOES NOT DO
------------------------------
It resolves and validates a connection, and selects it for the next boot. It does
NOT migrate existing data between engines, and it does NOT by itself make every
query portable: the schema migrations under backend/scripts/ are written against
SQLite's PRAGMA and have to be ported per dialect before a non-SQLite backend
carries production data. The endpoint says so to the operator rather than implying
that saving a form is sufficient.
"""
from __future__ import annotations

import json
import os
import socket
from pathlib import Path
from typing import Any

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


def config_path() -> Path:
    """Where the datastore selection lives. Overridable for tests and for an
    appliance that keeps its configuration on a separate persistent volume."""
    return Path(os.environ.get("GRC_DB_CONFIG_PATH", _BACKEND_DIR / "db_config.json"))


# Per engine: the async driver SQLAlchemy needs, the sync driver used for the
# connection test (a blocking probe in a worker thread is simpler and more
# informative than an async one), the module that must be importable, and the
# default port. Keeping the two drivers separate matters: a box can have the
# sync driver for testing and still need the async one at run time.
SUPPORTED_ENGINES: dict[str, dict[str, Any]] = {
    "sqlite": {
        "label": "SQLite (intégré)",
        "async_driver": "sqlite+aiosqlite",
        "sync_driver": "sqlite",
        "module": "aiosqlite",
        "default_port": None,
        "needs_server": False,
        "note": "Convient à une évaluation ou à un poste de démonstration, pas à la volumétrie STB.",
    },
    "postgresql": {
        "label": "PostgreSQL",
        "async_driver": "postgresql+asyncpg",
        "sync_driver": "postgresql+psycopg2",
        "module": "asyncpg",
        "default_port": 5432,
        "needs_server": True,
        "note": "",
    },
    "oracle": {
        "label": "Oracle 19c",
        "async_driver": "oracle+oracledb_async",
        "sync_driver": "oracle+oracledb",
        "module": "oracledb",
        "default_port": 1521,
        "needs_server": True,
        # Oracle addresses a SERVICE, not a database name; the field is reused.
        "note": "Le champ « base » correspond au service_name Oracle (ex. ORCLPDB1).",
    },
    "mssql": {
        "label": "SQL Server 2019",
        "async_driver": "mssql+aioodbc",
        "sync_driver": "mssql+pyodbc",
        "module": "pyodbc",
        "default_port": 1433,
        "needs_server": True,
        "note": "Nécessite le pilote ODBC 18 (ou 17) pour SQL Server sur le système hôte.",
    },
}

DEFAULTS: dict[str, Any] = {
    "enabled": False,          # False => the environment's DATABASE_URL is used, unchanged
    "engine": "postgresql",
    "host": "",
    "port": None,
    "database": "",
    "username": "",
    "password": "",            # stored encrypted; never returned by the API
    "options": "",             # extra query string, e.g. "sslmode=require"
}

_SECRET_KEYS = ("password",)


def driver_available(engine: str) -> bool:
    """True when the Python driver for this engine is importable on this box."""
    spec = SUPPORTED_ENGINES.get(engine)
    if not spec:
        return False
    try:
        __import__(spec["module"])
        return True
    except ImportError:
        return False


def engine_catalogue() -> list[dict[str, Any]]:
    """What the operator may choose, and whether each is usable here today.

    Reported honestly: an engine whose driver is absent is listed as unavailable
    with the package to install, rather than silently offered and then failing.
    """
    out = []
    for key, spec in SUPPORTED_ENGINES.items():
        out.append({
            "engine": key,
            "label": spec["label"],
            "default_port": spec["default_port"],
            "needs_server": spec["needs_server"],
            "note": spec["note"],
            "driver_available": driver_available(key),
            "driver_package": spec["module"],
        })
    return out


def build_url(cfg: dict, *, async_: bool = True) -> str:
    """Assemble a SQLAlchemy URL. Raises ValueError on an unusable configuration."""
    from sqlalchemy.engine import URL

    engine = (cfg.get("engine") or "").strip()
    spec = SUPPORTED_ENGINES.get(engine)
    if not spec:
        raise ValueError(f"unsupported engine: {engine!r}")

    driver = spec["async_driver"] if async_ else spec["sync_driver"]

    if engine == "sqlite":
        # A file path, not a host/port. Keep the existing default when blank.
        db = (cfg.get("database") or "").strip() or str(_BACKEND_DIR / "grc_dev.db")
        return f"{driver}:///{db}"

    host = (cfg.get("host") or "").strip()
    database = (cfg.get("database") or "").strip()
    if not host:
        raise ValueError("host is required")
    if not database:
        raise ValueError("database (or Oracle service name) is required")

    query: dict[str, str] = {}
    for pair in (cfg.get("options") or "").split("&"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            if k.strip():
                query[k.strip()] = v.strip()
    if engine == "mssql" and "driver" not in {k.lower() for k in query}:
        # Without this pyodbc cannot pick a driver and the error it raises is opaque.
        query["driver"] = "ODBC Driver 18 for SQL Server"

    return URL.create(
        drivername=driver,
        username=(cfg.get("username") or "").strip() or None,
        password=cfg.get("password") or None,
        host=host,
        port=cfg.get("port") or spec["default_port"],
        database=database,
        query=query,
    ).render_as_string(hide_password=False)


def load(*, with_secrets: bool = False) -> dict:
    """Read the saved selection. Returns DEFAULTS when nothing is configured.

    Never raises: a corrupt or unreadable file must not stop the application from
    booting on its existing DATABASE_URL — that is the whole point of keeping this
    outside the database.
    """
    cfg = dict(DEFAULTS)
    path = config_path()
    try:
        if path.exists():
            stored = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                cfg.update({k: v for k, v in stored.items() if k in DEFAULTS})
    except Exception:  # noqa: BLE001 — deliberately total: booting matters more
        return dict(DEFAULTS)

    if with_secrets:
        from app.core import secret_box
        for key in _SECRET_KEYS:
            if cfg.get(key):
                cfg[key] = secret_box.decrypt(cfg[key]) or ""
    else:
        for key in _SECRET_KEYS:
            cfg[key] = ""
    return cfg


def save(cfg: dict) -> None:
    """Persist the selection, encrypting the password. 0600 — it is a credential."""
    from app.core import secret_box

    merged = dict(DEFAULTS)
    merged.update({k: v for k, v in cfg.items() if k in DEFAULTS})
    for key in _SECRET_KEYS:
        if merged.get(key):
            merged[key] = secret_box.encrypt(merged[key])

    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def effective_database_url(fallback: str) -> str:
    """The URL the application should boot on.

    Opt-in by construction: unless a saved configuration exists AND is enabled AND
    assembles cleanly, the caller's own value (env / .env files) is returned
    untouched. A misconfigured file can therefore never prevent a boot.
    """
    try:
        cfg = load(with_secrets=True)
        if not cfg.get("enabled"):
            return fallback
        return build_url(cfg, async_=True)
    except Exception:  # noqa: BLE001
        return fallback


def test_connection(cfg: dict) -> dict:
    """Probe a candidate configuration and report each step separately.

    Step-by-step because 'connection failed' is useless to an operator: an
    unreachable host, a wrong service name and a bad password all look identical
    otherwise. Same rationale as services/directory_auth.test_connection.
    Blocking on purpose — the endpoint runs it in a worker thread.
    """
    steps: list[dict[str, Any]] = []

    def step(name: str, ok: bool, detail: str = "") -> None:
        steps.append({"step": name, "ok": ok, "detail": detail})

    engine = (cfg.get("engine") or "").strip()
    spec = SUPPORTED_ENGINES.get(engine)
    if not spec:
        step("engine", False, f"moteur inconnu : {engine!r}")
        return {"ok": False, "steps": steps, "server_version": None}
    step("engine", True, spec["label"])

    if not driver_available(engine):
        step("driver", False,
             f"pilote Python « {spec['module']} » absent de cette machine — installez-le puis réessayez")
        return {"ok": False, "steps": steps, "server_version": None}
    step("driver", True, spec["module"])

    if spec["needs_server"]:
        host = (cfg.get("host") or "").strip()
        port = int(cfg.get("port") or spec["default_port"])
        try:
            with socket.create_connection((host, port), timeout=5):
                step("reseau", True, f"{host}:{port} accessible")
        except OSError as exc:
            step("reseau", False, f"{host}:{port} injoignable — {exc}")
            return {"ok": False, "steps": steps, "server_version": None}

    try:
        url = build_url(cfg, async_=False)
    except ValueError as exc:
        step("parametres", False, str(exc))
        return {"ok": False, "steps": steps, "server_version": None}
    step("parametres", True, "configuration complète")

    version = None
    try:
        from sqlalchemy import create_engine, text
        eng = create_engine(url, pool_pre_ping=False, connect_args={})
        with eng.connect() as conn:
            step("authentification", True, "connexion établie")
            probe = {
                "postgresql": "SELECT version()",
                "oracle": "SELECT banner FROM v$version WHERE ROWNUM = 1",
                "mssql": "SELECT @@VERSION",
                "sqlite": "SELECT sqlite_version()",
            }[engine]
            try:
                version = str(conn.execute(text(probe)).scalar())
                step("version", True, version[:160])
            except Exception as exc:  # noqa: BLE001
                # Connected but the version view is not readable — a privilege
                # matter, not a connection failure. Worth distinguishing.
                step("version", False, f"connecté, version illisible ({exc})")
        eng.dispose()
    except Exception as exc:  # noqa: BLE001
        step("authentification", False, str(exc)[:300])
        return {"ok": False, "steps": steps, "server_version": None}

    return {"ok": True, "steps": steps, "server_version": version}
