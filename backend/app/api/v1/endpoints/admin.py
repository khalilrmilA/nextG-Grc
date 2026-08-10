"""Super admin endpoints — platform-wide user and tenant management."""
import logging
from typing import Annotated
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, EmailStr, Field, field_serializer

from app.core.config import settings
from app.core.database import get_db
from app.core.licensing import LICENSE_PRODUCT, sign_license, normalize_plan
from app.core.security import hash_password
from app.models.license import IssuedLicense
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus
from app.models.ai_access import AiAccessRequest, AiUsageQuota
from app.api.v1.dependencies.auth import get_current_user
from app.workers.tasks.notifications import (
    notify_ai_access_approved,
    notify_ai_access_request,
    notify_framework_new,
    notify_framework_updated,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _super_admin_only(current_user: User = Depends(get_current_user)) -> User:
    """Strict super-admin gate. require_roles() cannot be used here: it
    short-circuits for tenant_admin, which must NOT reach platform-wide /admin."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin access required")
    return current_user


def _require_super_admin():
    return _super_admin_only


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


class CreateUserAdminRequest(BaseModel):
    email: EmailStr
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    role: str
    tenant_id: str
    password: str | None = Field(default=None, min_length=8, max_length=200)


class CreateUserAdminResponse(AdminUserResponse):
    temporary_password: str


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


@router.post("/users", response_model=CreateUserAdminResponse, status_code=201)
async def create_user(
    body: CreateUserAdminRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_super_admin())],
):
    """Create a user in any tenant. Generates a temporary password unless one is supplied.
    The password is returned once in the response and never again."""
    import secrets
    import string

    email = body.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    tenant_result = await db.execute(select(Tenant).where(Tenant.id == body.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    try:
        role = UserRole(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    if role == UserRole.SUPER_ADMIN:
        # Platform admins must never be mintable over HTTP.
        raise HTTPException(status_code=403, detail="Cannot create super admin accounts")

    alphabet = string.ascii_letters + string.digits
    password = body.password or "".join(secrets.choice(alphabet) for _ in range(16))

    user = User(
        tenant_id=tenant.id,
        email=email,
        hashed_password=hash_password(password),
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role=role,
        roles=[role.value],
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)  # load server-side defaults (created_at) on the async session

    logger.info("super-admin %s created user %s (role=%s, tenant=%s)",
                current_user.email, email, role.value, tenant.name)

    return CreateUserAdminResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role.value,
        is_active=user.is_active,
        tenant_id=user.tenant_id,
        tenant_name=tenant.name,
        created_at=user.created_at.isoformat() if user.created_at else "",
        temporary_password=password,
    )


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
            new_role = UserRole(body.role)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
        if new_role == UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Cannot promote users to super admin")
        user.role = new_role

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


# ── License management ────────────────────────────────────────────────────────

class IssueLicenseRequest(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr
    duration_days: int = Field(..., ge=1, le=3650)
    plan: str = "enterprise"  # starter | professional | enterprise
    notes: str | None = None


class IssuedLicenseResponse(BaseModel):
    id: str
    customer_name: str
    contact_email: str
    license_key: str
    plan: str
    issued_at: str
    expires_at: str
    notes: str | None

    model_config = {"from_attributes": True}


@router.post("/licenses", response_model=IssuedLicenseResponse, status_code=201)
async def issue_license(
    body: IssueLicenseRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_super_admin())],
):
    """Mint and sign a client license key. Requires LICENSE_PRIVATE_KEY on this server."""
    if not settings.LICENSE_PRIVATE_KEY:
        raise HTTPException(status_code=503, detail="License signing key not configured")

    now = datetime.now(timezone.utc)
    issued_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    expires_at = (now + timedelta(days=body.duration_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    plan = normalize_plan(body.plan)

    payload = {
        "lid": uuid4().hex,
        "product": LICENSE_PRODUCT,
        "customer": body.customer_name.strip(),
        "email": body.contact_email,
        "plan": plan,
        "issued_at": issued_at,
        "expires_at": expires_at,
    }
    license_key = sign_license(payload, settings.LICENSE_PRIVATE_KEY)

    lic = IssuedLicense(
        customer_name=payload["customer"],
        contact_email=body.contact_email,
        license_key=license_key,
        lid=payload["lid"],
        plan=plan,
        issued_at=issued_at,
        expires_at=expires_at,
        notes=body.notes,
        created_by=current_user.email,
    )
    db.add(lic)
    await db.flush()

    logger.info("super-admin %s issued %s license %s for %s (%s days)",
                current_user.email, plan, lic.lid, lic.customer_name, body.duration_days)

    return IssuedLicenseResponse(
        id=lic.id,
        customer_name=lic.customer_name,
        contact_email=lic.contact_email,
        license_key=lic.license_key,
        plan=lic.plan,
        issued_at=lic.issued_at,
        expires_at=lic.expires_at,
        notes=lic.notes,
    )


@router.get("/licenses", response_model=list[IssuedLicenseResponse])
async def list_licenses(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """List all issued licenses, newest first."""
    result = await db.execute(
        select(IssuedLicense).order_by(IssuedLicense.created_at.desc())
    )
    return result.scalars().all()
