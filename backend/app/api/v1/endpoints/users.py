"""User management endpoints — create auditors, list tenant users."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from app.core.database import get_db
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.api.v1.dependencies import get_tenant_id
from app.api.v1.dependencies.auth import require_roles

router = APIRouter()


class CreateAuditorRequest(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    temporary_password: str


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool

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
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Create an auditor account within the tenant."""
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
    )
    db.add(auditor)
    await db.flush()
    return UserResponse.model_validate(auditor)
