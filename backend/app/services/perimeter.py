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


# The refusal below is shown to the client's propriétaires métier, who work in
# French and Arabic; every other user-facing message in this codebase is
# localised. Same key/lang/fallback shape as the endpoints' own _msg tables
# (vendors.py, regulatory.py, contract_collab.py).
_OUTSIDE_PERIMETER = {
    "en": "This {what} is outside your business perimeter. "
          "You may only act on records you own.",
    "fr": "Cet élément ({what}) est en dehors de votre périmètre métier. "
          "Vous ne pouvez agir que sur les enregistrements dont vous êtes propriétaire.",
    "ar": "هذا العنصر ({what}) خارج نطاق مسؤوليتك. "
          "لا يمكنك التصرف إلا في السجلات التي تملكها.",
}

# The noun interpolated into the sentence, so a French message does not read
# "Cet élément (risk)". Unknown kinds fall back to the caller's own word.
_WHAT_NOUNS = {
    "risk": {"fr": "risque", "ar": "خطر"},
    "record": {"fr": "enregistrement", "ar": "سجل"},
}


def owns(user: User, record) -> bool:
    """Whether the record falls inside this user's perimeter."""
    return getattr(record, "owner_id", None) == user.id


def assert_in_perimeter(
    user: User, record, effective_roles: set[str] | None = None, what: str = "record",
    lang: str = "en",
) -> None:
    """Refuse the action when a perimeter-scoped user does not own the record.

    404 rather than 403 would hide that the record exists, but the caller can
    already read it — the tenant, not the perimeter, decides visibility — so
    403 with a plain reason is the honest answer.

    ``lang`` defaults to "en", so a caller that does not resolve a language
    gets exactly the wording it got before.
    """
    if not is_perimeter_scoped(user, effective_roles):
        return
    if owns(user, record):
        return
    noun = _WHAT_NOUNS.get(what, {}).get(lang, what)
    template = _OUTSIDE_PERIMETER.get(lang) or _OUTSIDE_PERIMETER["en"]
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=template.format(what=noun),
    )
