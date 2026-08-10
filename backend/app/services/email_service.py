"""Email sending service using aiosmtplib + Jinja2 templates."""
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import aiosmtplib
from jinja2 import Environment, FileSystemLoader

from app.core.config import settings

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "email"
_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)


async def send_email(
    *,
    to_email: str,
    subject: str,
    template_name: str = "notification.html",
    context: dict,
    reply_to: str | None = None,
) -> bool:
    """
    Send an HTML email using the given Jinja2 template.
    Returns True on success, False on failure (logs the error).
    """
    if not settings.SMTP_HOST:
        logger.warning("SMTP host not configured — email not sent to %s", to_email)
        logger.info("[DEV EMAIL] To: %s | Subject: %s | %s", to_email, subject, context)
        return False

    try:
        template = _jinja_env.get_template(template_name)
        html_body = template.render(
            subject=subject,
            recipient_email=to_email,
            unsubscribe_url=f"{settings.FRONTEND_URL}/settings?tab=notifications",
            **context,
        )

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to_email
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.attach(MIMEText(html_body, "html"))

        smtp_kwargs: dict = {
            "hostname": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "use_tls": settings.SMTP_PORT == 465,
            "start_tls": settings.SMTP_PORT == 587,
            # Bound the SMTP round-trip so a hung relay can't pin request
            # resources for aiosmtplib's 60s default.
            "timeout": 15,
        }
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            smtp_kwargs["username"] = settings.SMTP_USER
            smtp_kwargs["password"] = settings.SMTP_PASSWORD

        await aiosmtplib.send(msg, **smtp_kwargs)
        logger.info("Email sent to %s: %s", to_email, subject)
        return True

    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_email, exc)
        return False


# ── Typed helpers for each notification type ─────────────────────────────────

async def send_notification_email(*, to_email: str, subject: str, body: str, action_url: str | None = None) -> bool:
    """Generic notification email — used by the async notification workers."""
    context: dict = {"title": subject, "message": body}
    if action_url:
        context["action_url"] = action_url
        context["action_label"] = "Open"
    return await send_email(to_email=to_email, subject=subject, context=context)

async def send_risk_alert(*, to_email: str, risk_title: str, severity: str, org: str, risk_url: str) -> bool:
    badge_colors = {"critical": "red", "high": "orange", "medium": "yellow", "low": "gray"}
    return await send_email(
        to_email=to_email,
        subject=f"[{severity.upper()} RISK] {risk_title} — {org}",
        context={
            "badge_text": f"{severity.upper()} Risk",
            "badge_color": badge_colors.get(severity, "blue"),
            "title": f"New risk: {risk_title}",
            "message": (
                f"A new {severity} severity risk has been added to your risk register. "
                "Review and assign a treatment plan as soon as possible."
            ),
            "details": {"Risk title": risk_title, "Severity": severity.capitalize(), "Organization": org},
            "action_url": risk_url,
            "action_label": "View Risk",
        },
    )


async def send_audit_assigned(*, to_email: str, audit_name: str, due_date: str, org: str, audit_url: str) -> bool:
    return await send_email(
        to_email=to_email,
        subject=f"[ACTION REQUIRED] You have been assigned to audit: {audit_name}",
        context={
            "badge_text": "Audit Assigned",
            "badge_color": "blue",
            "title": f"You are the lead auditor for: {audit_name}",
            "message": "You have been assigned as lead auditor. Please review the scope and begin fieldwork planning.",
            "details": {"Audit": audit_name, "Due date": due_date, "Organization": org},
            "action_url": audit_url,
            "action_label": "Open Audit",
        },
    )


async def send_policy_review_due(*, to_email: str, policy_name: str, due_date: str, policy_url: str) -> bool:
    return await send_email(
        to_email=to_email,
        subject=f"[REVIEW DUE] Policy: {policy_name}",
        context={
            "badge_text": "Review Due",
            "badge_color": "orange",
            "title": f"Policy review required: {policy_name}",
            "message": "This policy is due for its scheduled review. Please review, update if necessary, and re-publish.",
            "details": {"Policy": policy_name, "Review due": due_date},
            "action_url": policy_url,
            "action_label": "Review Policy",
        },
    )


async def send_vendor_alert(*, to_email: str, vendor_name: str, risk_tier: str, message: str, vendor_url: str) -> bool:
    tier_colors = {"critical": "red", "high": "orange", "medium": "yellow", "low": "green"}
    return await send_email(
        to_email=to_email,
        subject=f"[VENDOR ALERT] {vendor_name} — Risk tier changed to {risk_tier.upper()}",
        context={
            "badge_text": f"Vendor {risk_tier.capitalize()} Risk",
            "badge_color": tier_colors.get(risk_tier, "blue"),
            "title": f"Vendor risk alert: {vendor_name}",
            "message": message,
            "details": {"Vendor": vendor_name, "Risk tier": risk_tier.capitalize()},
            "action_url": vendor_url,
            "action_label": "View Vendor",
        },
    )


async def send_compliance_score_drop(*, to_email: str, framework: str, old_score: float, new_score: float, org: str, url: str) -> bool:
    drop = round(old_score - new_score, 1)
    return await send_email(
        to_email=to_email,
        subject=f"[COMPLIANCE ALERT] Score dropped {drop}% for {framework}",
        context={
            "badge_text": "Compliance Score Drop",
            "badge_color": "red",
            "title": f"Compliance score dropped for {framework}",
            "message": (
                f"Your compliance score for {framework} dropped by {drop}% "
                f"(from {old_score}% to {new_score}%). Immediate attention may be required."
            ),
            "details": {
                "Framework": framework,
                "Previous score": f"{old_score}%",
                "Current score": f"{new_score}%",
                "Drop": f"-{drop}%",
                "Organization": org,
            },
            "action_url": url,
            "action_label": "View Compliance",
        },
    )


async def send_weekly_digest(
    *,
    to_email: str,
    org: str,
    open_risks: int,
    critical_risks: int,
    compliance_score: float,
    open_findings: int,
    policies_due: int,
    dashboard_url: str,
) -> bool:
    return await send_email(
        to_email=to_email,
        subject=f"[WEEKLY DIGEST] GRC Summary — {org}",
        context={
            "badge_text": "Weekly Digest",
            "badge_color": "gray",
            "title": f"Your weekly GRC summary for {org}",
            "message": "Here is your weekly overview of your organization's governance, risk, and compliance posture.",
            "details": {
                "Open risks": str(open_risks),
                "Critical risks": str(critical_risks),
                "Avg. compliance score": f"{compliance_score}%",
                "Open audit findings": str(open_findings),
                "Policies due for review": str(policies_due),
            },
            "action_url": dashboard_url,
            "action_label": "Go to Dashboard",
        },
    )
