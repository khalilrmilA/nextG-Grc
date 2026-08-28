"""Effective-role computation for Team Groups + per-user custom access rules."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.group import Group


async def get_effective_roles(user: User, db: AsyncSession) -> set[str]:
    """A user's effective role set: personal roles, plus roles granted by any
    Group they belong to, minus their own excluded_roles carve-outs."""
    base = set(user.roles or [user.role.value if hasattr(user.role, "value") else user.role])

    groups = (
        await db.execute(select(Group).where(Group.tenant_id == user.tenant_id))
    ).scalars().all()
    for g in groups:
        if user.id in (g.member_ids or []):
            base |= set(g.roles or [])

    return base - set(user.excluded_roles or [])
