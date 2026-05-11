"""Super admin endpoints — platform-wide user and tenant management."""
import logging
from typing import Annotated
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, field_serializer

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus
from app.models.ai_access import AiAccessRequest, AiUsageQuota
from app.api.v1.dependencies.auth import require_roles
from app.workers.tasks.notifications import (
    notify_ai_access_approved,
    notify_ai_access_request,
    notify_framework_new,
    notify_framework_updated,
)

logger = logging.getLogger(__name__)

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


# ── AI Access Management ───────────────────────────────────────────────────────

class AiAccessRequestResponse(BaseModel):
    id: str
    user_email: str
    user_name: str
    feature: str
    reason: str
    status: str
    admin_notes: str | None
    requested_at: datetime
    responded_at: datetime | None

    model_config = {"from_attributes": True}

    @field_serializer('requested_at', 'responded_at')
    def serialize_datetime(self, value: datetime | None) -> str | None:
        return value.isoformat() if value else None


class AiAccessRequestUpdate(BaseModel):
    admin_notes: str | None = None


@router.get("/ai-access/requests", response_model=list[AiAccessRequestResponse])
async def list_ai_access_requests(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
    status: str | None = None,
):
    """List AI access requests, optionally filtered by status."""
    query = select(AiAccessRequest)
    if status:
        query = query.where(AiAccessRequest.status == status)
    result = await db.execute(query.order_by(AiAccessRequest.requested_at.desc()))
    return result.scalars().all()


@router.patch("/ai-access/requests/{request_id}/approve")
async def approve_ai_request(
    request_id: str,
    body: AiAccessRequestUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Approve an AI access request."""
    result = await db.execute(
        select(AiAccessRequest).where(AiAccessRequest.id == request_id)
    )
    request = result.scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    try:
        logger.info(f"Found request: {request.user_email}, approving...")
    except Exception as e:
        logger.error(f"Error accessing request attributes: {str(e)}", exc_info=True)
    request.status = "approved"
    request.responded_at = datetime.utcnow()
    request.admin_notes = body.admin_notes

    # Create or update usage quota for the user
    quota_result = await db.execute(
        select(AiUsageQuota).where(AiUsageQuota.user_id == request.user_id)
    )
    quota = quota_result.scalar_one_or_none()

    if quota:
        quota.is_approved = True
        logger.info(f"Updated existing quota for user {request.user_email}")
    else:
        quota_id = str(uuid4())
        quota = AiUsageQuota(
            id=quota_id,
            tenant_id=request.tenant_id,
            user_id=request.user_id,
            feature=request.feature,
            is_approved=True,
            monthly_limit_tokens=10000,
            monthly_limit_requests=100,
            reset_date=datetime.utcnow() + timedelta(days=30),
        )
        db.add(quota)
        logger.info(f"Created new quota for user {request.user_email}")

    try:
        await db.flush()
        await db.commit()
    except Exception:
        logger.exception("admin.ai_access.commit_error")
        raise HTTPException(status_code=500, detail="Internal server error")

    logger.info(f"AI access request approved: {request_id}, new status: {request.status}")

    # Send notification to user (fire-and-forget — Redis may be down).
    try:
        notify_ai_access_approved.delay(request.user_id, request.user_email)
    except Exception:
        logger.warning("admin.ai_access.notify_delay_failed user_id=%s", request.user_id)

    return {
        "id": request.id,
        "user_email": request.user_email,
        "user_name": request.user_name,
        "feature": request.feature,
        "reason": request.reason,
        "status": request.status,
        "admin_notes": request.admin_notes,
        "requested_at": request.requested_at.isoformat() if request.requested_at else None,
        "responded_at": request.responded_at.isoformat() if request.responded_at else None,
    }


@router.patch("/ai-access/requests/{request_id}/deny")
async def deny_ai_request(
    request_id: str,
    body: AiAccessRequestUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Deny an AI access request."""
    result = await db.execute(
        select(AiAccessRequest).where(AiAccessRequest.id == request_id)
    )
    request = result.scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    request.status = "denied"
    request.responded_at = datetime.utcnow()
    request.admin_notes = body.admin_notes

    # Update quota to mark as not approved
    quota_result = await db.execute(
        select(AiUsageQuota).where(AiUsageQuota.user_id == request.user_id)
    )
    quota = quota_result.scalar_one_or_none()
    if quota:
        quota.is_approved = False

    try:
        await db.flush()
        await db.commit()
    except Exception:
        logger.exception("admin.ai_access.commit_error")
        raise HTTPException(status_code=500, detail="Internal server error")

    logger.info(f"AI access request denied: {request_id}")
    return {
        "id": request.id,
        "user_email": request.user_email,
        "user_name": request.user_name,
        "feature": request.feature,
        "reason": request.reason,
        "status": request.status,
        "admin_notes": request.admin_notes,
        "requested_at": request.requested_at.isoformat() if request.requested_at else None,
        "responded_at": request.responded_at.isoformat() if request.responded_at else None,
    }


@router.post("/ai-usage/quota")
async def set_user_quota(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Set AI usage quota for a user."""
    user_id = body.get("user_id")
    feature = body.get("feature", "document-generation")
    monthly_limit = body.get("monthly_limit", 10000)

    # Update or create quota
    result = await db.execute(
        select(AiUsageQuota).where(
            and_(AiUsageQuota.user_id == user_id, AiUsageQuota.feature == feature)
        )
    )
    quota = result.scalar_one_or_none()

    if quota:
        quota.monthly_limit_tokens = monthly_limit
        await db.commit()
    else:
        quota_id = str(uuid4())
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        quota = AiUsageQuota(
            id=quota_id,
            tenant_id=user.tenant_id,
            user_id=user_id,
            feature=feature,
            monthly_limit_tokens=monthly_limit,
            is_approved=True,
            reset_date=datetime.utcnow() + timedelta(days=30),
        )
        db.add(quota)
        await db.commit()

    return {"status": "ok", "quota_id": quota.id}


# ── Subscription management ───────────────────────────────────────────────────

class SubscriptionAdminResponse(BaseModel):
    tenant_id: str
    tenant_name: str
    tier: str
    status: str
    trial_ends_at: str | None

    model_config = {"from_attributes": True}


class UpdateSubscriptionRequest(BaseModel):
    tier: str | None = None          # starter | professional | enterprise
    status: str | None = None        # trialing | active | past_due | canceled | paused
    trial_ends_at: str | None = None # ISO datetime string, or null to clear


@router.get("/subscriptions", response_model=list[SubscriptionAdminResponse])
async def list_subscriptions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """List every tenant with its subscription tier, status, and trial expiry."""
    result = await db.execute(
        select(Tenant, Subscription)
        .outerjoin(Subscription, Subscription.tenant_id == Tenant.id)
        .where(Tenant.slug != "platform")
        .order_by(Tenant.name)
    )
    rows = result.all()
    out = []
    for tenant, sub in rows:
        out.append(SubscriptionAdminResponse(
            tenant_id=tenant.id,
            tenant_name=tenant.name,
            tier=sub.tier.value if sub else "starter",
            status=sub.status.value if sub else "trialing",
            trial_ends_at=sub.trial_ends_at if sub else None,
        ))
    return out


@router.patch("/subscriptions/{tenant_id}", response_model=SubscriptionAdminResponse)
async def update_subscription(
    tenant_id: str,
    body: UpdateSubscriptionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Update a tenant's subscription plan, status, and/or trial expiry date."""
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    sub_result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    sub = sub_result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found for this tenant")

    if body.tier is not None:
        try:
            sub.tier = SubscriptionTier(body.tier)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid tier: {body.tier}")

    if body.status is not None:
        try:
            sub.status = SubscriptionStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")

    # trial_ends_at: null clears it; a date string sets it
    if "trial_ends_at" in body.model_fields_set:
        if body.trial_ends_at is None:
            sub.trial_ends_at = None
        else:
            try:
                sub.trial_ends_at = body.trial_ends_at  # store as-is (ISO string)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid trial_ends_at date format")

    await db.commit()
    await db.refresh(sub)

    return SubscriptionAdminResponse(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        tier=sub.tier.value,
        status=sub.status.value,
        trial_ends_at=sub.trial_ends_at,
    )
