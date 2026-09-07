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
"""
import json
from datetime import date, datetime, timedelta
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationType, NotificationStatus
from app.models.user import User, UserRole
from app.models.risk import Risk, RiskTreatment
from app.models.vendor import Vendor, VendorContract, ContractValidationStatus
from app.models.compliance import ComplianceGap
from app.models.contract_collaboration import ContractCollaboration
from app.models.action_item import ActionItem, ActionItemStatus
from app.models.asset import Asset
from app.models.applied_control import AppliedControl
from app.models.login_event import LoginEvent
from app.models.risk_scenario import RiskScenario
from app.models.audit import Audit, AuditFinding, FindingStatus


async def get_recipients_for_tenant(db: AsyncSession, tenant_id: str) -> list[User]:
    """Get users who should receive CISO-type notifications (CISO, admin roles).
    Roles are stored as uppercase enum names in the DB (e.g. 'CISO', 'RISK_MANAGER').
    """
    from sqlalchemy import or_
    from sqlalchemy import String, cast
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            or_(
                cast(User.role, String).in_(["CISO", "RISK_MANAGER", "COMPLIANCE_MANAGER"]),
                User.role.in_([UserRole.CISO, UserRole.RISK_MANAGER, UserRole.COMPLIANCE_MANAGER]),
            )
        )
    )
    return list(result.scalars().all())


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
) -> Notification:
    """Create a single notification."""
    data = {}
    if entity_id:
        data["entity_id"] = entity_id
    if entity_type:
        data["entity_type"] = entity_type
    if link:
        data["link"] = link
    data["severity"] = severity

    notif = Notification(
        tenant_id=user.tenant_id,
        user_id=user.id,
        type=notif_type,
        status=NotificationStatus.UNREAD,
        title=title,
        message=message,
        data=data,
    )
    db.add(notif)
    return notif


async def check_vendor_contract_expiry(db: AsyncSession) -> int:
    """Check for vendor contracts expiring soon and create notifications."""
    created = 0
    today = datetime.utcnow().date()

    # Get all active vendors
    result = await db.execute(
        select(Vendor).where(Vendor.contract_expiry.isnot(None))
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
        if days_remaining < 0:
            # Already expired
            severity = "critical"
            title = f"Contract EXPIRED: {vendor.name}"
            message = f"The contract with {vendor.name} expired {abs(days_remaining)} days ago. Immediate action required."
        elif days_remaining == 0:
            severity = "critical"
            title = f"Contract expires TODAY: {vendor.name}"
            message = f"The contract with {vendor.name} expires today!"
        elif days_remaining <= 7:
            severity = "high"
            title = f"Contract expiring in {days_remaining} days: {vendor.name}"
            message = f"The contract with {vendor.name} will expire in {days_remaining} days. Renewal needed."
        elif days_remaining <= 30:
            severity = "medium"
            title = f"Contract expiring in {days_remaining} days: {vendor.name}"
            message = f"The contract with {vendor.name} expires in {days_remaining} days. Start renewal process."
        else:
            severity = "info"
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
                )
                created += 1

    return created


async def check_risk_review_deadlines(db: AsyncSession) -> int:
    """Check for risks needing review and create notifications."""
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        select(Risk).where(Risk.next_review_date.isnot(None))
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
            title = f"Risk review OVERDUE: {risk.title[:50]}"
            message = f"Risk '{risk.title}' review is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            title = f"Risk review due TODAY: {risk.title[:50]}"
            message = f"Risk '{risk.title}' needs to be reviewed today."
        elif days_remaining <= 7:
            severity = "medium"
            title = f"Risk review due in {days_remaining} days"
            message = f"Risk '{risk.title}' needs review within {days_remaining} days."
        else:
            severity = "info"
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
                )
                created += 1

    return created


async def check_risk_appetite_breaches(db: AsyncSession) -> int:
    """Alert when a risk's residual/inherent score exceeds its appetite threshold (Elite)."""
    created = 0
    result = await db.execute(select(Risk).where(Risk.appetite_threshold.isnot(None)))
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
                )
                created += 1
    return created


async def check_treatment_overdue(db: AsyncSession) -> int:
    """RFP gap fix: alert when a risk treatment plan's due_date has passed and it
    isn't complete yet (progress_percentage < 100). RiskTreatment has no tenant_id
    column of its own, so join through its Risk to scope recipients/links."""
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        select(RiskTreatment, Risk)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(RiskTreatment.due_date.isnot(None))
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
        if treatment.owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == treatment.owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
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
                )
                created += 1

    return created


async def check_treatment_budget_overrun(db: AsyncSession) -> int:
    """RFP gap fix: alert when a risk treatment plan's actual_cost exceeds its
    estimated_cost. Only fires once actual_cost has actually been recorded — an
    unset actual_cost means spend simply isn't tracked yet, not that it's zero."""
    created = 0

    result = await db.execute(
        select(RiskTreatment, Risk)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(
            RiskTreatment.actual_cost.isnot(None),
            RiskTreatment.estimated_cost.isnot(None),
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
        if treatment.owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == treatment.owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
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
                )
                created += 1

    return created


async def check_pending_ciso_contracts(db: AsyncSession) -> int:
    """Notify CISO about contracts waiting for their review."""
    created = 0

    # Find contracts waiting for CISO review
    result = await db.execute(
        select(VendorContract)
        .join(Vendor, VendorContract.vendor_id == Vendor.id)
        .where(
            VendorContract.validation_status.in_([
                ContractValidationStatus.AI_REVIEWED.value,
                ContractValidationStatus.PENDING_CISO.value,
            ])
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
            # If no CISO, notify admins
            cisos = [u for u in recipients if u.role == UserRole.CISO]

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
                )
                created += 1

    return created


async def check_compliance_gaps(db: AsyncSession) -> int:
    """Notify about compliance gaps that need attention."""
    created = 0

    # Find open compliance gaps with high severity
    result = await db.execute(
        select(ComplianceGap).where(ComplianceGap.severity.in_(["critical", "high"]))
    )
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
                )
                created += 1

    return created


async def check_action_plan_deadlines(db: AsyncSession) -> int:
    """Notify CISO when action plan items are within 10 days of deadline and not yet done."""
    created = 0
    today = datetime.utcnow().date()

    # Only check active collaborations that have a finalized plan
    result = await db.execute(
        select(ContractCollaboration).where(
            ContractCollaboration.status == "active",
            ContractCollaboration.plan_finalized_at.isnot(None),
            ContractCollaboration.action_plan.isnot(None),
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
                title = f"Action plan item OVERDUE: {collab.vendor_name}"
                message = (
                    f"Item '{action_text}' was due {abs(days_remaining)} day(s) ago "
                    f"and is still incomplete. Check with {collab.vendor_name}."
                )
            elif days_remaining == 0:
                severity = "high"
                title = f"Action plan item due TODAY: {collab.vendor_name}"
                message = f"Item '{action_text}' is due today. Verify with {collab.vendor_name}."
            else:
                severity = "high"
                title = f"Action plan deadline in {days_remaining} day(s): {collab.vendor_name}"
                message = (
                    f"Item '{action_text}' deadline is in {days_remaining} day(s). "
                    f"Follow up with {collab.vendor_name} to confirm progress."
                )

            recipients = await get_recipients_for_tenant(db, collab.tenant_id)
            # Only notify CISO / admins
            cisos = [u for u in recipients if u.role in (UserRole.CISO, UserRole.CISO)]
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
                    )
                    created += 1

    return created


async def check_compliance_action_deadlines(db: AsyncSession) -> int:
    """Notify the owner + CISO/admins when a compliance ActionItem (remediation task
    created from a gap recommendation) is within 7 days of its due date or overdue.
    """
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        select(ActionItem).where(
            ActionItem.due_date.isnot(None),
            ActionItem.status.notin_([ActionItemStatus.COMPLETED, ActionItemStatus.CANCELLED]),
        )
    )
    items = result.scalars().all()

    for item in items:
        try:
            due = datetime.fromisoformat(item.due_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (due - today).days
        # Trigger within 7 days, and if overdue (cap at 30 days overdue like the other checks)
        if days_remaining > 7 or days_remaining < -30:
            continue

        if days_remaining < 0:
            severity = "critical"
            title = f"Action item OVERDUE: {item.title[:50]}"
            message = f"Action item '{item.title}' is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            title = f"Action item due TODAY: {item.title[:50]}"
            message = f"Action item '{item.title}' is due today."
        else:
            severity = "medium"
            title = f"Action item due in {days_remaining} days: {item.title[:50]}"
            message = f"Action item '{item.title}' needs to be completed within {days_remaining} day(s)."

        recipients: dict[str, User] = {}
        if item.owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == item.owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
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
                )
                created += 1

    return created


async def check_asset_eol(db: AsyncSession) -> int:
    """Notify the asset owner + CISO/admins about assets reaching end-of-life.
    Mirrors the criteria used by GET /assets/lifecycle/eol-soon (default within_days=90).
    """
    created = 0
    now = datetime.utcnow()
    cutoff = now + timedelta(days=90)

    result = await db.execute(
        select(Asset).where(
            Asset.end_of_life_at.isnot(None),
            Asset.end_of_life_at <= cutoff,
        )
    )
    assets = result.scalars().all()

    for asset in assets:
        days_remaining = (asset.end_of_life_at - now).days

        if days_remaining < 0:
            severity = "critical"
            title = f"Asset past end-of-life: {asset.name[:50]}"
            message = f"Asset '{asset.name}' reached end-of-life {abs(days_remaining)} days ago and should be retired or replaced."
        elif days_remaining <= 30:
            severity = "high"
            title = f"Asset end-of-life in {days_remaining} days: {asset.name[:50]}"
            message = f"Asset '{asset.name}' reaches end-of-life in {days_remaining} days. Plan replacement/retirement."
        else:
            severity = "medium"
            title = f"Asset end-of-life approaching: {asset.name[:50]}"
            message = f"Asset '{asset.name}' reaches end-of-life in {days_remaining} days ({asset.end_of_life_at.date().isoformat()})."

        recipients: dict[str, User] = {}
        if asset.owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == asset.owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
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
                )
                created += 1

    return created


async def check_threat_profile_reviews(db: AsyncSession) -> int:
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
        select(Threat).where(
            Threat.tenant_id.isnot(None),
            Threat.is_pending == False,  # noqa: E712
            Threat.next_review_due.isnot(None),
            Threat.next_review_due <= horizon,
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
        if days < 0:
            severity, when = "high", f"was due {abs(days)} day(s) ago"
        elif days == 0:
            severity, when = "high", "is due today"
        else:
            severity, when = "medium", f"is due in {days} day(s)"

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
            )
            created += 1

    return created


async def check_asset_review_deadlines(db: AsyncSession) -> int:
    """RFP gap fix: mandatory periodic asset review reminders. Mirrors
    check_risk_review_deadlines's day-window logic exactly (14/7/0 days, capped at
    30 days overdue) applied to Asset.next_review_date instead of Risk.next_review_date."""
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        select(Asset).where(Asset.next_review_date.isnot(None))
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
            title = f"Asset review OVERDUE: {asset.name[:50]}"
            message = f"Asset '{asset.name}' review is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            title = f"Asset review due TODAY: {asset.name[:50]}"
            message = f"Asset '{asset.name}' needs to be reviewed today."
        elif days_remaining <= 7:
            severity = "medium"
            title = f"Asset review due in {days_remaining} days"
            message = f"Asset '{asset.name}' needs review within {days_remaining} days."
        else:
            severity = "info"
            title = f"Upcoming asset review in {days_remaining} days"
            message = f"Asset '{asset.name}' scheduled for review in {days_remaining} days."

        recipients: dict[str, User] = {}
        if asset.owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == asset.owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
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
                )
                created += 1

    return created


async def check_unverified_controls(db: AsyncSession) -> int:
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
        select(AppliedControl).where(
            AppliedControl.status.in_(("active", "in_progress")),
            AppliedControl.validation_status != "validated",
            AppliedControl.created_at <= grace,
        )
    )).scalars().all()

    for control in controls:
        state = (control.validation_status.value
                 if hasattr(control.validation_status, "value")
                 else str(control.validation_status or "pending"))
        rejected = state == "rejected"

        recipients = {u.id: u for u in await get_recipients_for_tenant(db, control.tenant_id)}
        if control.owner_id and control.owner_id not in recipients:
            owner = (await db.execute(
                select(User).where(User.id == control.owner_id, User.is_active == True)  # noqa: E712
            )).scalar_one_or_none()
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
            )
            created += 1

    return created


async def check_control_evaluations_due(db: AsyncSession) -> int:
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
        select(ControlEvaluation)
        .where(ControlEvaluation.next_evaluation_at.isnot(None),
               ControlEvaluation.next_evaluation_at <= horizon)
        .order_by(ControlEvaluation.evaluated_at.desc().nullslast())
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
        elif days == 0:
            severity, when = "high", "is due today"
        else:
            severity, when = "medium", f"is due in {days} day(s)"

        control = (await db.execute(
            select(AppliedControl).where(AppliedControl.id == ev.applied_control_id)
        )).scalar_one_or_none()
        if control is None:
            # An evaluation left behind by a control deleted before this was
            # cleaned up. Nothing to remind anyone about.
            continue

        recipients = {u.id: u for u in await get_recipients_for_tenant(db, ev.tenant_id)}
        if control.owner_id and control.owner_id not in recipients:
            owner = (await db.execute(
                select(User).where(User.id == control.owner_id, User.is_active == True)  # noqa: E712
            )).scalar_one_or_none()
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
            )
            created += 1

    return created


async def check_scenario_priority_alerts(db: AsyncSession) -> int:
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
    tenants = (await db.execute(select(Tenant).where(Tenant.is_active == True))).scalars().all()  # noqa: E712
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
                owner = (await db.execute(
                    select(User).where(User.id == sc.owner_id, User.is_active == True)  # noqa: E712
                )).scalar_one_or_none()
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
                )
                created += 1

    return created


async def check_scenario_review_deadlines(db: AsyncSession) -> int:
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
        select(RiskScenario).where(RiskScenario.next_review_date.isnot(None))
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
            title = f"Scenario review OVERDUE: {scenario.name[:50]}"
            message = f"Risk scenario '{scenario.name}' review is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            title = f"Scenario review due TODAY: {scenario.name[:50]}"
            message = f"Risk scenario '{scenario.name}' needs to be reviewed today."
        elif days_remaining <= 7:
            severity = "medium"
            title = f"Scenario review due in {days_remaining} days"
            message = f"Risk scenario '{scenario.name}' needs review within {days_remaining} days."
        else:
            severity = "info"
            title = f"Upcoming scenario review in {days_remaining} days"
            message = f"Risk scenario '{scenario.name}' scheduled for review in {days_remaining} days."

        recipients: dict[str, User] = {}
        if scenario.owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == scenario.owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
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
                )
                created += 1

    return created


async def check_control_expiration(db: AsyncSession) -> int:
    """Notify the control owner + CISO/admins about AppliedControl rows nearing or past
    their expiration date (30-day warning window, matching the vendor/risk check style).
    """
    created = 0
    today = datetime.utcnow().date()

    result = await db.execute(
        select(AppliedControl).where(AppliedControl.expiration.isnot(None))
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
            title = f"Control EXPIRED: {control.name[:50]}"
            message = f"Applied control '{control.name}' expired {abs(days_remaining)} days ago and needs renewal."
        elif days_remaining == 0:
            severity = "high"
            title = f"Control expires TODAY: {control.name[:50]}"
            message = f"Applied control '{control.name}' expires today."
        else:
            severity = "medium"
            title = f"Control expiring in {days_remaining} days: {control.name[:50]}"
            message = f"Applied control '{control.name}' expires in {days_remaining} days. Plan renewal."

        recipients: dict[str, User] = {}
        if control.owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == control.owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
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
        )

    return True


async def check_finding_deadlines(db: AsyncSession) -> int:
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
        select(AuditFinding, Audit)
        .join(Audit, Audit.id == AuditFinding.audit_id)
        .where(
            AuditFinding.due_date.isnot(None),
            AuditFinding.due_date != "",
            AuditFinding.status.in_([FindingStatus.OPEN, FindingStatus.IN_REMEDIATION]),
        )
    )

    for finding, audit in result.all():
        try:
            due = datetime.fromisoformat(finding.due_date).date()
        except (ValueError, TypeError):
            continue

        days_remaining = (due - today).days
        # Trigger within 7 days, and if overdue (cap at 30 days overdue like the other checks)
        if days_remaining > 7 or days_remaining < -30:
            continue

        if days_remaining < 0:
            severity = "critical"
            title = f"Recommendation OVERDUE: {finding.title[:50]}"
            message = f"The recommendation '{finding.title}' from audit '{audit.title}' is overdue by {abs(days_remaining)} days."
        elif days_remaining == 0:
            severity = "high"
            title = f"Recommendation due TODAY: {finding.title[:50]}"
            message = f"The recommendation '{finding.title}' from audit '{audit.title}' is due today."
        else:
            severity = "medium"
            title = f"Recommendation due in {days_remaining} days: {finding.title[:50]}"
            message = f"The recommendation '{finding.title}' from audit '{audit.title}' needs to be addressed within {days_remaining} day(s)."

        recipients: dict[str, User] = {}
        if finding.remediation_owner_id:
            owner_result = await db.execute(
                select(User).where(User.id == finding.remediation_owner_id, User.is_active == True)  # noqa: E712
            )
            owner = owner_result.scalar_one_or_none()
            if owner:
                recipients[owner.id] = owner
        for user in await get_recipients_for_tenant(db, audit.tenant_id):
            recipients[user.id] = user

        for user in recipients.values():
            if not await notification_exists(db, user.id, NotificationType.AUDIT_FINDING_DEADLINE, finding.id, within_days=3):
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
                )
                created += 1

    return created


async def run_all_checks(db: AsyncSession) -> dict:
    """Run all notification checks and return a summary."""
    results = {
        "vendor_contracts": 0,
        "risk_reviews": 0,
        "risk_appetite": 0,
        "ciso_contracts": 0,
        "compliance_gaps": 0,
        "action_plan_deadlines": 0,
        "compliance_action_deadlines": 0,
        "asset_eol": 0,
        "control_expiration": 0,
        "treatment_overdue": 0,
        "treatment_budget_overrun": 0,
        "asset_review_deadlines": 0,
        "scenario_review_deadlines": 0,
        "finding_deadlines": 0,
    }

    try:
        results["vendor_contracts"] = await check_vendor_contract_expiry(db)
    except Exception as e:
        print(f"Vendor contract check failed: {e}")

    try:
        results["risk_reviews"] = await check_risk_review_deadlines(db)
    except Exception as e:
        print(f"Risk review check failed: {e}")

    try:
        results["risk_appetite"] = await check_risk_appetite_breaches(db)
    except Exception as e:
        print(f"Risk appetite check failed: {e}")

    try:
        results["ciso_contracts"] = await check_pending_ciso_contracts(db)
    except Exception as e:
        print(f"CISO contracts check failed: {e}")

    try:
        results["compliance_gaps"] = await check_compliance_gaps(db)
    except Exception as e:
        print(f"Compliance gaps check failed: {e}")

    try:
        results["action_plan_deadlines"] = await check_action_plan_deadlines(db)
    except Exception as e:
        print(f"Action plan deadline check failed: {e}")

    try:
        results["compliance_action_deadlines"] = await check_compliance_action_deadlines(db)
    except Exception as e:
        print(f"Compliance action deadline check failed: {e}")

    try:
        results["asset_eol"] = await check_asset_eol(db)
        results["threat_profile_review_due"] = await check_threat_profile_reviews(db)
        results["scenario_priority_alert"] = await check_scenario_priority_alerts(db)
        results["control_evaluation_due"] = await check_control_evaluations_due(db)
        results["control_unverified"] = await check_unverified_controls(db)
    except Exception as e:
        print(f"Asset EOL check failed: {e}")

    try:
        results["control_expiration"] = await check_control_expiration(db)
    except Exception as e:
        print(f"Control expiration check failed: {e}")

    try:
        results["treatment_overdue"] = await check_treatment_overdue(db)
    except Exception as e:
        print(f"Treatment overdue check failed: {e}")

    try:
        results["treatment_budget_overrun"] = await check_treatment_budget_overrun(db)
    except Exception as e:
        print(f"Treatment budget overrun check failed: {e}")

    try:
        results["asset_review_deadlines"] = await check_asset_review_deadlines(db)
    except Exception as e:
        print(f"Asset review deadline check failed: {e}")

    try:
        results["scenario_review_deadlines"] = await check_scenario_review_deadlines(db)
    except Exception as e:
        print(f"Scenario review deadline check failed: {e}")

    try:
        results["finding_deadlines"] = await check_finding_deadlines(db)
    except Exception as e:
        print(f"Finding deadline check failed: {e}")

    await db.commit()
    results["total"] = sum(results.values())
    return results
