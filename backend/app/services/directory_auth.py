"""Active Directory / LDAP authentication (Elite Pack).

Binds to the configured directory to verify a user's credentials and read their
profile attributes. Config is a plain dict so it can come from env defaults
(:func:`env_ldap_config`) or a per-tenant overlay (:func:`resolve_ldap_config`
reading ``Tenant.settings["ldap"]``) — the STB on-prem install uses env, while a
second SaaS tenant can enable SSO with a settings write and no migration.

``ldap3`` is imported lazily so a missing dependency degrades only SSO rather
than breaking app startup. The bind calls block, so the endpoint runs
:func:`authenticate` in a worker thread.
"""
from dataclasses import dataclass

from app.core.config import settings


@dataclass
class DirectoryUser:
    username: str
    email: str
    first_name: str
    last_name: str


class DirectoryAuthError(Exception):
    """Raised for any directory lookup / bind failure (message is user-safe)."""


# Effective config keys (lowercase) with their safe defaults.
_DEFAULTS = {
    "enabled": False,
    "server_uri": "",
    "use_ssl": False,
    "bind_dn": "",
    "bind_password": "",
    "user_search_base": "",
    "user_filter": "(sAMAccountName={username})",
    "attr_email": "mail",
    "attr_firstname": "givenName",
    "attr_lastname": "sn",
    "default_email_domain": "",
    "default_tenant_slug": "",
    "default_role": "viewer",
    "auto_create": True,
}


def env_ldap_config() -> dict:
    """Build the LDAP config from the deployment-wide LDAP_* env settings."""
    return {
        "enabled": bool(getattr(settings, "LDAP_ENABLED", False)),
        "server_uri": getattr(settings, "LDAP_SERVER_URI", ""),
        "use_ssl": bool(getattr(settings, "LDAP_USE_SSL", False)),
        "bind_dn": getattr(settings, "LDAP_BIND_DN", ""),
        "bind_password": getattr(settings, "LDAP_BIND_PASSWORD", ""),
        "user_search_base": getattr(settings, "LDAP_USER_SEARCH_BASE", ""),
        "user_filter": getattr(settings, "LDAP_USER_FILTER", "") or _DEFAULTS["user_filter"],
        "attr_email": getattr(settings, "LDAP_ATTR_EMAIL", "") or _DEFAULTS["attr_email"],
        "attr_firstname": getattr(settings, "LDAP_ATTR_FIRSTNAME", "") or _DEFAULTS["attr_firstname"],
        "attr_lastname": getattr(settings, "LDAP_ATTR_LASTNAME", "") or _DEFAULTS["attr_lastname"],
        "default_email_domain": getattr(settings, "LDAP_DEFAULT_EMAIL_DOMAIN", ""),
        "default_tenant_slug": getattr(settings, "LDAP_DEFAULT_TENANT_SLUG", ""),
        "default_role": getattr(settings, "LDAP_DEFAULT_ROLE", "") or _DEFAULTS["default_role"],
        "auto_create": bool(getattr(settings, "LDAP_AUTO_CREATE", True)),
    }


def resolve_ldap_config(tenant_settings: dict | None) -> dict:
    """Overlay a tenant's ``settings['ldap']`` block on top of the env defaults."""
    cfg = env_ldap_config()
    if tenant_settings:
        override = tenant_settings.get("ldap") if isinstance(tenant_settings, dict) else None
        if isinstance(override, dict):
            for key, value in override.items():
                if key in _DEFAULTS and value not in (None, ""):
                    cfg[key] = value
    return cfg


def ldap_enabled(cfg: dict | None = None) -> bool:
    cfg = cfg or env_ldap_config()
    return bool(cfg.get("enabled") and cfg.get("server_uri"))


def _ldap3():
    try:
        import ldap3  # noqa: WPS433 (lazy import by design)
        return ldap3
    except ModuleNotFoundError:  # pragma: no cover - dep not installed
        raise DirectoryAuthError("LDAP support is not installed on this server (ldap3 missing).")


def _attr(entry, name: str) -> str:
    try:
        value = entry[name].value
        if isinstance(value, (list, tuple)):
            value = value[0] if value else ""
        return str(value) if value else ""
    except Exception:
        return ""


def authenticate(username: str, password: str, cfg: dict) -> DirectoryUser:
    """Verify credentials against AD/LDAP and return the directory profile.

    Two-step bind: (1) bind with the service account (or anonymously) to find the
    user's DN, then (2) re-bind as that DN with the supplied password to prove it.
    """
    if not username or not password:
        raise DirectoryAuthError("Username and password are required.")
    ldap3 = _ldap3()

    server = ldap3.Server(
        cfg["server_uri"],
        use_ssl=bool(cfg.get("use_ssl")),
        get_info=ldap3.NONE,
        connect_timeout=8,
    )
    safe_username = ldap3.utils.conv.escape_filter_chars(username)
    user_filter = (cfg.get("user_filter") or _DEFAULTS["user_filter"]).format(username=safe_username)

    # Step 1 — service bind + search for the user entry.
    try:
        if cfg.get("bind_dn"):
            search_conn = ldap3.Connection(
                server, user=cfg["bind_dn"], password=cfg.get("bind_password", ""), auto_bind=True,
            )
        else:
            search_conn = ldap3.Connection(server, auto_bind=True)
    except Exception as exc:  # unreachable / bad service creds
        raise DirectoryAuthError(f"Directory unreachable: {exc}")

    attrs = [cfg["attr_email"], cfg["attr_firstname"], cfg["attr_lastname"]]
    search_conn.search(cfg.get("user_search_base", ""), user_filter, attributes=attrs)
    entries = list(search_conn.entries)
    if not entries:
        search_conn.unbind()
        raise DirectoryAuthError("User not found in directory.")
    entry = entries[0]
    user_dn = entry.entry_dn
    email = _attr(entry, cfg["attr_email"])
    first_name = _attr(entry, cfg["attr_firstname"])
    last_name = _attr(entry, cfg["attr_lastname"])
    search_conn.unbind()

    # Step 2 — re-bind as the user to verify the password.
    try:
        user_conn = ldap3.Connection(server, user=user_dn, password=password, auto_bind=True)
        user_conn.unbind()
    except Exception:
        raise DirectoryAuthError("Invalid directory credentials.")

    domain = cfg.get("default_email_domain", "")
    if not email and domain:
        email = f"{username}@{domain}"
    if not email:
        raise DirectoryAuthError("Directory account has no email address; cannot provision a login.")

    return DirectoryUser(
        username=username,
        email=email.lower(),
        first_name=first_name or username,
        last_name=last_name or "",
    )
