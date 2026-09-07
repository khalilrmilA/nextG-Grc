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
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

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
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Group).where(Group.id == group_id, Group.tenant_id == tenant_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(404, "Group not found")

    # A group grants its roles to every member (see services/authz.py), so
    # editing its roles or its membership IS a rights change for real people —
    # and it used to leave no audit entry at all. Capture before/after and name
    # the users whose access moved, so "who could do what, when" is answerable
    # from the log rather than only from today's group state.
    before = {
        "roles": sorted(group.roles or []),
        "member_ids": sorted(group.member_ids or []),
    }

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

    # Sorted on both sides: membership and roles are sets, so re-submitting the
    # same ids in a different order is not a rights change and must not
    # manufacture an audit entry.
    after = {"roles": sorted(group.roles or []), "member_ids": sorted(group.member_ids or [])}
    if after != before:
        added = sorted(set(after["member_ids"]) - set(before["member_ids"]))
        removed = sorted(set(before["member_ids"]) - set(after["member_ids"]))
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id,
                user_id=current_user.id,
                user_email=current_user.email,
                action="rights_change",
                entity_type="group",
                entity_id=group.id,
                entity_name=group.name,
                details={
                    "changed": {
                        k: {"from": before[k], "to": after[k]}
                        for k in before if before[k] != after[k]
                    },
                    "members_added": added,
                    "members_removed": removed,
                    "affected_user_ids": sorted(set(added) | set(removed) | set(after["member_ids"]))
                    if before["roles"] != after["roles"] else sorted(set(added) | set(removed)),
                    "changed_by": current_user.email,
                    "source": "group_admin",
                },
                origin="api",
            ))
        except Exception:
            pass
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
