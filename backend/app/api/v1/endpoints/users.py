"""User management endpoints — create auditors, list tenant users."""
import secrets
import string
from datetime import datetime
from typing import Annotated
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr


def _generate_auditor_password() -> str:
    """Cryptographically random 16-char password with mixed alphabet/digits."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))

from app.core.database import get_db
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.compliance import ComplianceAssessment
from app.models.auditor_assignment import AuditorAssignment
# ComplianceAssessment and AuditorAssignment used in assign/unassign endpoints below
from app.api.v1.dependencies import get_tenant_id
from app.api.v1.dependencies.auth import get_current_user, require_roles

router = APIRouter()


class CreateAuditorRequest(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    expires_at: datetime | None = None
    temporary_password: str | None = None


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool
    expires_at: datetime | None = None

    model_config = {"from_attributes": True}


class CreateAuditorResponse(UserResponse):
    """Returned only on creation — exposes the one-time auto-generated password."""
    temporary_password: str


@router.get("", response_model=list[UserResponse])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """List all users in the tenant."""
    result = await db.execute(select(User).where(User.tenant_id == tenant_id).order_by(User.first_name))
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


@router.post("/auditors", response_model=CreateAuditorResponse, status_code=status.HTTP_201_CREATED,
             responses={400: {"description": "Email already registered"}})
async def create_auditor(
    body: CreateAuditorRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Create an auditor account within the tenant. The server generates a strong
    temporary password and returns it ONCE in the response. Caller is responsible
    for delivering it to the auditor via a secure channel (email, etc.). No
    auto-assignment — use /auditors/assign."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    temporary_password = body.temporary_password or _generate_auditor_password()
    auditor = User(
        tenant_id=tenant_id,
        email=body.email,
        hashed_password=hash_password(temporary_password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=UserRole.AUDITOR,
        is_verified=True,
        expires_at=body.expires_at,
    )
    db.add(auditor)
    await db.commit()
    return CreateAuditorResponse(
        id=auditor.id,
        email=auditor.email,
        first_name=auditor.first_name,
        last_name=auditor.last_name,
        role=auditor.role,
        is_active=auditor.is_active,
        expires_at=auditor.expires_at,
        temporary_password=temporary_password,
    )


# ── List auditors ─────────────────────────────────────────────────────────────

@router.get("/auditors", response_model=list[UserResponse])
async def list_auditors(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """List all auditor accounts in the tenant."""
    result = await db.execute(
        select(User).where(User.tenant_id == tenant_id, User.role == UserRole.AUDITOR).order_by(User.first_name)
    )
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


# ── Assign / unassign auditor to assessment ────────────────────────────────────

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


@router.get("/auditors/assignments", response_model=list[AssignmentResponse])
async def list_assignments(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """List all auditor→assessment assignments for this tenant."""
    result = await db.execute(
        select(AuditorAssignment).where(AuditorAssignment.tenant_id == tenant_id, AuditorAssignment.is_active == True)  # noqa: E712
    )
    assignments = result.scalars().all()
    items = []
    for a in assignments:
        auditor = (await db.execute(select(User).where(User.id == a.auditor_id))).scalar_one_or_none()
        assessment = (await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.id == a.assessment_id))).scalar_one_or_none()
        if auditor and assessment:
            items.append(AssignmentResponse(
                id=a.id,
                auditor_id=a.auditor_id,
                auditor_email=auditor.email,
                auditor_name=f"{auditor.first_name} {auditor.last_name}".strip(),
                assessment_id=a.assessment_id,
                assessment_name=assessment.name,
                is_active=a.is_active,
            ))
    return items


@router.post("/auditors/assign", response_model=AssignmentResponse, status_code=201,
             responses={400: {"description": "Invalid auditor or already assigned"}, 404: {"description": "Assessment not found"}})
async def assign_auditor(
    body: AssignAuditorRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Assign an auditor to a compliance assessment."""
    auditor = (await db.execute(select(User).where(User.id == body.auditor_id, User.tenant_id == tenant_id))).scalar_one_or_none()
    if not auditor or auditor.role != UserRole.AUDITOR:
        raise HTTPException(400, "Auditor not found in this tenant")

    assessment = (await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.id == body.assessment_id, ComplianceAssessment.tenant_id == tenant_id))).scalar_one_or_none()
    if not assessment:
        raise HTTPException(404, "Assessment not found")

    # Check not already assigned
    existing = (await db.execute(select(AuditorAssignment).where(
        AuditorAssignment.auditor_id == body.auditor_id,
        AuditorAssignment.assessment_id == body.assessment_id,
        AuditorAssignment.is_active == True,  # noqa: E712
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Auditor is already assigned to this assessment")

    assignment = AuditorAssignment(
        id=str(uuid4()),
        tenant_id=tenant_id,
        auditor_id=body.auditor_id,
        assessment_id=body.assessment_id,
        assigned_by_id=current_user.id,
        is_active=True,
        reference_document_ids=[],
    )
    db.add(assignment)
    await db.commit()

    return AssignmentResponse(
        id=assignment.id,
        auditor_id=auditor.id,
        auditor_email=auditor.email,
        auditor_name=f"{auditor.first_name} {auditor.last_name}".strip(),
        assessment_id=assessment.id,
        assessment_name=assessment.name,
        is_active=True,
    )


@router.delete("/auditors/{auditor_id}", status_code=204,
               responses={404: {"description": "Auditor not found"}, 403: {"description": "Not an auditor account"}})
async def delete_auditor(
    auditor_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Permanently delete an auditor account and all their assignments."""
    auditor = (await db.execute(
        select(User).where(User.id == auditor_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not auditor:
        raise HTTPException(404, "Auditor not found")
    if auditor.role != UserRole.AUDITOR:
        raise HTTPException(403, "Can only delete auditor accounts")

    # Remove all assignments first
    assignments = (await db.execute(
        select(AuditorAssignment).where(AuditorAssignment.auditor_id == auditor_id)
    )).scalars().all()
    for a in assignments:
        await db.delete(a)

    await db.delete(auditor)
    await db.commit()


@router.delete("/auditors/assignments/{assignment_id}", status_code=204,
               responses={404: {"description": "Assignment not found"}})
async def unassign_auditor(
    assignment_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Remove an auditor assignment."""
    a = (await db.execute(select(AuditorAssignment).where(AuditorAssignment.id == assignment_id, AuditorAssignment.tenant_id == tenant_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    await db.delete(a)
    await db.commit()


# ── General user management ────────────────────────────────────────────────────
# CISO is intentionally excluded — only SUPER_ADMIN can promote to CISO
_ASSIGNABLE_ROLES = {
    UserRole.RISK_MANAGER,
    UserRole.COMPLIANCE_MANAGER, UserRole.AUDITOR, UserRole.POLICY_MANAGER,
    UserRole.VENDOR_MANAGER, UserRole.CONTROL_OWNER, UserRole.VIEWER,
}


class UpdateUserPayload(BaseModel):
    is_active: bool | None = None
    role: str | None = None


class ResetPasswordResponse(BaseModel):
    temporary_password: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    role: str
    expires_at: datetime | None = None


@router.post("/create", response_model=CreateAuditorResponse, status_code=201,
             responses={400: {"description": "Email already registered or invalid role"}})
async def create_user(
    body: CreateUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Create a user with any assignable role. Server generates a temporary password."""
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Email already registered")
    try:
        role = UserRole(body.role)
    except ValueError:
        raise HTTPException(400, f"Invalid role: {body.role}")
    if role not in _ASSIGNABLE_ROLES:
        raise HTTPException(403, "Cannot assign that role")
    temp_password = _generate_auditor_password()
    new_user = User(
        tenant_id=tenant_id,
        email=body.email,
        hashed_password=hash_password(temp_password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=role,
        is_verified=True,
        expires_at=body.expires_at,
    )
    db.add(new_user)
    await db.commit()
    return CreateAuditorResponse(
        id=new_user.id,
        email=new_user.email,
        first_name=new_user.first_name,
        last_name=new_user.last_name,
        role=new_user.role,
        is_active=new_user.is_active,
        expires_at=new_user.expires_at,
        temporary_password=temp_password,
    )


@router.patch("/{user_id}", response_model=UserResponse,
              responses={400: {"description": "Cannot modify self"}, 404: {"description": "User not found"}, 403: {"description": "Forbidden"}})
async def update_user(
    user_id: str,
    body: UpdateUserPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Update a user's role or active status within the tenant."""
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot modify your own account")
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot modify super admin accounts")
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.role is not None:
        try:
            new_role = UserRole(body.role)
        except ValueError:
            raise HTTPException(400, f"Invalid role: {body.role}")
        if new_role not in _ASSIGNABLE_ROLES:
            raise HTTPException(403, "Cannot assign that role")
        user.role = new_role
    await db.commit()
    return UserResponse.model_validate(user)


@router.post("/{user_id}/reset-password", response_model=ResetPasswordResponse,
             responses={404: {"description": "User not found"}, 403: {"description": "Forbidden"}})
async def reset_user_password(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Reset a user's password and return the new temporary password once."""
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot reset super admin passwords")
    new_password = _generate_auditor_password()
    user.hashed_password = hash_password(new_password)
    await db.commit()
    return ResetPasswordResponse(temporary_password=new_password)


@router.delete("/{user_id}", status_code=204,
               responses={400: {"description": "Cannot delete self"}, 404: {"description": "User not found"}, 403: {"description": "Forbidden"}})
async def delete_user(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Delete any user in the tenant except self and super admins."""
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
