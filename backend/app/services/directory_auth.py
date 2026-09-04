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
import json
import re
from dataclasses import dataclass, field

from app.core.config import settings


@dataclass
class DirectoryUser:
    username: str
    email: str
    first_name: str
    last_name: str
    # Raw AD group membership (``memberOf`` DNs) — the input to
    # :func:`map_groups_to_role`. Empty when the directory returns none or the
    # attribute isn't readable by the service account.
    groups: list[str] = field(default_factory=list)


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
    "attr_groups": "memberOf",
    "group_role_map": {},
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
        "attr_groups": getattr(settings, "LDAP_ATTR_GROUPS", "") or _DEFAULTS["attr_groups"],
        "group_role_map": _parse_group_role_map(getattr(settings, "LDAP_GROUP_ROLE_MAP", "")),
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


def _attr_list(entry, name: str) -> list[str]:
    """Read a multi-valued attribute (``memberOf``) as a list of strings."""
    try:
        value = entry[name].value
    except Exception:
        return []
    if value in (None, ""):
        return []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value if v]
    return [str(value)]


def _parse_group_role_map(raw) -> dict:
    """Accept the group→role map as a dict or a JSON string (env var).

    A malformed value is treated as "not configured" rather than raising: a
    typo in one env var must not take directory login down entirely.
    """
    if isinstance(raw, dict):
        return raw
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _split_rdn(dn: str) -> str:
    """First RDN of a DN, honouring RFC 4514 backslash escaping.

    A group named "Smith, John" appears as ``CN=Smith\\, John,OU=…``; splitting
    on a bare comma would truncate it to ``CN=Smith\\`` and match nothing.
    """
    return re.split(r"(?<!\\),", dn, maxsplit=1)[0].strip()


def _group_names(dn: str) -> set[str]:
    """The identifiers one AD group DN can be referred to by.

    ``memberOf`` yields full DNs ("CN=GRC_RSSI,OU=Groupes,DC=stb,DC=tn"); an
    administrator will reasonably write just "GRC_RSSI" in the map. Both forms
    are produced here so either style of map key can match.
    """
    dn = (dn or "").strip()
    if not dn:
        return set()
    names = {dn.casefold()}
    first = _split_rdn(dn)
    if "=" in first:
        names.add(first.split("=", 1)[1].strip().casefold())
    return names


def _map_key_form(key: str) -> str:
    """Normalise a configured map key to the one string it may match against.

    A key is compared as-is (case-folded) against :func:`_group_names` of each
    group, which is what keeps the two styles of key correctly scoped: a bare
    "GRC_RSSI" matches the CN of any group with that name, while a full DN
    matches only that exact DN. Expanding a DN key into its CN as well — the
    obvious-looking symmetry — would silently widen it to every same-named
    group in the forest, letting a delegated OU administrator self-grant the
    role by creating "CN=GRC_RSSI" in their own OU. Scoping a key to a DN has
    to mean what it says.
    """
    return (key or "").strip().casefold()


def group_map_configured(cfg: dict) -> bool:
    """Whether this deployment administers app roles from AD groups at all.

    Callers use this to tell "AD is the authority for rights" apart from "AD is
    only an identity provider" — with no map configured, roles stay managed
    in-app and nothing here should overwrite them.
    """
    return bool(_parse_group_role_map(cfg.get("group_role_map")))


def map_groups_to_role(groups: list[str], cfg: dict) -> str | None:
    """Resolve AD group membership to an app role, or None when unmapped.

    This is what makes AD the source of truth for entitlements rather than a
    mere identity provider. When a user belongs to several mapped groups the
    most privileged one wins, decided by ``UserRole``'s declaration order
    (super_admin first … viewer last) so the outcome never depends on the
    order the directory happened to return memberships in.
    """
    role_map = _parse_group_role_map(cfg.get("group_role_map"))
    if not role_map or not groups:
        return None

    # Local import: app.models.user imports nothing from here, but keeping this
    # out of module scope avoids an import cycle through app.core.config.
    from app.models.user import ASSIGNABLE_ROLES, UserRole

    # Only roles a tenant admin could hand out in-app may be granted from a
    # directory group. SUPER_ADMIN and TENANT_ADMIN are excluded exactly as
    # users.py and groups.py exclude them: super_admin is a platform-wide,
    # cross-tenant account, and minting one from a single AD group entry would
    # be a privilege-escalation path around every other check in the app.
    assignable = {r.value for r in ASSIGNABLE_ROLES}
    wanted = {}
    for key, role in role_map.items():
        form = _map_key_form(str(key))
        value = str(role).strip().lower()
        if form and value in assignable:
            wanted[form] = value
    if not wanted:
        return None

    precedence = [r.value for r in UserRole]
    matched: list[str] = []
    for dn in groups:
        names = _group_names(dn)
        for form, role in wanted.items():
            if form in names and role not in matched:
                matched.append(role)
    if not matched:
        return None
    return min(matched, key=precedence.index)


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

    groups_attr = cfg.get("attr_groups") or _DEFAULTS["attr_groups"]
    attrs = [cfg["attr_email"], cfg["attr_firstname"], cfg["attr_lastname"], groups_attr]
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
    groups = _attr_list(entry, groups_attr)
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
        groups=groups,
    )
