"""Authentication endpoints — login, register, refresh, logout."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from typing import Annotated, Any

from app.core.database import get_db
from app.core.security import verify_password, hash_password, create_access_token, create_refresh_token, decode_token
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus
from app.api.v1.dependencies import get_current_user

router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
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
    tenant_id: str
    tenant_name: str
    primary_framework_id: str | None = None
    selected_framework_ids: list[Any] = []
    org_size: str | None = None
    primary_assessment_id: str | None = None  # auto-created assessment on registration


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    import logging
    logger = logging.getLogger(__name__)
    try:
        result = await db.execute(select(User).where(User.email == body.email))
        user = result.scalar_one_or_none()
        logger.info(f"Login attempt for {body.email}, user found: {user is not None}")

        if not user or not user.hashed_password or not verify_password(body.password, user.hashed_password):
            logger.warning(f"Login failed for {body.email}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        if not user.is_active:
            logger.warning(f"Login blocked - account disabled: {body.email}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

        token_data = {"sub": user.id, "tenant_id": user.tenant_id, "role": user.role}
        logger.info(f"Login successful for {body.email}")
        return TokenResponse(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger = logging.getLogger(__name__)
        logger.error(f"Login error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Login error: {str(e)[:100]}",
        )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check email uniqueness
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Check slug uniqueness
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

    # Create subscription (14-day trial)
    from datetime import datetime, timedelta, timezone
    trial_end = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    subscription = Subscription(
        tenant_id=tenant.id,
        tier=SubscriptionTier.STARTER,
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
        role=UserRole.TENANT_ADMIN,
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
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    # Find the primary assessment (most recent for the primary framework)
    primary_assessment_id = None
    if tenant and tenant.primary_framework_id:
        from app.models.compliance import ComplianceAssessment
        from sqlalchemy import desc
        a_result = await db.execute(
            select(ComplianceAssessment)
            .where(
                ComplianceAssessment.tenant_id == current_user.tenant_id,
                ComplianceAssessment.framework_id == tenant.primary_framework_id,
            )
            .order_by(desc(ComplianceAssessment.created_at))
            .limit(1)
        )
        assessment = a_result.scalar_one_or_none()
        if assessment:
            primary_assessment_id = assessment.id

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role,
        tenant_id=current_user.tenant_id,
        tenant_name=tenant.name if tenant else "",
        primary_framework_id=tenant.primary_framework_id if tenant else None,
        selected_framework_ids=tenant.selected_framework_ids if tenant else [],
        org_size=tenant.org_size if tenant else None,
        primary_assessment_id=primary_assessment_id,
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
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=400, detail="Invalid refresh token")

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
