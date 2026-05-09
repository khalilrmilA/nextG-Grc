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

    return user


def require_roles(*roles: UserRole):
    """Dependency factory that requires the user to have one of the specified roles."""
    async def _require_roles(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles and current_user.role != UserRole.SUPER_ADMIN:
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

    Viewer role always reads from the seeded demo tenant — regardless of which
    tenant the account itself belongs to. This lets any tenant create a viewer
    account to showcase the platform with full demo data.
    """
    if current_user.role == UserRole.VIEWER:
        demo_id = await _get_demo_tenant_id(db)
        if demo_id:
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
        if demo_id:
            return demo_id
    return current_user.tenant_id
