"""Tenant Management — organization settings, modules, and configuration."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.tenant import Tenant

# Sub-keys allowed inside tenant.settings (whitelist — anything else is dropped).
_SETTINGS_ALLOWED_KEYS = {
    "trust_center", "webhooks", "branding", "notifications", "appearance",
    "locale", "timezone", "data_retention_days", "ai", "compliance", "security",
}

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class TenantOut(BaseModel):
    id: str; name: str; slug: str; domain: str | None; logo_url: str | None
    industry: str | None; country: str | None; primary_framework_id: str | None
    selected_framework_ids: list; org_size: str | None
    features: dict; settings: dict; is_active: bool
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class TenantUpdate(BaseModel):
    name: str | None = None
    logo_url: str | None = None
    industry: str | None = None
    country: str | None = None
    org_size: str | None = None
    primary_framework_id: str | None = None
    selected_framework_ids: list[str] | None = None
    features: dict | None = None
    settings: dict | None = None


class LdapSettingsOut(BaseModel):
    """The effective directory configuration, safe to show an administrator.

    ``bind_password`` is never returned — only whether one is stored. The value
    lives in the tenant settings blob, which several screens read; sending it
    back to the browser on every settings load is how a service-account
    password ends up in a log, a cache or a bug report.
    """
    enabled: bool
    server_uri: str
    use_ssl: bool
    bind_dn: str
    bind_password_set: bool
    user_search_base: str
    user_filter: str
    attr_email: str
    attr_firstname: str
    attr_lastname: str
    attr_groups: str
    default_email_domain: str
    default_role: str
    auto_create: bool
    group_role_map: dict
    # Which keys this tenant overrides. The rest are inherited from the
    # deployment's LDAP_* environment, and an administrator editing a field
    # needs to know which of the two they are looking at.
    overridden_keys: list[str] = []
    ldap3_installed: bool = True
    assignable_roles: list[str] = []


class LdapSettingsUpdate(BaseModel):
    enabled: bool | None = None
    server_uri: str | None = None
    use_ssl: bool | None = None
    bind_dn: str | None = None
    # Omitted -> keep the stored password. Empty string -> clear it (which is a
    # real configuration, meaning "bind anonymously").
    bind_password: str | None = None
    user_search_base: str | None = None
    user_filter: str | None = None
    attr_email: str | None = None
    attr_firstname: str | None = None
    attr_lastname: str | None = None
    attr_groups: str | None = None
    default_email_domain: str | None = None
    default_role: str | None = None
    auto_create: bool | None = None
    group_role_map: dict | None = None


class LdapTestRequest(BaseModel):
    """Optionally probe one directory account, to prove the filter and the
    group mapping and not merely that the host answers."""
    probe_username: str | None = None
    # Test an unsaved form: the client sends what is on screen, nothing is
    # written, and the stored password is used when this omits one.
    draft: LdapSettingsUpdate | None = None


class SecuritySettingsOut(BaseModel):
    max_failed_logins: int
    lockout_minutes: int


class SecuritySettingsUpdate(BaseModel):
    max_failed_logins: int | None = None
    lockout_minutes: int | None = None


# ── Endpoints ────────────────────────────────────────────────────────────

def _redacted_settings(raw: dict | None) -> dict:
    """Tenant settings with every stored credential removed.

    ``GET /tenants/current`` is readable by every authenticated user, so the
    settings blob must never carry a credential out of the database. Two live
    in there:

      - ``ldap.bind_password`` — the directory service account. The directory
        endpoints below report whether one is set; nothing returns the value.
      - ``webhooks[*].secret`` — the key that signs our outbound payloads to a
        customer endpoint, so whoever reads it can forge them. It is exactly
        why ``GET /webhooks`` is gated to CISO+; without this the same value
        came back to *any* authenticated tenant user through this blob, and the
        gate on the webhooks listing protected nothing.

    Each is replaced by a set/not-set marker, keeping "" and null distinct so a
    settings screen can still tell "cleared" from "never configured".
    """
    settings_dict = dict(raw or {})
    ldap_block = settings_dict.get("ldap")
    if isinstance(ldap_block, dict) and "bind_password" in ldap_block:
        redacted = dict(ldap_block)
        redacted["bind_password"] = "__set__" if redacted.get("bind_password") else ""
        settings_dict["ldap"] = redacted
    hooks = settings_dict.get("webhooks")
    if isinstance(hooks, list):
        settings_dict["webhooks"] = [
            ({**h, "secret": "__set__"} if isinstance(h, dict) and h.get("secret") else h)
            for h in hooks
        ]
    return settings_dict


def _restore_webhook_secrets(incoming, stored) -> object:
    """Undo the read redaction on a write.

    ``webhooks`` is a whitelisted settings key, so a client that reads
    ``GET /tenants/current`` and PATCHes the blob back would post the
    ``"__set__"`` marker _redacted_settings() substituted and overwrite the real
    signing key with it — silently breaking every signature we send. Put the
    stored secret back whenever the caller sends the marker; a genuinely new
    secret is any other string.
    """
    if not isinstance(incoming, list) or not isinstance(stored, list):
        return incoming
    by_id = {h.get("id"): h.get("secret") for h in stored if isinstance(h, dict)}
    return [
        ({**h, "secret": by_id.get(h.get("id"))} if isinstance(h, dict) and h.get("secret") == "__set__" else h)
        for h in incoming
    ]


@router.get("/current", response_model=TenantOut)
async def get_current_tenant(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    out = TenantOut.model_validate(t)
    out.settings = _redacted_settings(t.settings)
    return out


@router.patch("/current", response_model=TenantOut)
async def update_current_tenant(
    body: TenantUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    for f in ["name", "logo_url", "industry", "country", "org_size", "primary_framework_id", "selected_framework_ids", "features"]:
        v = getattr(body, f, None)
        if v is not None: setattr(t, f, v)
    # Settings: merge whitelisted sub-keys into existing dict (never replace wholesale).
    if body.settings is not None:
        existing = dict(t.settings or {})
        for key, value in body.settings.items():
            if key in _SETTINGS_ALLOWED_KEYS:
                if key == "webhooks":
                    value = _restore_webhook_secrets(value, existing.get("webhooks"))
                existing[key] = value
        t.settings = existing
    await db.commit(); await db.refresh(t)
    out = TenantOut.model_validate(t)
    out.settings = _redacted_settings(t.settings)
    return out

@router.get("/current/security", response_model=SecuritySettingsOut)
async def get_security_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Effective brute-force lockout thresholds for this tenant — a tenant override
    (Tenant.settings['security']) layered on the platform defaults, satisfying the
    RFP's 'paramétrable' (admin-configurable) lockout requirement. Admin-only."""
    from app.api.v1.endpoints.auth import resolve_security_settings
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    return SecuritySettingsOut(**resolve_security_settings(t.settings))


@router.patch("/current/security", response_model=SecuritySettingsOut)
async def update_security_settings(
    body: SecuritySettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Set a per-tenant override for the brute-force lockout threshold/window. Either
    field may be omitted to leave it unchanged; omitting both is a no-op read. Values
    below 1 are rejected — the login flow (auth.py) reads these back on every failed
    login via resolve_security_settings()."""
    from app.api.v1.endpoints.auth import resolve_security_settings
    if body.max_failed_logins is not None and body.max_failed_logins < 1:
        raise HTTPException(422, "max_failed_logins must be at least 1")
    if body.lockout_minutes is not None and body.lockout_minutes < 1:
        raise HTTPException(422, "lockout_minutes must be at least 1")

    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")

    existing = dict(t.settings or {})
    security = dict(existing.get("security") or {})
    if body.max_failed_logins is not None:
        security["max_failed_logins"] = body.max_failed_logins
    if body.lockout_minutes is not None:
        security["lockout_minutes"] = body.lockout_minutes
    existing["security"] = security
    t.settings = existing
    await db.commit(); await db.refresh(t)
    return SecuritySettingsOut(**resolve_security_settings(t.settings))


# ── Active Directory / LDAP ──────────────────────────────────────────────
#
# The directory integration has always read its configuration from
# Tenant.settings["ldap"] (see services/directory_auth.resolve_ldap_config),
# but "ldap" was absent from _SETTINGS_ALLOWED_KEYS, so the generic settings
# PATCH silently dropped it and the only way to configure a directory was to
# edit .env on the server and restart. These three endpoints make it an
# administrator's job instead of a deployment engineer's.
#
# "ldap" is deliberately still NOT added to _SETTINGS_ALLOWED_KEYS: it holds a
# service-account password, so it is written only here, by a tenant admin, and
# never through the general-purpose settings body.

def _ldap_view(tenant: Tenant) -> LdapSettingsOut:
    from app.models.user import ASSIGNABLE_ROLES
    from app.services.directory_auth import resolve_ldap_config

    cfg = resolve_ldap_config(getattr(tenant, "settings", None))
    stored = ((tenant.settings or {}).get("ldap") or {}) if isinstance(tenant.settings, dict) else {}

    try:
        import ldap3  # noqa: F401
        installed = True
    except ModuleNotFoundError:
        installed = False

    return LdapSettingsOut(
        enabled=bool(cfg.get("enabled")),
        server_uri=cfg.get("server_uri", ""),
        use_ssl=bool(cfg.get("use_ssl")),
        bind_dn=cfg.get("bind_dn", ""),
        bind_password_set=bool(cfg.get("bind_password")),
        user_search_base=cfg.get("user_search_base", ""),
        user_filter=cfg.get("user_filter", ""),
        attr_email=cfg.get("attr_email", ""),
        attr_firstname=cfg.get("attr_firstname", ""),
        attr_lastname=cfg.get("attr_lastname", ""),
        attr_groups=cfg.get("attr_groups", ""),
        default_email_domain=cfg.get("default_email_domain", ""),
        default_role=cfg.get("default_role", ""),
        auto_create=bool(cfg.get("auto_create")),
        group_role_map=cfg.get("group_role_map") or {},
        overridden_keys=sorted(k for k in stored if k != "bind_password"),
        ldap3_installed=installed,
        assignable_roles=sorted(r.value for r in ASSIGNABLE_ROLES),
    )


@router.get("/current/ldap", response_model=LdapSettingsOut)
async def get_ldap_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """The directory configuration in force for this tenant.

    Shows the effective values — the tenant's own settings layered over the
    deployment's LDAP_* environment — and names which keys the tenant
    overrides, so an administrator can tell an inherited value from one they
    set. The bind password is reported as set/not set and never returned."""
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Tenant not found")
    return _ldap_view(t)


@router.patch("/current/ldap", response_model=LdapSettingsOut)
async def update_ldap_settings(
    body: LdapSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Write this tenant's directory configuration.

    Only the fields present in the request are changed, so a form that does not
    render a field cannot blank it. Omitting ``bind_password`` keeps the stored
    one; sending an empty string clears it, which is a real configuration
    meaning "bind anonymously"."""
    from app.models.user import ASSIGNABLE_ROLES
    from app.services.directory_auth import _DEFAULTS

    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Tenant not found")

    patch = body.model_dump(exclude_unset=True)

    if "group_role_map" in patch and patch["group_role_map"] is not None:
        assignable = {role.value for role in ASSIGNABLE_ROLES}
        bad = {
            str(group): str(role)
            for group, role in patch["group_role_map"].items()
            if str(role).strip().lower() not in assignable
        }
        if bad:
            # A group mapped to tenant_admin or to a typo silently maps to
            # nothing at login time. Refusing here is the difference between a
            # visible error and users quietly getting the default role.
            raise HTTPException(
                422,
                f"Unassignable role(s) in the group mapping: {bad}. "
                f"Allowed: {sorted(assignable)}",
            )

    if "default_role" in patch and patch["default_role"]:
        assignable = {role.value for role in ASSIGNABLE_ROLES}
        if str(patch["default_role"]).strip().lower() not in assignable:
            raise HTTPException(422, f"default_role must be one of {sorted(assignable)}")

    if "server_uri" in patch and patch["server_uri"]:
        from app.services.directory_auth import DirectoryAuthError, parse_server_uri
        try:
            parse_server_uri(patch["server_uri"])
        except DirectoryAuthError as exc:
            raise HTTPException(422, str(exc))

    if "server_uri" in patch:
        # Repointing the directory while KEEPING the stored bind password aims
        # this tenant's service-account credential at a host the caller just
        # chose: POST /current/ldap/test (and the next directory login) then
        # simple-binds to it with bind_dn + that password, which turns a
        # configuration edit into a read-back for the one value _ldap_view()
        # and _redacted_settings() deliberately never return. The test endpoint
        # already refuses this for an unsaved draft — saving the new URI first
        # was the way around it, and target_is_internal() does not help because
        # an attacker-controlled host is public, not private.
        #
        # So: a new server has to be accompanied by the password. Refusing
        # rather than clearing keeps a working configuration working until the
        # administrator finishes the move. An anonymous bind (no bind_dn) sends
        # no password and is unaffected.
        from app.services.directory_auth import resolve_ldap_config
        current_cfg = resolve_ldap_config(getattr(t, "settings", None))
        new_uri = (patch.get("server_uri") or "").strip()
        old_uri = (current_cfg.get("server_uri") or "").strip()
        keeps_stored_password = patch.get("bind_password") is None  # absent or explicit null
        effective_bind_dn = (patch["bind_dn"] if "bind_dn" in patch else current_cfg.get("bind_dn")) or ""
        if (
            new_uri != old_uri
            and keeps_stored_password
            and (current_cfg.get("bind_password") or "")   # there is a secret to leak
            and effective_bind_dn.strip()                  # and it would be sent
        ):
            raise HTTPException(
                422,
                "Changing the directory server requires re-entering the bind password. "
                "Enter the service-account password, or clear the bind DN to use an "
                "anonymous bind.",
            )

    if "user_filter" in patch and patch["user_filter"]:
        if "{username}" not in patch["user_filter"]:
            # Without the placeholder the filter matches the same entry for
            # every login attempt — anyone who authenticates gets the first
            # account the search returns.
            raise HTTPException(422, "user_filter must contain the {username} placeholder")

    settings_dict = dict(t.settings or {})
    ldap_block = dict(settings_dict.get("ldap") or {})
    for key, value in patch.items():
        if key not in _DEFAULTS:
            continue
        if key == "bind_password" and value is None:
            continue  # omitted -> keep what is stored
        ldap_block[key] = value
    settings_dict["ldap"] = ldap_block
    t.settings = settings_dict

    await db.commit()
    await db.refresh(t)
    return _ldap_view(t)


@router.post("/current/ldap/test")
async def test_ldap_settings(
    body: LdapTestRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Try the configuration against the directory without saving or logging in.

    Accepts an unsaved ``draft`` so an administrator can test what is on screen
    before committing it. Each step is reported separately, because from a
    login screen an unreachable host, a bad service account and a wrong search
    base all look like "invalid credentials"."""
    import asyncio

    from app.services.directory_auth import _DEFAULTS, resolve_ldap_config, test_connection

    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Tenant not found")

    cfg = resolve_ldap_config(getattr(t, "settings", None))
    stored_uri = (cfg.get("server_uri") or "").strip()
    if body.draft is not None:
        patch = body.draft.model_dump(exclude_unset=True)
        # A test binds with bind_dn + bind_password against server_uri. Falling
        # back to the STORED password while the draft points somewhere else
        # would send this tenant's directory service-account credential to a
        # host the caller just chose — turning the one endpoint that reaches
        # the network into a read-back for the password that _ldap_view() and
        # _redacted_settings() deliberately never return. So: a different
        # server has to be tested with a password typed into the form.
        draft_uri = (patch.get("server_uri") or "").strip() if "server_uri" in patch else stored_uri
        falls_back_to_stored = patch.get("bind_password") is None  # absent or explicit null
        # Effective bind_dn after the patch is applied: an explicit "" means the
        # caller asked for an anonymous bind, which sends no password at all.
        draft_bind_dn = (patch["bind_dn"] if "bind_dn" in patch else cfg.get("bind_dn")) or ""
        if (
            draft_uri != stored_uri
            and falls_back_to_stored
            and (cfg.get("bind_password") or "")           # there is a secret to leak
            and draft_bind_dn.strip()                      # and it would be sent
        ):
            raise HTTPException(
                422,
                "Testing against a different server requires the bind password. "
                "Enter the service-account password, or clear the bind DN to test "
                "an anonymous bind.",
            )
        for key, value in patch.items():
            if key not in _DEFAULTS:
                continue
            if key == "bind_password" and value is None:
                continue  # omitted -> test with the stored password
            cfg[key] = value

    # ldap3 binds are blocking sockets — keep them off the event loop.
    return await asyncio.to_thread(test_connection, cfg, body.probe_username)


@router.get("/current/modules")
async def get_enabled_modules(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    t = r.scalar_one_or_none()
    if not t: raise HTTPException(404, "Tenant not found")
    features = t.features or {}
    keys = ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "assets", "reports", "ai"]
    # Elite Pack = god mode: every module enabled regardless of tenant.features toggles.
    from app.models.subscription import Subscription
    sub = (await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))).scalar_one_or_none()
    if sub and sub.tier.value == "elite":
        return {"modules": {k: True for k in keys}}
    return {"modules": {k: (True if k == "dashboard" else features.get(k, True)) for k in keys}}

