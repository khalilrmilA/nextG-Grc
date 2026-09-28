"""Email sending service using aiosmtplib + Jinja2 templates."""
import html
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


# ── Language ─────────────────────────────────────────────────────────────────
# Every e-mail is written in the RECIPIENT's language (en/fr/ar). Callers resolve
# it — services/user_language.recipient_language: the user's last-seen UI
# language, else the tenant's locale, else English — and pass `lang`. This
# module owns the wording it adds itself: the template chrome (header strapline,
# footer, default button) and the typed helpers below. Arabic mail is laid out
# right-to-left (dir="rtl" on <html> and on the card, for clients that drop
# <html> attributes).
EMAIL_LANGS = ("en", "fr", "ar")

_CHROME: dict[str, dict[str, str]] = {
    "en": {
        "strapline": "Governance, Risk & Compliance",
        "sent_to_before": "This notification was sent to",
        "sent_to_after": "because you have alerts enabled.",
        "manage": "Manage notification preferences",
        "default_cta": "View in GRC Platform",
        "report_default_body": "Please find the attached report.",
    },
    "fr": {
        "strapline": "Gouvernance, Risques & Conformité",
        "sent_to_before": "Cette notification a été envoyée à",
        "sent_to_after": "car vos alertes sont activées.",
        "manage": "Gérer les préférences de notification",
        "default_cta": "Ouvrir dans la plateforme GRC",
        "report_default_body": "Veuillez trouver le rapport en pièce jointe.",
    },
    "ar": {
        "strapline": "الحوكمة والمخاطر والامتثال",
        "sent_to_before": "تم إرسال هذا الإشعار إلى",
        "sent_to_after": "لأن التنبيهات مفعّلة في حسابكم.",
        "manage": "إدارة تفضيلات الإشعارات",
        "default_cta": "العرض في منصة GRC",
        "report_default_body": "تجدون التقرير مرفقاً بهذه الرسالة.",
    },
}


def _lang(lang: str | None) -> str:
    code = (lang or "en").strip().lower()[:2]
    return code if code in EMAIL_LANGS else "en"


def _chrome(lang: str | None) -> dict[str, str]:
    return _CHROME[_lang(lang)]


def _header_safe(value: str) -> str:
    """Fold a header value onto one line.

    A subject carrying a newline — a risk or policy title pasted out of a
    document — makes Python's email library refuse the whole message as an
    embedded-header attempt, and the except below turns that refusal into an
    e-mail that is silently never sent while the in-app notification lands.
    """
    return " ".join(str(value or "").replace("\r", "\n").split("\n")).strip()


def render_email_html(template_name: str, *, subject: str, to_email: str, context: dict,
                      lang: str = "en") -> str:
    """The HTML body exactly as send_email would send it (also used by the self-test)."""
    code = _lang(lang)
    template = _jinja_env.get_template(template_name)
    merged = {
        "subject": subject,
        "recipient_email": to_email,
        "unsubscribe_url": f"{settings.FRONTEND_URL}/settings?tab=notifications",
        "lang": code,
        "dir": "rtl" if code == "ar" else "ltr",
        "L": _CHROME[code],
    }
    merged.update(context)
    return template.render(**merged)


async def send_email(
    *,
    to_email: str,
    subject: str,
    template_name: str = "notification.html",
    context: dict,
    reply_to: str | None = None,
    lang: str = "en",
) -> bool:
    """
    Send an HTML email using the given Jinja2 template.
    Returns True on success, False on failure (logs the error).

    ``lang`` (en|fr|ar) localises the template chrome and sets the document
    direction; the subject and context strings are the caller's, already
    written in that language.
    """
    if not settings.SMTP_HOST:
        logger.warning("SMTP host not configured — email not sent to %s", to_email)
        logger.info("[DEV EMAIL] To: %s | Subject: %s | %s", to_email, subject, context)
        return False

    try:
        html_body = render_email_html(template_name, subject=subject, to_email=to_email,
                                      context=context, lang=lang)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = _header_safe(subject)
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to_email
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.attach(MIMEText(html_body, "html", "utf-8"))

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


async def send_report_email(
    *,
    to_email: str,
    subject: str,
    pdf_bytes: bytes,
    filename: str,
    body_text: str | None = None,
    lang: str = "en",
) -> bool:
    """Send an email with a PDF attachment (used by scheduled reports).

    Returns True on success, False on failure (logs the error). Falls back to a
    [DEV EMAIL] log line when SMTP is not configured — never raises.

    ``body_text`` is PLAIN text and is escaped before it is placed in the HTML
    part. The covering text names the report, and a report name is an audit
    title a tenant user typed — unlike :func:`send_email`, which renders through
    an autoescaping Jinja environment, this function builds its markup by hand,
    so an engagement titled ``<img src=x onerror=…>`` used to reach an external
    recipient's mail client as live markup.
    """
    if not settings.SMTP_HOST:
        logger.warning("SMTP host not configured — report email not sent to %s", to_email)
        logger.info("[DEV EMAIL] Report to: %s | Subject: %s | %s (%d bytes)", to_email, subject, filename, len(pdf_bytes or b""))
        return False

    try:
        from email.mime.application import MIMEApplication

        msg = MIMEMultipart("mixed")
        msg["Subject"] = _header_safe(subject)
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to_email
        code = _lang(lang)
        text = body_text if body_text is not None else _CHROME[code]["report_default_body"]
        direction = "rtl" if code == "ar" else "ltr"
        align = "right" if code == "ar" else "left"
        msg.attach(MIMEText(
            f'<html lang="{code}" dir="{direction}"><body dir="{direction}" '
            f'style="direction:{direction};text-align:{align}">'
            f"<p>{html.escape(str(text or ''))}</p></body></html>",
            "html", "utf-8",
        ))

        part = MIMEApplication(pdf_bytes, _subtype="pdf")
        part.add_header("Content-Disposition", "attachment", filename=_header_safe(filename))
        msg.attach(part)

        smtp_kwargs: dict = {
            "hostname": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "use_tls": settings.SMTP_PORT == 465,
            "start_tls": settings.SMTP_PORT == 587,
            "timeout": 30,
        }
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            smtp_kwargs["username"] = settings.SMTP_USER
            smtp_kwargs["password"] = settings.SMTP_PASSWORD

        await aiosmtplib.send(msg, **smtp_kwargs)
        logger.info("Report email sent to %s: %s", to_email, subject)
        return True

    except Exception as exc:
        logger.error("Failed to send report email to %s: %s", to_email, exc)
        return False


# ── Typed helpers for each notification type ─────────────────────────────────
# Each helper writes its own subject/title/body/details/button in `lang`.
# Values inside them (a risk title, an organisation, a framework name) are the
# tenant's data and are never translated; severity/tier words are platform
# vocabulary and are.

_OPEN_LABEL = {"en": "Open", "fr": "Ouvrir", "ar": "فتح"}

_SEVERITY_WORD = {
    "en": {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"},
    "fr": {"critical": "Critique", "high": "Élevé", "medium": "Moyen", "low": "Faible"},
    "ar": {"critical": "حرج", "high": "مرتفع", "medium": "متوسط", "low": "منخفض"},
}

_T: dict[str, dict[str, str]] = {
    "en": {
        "risk_subject": "[{sev_upper} RISK] {risk} — {org}",
        "risk_badge": "{sev} Risk",
        "risk_title": "New risk: {risk}",
        "risk_message": ("A new {sev_lower} severity risk has been added to your risk register. "
                         "Review and assign a treatment plan as soon as possible."),
        "risk_cta": "View Risk",
        "k_risk_title": "Risk title", "k_severity": "Severity", "k_org": "Organization",
        "audit_subject": "[ACTION REQUIRED] You have been assigned to audit: {audit}",
        "audit_badge": "Audit Assigned",
        "audit_title": "You are the lead auditor for: {audit}",
        "audit_message": ("You have been assigned as lead auditor. Please review the scope and "
                          "begin fieldwork planning."),
        "audit_cta": "Open Audit",
        "k_audit": "Audit", "k_due": "Due date",
        "policy_subject": "[REVIEW DUE] Policy: {policy}",
        "policy_badge": "Review Due",
        "policy_title": "Policy review required: {policy}",
        "policy_message": ("This policy is due for its scheduled review. Please review, update if "
                           "necessary, and re-publish."),
        "policy_cta": "Review Policy",
        "k_policy": "Policy", "k_review_due": "Review due",
        "vendor_subject": "[VENDOR ALERT] {vendor} — Risk tier changed to {tier_upper}",
        "vendor_badge": "Vendor {tier} Risk",
        "vendor_title": "Vendor risk alert: {vendor}",
        "vendor_cta": "View Vendor",
        "k_vendor": "Vendor", "k_tier": "Risk tier",
        "score_subject": "[COMPLIANCE ALERT] Score dropped {drop}% for {framework}",
        "score_badge": "Compliance Score Drop",
        "score_title": "Compliance score dropped for {framework}",
        "score_message": ("Your compliance score for {framework} dropped by {drop}% (from {old}% to "
                          "{new}%). Immediate attention may be required."),
        "score_cta": "View Compliance",
        "k_framework": "Framework", "k_prev": "Previous score", "k_curr": "Current score",
        "k_drop": "Drop",
        "digest_subject": "[WEEKLY DIGEST] GRC Summary — {org}",
        "digest_badge": "Weekly Digest",
        "digest_title": "Your weekly GRC summary for {org}",
        "digest_message": ("Here is your weekly overview of your organization's governance, risk, "
                           "and compliance posture."),
        "digest_cta": "Go to Dashboard",
        "k_open_risks": "Open risks", "k_critical_risks": "Critical risks",
        "k_avg_score": "Avg. compliance score", "k_open_findings": "Open audit findings",
        "k_policies_due": "Policies due for review",
        "reset_subject": "Reset your password — GRCEye",
        "reset_title": "Password Reset Requested",
        "reset_message": ("We received a request to reset your GRCEye password. Use the button "
                          "below to choose a new one (valid for 1 hour). If you did not request "
                          "this, you can safely ignore this email — your password has not been "
                          "changed."),
        "reset_cta": "Reset my password",
        "welcome_subject": "Welcome to GRCEye — set your password",
        "welcome_title": "Welcome, {name}",
        "welcome_message": ("An administrator created a GRCEye account for you. Click below to "
                            "set your own password and sign in (link valid for 1 hour). If you "
                            "weren't expecting this, contact your administrator."),
        "welcome_cta": "Set my password",
        "reason": "Reason",
    },
    "fr": {
        "risk_subject": "[RISQUE {sev_upper}] {risk} — {org}",
        "risk_badge": "Risque {sev_lower}",
        "risk_title": "Nouveau risque : {risk}",
        "risk_message": ("Un nouveau risque de gravité « {sev_lower} » a été ajouté à votre "
                         "registre des risques. Examinez-le et affectez-lui un plan de traitement "
                         "dès que possible."),
        "risk_cta": "Voir le risque",
        "k_risk_title": "Intitulé du risque", "k_severity": "Gravité", "k_org": "Organisation",
        "audit_subject": "[ACTION REQUISE] Vous avez été affecté à l'audit : {audit}",
        "audit_badge": "Audit attribué",
        "audit_title": "Vous êtes l'auditeur principal de : {audit}",
        "audit_message": ("Vous avez été désigné auditeur principal. Veuillez examiner le "
                          "périmètre et commencer la planification des travaux."),
        "audit_cta": "Ouvrir l'audit",
        "k_audit": "Audit", "k_due": "Échéance",
        "policy_subject": "[REVUE À ÉCHÉANCE] Politique : {policy}",
        "policy_badge": "Revue à échéance",
        "policy_title": "Revue de politique requise : {policy}",
        "policy_message": ("Cette politique arrive à sa revue planifiée. Veuillez la revoir, la "
                           "mettre à jour si nécessaire et la republier."),
        "policy_cta": "Revoir la politique",
        "k_policy": "Politique", "k_review_due": "Revue prévue le",
        "vendor_subject": "[ALERTE FOURNISSEUR] {vendor} — Niveau de risque passé à {tier_upper}",
        "vendor_badge": "Fournisseur à risque {tier_lower}",
        "vendor_title": "Alerte de risque fournisseur : {vendor}",
        "vendor_cta": "Voir le fournisseur",
        "k_vendor": "Fournisseur", "k_tier": "Niveau de risque",
        "score_subject": "[ALERTE CONFORMITÉ] Baisse du score de {drop} % pour {framework}",
        "score_badge": "Baisse du score de conformité",
        "score_title": "Baisse du score de conformité pour {framework}",
        "score_message": ("Votre score de conformité pour {framework} a baissé de {drop} % (de "
                          "{old} % à {new} %). Une attention immédiate peut être nécessaire."),
        "score_cta": "Voir la conformité",
        "k_framework": "Référentiel", "k_prev": "Score précédent", "k_curr": "Score actuel",
        "k_drop": "Baisse",
        "digest_subject": "[SYNTHÈSE HEBDOMADAIRE] Résumé GRC — {org}",
        "digest_badge": "Synthèse hebdomadaire",
        "digest_title": "Votre synthèse GRC hebdomadaire pour {org}",
        "digest_message": ("Voici la vue d'ensemble hebdomadaire de la gouvernance, des risques et "
                           "de la conformité de votre organisation."),
        "digest_cta": "Accéder au tableau de bord",
        "k_open_risks": "Risques ouverts", "k_critical_risks": "Risques critiques",
        "k_avg_score": "Score de conformité moyen", "k_open_findings": "Constats d'audit ouverts",
        "k_policies_due": "Politiques à revoir",
        "reset_subject": "Réinitialisez votre mot de passe — GRCEye",
        "reset_title": "Demande de réinitialisation du mot de passe",
        "reset_message": ("Nous avons reçu une demande de réinitialisation de votre mot de passe "
                          "GRCEye. Utilisez le bouton ci-dessous pour en choisir un nouveau (lien "
                          "valable 1 heure). Si vous n'êtes pas à l'origine de cette demande, "
                          "ignorez cet e-mail — votre mot de passe n'a pas été modifié."),
        "reset_cta": "Réinitialiser mon mot de passe",
        "welcome_subject": "Bienvenue sur GRCEye — définissez votre mot de passe",
        "welcome_title": "Bienvenue, {name}",
        "welcome_message": ("Un administrateur a créé un compte GRCEye pour vous. Cliquez "
                            "ci-dessous pour définir votre mot de passe et vous connecter (lien "
                            "valable 1 heure). Si vous n'attendiez pas ce message, contactez "
                            "votre administrateur."),
        "welcome_cta": "Définir mon mot de passe",
        "reason": "Motif",
    },
    "ar": {
        "risk_subject": "[خطر {sev}] {risk} — {org}",
        "risk_badge": "خطر {sev}",
        "risk_title": "خطر جديد: {risk}",
        "risk_message": ("تمت إضافة خطر جديد بدرجة خطورة «{sev}» إلى سجل المخاطر. يرجى مراجعته "
                         "وتحديد خطة معالجة له في أقرب وقت ممكن."),
        "risk_cta": "عرض الخطر",
        "k_risk_title": "عنوان الخطر", "k_severity": "درجة الخطورة", "k_org": "المؤسسة",
        "audit_subject": "[إجراء مطلوب] تم إسناد مهمة التدقيق إليكم: {audit}",
        "audit_badge": "مهمة تدقيق مسندة",
        "audit_title": "أنتم المدقق الرئيسي لمهمة: {audit}",
        "audit_message": "تم تعيينكم مدققاً رئيسياً. يرجى مراجعة النطاق والبدء في تخطيط الأعمال الميدانية.",
        "audit_cta": "فتح مهمة التدقيق",
        "k_audit": "مهمة التدقيق", "k_due": "تاريخ الاستحقاق",
        "policy_subject": "[مراجعة مستحقة] السياسة: {policy}",
        "policy_badge": "مراجعة مستحقة",
        "policy_title": "مراجعة السياسة مطلوبة: {policy}",
        "policy_message": "حان موعد المراجعة المجدولة لهذه السياسة. يرجى مراجعتها وتحديثها عند الحاجة ثم إعادة نشرها.",
        "policy_cta": "مراجعة السياسة",
        "k_policy": "السياسة", "k_review_due": "موعد المراجعة",
        "vendor_subject": "[تنبيه مورد] {vendor} — تغيّر مستوى المخاطر إلى {tier}",
        "vendor_badge": "مورد بمستوى مخاطر {tier}",
        "vendor_title": "تنبيه مخاطر المورد: {vendor}",
        "vendor_cta": "عرض المورد",
        "k_vendor": "المورد", "k_tier": "مستوى المخاطر",
        "score_subject": "[تنبيه امتثال] انخفاض الدرجة بنسبة {drop}% لـ{framework}",
        "score_badge": "انخفاض درجة الامتثال",
        "score_title": "انخفضت درجة الامتثال لـ{framework}",
        "score_message": ("انخفضت درجة امتثالكم لـ{framework} بنسبة {drop}% (من {old}% إلى "
                          "{new}%). قد يلزم التدخل فوراً."),
        "score_cta": "عرض الامتثال",
        "k_framework": "الإطار المرجعي", "k_prev": "الدرجة السابقة", "k_curr": "الدرجة الحالية",
        "k_drop": "الانخفاض",
        "digest_subject": "[الملخص الأسبوعي] ملخص الحوكمة والمخاطر والامتثال — {org}",
        "digest_badge": "الملخص الأسبوعي",
        "digest_title": "ملخصكم الأسبوعي للحوكمة والمخاطر والامتثال لـ{org}",
        "digest_message": "إليكم النظرة العامة الأسبوعية على وضع الحوكمة والمخاطر والامتثال في مؤسستكم.",
        "digest_cta": "الانتقال إلى لوحة التحكم",
        "k_open_risks": "المخاطر المفتوحة", "k_critical_risks": "المخاطر الحرجة",
        "k_avg_score": "متوسط درجة الامتثال", "k_open_findings": "ملاحظات التدقيق المفتوحة",
        "k_policies_due": "السياسات المستحقة المراجعة",
        "reset_subject": "إعادة تعيين كلمة المرور — GRCEye",
        "reset_title": "طلب إعادة تعيين كلمة المرور",
        "reset_message": ("تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابكم في GRCEye. استخدموا "
                          "الزر أدناه لاختيار كلمة مرور جديدة (الرابط صالح لمدة ساعة واحدة). إذا لم "
                          "تطلبوا ذلك، يمكنكم تجاهل هذه الرسالة — لم يتم تغيير كلمة المرور."),
        "reset_cta": "إعادة تعيين كلمة المرور",
        "welcome_subject": "مرحباً بكم في GRCEye — عيّنوا كلمة المرور",
        "welcome_title": "مرحباً، {name}",
        "welcome_message": ("أنشأ أحد المسؤولين حساباً لكم في GRCEye. انقروا أدناه لتعيين كلمة "
                            "المرور الخاصة بكم وتسجيل الدخول (الرابط صالح لمدة ساعة واحدة). إذا لم "
                            "تكونوا تتوقعون هذه الرسالة، يرجى التواصل مع المسؤول."),
        "welcome_cta": "تعيين كلمة المرور",
        "reason": "السبب",
    },
}


def email_text(lang: str | None, key: str, **fmt) -> str:
    """One helper string in `lang` (English fallback), formatted with `fmt`."""
    code = _lang(lang)
    template = _T[code].get(key) or _T["en"][key]
    return template.format(**fmt)


def _sev(lang: str, value: str | None) -> str:
    raw = str(value or "").strip().lower()
    return _SEVERITY_WORD[_lang(lang)].get(raw) or raw.capitalize()


async def send_notification_email(
    *, to_email: str, subject: str, body: str, action_url: str | None = None, lang: str = "en"
) -> bool:
    """Generic notification email — subject and body arrive already in `lang`.

    Used by notification_generator.flush_email_outbox (bodies rendered from the
    same catalog as the in-app feed) and by the Celery notification workers.
    """
    context: dict = {"title": subject, "message": body}
    if action_url:
        context["action_url"] = action_url
        context["action_label"] = _OPEN_LABEL.get(_lang(lang), _OPEN_LABEL["en"])
    return await send_email(to_email=to_email, subject=subject, context=context, lang=lang)


async def send_password_reset_email(*, to_email: str, reset_link: str, lang: str = "en") -> bool:
    """The forgot-password mail. The link is the call-to-action button.

    (It used to be inlined as <a> markup inside the message, which the
    autoescaping template printed as literal tags.)
    """
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "reset_subject"),
        context={
            "title": email_text(lang, "reset_title"),
            "message": email_text(lang, "reset_message"),
            "action_url": reset_link,
            "action_label": email_text(lang, "reset_cta"),
        },
        lang=lang,
    )


async def send_welcome_email(*, to_email: str, first_name: str, set_password_link: str,
                             lang: str = "en") -> bool:
    """First-login mail for an admin-created account."""
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "welcome_subject"),
        context={
            "title": email_text(lang, "welcome_title", name=first_name),
            "message": email_text(lang, "welcome_message"),
            "action_url": set_password_link,
            "action_label": email_text(lang, "welcome_cta"),
        },
        lang=lang,
    )


async def send_risk_alert(*, to_email: str, risk_title: str, severity: str, org: str, risk_url: str,
                          lang: str = "en") -> bool:
    badge_colors = {"critical": "red", "high": "orange", "medium": "yellow", "low": "gray"}
    sev = _sev(lang, severity)
    fmt = {"risk": risk_title, "org": org, "sev": sev, "sev_upper": sev.upper(), "sev_lower": sev.lower()}
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "risk_subject", **fmt),
        context={
            "badge_text": email_text(lang, "risk_badge", **fmt),
            "badge_color": badge_colors.get(severity, "blue"),
            "title": email_text(lang, "risk_title", **fmt),
            "message": email_text(lang, "risk_message", **fmt),
            "details": {
                email_text(lang, "k_risk_title"): risk_title,
                email_text(lang, "k_severity"): sev,
                email_text(lang, "k_org"): org,
            },
            "action_url": risk_url,
            "action_label": email_text(lang, "risk_cta"),
        },
        lang=lang,
    )


async def send_audit_assigned(*, to_email: str, audit_name: str, due_date: str, org: str, audit_url: str,
                              lang: str = "en") -> bool:
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "audit_subject", audit=audit_name),
        context={
            "badge_text": email_text(lang, "audit_badge"),
            "badge_color": "blue",
            "title": email_text(lang, "audit_title", audit=audit_name),
            "message": email_text(lang, "audit_message"),
            "details": {
                email_text(lang, "k_audit"): audit_name,
                email_text(lang, "k_due"): due_date,
                email_text(lang, "k_org"): org,
            },
            "action_url": audit_url,
            "action_label": email_text(lang, "audit_cta"),
        },
        lang=lang,
    )


async def send_policy_review_due(*, to_email: str, policy_name: str, due_date: str, policy_url: str,
                                 lang: str = "en") -> bool:
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "policy_subject", policy=policy_name),
        context={
            "badge_text": email_text(lang, "policy_badge"),
            "badge_color": "orange",
            "title": email_text(lang, "policy_title", policy=policy_name),
            "message": email_text(lang, "policy_message"),
            "details": {
                email_text(lang, "k_policy"): policy_name,
                email_text(lang, "k_review_due"): due_date,
            },
            "action_url": policy_url,
            "action_label": email_text(lang, "policy_cta"),
        },
        lang=lang,
    )


async def send_vendor_alert(*, to_email: str, vendor_name: str, risk_tier: str, message: str, vendor_url: str,
                            lang: str = "en") -> bool:
    tier_colors = {"critical": "red", "high": "orange", "medium": "yellow", "low": "green"}
    tier = _sev(lang, risk_tier)
    fmt = {"vendor": vendor_name, "tier": tier, "tier_upper": tier.upper(), "tier_lower": tier.lower()}
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "vendor_subject", **fmt),
        context={
            "badge_text": email_text(lang, "vendor_badge", **fmt),
            "badge_color": tier_colors.get(risk_tier, "blue"),
            "title": email_text(lang, "vendor_title", **fmt),
            "message": message,
            "details": {email_text(lang, "k_vendor"): vendor_name, email_text(lang, "k_tier"): tier},
            "action_url": vendor_url,
            "action_label": email_text(lang, "vendor_cta"),
        },
        lang=lang,
    )


async def send_compliance_score_drop(*, to_email: str, framework: str, old_score: float, new_score: float,
                                     org: str, url: str, lang: str = "en") -> bool:
    drop = round(old_score - new_score, 1)
    fmt = {"framework": framework, "drop": drop, "old": old_score, "new": new_score}
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "score_subject", **fmt),
        context={
            "badge_text": email_text(lang, "score_badge"),
            "badge_color": "red",
            "title": email_text(lang, "score_title", **fmt),
            "message": email_text(lang, "score_message", **fmt),
            "details": {
                email_text(lang, "k_framework"): framework,
                email_text(lang, "k_prev"): f"{old_score}%",
                email_text(lang, "k_curr"): f"{new_score}%",
                email_text(lang, "k_drop"): f"-{drop}%",
                email_text(lang, "k_org"): org,
            },
            "action_url": url,
            "action_label": email_text(lang, "score_cta"),
        },
        lang=lang,
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
    lang: str = "en",
) -> bool:
    return await send_email(
        to_email=to_email,
        subject=email_text(lang, "digest_subject", org=org),
        context={
            "badge_text": email_text(lang, "digest_badge"),
            "badge_color": "gray",
            "title": email_text(lang, "digest_title", org=org),
            "message": email_text(lang, "digest_message"),
            "details": {
                email_text(lang, "k_open_risks"): str(open_risks),
                email_text(lang, "k_critical_risks"): str(critical_risks),
                email_text(lang, "k_avg_score"): f"{compliance_score}%",
                email_text(lang, "k_open_findings"): str(open_findings),
                email_text(lang, "k_policies_due"): str(policies_due),
            },
            "action_url": dashboard_url,
            "action_label": email_text(lang, "digest_cta"),
        },
        lang=lang,
    )
