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
from app.models.subscription import (
    Subscription,
    SubscriptionTier,
    SubscriptionStatus,
    TIER_LIMITS,
    ELITE_FEATURES,
    togglable_features,
)
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
    # Kept so the existing Access Control page keeps rendering. It now carries
    # the tenant's REAL enabled set instead of the same 8 constants for everyone.
    enabled_modules: list[str]
    # The full effective map: pack defaults with per-tenant overrides applied.
    features: dict
    # Only the explicit per-tenant overrides, so the UI can show what was
    # deliberately changed away from the pack.
    overrides: dict


class TenantAccessUpdate(BaseModel):
    """Either or both may be sent.

    pack     switches the tenant's subscription tier.
    features per-feature overrides; a value equal to the pack default is dropped
             rather than stored, so custom_limits records only real deviations.
    """
    pack: str | None = None
    features: dict[str, bool] | None = None


class FeatureCatalogueEntry(BaseModel):
    key: str
    group: str


class FeatureCatalogueResponse(BaseModel):
    packs: list[str]
    features: list[FeatureCatalogueEntry]
    pack_defaults: dict


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
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
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
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

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
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()


# ── Tenant access control ─────────────────────────────────────────────────────

MODULE_DEFAULTS = ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "policy-generator"]


# Core modules every tenant has. These are NOT gated by require_feature; they are
# the product. Listed so the page can show them alongside the paid features.
CORE_MODULES = MODULE_DEFAULTS

# Numeric limits are shown but not toggled, so keep them out of the switch list.
_NON_TOGGLE = {"max_frameworks", "max_admin_users", "max_vendors",
               "max_integrations", "sla_uptime"}


def _togglable_features() -> list[tuple[str, str]]:
    """Every boolean entitlement, with the group it belongs to.

    Delegates to the model so this page, the tenant-facing entitlements
    endpoint and require_feature all read one list. The local copy this
    replaced classified by dict iteration order, which put all 29 features in
    "platform" and left the Elite Pack group empty.
    """
    return togglable_features()


def _effective(sub: Subscription | None) -> dict:
    """The tenant's real feature map, overrides included."""
    if sub is None:
        base = dict(TIER_LIMITS[SubscriptionTier.STARTER])
        return {k: bool(base.get(k, False)) for k, _ in _togglable_features()}
    return {k: sub.has_feature(k) for k, _ in _togglable_features()}


def _access_row(tenant: Tenant, sub: Subscription | None) -> TenantAccessResponse:
    features = _effective(sub)
    enabled = list(CORE_MODULES) + sorted(k for k, v in features.items() if v)
    return TenantAccessResponse(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        plan=sub.tier.value if sub else "free_trial",
        enabled_modules=enabled,
        features=features,
        overrides=dict(sub.custom_limits or {}) if sub else {},
    )


@router.get("/feature-catalogue", response_model=FeatureCatalogueResponse)
async def feature_catalogue(
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Everything the Access Control page needs to render: packs and features.

    Served from the same TIER_LIMITS the gate reads, so the page can never drift
    out of sync with what is actually enforced.
    """
    feats = _togglable_features()
    return FeatureCatalogueResponse(
        packs=[t.value for t in SubscriptionTier],
        features=[FeatureCatalogueEntry(key=k, group=g) for k, g in feats],
        pack_defaults={
            tier.value: {k: bool(TIER_LIMITS[tier].get(k, False)) for k, _ in feats}
            for tier in SubscriptionTier
        },
    )


@router.get("/tenant-access", response_model=list[TenantAccessResponse])
async def list_tenant_access(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Every tenant with the modules and features it can actually use."""
    result = await db.execute(
        select(Tenant, Subscription)
        .outerjoin(Subscription, Subscription.tenant_id == Tenant.id)
        .where(Tenant.slug != "platform")
        .order_by(Tenant.name)
    )
    return [_access_row(tenant, sub) for tenant, sub in result.all()]


@router.patch("/tenant-access/{tenant_id}", response_model=TenantAccessResponse)
async def update_tenant_access(
    tenant_id: str,
    body: TenantAccessUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_require_super_admin())],
):
    """Set a tenant's pack and/or individual feature overrides.

    This endpoint previously returned the request body without writing anything,
    so the page appeared to save and a refresh discarded the change.
    """
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    sub_result = await db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    )
    sub = sub_result.scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=404, detail="Subscription not found for this tenant"
        )

    if body.pack is not None:
        try:
            sub.tier = SubscriptionTier(body.pack)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail="Unknown pack %r; expected one of %s"
                % (body.pack, [t.value for t in SubscriptionTier]),
            )

    if body.features is not None:
        known = {k for k, _ in _togglable_features()}
        unknown = sorted(set(body.features) - known)
        if unknown:
            raise HTTPException(
                status_code=422, detail="Unknown feature(s): %s" % unknown
            )
        # Store only genuine deviations from the pack, so switching pack later
        # does not leave stale overrides silently pinning old values.
        defaults = TIER_LIMITS[sub.tier]
        overrides = dict(sub.custom_limits or {})
        for key, value in body.features.items():
            is_elite = sub.tier == SubscriptionTier.ELITE
            default = True if is_elite else bool(defaults.get(key, False))
            if bool(value) == default:
                overrides.pop(key, None)
            else:
                overrides[key] = bool(value)
        # Reassign rather than mutate: SQLAlchemy does not track in-place edits
        # of a JSON column, so mutating it would not be persisted.
        sub.custom_limits = overrides

    await db.commit()
    await db.refresh(sub)
    logger.info(
        "tenant access updated",
        extra={"tenant_id": tenant_id, "pack": sub.tier.value,
               "override_count": len(sub.custom_limits or {})},
    )
    return _access_row(tenant, sub)


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
    status: str

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
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

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
        status=lic.status,
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


async def _set_license_status(
    license_id: str, new_status: str, db: AsyncSession, current_user: User
) -> IssuedLicense:
    lic = await db.get(IssuedLicense, license_id)
    if lic is None:
        raise HTTPException(status_code=404, detail="License not found")
    lic.status = new_status
    await db.flush()
    logger.info("super-admin %s set license %s (%s) to status=%s",
                current_user.email, lic.lid, lic.customer_name, new_status)
    return lic


@router.post("/licenses/{license_id}/revoke", response_model=IssuedLicenseResponse)
async def revoke_license(
    license_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_super_admin())],
):
    """Revoke a license. Appliances phoning home (POST /api/v1/licenses/verify)
    will pick this up on their next check-in and lock themselves out; nothing
    here reaches out to the client — it's pull, not push."""
    lic = await _set_license_status(license_id, "revoked", db, current_user)
    return lic


@router.post("/licenses/{license_id}/reactivate", response_model=IssuedLicenseResponse)
async def reactivate_license(
    license_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_require_super_admin())],
):
    """Undo a revocation."""
    lic = await _set_license_status(license_id, "active", db, current_user)
    return lic
