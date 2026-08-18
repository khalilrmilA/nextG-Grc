"""User management endpoints — tenant_admin manages all users with multi-role support."""
import hashlib
import logging
import secrets
import string
from datetime import datetime, timedelta
from typing import Annotated
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr


def _generate_password() -> str:
    """Cryptographically random 16-char password with mixed alphabet/digits."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))


from app.core.database import get_db, AsyncSessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.password_reset import PasswordResetToken
from app.models.compliance import ComplianceAssessment
from app.models.auditor_assignment import AuditorAssignment
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add
from app.api.v1.dependencies import get_tenant_id
from app.api.v1.dependencies.auth import get_current_user, require_roles

router = APIRouter()
logger = logging.getLogger(__name__)


async def _send_welcome_email(user: User) -> None:
    """Email a first-login 'set your password' link to an admin-created user.

    Reuses the exact same mechanism as /auth/forgot-password: a single-use,
    SHA-256-hashed, 1-hour-expiring PasswordResetToken emailed as a link (never the
    temp password itself). Best-effort — wrapped so a broken/unconfigured SMTP relay
    (dev has none) never fails account creation, matching the resilience pattern
    already used by forgot_password's own send_email() call and the login journal.
    """
    try:
        from app.core.config import settings as app_settings
        from app.services.email_service import send_email

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        async with AsyncSessionLocal() as db:
            db.add(PasswordResetToken(
                user_id=user.id,
                token_hash=token_hash,
                expires_at=datetime.utcnow() + timedelta(hours=1),
            ))
            await db.commit()

        base = (getattr(app_settings, "FRONTEND_BASE_URL", "") or "https://grceye.com/app").rstrip("/")
        set_password_link = f"{base}/reset-password?token={raw_token}"

        await send_email(
            to_email=user.email,
            subject="Welcome to GRCEye — set your password",
            template_name="notification.html",
            context={
                "title": f"Welcome, {user.first_name}",
                "message": (
                    "An administrator created a GRCEye account for you. Click below to "
                    "set your own password and sign in (link valid for 1 hour). If you "
                    "weren't expecting this, contact your administrator."
                ),
                "action_url": set_password_link,
                "action_label": "Set my password",
            },
        )
    except Exception:  # noqa: BLE001 — must never fail account creation
        logger.warning("welcome email failed to send for new user %s", user.id)

# All roles tenant_admin can assign to team members
_ASSIGNABLE_ROLES = {
    UserRole.CISO,
    UserRole.RISK_MANAGER,
    UserRole.COMPLIANCE_MANAGER,
    UserRole.AUDITOR,
    UserRole.POLICY_MANAGER,
    UserRole.VENDOR_MANAGER,
    UserRole.CONTROL_OWNER,
    UserRole.VIEWER,
}


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    roles: list[str] = []
    is_active: bool
    expires_at: datetime | None = None

    model_config = {"from_attributes": True}


class CreateUserResponse(UserResponse):
    """Returned only on creation — exposes the one-time auto-generated password."""
    temporary_password: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    roles: list[str]          # one or more roles from _ASSIGNABLE_ROLES
    expires_at: datetime | None = None


class UpdateUserPayload(BaseModel):
    is_active: bool | None = None
    roles: list[str] | None = None   # replace the user's full roles list


class ResetPasswordResponse(BaseModel):
    temporary_password: str


# ── List all users ────────────────────────────────────────────────────────────

@router.get("", response_model=list[UserResponse])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    result = await db.execute(select(User).where(User.tenant_id == tenant_id).order_by(User.first_name))
    users = result.scalars().all()
    return [
        UserResponse(
            id=u.id, email=u.email, first_name=u.first_name, last_name=u.last_name,
            role=u.role.value if hasattr(u.role, "value") else u.role,
            roles=u.roles or [],
            is_active=u.is_active, expires_at=u.expires_at,
        )
        for u in users
    ]


# ── Create user ───────────────────────────────────────────────────────────────

@router.post("/create", response_model=CreateUserResponse, status_code=201,
             responses={400: {"description": "Email already registered or invalid role"},
                        422: {"description": "Email domain does not match the tenant's configured domain"}})
async def create_user(
    body: CreateUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Create a user with one or more assignable roles. Server generates a temporary
    password, forces a password change on first login, and emails the new user a
    first-login link (see _send_welcome_email)."""
    normalized_email = body.email.strip().lower()
    existing = (await db.execute(select(User).where(User.email == normalized_email))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Email already registered")

    if not body.roles:
        raise HTTPException(400, "At least one role is required")

    # Soft domain check: only enforced when the tenant has an explicit professional
    # domain configured (Tenant.domain). Demo/gmail-based tenants with no fixed domain
    # are left untouched — we don't invent new required config that could break them.
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if tenant and tenant.domain:
        expected_domain = tenant.domain.strip().lower().lstrip("@")
        new_domain = normalized_email.rsplit("@", 1)[-1]
        if new_domain != expected_domain:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Email domain must match your organization's domain (@{expected_domain})",
            )

    validated_roles: list[UserRole] = []
    for r in body.roles:
        try:
            role_enum = UserRole(r)
        except ValueError:
            raise HTTPException(400, f"Invalid role: {r}")
        if role_enum not in _ASSIGNABLE_ROLES:
            raise HTTPException(403, f"Cannot assign role: {r}")
        validated_roles.append(role_enum)

    primary_role = validated_roles[0]
    temp_password = _generate_password()
    new_user = User(
        tenant_id=tenant_id,
        email=normalized_email,
        hashed_password=hash_password(temp_password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=primary_role,
        roles=[r.value for r in validated_roles],
        is_verified=True,
        expires_at=body.expires_at,
        # Admin-set temp password → always force a change on first login.
        must_change_password=True,
    )
    db.add(new_user)
    await db.commit()

    await _send_welcome_email(new_user)

    return CreateUserResponse(
        id=new_user.id, email=new_user.email,
        first_name=new_user.first_name, last_name=new_user.last_name,
        role=new_user.role.value if hasattr(new_user.role, "value") else new_user.role,
        roles=new_user.roles or [],
        is_active=new_user.is_active,
        expires_at=new_user.expires_at,
        temporary_password=temp_password,
    )


# ── Update user (roles / active status) ──────────────────────────────────────

@router.patch("/{user_id}", response_model=UserResponse,
              responses={400: {"description": "Cannot modify self"}, 404: {"description": "User not found"}})
async def update_user(
    user_id: str,
    body: UpdateUserPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot modify your own account")
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot modify super admin accounts")

    old_role = user.role.value if hasattr(user.role, "value") else user.role
    old_roles = list(user.roles or [])

    if body.is_active is not None:
        user.is_active = body.is_active

    role_changed = False
    if body.roles is not None:
        if not body.roles:
            raise HTTPException(400, "At least one role is required")
        validated: list[UserRole] = []
        for r in body.roles:
            try:
                role_enum = UserRole(r)
            except ValueError:
                raise HTTPException(400, f"Invalid role: {r}")
            if role_enum not in _ASSIGNABLE_ROLES:
                raise HTTPException(403, f"Cannot assign role: {r}")
            validated.append(role_enum)
        user.role = validated[0]
        user.roles = [r.value for r in validated]
        new_role = user.role.value if hasattr(user.role, "value") else user.role
        role_changed = new_role != old_role or user.roles != old_roles

    await db.commit()

    # The generic ActivityLogMiddleware only records {method, path} for every
    # mutating request — it can't see the request body, so old_role -> new_role
    # (the RFP's literal audit-trail example) wouldn't otherwise be captured
    # anywhere. Write an explicit entry to the same hash-chained log, reusing the
    # existing activity_chain service (mirrors the delete-reason entry added for
    # applied_controls.py). Best-effort: a logging failure must never roll back
    # the role change that already committed above.
    if role_changed:
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id,
                user_id=current_user.id,
                user_email=current_user.email,
                action="role_change",
                entity_type="user",
                entity_id=user.id,
                entity_name=f"{user.first_name} {user.last_name}".strip(),
                details={
                    "old_role": old_role,
                    "new_role": new_role,
                    "old_roles": old_roles,
                    "new_roles": user.roles,
                    "changed_by": current_user.email,
                },
                origin="api",
            ))
        except Exception:
            pass

    return UserResponse(
        id=user.id, email=user.email, first_name=user.first_name, last_name=user.last_name,
        role=user.role.value if hasattr(user.role, "value") else user.role,
        roles=user.roles or [],
        is_active=user.is_active, expires_at=user.expires_at,
    )


# ── Reset password ────────────────────────────────────────────────────────────

@router.post("/{user_id}/reset-password", response_model=ResetPasswordResponse,
             responses={404: {"description": "User not found"}})
async def reset_user_password(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot reset super admin passwords")
    new_password = _generate_password()
    user.hashed_password = hash_password(new_password)
    await db.commit()
    return ResetPasswordResponse(temporary_password=new_password)


# ── Delete user ───────────────────────────────────────────────────────────────

@router.delete("/{user_id}", status_code=204,
               responses={400: {"description": "Cannot delete self"}, 404: {"description": "User not found"}})
async def delete_user(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot delete your own account")
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot delete super admin accounts")
    await db.delete(user)
    await db.commit()


# ── Auditor assignment helpers (kept for auditor portal compatibility) ─────────

class CreateAuditorRequest(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    expires_at: datetime | None = None
    temporary_password: str | None = None


class AssignAuditorRequest(BaseModel):
    auditor_id: str
    assessment_id: str


class AssignmentResponse(BaseModel):
    id: str
    auditor_id: str
    auditor_email: str
    auditor_name: str
    assessment_id: str
    assessment_name: str
    is_active: bool


@router.get("/auditors", response_model=list[UserResponse])
async def list_auditors(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    result = await db.execute(
        select(User).where(User.tenant_id == tenant_id, User.role == UserRole.AUDITOR).order_by(User.first_name)
    )
    users = result.scalars().all()
    return [
        UserResponse(
            id=u.id, email=u.email, first_name=u.first_name, last_name=u.last_name,
            role=u.role.value if hasattr(u.role, "value") else u.role,
            roles=u.roles or [], is_active=u.is_active, expires_at=u.expires_at,
        )
        for u in users
    ]


@router.post("/auditors", response_model=CreateUserResponse, status_code=status.HTTP_201_CREATED)
async def create_auditor(
    body: CreateAuditorRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    temp_password = body.temporary_password or _generate_password()
    auditor = User(
        tenant_id=tenant_id, email=body.email,
        hashed_password=hash_password(temp_password),
        first_name=body.first_name, last_name=body.last_name,
        role=UserRole.AUDITOR, roles=["auditor"],
        is_verified=True, expires_at=body.expires_at,
    )
    db.add(auditor)
    await db.commit()
    return CreateUserResponse(
        id=auditor.id, email=auditor.email,
        first_name=auditor.first_name, last_name=auditor.last_name,
        role="auditor", roles=["auditor"],
        is_active=auditor.is_active, expires_at=auditor.expires_at,
        temporary_password=temp_password,
    )


@router.get("/auditors/assignments", response_model=list[AssignmentResponse])
async def list_assignments(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    result = await db.execute(
        select(AuditorAssignment).where(AuditorAssignment.tenant_id == tenant_id, AuditorAssignment.is_active == True)  # noqa: E712
    )
    items = []
    for a in result.scalars().all():
        auditor = (await db.execute(select(User).where(User.id == a.auditor_id))).scalar_one_or_none()
        assessment = (await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.id == a.assessment_id))).scalar_one_or_none()
        if auditor and assessment:
            items.append(AssignmentResponse(
                id=a.id, auditor_id=a.auditor_id,
                auditor_email=auditor.email,
                auditor_name=f"{auditor.first_name} {auditor.last_name}".strip(),
                assessment_id=a.assessment_id, assessment_name=assessment.name, is_active=a.is_active,
            ))
    return items


@router.post("/auditors/assign", response_model=AssignmentResponse, status_code=201)
async def assign_auditor(
    body: AssignAuditorRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    auditor = (await db.execute(select(User).where(User.id == body.auditor_id, User.tenant_id == tenant_id))).scalar_one_or_none()
    if not auditor or auditor.role != UserRole.AUDITOR:
        raise HTTPException(400, "Auditor not found in this tenant")
    assessment = (await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.id == body.assessment_id, ComplianceAssessment.tenant_id == tenant_id))).scalar_one_or_none()
    if not assessment:
        raise HTTPException(404, "Assessment not found")
    existing = (await db.execute(select(AuditorAssignment).where(
        AuditorAssignment.auditor_id == body.auditor_id,
        AuditorAssignment.assessment_id == body.assessment_id,
        AuditorAssignment.is_active == True,  # noqa: E712
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Auditor is already assigned to this assessment")
    assignment = AuditorAssignment(
        id=str(uuid4()), tenant_id=tenant_id,
        auditor_id=body.auditor_id, assessment_id=body.assessment_id,
        assigned_by_id=current_user.id, is_active=True, reference_document_ids=[],
    )
    db.add(assignment)
    await db.commit()
    return AssignmentResponse(
        id=assignment.id, auditor_id=auditor.id, auditor_email=auditor.email,
        auditor_name=f"{auditor.first_name} {auditor.last_name}".strip(),
        assessment_id=assessment.id, assessment_name=assessment.name, is_active=True,
    )


@router.delete("/auditors/assignments/{assignment_id}", status_code=204)
async def unassign_auditor(
    assignment_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    a = (await db.execute(select(AuditorAssignment).where(AuditorAssignment.id == assignment_id, AuditorAssignment.tenant_id == tenant_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    await db.delete(a)
    await db.commit()


@router.delete("/auditors/{auditor_id}", status_code=204)
async def delete_auditor(
    auditor_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    auditor = (await db.execute(
        select(User).where(User.id == auditor_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not auditor:
        raise HTTPException(404, "Auditor not found")
    if auditor.role != UserRole.AUDITOR:
        raise HTTPException(403, "Can only delete auditor accounts via this endpoint")
    assignments = (await db.execute(select(AuditorAssignment).where(AuditorAssignment.auditor_id == auditor_id))).scalars().all()
    for a in assignments:
        await db.delete(a)
    await db.delete(auditor)
    await db.commit()
