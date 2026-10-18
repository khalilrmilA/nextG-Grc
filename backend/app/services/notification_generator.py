"""
Notification Generator Service — scans the database for events that need
CISO/admin attention and creates in-app notifications.

Handles:
- Risk review deadlines (next_review_date approaching or passed)
- Vendor contract expiry (30/60/90 day warnings)
- Compliance gaps and control issues
- Contract pending CISO review
- Action plan item deadlines within 10 days (collaboration)
- Compliance ActionItem deadlines within 7 days (remediation tasks from gap recommendations)
- Asset end-of-life warnings (within 90 days, mirrors GET /assets/lifecycle/eol-soon)
- Applied control expiration warnings (within 30 days)
- Risk treatment plan overdue (due_date passed, not yet complete)
- Risk treatment plan budget overrun (actual_cost > estimated_cost)
- Asset periodic review deadlines (14/7/0 day window + overdue, mirrors
  check_risk_review_deadlines)
- Risk scenario periodic review deadlines (14/7/0 day window + overdue, mirrors
  check_risk_review_deadlines; RFP gap fix — scenarios had no next_review_date /
  alerting of their own before)
- Audit finding (recommendation) deadlines within 7 days or overdue, for OPEN/
  IN_REMEDIATION findings (RFP gap fix — "pas de notification sur les
  échéances critiques des recommandations")

STB tender additions (objectifs 3, 4 and 7):
- check_action_item_overdue — the "relances automatiques". An overdue action is
  chased on an ESCALATION LADDER (J+1, J+3, J+7, J+14, J+30, then monthly) that
  widens the audience at each rung, instead of being announced once and
  forgotten. It never gives up: the old checks stopped at 30 days overdue,
  which is precisely when a corrective action needs chasing hardest.
- check_audit_schedule — J-30 / J-7 / J-0 before a planned audit starts, to the
  lead auditor, the assigned auditors and the tenant's stakeholders
  ("notification automatique des parties prenantes").
- check_finding_assigned — catches a finding that has a remediation owner who
  was never told (bulk import, an assignment made before audits.py notified on
  assignment, an owner swapped by a path that does not notify).
- check_recommendation_due — AuditRecommendation deadlines, chased to closure
  on the same ladder ("jusqu'à leur clôture effective").

run_all_checks is driven automatically by start_notification_scheduler() at the
bottom of this file — it needs one asyncio.create_task in app.main's lifespan,
because until now its only caller was the "Check deadlines" button.

Every notification written here carries title_key / message_key / params; the
notification feed (endpoints/notifications.py via services/notification_i18n)
renders them in the reader's Accept-Language, and the e-mail leg renders the
same catalog in the recipient's language (services/user_language). The stored
title/message stay English — the fallback, and what webhooks/other consumers see. Escalation notifications are
also delivered by e-mail over the configured SMTP relay ("la relance doit
atteindre le responsable hors application"), honouring each user's EMAIL
notification preference and capped per run so a backlog cannot become a blast.
"""
import asyncio
import contextlib
import json
import logging
import os
import tempfile
from pathlib import Path
from datetime import date, datetime, timedelta
from sqlalchemy import or_, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models.notification import (
    Notification, NotificationChannel, NotificationPreference,
    NotificationStatus, NotificationType,
)
from app.models.user import User, UserRole
from app.models.risk import Risk, RiskTreatment
from app.models.vendor import Vendor, VendorContract, ContractValidationStatus
from app.models.compliance import ComplianceGap, ComplianceAssessment, ControlAssessment, Evidence
from app.models.framework import FrameworkControl
from app.models.contract_collaboration import ContractCollaboration
from app.models.action_item import ActionItem, ActionItemStatus
from app.models.asset import Asset
from app.models.applied_control import AppliedControl
from app.models.login_event import LoginEvent
from app.models.risk_scenario import RiskScenario
from app.models.audit import Audit, AuditFinding, AuditStatus, FindingStatus
from app.models.tenant import Tenant
from app.models.policy import Policy, PolicyAttestation, PolicyStatus, AttestationStatus

logger = logging.getLogger(__name__)

# ── Kill switches ────────────────────────────────────────────────────────────
# The two flags below are the only brakes on a sweep that now runs by itself and
# sends real mail, so they have to work from the one place an operator can edit
# without touching PM2: backend/.env.local.
#
# They did not. Settings in app.core.config is a pydantic-settings model with
# extra="ignore", and pydantic-settings never exports anything to os.environ —
# so ENABLE_NOTIFICATION_EMAILS=0 written into .env.local was read by nobody and
# os.getenv() returned the "on" default anyway. Nothing in the codebase calls
# load_dotenv either. _env_flag closes that: process environment first (a PM2
# ecosystem variable still wins), then the same env-file chain config.py loads,
# in the same precedence — later file overrides earlier.
_ENV_DIR = Path(__file__).resolve().parents[2]          # backend/
_ENV_FILES = (".env", ".env.dev", ".env.local")         # mirrors config.py's order


def _env_flag(name: str, default: str = "1") -> str:
    """Read a kill switch from the process env, falling back to the .env files.

    Re-read on every call rather than cached: it means an operator can stop the
    sweep, or its outbound mail, by editing .env.local and waiting for the next
    tick — no pm2 restart, which on this box is the risky operation, not the
    safe one. The cost is three small file reads a few times a day.

    Parsing deliberately mirrors what pydantic-settings does to the same files,
    because an operator who writes a line that config.py would honour must not
    find that this reader silently ignored it: keys are matched case-insensitively
    (config.py sets case_sensitive=False), a leading ``export`` is dropped, and an
    unquoted trailing ``# comment`` is stripped. Getting any of those wrong turns
    the kill switch back into the decoration it used to be.
    """
    value = os.environ.get(name)
    if value is not None:
        return value.strip()
    found = default
    target = name.lower()
    for fname in _ENV_FILES:
        try:
            with open(_ENV_DIR / fname, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, raw = line.partition("=")
                    key = key.strip()
                    if key.startswith("export "):
                        key = key[len("export "):].strip()
                    if key.lower() != target:
                        continue
                    raw = raw.strip()
                    if raw[:1] in ('"', "'") and raw[:1] == raw[-1:] and len(raw) > 1:
                        found = raw[1:-1]          # quoted: a '#' inside is literal
                    else:
                        found = raw.split("#", 1)[0].strip()
        except OSError:
            continue        # absent or unreadable file = nothing declared here
    return found


# Roles that receive tenant-wide ("parties prenantes") notifications.
# TENANT_ADMIN is in the list because on the live database 5 of the 11 tenants
# have NO ciso / risk_manager / compliance_manager at all — every automatic
# notification for those tenants was being computed and then dropped on the
# floor for want of a recipient, which is most of why "notification automatique
# des parties prenantes" reads as absent. The admin is the stakeholder of last
# resort, exactly as this function's docstring always claimed.
STAKEHOLDER_ROLES = (
    UserRole.CISO,
    UserRole.RISK_MANAGER,
    UserRole.COMPLIANCE_MANAGER,
    UserRole.TENANT_ADMIN,
)

# Who an escalated relance is copied to once the owner has stopped responding.
# Kept separate from STAKEHOLDER_ROLES so the first rungs of the ladder stay
# quiet: escalation only means something if it is not the default.
ESCALATION_ROLES = (UserRole.CISO, UserRole.TENANT_ADMIN, UserRole.EXECUTIVE)


async def get_recipients_for_tenant(db: AsyncSession, tenant_id: str) -> list[User]:
    """Get users who should receive CISO-type notifications (CISO, admin roles).
    Roles are stored as uppercase enum names in the DB (e.g. 'CISO', 'RISK_MANAGER').
    """
    from sqlalchemy import String, cast
    if not tenant_id:
        return []
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            or_(
                cast(User.role, String).in_([r.name for r in STAKEHOLDER_ROLES]),
                User.role.in_(list(STAKEHOLDER_ROLES)),
            )
        )
    )
    return list(result.scalars().all())


async def get_users_with_roles(
    db: AsyncSession, tenant_id: str, roles: tuple[UserRole, ...]
) -> list[User]:
    """Active users of one tenant holding any of `roles`.

    Same dual uppercase-name / enum match as get_recipients_for_tenant: the
    column was written by two different code paths over the life of the
    database and holds both spellings.
    """
    from sqlalchemy import String, cast
    if not tenant_id:
        return []
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            or_(
                cast(User.role, String).in_([r.name for r in roles]),
                User.role.in_(list(roles)),
            )
        )
    )
    return list(result.scalars().all())


async def get_owner_in_tenant(
    db: AsyncSession, owner_id: str | None, tenant_id: str | None
) -> User | None:
    """Resolve an owner/assignee, refusing to cross a tenant boundary.

    Every owner lookup in this file used to be `User.id == owner_id` with no
    tenant predicate. create_notification derives the row's tenant_id from the
    *user*, so a stale or mistyped owner_id pointing at another tenant's user
    would have written that tenant a notification quoting this tenant's data —
    a silent cross-tenant leak. A well-formed row is unaffected by this check.
    """
    if not owner_id:
        return None
    conditions = [User.id == owner_id, User.is_active == True]  # noqa: E712
    if tenant_id:
        conditions.append(User.tenant_id == tenant_id)
    return (await db.execute(select(User).where(*conditions))).scalar_one_or_none()


def _scoped(stmt, column, tenant_id: str | None):
    """Narrow a sweep query to one tenant, or leave it platform-wide.

    ``run_all_checks(tenant_id=None)`` keeps the whole-platform sweep the
    scheduler needs. An HTTP caller passes its own tenant, so one tenant's
    « Check deadlines » click no longer walks the other ten — and no longer
    writes notifications, or sends mail, to their users.
    """
    return stmt.where(column == tenant_id) if tenant_id else stmt


async def notification_exists(
    db: AsyncSession,
    user_id: str,
    notif_type: NotificationType,
    entity_id: str,
    within_days: int = 7,
) -> bool:
    """Check if a similar notification already exists in the last N days (avoid spam)."""
    cutoff = datetime.utcnow() - timedelta(days=within_days)
    result = await db.execute(
        select(Notification).where(
            and_(
                Notification.user_id == user_id,
                Notification.type == notif_type,
                Notification.created_at >= cutoff,
            )
        )
    )
    existing = result.scalars().all()
    # Check if any existing notification references the same entity
    for notif in existing:
        if notif.data and notif.data.get("entity_id") == entity_id:
            return True
    return False


async def create_notification(
    db: AsyncSession,
    user: User,
    notif_type: NotificationType,
    title: str,
    message: str,
    entity_id: str | None = None,
    entity_type: str | None = None,
    link: str | None = None,
    severity: str = "info",
    *,
    title_key: str | None = None,
    message_key: str | None = None,
    params: dict | None = None,
    extra_data: dict | None = None,
    outbox: list | None = None,
    email: bool = False,
) -> Notification:
    """Create a single notification.

    The keyword-only arguments are additive so the dozen existing callers
    (risks.py, governance.py, threat_scheduler, contract_collab, ...) keep
    working unchanged:

    * title_key / message_key / params — the i18n triple the client renders
      with t(); `title` and `message` stay populated as the fallback and as the
      e-mail body. Same shape as audits.py's _notify.
    * extra_data — merged into `data` (e.g. the relance rung), so dedup can ask
      "has THIS escalation step already gone out" rather than only "has anything
      gone out about this entity".
    * outbox / email — queue the e-mail leg. Nothing is sent from here: the mail
      is appended to the caller's outbox and flushed by flush_email_outbox()
      AFTER the transaction commits, so we never mail about a row that then
      failed to persist, and never hold SQLite's write lock across an SMTP
      round-trip.
    """
    data = {}
    if entity_id:
        data["entity_id"] = entity_id
    if entity_type:
        data["entity_type"] = entity_type
    if link:
        data["link"] = link
    data["severity"] = severity
    if extra_data:
        data.update(extra_data)

    notif = Notification(
        tenant_id=user.tenant_id,
        user_id=user.id,
        type=notif_type,
        status=NotificationStatus.UNREAD,
        title=title,
        message=message,
        title_key=title_key,
        message_key=message_key,
        params=params,
        data=data,
    )
    db.add(notif)

    if email and outbox is not None and user.email:
        outbox.append({
            "user_id": user.id,
            "tenant_id": user.tenant_id,
            "to_email": user.email,
            "type": notif_type,
            "title": title,
            "message": message,
            "title_key": title_key,
            "message_key": message_key,
            "params": params or {},
            "link": link,
        })

    return notif


# ── i18n for the e-mail leg ──────────────────────────────────────────────────
# The FR/AR/EN wording of every notification key lives in
# app.services.notification_i18n.CATALOG — the same catalog the notification
# feed renders the bell from, so an e-mail and its in-app twin always read the
# same. A key that is absent (or whose params do not fit) falls back to the
# stored English title/message rather than failing to send — a relance that
# arrives in English still arrives.
from app.services.notification_i18n import render_key  # noqa: E402
from app.services.user_language import recipient_language  # noqa: E402
from app.services.user_language import tenant_language as _tenant_language_or_none  # noqa: E402


def render_i18n(key: str | None, lang: str, params: dict, fallback: str) -> str:
    """Render an i18n key in `lang`, falling back to the stored English text.

    English returns `fallback` itself: the stored English IS the English
    rendering (and keeps the writer's own truncation and wording).
    """
    if lang == "en":
        return fallback
    return render_key(key, lang, params or {}, fallback)


def tenant_language(tenant: Tenant | None) -> str:
    """The tenant's configured language (settings.locale / settings.notifications.language), else en."""
    return _tenant_language_or_none(tenant) or "en"


def tenant_emails_enabled(tenant: Tenant | None) -> bool:
    """Per-tenant kill switch: settings.notifications.email_enabled = false.

    This is a live production platform with a working relay; a tenant must be
    able to stop the outbound leg without stopping the in-app one."""
    raw = getattr(tenant, "settings", None) or {}
    notif_cfg = raw.get("notifications")
    if isinstance(notif_cfg, dict) and notif_cfg.get("email_enabled") is False:
        return False
    return True


async def user_wants_email(db: AsyncSession, user_id: str, notif_type: NotificationType) -> bool:
    """Honour the user's EMAIL preference for this type. Absent row = enabled,
    the same default the Celery notification workers use."""
    pref = (await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.notification_type == notif_type,
            NotificationPreference.channel == NotificationChannel.EMAIL,
        )
    )).scalar_one_or_none()
    return pref.enabled if pref is not None else True


# Hard ceiling on one run's outbound mail. A first run over a long-neglected
# backlog could otherwise mail hundreds of messages to real clients in one go.
# Note what the cap actually costs: the in-app notification — and with it the
# dedup marker — is already committed by the time we get here, so a message
# past the ceiling is DROPPED, not deferred; the next run will not re-queue it
# because that rung is already recorded as sent. The ceiling is therefore a
# deliberate "in-app only" degradation for the tail of a backlog, and it is
# logged as such rather than silently swallowed.
MAX_EMAILS_PER_RUN = 200


async def flush_email_outbox(db: AsyncSession, outbox: list[dict]) -> int:
    """Send the queued relance/escalation e-mails. Called AFTER the commit.

    Never raises: SMTP is best-effort and an unreachable relay must not lose the
    in-app notifications that are already durable by this point.
    """
    if not outbox:
        return 0
    if _env_flag("ENABLE_NOTIFICATION_EMAILS") == "0":
        logger.info("Notification e-mails disabled via ENABLE_NOTIFICATION_EMAILS=0 (%d queued)", len(outbox))
        return 0

    from app.services import email_service

    sent = 0
    tenant_cache: dict[str, Tenant | None] = {}
    for item in outbox[:MAX_EMAILS_PER_RUN]:
        try:
            tenant_id = item.get("tenant_id")
            if tenant_id not in tenant_cache:
                tenant_cache[tenant_id] = (await db.execute(
                    select(Tenant).where(Tenant.id == tenant_id)
                )).scalar_one_or_none() if tenant_id else None
            tenant = tenant_cache[tenant_id]
            if not tenant_emails_enabled(tenant):
                continue
            if not await user_wants_email(db, item["user_id"], item["type"]):
                continue

            # The recipient's own UI language first (user_locales, recorded from
            # the feed they poll), then the tenant's, then English.
            lang = await recipient_language(db, item["user_id"], tenant)
            subject = render_i18n(item.get("title_key"), lang, item.get("params") or {}, item["title"])
            body = render_i18n(item.get("message_key"), lang, item.get("params") or {}, item["message"])
            link = item.get("link")
            action_url = f"{app_settings.FRONTEND_URL}{link}" if link and link.startswith("/") else link

            # EMAIL_FROM stays whatever the environment sets (@next-step.tn in
            # production, required by the relay's SPF record) — send_email owns
            # the envelope; this service never overrides the sender.
            # lang is passed through: email_service localises the call-to-action
            # label from it. Without it a French or Arabic relance carried an
            # English "Open" button — the one user-facing string this service
            # does not render itself.
            ok = await email_service.send_notification_email(
                to_email=item["to_email"], subject=subject, body=body,
                action_url=action_url, lang=lang,
            )
            if ok:
                sent += 1
        except Exception as exc:  # noqa: BLE001 — a bad address must not stop the rest
            logger.warning("Notification e-mail failed for %s: %s", item.get("to_email"), exc)

    if len(outbox) > MAX_EMAILS_PER_RUN:
        logger.error(
            "Notification e-mail cap reached: %d queued, %d attempted, %d DROPPED "
            "(their in-app notifications are written, so they will not be re-queued)",
            len(outbox), MAX_EMAILS_PER_RUN, len(outbox) - MAX_EMAILS_PER_RUN,
        )
    return sent


# ── Relance ladder ───────────────────────────────────────────────────────────
# Rungs, in days overdue, at which an overdue item is chased again. The ladder
# starts at J+1, not J+0: the due date itself is already announced by the
# "due today" checks, and two notifications for one date is how alert fatigue
# starts. After the last fixed rung the cadence becomes monthly and never
# stops — an action that is 200 days late is the one that most needs a
# reminder, and the previous checks in this file went silent at 30 days.
RELANCE_RUNGS = (1, 3, 7, 14, 30)
RELANCE_MONTHLY_AFTER = 30
# From this rung on, the reminder is also copied to CISO / admin / direction.
RELANCE_ESCALATE_FROM = 7


def relance_rung(days_overdue: int) -> int | None:
    """The ladder rung a given lateness belongs to, or None if not yet overdue.

    Returns the largest rung <= days_overdue, so a check that runs daily fires
    once per rung rather than once per day, and a check that misses a few days
    (the app was down, the scheduler was off) still fires the rung it landed in
    rather than skipping it silently.
    """
    if days_overdue < RELANCE_RUNGS[0]:
        return None
    if days_overdue < RELANCE_MONTHLY_AFTER:
        return max(r for r in RELANCE_RUNGS if r <= days_overdue)
    # Monthly from then on: 30, 60, 90, ...
    return (days_overdue // 30) * 30


async def stage_already_sent(
    db: AsyncSession,
    user_id: str,
    notif_type: NotificationType,
    entity_id: str,
    stage: int | str,
    marker_key: str = "relance_rung",
) -> bool:
    """Has this exact stage already been sent to this user for this entity?

    Deliberately NOT a time window: the ladder is the dedup. A time window
    either re-sends the same rung (spam) or blocks the next one (the relance
    stops), which is exactly how the existing checks manage to be both noisy
    and silent. Bounded to a year so the scan stays cheap.
    """
    cutoff = datetime.utcnow() - timedelta(days=366)
    rows = (await db.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.type == notif_type,
            Notification.created_at >= cutoff,
        )
    )).scalars().all()
    for notif in rows:
        data = notif.data or {}
        if data.get("entity_id") == entity_id and data.get(marker_key) == stage:
            return True
    return False


async def table_exists(db: AsyncSession, table_name: str) -> bool:
    """Is this table physically present?

    The STB models are created by create_all() at the next restart, so a check
    that reads one of them must be able to no-op until then. Asking the
    inspector is portable (the platform targets SQLite in dev and PostgreSQL in
    production) and, unlike catching the error, leaves the session usable.
    """
    from sqlalchemy import inspect as sa_inspect
    try:
        return await db.run_sync(
            lambda sync_session: sa_inspect(sync_session.connection()).has_table(table_name)
        )
    except Exception as exc:  # noqa: BLE001 — an unusable inspector means "skip"
        logger.warning("table_exists(%s) failed: %s", table_name, exc)
        return False


async def notified_about(
    db: AsyncSession,
    user_id: str,
    entity_id: str,
    types: tuple[NotificationType, ...],
    within_days: int | None = 90,
) -> bool:
    """Has this user had ANY of `types` about this entity?

    Used by check_finding_assigned, which is a safety net for assignments the
    endpoint already notifies about (audits.py writes its own notification with
    type SYSTEM when an owner is set). Matching across types is what keeps the
    net from duplicating the endpoint's message.

    `within_days=None` means "ever". An assignment is a one-time event, so a
    windowed dedup makes the safety net re-announce — and re-mail — the same
    assignment to the same person every time the window lapses. Only checks
    whose event genuinely recurs should pass a window.
    """
    conditions = [
        Notification.user_id == user_id,
        Notification.type.in_(list(types)),
    ]
    if within_days is not None:
        conditions.append(Notification.created_at >= datetime.utcnow() - timedelta(days=within_days))
    rows = (await db.execute(select(Notification).where(*conditions))).scalars().all()
    return any((n.data or {}).get("entity_id") == entity_id for n in rows)


async def check_vendor_contract_expiry(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Check for vendor contracts expiring soon and create notifications."""
    created = 0
    today = datetime.utcnow().date()

    # Get all active vendors
    result = await db.execute(
        _scoped(select(Vendor).where(Vendor.contract_expiry.isnot(None)),
                Vendor.tenant_id, tenant_id)
    )
    vendors = result.scalars().all()

    for vendor in vendors:
        if not vendor.contract_expiry:
            continue
        try:
            expiry = datetime.fromisoformat(vendor.contract_expiry).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (expiry - today).days

        # Trigger at 90, 60, 30, 7 days, and if expired
        trigger_points = [90, 60, 30, 7, 0]
        if days_remaining not in trigger_points and days_remaining > 0:
            continue
        # A key per situation rather than one key with an interpolated
        # fragment: the client renders these with t(), and a half-translated
        # sentence is the classic i18n trap.
        if days_remaining < 0:
            # Already expired
            severity = "critical"
            key = "notifications.contract_expired"
            title = f"Contract EXPIRED: {vendor.name}"
            message = f"The contract with {vendor.name} expired {abs(days_remaining)} days ago. Immediate action required."
        elif days_remaining == 0:
            severity = "critical"
            key = "notifications.contract_expires_today"
            title = f"Contract expires TODAY: {vendor.name}"
            message = f"The contract with {vendor.name} expires today!"
        elif days_remaining <= 7:
            severity = "high"
            key = "notifications.contract_expiring"
            title = f"Contract expiring in {days_remaining} days: {vendor.name}"
            message = f"The contract with {vendor.name} will expire in {days_remaining} days. Renewal needed."
        elif days_remaining <= 30:
            severity = "medium"
            key = "notifications.contract_expiring"
            title = f"Contract expiring in {days_remaining} days: {vendor.name}"
            message = f"The contract with {vendor.name} expires in {days_remaining} days. Start renewal process."
        else:
            severity = "info"
            key = "notifications.contract_renewal_reminder"
            title = f"Contract renewal reminder: {vendor.name}"
            message = f"Contract with {vendor.name} expires in {days_remaining} days. Plan renewal activities."

        # Notify CISO and admins
        recipients = await get_recipients_for_tenant(db, vendor.tenant_id)
        for user in recipients:
            if not await notification_exists(db, user.id, NotificationType.VENDOR_ALERT, vendor.id, within_days=7):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.VENDOR_ALERT,
                    title=title,
                    message=message,
                    entity_id=vendor.id,
                    entity_type="vendor",
                    link=f"/vendors?highlight={vendor.id}",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params={"vendor": vendor.name, "days": abs(days_remaining),
                            "expiry": vendor.contract_expiry},
                )
                created += 1

    return created


async def check_risk_review_deadlines(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Check for risks needing review and create notifications."""
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        _scoped(select(Risk).where(Risk.next_review_date.isnot(None)),
                Risk.tenant_id, tenant_id)
    )
    risks = result.scalars().all()

    for risk in risks:
        if not risk.next_review_date:
            continue
        try:
            review_date = datetime.fromisoformat(risk.next_review_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (review_date - today).days

        # Trigger at 14, 7, 0 days, and if overdue
        if days_remaining > 14 or days_remaining < -30:
            continue

        if days_remaining < 0:
            severity = "critical"
            key = "notifications.risk_review_overdue"
            title = f"Risk review OVERDUE: {risk.title[:50]}"
            message = f"Risk '{risk.title}' review is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            key = "notifications.risk_review_today"
            title = f"Risk review due TODAY: {risk.title[:50]}"
            message = f"Risk '{risk.title}' needs to be reviewed today."
        elif days_remaining <= 7:
            severity = "medium"
            key = "notifications.risk_review_due"
            title = f"Risk review due in {days_remaining} days"
            message = f"Risk '{risk.title}' needs review within {days_remaining} days."
        else:
            severity = "info"
            key = "notifications.risk_review_upcoming"
            title = f"Upcoming risk review in {days_remaining} days"
            message = f"Risk '{risk.title}' scheduled for review in {days_remaining} days."

        recipients = await get_recipients_for_tenant(db, risk.tenant_id)
        for user in recipients:
            if not await notification_exists(db, user.id, NotificationType.RISK_OVERDUE, risk.id, within_days=3):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.RISK_OVERDUE,
                    title=title,
                    message=message,
                    entity_id=risk.id,
                    entity_type="risk",
                    link=f"/risks?highlight={risk.id}",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params={"risk": risk.title, "days": abs(days_remaining),
                            "due": risk.next_review_date},
                )
                created += 1

    return created


async def check_policy_reviews(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Policies whose next_review_date is within 30 days or past (R2: the review
    date was stored and shown but nothing ever reminded anyone of it).

    The owner and the tenant's stakeholders are told. Only a published policy
    is reviewed ("mark as reviewed" needs one), so drafts and retired texts get
    no reminder. Weekly at most per person and policy.

    Follow-up A-2: once a review is recorded the date moves forward and the
    reminders stop. With a short frequency the new date can already fall inside
    the 30-day window — a review made inside that window silences the "due
    soon" reminder; only an overdue date reminds again.
    """
    created = 0
    today = datetime.utcnow().date()
    policies = (await db.execute(_scoped(
        select(Policy).where(Policy.next_review_date.isnot(None), Policy.status == PolicyStatus.PUBLISHED),
        Policy.tenant_id, tenant_id))).scalars().all()
    for policy in policies:
        try:
            due = datetime.fromisoformat(policy.next_review_date[:10]).date()
        except (ValueError, TypeError):
            continue
        days = (due - today).days
        if days > 30:
            continue
        if days >= 0 and policy.last_reviewed_at:
            try:
                reviewed = datetime.fromisoformat(policy.last_reviewed_at[:10]).date()
            except (ValueError, TypeError):
                reviewed = None
            if reviewed and reviewed >= due - timedelta(days=30):
                continue
        if days < 0:
            severity, key = "high", "notifications.policy_review_overdue"
            title = f"Policy review OVERDUE: {policy.title[:50]}"
            message = f"Policy '{policy.title}' was due for review on {policy.next_review_date[:10]}."
        else:
            severity, key = ("medium" if days <= 7 else "info"), "notifications.policy_review_due"
            title = f"Policy review due in {days} days: {policy.title[:50]}"
            message = f"Policy '{policy.title}' is due for review on {policy.next_review_date[:10]}."
        recipients = {u.id: u for u in await get_recipients_for_tenant(db, policy.tenant_id)}
        owner = await get_owner_in_tenant(db, policy.owner_id, policy.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in recipients.values():
            if await notification_exists(db, user.id, NotificationType.POLICY_REVIEW_DUE, policy.id, within_days=7):
                continue
            await create_notification(
                db, user=user, notif_type=NotificationType.POLICY_REVIEW_DUE,
                title=title, message=message, entity_id=policy.id, entity_type="policy",
                link=f"/policies?highlight={policy.id}", severity=severity,
                title_key=f"{key}.title", message_key=f"{key}.message",
                params={"policy": policy.title, "days": abs(days), "due": policy.next_review_date[:10]},
            )
            created += 1
    return created


# Evidence validity reminders (R2 5.4): one notice per stage and evidence.


async def check_evidence_expiry(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Evidence whose valid_until is 30 / 7 / 0 days away (or just passed).

    valid_until existed on the model and nothing ever read it, so a requirement
    stayed "conforme" on a certificate that had lapsed. The control's owner and
    the tenant's stakeholders are told once per stage; evidence that lapsed
    more than 30 days ago is history, not news.
    """
    created = 0
    today = datetime.utcnow().date()
    rows = (await db.execute(_scoped(
        select(Evidence, ControlAssessment, FrameworkControl)
        .join(ControlAssessment, ControlAssessment.id == Evidence.control_assessment_id)
        .join(FrameworkControl, FrameworkControl.id == ControlAssessment.control_id)
        .where(Evidence.valid_until.isnot(None)),
        Evidence.tenant_id, tenant_id))).all()
    for ev, ca, fc in rows:
        try:
            until = datetime.fromisoformat(ev.valid_until[:10]).date()
        except (ValueError, TypeError):
            continue
        days = (until - today).days
        if days > 30 or days < -30:
            continue
        # 30..8 days → "30d", 7..1 → "7d", today or past → "expired".
        stage = "expired" if days <= 0 else ("7d" if days <= 7 else "30d")
        expired = stage == "expired"
        key = "notifications.evidence_expired" if expired else "notifications.evidence_expiring"
        control_ref = fc.control_id or ""
        name = ev.file_name or ev.name or ""
        title = (f"Evidence EXPIRED: {control_ref}" if expired
                 else f"Evidence expires in {days} days: {control_ref}")
        message = (f"The evidence '{name}' for {control_ref} expired on {ev.valid_until[:10]}."
                   if expired else
                   f"The evidence '{name}' for {control_ref} is valid until {ev.valid_until[:10]}.")
        recipients = {u.id: u for u in await get_recipients_for_tenant(db, ev.tenant_id)}
        owner = await get_owner_in_tenant(db, ca.owner_id, ev.tenant_id)
        if owner:
            recipients[owner.id] = owner
        dedup = f"{ev.id}:{stage}"
        for user in recipients.values():
            if await notification_exists(db, user.id, NotificationType.CONTROL_EXPIRED, dedup, within_days=90):
                continue
            await create_notification(
                db, user=user, notif_type=NotificationType.CONTROL_EXPIRED,
                title=title, message=message, entity_id=dedup, entity_type="evidence",
                link=f"/compliance/{ca.assessment_id}", severity="high" if expired else ("medium" if days <= 7 else "info"),
                title_key=f"{key}.title", message_key=f"{key}.message",
                params={"control": control_ref, "file": name, "days": abs(days), "until": ev.valid_until[:10]},
            )
            created += 1
    return created


async def check_overdue_attestations(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Pending policy acknowledgements past their due date — the employee is
    reminded (weekly), in the place they can act: My policies."""
    created = 0
    today = datetime.utcnow().date().isoformat()
    rows = (await db.execute(_scoped(
        select(PolicyAttestation, Policy)
        .join(Policy, Policy.id == PolicyAttestation.policy_id)
        .where(PolicyAttestation.status == AttestationStatus.PENDING,
               PolicyAttestation.due_date.isnot(None),
               Policy.status != PolicyStatus.RETIRED),
        Policy.tenant_id, tenant_id))).all()
    for att, policy in rows:
        if not att.due_date or att.due_date[:10] >= today:
            continue
        user = await get_owner_in_tenant(db, att.user_id, policy.tenant_id)
        if not user:
            continue
        if await notification_exists(db, user.id, NotificationType.POLICY_REVIEW_DUE, att.id, within_days=7):
            continue
        await create_notification(
            db, user=user, notif_type=NotificationType.POLICY_REVIEW_DUE,
            title=f"Policy acknowledgement OVERDUE: {policy.title[:50]}",
            message=f"Please read and accept '{policy.title}' (due {att.due_date[:10]}).",
            entity_id=att.id, entity_type="policy_attestation", link="/my-policies",
            severity="high", title_key="notifications.attestation_overdue.title",
            message_key="notifications.attestation_overdue.message",
            params={"policy": policy.title, "due": att.due_date[:10]},
        )
        created += 1
    return created


async def check_risk_appetite_breaches(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Alert when a risk's residual/inherent score exceeds its appetite threshold (Elite)."""
    created = 0
    result = await db.execute(
        _scoped(select(Risk).where(Risk.appetite_threshold.isnot(None)),
                Risk.tenant_id, tenant_id)
    )
    for risk in result.scalars().all():
        if not risk.over_appetite:
            continue
        score = risk.residual_risk_score if risk.residual_risk_score is not None else risk.inherent_risk_score
        recipients = await get_recipients_for_tenant(db, risk.tenant_id)
        for user in recipients:
            if not await notification_exists(db, user.id, NotificationType.RISK_OVER_APPETITE, risk.id, within_days=7):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.RISK_OVER_APPETITE,
                    title=f"Risk over appetite: {risk.title[:50]}",
                    message=(f"Risk '{risk.title}' has a residual score of {score} which exceeds "
                             f"the appetite threshold of {risk.appetite_threshold}. Treatment is required."),
                    entity_id=risk.id,
                    entity_type="risk",
                    link=f"/risks?highlight={risk.id}",
                    severity="critical",
                    # Same key/params as risks.py's on-write alert.
                    title_key="notifications.risk_over_appetite.title",
                    message_key="notifications.risk_over_appetite.message",
                    params={"risk": risk.title, "score": score,
                            "threshold": risk.appetite_threshold},
                )
                created += 1
    return created


async def check_treatment_overdue(db: AsyncSession, tenant_id: str | None = None) -> int:
    """RFP gap fix: alert when a risk treatment plan's due_date has passed and it
    isn't complete yet (progress_percentage < 100). RiskTreatment has no tenant_id
    column of its own, so join through its Risk to scope recipients/links."""
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        _scoped(
            select(RiskTreatment, Risk)
            .join(Risk, Risk.id == RiskTreatment.risk_id)
            .where(RiskTreatment.due_date.isnot(None)),
            Risk.tenant_id, tenant_id,
        )
    )

    for treatment, risk in result.all():
        if (treatment.progress_percentage or 0) >= 100:
            continue
        try:
            due = datetime.fromisoformat(treatment.due_date).date()
        except (ValueError, TypeError):
            continue

        days_overdue = (today - due).days
        if days_overdue <= 0:
            continue  # not overdue yet

        title = f"Treatment plan OVERDUE: {risk.title[:50]}"
        message = (
            f"The {treatment.treatment_option.value} treatment plan for risk '{risk.title}' "
            f"was due {days_overdue} day(s) ago and is only "
            f"{treatment.progress_percentage or 0}% complete."
        )

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, treatment.owner_id, risk.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, risk.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.TREATMENT_OVERDUE, treatment.id, within_days=3):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.TREATMENT_OVERDUE,
                    title=title,
                    message=message,
                    entity_id=treatment.id,
                    entity_type="risk_treatment",
                    link=f"/risks?highlight={risk.id}",
                    severity="critical",
                    title_key="notifications.treatment_overdue.title",
                    message_key="notifications.treatment_overdue.message",
                    params={"risk": risk.title, "option": treatment.treatment_option.value,
                            "days": days_overdue,
                            "progress": treatment.progress_percentage or 0},
                )
                created += 1

    return created


async def check_treatment_budget_overrun(db: AsyncSession, tenant_id: str | None = None) -> int:
    """RFP gap fix: alert when a risk treatment plan's actual_cost exceeds its
    estimated_cost. Only fires once actual_cost has actually been recorded — an
    unset actual_cost means spend simply isn't tracked yet, not that it's zero."""
    created = 0

    result = await db.execute(
        _scoped(
            select(RiskTreatment, Risk)
            .join(Risk, Risk.id == RiskTreatment.risk_id)
            .where(
                RiskTreatment.actual_cost.isnot(None),
                RiskTreatment.estimated_cost.isnot(None),
            ),
            Risk.tenant_id, tenant_id,
        )
    )

    for treatment, risk in result.all():
        if treatment.actual_cost <= treatment.estimated_cost:
            continue

        overrun = treatment.actual_cost - treatment.estimated_cost
        title = f"Treatment plan over budget: {risk.title[:50]}"
        message = (
            f"The {treatment.treatment_option.value} treatment plan for risk '{risk.title}' "
            f"has an actual cost of {treatment.actual_cost} against an estimated cost of "
            f"{treatment.estimated_cost} (overrun of {overrun})."
        )

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, treatment.owner_id, risk.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, risk.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.TREATMENT_BUDGET_OVERRUN, treatment.id, within_days=7):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.TREATMENT_BUDGET_OVERRUN,
                    title=title,
                    message=message,
                    entity_id=treatment.id,
                    entity_type="risk_treatment",
                    link=f"/risks?highlight={risk.id}",
                    severity="high",
                    title_key="notifications.treatment_budget_overrun.title",
                    message_key="notifications.treatment_budget_overrun.message",
                    params={"risk": risk.title, "option": treatment.treatment_option.value,
                            "actual": treatment.actual_cost,
                            "estimated": treatment.estimated_cost, "overrun": overrun},
                )
                created += 1

    return created


async def check_pending_ciso_contracts(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Notify CISO about contracts waiting for their review."""
    created = 0

    # Find contracts waiting for CISO review
    # VendorContract has no tenant_id of its own; the join to Vendor is what
    # scopes it, exactly as the per-contract vendor lookup below does per row.
    result = await db.execute(
        _scoped(
            select(VendorContract)
            .join(Vendor, VendorContract.vendor_id == Vendor.id)
            .where(
                VendorContract.validation_status.in_([
                    ContractValidationStatus.AI_REVIEWED.value,
                    ContractValidationStatus.PENDING_CISO.value,
                ])
            ),
            Vendor.tenant_id, tenant_id,
        )
    )
    contracts = result.scalars().all()

    for contract in contracts:
        # Get vendor tenant
        vendor_result = await db.execute(
            select(Vendor).where(Vendor.id == contract.vendor_id)
        )
        vendor = vendor_result.scalar_one_or_none()
        if not vendor:
            continue

        recipients = await get_recipients_for_tenant(db, vendor.tenant_id)
        # Only notify CISO specifically
        cisos = [u for u in recipients if u.role == UserRole.CISO]
        if not cisos:
            # If no CISO, notify admins. The fallback used to re-test for CISO,
            # so on a tenant without one the contract sat waiting for a review
            # nobody had been asked for.
            cisos = [u for u in recipients if u.role == UserRole.TENANT_ADMIN]

        for user in cisos:
            if not await notification_exists(db, user.id, NotificationType.VENDOR_ALERT, contract.id, within_days=3):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.VENDOR_ALERT,
                    title=f"Contract awaiting your review: {vendor.name}",
                    message=f"A contract from {vendor.name} has been analyzed by AI and needs your approval.",
                    entity_id=contract.id,
                    entity_type="contract",
                    link="/vendors/contract-review",
                    severity="high",
                    title_key="notifications.contract_pending_review.title",
                    message_key="notifications.contract_pending_review.message",
                    params={"vendor": vendor.name},
                )
                created += 1

    return created


async def check_compliance_gaps(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Notify about compliance gaps that need attention."""
    from app.models.compliance import ComplianceAssessment as _CA

    created = 0

    # Find open compliance gaps with high severity. ComplianceGap has no
    # tenant_id column — its assessment carries it — so scoping needs the join
    # the per-gap lookup below already performs one row at a time.
    stmt = select(ComplianceGap).where(ComplianceGap.severity.in_(["critical", "high"]))
    if tenant_id:
        stmt = stmt.join(_CA, _CA.id == ComplianceGap.assessment_id).where(
            _CA.tenant_id == tenant_id
        )
    result = await db.execute(stmt)
    gaps = result.scalars().all()

    for gap in gaps:
        # Need to get tenant_id from the assessment
        from app.models.compliance import ComplianceAssessment
        assess_result = await db.execute(
            select(ComplianceAssessment).where(ComplianceAssessment.id == gap.assessment_id)
        )
        assessment = assess_result.scalar_one_or_none()
        if not assessment:
            continue

        recipients = await get_recipients_for_tenant(db, assessment.tenant_id)
        for user in recipients:
            if not await notification_exists(db, user.id, NotificationType.COMPLIANCE_SCORE_DROP, gap.id, within_days=7):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.COMPLIANCE_SCORE_DROP,
                    title=f"Critical compliance gap: {gap.control_id}",
                    message=f"{gap.gap_description[:150]}",
                    entity_id=gap.id,
                    entity_type="compliance_gap",
                    link=f"/compliance/{gap.assessment_id}",
                    severity=gap.severity,
                    title_key="notifications.compliance_gap.title",
                    message_key="notifications.compliance_gap.message",
                    params={"control": gap.control_id, "severity": gap.severity,
                            "description": (gap.gap_description or "")[:150]},
                )
                created += 1

    return created


async def check_action_plan_deadlines(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Notify CISO when action plan items are within 10 days of deadline and not yet done."""
    created = 0
    today = datetime.utcnow().date()

    # Only check active collaborations that have a finalized plan
    result = await db.execute(
        _scoped(
            select(ContractCollaboration).where(
                ContractCollaboration.status == "active",
                ContractCollaboration.plan_finalized_at.isnot(None),
                ContractCollaboration.action_plan.isnot(None),
            ),
            ContractCollaboration.tenant_id, tenant_id,
        )
    )
    collabs = result.scalars().all()

    for collab in collabs:
        try:
            plan: list[dict] = json.loads(collab.action_plan or "[]")
        except (json.JSONDecodeError, TypeError):
            continue

        for item in plan:
            if item.get("done"):
                continue  # already completed

            deadline_str = item.get("deadline")
            if not deadline_str:
                continue

            try:
                deadline = datetime.fromisoformat(deadline_str).date()
            except (ValueError, TypeError):
                continue

            days_remaining = (deadline - today).days
            # Notify only when ≤ 10 days remain (and not already overdue by more than 30 days)
            if days_remaining > 10 or days_remaining < -30:
                continue

            action_text = item.get("action", "Action item")[:80]
            entity_id = f"{collab.id}_{item.get('id', '')}"

            if days_remaining < 0:
                severity = "critical"
                key = "notifications.vendor_action_overdue"
                title = f"Action plan item OVERDUE: {collab.vendor_name}"
                message = (
                    f"Item '{action_text}' was due {abs(days_remaining)} day(s) ago "
                    f"and is still incomplete. Check with {collab.vendor_name}."
                )
            elif days_remaining == 0:
                severity = "high"
                key = "notifications.vendor_action_today"
                title = f"Action plan item due TODAY: {collab.vendor_name}"
                message = f"Item '{action_text}' is due today. Verify with {collab.vendor_name}."
            else:
                severity = "high"
                key = "notifications.vendor_action_due"
                title = f"Action plan deadline in {days_remaining} day(s): {collab.vendor_name}"
                message = (
                    f"Item '{action_text}' deadline is in {days_remaining} day(s). "
                    f"Follow up with {collab.vendor_name} to confirm progress."
                )

            recipients = await get_recipients_for_tenant(db, collab.tenant_id)
            # Only notify CISO / admins
            # (UserRole.CISO, UserRole.CISO) was a typo for the admin fallback:
            # on a tenant with no CISO the action-plan deadline notified nobody.
            cisos = [u for u in recipients if u.role in (UserRole.CISO, UserRole.TENANT_ADMIN)]
            for user in cisos:
                if not await notification_exists(db, user.id, NotificationType.VENDOR_ALERT, entity_id, within_days=3):
                    await create_notification(
                        db,
                        user=user,
                        notif_type=NotificationType.VENDOR_ALERT,
                        title=title,
                        message=message,
                        entity_id=entity_id,
                        entity_type="action_plan_item",
                        link=f"/vendors/collaboration/{collab.id}",
                        severity=severity,
                        title_key=f"{key}.title",
                        message_key=f"{key}.message",
                        params={"vendor": collab.vendor_name, "action": action_text,
                                "days": abs(days_remaining), "due": deadline_str},
                    )
                    created += 1

    return created


async def check_compliance_action_deadlines(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Notify the owner + CISO/admins when a compliance ActionItem (remediation task
    created from a gap recommendation) is within 7 days of its due date.

    The overdue half of this check moved to check_action_item_overdue, which
    chases it on the relance ladder instead of giving up after 30 days. Keeping
    both halves here would mean two notifications per late action; the split is
    clean because an approaching deadline and an abandoned action are different
    events with different audiences.
    """
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        _scoped(
            select(ActionItem).where(
                ActionItem.due_date.isnot(None),
                ActionItem.status.notin_([ActionItemStatus.COMPLETED, ActionItemStatus.CANCELLED]),
            ),
            ActionItem.tenant_id, tenant_id,
        )
    )
    items = result.scalars().all()

    for item in items:
        try:
            due = datetime.fromisoformat(item.due_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (due - today).days
        # Upcoming only — anything already due belongs to the relance ladder.
        if days_remaining > 7 or days_remaining < 0:
            continue

        if days_remaining == 0:
            severity = "high"
            title = f"Action item due TODAY: {item.title[:50]}"
            message = f"Action item '{item.title}' is due today."
            key = "notifications.action_item_due_today"
        else:
            severity = "medium"
            title = f"Action item due in {days_remaining} days: {item.title[:50]}"
            message = f"Action item '{item.title}' needs to be completed within {days_remaining} day(s)."
            key = "notifications.action_item_due"

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, item.owner_id, item.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, item.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.COMPLIANCE_ACTION_OVERDUE, item.id, within_days=3):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.COMPLIANCE_ACTION_OVERDUE,
                    title=title,
                    message=message,
                    entity_id=item.id,
                    entity_type="action_item",
                    link=f"/compliance/{item.assessment_id}" if item.assessment_id else "/compliance",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params={"title": item.title, "due": item.due_date, "days": days_remaining},
                )
                created += 1

    return created


async def check_asset_eol(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Notify the asset owner + CISO/admins about assets reaching end-of-life.
    Mirrors the criteria used by GET /assets/lifecycle/eol-soon (default within_days=90).
    """
    created = 0
    now = datetime.utcnow()
    cutoff = now + timedelta(days=90)

    result = await db.execute(
        _scoped(
            select(Asset).where(
                Asset.end_of_life_at.isnot(None),
                Asset.end_of_life_at <= cutoff,
            ),
            Asset.tenant_id, tenant_id,
        )
    )
    assets = result.scalars().all()

    for asset in assets:
        days_remaining = (asset.end_of_life_at - now).days

        if days_remaining < 0:
            severity = "critical"
            key = "notifications.asset_eol_passed"
            title = f"Asset past end-of-life: {asset.name[:50]}"
            message = f"Asset '{asset.name}' reached end-of-life {abs(days_remaining)} days ago and should be retired or replaced."
        elif days_remaining <= 30:
            severity = "high"
            key = "notifications.asset_eol_soon"
            title = f"Asset end-of-life in {days_remaining} days: {asset.name[:50]}"
            message = f"Asset '{asset.name}' reaches end-of-life in {days_remaining} days. Plan replacement/retirement."
        else:
            severity = "medium"
            key = "notifications.asset_eol_approaching"
            title = f"Asset end-of-life approaching: {asset.name[:50]}"
            message = f"Asset '{asset.name}' reaches end-of-life in {days_remaining} days ({asset.end_of_life_at.date().isoformat()})."

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, asset.owner_id, asset.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, asset.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.ASSET_EOL, asset.id, within_days=7):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.ASSET_EOL,
                    title=title,
                    message=message,
                    entity_id=asset.id,
                    entity_type="asset",
                    link=f"/assets?highlight={asset.id}",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params={"asset": asset.name, "days": abs(days_remaining),
                            "eol": asset.end_of_life_at.date().isoformat()},
                )
                created += 1

    return created


async def check_threat_profile_reviews(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Remind security leads when a threat profile is due for its periodic review.

    "Le profil de menace doit être révisé périodiquement" only means something if
    somebody is told. The due date is set when a profile is validated or
    reviewed (threat_registry.schedule_next_review); this turns it into a
    reminder at 14 and 7 days out, on the day, and while overdue — the same
    window the risk and asset review checks already use, so the three read
    consistently in the notification list.
    """
    from app.models.threat import Threat

    created = 0
    today = datetime.utcnow().date()
    horizon = (today + timedelta(days=14)).isoformat()

    threats = (await db.execute(
        _scoped(
            select(Threat).where(
                Threat.tenant_id.isnot(None),
                Threat.is_pending == False,  # noqa: E712
                Threat.next_review_due.isnot(None),
                Threat.next_review_due <= horizon,
            ),
            Threat.tenant_id, tenant_id,
        )
    )).scalars().all()

    for threat in threats:
        try:
            due = date.fromisoformat(str(threat.next_review_due)[:10])
        except ValueError:
            continue
        days = (due - today).days
        # Stop nagging after a month overdue, exactly as the risk and asset
        # checks do — a permanent alert is one nobody reads.
        if days < -30:
            continue
        # `when` builds the English sentence; `key` carries the same three
        # situations to the client, which renders them with t(). Interpolating
        # a translated fragment into a translated sentence is what we avoid.
        if days < 0:
            severity, when = "high", f"was due {abs(days)} day(s) ago"
            key = "notifications.threat_review_overdue"
        elif days == 0:
            severity, when = "high", "is due today"
            key = "notifications.threat_review_today"
        else:
            severity, when = "medium", f"is due in {days} day(s)"
            key = "notifications.threat_review_due"

        for user in await get_recipients_for_tenant(db, threat.tenant_id):
            if await notification_exists(
                db, user.id, NotificationType.THREAT_PROFILE_REVIEW_DUE, threat.id, within_days=7
            ):
                continue
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.THREAT_PROFILE_REVIEW_DUE,
                title=f"Threat profile review {when}: {threat.name[:50]}",
                message=(
                    f"The profile for '{threat.name}' {when} ({threat.next_review_due}). "
                    f"Confirm it still holds against the current threat watch, or update it."
                ),
                entity_id=threat.id,
                entity_type="threat",
                link=f"/threats?highlight={threat.id}",
                severity=severity,
                title_key=f"{key}.title",
                message_key=f"{key}.message",
                params={"threat": threat.name, "days": abs(days),
                        "due": str(threat.next_review_due)},
            )
            created += 1

    return created


async def check_asset_review_deadlines(db: AsyncSession, tenant_id: str | None = None) -> int:
    """RFP gap fix: mandatory periodic asset review reminders. Mirrors
    check_risk_review_deadlines's day-window logic exactly (14/7/0 days, capped at
    30 days overdue) applied to Asset.next_review_date instead of Risk.next_review_date."""
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        _scoped(select(Asset).where(Asset.next_review_date.isnot(None)),
                Asset.tenant_id, tenant_id)
    )
    assets = result.scalars().all()

    for asset in assets:
        if not asset.next_review_date:
            continue
        try:
            review_date = datetime.fromisoformat(asset.next_review_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (review_date - today).days

        # Trigger at 14, 7, 0 days, and if overdue (cap at 30 days overdue)
        if days_remaining > 14 or days_remaining < -30:
            continue

        if days_remaining < 0:
            severity = "critical"
            key = "notifications.asset_review_overdue"
            title = f"Asset review OVERDUE: {asset.name[:50]}"
            message = f"Asset '{asset.name}' review is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            key = "notifications.asset_review_today"
            title = f"Asset review due TODAY: {asset.name[:50]}"
            message = f"Asset '{asset.name}' needs to be reviewed today."
        elif days_remaining <= 7:
            severity = "medium"
            key = "notifications.asset_review_due"
            title = f"Asset review due in {days_remaining} days"
            message = f"Asset '{asset.name}' needs review within {days_remaining} days."
        else:
            severity = "info"
            key = "notifications.asset_review_upcoming"
            title = f"Upcoming asset review in {days_remaining} days"
            message = f"Asset '{asset.name}' scheduled for review in {days_remaining} days."

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, asset.owner_id, asset.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, asset.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.ASSET_REVIEW_DUE, asset.id, within_days=3):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.ASSET_REVIEW_DUE,
                    title=title,
                    message=message,
                    entity_id=asset.id,
                    entity_type="asset",
                    link=f"/assets?highlight={asset.id}",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params={"asset": asset.name, "days": abs(days_remaining),
                            "due": asset.next_review_date},
                )
                created += 1

    return created


async def check_unverified_controls(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Alert on controls in service that no security referent has signed off.

    "Un systeme d'alerte peut notifier en cas de controle expire **ou non
    verifie**." The expiry half existed; this is the other half, and it is the
    more dangerous of the two — an expired control is visibly stale, whereas an
    active-but-unverified one is counted as a mitigation by everything that
    reads the register while nobody has confirmed it works.

    Only controls that are actually operating are flagged. A planned control
    has not been signed off because it does not exist yet, which is not a
    finding.
    """
    from app.models.applied_control import AppliedControl

    created = 0
    grace = datetime.utcnow() - timedelta(days=30)

    controls = (await db.execute(
        _scoped(select(AppliedControl).where(
            # ControlStatus is planned/in_progress/implemented/not_applicable/
            # deprecated — there is no "active" member, so the old filter
            # matched nothing on that half AND left out "implemented", i.e.
            # exactly the population this check exists to surface: a control
            # in service that no referent has signed off. The whole check was
            # dead for implemented controls. Same tuple as
            # applied_controls.IN_SERVICE_STATUSES, kept literal so the
            # notification job does not import an endpoint module.
            AppliedControl.status.in_(("in_progress", "implemented")),
            # `!= 'validated'` alone is false for NULL in SQL, so the controls
            # that have never been through validation at all — exactly the
            # population this check exists to surface — were being excluded.
            or_(AppliedControl.validation_status.is_(None),
                AppliedControl.validation_status != "validated"),
            AppliedControl.created_at <= grace,
        ), AppliedControl.tenant_id, tenant_id)
    )).scalars().all()

    for control in controls:
        state = (control.validation_status.value
                 if hasattr(control.validation_status, "value")
                 else str(control.validation_status or "pending"))
        rejected = state == "rejected"

        recipients = {u.id: u for u in await get_recipients_for_tenant(db, control.tenant_id)}
        if control.owner_id and control.owner_id not in recipients:
            owner = await get_owner_in_tenant(db, control.owner_id, control.tenant_id)
            if owner:
                recipients[owner.id] = owner

        label = control.ref_id or control.name[:30]
        for user in recipients.values():
            if await notification_exists(
                db, user.id, NotificationType.CONTROL_UNVERIFIED, control.id, within_days=14
            ):
                continue
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.CONTROL_UNVERIFIED,
                title=(f"Control rejected but still in service: {label}" if rejected
                       else f"Control in service without sign-off: {label}"),
                message=(
                    f"'{control.name}' is {state.replace('_', ' ')} and has been operating "
                    f"for over 30 days without validation by a security referent. "
                    f"Everything that reads the register counts it as a mitigation."
                ),
                entity_id=control.id,
                entity_type="applied_control",
                link=f"/applied-controls?highlight={control.id}",
                severity="high" if rejected else "medium",
                title_key=("notifications.control_rejected_in_service.title" if rejected
                           else "notifications.control_unverified.title"),
                message_key=("notifications.control_rejected_in_service.message" if rejected
                             else "notifications.control_unverified.message"),
                params={"control": control.name, "ref": label,
                        "state": state.replace("_", " ")},
            )
            created += 1

    return created


async def check_control_evaluations_due(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Remind the control owner and the CISO when an effectiveness evaluation is due.

    "Des evaluations periodiques, planifiees selon une frequence definie, sont
    obligatoires pour chaque controle." The due date was stored and a /due
    endpoint listed it, but nothing told anybody — an obligation that only
    surfaces when somebody thinks to open the screen is not scheduled.

    Same 14/7/0-day window and 30-day overdue cap as the risk, asset and threat
    review checks, so the notification list reads consistently.
    """
    from app.models.applied_control import AppliedControl
    from app.models.control_evaluation import ControlEvaluation

    created = 0
    today = datetime.utcnow().date()
    horizon = datetime.utcnow() + timedelta(days=14)

    # The latest evaluation per control carries the schedule; earlier ones are
    # superseded and must not raise a second reminder.
    rows = (await db.execute(
        _scoped(
            select(ControlEvaluation)
            .where(ControlEvaluation.next_evaluation_at.isnot(None),
                   ControlEvaluation.next_evaluation_at <= horizon)
            .order_by(ControlEvaluation.evaluated_at.desc().nullslast()),
            ControlEvaluation.tenant_id, tenant_id,
        )
    )).scalars().all()

    seen: set[str] = set()
    for ev in rows:
        if ev.applied_control_id in seen:
            continue
        seen.add(ev.applied_control_id)

        due = ev.next_evaluation_at.date()
        days = (due - today).days
        if days < -30:
            continue
        if days < 0:
            severity, when = "high", f"was due {abs(days)} day(s) ago"
            key = "notifications.control_evaluation_overdue"
        elif days == 0:
            severity, when = "high", "is due today"
            key = "notifications.control_evaluation_today"
        else:
            severity, when = "medium", f"is due in {days} day(s)"
            key = "notifications.control_evaluation_due"

        control = (await db.execute(
            select(AppliedControl).where(AppliedControl.id == ev.applied_control_id)
        )).scalar_one_or_none()
        if control is None:
            # An evaluation left behind by a control deleted before this was
            # cleaned up. Nothing to remind anyone about.
            continue

        recipients = {u.id: u for u in await get_recipients_for_tenant(db, ev.tenant_id)}
        if control.owner_id and control.owner_id not in recipients:
            owner = await get_owner_in_tenant(db, control.owner_id, ev.tenant_id)
            if owner:
                recipients[owner.id] = owner

        label = control.ref_id or control.name[:30]
        for user in recipients.values():
            if await notification_exists(
                db, user.id, NotificationType.CONTROL_EVALUATION_DUE, control.id, within_days=7
            ):
                continue
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.CONTROL_EVALUATION_DUE,
                title=f"Control evaluation {when}: {label}",
                message=(
                    f"The effectiveness evaluation for '{control.name}' {when} "
                    f"({due.isoformat()}). Last result: "
                    f"{(ev.performance_level or 'not recorded').replace('_', ' ')}."
                ),
                entity_id=control.id,
                entity_type="applied_control",
                link=f"/applied-controls?highlight={control.id}",
                severity=severity,
                title_key=f"{key}.title",
                message_key=f"{key}.message",
                params={"control": control.name, "ref": label, "days": abs(days),
                        "due": due.isoformat(),
                        "last_result": (ev.performance_level or "not recorded")},
            )
            created += 1

    return created


async def check_scenario_priority_alerts(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Notify when a scenario reaches the tenant's configured priority threshold.

    "Un seuil d'alerte peut etre defini pour generer des notifications aux
    responsables." The threshold was configurable and the score was computed,
    but nothing compared them — the appetite check next door only ever looked at
    the risk register, never at scenarios.

    Notifies the scenario owner as well as the CISO and admins: the owner is the
    person the requirement means by "responsables", and they are not necessarily
    among the tenant-wide recipients.
    """
    from app.models.risk_scenario import RiskScenario
    from app.models.tenant import Tenant
    from app.services import scenario_priority

    created = 0
    tenants = (await db.execute(
        _scoped(select(Tenant).where(Tenant.is_active == True),  # noqa: E712
                Tenant.id, tenant_id)
    )).scalars().all()
    for tenant in tenants:
        criteria = scenario_priority.resolve_criteria(getattr(tenant, "settings", None))
        if criteria.get("alert_threshold") is None:
            continue

        scenarios = (await db.execute(
            select(RiskScenario).where(
                RiskScenario.tenant_id == tenant.id,
                RiskScenario.priority_score.isnot(None),
            )
        )).scalars().all()

        for sc in scenarios:
            if not scenario_priority.over_threshold(sc.priority_score, criteria):
                continue

            recipients = {u.id: u for u in await get_recipients_for_tenant(db, tenant.id)}
            if sc.owner_id and sc.owner_id not in recipients:
                owner = await get_owner_in_tenant(db, sc.owner_id, tenant.id)
                if owner:
                    recipients[owner.id] = owner

            label = sc.ref_id or sc.name[:20]
            for user in recipients.values():
                if await notification_exists(
                    db, user.id, NotificationType.SCENARIO_PRIORITY_THRESHOLD, sc.id, within_days=7
                ):
                    continue
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.SCENARIO_PRIORITY_THRESHOLD,
                    title=f"Priority threshold reached: {label}",
                    message=(
                        f"Scenario {label} — '{sc.name}' — scores "
                        f"{sc.priority_score} against a threshold of "
                        f"{criteria['alert_threshold']}. Review its treatment plan."
                    ),
                    entity_id=sc.id,
                    entity_type="risk_scenario",
                    link=f"/risk-scenarios?highlight={sc.id}",
                    severity="high",
                    title_key="notifications.scenario_priority_threshold.title",
                    message_key="notifications.scenario_priority_threshold.message",
                    params={"scenario": sc.name, "ref": label,
                            "score": sc.priority_score,
                            "threshold": criteria["alert_threshold"]},
                )
                created += 1

    return created


async def check_scenario_review_deadlines(db: AsyncSession, tenant_id: str | None = None) -> int:
    """RFP gap fix: "la revue annuelle des scenarios n'est pas outillee (pas de
    date de prochaine revue ni d'alerte associee — seuls les risques ont
    next_review_date et notifications)." Mirrors check_risk_review_deadlines's
    day-window logic exactly (14/7/0 days, capped at 30 days overdue) applied to
    RiskScenario.next_review_date instead of Risk.next_review_date.

    Uses NotificationType.SYSTEM rather than a dedicated SCENARIO_REVIEW_DUE
    member: adding a new NotificationType means editing app/models/notification.py,
    which is being touched concurrently by other work in this same tree. The
    notification's `data.entity_id`/`entity_type` (risk_scenario) still fully
    disambiguate these from any other SYSTEM notification for dedup + routing.
    """
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        _scoped(select(RiskScenario).where(RiskScenario.next_review_date.isnot(None)),
                RiskScenario.tenant_id, tenant_id)
    )
    scenarios = result.scalars().all()

    for scenario in scenarios:
        if not scenario.next_review_date:
            continue
        try:
            review_date = datetime.fromisoformat(scenario.next_review_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (review_date - today).days

        # Trigger at 14, 7, 0 days, and if overdue (cap at 30 days overdue)
        if days_remaining > 14 or days_remaining < -30:
            continue

        if days_remaining < 0:
            severity = "critical"
            key = "notifications.scenario_review_overdue"
            title = f"Scenario review OVERDUE: {scenario.name[:50]}"
            message = f"Risk scenario '{scenario.name}' review is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            key = "notifications.scenario_review_today"
            title = f"Scenario review due TODAY: {scenario.name[:50]}"
            message = f"Risk scenario '{scenario.name}' needs to be reviewed today."
        elif days_remaining <= 7:
            severity = "medium"
            key = "notifications.scenario_review_due"
            title = f"Scenario review due in {days_remaining} days"
            message = f"Risk scenario '{scenario.name}' needs review within {days_remaining} days."
        else:
            severity = "info"
            key = "notifications.scenario_review_upcoming"
            title = f"Upcoming scenario review in {days_remaining} days"
            message = f"Risk scenario '{scenario.name}' scheduled for review in {days_remaining} days."

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, scenario.owner_id, scenario.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, scenario.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.SYSTEM, scenario.id, within_days=3):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.SYSTEM,
                    title=title,
                    message=message,
                    entity_id=scenario.id,
                    entity_type="risk_scenario",
                    link=f"/risk-scenarios?highlight={scenario.id}",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params={"scenario": scenario.name, "days": abs(days_remaining),
                            "due": scenario.next_review_date},
                )
                created += 1

    return created


async def check_control_expiration(db: AsyncSession, tenant_id: str | None = None) -> int:
    """Notify the control owner + CISO/admins about AppliedControl rows nearing or past
    their expiration date (30-day warning window, matching the vendor/risk check style).
    """
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        _scoped(select(AppliedControl).where(AppliedControl.expiration.isnot(None)),
                AppliedControl.tenant_id, tenant_id)
    )
    controls = result.scalars().all()

    for control in controls:
        try:
            expiry = datetime.fromisoformat(control.expiration).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (expiry - today).days
        if days_remaining > 30:
            continue

        if days_remaining < 0:
            severity = "critical"
            key = "notifications.control_expired"
            title = f"Control EXPIRED: {control.name[:50]}"
            message = f"Applied control '{control.name}' expired {abs(days_remaining)} days ago and needs renewal."
        elif days_remaining == 0:
            severity = "high"
            key = "notifications.control_expires_today"
            title = f"Control expires TODAY: {control.name[:50]}"
            message = f"Applied control '{control.name}' expires today."
        else:
            severity = "medium"
            key = "notifications.control_expiring"
            title = f"Control expiring in {days_remaining} days: {control.name[:50]}"
            message = f"Applied control '{control.name}' expires in {days_remaining} days. Plan renewal."

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, control.owner_id, control.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, control.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.CONTROL_EXPIRED, control.id, within_days=7):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.CONTROL_EXPIRED,
                    title=title,
                    message=message,
                    entity_id=control.id,
                    entity_type="applied_control",
                    link=f"/applied-controls?highlight={control.id}",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params={"control": control.name, "days": abs(days_remaining),
                            "expiration": control.expiration},
                )
                created += 1

    return created


async def check_new_device_login(
    db: AsyncSession,
    user: User,
    ip_address: str | None,
    user_agent: str | None,
    device_label: str | None = None,
) -> bool:
    """Alert when a user successfully logs in from a device (User-Agent string)
    that has never been seen before in their login history.

    Called directly from the login handler right after a successful authentication
    (see auth.py's /auth/login) — this is a real-time, per-login check driven by the
    request itself, not a periodic scan, so it is intentionally NOT registered in
    run_all_checks().

    Dedup / "new" design choice: the match key is the raw User-Agent string alone,
    NOT the (ip, device) pair. IP addresses rotate too often for legitimate users
    (mobile networks, dynamic residential IPs, VPNs, corporate NAT) to be a reliable
    signal on their own — pairing IP with device would re-fire on a large fraction of
    logins for such users and train people to ignore the alert. A user's first-ever
    *successful* login establishes their baseline silently (nothing to compare
    against yet) and never fires this alert; only login #2+ with a genuinely new
    User-Agent does. Once a device's User-Agent has been recorded via any successful
    login, it is "seen" permanently and will not re-alert.

    Returns True if a new-device alert was created.
    """
    ua = (user_agent or "").strip()
    if not ua:
        return False

    prior_agents = (await db.execute(
        select(LoginEvent.user_agent).where(
            LoginEvent.user_id == user.id,
            LoginEvent.success == True,  # noqa: E712
        )
    )).scalars().all()

    if not prior_agents:
        # First successful login ever recorded for this user — no baseline to compare
        # against, so this can't be judged "new". Establishes the baseline going forward
        # once this login is journaled by the caller.
        return False

    if ua in prior_agents:
        return False

    label = device_label or ua[:80]
    where = f" from IP {ip_address}" if ip_address else ""

    # Alert the user themselves so they can act if it wasn't them.
    await create_notification(
        db,
        user=user,
        notif_type=NotificationType.NEW_DEVICE_LOGIN,
        title="New device sign-in detected",
        message=(
            f"Your GRCEye account was just signed in to from a device we haven't seen "
            f"before ({label}){where}. If this wasn't you, change your password immediately "
            "and review your active sessions in Settings."
        ),
        entity_id=user.id,
        entity_type="user",
        link="/settings?tab=security",
        severity="high",
        title_key="notifications.new_device_login.title",
        message_key="notifications.new_device_login.message",
        params={"device": label, "ip": ip_address or ""},
    )

    # Alert the tenant's CISO/admin recipients too (excluding the user themselves).
    for admin in await get_recipients_for_tenant(db, user.tenant_id):
        if admin.id == user.id:
            continue
        await create_notification(
            db,
            user=admin,
            notif_type=NotificationType.NEW_DEVICE_LOGIN,
            title=f"New device sign-in: {user.full_name}",
            message=(
                f"{user.full_name} ({user.email}) signed in from a device not previously "
                f"seen for this account ({label}){where}."
            ),
            entity_id=user.id,
            entity_type="user",
            link="/activity-log",
            severity="medium",
            title_key="notifications.new_device_login_admin.title",
            message_key="notifications.new_device_login_admin.message",
            params={"user": user.full_name, "email": user.email,
                    "device": label, "ip": ip_address or ""},
        )

    return True


async def check_finding_deadlines(db: AsyncSession, tenant_id: str | None = None) -> int:
    """RFP gap fix: "Pas de notification sur les échéances critiques des
    recommandations" — alert on audit finding (recommendation) deadlines
    within 7 days or overdue, for findings that are still OPEN or
    IN_REMEDIATION. Query shape mirrors GET /audits/findings/overdue
    (audits.py) — join AuditFinding to its parent Audit for tenant scoping —
    but this check fires proactively within a 7-day window too, not only once
    a finding is already overdue, and caps at 30 days overdue like the other
    periodic deadline checks in this file (check_risk_review_deadlines,
    check_asset_review_deadlines).
    """
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        _scoped(
            select(AuditFinding, Audit)
            .join(Audit, Audit.id == AuditFinding.audit_id)
            .where(
                AuditFinding.due_date.isnot(None),
                AuditFinding.due_date != "",
                AuditFinding.status.in_([FindingStatus.OPEN, FindingStatus.IN_REMEDIATION]),
                # Objectif 8: a soft-deleted engagement stays in the register but
                # must stop generating alerts about work nobody is doing any more.
                Audit.deleted_at.is_(None),
            ),
            Audit.tenant_id, tenant_id,
        )
    )

    for finding, audit in result.all():
        try:
            due = datetime.fromisoformat(finding.due_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (due - today).days
        if days_remaining > 7:
            continue

        # The 30-day overdue cap is gone: an open finding 40 days late is the
        # one that matters most for "jusqu'à leur clôture effective". Past the
        # first month the reminder simply slows from every 3 days to every 14,
        # which keeps it visible without becoming wallpaper.
        if days_remaining < 0:
            severity = "critical"
            overdue = abs(days_remaining)
            title = f"Recommendation OVERDUE: {finding.title[:50]}"
            message = f"The recommendation '{finding.title}' from audit '{audit.title}' is overdue by {overdue} days."
            key = "notifications.finding_overdue"
            dedup_days = 3 if overdue <= 30 else 14
        elif days_remaining == 0:
            severity = "high"
            title = f"Recommendation due TODAY: {finding.title[:50]}"
            message = f"The recommendation '{finding.title}' from audit '{audit.title}' is due today."
            key = "notifications.finding_due_today"
            dedup_days = 3
        else:
            severity = "medium"
            title = f"Recommendation due in {days_remaining} days: {finding.title[:50]}"
            message = f"The recommendation '{finding.title}' from audit '{audit.title}' needs to be addressed within {days_remaining} day(s)."
            key = "notifications.finding_due"
            dedup_days = 3

        params = {"finding": finding.title, "audit": audit.title,
                  "due": finding.due_date, "days": abs(days_remaining)}

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, finding.remediation_owner_id, audit.tenant_id)
        if owner:
            recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, audit.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.AUDIT_FINDING_DEADLINE, finding.id, within_days=dedup_days):
                await create_notification(
                    db,
                    user=user,
                    notif_type=NotificationType.AUDIT_FINDING_DEADLINE,
                    title=title,
                    message=message,
                    entity_id=finding.id,
                    entity_type="audit_finding",
                    link=f"/audits?highlight={audit.id}",
                    severity=severity,
                    title_key=f"{key}.title",
                    message_key=f"{key}.message",
                    params=params,
                )
                created += 1

    return created


async def check_action_item_overdue(db: AsyncSession, outbox: list | None = None,
                                   tenant_id: str | None = None) -> int:
    """STB objectif 3 — « relances automatiques » on corrective/preventive actions.

    The existing check_compliance_action_deadlines announces an action once it
    is within 7 days of its due date and then, while overdue, re-announces it
    every 3 days for 30 days before falling silent for good. That is a
    reminder, not a relance: it is loudest while the action is merely late and
    mute once it has been abandoned.

    This is the relance proper. It handles the overdue side only (the upcoming
    side stays with check_compliance_action_deadlines, unchanged), fires on the
    RELANCE_RUNGS ladder — J+0, J+3, J+7, J+14, J+30 then monthly, for ever —
    widens the audience from RELANCE_ESCALATE_FROM onwards, and sends the
    e-mail leg so the relance reaches the responsible person outside the app.

    Idempotent: a rung already delivered to a given user for a given action is
    never re-sent, so running this twice an hour or once a week produces the
    same notifications.
    """
    created = 0
    today = datetime.utcnow().date()

    items = (await db.execute(
        _scoped(
            select(ActionItem).where(
                ActionItem.due_date.isnot(None),
                ActionItem.due_date != "",
                ActionItem.status.notin_([ActionItemStatus.COMPLETED, ActionItemStatus.CANCELLED]),
            ),
            ActionItem.tenant_id, tenant_id,
        )
    )).scalars().all()

    for item in items:
        try:
            due = datetime.fromisoformat(item.due_date).date()
        except (ValueError, TypeError):
            continue

        days_overdue = (today - due).days
        rung = relance_rung(days_overdue)
        if rung is None:
            continue  # not due yet — check_compliance_action_deadlines owns that half

        owner = await get_owner_in_tenant(db, item.owner_id, item.tenant_id)
        owner_name = owner.full_name if owner else "—"
        # How many rungs have already gone by, quoted in the escalation message
        # so the recipient can see this is not the first attempt.
        reminders = len([r for r in RELANCE_RUNGS if r <= days_overdue]) or 1
        link = f"/compliance/{item.assessment_id}" if item.assessment_id else "/compliance"
        params = {
            "title": item.title,
            "due": item.due_date,
            "days": days_overdue,
            "stage": f"J+{rung}",
            "owner": owner_name,
            "reminders": reminders,
        }
        severity = "critical" if days_overdue >= RELANCE_ESCALATE_FROM else "high"

        # The owner first — they are the person the requirement means.
        targets: list[tuple[User, bool]] = []
        if owner:
            targets.append((owner, False))
        # An unowned overdue action has nobody to relaunch, so it escalates
        # immediately rather than disappearing.
        escalate = rung >= RELANCE_ESCALATE_FROM or owner is None
        if escalate:
            for user in await get_users_with_roles(db, item.tenant_id, ESCALATION_ROLES):
                if owner and user.id == owner.id:
                    continue
                targets.append((user, True))

        for user, is_escalation in targets:
            if await stage_already_sent(
                db, user.id, NotificationType.COMPLIANCE_ACTION_OVERDUE, item.id, rung
            ):
                continue
            key = ("notifications.action_item_relance_escalation" if is_escalation
                   else "notifications.action_item_relance")
            if is_escalation:
                title = f"Escalation: action '{item.title[:50]}' is {days_overdue} day(s) overdue"
                message = (
                    f"Action '{item.title}' (owner: {owner_name}) was due on {item.due_date} "
                    f"and has not moved after {reminders} reminder(s). It is escalated to you "
                    f"as the responsible authority."
                )
            else:
                title = f"Reminder J+{rung}: action '{item.title[:50]}' is {days_overdue} day(s) overdue"
                message = (
                    f"The corrective/preventive action '{item.title}' was due on {item.due_date} "
                    f"and is not closed. Update its progress or record why it cannot be closed."
                )
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.COMPLIANCE_ACTION_OVERDUE,
                title=title,
                message=message,
                entity_id=item.id,
                entity_type="action_item",
                link=link,
                severity=severity,
                title_key=f"{key}.title",
                message_key=f"{key}.message",
                params=params,
                extra_data={"relance_rung": rung, "escalation": is_escalation,
                            "action_type": item.action_type},
                outbox=outbox,
                email=True,
            )
            created += 1

    return created


async def check_audit_schedule(db: AsyncSession, outbox: list | None = None,
                              tenant_id: str | None = None) -> int:
    """STB objectif 4 — « notification automatique des parties prenantes ».

    Nothing told anybody that a planned audit was approaching: the date sat in
    audits.planned_start and was only seen by whoever opened the screen. This
    announces each planned engagement at J-30, J-7 and J-0 to the lead auditor,
    to every auditor assigned to it, and to the tenant's stakeholders, then
    keeps chasing on the relance ladder while a planned audit has failed to
    start.

    Only PLANNING audits are considered — an engagement already in fieldwork
    does not need to be told it is about to begin — and soft-deleted ones are
    excluded (audits.deleted_at, objectif 8).
    """
    from app.models.auditor_assignment import AuditorAssignment

    created = 0
    today = datetime.utcnow().date()

    audits = (await db.execute(
        _scoped(
            select(Audit).where(
                Audit.planned_start.isnot(None),
                Audit.planned_start != "",
                Audit.status == AuditStatus.PLANNING,
                Audit.deleted_at.is_(None),
            ),
            Audit.tenant_id, tenant_id,
        )
    )).scalars().all()

    for audit in audits:
        try:
            start = datetime.fromisoformat(audit.planned_start).date()
        except (ValueError, TypeError):
            continue

        days_until = (start - today).days
        if days_until > 30:
            continue

        # One stage marker per rung so each rung fires exactly once per user.
        if days_until >= 8:
            stage, key, severity = "j30", "notifications.audit_schedule", "info"
        elif days_until >= 1:
            stage, key, severity = "j7", "notifications.audit_schedule", "medium"
        elif days_until == 0:
            stage, key, severity = "j0", "notifications.audit_starting_today", "high"
        else:
            rung = relance_rung(-days_until)
            if rung is None:
                continue
            stage, key, severity = f"late{rung}", "notifications.audit_start_overdue", "high"

        days_label = abs(days_until)
        params = {"audit": audit.title, "start": audit.planned_start, "days": days_label}
        if key == "notifications.audit_schedule":
            title = f"Audit '{audit.title[:50]}' starts in {days_until} day(s)"
            message = (f"Audit '{audit.title}' is planned to start on {audit.planned_start}. "
                       f"Confirm the scope, the auditors and the availability of the audited teams.")
        elif key == "notifications.audit_starting_today":
            title = f"Audit '{audit.title[:50]}' starts today"
            message = f"Audit '{audit.title}' is planned to start today ({audit.planned_start})."
        else:
            title = f"Audit '{audit.title[:50]}' has not started ({days_label} day(s) late)"
            message = (f"Audit '{audit.title}' was planned to start on {audit.planned_start} and is "
                       f"still in planning. Re-plan it or start the fieldwork.")

        # Lead auditor, then the auditors actually affected to the engagement,
        # then the stakeholders. AuditorAssignment.audit_id is the objectif 4
        # column; rows that predate it carry NULL and are assessment-scoped, so
        # they are correctly ignored here.
        recipients: dict[str, User] = {}
        lead = await get_owner_in_tenant(db, audit.lead_auditor_id, audit.tenant_id)
        if lead:
            recipients[lead.id] = lead
        assigned_ids = [row for (row,) in (await db.execute(
            select(AuditorAssignment.auditor_id).where(
                AuditorAssignment.audit_id == audit.id,
                AuditorAssignment.tenant_id == audit.tenant_id,
                AuditorAssignment.is_active == True,  # noqa: E712
            )
        )).all()]
        for auditor_id in assigned_ids:
            auditor = await get_owner_in_tenant(db, auditor_id, audit.tenant_id)
            if auditor:
                recipients[auditor.id] = auditor
        for user in await get_recipients_for_tenant(db, audit.tenant_id):
            recipients.setdefault(user.id, user)

        for user in recipients.values():
            if await stage_already_sent(
                db, user.id, NotificationType.AUDIT_DUE, audit.id, stage, marker_key="schedule_stage"
            ):
                continue
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.AUDIT_DUE,
                title=title,
                message=message,
                entity_id=audit.id,
                entity_type="audit",
                link=f"/audits?highlight={audit.id}",
                severity=severity,
                title_key=f"{key}.title",
                message_key=f"{key}.message",
                params=params,
                extra_data={"schedule_stage": stage, "campaign_id": audit.campaign_id},
                outbox=outbox,
                # Mail only the rungs that actually demand an action outside the
                # app: a J-30 heads-up does not warrant an e-mail to everybody.
                email=stage not in ("j30",),
            )
            created += 1

    return created


async def check_finding_assigned(db: AsyncSession, outbox: list | None = None,
                                tenant_id: str | None = None) -> int:
    """Safety net for « affectation à un responsable » on audit findings.

    audits.py notifies the owner when a finding is created or re-assigned
    through the API. Nothing covers a finding whose owner was set by any other
    path — the CSV/bulk import, a data fix, or simply an assignment made before
    that notification existed — and on the live database those are the only
    assignments there are. This sweeps them up once each.

    notified_about() matches across the types the endpoint and this file use for
    the same entity, so a finding assigned through the API in the last 90 days
    is NOT notified twice.
    """
    created = 0

    rows = (await db.execute(
        _scoped(
            select(AuditFinding, Audit)
            .join(Audit, Audit.id == AuditFinding.audit_id)
            .where(
                AuditFinding.remediation_owner_id.isnot(None),
                AuditFinding.status.in_([FindingStatus.OPEN, FindingStatus.IN_REMEDIATION]),
                Audit.deleted_at.is_(None),
            ),
            Audit.tenant_id, tenant_id,
        )
    )).all()

    for finding, audit in rows:
        owner = await get_owner_in_tenant(db, finding.remediation_owner_id, audit.tenant_id)
        if not owner:
            continue
        # within_days=None — "has this person EVER been told about this
        # finding". With the 90-day window this check used to have, an open
        # finding with an owner was re-announced (and re-mailed) as "a finding
        # was assigned to you" every quarter, for ever: the notification this
        # very function writes was the only thing holding the window open, so
        # as soon as it aged out the sweep fired again. An assignment happens
        # once.
        if await notified_about(
            db, owner.id, finding.id,
            types=(NotificationType.AUDIT_FINDING_NEW, NotificationType.SYSTEM,
                   NotificationType.AUDIT_FINDING_DEADLINE),
            within_days=None,
        ):
            continue

        await create_notification(
            db,
            user=owner,
            notif_type=NotificationType.AUDIT_FINDING_NEW,
            title="A finding was assigned to you",
            message=f"'{finding.title}' was raised in the audit '{audit.title}'.",
            entity_id=finding.id,
            entity_type="audit_finding",
            link=f"/audits?highlight={audit.id}",
            severity="high",
            # Same key and params as audits.py's assignment notification, so the
            # client needs one translation for both paths.
            title_key="notifications.audit_finding_assigned.title",
            message_key="notifications.audit_finding_assigned.message",
            params={"finding": finding.title, "audit": audit.title},
            extra_data={"audit_id": audit.id, "assigned_owner_id": owner.id},
            outbox=outbox,
            email=True,
        )
        created += 1

    return created


async def check_recommendation_due(db: AsyncSession, outbox: list | None = None,
                                  tenant_id: str | None = None) -> int:
    """STB objectif 7 — recommendations chased « jusqu'à leur clôture effective ».

    AuditRecommendation is the tracked object (a finding can carry several), so
    its own due date needs its own alert: J-14 / J-7 / J-0, then the relance
    ladder while it stays open, with the same escalation as the action-plan
    relance. Like the finding check next door it never gives up after 30 days
    overdue — an unclosed recommendation is precisely what the tender asks to
    be able to prove was followed up.

    The audit_recommendations table is only created by create_all() at the next
    restart, so its absence is checked for rather than caught: an exception here
    would put the session in a rollback-required state and spam the log with the
    full SELECT on every tick until the process is restarted.
    """
    from app.models.audit_recommendation import AuditRecommendation

    created = 0
    today = datetime.utcnow().date()

    if not await table_exists(db, AuditRecommendation.__tablename__):
        return 0

    rows = (await db.execute(
        _scoped(
            select(AuditRecommendation, Audit)
            .join(Audit, Audit.id == AuditRecommendation.audit_id)
            .where(
                AuditRecommendation.due_date.isnot(None),
                AuditRecommendation.due_date != "",
                AuditRecommendation.status.notin_(["closed", "rejected"]),
                Audit.deleted_at.is_(None),
            ),
            AuditRecommendation.tenant_id, tenant_id,
        )
    )).all()

    for rec, audit in rows:
        try:
            due = datetime.fromisoformat(rec.due_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (due - today).days
        if days_remaining > 14:
            continue

        if days_remaining >= 8:
            stage, key, severity = "d14", "notifications.recommendation_due", "info"
        elif days_remaining >= 1:
            stage, key, severity = "d7", "notifications.recommendation_due", "medium"
        elif days_remaining == 0:
            stage, key, severity = "d0", "notifications.recommendation_due_today", "high"
        else:
            rung = relance_rung(-days_remaining)
            if rung is None:
                continue
            stage, key, severity = f"late{rung}", "notifications.recommendation_overdue", "critical"

        ref = rec.ref_code or (rec.title[:30] if rec.title else "—")
        days_label = abs(days_remaining)
        params = {
            "ref": ref, "title": rec.title, "audit": audit.title,
            "due": rec.due_date, "days": days_label, "progress": rec.progress or 0,
        }
        if key == "notifications.recommendation_due":
            title = f"Recommendation {ref} is due in {days_remaining} day(s)"
            message = (f"Recommendation '{rec.title}' from audit '{audit.title}' is due on "
                       f"{rec.due_date} and is {rec.progress or 0}% complete. Track it through "
                       f"to effective closure.")
        elif key == "notifications.recommendation_due_today":
            title = f"Recommendation {ref} is due today"
            message = (f"Recommendation '{rec.title}' from audit '{audit.title}' is due today "
                       f"({rec.due_date}) and is {rec.progress or 0}% complete.")
        else:
            title = f"Recommendation {ref} is {days_label} day(s) overdue"
            message = (f"Recommendation '{rec.title}' from audit '{audit.title}' was due on "
                       f"{rec.due_date} and is still only {rec.progress or 0}% complete. "
                       f"It remains open until effective closure.")

        recipients: dict[str, User] = {}
        owner = await get_owner_in_tenant(db, rec.owner_id, rec.tenant_id)
        if owner:
            recipients[owner.id] = owner
        # Escalate once the recommendation is genuinely late, or immediately if
        # nobody owns it — an unowned recommendation cannot be chased.
        if days_remaining < 0 or owner is None:
            overdue_days = max(0, -days_remaining)
            if overdue_days >= RELANCE_ESCALATE_FROM or owner is None:
                for user in await get_users_with_roles(db, rec.tenant_id, ESCALATION_ROLES):
                    recipients.setdefault(user.id, user)

        for user in recipients.values():
            if await stage_already_sent(
                db, user.id, NotificationType.AUDIT_FINDING_DEADLINE, rec.id, stage,
                marker_key="recommendation_stage",
            ):
                continue
            await create_notification(
                db,
                user=user,
                notif_type=NotificationType.AUDIT_FINDING_DEADLINE,
                title=title,
                message=message,
                entity_id=rec.id,
                entity_type="audit_recommendation",
                link=f"/audits?highlight={audit.id}",
                severity=severity,
                title_key=f"{key}.title",
                message_key=f"{key}.message",
                params=params,
                extra_data={"recommendation_stage": stage, "audit_id": audit.id,
                            "finding_id": rec.finding_id},
                outbox=outbox,
                email=days_remaining <= 0,  # mail from the due date onwards
            )
            created += 1

    return created


async def run_all_checks(db: AsyncSession, tenant_id: str | None = None) -> dict:
    """Run all notification checks and return a summary.

    ``tenant_id=None`` sweeps the whole platform — what the scheduler wants.
    Passing a tenant restricts every query, and therefore every notification and
    every e-mail, to that tenant: the « Check deadlines » button used to write
    rows into the other ten tenants and hand its caller platform-wide counts.

    Idempotent by construction: every check dedups on what is already in the
    notifications table, so calling this hourly, daily or twice in a row
    produces the same rows.

    Each check is isolated: it runs in its own try/except AND commits its own
    notifications. That matters now that a scheduler drives this rather than a
    human pressing a button — a single failing statement puts the SQLAlchemy
    session in a rollback-required state, so with one shared commit at the end
    one broken check discarded the work of every check that had already
    succeeded, and the sweep then raised out of the loop. Committing per check
    also means a failure loses only that check's rows, and the matching e-mails
    are dropped from the outbox so nothing is ever mailed about a notification
    that did not persist.

    E-mails are queued during the checks and flushed AFTER the commits, so the
    SMTP round-trips never happen while SQLite's single write lock is held.
    """
    results = {
        "vendor_contracts": 0,
        "risk_reviews": 0,
        "risk_appetite": 0,
        "ciso_contracts": 0,
        "compliance_gaps": 0,
        "action_plan_deadlines": 0,
        "compliance_action_deadlines": 0,
        "asset_eol": 0,
        "threat_profile_review_due": 0,
        "scenario_priority_alert": 0,
        "control_evaluation_due": 0,
        "control_unverified": 0,
        "control_expiration": 0,
        "treatment_overdue": 0,
        "treatment_budget_overrun": 0,
        "asset_review_deadlines": 0,
        "scenario_review_deadlines": 0,
        "finding_deadlines": 0,
        # STB: relances + notification automatique des parties prenantes.
        "action_item_relances": 0,
        "audit_schedule": 0,
        "finding_assigned": 0,
        "recommendation_due": 0,
        # R2: policy review dates and overdue acknowledgements.
        "policy_reviews": 0,
        "overdue_attestations": 0,
        "evidence_expiry": 0,
    }
    # Queued e-mails for this run; drained after the commits below.
    outbox: list[dict] = []

    async def _run(key: str, label: str, check, pass_outbox: bool = False) -> None:
        """Run one check, commit it, and never let it take the sweep down."""
        mark = len(outbox)
        try:
            results[key] = await (check(db, outbox, tenant_id) if pass_outbox
                                  else check(db, tenant_id))
            await db.commit()
        except Exception as exc:  # noqa: BLE001 — one broken check must not stop the rest
            try:
                await db.rollback()
            except Exception:  # noqa: BLE001
                pass
            # The notifications this check created are gone; their e-mails must
            # go with them.
            del outbox[mark:]
            results[key] = 0
            logger.error("%s failed: %s", label, exc)

    await _run("vendor_contracts", "Vendor contract check", check_vendor_contract_expiry)
    await _run("risk_reviews", "Risk review check", check_risk_review_deadlines)
    await _run("risk_appetite", "Risk appetite check", check_risk_appetite_breaches)
    await _run("ciso_contracts", "CISO contracts check", check_pending_ciso_contracts)
    await _run("compliance_gaps", "Compliance gaps check", check_compliance_gaps)
    await _run("action_plan_deadlines", "Action plan deadline check", check_action_plan_deadlines)
    await _run("compliance_action_deadlines", "Compliance action deadline check",
               check_compliance_action_deadlines)
    # These five used to share one try block, so a failure in any of them
    # skipped the rest and was reported as "Asset EOL check failed".
    await _run("asset_eol", "Asset EOL check", check_asset_eol)
    await _run("threat_profile_review_due", "Threat profile review check", check_threat_profile_reviews)
    await _run("scenario_priority_alert", "Scenario priority alert check", check_scenario_priority_alerts)
    await _run("control_evaluation_due", "Control evaluation check", check_control_evaluations_due)
    await _run("control_unverified", "Unverified control check", check_unverified_controls)
    await _run("control_expiration", "Control expiration check", check_control_expiration)
    await _run("treatment_overdue", "Treatment overdue check", check_treatment_overdue)
    await _run("treatment_budget_overrun", "Treatment budget overrun check", check_treatment_budget_overrun)
    await _run("asset_review_deadlines", "Asset review deadline check", check_asset_review_deadlines)
    await _run("scenario_review_deadlines", "Scenario review deadline check", check_scenario_review_deadlines)
    await _run("finding_deadlines", "Finding deadline check", check_finding_deadlines)

    # ── STB additions ────────────────────────────────────────────────────────
    await _run("action_item_relances", "Action item relance check", check_action_item_overdue, True)
    await _run("audit_schedule", "Audit schedule check", check_audit_schedule, True)
    await _run("finding_assigned", "Finding assignment check", check_finding_assigned, True)
    # check_recommendation_due reads a table that create_all() only builds at
    # the next restart; it probes for it rather than catching the error, and it
    # is committed like every other check.
    await _run("recommendation_due", "Recommendation deadline check", check_recommendation_due, True)
    await _run("policy_reviews", "Policy review check", check_policy_reviews)
    await _run("overdue_attestations", "Overdue attestation check", check_overdue_attestations)
    await _run("evidence_expiry", "Evidence expiry check", check_evidence_expiry)

    results["total"] = sum(results.values())

    # After the commits: SMTP is slow and fallible, and the in-app
    # notifications must already be durable when we start mailing about them.
    try:
        results["emails_sent"] = await flush_email_outbox(db, outbox)
    except Exception as e:  # noqa: BLE001 — the relay must never break the run
        results["emails_sent"] = 0
        logger.error("Notification email flush failed: %s", e)

    return results


# ── Automatic driver ─────────────────────────────────────────────────────────
# STB objectif 3: « relances automatiques (déclenchement sans intervention
# humaine) ». Until now run_all_checks had exactly one caller — the "Check
# deadlines" button on the notification bell — so every relance in the platform
# depended on somebody remembering to press it.
#
# In-process asyncio loop, the same shape as report_scheduler /
# vuln_scanner_scheduler / audit_recurrence_scheduler, because Celery is not
# running here (no worker, no beat, no Redis) and a requirement must not depend
# on a queue that nobody starts.
NOTIFICATION_POLL_SECONDS = 6 * 3600  # four sweeps a day is ample for day-grained deadlines

# Cross-process mutual exclusion for the sweep. Production runs 2 uvicorn
# workers on one box (CLAUDE.md), so an in-memory singleton would be no gate at
# all, and there is no scheduler-state table and no Redis to hang a proper
# claim on. An advisory flock on a lock file is a real cross-worker lock on
# that topology: the OS releases it if a worker is killed, and a worker that
# cannot take it simply skips its tick — run_all_checks is idempotent, so the
# skipped work is picked up by whoever holds the lock.
#
# The honest limitation: flock is per-host, so it would not gate a second box.
# A Redis lock or a claim row is the right fix the day the platform is scaled
# horizontally; until then this closes the window that the randomised start
# offset alone left open. Two workers whose offsets happen to land within a few
# seconds of each other stay in lockstep for ever (both then sleep exactly
# NOTIFICATION_POLL_SECONDS), so "unlikely once" was in fact "unlikely, but
# permanent when it happens" — hence the per-iteration jitter below as well.
NOTIFICATION_LOCK_PATH = os.getenv(
    "NOTIFICATION_SWEEP_LOCK",
    os.path.join(tempfile.gettempdir(), "grceye_notification_sweep.lock"),
)


@contextlib.contextmanager
def _sweep_lock():
    """Yield True if this process won the sweep lock, False if a sibling holds it.

    Best effort: on a platform without fcntl, or if the lock file cannot be
    opened, the sweep proceeds unguarded rather than never running at all — the
    dedup in every check is still the correctness guarantee, the lock only
    narrows the race.
    """
    handle = None
    try:
        import fcntl
    except ImportError:  # pragma: no cover — non-POSIX
        yield True
        return
    try:
        handle = open(NOTIFICATION_LOCK_PATH, "a+")
    except OSError as exc:
        logger.warning("Notification sweep lock unavailable (%s); running unguarded", exc)
        yield True
        return
    try:
        try:
            # Non-blocking: a tick we cannot take is a tick we skip, not one we
            # queue behind a sweep that may run for minutes.
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        if handle is not None:
            handle.close()


async def start_notification_scheduler() -> None:
    """Run run_all_checks on a loop. Registered from app.main's lifespan.

    Disabled with ENABLE_NOTIFICATION_SCHEDULER=0, the same env-flag convention
    as the other schedulers — but read through _env_flag, so the flag works from
    backend/.env.local and not only from a PM2 ecosystem variable. It is also
    re-read on every tick: switching the sweep OFF then takes effect at the next
    iteration without a pm2 restart. Switching it back on still needs one, like
    every sibling scheduler.

    Concurrency: both uvicorn workers start this loop; _sweep_lock keeps only
    one of them sweeping at a time, and the per-iteration jitter stops the two
    from settling into lockstep. run_all_checks is idempotent on top of that,
    so the worst case is a wasted set of dedup queries.
    """
    import random

    # warning, not info: the root logger runs at WARNING with no handlers, so an
    # info line is discarded and a scheduler that is silently off looks exactly
    # like one that is quietly working.
    if _env_flag("ENABLE_NOTIFICATION_SCHEDULER") == "0":
        logger.warning("Notification scheduler DISABLED via ENABLE_NOTIFICATION_SCHEDULER=0")
        return

    from app.core.database import AsyncSessionLocal

    # Let the app boot, then desynchronise this worker from its sibling.
    await asyncio.sleep(90 + random.uniform(0, 600))
    logger.info("Notification scheduler started (poll every %ss)", NOTIFICATION_POLL_SECONDS)

    while True:
        try:
            if _env_flag("ENABLE_NOTIFICATION_SCHEDULER") == "0":
                logger.warning("Notification sweep skipped — ENABLE_NOTIFICATION_SCHEDULER=0")
                await asyncio.sleep(NOTIFICATION_POLL_SECONDS)
                continue
            # Acquiring the lock is a single non-blocking syscall, so it does
            # not need to leave the event loop; the sweep itself is all awaited
            # database and SMTP I/O.
            with _sweep_lock() as won:
                if won:
                    async with AsyncSessionLocal() as db:
                        results = await run_all_checks(db)
                    if results.get("total"):
                        logger.info("Notification sweep: %s", results)
                else:
                    logger.debug("Notification sweep skipped — sibling worker holds the lock")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.error("Notification sweep failed: %s", exc)
        # Re-jitter every iteration: a fixed period would keep two workers that
        # once collided colliding for the lifetime of the process.
        await asyncio.sleep(NOTIFICATION_POLL_SECONDS + random.uniform(0, 900))
