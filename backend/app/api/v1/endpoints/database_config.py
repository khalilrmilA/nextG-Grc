"""Datastore selection from the web interface — STB « SGBD : Oracle 19C et SQL Server 2019 ».

The tender requires the solution to run against the bank's own database standard.
This exposes that choice to an administrator: pick the engine, enter the connection,
TEST it before committing, then save. The saved selection is used at the next
start-up (app/core/config.py resolves it through db_config.effective_database_url).

Three deliberate properties, each of which the operator is told about explicitly
rather than left to discover:

  * The selection is stored in a FILE, not a table — see app/core/db_config. The
    connection settings cannot live in the database they configure.
  * Saving does not switch the live process. The engine is built once at start-up,
    so the response carries requires_restart and the exact command.
  * Saving does not migrate data, and the schema scripts under backend/scripts/ are
    written against SQLite's PRAGMA. The response says so. Claiming otherwise would
    be exactly the appearance-over-existence failure this programme exists to remove.
"""
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.v1.dependencies.auth import require_roles
from app.core import db_config
from app.core.config import settings
from app.models.user import User, UserRole

router = APIRouter()

# The bank's own administrator owns this on an on-premise appliance, so tenant_admin
# is the intended audience; require_roles already admits super_admin as well.
_ADMIN = require_roles(UserRole.TENANT_ADMIN)


class DatabaseConfigIn(BaseModel):
    enabled: bool = False
    engine: str = "postgresql"
    host: str = ""
    port: int | None = Field(default=None, ge=1, le=65535)
    database: str = ""
    username: str = ""
    # Omitted on an update = keep whatever is stored. Sending "" clears it.
    password: str | None = None
    options: str = ""


class DatabaseConfigOut(BaseModel):
    enabled: bool
    engine: str
    host: str
    port: int | None
    database: str
    username: str
    password_set: bool
    options: str
    active_url_redacted: str
    requires_restart: bool
    engines: list[dict[str, Any]]
    warnings: list[str]


def _redact(url: str) -> str:
    """Never return a password, even to an administrator, even over TLS."""
    try:
        from sqlalchemy.engine import make_url
        return make_url(url).render_as_string(hide_password=True)
    except Exception:  # noqa: BLE001
        return "(illisible)"


def _warnings(cfg: dict) -> list[str]:
    out: list[str] = []
    engine = cfg.get("engine")
    if cfg.get("enabled") and engine and engine != "sqlite":
        if not db_config.driver_available(engine):
            spec = db_config.SUPPORTED_ENGINES.get(engine, {})
            out.append(
                f"Le pilote « {spec.get('module')} » n'est pas installé sur ce serveur : "
                f"le démarrage retombera sur la base actuelle."
            )
        out.append(
            "Les scripts de migration de backend/scripts/ sont écrits pour SQLite (PRAGMA). "
            "Ils doivent être portés avant qu'un moteur serveur ne porte des données de production."
        )
        out.append("Le changement de moteur ne migre aucune donnée existante.")
    return out


def _current(cfg: dict) -> DatabaseConfigOut:
    stored = db_config.load()          # redacted: password never leaves the server
    raw = db_config.load(with_secrets=True)
    return DatabaseConfigOut(
        enabled=bool(cfg.get("enabled")),
        engine=cfg.get("engine") or "",
        host=cfg.get("host") or "",
        port=cfg.get("port"),
        database=cfg.get("database") or "",
        username=cfg.get("username") or "",
        password_set=bool(raw.get("password")),
        options=cfg.get("options") or "",
        active_url_redacted=_redact(settings.DATABASE_URL),
        requires_restart=False,
        engines=db_config.engine_catalogue(),
        warnings=_warnings(stored),
    )


@router.get("/database", response_model=DatabaseConfigOut)
async def get_database_config(_: Annotated[User, Depends(_ADMIN)]):
    """The saved selection, what this box can actually run, and what is live now."""
    return _current(db_config.load())


@router.post("/database/test")
async def test_database_config(
    body: DatabaseConfigIn,
    _: Annotated[User, Depends(_ADMIN)],
):
    """Probe a candidate connection WITHOUT saving it.

    Reports each step separately — driver present, host reachable, credentials
    accepted, server version readable — because 'connection failed' does not tell
    an operator whether the fault is the firewall, the service name or the password.
    The probe uses a blocking driver, so it runs in a worker thread: a five-second
    TCP timeout on the event loop would stall every other request on this worker.
    """
    cfg = body.model_dump()
    if cfg.get("password") is None:
        # Testing an existing configuration without re-typing the password.
        cfg["password"] = db_config.load(with_secrets=True).get("password", "")
    return await anyio.to_thread.run_sync(lambda: db_config.test_connection(cfg))


@router.put("/database", response_model=DatabaseConfigOut)
async def set_database_config(
    body: DatabaseConfigIn,
    _: Annotated[User, Depends(_ADMIN)],
):
    """Save the selection. Takes effect at the next start-up, never mid-process."""
    if body.engine not in db_config.SUPPORTED_ENGINES:
        raise HTTPException(422, f"moteur non supporté : {body.engine}")

    cfg = body.model_dump()
    if cfg.get("password") is None:
        cfg["password"] = db_config.load(with_secrets=True).get("password", "")

    if cfg.get("enabled"):
        # Refuse to arm a configuration that cannot even be assembled — otherwise the
        # failure surfaces as a silent fallback at the next boot, which is worse.
        try:
            db_config.build_url(cfg, async_=True)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    db_config.save(cfg)
    out = _current(db_config.load())
    out.requires_restart = True
    return out
