"""Business perimeter — "sur son périmètre métier".

Every role in the client's requirements is defined by a scope of
responsibility: the Propriétaire métier validates risks *on their business
perimeter*, the Responsable Risques steers *their* risks. The implementation
was scoped only by tenant, so any of them could act on anything the tenant
owned.

The rule here is deliberately narrow, because the alternative breaks a live
system. **Reading stays tenant-wide.** A business owner who cannot see the
tenant's overall risk position cannot do their job, and silently hiding rows
from existing users would look like data loss. What is scoped is *acting*: a
perimeter-scoped role may only validate or modify records it owns.

Ownership is direct: ``owner_id`` on the record. A role that is not
perimeter-scoped (CISO, tenant_admin, risk_manager) is unaffected, so this adds
a restriction exactly where the requirement asks for one and nowhere else.
"""
from __future__ import annotations

from fastapi import HTTPException, status

from app.models.user import User, UserRole

# Roles the client defines as acting "on their perimeter" rather than across the
# organisation. CISO and the administrators supervise the whole tenant by
# definition and are never perimeter-scoped.
PERIMETER_SCOPED_ROLES = {
    UserRole.BUSINESS_OWNER.value,
    UserRole.CONTROL_OWNER.value,
}

# Roles that always see and act across the tenant.
ORGANISATION_WIDE_ROLES = {
    UserRole.SUPER_ADMIN.value,
    UserRole.TENANT_ADMIN.value,
    UserRole.CISO.value,
    UserRole.RISK_MANAGER.value,
    UserRole.COMPLIANCE_MANAGER.value,
}


def _role_values(user: User, effective_roles: set[str] | None) -> set[str]:
    if effective_roles:
        return effective_roles
    scalar = user.role.value if hasattr(user.role, "value") else str(user.role)
    return set(user.roles or [scalar])


def is_perimeter_scoped(user: User, effective_roles: set[str] | None = None) -> bool:
    """True when this user may only act on records they own.

    An organisation-wide role wins: someone who is both a CISO and a business
    owner supervises the whole tenant, so the narrower role must not take
    authority away from the broader one.
    """
    roles = _role_values(user, effective_roles)
    if roles & ORGANISATION_WIDE_ROLES:
        return False
    return bool(roles & PERIMETER_SCOPED_ROLES)


def owns(user: User, record) -> bool:
    """Whether the record falls inside this user's perimeter."""
    return getattr(record, "owner_id", None) == user.id


def assert_in_perimeter(
    user: User, record, effective_roles: set[str] | None = None, what: str = "record"
) -> None:
    """Refuse the action when a perimeter-scoped user does not own the record.

    404 rather than 403 would hide that the record exists, but the caller can
    already read it — the tenant, not the perimeter, decides visibility — so
    403 with a plain reason is the honest answer.
    """
    if not is_perimeter_scoped(user, effective_roles):
        return
    if owns(user, record):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"This {what} is outside your business perimeter. "
               f"You may only act on records you own.",
    )
