"""Team Groups — bundle users and grant them a shared set of roles.

tenant_admin only. Distinct from /governance/groups (RACI assignment groups,
feature-gated, no bearing on access control).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, UserRole, ASSIGNABLE_ROLES
from app.models.group import Group
from app.api.v1.dependencies.auth import require_roles
from app.api.v1.dependencies import get_tenant_id

router = APIRouter()


def _validate_roles(roles: list[str]) -> list[str]:
    validated: list[str] = []
    for r in roles:
        try:
            role_enum = UserRole(r)
        except ValueError:
            raise HTTPException(400, f"Invalid role: {r}")
        if role_enum not in ASSIGNABLE_ROLES:
            raise HTTPException(403, f"Cannot grant role via group: {r}")
        validated.append(role_enum.value)
    return validated


async def _validate_members(member_ids: list[str], tenant_id: str, db: AsyncSession) -> list[str]:
    if not member_ids:
        return []
    result = await db.execute(
        select(User.id).where(User.id.in_(member_ids), User.tenant_id == tenant_id)
    )
    valid_ids = {row[0] for row in result.all()}
    unknown = set(member_ids) - valid_ids
    if unknown:
        raise HTTPException(400, f"Unknown member id(s): {sorted(unknown)}")
    return member_ids


class GroupIn(BaseModel):
    name: str
    description: str | None = None
    member_ids: list[str] = []
    roles: list[str] = []


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    member_ids: list[str] | None = None
    roles: list[str] | None = None


class GroupOut(BaseModel):
    id: str
    name: str
    description: str | None
    member_ids: list
    roles: list
    model_config = {"from_attributes": True}


@router.get("", response_model=list[GroupOut])
async def list_groups(
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Group).where(Group.tenant_id == tenant_id))
    return list(result.scalars().all())


@router.post("", response_model=GroupOut, status_code=201)
async def create_group(
    body: GroupIn,
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    member_ids = await _validate_members(body.member_ids, tenant_id, db)
    group = Group(
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        member_ids=member_ids,
        roles=_validate_roles(body.roles),
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.patch("/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: str,
    body: GroupUpdate,
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Group).where(Group.id == group_id, Group.tenant_id == tenant_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(404, "Group not found")

    if body.name is not None:
        group.name = body.name
    if body.description is not None:
        group.description = body.description
    if body.member_ids is not None:
        group.member_ids = await _validate_members(body.member_ids, tenant_id, db)
    if body.roles is not None:
        group.roles = _validate_roles(body.roles)

    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=204)
async def delete_group(
    group_id: str,
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Group).where(Group.id == group_id, Group.tenant_id == tenant_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(404, "Group not found")
    await db.delete(group)
    await db.commit()
    return None
