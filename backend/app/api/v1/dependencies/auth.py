"""Authentication and authorization dependencies."""
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User, UserRole
from app.models.tenant import Tenant

bearer_scheme = HTTPBearer()
bearer_scheme_optional = HTTPBearer(auto_error=False)

# HTTP methods that mutate state — blocked for viewer role.
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Cache the demo tenant id so we don't query it on every viewer request.
_demo_tenant_id_cache: str | None = None


async def _get_demo_tenant_id(db: AsyncSession) -> str | None:
    """Return the id of the seeded demo tenant (slug='demo'), cached."""
    global _demo_tenant_id_cache
    if _demo_tenant_id_cache is not None:
        return _demo_tenant_id_cache
    from sqlalchemy import select
    result = await db.execute(select(Tenant).where(Tenant.slug == "demo"))
    tenant = result.scalar_one_or_none()
    if tenant:
        _demo_tenant_id_cache = tenant.id
    return _demo_tenant_id_cache


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate the current user from JWT token."""
    payload = await decode_token(credentials.credentials)

    # Only an access token authenticates a request. This was a denylist of one
    # ("mfa_challenge"), which left the REFRESH token — 7-day lifetime, handed to
    # every client, and only ever meant for the POST /auth/refresh body — working
    # as a bearer on every route in the application. create_mfa_challenge_token's
    # docstring in core/security.py already asserts this allowlist behaviour, and
    # support.py applies the same rule on its WebSocket. mfa_challenge tokens
    # prove "password verified, MFA still owed" and stay redeemable only at
    # POST /auth/mfa-login.
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user_id: str | None = payload.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    from sqlalchemy import select
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")

    if user.expires_at is not None and user.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has expired. Contact your administrator.",
        )

    # Viewer role is read-only demo access — block all mutating requests.
    if user.role == UserRole.VIEWER and request.method in _WRITE_METHODS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo accounts are read-only. Upgrade to a full account to use this feature.",
        )

    # Executive (Direction Générale) is a strategic read-only profile by RFP
    # design — consultation of dashboards/KPIs only, never data entry.
    if user.role == UserRole.EXECUTIVE and request.method in _WRITE_METHODS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Executive accounts are read-only (strategic dashboards / consultation).",
        )

    # Active-sessions revocation: reject a token whose session was revoked. Fail-open on
    # any error (or tokens with no sid) so this can never lock users out of the app.
    sid = payload.get("sid")
    if sid:
        try:
            from app.models.user_session import UserSession
            sess = (await db.execute(select(UserSession).where(UserSession.id == sid))).scalar_one_or_none()
            if sess is not None and sess.revoked_at is not None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked. Please sign in again.")
        except HTTPException:
            raise
        except Exception:
            pass  # never break auth on a session-check error

    return user


def require_roles(*roles: UserRole):
    """Dependency factory that requires the user to have one of the specified roles.

    Checks the user's *effective* role set (personal roles ∪ roles granted by
    any Group they belong to, minus their own excluded_roles carve-outs) — not
    just the scalar `role` column — so Group-granted access and per-user
    exclusions (see app/services/authz.py) are actually enforced server-side.
    """
    async def _require_roles(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        # super_admin and tenant_admin always have full access
        if current_user.role in (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN):
            return current_user
        from app.services.authz import get_effective_roles
        effective = await get_effective_roles(current_user, db)
        if not effective.intersection(r.value for r in roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {[r.value for r in roles]}",
            )
        return current_user
    return _require_roles


def require_roles_strict(*roles: UserRole, allow_admin: bool = False):
    """Like ``require_roles`` but WITHOUT the super_admin/tenant_admin auto-pass.

    ``require_roles`` returns early for SUPER_ADMIN and TENANT_ADMIN, so a route
    listing ``(CISO,)`` is really "CISO **or** either admin". That is the right
    default for the rest of the application — an admin locked out of a screen
    they own is a support call — but it makes an *exclusion* impossible to
    express, and the STB tender states several: « réservé aux fonctions de
    direction », « uniquement aux profils exécutifs », « limité aux analystes
    sécurité ». A clause that says *only X* is simply false while the tenant
    owner can also read the screen. This variant is the one to reach for on
    those routes, and only those: everywhere else keep ``require_roles``, whose
    semantics the whole application already depends on and which is deliberately
    left untouched.

    ``allow_admin=True`` restores the auto-pass, for the case where the clause
    reserves a screen to a function *and* the tenant owner is one of them.

    Recovery when this locks somebody out (measured against the live database,
    both paths verified end-to-end): a tenant_admin cannot grant themselves the
    role — ``PATCH /users/{id}`` refuses a self-edit, and TENANT_ADMIN is not in
    ASSIGNABLE_ROLES, so a roles edit would *demote* the account rather than add
    to it. The two working routes back in are (a) create a second account holding
    the role (``POST /users``, the CompanyAdmin screen), or (b) an
    AccessDelegation of that role to the admin — get_effective_roles resolves
    live delegations, so a delegated ``ciso`` passes this gate and expires on its
    own. Both leave a record; widening the gate does not, which is why neither
    ``allow_admin=True`` nor an extra role in the tuple is the answer to a
    support call.

    Effective roles are resolved exactly as in ``require_roles`` — personal
    roles ∪ custom roles ∪ group roles ∪ live delegations, minus
    ``excluded_roles`` (app/services/authz.py) — and the 403 body is identical,
    so a client cannot tell the two gates apart and needs no new handling.

    Sharp edge worth knowing before putting this on a route: ``get_effective_roles``
    seeds its set from ``user.roles`` and falls back to the scalar ``user.role``
    only when that JSON list is empty. So an account whose ``roles`` JSON
    disagrees with its ``role`` column is judged on the JSON — on this database
    there is a super_admin carrying ``roles=["viewer"]`` who passes every
    ``require_roles`` gate by auto-pass and is denied by every strict one. That
    is the intended reading (the carve-out is deliberate), but it will look like
    a bug to whoever hits it.
    """
    async def _require_roles_strict(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        # The one line that separates this from require_roles: the admin
        # early-return happens only when the caller opted into it.
        if allow_admin and current_user.role in (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN):
            return current_user
        from app.services.authz import get_effective_roles
        effective = await get_effective_roles(current_user, db)
        if not effective.intersection(r.value for r in roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {[r.value for r in roles]}",
            )
        return current_user
    return _require_roles_strict


async def get_tenant_id(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Extract tenant_id from the current user.

    Viewer accounts that belong to the demo tenant are redirected to demo data.
    Viewer accounts on real tenants see their own tenant's data (read-only).
    """
    if current_user.role == UserRole.VIEWER:
        demo_id = await _get_demo_tenant_id(db)
        if demo_id and current_user.tenant_id == demo_id:
            return demo_id
    return current_user.tenant_id


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme_optional),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Like get_current_user but returns None if no token is provided (public endpoints)."""
    if not credentials:
        return None
    try:
        payload = await decode_token(credentials.credentials)
        # Same allowlist as get_current_user: a refresh or mfa_challenge token
        # must not identify a caller on a public route either.
        if payload.get("type") != "access":
            return None
        user_id: str | None = payload.get("sub")
        if not user_id:
            return None
        from sqlalchemy import select
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        # A deactivated or expired account is not an identity. get_current_user
        # refuses both; here the consequence is simply that the caller is treated
        # as anonymous, which is the correct reading of a token whose account no
        # longer has access.
        if user is None or not user.is_active:
            return None
        if user.expires_at is not None and user.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
            return None
        return user
    except Exception:
        return None


async def get_current_user_ws(token: str, db: AsyncSession) -> User:
    """Authenticate a WebSocket / SSE connection using a raw token string.

    Carries the same four checks get_current_user applies on every HTTP route —
    token type, is_active, account expiry and session revocation. It used to read
    only `sub` + is_active, so ANY token this deployment signs opened a channel:
    the 7-day refresh token, and the mfa_challenge token minted between the
    password check and the TOTP step (i.e. a half-finished login). Its only
    current call site (support.py::_channel_user) re-applies the missing three
    itself; keeping them here too means the next channel route inherits them
    instead of having to remember. The session check fails open on a lookup
    error, exactly as get_current_user does, so a session-table problem can
    never lock a channel out.
    """
    from app.core.security import decode_token
    from sqlalchemy import select
    try:
        payload = await decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    if user.expires_at is not None and user.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account has expired")

    sid = payload.get("sid")
    if sid:
        try:
            from app.models.user_session import UserSession
            sess = (await db.execute(select(UserSession).where(UserSession.id == sid))).scalar_one_or_none()
            if sess is not None and sess.revoked_at is not None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked. Please sign in again.")
        except HTTPException:
            raise
        except Exception:
            pass  # never break the channel on a session-check error
    return user


async def get_tenant_id_optional(
    current_user: User | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> str | None:
    """Returns tenant_id or None for public endpoints.

    Same viewer-redirect rule as `get_tenant_id`.
    """
    if current_user is None:
        return None
    if current_user.role == UserRole.VIEWER:
        demo_id = await _get_demo_tenant_id(db)
        if demo_id and current_user.tenant_id == demo_id:
            return demo_id
    return current_user.tenant_id
