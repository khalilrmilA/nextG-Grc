"""Authentication endpoints — login, register, refresh, logout."""
import hashlib
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr, Field
from typing import Annotated, Any

from app.core.database import get_db, AsyncSessionLocal
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    create_mfa_challenge_token,
    create_refresh_token,
    decode_token,
    hash_password_async,
    revoke_jti,
    verify_password,
    verify_password_async,
)
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.login_event import LoginEvent
from app.models.mfa_device import MfaDevice
from app.models.subscription import Subscription, SubscriptionTier, SubscriptionStatus
from app.models.password_reset import PasswordResetToken
from app.core.config import settings
from app.core.password_policy import validate_password, PasswordPolicyError
from app.api.v1.dependencies import get_current_user, require_roles
from datetime import datetime, timedelta, timezone
import secrets

router = APIRouter()
logger = logging.getLogger(__name__)

# Brute-force lockout: after this many consecutive failures, lock for the window.
# These are the platform-wide defaults — a tenant can override both via
# PATCH /tenants/current/security (stored under Tenant.settings["security"]) to meet
# "paramétrable" lockout requirements. See resolve_security_settings() below, which
# mirrors the Tenant.settings["ldap"] overlay pattern in directory_auth.resolve_ldap_config().
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

_SECURITY_DEFAULTS = {
    "max_failed_logins": MAX_FAILED_LOGINS,
    "lockout_minutes": LOCKOUT_MINUTES,
}


def resolve_security_settings(tenant_settings: dict | None) -> dict:
    """Overlay a tenant's ``settings['security']`` block on top of the hardcoded
    lockout defaults. Same shape/pattern as directory_auth.resolve_ldap_config()."""
    cfg = dict(_SECURITY_DEFAULTS)
    if tenant_settings:
        override = tenant_settings.get("security") if isinstance(tenant_settings, dict) else None
        if isinstance(override, dict):
            for key in _SECURITY_DEFAULTS:
                value = override.get(key)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 1:
                    cfg[key] = int(value)
    return cfg


def _utcnow() -> datetime:
    """Naive UTC now, matching the DateTime columns used across the models."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _token_claims(user: User) -> dict:
    """The identity claims every access/refresh token this file mints carries.

    ``email`` is here for the audit trail: ActivityLogMiddleware prefers a
    payload ``email`` claim and otherwise resolves the actor with one indexed
    SELECT per logged request — every mutation and every whitelisted read. It
    cannot go stale: no endpoint in this application changes a user's email
    address, and a token lives minutes, not months. It is not an authorization
    input; get_current_user still reads the account from the database.
    """
    return {
        "sub": user.id,
        "tenant_id": user.tenant_id,
        "role": user.role,
        "email": user.email,
    }


def _enforce_password_policy(password: str) -> None:
    """Validate against the shared policy, surfacing failures as HTTP 422."""
    try:
        validate_password(password)
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


def _hash_email_for_log(email: str) -> str:
    """Hash an email so logs are debuggable without storing PII in plaintext."""
    return hashlib.sha256(email.lower().encode()).hexdigest()[:12]


def _client_ip(request: Request) -> str | None:
    """Real client IP, honoring X-Forwarded-For (prod sits behind the marketing proxy)."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:50]
    return request.client.host if request.client else None


async def _journal_login(request: Request, email: str, success: bool, reason: str, user: User | None = None) -> None:
    """Persist an authentication attempt (best-effort, isolated session — never breaks login)."""
    try:
        async with AsyncSessionLocal() as jdb:
            jdb.add(LoginEvent(
                tenant_id=getattr(user, "tenant_id", None),
                user_id=getattr(user, "id", None),
                email=email,
                success=success,
                reason=reason,
                ip_address=_client_ip(request),
                user_agent=(request.headers.get("user-agent") or "")[:500],
            ))
            await jdb.commit()
    except Exception:  # noqa: BLE001 — journaling must never affect the login result
        logger.warning("login journal write failed")


# Non-browser clients, matched before the browser families so an API caller is
# never labelled "Browser". "Terminaux utilisés" is only meaningful if a script
# and a person are distinguishable in the session list.
_NON_BROWSER_AGENTS = (
    ("curl/", "curl"), ("Wget/", "Wget"), ("python-requests", "Python requests"),
    ("python-httpx", "Python httpx"), ("httpie", "HTTPie"), ("PostmanRuntime", "Postman"),
    ("insomnia", "Insomnia"), ("okhttp", "OkHttp"), ("Java/", "Java client"),
    ("Go-http-client", "Go client"), ("axios/", "axios"), ("node-fetch", "Node fetch"),
    ("PowerShell", "PowerShell"), ("libwww-perl", "Perl LWP"),
)


def _device_label(ua: str | None) -> str:
    """Human-readable device label from a User-Agent string (best effort)."""
    ua = ua or ""
    if not ua.strip():
        return "Unknown client"
    for token, name in _NON_BROWSER_AGENTS:
        if token.lower() in ua.lower():
            return name
    browser = "Edge" if "Edg" in ua else next((b for b in ("Chrome", "Firefox", "Safari", "Opera") if b in ua), "Browser")
    for token, name in (
        ("Windows", "Windows"), ("Macintosh", "macOS"), ("Mac OS", "macOS"),
        ("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iPadOS"), ("Linux", "Linux"),
    ):
        if token in ua:
            return f"{browser} on {name}"
    return browser


async def _create_session(request: Request, user: User, db: AsyncSession):
    """Create a UserSession row for a successful login (drives 'Active Sessions')."""
    from app.models.user_session import UserSession
    ua = request.headers.get("user-agent") or ""
    sess = UserSession(
        user_id=user.id,
        tenant_id=user.tenant_id,
        device=_device_label(ua),
        user_agent=ua[:500],
        ip_address=_client_ip(request),
        last_seen=_utcnow(),
    )
    db.add(sess)
    await db.commit()
    await db.refresh(sess)
    return sess


# Slugs that are publicly visible (Trust Center) and shouldn't be squatted on
# self-service registration. Extend as needed; full impersonation prevention
# requires email-domain verification, which lives in a future fix.
_RESERVED_SLUGS = {
    "admin", "api", "auth", "auditor", "dashboard", "demo", "platform",
    "superadmin", "super-admin", "support", "system", "trust", "trust-center",
    "www", "billing", "console",
    # Brand / impersonation-prone names
    "anthropic", "google", "microsoft", "amazon", "apple", "openai", "meta",
    "facebook", "github", "gitlab", "stripe", "salesforce", "okta", "auth0",
    "cloudflare", "ibm", "oracle", "deloitte", "kpmg", "pwc", "ey",
}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=12, max_length=200)
    first_name: str
    last_name: str
    organization_name: str
    organization_slug: str
    country: str | None = None
    industry: str | None = None
    org_size: str | None = None                          # "1-50","51-200","201-1000","1000+"
    primary_framework_id: str | None = None
    selected_framework_ids: list[str] = []


class UserProfileResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    roles: list[str] = []   # all assigned roles (multi-role support)
    tenant_id: str
    tenant_name: str
    primary_framework_id: str | None = None
    selected_framework_ids: list[Any] = []
    org_size: str | None = None
    primary_assessment_id: str | None = None  # auto-created assessment on registration
    accessible_modules: list[str] = []  # modules available based on subscription tier


class TokenResponse(BaseModel):
    access_token: str = ""
    refresh_token: str = ""
    token_type: str = "bearer"
    must_change_password: bool = False
    mfa_required: bool = False
    mfa_challenge_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class MfaLoginRequest(BaseModel):
    challenge_token: str
    code: str


_GENERIC_LOGIN_FAILURE = "Invalid email or password"

# Every module in the application — the Elite Pack (god mode) gets all of them, including
# the new Elite modules that the per-tier lists below don't enumerate.
ALL_MODULES = [
    "dashboard", "risks", "risk-scenarios", "risk-quantification", "compliance", "frameworks",
    "incidents", "vulnerabilities", "cve", "threats", "applied-controls", "security-exceptions",
    "audits", "policies", "policy-generator", "vendors", "reports", "report-schedules",
    "regulatory", "trust-center", "activity-log", "webhooks", "assets", "governance", "archiving",
    "dashboards", "control-evaluations", "asset-graph", "risk-treatment", "vuln-import",
    "scenario-versions", "ocr", "mfa-setup", "settings", "help",
]

# Module access mapping by subscription tier/status
TIER_MODULES = {
    "trialing": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "incidents", "vulnerabilities", "threats", "risk-scenarios", "risk-quantification", "applied-controls", "security-exceptions", "trust-center", "regulatory", "activity-log", "webhooks", "reports", "policy-generator"],
    "starter": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies"],
    "professional": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "incidents", "vulnerabilities", "threats", "risk-scenarios", "risk-quantification", "applied-controls", "security-exceptions", "trust-center", "regulatory", "activity-log", "webhooks", "reports", "policy-generator"],
    "enterprise": ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors", "incidents", "vulnerabilities", "threats", "risk-scenarios", "risk-quantification", "applied-controls", "security-exceptions", "trust-center", "regulatory", "activity-log", "webhooks", "reports", "policy-generator"],
    "elite": ALL_MODULES,
}

async def get_accessible_modules(tenant_id: str, db: AsyncSession) -> list[str]:
    """Get accessible modules based on subscription tier and status."""
    from app.models.subscription import Subscription
    sub_result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    subscription = sub_result.scalar_one_or_none()
    if not subscription:
        return TIER_MODULES.get("starter", [])
    # Elite Pack = god mode: every module, regardless of trial/active status.
    if subscription.tier.value == "elite":
        return ALL_MODULES
    # During trial, give full professional access
    if subscription.status.value == "trialing":
        return TIER_MODULES.get("trialing", [])
    return TIER_MODULES.get(subscription.tier.value, [])


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    normalized_email = body.email.strip().lower()
    email_hash = _hash_email_for_log(normalized_email)
    try:
        result = await db.execute(select(User).where(User.email == normalized_email))
        user = result.scalar_one_or_none()

        # Account lockout: if the account is currently locked, reject early with 423.
        if user and user.locked_until and user.locked_until > _utcnow():
            logger.info("login.fail email_hash=%s reason=locked", email_hash)
            await _journal_login(request, normalized_email, False, "locked", user)
            raise HTTPException(
                status.HTTP_423_LOCKED,
                "Account temporarily locked due to failed login attempts. Try again later.",
            )

        # Constant-ish handling: any user-existence / password / activation failure
        # returns the same generic 401 to prevent enumeration. We still differentiate
        # internally for logging and metrics.
        if not user or not user.hashed_password:
            logger.info("login.fail email_hash=%s reason=no_user", email_hash)
            await _journal_login(request, normalized_email, False, "no_user")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _GENERIC_LOGIN_FAILURE)
        if not await verify_password_async(body.password, user.hashed_password):
            # Count the failure and lock the account once the threshold is crossed.
            # Threshold/window are tenant-configurable (falls back to the platform
            # defaults when the tenant hasn't overridden them).
            tenant_row = await db.execute(select(Tenant.settings).where(Tenant.id == user.tenant_id))
            security_cfg = resolve_security_settings(tenant_row.scalar_one_or_none())
            user.failed_login_count = (user.failed_login_count or 0) + 1
            if user.failed_login_count >= security_cfg["max_failed_logins"]:
                user.locked_until = _utcnow() + timedelta(minutes=security_cfg["lockout_minutes"])
                user.failed_login_count = 0
                logger.info("login.lock email_hash=%s", email_hash)
            await db.commit()
            logger.info("login.fail email_hash=%s reason=bad_password", email_hash)
            await _journal_login(request, normalized_email, False, "bad_password", user)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _GENERIC_LOGIN_FAILURE)
        if not user.is_active:
            logger.info("login.fail email_hash=%s reason=disabled", email_hash)
            await _journal_login(request, normalized_email, False, "disabled", user)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _GENERIC_LOGIN_FAILURE)

        # Time-limited accounts (external auditors, consultants) end here, not
        # three screens later. get_current_user has always refused an expired
        # account with a 403, but login itself did not look at expires_at: the
        # sign-in succeeded, the journal recorded "ok", the SPA loaded, and then
        # every single request 403'd. Two live accounts are in exactly that state.
        # Not the generic failure string — the password has already been verified
        # at this point, so naming the reason discloses nothing an attacker does
        # not already have, and it is the same sentence get_current_user returns.
        if user.expires_at is not None and user.expires_at < _utcnow():
            logger.info("login.fail email_hash=%s reason=expired", email_hash)
            await _journal_login(request, normalized_email, False, "expired", user)
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Account has expired. Contact your administrator.",
            )

        # Success — clear any failure/lock state.
        if user.failed_login_count or user.locked_until:
            user.failed_login_count = 0
            user.locked_until = None
            await db.commit()

        # MFA challenge: password verified, but an enrolled+confirmed device means
        # login isn't complete yet. Issue a short-lived challenge token instead of
        # real tokens — the client exchanges it at POST /auth/mfa-login. Nothing is
        # journaled as a completed login yet (mfa-login journals it on success).
        mfa_device = (await db.execute(
            select(MfaDevice).where(MfaDevice.user_id == user.id, MfaDevice.confirmed == True)  # noqa: E712
        )).scalar_one_or_none()
        if mfa_device is not None:
            logger.info("login.mfa_required email_hash=%s", email_hash)
            return TokenResponse(
                mfa_required=True,
                mfa_challenge_token=create_mfa_challenge_token({"sub": user.id}),
            )

        token_data = _token_claims(user)
        try:
            session = await _create_session(request, user, db)
            token_data["sid"] = session.id
        except Exception:  # noqa: BLE001 — a session-tracking hiccup must not block login
            logger.warning("session create failed")

        # New-device login alert — must run BEFORE this login is journaled below, so
        # the history lookup doesn't match against the very event it's checking.
        # Isolated session + broad except, matching _journal_login's resilience pattern.
        try:
            ua_raw = request.headers.get("user-agent") or ""
            async with AsyncSessionLocal() as ndb:
                from app.services.notification_generator import check_new_device_login
                await check_new_device_login(ndb, user, _client_ip(request), ua_raw, _device_label(ua_raw))
                await ndb.commit()
        except Exception:  # noqa: BLE001 — must never block login
            logger.warning("new-device login check failed")

        logger.info("login.ok email_hash=%s", email_hash)
        await _journal_login(request, normalized_email, True, "ok", user)
        return TokenResponse(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
            must_change_password=bool(user.must_change_password),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("login.error email_hash=%s", email_hash)
        # Generic 500 — never leak exception details to the client.
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Internal server error",
        )


_INVALID_MFA_CHALLENGE = "Invalid or expired MFA challenge — please log in again"


@router.post("/mfa-login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def mfa_login(request: Request, body: MfaLoginRequest, db: AsyncSession = Depends(get_db)):
    """Second step of login for MFA-enrolled accounts: redeem the challenge
    token from POST /login plus a TOTP code for real access/refresh tokens."""
    try:
        payload = await decode_token(body.challenge_token)
    except HTTPException:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_MFA_CHALLENGE)
    if payload.get("type") != "mfa_challenge":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_MFA_CHALLENGE)

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_MFA_CHALLENGE)

    # The challenge token outlives a lockout triggered while it was being used
    # (see the bad-code branch below), and it survives an account expiring
    # between the two steps. Both are re-checked here, or this endpoint would be
    # a five-minute window around the controls /login enforces.
    if user.locked_until and user.locked_until > _utcnow():
        raise HTTPException(
            status.HTTP_423_LOCKED,
            "Account temporarily locked due to failed login attempts. Try again later.",
        )
    if user.expires_at is not None and user.expires_at < _utcnow():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Account has expired. Contact your administrator.",
        )

    email_hash = _hash_email_for_log(user.email)
    device = (await db.execute(
        select(MfaDevice).where(MfaDevice.user_id == user.id, MfaDevice.confirmed == True)  # noqa: E712
    )).scalar_one_or_none()
    if device is None:
        # MFA was disabled between /login and /mfa-login — treat as invalid, not a crash.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _INVALID_MFA_CHALLENGE)

    try:
        import pyotp
    except ModuleNotFoundError:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "MFA support is not installed on this server.")
    if not pyotp.totp.TOTP(device.secret).verify(body.code.strip(), valid_window=1):
        logger.info("login.mfa_fail email_hash=%s", email_hash)
        # A wrong second factor is a failed authentication attempt and belongs in
        # the login journal like any other. Without this, LoginEvent recorded
        # nothing at all for second-factor brute force: the password step had
        # already succeeded, so the only trace was an application log line.
        await _journal_login(request, user.email, False, "mfa_bad_code", user)
        # ...and it counts toward the SAME tenant-configurable lockout the
        # password step uses. The challenge token is only single-use on success
        # (revoke_jti below), so without this an attacker holding the password
        # could keep re-submitting codes for the five minutes it lives, and then
        # simply ask for another one — 6 digits with valid_window=1 is three
        # acceptable codes at any instant, which is guessable given enough
        # attempts. login() re-checks locked_until before it clears the counter,
        # so a lockout raised here cannot be reset by logging in again.
        tenant_row = await db.execute(select(Tenant.settings).where(Tenant.id == user.tenant_id))
        security_cfg = resolve_security_settings(tenant_row.scalar_one_or_none())
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= security_cfg["max_failed_logins"]:
            user.locked_until = _utcnow() + timedelta(minutes=security_cfg["lockout_minutes"])
            user.failed_login_count = 0
            logger.info("login.lock email_hash=%s reason=mfa", email_hash)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid MFA code")
    device.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    # A completed login clears the counter the bad-code branch above increments,
    # mirroring login()'s own "Success — clear any failure/lock state" step.
    if user.failed_login_count:
        user.failed_login_count = 0
    await revoke_jti(payload.get("jti"))  # single-use: this challenge can't be redeemed twice

    token_data = _token_claims(user)
    try:
        session = await _create_session(request, user, db)
        token_data["sid"] = session.id
    except Exception:  # noqa: BLE001 — a session-tracking hiccup must not block login
        logger.warning("session create failed")

    # New-device login alert — same placement/reasoning as the password-only path
    # in login(): must run before this login is journaled.
    try:
        ua_raw = request.headers.get("user-agent") or ""
        async with AsyncSessionLocal() as ndb:
            from app.services.notification_generator import check_new_device_login
            await check_new_device_login(ndb, user, _client_ip(request), ua_raw, _device_label(ua_raw))
            await ndb.commit()
    except Exception:  # noqa: BLE001 — must never block login
        logger.warning("new-device login check failed")

    await db.commit()
    logger.info("login.mfa_ok email_hash=%s", email_hash)
    await _journal_login(request, user.email, True, "ok", user)
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        must_change_password=bool(user.must_change_password),
    )


class SessionOut(BaseModel):
    id: str
    device: str | None = None
    ip_address: str | None = None
    last_seen: datetime | None = None
    created_at: datetime
    current: bool = False
    model_config = {"from_attributes": True}


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """List the current user's active (non-revoked) sessions, newest first."""
    from app.models.user_session import UserSession
    cur_sid = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            cur_sid = (await decode_token(auth[7:])).get("sid")
        except Exception:  # noqa: BLE001
            cur_sid = None
    rows = (await db.execute(
        select(UserSession)
        .where(UserSession.user_id == current_user.id, UserSession.revoked_at.is_(None))
        .order_by(UserSession.last_seen.desc().nullslast(), UserSession.created_at.desc())
    )).scalars().all()
    return [
        SessionOut(id=s.id, device=s.device, ip_address=s.ip_address,
                   last_seen=s.last_seen, created_at=s.created_at, current=(s.id == cur_sid))
        for s in rows
    ]


@router.delete("/sessions/{sid}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    sid: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Revoke one of the current user's sessions — its tokens stop working."""
    from app.models.user_session import UserSession
    s = (await db.execute(
        select(UserSession).where(UserSession.id == sid, UserSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if s.revoked_at is None:
        s.revoked_at = _utcnow()
        await db.commit()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Normalize email to lowercase before storing — login form always sends lowercase
    body.email = body.email.strip().lower()
    # Enforce the shared password policy (complexity + length).
    _enforce_password_policy(body.password)
    # Check email uniqueness — generic 400 to avoid enumeration via this endpoint.
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Registration could not be completed")

    # Reserved-slug guard: block obvious squatting (brand names, system slugs).
    # Domain-verification is the proper long-term fix.
    if body.organization_slug.strip().lower() in _RESERVED_SLUGS:
        raise HTTPException(status_code=400, detail="That organization slug is reserved")

    # Check slug uniqueness (slugs are public-facing identifiers, OK to be specific)
    existing_tenant = await db.execute(
        select(Tenant).where(Tenant.slug == body.organization_slug)
    )
    if existing_tenant.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Organization slug already taken")

    # Create tenant
    tenant = Tenant(
        name=body.organization_name,
        slug=body.organization_slug,
        country=body.country,
        industry=body.industry,
        org_size=body.org_size,
        primary_framework_id=body.primary_framework_id,
        selected_framework_ids=body.selected_framework_ids or [],
    )
    db.add(tenant)
    await db.flush()  # Get tenant.id

    # Create subscription (14-day trial with full access)
    from datetime import datetime, timedelta, timezone
    trial_end = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    subscription = Subscription(
        tenant_id=tenant.id,
        tier=SubscriptionTier.PROFESSIONAL,
        status=SubscriptionStatus.TRIALING,
        trial_ends_at=trial_end,
    )
    db.add(subscription)

    # Create admin user
    user = User(
        tenant_id=tenant.id,
        email=body.email,
        hashed_password=await hash_password_async(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
        role=UserRole.CISO,
        is_verified=False,
        password_changed_at=_utcnow(),
    )
    db.add(user)
    await db.flush()

    # Auto-create a draft assessment for every selected framework
    all_fw_ids = list({body.primary_framework_id, *(body.selected_framework_ids or [])} - {None})
    if all_fw_ids:
        from app.models.compliance import ComplianceAssessment, AssessmentStatus, ControlAssessment, ControlStatus
        from app.models.framework import FrameworkControl, Framework
        fw_result = await db.execute(
            select(Framework).where(Framework.id.in_(all_fw_ids))
        )
        frameworks = fw_result.scalars().all()
        for fw in frameworks:
            assessment = ComplianceAssessment(
                tenant_id=tenant.id,
                framework_id=fw.id,
                name=f"{fw.short_name} Compliance Assessment",
                status=AssessmentStatus.DRAFT,
                in_scope_assets=[],
            )
            db.add(assessment)
            await db.flush()

            # Create ControlAssessment rows for every control in the framework
            ctrl_result = await db.execute(
                select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
            )
            controls = ctrl_result.scalars().all()
            for ctrl in controls:
                db.add(ControlAssessment(
                    assessment_id=assessment.id,
                    control_id=ctrl.id,
                    status=ControlStatus.NOT_STARTED,
                ))

    await db.commit()
    token_data = _token_claims(user)
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.get("/me", response_model=UserProfileResponse)
async def get_profile(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the current user's profile including tenant framework settings."""
    # Viewers always read from the demo tenant.
    effective_tenant_id = current_user.tenant_id
    if current_user.role == UserRole.VIEWER:
        from app.api.v1.dependencies.auth import _get_demo_tenant_id
        demo_id = await _get_demo_tenant_id(db)
        if demo_id:
            effective_tenant_id = demo_id

    tenant_result = await db.execute(select(Tenant).where(Tenant.id == effective_tenant_id))
    tenant = tenant_result.scalar_one_or_none()

    # Find the primary assessment (most recent for the primary framework)
    primary_assessment_id = None
    if tenant and tenant.primary_framework_id:
        from app.models.compliance import ComplianceAssessment
        from sqlalchemy import desc
        a_result = await db.execute(
            select(ComplianceAssessment)
            .where(
                ComplianceAssessment.tenant_id == effective_tenant_id,
                ComplianceAssessment.framework_id == tenant.primary_framework_id,
            )
            .order_by(desc(ComplianceAssessment.created_at))
            .limit(1)
        )
        assessment = a_result.scalar_one_or_none()
        if assessment:
            primary_assessment_id = assessment.id

    accessible_modules = await get_accessible_modules(effective_tenant_id, db)

    from app.services.authz import get_effective_roles
    effective_roles = sorted(await get_effective_roles(current_user, db))

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role,
        roles=effective_roles,
        tenant_id=effective_tenant_id,
        tenant_name=tenant.name if tenant else "",
        primary_framework_id=tenant.primary_framework_id if tenant else None,
        selected_framework_ids=tenant.selected_framework_ids if tenant else [],
        org_size=tenant.org_size if tenant else None,
        primary_assessment_id=primary_assessment_id,
        accessible_modules=accessible_modules,
    )


# Despite the "/me" in their paths, both routes below rewrite TENANT-WIDE state
# (Tenant.primary_framework_id / selected_framework_ids) for everyone in the
# organisation. The identical mutation through PATCH /tenants/current has always
# required CISO, while these were open to any authenticated user — an auditor or
# a vendor manager could silently re-scope the whole compliance programme. Gated
# to the roles the UI already exposes framework management to (the frontend's own
# ROUTE_ROLES["/framework"]); require_roles auto-passes tenant_admin/super_admin,
# and viewer/executive are write-blocked upstream in get_current_user.
_FRAMEWORK_ADMIN_ROLES = (
    UserRole.CISO,
    UserRole.COMPLIANCE_MANAGER,
    UserRole.POLICY_MANAGER,
)


class UpdateFrameworkRequest(BaseModel):
    primary_framework_id: str


class UpdateSelectedFrameworksRequest(BaseModel):
    primary_framework_id: str
    selected_framework_ids: list[str] = []


@router.patch("/me/framework", response_model=UserProfileResponse)
async def update_primary_framework(
    body: UpdateFrameworkRequest,
    current_user: Annotated[User, Depends(require_roles(*_FRAMEWORK_ADMIN_ROLES))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the workspace primary framework for the current tenant."""
    from app.models.framework import Framework
    # Verify the framework exists AND is visible to this tenant. The same rule
    # frameworks.py applies everywhere: built-ins are shared, a custom framework
    # belongs to one tenant. Checking existence alone let a tenant pin another
    # organisation's private framework as its own primary.
    fw_result = await db.execute(select(Framework).where(
        Framework.id == body.primary_framework_id,
        (Framework.is_builtin == True) | (Framework.tenant_id == current_user.tenant_id),  # noqa: E712
    ))
    fw = fw_result.scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")

    # Update tenant
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    tenant.primary_framework_id = body.primary_framework_id
    # Add to selected_framework_ids if not already there
    existing = list(tenant.selected_framework_ids or [])
    if body.primary_framework_id not in existing:
        existing.append(body.primary_framework_id)
        tenant.selected_framework_ids = existing

    await db.commit()
    await db.refresh(tenant)

    # Find primary assessment
    from app.models.compliance import ComplianceAssessment
    from sqlalchemy import desc
    a_result = await db.execute(
        select(ComplianceAssessment)
        .where(
            ComplianceAssessment.tenant_id == current_user.tenant_id,
            ComplianceAssessment.framework_id == body.primary_framework_id,
        )
        .order_by(desc(ComplianceAssessment.created_at))
        .limit(1)
    )
    assessment = a_result.scalar_one_or_none()

    accessible_modules = await get_accessible_modules(current_user.tenant_id, db)
    # `roles` was left at its [] default here, so this response contradicted
    # GET /auth/me for the same account — the SPA re-reads the profile from
    # whichever call it made last. Same computation as /auth/me.
    from app.services.authz import get_effective_roles
    effective_roles = sorted(await get_effective_roles(current_user, db))

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role,
        roles=effective_roles,
        tenant_id=current_user.tenant_id,
        tenant_name=tenant.name,
        primary_framework_id=tenant.primary_framework_id,
        selected_framework_ids=tenant.selected_framework_ids or [],
        org_size=tenant.org_size,
        primary_assessment_id=assessment.id if assessment else None,
        accessible_modules=accessible_modules,
    )


@router.patch("/me/frameworks", response_model=UserProfileResponse)
async def update_selected_frameworks(
    body: UpdateSelectedFrameworksRequest,
    current_user: Annotated[User, Depends(require_roles(*_FRAMEWORK_ADMIN_ROLES))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the primary framework and full list of selected frameworks."""
    # This route wrote the submitted ids straight through with no validation at
    # all — unknown ids, and other tenants' private frameworks, both landed in
    # the tenant's scope. Same visibility rule as /me/framework above.
    from app.models.framework import Framework
    requested = [
        fid for fid in ([body.primary_framework_id] + list(body.selected_framework_ids)) if fid
    ]
    if requested:
        visible = set((await db.execute(select(Framework.id).where(
            Framework.id.in_(requested),
            (Framework.is_builtin == True) | (Framework.tenant_id == current_user.tenant_id),  # noqa: E712
        ))).scalars().all())
        unknown = [fid for fid in dict.fromkeys(requested) if fid not in visible]
        if unknown:
            raise HTTPException(status_code=404, detail=f"Framework not found: {unknown[0]}")

    tenant_result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Ensure primary is always in selected list
    selected = list(body.selected_framework_ids)
    if body.primary_framework_id and body.primary_framework_id not in selected:
        selected.insert(0, body.primary_framework_id)

    tenant.primary_framework_id = body.primary_framework_id or None
    tenant.selected_framework_ids = selected
    await db.commit()
    await db.refresh(tenant)

    from app.models.compliance import ComplianceAssessment
    from sqlalchemy import desc
    primary_assessment_id = None
    if tenant.primary_framework_id:
        a_result = await db.execute(
            select(ComplianceAssessment)
            .where(
                ComplianceAssessment.tenant_id == current_user.tenant_id,
                ComplianceAssessment.framework_id == tenant.primary_framework_id,
            )
            .order_by(desc(ComplianceAssessment.created_at))
            .limit(1)
        )
        a = a_result.scalar_one_or_none()
        if a:
            primary_assessment_id = a.id

    accessible_modules = await get_accessible_modules(current_user.tenant_id, db)
    # `roles` was left at its [] default here, so this response contradicted
    # GET /auth/me for the same account — the SPA re-reads the profile from
    # whichever call it made last. Same computation as /auth/me.
    from app.services.authz import get_effective_roles
    effective_roles = sorted(await get_effective_roles(current_user, db))

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role,
        roles=effective_roles,
        tenant_id=current_user.tenant_id,
        tenant_name=tenant.name,
        primary_framework_id=tenant.primary_framework_id,
        selected_framework_ids=tenant.selected_framework_ids or [],
        org_size=tenant.org_size,
        primary_assessment_id=primary_assessment_id,
        accessible_modules=accessible_modules,
    )


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh_token(request: Request, body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = await decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=400, detail="Invalid refresh token")

    # Refresh-token rotation: revoke the old jti so it can't be reused.
    await revoke_jti(payload.get("jti"))

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # An expired account must not be able to mint fresh credentials either — the
    # refresh token lives 7 days and would otherwise outlive the expiry date by
    # most of a week. Same rule login() applies, same 401 shape this handler
    # already uses for a deactivated account.
    if user.expires_at is not None and user.expires_at < _utcnow():
        raise HTTPException(status_code=401, detail="Account has expired. Contact your administrator.")

    token_data = _token_claims(user)

    # Carry the session id through the rotation. It used to be dropped here, so
    # the first refresh (the SPA does one every 30 minutes) produced a token with
    # no `sid` and get_current_user's revocation check silently stopped applying
    # to it — "Revoke" in Active Sessions appeared to work and did nothing after
    # that. A token that never carried a sid refreshes exactly as before.
    sid = payload.get("sid")
    if sid:
        try:
            from app.models.user_session import UserSession
            sess = (await db.execute(
                select(UserSession).where(UserSession.id == sid)
            )).scalar_one_or_none()
            if sess is not None and sess.revoked_at is not None:
                # A revoked session must not be able to mint fresh credentials.
                raise HTTPException(status_code=401, detail="Session revoked. Please sign in again.")
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001 — same fail-open rule as get_current_user
            logger.warning("refresh: session check failed")
        token_data["sid"] = sid

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=12, max_length=200)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Allow the authenticated user to change their own password."""
    if not await verify_password_async(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    _enforce_password_policy(body.new_password)
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one()
    user.hashed_password = await hash_password_async(body.new_password)
    user.password_changed_at = _utcnow()
    user.must_change_password = False
    await db.commit()
    return None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


def _hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
async def forgot_password(request: Request, body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Email a single-use, expiring password-reset LINK.

    The account password is NOT changed here — only a token is issued. Always
    returns 204 to avoid email enumeration. (Replaces the previous flow, which
    overwrote the password on request and enabled account takeover.)
    """
    email = body.email.strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        # Silent — don't reveal whether the email exists.
        return None

    raw_token = secrets.token_urlsafe(32)
    reset = PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_reset_token(raw_token),
        expires_at=_utcnow() + timedelta(hours=1),
        requested_ip=(request.client.host if request.client else None),
    )
    db.add(reset)
    await db.commit()

    user_email = user.email
    base = (getattr(settings, "FRONTEND_BASE_URL", "") or "https://grceye.com/app").rstrip("/")
    reset_link = f"{base}/reset-password?token={raw_token}"

    # In the language the reset was requested in (the login page's language
    # switcher sends it as Accept-Language), else the user's remembered UI
    # language, else the tenant's, else English.
    from app.services.email_service import send_password_reset_email
    from app.services.user_language import header_language, recipient_language
    mail_lang = header_language(request) or await recipient_language(
        db, user.id, tenant_id=user.tenant_id)
    await send_password_reset_email(to_email=user_email, reset_link=reset_link, lang=mail_lang)
    logger.info("forgot-password: reset link emailed to %s", _hash_email_for_log(user_email))
    return None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=12, max_length=200)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour")
async def reset_password(request: Request, body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Complete a password reset using a valid, unexpired, unused token."""
    _enforce_password_policy(body.new_password)
    token_hash = _hash_reset_token(body.token)
    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    )
    token = result.scalar_one_or_none()
    if token is None or token.used_at is not None or token.expires_at < _utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user_result = await db.execute(select(User).where(User.id == token.user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.hashed_password = await hash_password_async(body.new_password)
    user.password_changed_at = _utcnow()
    user.must_change_password = False
    # Clear any lockout so the user can log straight in.
    user.failed_login_count = 0
    user.locked_until = None
    token.used_at = _utcnow()

    # This is the account-recovery path, so every session opened with the old
    # password has to stop working: otherwise whoever prompted the reset stays
    # signed in on their own device after the owner has recovered the account.
    # Safe to revoke all of them — the user is not signed in here, they are
    # about to log in fresh. get_current_user rejects a revoked session's tokens.
    from app.models.user_session import UserSession
    open_sessions = (await db.execute(select(UserSession).where(
        UserSession.user_id == user.id, UserSession.revoked_at.is_(None),
    ))).scalars().all()
    for sess in open_sessions:
        sess.revoked_at = _utcnow()

    await db.commit()
    logger.info(
        "reset-password: password changed via token; %d session(s) revoked", len(open_sessions),
    )
    return None


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Revoke the supplied refresh token AND close its session (best-effort)."""
    try:
        payload = await decode_token(body.refresh_token)
    except HTTPException:
        # Already invalid — nothing to revoke. Still return 204.
        return None
    await revoke_jti(payload.get("jti"))

    # Close the session the token belongs to. Revoking only the refresh jti left
    # the still-valid access token working until it expired, and left the row in
    # "Active Sessions" forever — on this database 186 of 187 session rows have
    # never been revoked, one account showing 111 "active" sessions. Marking the
    # session revoked is what makes get_current_user reject the access token too.
    sid, user_id = payload.get("sid"), payload.get("sub")
    if sid and user_id:
        try:
            from app.models.user_session import UserSession
            sess = (await db.execute(select(UserSession).where(
                UserSession.id == sid, UserSession.user_id == user_id,
            ))).scalar_one_or_none()
            if sess is not None and sess.revoked_at is None:
                sess.revoked_at = _utcnow()
                await db.commit()
        except Exception:  # noqa: BLE001 — logout must never fail on the caller
            logger.warning("logout: session close failed")
    return None
