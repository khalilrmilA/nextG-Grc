"""Authentication endpoints — login, register, refresh, logout."""
import hashlib
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr, Field
from typing import Annotated, Any

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    revoke_jti,
    verify_password,
)
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus
from app.api.v1.dependencies import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


def _hash_email_for_log(email: str) -> str:
    """Hash an email so logs are debuggable without storing PII in plaintext."""
    return hashlib.sha256(email.lower().encode()).hexdigest()[:12]


# Slugs that are publicly visible (Trust Center) and shouldn't be squatted on
# self-service registration. Extend as needed; full impersonation prevention
# requires email-domain verification, which lives in a future fix.
_RESERVED_SLUGS = {
    "admin", "api", "auth", "auditor", "dashboard", "demo", "platform",
    "superadmin", "super-admin", "support", "system", "trust", "trust-center",
    "www", "billing", "console",
    # Brand / impersonation-prone names
    "anthropic", "google", "microsoft", "amazon", "apple", "openai", "meta",
    "facebook", "github", "gitlab", "stripe", "salesforce", "okta", "auth0",
    "cloudflare", "ibm", "oracle", "deloitte", "kpmg", "pwc", "ey",
}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=12, max_length=200)
    first_name: str
    last_name: str
    organization_name: str
    organization_slug: str
    country: str | None = None
    industry: str | None = None
    org_size: str | None = None                          # "1-50","51-200","201-1000","1000+"
    primary_framework_id: str | None = None
    selected_framework_ids: list[str] = []


class UserProfileResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    roles: list[str] = []   # all assigned roles (multi-role support)
    tenant_id: str
    tenant_name: str
    primary_framework_id: str | None = None
    selected_framework_ids: list[Any] = []
    org_size: str | None = None
    primary_assessment_id: str | None = None  # auto-created assessment on registration
    accessible_modules: list[str] = []  # modules available based on subscription tier


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


_GENERIC_LOGIN_FAILURE = "Invalid email or password"

# Module access mapping by subscription tier/status
TIER_MODULES = {
    "trialing": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "incidents", "vulnerabilities", "threats", "risk-scenarios", "risk-quantification", "applied-controls", "security-exceptions", "trust-center", "regulatory", "activity-log", "webhooks", "reports", "policy-generator"],
    "starter": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies"],
    "professional": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "incidents", "vulnerabilities", "threats", "risk-scenarios", "risk-quantification", "applied-controls", "security-exceptions", "trust-center", "regulatory", "activity-log", "webhooks", "reports", "policy-generator"],
    "enterprise": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "incidents", "vulnerabilities", "threats", "risk-scenarios", "risk-quantification", "applied-controls", "security-exceptions", "trust-center", "regulatory", "activity-log", "webhooks", "reports", "policy-generator"],
}

async def get_accessible_modules(tenant_id: str, db: AsyncSession) -> list[str]:
    """Get accessible modules based on subscription tier and status."""
    from app.models.subscription import Subscription
    sub_result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    subscription = sub_result.scalar_one_or_none()
    if not subscription:
        return TIER_MODULES.get("starter", [])
    # During trial, give full professional access
    if subscription.status.value == "trialing":
        return TIER_MODULES.get("trialing", [])
    return TIER_MODULES.get(subscription.tier.value, [])


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    normalized_email = body.email.strip().lower()
    email_hash = _hash_email_for_log(normalized_email)
    try:
        result = await db.execute(select(User).where(User.email == normalized_email))
        user = result.scalar_one_or_none()

        # Constant-ish handling: any user-existence / password / activation failure
        # returns the same generic 401 to prevent enumeration. We still differentiate
        # internally for logging and metrics.
        if not user or not user.hashed_password:
            logger.info("login.fail email_hash=%s reason=no_user", email_hash)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _GENERIC_LOGIN_FAILURE)
        if not verify_password(body.password, user.hashed_password):
            logger.info("login.fail email_hash=%s reason=bad_password", email_hash)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _GENERIC_LOGIN_FAILURE)
        if not user.is_active:
            logger.info("login.fail email_hash=%s reason=disabled", email_hash)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _GENERIC_LOGIN_FAILURE)

        token_data = {"sub": user.id, "tenant_id": user.tenant_id, "role": user.role}
        logger.info("login.ok email_hash=%s", email_hash)
        return TokenResponse(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("login.error email_hash=%s", email_hash)
        # Generic 500 — never leak exception details to the client.
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Internal server error",
        )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Normalize email to lowercase before storing — login form always sends lowercase
    body.email = body.email.strip().lower()
    # Check email uniqueness — generic 400 to avoid enumeration via this endpoint.
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Registration could not be completed")

    # Reserved-slug guard: block obvious squatting (brand names, system slugs).
    # Domain-verification is the proper long-term fix.
    if body.organization_slug.strip().lower() in _RESERVED_SLUGS:
        raise HTTPException(status_code=400, detail="That organization slug is reserved")

    # Check slug uniqueness (slugs are public-facing identifiers, OK to be specific)
    existing_tenant = await db.execute(
        select(Tenant).where(Tenant.slug == body.organization_slug)
    )
    if existing_tenant.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Organization slug already taken")

    # Create tenant
    tenant = Tenant(
        name=body.organization_name,
        slug=body.organization_slug,
        country=body.country,
        industry=body.industry,
        org_size=body.org_size,
        primary_framework_id=body.primary_framework_id,
        selected_framework_ids=body.selected_framework_ids or [],
    )
    db.add(tenant)
    await db.flush()  # Get tenant.id

    # Create subscription (14-day trial with full access)
    from datetime import datetime, timedelta, timezone
    trial_end = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    subscription = Subscription(
        tenant_id=tenant.id,
        tier=SubscriptionTier.PROFESSIONAL,
        status=SubscriptionStatus.TRIALING,
        trial_ends_at=trial_end,
    )
    db.add(subscription)

    # Create admin user
    user = User(
        tenant_id=tenant.id,
        email=body.email,
        hashed_password=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=UserRole.CISO,
        is_verified=False,
    )
    db.add(user)
    await db.flush()

    # Auto-create a draft assessment for every selected framework
    all_fw_ids = list({body.primary_framework_id, *(body.selected_framework_ids or [])} - {None})
    if all_fw_ids:
        from app.models.compliance import ComplianceAssessment, AssessmentStatus, ControlAssessment, ControlStatus
        from app.models.framework import FrameworkControl, Framework
        fw_result = await db.execute(
            select(Framework).where(Framework.id.in_(all_fw_ids))
        )
        frameworks = fw_result.scalars().all()
        for fw in frameworks:
            assessment = ComplianceAssessment(
                tenant_id=tenant.id,
                framework_id=fw.id,
                name=f"{fw.short_name} Compliance Assessment",
                status=AssessmentStatus.DRAFT,
                in_scope_assets=[],
            )
            db.add(assessment)
            await db.flush()

            # Create ControlAssessment rows for every control in the framework
            ctrl_result = await db.execute(
                select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
            )
            controls = ctrl_result.scalars().all()
            for ctrl in controls:
                db.add(ControlAssessment(
                    assessment_id=assessment.id,
                    control_id=ctrl.id,
                    status=ControlStatus.NOT_STARTED,
                ))

    await db.commit()
    token_data = {"sub": user.id, "tenant_id": user.tenant_id, "role": user.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.get("/me", response_model=UserProfileResponse)
async def get_profile(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the current user's profile including tenant framework settings."""
    # Viewers always read from the demo tenant.
    effective_tenant_id = current_user.tenant_id
    if current_user.role == UserRole.VIEWER:
        from app.api.v1.dependencies.auth import _get_demo_tenant_id
        demo_id = await _get_demo_tenant_id(db)
        if demo_id:
            effective_tenant_id = demo_id

    tenant_result = await db.execute(select(Tenant).where(Tenant.id == effective_tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    # Find the primary assessment (most recent for the primary framework)
    primary_assessment_id = None
    if tenant and tenant.primary_framework_id:
        from app.models.compliance import ComplianceAssessment
        from sqlalchemy import desc
        a_result = await db.execute(
            select(ComplianceAssessment)
            .where(
                ComplianceAssessment.tenant_id == effective_tenant_id,
                ComplianceAssessment.framework_id == tenant.primary_framework_id,
            )
            .order_by(desc(ComplianceAssessment.created_at))
            .limit(1)
        )
        assessment = a_result.scalar_one_or_none()
        if assessment:
            primary_assessment_id = assessment.id

    accessible_modules = await get_accessible_modules(effective_tenant_id, db)

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role,
        roles=current_user.roles or [],
        tenant_id=effective_tenant_id,
        tenant_name=tenant.name if tenant else "",
        primary_framework_id=tenant.primary_framework_id if tenant else None,
        selected_framework_ids=tenant.selected_framework_ids if tenant else [],
        org_size=tenant.org_size if tenant else None,
        primary_assessment_id=primary_assessment_id,
        accessible_modules=accessible_modules,
    )


class UpdateFrameworkRequest(BaseModel):
    primary_framework_id: str


class UpdateSelectedFrameworksRequest(BaseModel):
    primary_framework_id: str
    selected_framework_ids: list[str] = []


@router.patch("/me/framework", response_model=UserProfileResponse)
async def update_primary_framework(
    body: UpdateFrameworkRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the workspace primary framework for the current tenant."""
    from app.models.framework import Framework
    # Verify the framework exists
    fw_result = await db.execute(select(Framework).where(Framework.id == body.primary_framework_id))
    fw = fw_result.scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")

    # Update tenant
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    tenant.primary_framework_id = body.primary_framework_id
    # Add to selected_framework_ids if not already there
    existing = list(tenant.selected_framework_ids or [])
    if body.primary_framework_id not in existing:
        existing.append(body.primary_framework_id)
        tenant.selected_framework_ids = existing

    await db.commit()
    await db.refresh(tenant)

    # Find primary assessment
    from app.models.compliance import ComplianceAssessment
    from sqlalchemy import desc
    a_result = await db.execute(
        select(ComplianceAssessment)
        .where(
            ComplianceAssessment.tenant_id == current_user.tenant_id,
            ComplianceAssessment.framework_id == body.primary_framework_id,
        )
        .order_by(desc(ComplianceAssessment.created_at))
        .limit(1)
    )
    assessment = a_result.scalar_one_or_none()

    accessible_modules = await get_accessible_modules(current_user.tenant_id, db)

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role,
        tenant_id=current_user.tenant_id,
        tenant_name=tenant.name,
        primary_framework_id=tenant.primary_framework_id,
        selected_framework_ids=tenant.selected_framework_ids or [],
        org_size=tenant.org_size,
        primary_assessment_id=assessment.id if assessment else None,
        accessible_modules=accessible_modules,
    )


@router.patch("/me/frameworks", response_model=UserProfileResponse)
async def update_selected_frameworks(
    body: UpdateSelectedFrameworksRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the primary framework and full list of selected frameworks."""
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Ensure primary is always in selected list
    selected = list(body.selected_framework_ids)
    if body.primary_framework_id and body.primary_framework_id not in selected:
        selected.insert(0, body.primary_framework_id)

    tenant.primary_framework_id = body.primary_framework_id or None
    tenant.selected_framework_ids = selected
    await db.commit()
    await db.refresh(tenant)

    from app.models.compliance import ComplianceAssessment
    from sqlalchemy import desc
    primary_assessment_id = None
    if tenant.primary_framework_id:
        a_result = await db.execute(
            select(ComplianceAssessment)
            .where(
                ComplianceAssessment.tenant_id == current_user.tenant_id,
                ComplianceAssessment.framework_id == tenant.primary_framework_id,
            )
            .order_by(desc(ComplianceAssessment.created_at))
            .limit(1)
        )
        a = a_result.scalar_one_or_none()
        if a:
            primary_assessment_id = a.id

    accessible_modules = await get_accessible_modules(current_user.tenant_id, db)

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role,
        tenant_id=current_user.tenant_id,
        tenant_name=tenant.name,
        primary_framework_id=tenant.primary_framework_id,
        selected_framework_ids=tenant.selected_framework_ids or [],
        org_size=tenant.org_size,
        primary_assessment_id=primary_assessment_id,
        accessible_modules=accessible_modules,
    )


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh_token(request: Request, body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=400, detail="Invalid refresh token")

    # Refresh-token rotation: revoke the old jti so it can't be reused.
    revoke_jti(payload.get("jti"))

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    token_data = {"sub": user.id, "tenant_id": user.tenant_id, "role": user.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=200)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Allow the authenticated user to change their own password."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one()
    user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
async def forgot_password(request: Request, body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Generate a temporary password and send it to the user's email.
    Always returns 204 to avoid email enumeration."""
    import secrets, string
    email = body.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        # Silent — don't reveal whether the email exists.
        return None

    alphabet = string.ascii_letters + string.digits
    tmp_password = "".join(secrets.choice(alphabet) for _ in range(16))
    user_id, user_email = user.id, user.email

    # Release the DB connection before the (slow) SMTP round-trip so the
    # pool isn't pinned while we wait on the mail relay.
    await db.rollback()

    # Send the email FIRST — only change the password once delivery succeeded,
    # otherwise a failed send would lock the user out of their current password.
    from app.services.email_service import send_email
    sent = await send_email(
        to_email=user_email,
        subject="Your temporary password — GRCEye",
        template_name="notification.html",
        context={
            "title": "Password Reset",
            "message": (
                f"A temporary password has been generated for your account: <strong>{tmp_password}</strong><br><br>"
                "Please log in with this password and change it immediately in Settings → Security."
            ),
        },
    )
    if not sent:
        logger.error(
            "forgot-password: email delivery failed for %s — password left unchanged",
            _hash_email_for_log(user_email),
        )
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:  # deleted while we were sending — nothing to update
        return None
    user.hashed_password = hash_password(tmp_password)
    await db.commit()
    logger.info("forgot-password: temporary password emailed to %s", _hash_email_for_log(user_email))
    return None


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest):
    """Revoke the supplied refresh token (best-effort)."""
    try:
        payload = decode_token(body.refresh_token)
        revoke_jti(payload.get("jti"))
    except HTTPException:
        # Already invalid — nothing to revoke. Still return 204.
        pass
    return None
