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
    payload = decode_token(credentials.credentials)

    # mfa_challenge tokens prove "password verified, MFA still owed" — they must
    # never work as an access token, only at POST /auth/mfa-login.
    if payload.get("type") == "mfa_challenge":
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
        payload = decode_token(credentials.credentials)
        user_id: str | None = payload.get("sub")
        if not user_id:
            return None
        from sqlalchemy import select
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()
    except Exception:
        return None


async def get_current_user_ws(token: str, db: AsyncSession) -> User:
    """Authenticate a WebSocket connection using a raw token string."""
    from app.core.security import decode_token
    from sqlalchemy import select
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
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
