"""
Notification Generator Service — scans the database for events that need
CISO/admin attention and creates in-app notifications.

Handles:
- Risk review deadlines (next_review_date approaching or passed)
- Vendor contract expiry (30/60/90 day warnings)
- Compliance gaps and control issues
- Contract pending CISO review
- Action plan item deadlines within 10 days (collaboration)
"""
import json
from datetime import datetime, timedelta
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationType, NotificationStatus
from app.models.user import User, UserRole
from app.models.risk import Risk
from app.models.vendor import Vendor, VendorContract, ContractValidationStatus
from app.models.compliance import ComplianceGap
from app.models.contract_collaboration import ContractCollaboration


async def get_recipients_for_tenant(db: AsyncSession, tenant_id: str) -> list[User]:
    """Get users who should receive CISO-type notifications (CISO, admin roles).
    Roles are stored as uppercase enum names in the DB (e.g. 'CISO', 'TENANT_ADMIN').
    """
    from sqlalchemy import or_
    from sqlalchemy import String, cast
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            or_(
                cast(User.role, String).in_(["CISO", "TENANT_ADMIN", "RISK_MANAGER", "COMPLIANCE_MANAGER"]),
                User.role.in_([UserRole.CISO, UserRole.TENANT_ADMIN, UserRole.RISK_MANAGER, UserRole.COMPLIANCE_MANAGER]),
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
                    )
                    created += 1

    return created


async def run_all_checks(db: AsyncSession) -> dict:
    """Run all notification checks and return a summary."""
    results = {
        "vendor_contracts": 0,
        "risk_reviews": 0,
        "ciso_contracts": 0,
        "compliance_gaps": 0,
        "action_plan_deadlines": 0,
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

    await db.commit()
    results["total"] = sum(results.values())
    return results
