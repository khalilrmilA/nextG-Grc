"""Active Directory / LDAP single sign-on (Elite Pack).

Pre-authentication login flow: a user posts directory credentials, we bind
against AD/LDAP, then find-or-create the local account and issue the same JWT
pair as password login. Gated per-tenant by the ``ad_ldap_sso`` Elite feature
(checked against the tenant's subscription, since there is no current_user yet).
"""
import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.subscription import Subscription
from app.services.directory_auth import (
    authenticate,
    group_map_configured,
    ldap_enabled,
    map_groups_to_role,
    resolve_ldap_config,
    env_ldap_config,
    DirectoryAuthError,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class LdapLoginRequest(BaseModel):
    username: str
    password: str
    tenant_slug: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class SsoStatusResponse(BaseModel):
    enabled: bool


async def _resolve_tenant(db: AsyncSession, slug: str | None) -> Tenant | None:
    slug = (slug or getattr(settings, "LDAP_DEFAULT_TENANT_SLUG", "") or "").strip()
    if not slug:
        return None
    result = await db.execute(select(Tenant).where(Tenant.slug == slug))
    return result.scalar_one_or_none()


@router.get("/ldap/status", response_model=SsoStatusResponse)
async def ldap_sso_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    tenant_slug: str | None = None,
):
    """Whether LDAP SSO is available (drives the login-screen button).

    With a ``tenant_slug`` we resolve the tenant's effective config (env overlaid
    with ``settings['ldap']``), so a tenant configured only via settings still
    reports enabled. Without one we fall back to the deployment-wide env config.
    """
    if tenant_slug:
        tenant = await _resolve_tenant(db, tenant_slug)
        cfg = resolve_ldap_config(getattr(tenant, "settings", None)) if tenant else env_ldap_config()
    else:
        cfg = env_ldap_config()
    return SsoStatusResponse(enabled=ldap_enabled(cfg))


@router.post("/ldap/login", response_model=TokenResponse)
async def ldap_login(body: LdapLoginRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    tenant = await _resolve_tenant(db, body.tenant_slug)
    if tenant is None:
        raise HTTPException(status_code=400, detail="Unknown organization for SSO login.")

    cfg = resolve_ldap_config(getattr(tenant, "settings", None))
    if not ldap_enabled(cfg):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="LDAP SSO is not configured for this organization.",
        )

    # Elite Pack gate (pre-auth, so we check the tenant's plan directly).
    sub_result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    sub = sub_result.scalar_one_or_none()
    if not (sub and sub.has_feature("ad_ldap_sso")):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "feature_not_in_plan",
                "feature": "ad_ldap_sso",
                "pack": "elite",
                "message": "Active Directory / LDAP SSO is part of the Elite Pack.",
            },
        )

    # Blocking ldap3 bind → run off the event loop.
    try:
        dir_user = await asyncio.to_thread(authenticate, body.username.strip(), body.password, cfg)
    except DirectoryAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))

    # Entitlements from AD group membership, when a group→role map is
    # configured. This is what makes AD the authority for rights and not just
    # for identity: the role is recomputed on EVERY login, so moving someone
    # between groups in AD takes effect at their next sign-in with nothing to
    # do in the app.
    mapped_role_value = map_groups_to_role(dir_user.groups, cfg)
    try:
        default_role = UserRole(cfg.get("default_role", "viewer"))
    except ValueError:
        default_role = UserRole.VIEWER
    mapped_role = None
    if mapped_role_value:
        try:
            mapped_role = UserRole(mapped_role_value)
        except ValueError:
            mapped_role = None

    # Find-or-create the local account within this tenant. Email is globally
    # unique, so the lookup can surface an account belonging to a DIFFERENT
    # tenant; authenticating them here would sign them into someone else's
    # organisation and — now that this endpoint writes roles — let this
    # tenant's group map rewrite another tenant's user. Refuse instead.
    result = await db.execute(select(User).where(User.email == dir_user.email))
    user = result.scalar_one_or_none()
    if user is not None and user.tenant_id != tenant.id:
        logger.warning(
            "LDAP login refused: %s resolves to a user in another organization", dir_user.email,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This directory account belongs to another organization.",
        )
    if user is None:
        if not cfg.get("auto_create", True):
            raise HTTPException(status_code=403, detail="No account provisioned for this directory user.")
        user = User(
            tenant_id=tenant.id,
            email=dir_user.email,
            first_name=dir_user.first_name,
            last_name=dir_user.last_name,
            role=mapped_role or default_role,
            is_verified=True,
            hashed_password=None,  # directory-managed; local password login stays disabled
        )
        db.add(user)
        await db.flush()
    elif group_map_configured(cfg) and user.hashed_password is None and dir_user.groups:
        # Re-sync an existing directory-managed account. Guarded three ways:
        #
        #  - no map configured  -> roles stay administered in-app, as before;
        #  - the account still has a local password -> never touched, so a
        #    break-glass local admin can't be demoted by a directory change;
        #  - the directory returned NO groups at all -> skip, fail closed.
        #
        # That last guard matters more than it looks. `memberOf` comes back
        # empty for entirely mundane reasons — the service account losing read
        # access to it, a typo in LDAP_ATTR_GROUPS, or AD simply omitting
        # primary-group and nested memberships — and without it every
        # directory user in the tenant would silently drop to the default role
        # on their next login. A user genuinely removed from all mapped groups
        # is handled by the admin, not by a directory read that may just have
        # failed quietly.
        desired = mapped_role or default_role
        if user.role != desired:
            logger.info(
                "LDAP role sync: user %s %s -> %s (%d directory groups)",
                user.id, user.role, desired.value, len(dir_user.groups),
            )
            user.role = desired
        # The scalar column alone is not enough: get_effective_roles() ignores
        # it whenever the multi-role JSON is non-empty (app/services/authz.py),
        # so a sync that only wrote `role` would appear to work and change
        # nothing. Keep the directory's answer authoritative in both places.
        if user.roles and list(user.roles) != [desired.value]:
            logger.info("LDAP role sync: user %s roles %s -> [%s]", user.id, user.roles, desired.value)
            user.roles = [desired.value]

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account disabled.")

    await db.commit()
    token_data = {"sub": user.id, "tenant_id": user.tenant_id, "role": user.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )
