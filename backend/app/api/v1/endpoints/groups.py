"""Team Groups — bundle users and grant them a shared set of roles.

tenant_admin only. Distinct from /governance/groups (RACI assignment groups,
feature-gated, no bearing on access control).
"""
import logging
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
logger = logging.getLogger(__name__)


async def _log_rights_change(
    db: AsyncSession, tenant_id: str, actor: User, group_id: str, group_name: str, details: dict,
) -> None:
    """Append a group rights_change to the hash-chained audit trail.

    Best-effort by design — the group change is already committed and losing the
    log must not roll it back — but never silent: an unrecorded entitlement
    change is precisely what an access review exists to catch.
    """
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=actor.id,
            user_email=actor.email,
            action="rights_change",
            entity_type="group",
            entity_id=group_id,
            entity_name=group_name,
            details=details,
            origin="api",
        ))
    except Exception:  # noqa: BLE001
        logger.warning("rights_change audit entry not recorded for group %s", group_id)


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
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
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

    # Creating a group with roles and members grants those roles to those people
    # (see services/authz.py) — the same rights change update_group already
    # records, and it left no trace at all here. Written after the commit:
    # chain_and_add commits, so logging first would publish a grant that is
    # still pending.
    if group.roles or group.member_ids:
        await _log_rights_change(
            db, tenant_id, current_user, group.id, group.name,
            {
                "changed": {
                    "roles": {"from": [], "to": sorted(group.roles or [])},
                    "member_ids": {"from": [], "to": sorted(group.member_ids or [])},
                },
                "members_added": sorted(group.member_ids or []),
                "members_removed": [],
                "affected_user_ids": sorted(group.member_ids or []),
                "changed_by": current_user.email,
                "source": "group_admin",
                "operation": "create",
            },
        )
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
        await _log_rights_change(
            db, tenant_id, current_user, group.id, group.name,
            {
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
                "operation": "update",
            },
        )
    return group


@router.delete("/{group_id}", status_code=204)
async def delete_group(
    group_id: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Group).where(Group.id == group_id, Group.tenant_id == tenant_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(404, "Group not found")

    # Deleting a group revokes its roles from every member at once — the largest
    # rights change this file can make, and the only one that left no trace.
    # Capture the state first: the row is gone by the time the entry is written,
    # and it is the only remaining record of who held what through this group.
    deleted_id, deleted_name = group.id, group.name
    deleted_roles = sorted(group.roles or [])
    deleted_members = sorted(group.member_ids or [])

    await db.delete(group)
    await db.commit()

    if deleted_roles or deleted_members:
        await _log_rights_change(
            db, tenant_id, current_user, deleted_id, deleted_name,
            {
                "changed": {
                    "roles": {"from": deleted_roles, "to": []},
                    "member_ids": {"from": deleted_members, "to": []},
                },
                "members_added": [],
                "members_removed": deleted_members,
                "affected_user_ids": deleted_members,
                "changed_by": current_user.email,
                "source": "group_admin",
                "operation": "delete",
            },
        )
    return None
