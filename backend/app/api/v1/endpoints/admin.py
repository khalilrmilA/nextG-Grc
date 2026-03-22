"""Super admin endpoints — platform-wide user and tenant management."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.subscription import Subscription
from app.api.v1.dependencies.auth import require_roles

router = APIRouter()


def _require_super_admin():
    return require_roles(UserRole.SUPER_ADMIN)


# ── Response schemas ──────────────────────────────────────────────────────────

class AdminUserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool
    tenant_id: str
    tenant_name: str
    created_at: str

    model_config = {"from_attributes": True}


class UpdateUserRequest(BaseModel):
    is_active: bool | None = None
    role: str | None = None


class TenantAccessResponse(BaseModel):
    tenant_id: str
    tenant_name: str
    plan: str
    enabled_modules: list[str]


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserResponse])
async def list_all_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """List all users across all tenants."""
    result = await db.execute(
        select(User, Tenant.name.label("tenant_name"))
        .join(Tenant, User.tenant_id == Tenant.id)
        .order_by(Tenant.name, User.first_name)
    )
    rows = result.all()
    return [
        AdminUserResponse(
            id=u.id,
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
            role=u.role.value,
            is_active=u.is_active,
            tenant_id=u.tenant_id,
            tenant_name=tenant_name,
            created_at=u.created_at.isoformat() if u.created_at else "",
        )
        for u, tenant_name in rows
    ]


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Toggle active status or change role for any user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.is_active is not None:
        user.is_active = body.is_active
    if body.role is not None:
        try:
            user.role = UserRole(body.role)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")

    await db.flush()

    tenant_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    return AdminUserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role.value,
        is_active=user.is_active,
        tenant_id=user.tenant_id,
        tenant_name=tenant.name if tenant else "",
        created_at=user.created_at.isoformat() if user.created_at else "",
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_super_admin())],
):
    """Delete a user. Cannot delete yourself."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await db.delete(user)


# ── Tenant access control ─────────────────────────────────────────────────────

MODULE_DEFAULTS = ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "policy-generator"]


@router.get("/tenant-access", response_model=list[TenantAccessResponse])
async def list_tenant_access(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """List all tenants with their enabled modules."""
    result = await db.execute(
        select(Tenant, Subscription)
        .outerjoin(Subscription, Subscription.tenant_id == Tenant.id)
        .where(Tenant.slug != "platform")
        .order_by(Tenant.name)
    )
    rows = result.all()
    out = []
    for tenant, sub in rows:
        plan = sub.tier.value if sub else "free_trial"
        # Use enabled_modules stored on subscription metadata if available, else defaults
        enabled = getattr(sub, "enabled_modules", None) or MODULE_DEFAULTS
        out.append(TenantAccessResponse(
            tenant_id=tenant.id,
            tenant_name=tenant.name,
            plan=plan,
            enabled_modules=enabled,
        ))
    return out


@router.patch("/tenant-access/{tenant_id}", response_model=TenantAccessResponse)
async def update_tenant_access(
    tenant_id: str,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Update enabled modules for a tenant."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    sub_result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    sub = sub_result.scalar_one_or_none()
    plan = sub.tier.value if sub else "free_trial"

    return TenantAccessResponse(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        plan=plan,
        enabled_modules=body.get("enabled_modules", MODULE_DEFAULTS),
    )
