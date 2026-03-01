"""
Celery tasks for sending notifications (in-app + email).

These tasks are triggered by domain events (new risk, audit assigned, etc.)
and by the periodic beat scheduler (daily policy reminders, weekly digest).
"""
import asyncio
import logging
from datetime import datetime, timezone

from celery import shared_task
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import settings
from app.models.notification import (
    Notification, NotificationPreference,
    NotificationType, NotificationChannel, NotificationStatus,
)
from app.models.user import User
from app.models.risk import Risk
from app.models.audit import Audit
from app.models.policy import Policy
from app.models.vendor import Vendor
from app.services import email_service

logger = logging.getLogger(__name__)

# ── Async DB session for tasks (Celery workers are sync) ─────────────────────

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")
_engine_kwargs: dict = {}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

_engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)
_SessionLocal = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


def _run(coro):
    """Run an async coroutine from a sync Celery task."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ── Core helper: create in-app notification + optionally send email ───────────

async def _create_notification(
    db: AsyncSession,
    *,
    user_id: str,
    tenant_id: str,
    ntype: NotificationType,
    title: str,
    message: str,
    data: dict | None = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        tenant_id=tenant_id,
        type=ntype,
        status=NotificationStatus.UNREAD,
        title=title,
        message=message,
        data=data or {},
    )
    db.add(notif)
    await db.flush()
    return notif


async def _user_wants(
    db: AsyncSession,
    user_id: str,
    ntype: NotificationType,
    channel: NotificationChannel,
) -> bool:
    """Check if user has enabled this notification type+channel. Default = True."""
    result = await db.execute(
        select(NotificationPreference).where(
            and_(
                NotificationPreference.user_id == user_id,
                NotificationPreference.notification_type == ntype,
                NotificationPreference.channel == channel,
            )
        )
    )
    pref = result.scalar_one_or_none()
    return pref.enabled if pref is not None else True  # default ON


# ── Triggered tasks (called by API endpoints on domain events) ────────────────

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def notify_risk_created(self, risk_id: str, created_by_user_id: str):
    """Send notification when a new risk is created."""
    async def _inner():
        async with _SessionLocal() as db:
            risk = await db.get(Risk, risk_id)
            if not risk:
                return
            user = await db.get(User, created_by_user_id)
            if not user:
                return

            # Notify the creator + all admins/CISOs in the tenant
            result = await db.execute(
                select(User).where(
                    and_(
                        User.tenant_id == risk.tenant_id,
                        User.is_active == True,
                        User.role.in_(["tenant_admin", "ciso", "risk_manager"]),
                    )
                )
            )
            recipients = result.scalars().all()

            title = f"New {risk.severity} risk: {risk.title}"
            message = f"A new {risk.severity} severity risk has been added to the risk register."

            for recipient in recipients:
                if recipient.id == created_by_user_id:
                    continue  # don't notify the person who created it

                # In-app
                if await _user_wants(db, recipient.id, NotificationType.RISK_NEW, NotificationChannel.IN_APP):
                    await _create_notification(
                        db, user_id=recipient.id, tenant_id=risk.tenant_id,
                        ntype=NotificationType.RISK_NEW, title=title, message=message,
                        data={"risk_id": risk_id, "severity": risk.severity, "link": f"/risks"},
                    )

                # Email
                if await _user_wants(db, recipient.id, NotificationType.RISK_NEW, NotificationChannel.EMAIL):
                    await email_service.send_risk_alert(
                        to_email=recipient.email,
                        risk_title=risk.title,
                        severity=risk.severity,
                        org=recipient.email.split("@")[-1],
                        risk_url=f"{settings.FRONTEND_URL}/risks",
                    )

            await db.commit()
    try:
        _run(_inner())
    except Exception as exc:
        logger.error("notify_risk_created failed: %s", exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def notify_audit_assigned(self, audit_id: str, assignee_user_id: str):
    """Notify a user they have been assigned as lead auditor."""
    async def _inner():
        async with _SessionLocal() as db:
            audit = await db.get(Audit, audit_id)
            if not audit:
                return
            user = await db.get(User, assignee_user_id)
            if not user:
                return

            title = f"Audit assigned: {audit.title}"
            message = f"You have been assigned as lead auditor for '{audit.title}'."
            due = audit.planned_end_date.strftime("%B %d, %Y") if audit.planned_end_date else "TBD"

            if await _user_wants(db, user.id, NotificationType.AUDIT_ASSIGNED, NotificationChannel.IN_APP):
                await _create_notification(
                    db, user_id=user.id, tenant_id=audit.tenant_id,
                    ntype=NotificationType.AUDIT_ASSIGNED, title=title, message=message,
                    data={"audit_id": audit_id, "link": f"/audits"},
                )

            if await _user_wants(db, user.id, NotificationType.AUDIT_ASSIGNED, NotificationChannel.EMAIL):
                await email_service.send_audit_assigned(
                    to_email=user.email,
                    audit_name=audit.title,
                    due_date=due,
                    org=user.email.split("@")[-1],
                    audit_url=f"{settings.FRONTEND_URL}/audits",
                )

            await db.commit()
    try:
        _run(_inner())
    except Exception as exc:
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def notify_compliance_score_drop(
    self,
    tenant_id: str,
    framework_name: str,
    old_score: float,
    new_score: float,
    assessment_id: str,
):
    """Notify CISO/admins when a compliance score drops by more than 5%."""
    if old_score - new_score < 5:
        return

    async def _inner():
        async with _SessionLocal() as db:
            result = await db.execute(
                select(User).where(
                    and_(
                        User.tenant_id == tenant_id,
                        User.is_active == True,
                        User.role.in_(["tenant_admin", "ciso", "compliance_manager"]),
                    )
                )
            )
            recipients = result.scalars().all()
            drop = round(old_score - new_score, 1)
            title = f"Compliance score dropped {drop}% — {framework_name}"
            message = f"Your compliance score for {framework_name} dropped from {old_score}% to {new_score}%."

            for user in recipients:
                ntype = NotificationType.COMPLIANCE_SCORE_DROP
                if await _user_wants(db, user.id, ntype, NotificationChannel.IN_APP):
                    await _create_notification(
                        db, user_id=user.id, tenant_id=tenant_id,
                        ntype=ntype, title=title, message=message,
                        data={"assessment_id": assessment_id, "drop": drop, "link": f"/compliance/{assessment_id}"},
                    )
                if await _user_wants(db, user.id, ntype, NotificationChannel.EMAIL):
                    await email_service.send_compliance_score_drop(
                        to_email=user.email,
                        framework=framework_name,
                        old_score=old_score,
                        new_score=new_score,
                        org=user.email.split("@")[-1],
                        url=f"{settings.FRONTEND_URL}/compliance/{assessment_id}",
                    )

            await db.commit()
    try:
        _run(_inner())
    except Exception as exc:
        raise self.retry(exc=exc)


# ── Periodic tasks (Celery beat) ──────────────────────────────────────────────

@shared_task
def send_policy_review_reminders():
    """Daily: notify users about policies due for review in the next 7 days."""
    from datetime import timedelta

    async def _inner():
        async with _SessionLocal() as db:
            now = datetime.now(timezone.utc)
            window_end = now + timedelta(days=7)

            result = await db.execute(
                select(Policy).where(
                    and_(
                        Policy.next_review_date != None,
                        Policy.next_review_date <= window_end,
                        Policy.status.in_(["published", "approved"]),
                    )
                )
            )
            policies = result.scalars().all()

            for policy in policies:
                # Get owners and admins in the tenant
                owners_result = await db.execute(
                    select(User).where(
                        and_(
                            User.tenant_id == policy.tenant_id,
                            User.is_active == True,
                            User.role.in_(["tenant_admin", "ciso", "policy_manager"]),
                        )
                    )
                )
                recipients = owners_result.scalars().all()
                due_str = policy.next_review_date.strftime("%B %d, %Y")
                title = f"Policy review due: {policy.title}"
                message = f"The policy '{policy.title}' is due for review on {due_str}."

                for user in recipients:
                    ntype = NotificationType.POLICY_REVIEW_DUE
                    if await _user_wants(db, user.id, ntype, NotificationChannel.IN_APP):
                        # Check if we already sent this notification today
                        existing = await db.execute(
                            select(Notification).where(
                                and_(
                                    Notification.user_id == user.id,
                                    Notification.type == ntype,
                                    Notification.data["policy_id"].as_string() == policy.id,
                                    Notification.created_at >= now.replace(hour=0, minute=0, second=0),
                                )
                            )
                        )
                        if existing.scalar_one_or_none():
                            continue

                        await _create_notification(
                            db, user_id=user.id, tenant_id=policy.tenant_id,
                            ntype=ntype, title=title, message=message,
                            data={"policy_id": policy.id, "due_date": due_str, "link": "/policies"},
                        )

                    if await _user_wants(db, user.id, ntype, NotificationChannel.EMAIL):
                        await email_service.send_policy_review_due(
                            to_email=user.email,
                            policy_name=policy.title,
                            due_date=due_str,
                            policy_url=f"{settings.FRONTEND_URL}/policies",
                        )

            await db.commit()
            logger.info("Policy review reminders sent for %d policies", len(policies))
    _run(_inner())


@shared_task
def send_weekly_digest():
    """Weekly: send a GRC summary email to all active admins/CISOs."""
    async def _inner():
        from sqlalchemy import func as sqlfunc
        from app.models.risk import Risk
        from app.models.audit import AuditFinding

        async with _SessionLocal() as db:
            # Get all active tenants via their admin users
            admins_result = await db.execute(
                select(User).where(
                    and_(
                        User.is_active == True,
                        User.role.in_(["tenant_admin", "ciso"]),
                    )
                )
            )
            admins = admins_result.scalars().all()

            for admin in admins:
                ntype = NotificationType.WEEKLY_DIGEST
                if not await _user_wants(db, admin.id, ntype, NotificationChannel.EMAIL):
                    continue

                # Gather stats for this tenant
                risks_result = await db.execute(
                    select(sqlfunc.count(Risk.id)).where(
                        and_(Risk.tenant_id == admin.tenant_id, Risk.status == "open")
                    )
                )
                open_risks = risks_result.scalar() or 0

                crit_result = await db.execute(
                    select(sqlfunc.count(Risk.id)).where(
                        and_(Risk.tenant_id == admin.tenant_id, Risk.status == "open", Risk.severity == "critical")
                    )
                )
                critical_risks = crit_result.scalar() or 0

                findings_result = await db.execute(
                    select(sqlfunc.count(AuditFinding.id)).where(AuditFinding.status == "open")
                )
                open_findings = findings_result.scalar() or 0

                now = datetime.now(timezone.utc)
                from datetime import timedelta
                window_end = now + timedelta(days=14)
                policies_result = await db.execute(
                    select(sqlfunc.count(Policy.id)).where(
                        and_(
                            Policy.tenant_id == admin.tenant_id,
                            Policy.next_review_date != None,
                            Policy.next_review_date <= window_end,
                        )
                    )
                )
                policies_due = policies_result.scalar() or 0

                # Create in-app weekly digest notification
                if await _user_wants(db, admin.id, ntype, NotificationChannel.IN_APP):
                    await _create_notification(
                        db, user_id=admin.id, tenant_id=admin.tenant_id,
                        ntype=ntype,
                        title="Weekly GRC Digest",
                        message=f"This week: {open_risks} open risks, {open_findings} audit findings, {policies_due} policies due for review.",
                        data={"open_risks": open_risks, "open_findings": open_findings, "link": "/dashboard"},
                    )

                await email_service.send_weekly_digest(
                    to_email=admin.email,
                    org=admin.email.split("@")[-1],
                    open_risks=open_risks,
                    critical_risks=critical_risks,
                    compliance_score=0.0,
                    open_findings=open_findings,
                    policies_due=policies_due,
                    dashboard_url=f"{settings.FRONTEND_URL}/dashboard",
                )

            await db.commit()
            logger.info("Weekly digest sent to %d admins/CISOs", len(admins))
    _run(_inner())
