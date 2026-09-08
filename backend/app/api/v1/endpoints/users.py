"""User management endpoints — tenant_admin manages all users with multi-role support."""
import hashlib
import logging
import secrets
import string
from datetime import datetime, timedelta
from typing import Annotated
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr


def _generate_password() -> str:
    """Cryptographically random 16-char password with mixed alphabet/digits."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))


from app.core.database import get_db, AsyncSessionLocal
from app.core.security import hash_password_async
from app.core.password_policy import validate_password, PasswordPolicyError
from app.models.user import User, UserRole, ASSIGNABLE_ROLES
from app.models.tenant import Tenant
from app.models.group import Group
from app.models.password_reset import PasswordResetToken
from app.models.compliance import ComplianceAssessment
from app.models.auditor_assignment import AuditorAssignment
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add, is_system_actor
from app.services.authz import get_effective_roles
from app.api.v1.dependencies import get_tenant_id
from app.api.v1.dependencies.auth import get_current_user, require_roles

router = APIRouter()
logger = logging.getLogger(__name__)


async def _send_welcome_email(user: User) -> None:
    """Email a first-login 'set your password' link to an admin-created user.

    Reuses the exact same mechanism as /auth/forgot-password: a single-use,
    SHA-256-hashed, 1-hour-expiring PasswordResetToken emailed as a link (never the
    temp password itself). Best-effort — wrapped so a broken/unconfigured SMTP relay
    (dev has none) never fails account creation, matching the resilience pattern
    already used by forgot_password's own send_email() call and the login journal.
    """
    try:
        from app.core.config import settings as app_settings
        from app.services.email_service import send_email

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        async with AsyncSessionLocal() as db:
            db.add(PasswordResetToken(
                user_id=user.id,
                token_hash=token_hash,
                expires_at=datetime.utcnow() + timedelta(hours=1),
            ))
            await db.commit()

        base = (getattr(app_settings, "FRONTEND_BASE_URL", "") or "https://grceye.com/app").rstrip("/")
        set_password_link = f"{base}/reset-password?token={raw_token}"

        await send_email(
            to_email=user.email,
            subject="Welcome to GRCEye — set your password",
            template_name="notification.html",
            context={
                "title": f"Welcome, {user.first_name}",
                "message": (
                    "An administrator created a GRCEye account for you. Click below to "
                    "set your own password and sign in (link valid for 1 hour). If you "
                    "weren't expecting this, contact your administrator."
                ),
                "action_url": set_password_link,
                "action_label": "Set my password",
            },
        )
    except Exception:  # noqa: BLE001 — must never fail account creation
        logger.warning("welcome email failed to send for new user %s", user.id)

class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    roles: list[str] = []
    excluded_roles: list[str] = []
    effective_roles: list[str] = []
    is_active: bool
    expires_at: datetime | None = None
    # "auditeurs internes ou externes": User.is_external / external_org were read
    # (audit comments label an outside author) but no endpoint could ever set
    # them, so every one of the 17 live accounts is internal by construction.
    is_external: bool = False
    external_org: str | None = None

    model_config = {"from_attributes": True}


class CreateUserResponse(UserResponse):
    """Returned only on creation — exposes the one-time auto-generated password."""
    temporary_password: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    roles: list[str]          # one or more roles from ASSIGNABLE_ROLES
    expires_at: datetime | None = None
    # Optional: omitted means internal, which is what every existing row is.
    is_external: bool = False
    external_org: str | None = None


class UpdateUserPayload(BaseModel):
    is_active: bool | None = None
    roles: list[str] | None = None            # replace the user's full roles list
    excluded_roles: list[str] | None = None   # replace the user's group-role carve-outs
    is_external: bool | None = None           # internal vs external auditor/consultant
    external_org: str | None = None           # firm name, when external


class ResetPasswordResponse(BaseModel):
    temporary_password: str


# ── List all users ────────────────────────────────────────────────────────────

@router.get("", response_model=list[UserResponse])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    # Exclude the automated-task principal (see services/activity_chain.py).
    # It is an audit actor, not a person: showing it invites an admin to give
    # it a password or activate it, which would let someone sign in AS the
    # batch principal and launder their actions into "the system did it".
    result = await db.execute(
        select(User)
        .where(User.tenant_id == tenant_id, User.email.notlike("system+%@grceye.local"))
        .order_by(User.first_name)
    )
    users = result.scalars().all()

    # Fetch the tenant's groups once and reuse across every row instead of
    # re-querying per user (get_effective_roles alone would be N+1 here).
    groups = (await db.execute(select(Group).where(Group.tenant_id == tenant_id))).scalars().all()

    def _effective(u: User) -> list[str]:
        base = set(u.roles or [u.role.value if hasattr(u.role, "value") else u.role])
        for g in groups:
            if u.id in (g.member_ids or []):
                base |= set(g.roles or [])
        return sorted(base - set(u.excluded_roles or []))

    return [
        UserResponse(
            id=u.id, email=u.email, first_name=u.first_name, last_name=u.last_name,
            role=u.role.value if hasattr(u.role, "value") else u.role,
            roles=u.roles or [],
            excluded_roles=u.excluded_roles or [],
            effective_roles=_effective(u),
            is_active=u.is_active, expires_at=u.expires_at,
            is_external=bool(u.is_external), external_org=u.external_org,
        )
        for u in users
    ]


# ── Create user ───────────────────────────────────────────────────────────────

@router.post("/create", response_model=CreateUserResponse, status_code=201,
             responses={400: {"description": "Email already registered or invalid role"},
                        422: {"description": "Email domain does not match the tenant's configured domain"}})
async def create_user(
    body: CreateUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Create a user with one or more assignable roles. Server generates a temporary
    password, forces a password change on first login, and emails the new user a
    first-login link (see _send_welcome_email)."""
    normalized_email = body.email.strip().lower()
    existing = (await db.execute(select(User).where(User.email == normalized_email))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Email already registered")

    if not body.roles:
        raise HTTPException(400, "At least one role is required")

    # Soft domain check: only enforced when the tenant has an explicit professional
    # domain configured (Tenant.domain). Demo/gmail-based tenants with no fixed domain
    # are left untouched — we don't invent new required config that could break them.
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if tenant and tenant.domain:
        expected_domain = tenant.domain.strip().lower().lstrip("@")
        new_domain = normalized_email.rsplit("@", 1)[-1]
        if new_domain != expected_domain:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Email domain must match your organization's domain (@{expected_domain})",
            )

    validated_roles: list[UserRole] = []
    for r in body.roles:
        try:
            role_enum = UserRole(r)
        except ValueError:
            raise HTTPException(400, f"Invalid role: {r}")
        if role_enum not in ASSIGNABLE_ROLES:
            raise HTTPException(403, f"Cannot assign role: {r}")
        validated_roles.append(role_enum)

    primary_role = validated_roles[0]
    temp_password = _generate_password()
    new_user = User(
        tenant_id=tenant_id,
        email=normalized_email,
        hashed_password=await hash_password_async(temp_password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=primary_role,
        roles=[r.value for r in validated_roles],
        is_verified=True,
        expires_at=body.expires_at,
        is_external=bool(body.is_external),
        external_org=(body.external_org or None) if body.is_external else None,
        # Admin-set temp password → always force a change on first login.
        must_change_password=True,
    )
    db.add(new_user)
    await db.commit()

    await _send_welcome_email(new_user)

    return CreateUserResponse(
        id=new_user.id, email=new_user.email,
        first_name=new_user.first_name, last_name=new_user.last_name,
        role=new_user.role.value if hasattr(new_user.role, "value") else new_user.role,
        roles=new_user.roles or [],
        excluded_roles=[],
        effective_roles=sorted(new_user.roles or []),
        is_active=new_user.is_active,
        expires_at=new_user.expires_at,
        is_external=bool(new_user.is_external),
        external_org=new_user.external_org,
        temporary_password=temp_password,
    )


# ── Update user (roles / active status) ──────────────────────────────────────

@router.patch("/{user_id}", response_model=UserResponse,
              responses={400: {"description": "Cannot modify self"}, 404: {"description": "User not found"}})
async def update_user(
    user_id: str,
    body: UpdateUserPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot modify your own account")
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot modify super admin accounts")

    if is_system_actor(user.email):
        raise HTTPException(403, "The automated-task account cannot be modified.")
    old_role = user.role.value if hasattr(user.role, "value") else user.role
    old_roles = list(user.roles or [])
    # Everything that decides what this account may do. Watching only role/roles
    # missed real rights changes: an excluded_roles-only edit revokes access and
    # used to leave no trace, and deactivating an account is an authorisation
    # change too.
    old_entitlements = {
        "role": old_role,
        "roles": old_roles,
        "excluded_roles": list(user.excluded_roles or []),
        "is_active": user.is_active,
    }

    if body.is_active is not None:
        user.is_active = body.is_active

    if body.roles is not None:
        if not body.roles:
            raise HTTPException(400, "At least one role is required")
        validated: list[UserRole] = []
        for r in body.roles:
            try:
                role_enum = UserRole(r)
            except ValueError:
                raise HTTPException(400, f"Invalid role: {r}")
            if role_enum not in ASSIGNABLE_ROLES:
                raise HTTPException(403, f"Cannot assign role: {r}")
            validated.append(role_enum)
        user.role = validated[0]
        user.roles = [r.value for r in validated]

    if body.excluded_roles is not None:
        validated_excl: list[str] = []
        for r in body.excluded_roles:
            try:
                role_enum = UserRole(r)
            except ValueError:
                raise HTTPException(400, f"Invalid role: {r}")
            if role_enum not in ASSIGNABLE_ROLES:
                raise HTTPException(403, f"Cannot exclude role: {r}")
            validated_excl.append(role_enum.value)
        user.excluded_roles = validated_excl

    # Internal vs external is a qualification, not an entitlement, so it stays out
    # of the rights_change diff below. Clearing the flag clears the firm name with
    # it — an "external_org" on an internal account would be a lie in the record.
    if body.external_org is not None:
        user.external_org = body.external_org or None
    if body.is_external is not None:
        user.is_external = body.is_external
        if not body.is_external:
            # The clear is authoritative even when the same request also sends a
            # firm name, so {is_external: false, external_org: "X"} can't leave an
            # internal account carrying an external firm.
            user.external_org = None

    if body.roles is not None or body.excluded_roles is not None:
        if not await get_effective_roles(user, db):
            raise HTTPException(400, "This would leave the user with no module access.")

    await db.commit()

    # The generic ActivityLogMiddleware only records {method, path} for every
    # mutating request — it can't see the request body, so old_role -> new_role
    # (the RFP's literal audit-trail example) wouldn't otherwise be captured
    # anywhere. Write an explicit entry to the same hash-chained log, reusing the
    # existing activity_chain service (mirrors the delete-reason entry added for
    # applied_controls.py). Best-effort: a logging failure must never roll back
    # the role change that already committed above.
    new_entitlements = {
        "role": user.role.value if hasattr(user.role, "value") else user.role,
        "roles": list(user.roles or []),
        "excluded_roles": list(user.excluded_roles or []),
        "is_active": user.is_active,
    }
    changed = {
        field: {"from": old_entitlements[field], "to": new_entitlements[field]}
        for field in old_entitlements
        if old_entitlements[field] != new_entitlements[field]
    }
    if changed:
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id,
                user_id=current_user.id,
                user_email=current_user.email,
                action="rights_change",
                entity_type="user",
                entity_id=user.id,
                entity_name=f"{user.first_name} {user.last_name}".strip(),
                details={
                    "subject_user_id": user.id,
                    "changed": changed,
                    "changed_by": current_user.email,
                    "source": "admin_ui",
                },
                origin="api",
            ))
        except Exception:  # noqa: BLE001 — the rights change is already committed
            # Never silent: a lost rights_change entry is exactly the gap an
            # access review is meant to close, and it has to be visible in the
            # application log even when the audit write itself fails.
            logger.warning("rights_change audit entry not recorded for user %s", user.id)

    return UserResponse(
        id=user.id, email=user.email, first_name=user.first_name, last_name=user.last_name,
        role=user.role.value if hasattr(user.role, "value") else user.role,
        roles=user.roles or [],
        excluded_roles=user.excluded_roles or [],
        effective_roles=sorted(await get_effective_roles(user, db)),
        is_active=user.is_active, expires_at=user.expires_at,
        is_external=bool(user.is_external), external_org=user.external_org,
    )


# ── Reset password ────────────────────────────────────────────────────────────

@router.post("/{user_id}/reset-password", response_model=ResetPasswordResponse,
             responses={404: {"description": "User not found"}})
async def reset_user_password(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot reset super admin passwords")
    # The automated-task principal has no password precisely so it can never be
    # signed into. Issuing one would let an admin act AS the batch actor and
    # have their own changes recorded as "the system did it".
    if is_system_actor(user.email):
        raise HTTPException(403, "The automated-task account cannot be given a password.")
    new_password = _generate_password()
    user.hashed_password = await hash_password_async(new_password)
    await db.commit()
    return ResetPasswordResponse(temporary_password=new_password)


# ── Delete user ───────────────────────────────────────────────────────────────

@router.delete("/{user_id}", status_code=204,
               responses={400: {"description": "Cannot delete self"}, 404: {"description": "User not found"}})
async def delete_user(
    user_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot delete your own account")
    user = (await db.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    # Deleting the automated-task principal orphans every audit entry that
    # references it and, on a database that enforces foreign keys, breaks batch
    # logging for this tenant from then on.
    if user and is_system_actor(user.email):
        raise HTTPException(403, "The automated-task account cannot be deleted.")
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Cannot delete super admin accounts")

    # Capture the identity before the row goes. activity_logs.user_id keeps
    # pointing at it afterwards and the middleware writes those rows with an
    # empty user_email, so without this the actor behind every entry this
    # account ever produced becomes unrecoverable. A deleted_at column on User
    # is the real fix (see the handover notes); this entry is what makes the
    # id resolvable in the meantime.
    deleted = {
        "subject_user_id": user.id,
        "email": user.email,
        "name": f"{user.first_name} {user.last_name}".strip(),
        "role": user.role.value if hasattr(user.role, "value") else user.role,
        "deleted_by": current_user.email,
        "source": "admin_ui",
    }
    subject_name = deleted["name"]

    await db.delete(user)
    await db.commit()

    # After the commit — chain_and_add commits, so logging first would publish a
    # deletion the database might still roll back. Best-effort, and never
    # silent: mirrors the rights_change entry in update_user above.
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=current_user.id,
            user_email=current_user.email,
            action="user_deleted",
            entity_type="user",
            entity_id=user_id,
            entity_name=subject_name,
            details=deleted,
            origin="api",
        ))
    except Exception:  # noqa: BLE001 — the deletion is already committed
        logger.warning("user_deleted audit entry not recorded for user %s", user_id)


# ── Auditor assignment helpers (kept for auditor portal compatibility) ─────────

class CreateAuditorRequest(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    expires_at: datetime | None = None
    temporary_password: str | None = None
    # External auditors are the whole point of this endpoint, so let the caller
    # say so. Defaults keep every existing caller's behaviour (internal).
    is_external: bool = False
    external_org: str | None = None


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


@router.get("/auditors", response_model=list[UserResponse])
async def list_auditors(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    result = await db.execute(
        select(User).where(User.tenant_id == tenant_id, User.role == UserRole.AUDITOR).order_by(User.first_name)
    )
    users = result.scalars().all()

    # Same one-shot group prefetch as list_users: get_effective_roles per row
    # would be N+1, and the field is otherwise wrong rather than merely absent.
    groups = (await db.execute(select(Group).where(Group.tenant_id == tenant_id))).scalars().all()

    def _effective(u: User) -> list[str]:
        base = set(u.roles or [u.role.value if hasattr(u.role, "value") else u.role])
        for g in groups:
            if u.id in (g.member_ids or []):
                base |= set(g.roles or [])
        return sorted(base - set(u.excluded_roles or []))

    return [
        UserResponse(
            id=u.id, email=u.email, first_name=u.first_name, last_name=u.last_name,
            role=u.role.value if hasattr(u.role, "value") else u.role,
            roles=u.roles or [], is_active=u.is_active, expires_at=u.expires_at,
            # These were all left at their model defaults, so this list showed
            # every auditor as having no exclusions, no effective roles at all,
            # and no way to tell an external firm's auditor from an employee.
            excluded_roles=u.excluded_roles or [],
            effective_roles=_effective(u),
            is_external=bool(u.is_external), external_org=u.external_org,
        )
        for u in users
    ]


@router.post("/auditors", response_model=CreateUserResponse, status_code=status.HTTP_201_CREATED)
async def create_auditor(
    body: CreateAuditorRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    # Normalise exactly as /auth/login and POST /users/create do. Pydantic's
    # EmailStr lowercases only the domain, so "Foo.Bar@bank.tn" was stored with
    # its capitals intact — and login(), which lowercases the whole address
    # before looking it up, could then NEVER find that account. The account was
    # created, the temporary password handed over, and sign-in failed forever
    # with "Invalid email or password". The case-sensitive duplicate check below
    # had the matching hole: it let a second row exist for the same address.
    normalized_email = body.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # A caller-chosen password has to meet the same policy as every other
    # set-password path (password_policy's own docstring names "auditor create"
    # as a call site); the server-generated fallback is 16 random alphanumerics.
    if body.temporary_password:
        try:
            validate_password(body.temporary_password)
        except PasswordPolicyError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    temp_password = body.temporary_password or _generate_password()

    auditor = User(
        tenant_id=tenant_id, email=normalized_email,
        hashed_password=await hash_password_async(temp_password),
        first_name=body.first_name, last_name=body.last_name,
        role=UserRole.AUDITOR, roles=["auditor"],
        is_verified=True, expires_at=body.expires_at,
        is_external=bool(body.is_external),
        external_org=(body.external_org or None) if body.is_external else None,
        # Same rule as POST /users/create: an administrator-set password is
        # temporary by definition.
        must_change_password=True,
    )
    db.add(auditor)
    await db.commit()
    return CreateUserResponse(
        id=auditor.id, email=auditor.email,
        first_name=auditor.first_name, last_name=auditor.last_name,
        role="auditor", roles=["auditor"],
        excluded_roles=[], effective_roles=["auditor"],
        is_active=auditor.is_active, expires_at=auditor.expires_at,
        is_external=bool(auditor.is_external), external_org=auditor.external_org,
        temporary_password=temp_password,
    )


@router.get("/auditors/assignments", response_model=list[AssignmentResponse])
async def list_assignments(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    result = await db.execute(
        select(AuditorAssignment).where(AuditorAssignment.tenant_id == tenant_id, AuditorAssignment.is_active == True)  # noqa: E712
    )
    assignments = list(result.scalars().all())

    # Index the auditors and assessments once instead of two SELECTs per row.
    auditor_ids = {a.auditor_id for a in assignments}
    assessment_ids = {a.assessment_id for a in assignments}
    auditors = {
        u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(auditor_ids))
        )).scalars().all()
    } if auditor_ids else {}
    assessments = {
        c.id: c for c in (await db.execute(
            select(ComplianceAssessment).where(ComplianceAssessment.id.in_(assessment_ids))
        )).scalars().all()
    } if assessment_ids else {}

    items = []
    for a in assignments:
        auditor = auditors.get(a.auditor_id)
        assessment = assessments.get(a.assessment_id)
        if auditor and assessment:
            items.append(AssignmentResponse(
                id=a.id, auditor_id=a.auditor_id,
                auditor_email=auditor.email,
                auditor_name=f"{auditor.first_name} {auditor.last_name}".strip(),
                assessment_id=a.assessment_id, assessment_name=assessment.name, is_active=a.is_active,
            ))
    return items


@router.post("/auditors/assign", response_model=AssignmentResponse, status_code=201)
async def assign_auditor(
    body: AssignAuditorRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    auditor = (await db.execute(select(User).where(User.id == body.auditor_id, User.tenant_id == tenant_id))).scalar_one_or_none()
    if not auditor or auditor.role != UserRole.AUDITOR:
        raise HTTPException(400, "Auditor not found in this tenant")
    assessment = (await db.execute(select(ComplianceAssessment).where(ComplianceAssessment.id == body.assessment_id, ComplianceAssessment.tenant_id == tenant_id))).scalar_one_or_none()
    if not assessment:
        raise HTTPException(404, "Assessment not found")
    existing = (await db.execute(select(AuditorAssignment).where(
        AuditorAssignment.auditor_id == body.auditor_id,
        AuditorAssignment.assessment_id == body.assessment_id,
        AuditorAssignment.is_active == True,  # noqa: E712
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Auditor is already assigned to this assessment")
    assignment = AuditorAssignment(
        id=str(uuid4()), tenant_id=tenant_id,
        auditor_id=body.auditor_id, assessment_id=body.assessment_id,
        assigned_by_id=current_user.id, is_active=True, reference_document_ids=[],
    )
    db.add(assignment)
    await db.commit()
    return AssignmentResponse(
        id=assignment.id, auditor_id=auditor.id, auditor_email=auditor.email,
        auditor_name=f"{auditor.first_name} {auditor.last_name}".strip(),
        assessment_id=assessment.id, assessment_name=assessment.name, is_active=True,
    )


@router.delete("/auditors/assignments/{assignment_id}", status_code=204)
async def unassign_auditor(
    assignment_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    a = (await db.execute(select(AuditorAssignment).where(AuditorAssignment.id == assignment_id, AuditorAssignment.tenant_id == tenant_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Assignment not found")
    # Deactivate rather than delete. "Who was given access to which assessment,
    # and when was it taken away" is exactly what an auditor asks for, and the
    # row was being erased. AuditorAssignment.is_active already exists for this
    # and EVERY reader filters on is_active == True (auditor_portal.py,
    # audits.py, audit_comments.py, list_assignments above), so access is
    # withdrawn identically — the column simply had no writer, and all 4 live
    # rows are is_active = 1. The response (204) is unchanged.
    a.is_active = False
    await db.commit()


@router.delete("/auditors/{auditor_id}", status_code=204)
async def delete_auditor(
    auditor_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.TENANT_ADMIN))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    auditor = (await db.execute(
        select(User).where(User.id == auditor_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not auditor:
        raise HTTPException(404, "Auditor not found")
    if auditor.role != UserRole.AUDITOR:
        raise HTTPException(403, "Can only delete auditor accounts via this endpoint")
    # These assignments are deleted rather than deactivated (unlike
    # unassign_auditor above) because the auditor row itself is going: leaving
    # rows that reference a deleted user would dangle, and would be refused
    # outright by the foreign key once this moves off SQLite.
    assignments = (await db.execute(select(AuditorAssignment).where(AuditorAssignment.auditor_id == auditor_id))).scalars().all()
    for a in assignments:
        await db.delete(a)
    await db.delete(auditor)
    await db.commit()
