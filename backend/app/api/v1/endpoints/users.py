"""User management endpoints — create auditors, list tenant users."""
from datetime import datetime
from typing import Annotated
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

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
    temporary_password: str
    expires_at: datetime | None = None


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool
    expires_at: datetime | None = None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[UserResponse])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """List all users in the tenant."""
    result = await db.execute(select(User).where(User.tenant_id == tenant_id).order_by(User.first_name))
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


@router.post("/auditors", response_model=UserResponse, status_code=status.HTTP_201_CREATED,
             responses={400: {"description": "Email already registered"}})
async def create_auditor(
    body: CreateAuditorRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Create an auditor account within the tenant. No auto-assignment — use /auditors/assign."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    auditor = User(
        tenant_id=tenant_id,
        email=body.email,
        hashed_password=hash_password(body.temporary_password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=UserRole.AUDITOR,
        is_verified=True,
        expires_at=body.expires_at,
    )
    db.add(auditor)
    await db.commit()
    return UserResponse.model_validate(auditor)


# ── List auditors ─────────────────────────────────────────────────────────────

@router.get("/auditors", response_model=list[UserResponse])
async def list_auditors(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
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
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
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
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
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


@router.delete("/auditors/assignments/{assignment_id}", status_code=204,
               responses={404: {"description": "Assignment not found"}})
async def unassign_auditor(
    assignment_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Remove an auditor assignment."""
    a = (await db.execute(select(AuditorAssignment).where(AuditorAssignment.id == assignment_id, AuditorAssignment.tenant_id == tenant_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    await db.delete(a)
    await db.commit()
