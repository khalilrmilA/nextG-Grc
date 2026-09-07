"""Effective-role computation for Team Groups, delegations + per-user rules."""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.group import Group


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def get_effective_roles(user: User, db: AsyncSession) -> set[str]:
    """A user's effective role set.

    Personal roles, plus roles granted by any Group they belong to, plus roles
    currently delegated to them, minus their own excluded_roles carve-outs.

    Delegations are resolved here so every existing ``require_roles`` check
    honours them without being modified, and their window is evaluated now
    rather than by a job — an entitlement that only expires when a scheduler
    runs is one that outlives its window whenever the scheduler does not.

    excluded_roles is applied last and therefore also overrides a delegation:
    an explicit carve-out on an account must not be reachable by lending.
    """
    from app.models.access_governance import AccessDelegation

    base = set(user.roles or [user.role.value if hasattr(user.role, "value") else user.role])

    groups = (
        await db.execute(select(Group).where(Group.tenant_id == user.tenant_id))
    ).scalars().all()
    for g in groups:
        if user.id in (g.member_ids or []):
            base |= set(g.roles or [])

    now = _utcnow()
    delegations = (await db.execute(
        select(AccessDelegation).where(
            AccessDelegation.tenant_id == user.tenant_id,
            AccessDelegation.delegate_id == user.id,
            AccessDelegation.revoked_at.is_(None),
            AccessDelegation.starts_at <= now,
            AccessDelegation.ends_at >= now,
        )
    )).scalars().all()
    for d in delegations:
        base |= set(d.roles or [])

    return base - set(user.excluded_roles or [])
