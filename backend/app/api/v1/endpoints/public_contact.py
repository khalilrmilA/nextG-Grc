"""
Public contact form — no authentication required.

POST /public/contact
- Sends an email to sales@ via the existing email service
- Rate-limited per IP (5 submissions per hour)
- No data stored in DB (avoids needing a new model)
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from app.core import shared_state
from app.services.ai_locale import get_request_language
from app.services.email_service import send_email

router = APIRouter()
logger = logging.getLogger(__name__)

# Rate limiter (per IP, 5 submissions per hour). Counted in shared state so the
# limit is 5 across the deployment rather than 5 per uvicorn worker — this
# endpoint is unauthenticated and sends mail, so the per-worker multiplier was a
# real abuse margin. See app/core/shared_state.py.
_RATE_LIMIT = 5
_RATE_WINDOW = 3600  # 1 hour in seconds

# The only string a visitor of the public site can be shown by this route. Same
# local en/fr/ar table the rest of the app uses (vendors.py, public_upload.py);
# `lang` comes from the browser's Accept-Language.
_RATE_LIMITED = {
    "en": "Too many contact submissions. Please try again later.",
    "fr": "Trop de demandes de contact. Veuillez réessayer plus tard.",
    "ar": "عدد كبير جداً من طلبات الاتصال. يرجى المحاولة لاحقاً.",
}

CONTACT_RECIPIENTS = [
    "h.harhira@nextstep-it.com",
    "a.abdallah@nextstep-it.com",
    "gamerthe916@gmail.com",
]


def _client_ip(request: Request) -> str:
    """The visitor's address, not the gateway's.

    uvicorn runs WITHOUT --proxy-headers behind gateway.js, so ``request.client.host``
    is 127.0.0.1 for every request off the public site — which turned this per-IP cap
    into one global bucket: five contact-form submissions an hour for the whole of
    grceye.com, everybody sharing the same counter. gateway.js appends its own socket
    peer to any client-supplied X-Forwarded-For, so the LAST entry is the address our
    edge actually saw and is the only one a submitter cannot forge (auth.py::_client_ip
    takes the first entry because it journals a claim rather than gating on it).
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        last = xff.split(",")[-1].strip()
        if last:
            return last[:64]
    return request.client.host if request.client else "unknown"


async def _check_rate_limit(ip: str, lang: str = "en") -> None:
    hits = await shared_state.incr(f"ratelimit:public_contact:{ip}", 1, _RATE_WINDOW)
    if hits > _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_RATE_LIMITED.get(lang) or _RATE_LIMITED["en"],
        )


class ContactRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    company: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=200)
    message: str = Field(..., min_length=10, max_length=5000)


@router.post("/contact", status_code=status.HTTP_204_NO_CONTENT)
async def submit_contact_form(
    request: Request,
    body: ContactRequest,
    lang: str = Depends(get_request_language),
):
    """Public contact form — sends a separate email to each recipient."""
    ip = _client_ip(request)
    await _check_rate_limit(ip, lang)

    subject = body.subject or "New contact form submission"

    email_context = {
        "sender_name": body.name,
        "sender_email": body.email,
        "company": body.company or "",
        "contact_subject": subject,
        "message": body.message,
        "ip": ip,
        # contact_form.html renders {{ submitted_at }} twice and nothing ever
        # supplied it, so every lead mail reached sales with a blank timestamp
        # (Jinja renders an undefined name as ""). The template escapes and
        # pre-wraps `message` itself, which is why the old <br>/company-line
        # strings built here were never passed to it.
        "submitted_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }

    any_sent = False
    for recipient in CONTACT_RECIPIENTS:
        sent = await send_email(
            to_email=recipient,
            subject=f"[GRCEye Contact] {subject} — {body.name}",
            template_name="contact_form.html",
            context=email_context,
            # Let sales hit "Reply" and reach the lead directly.
            reply_to=body.email,
        )
        if sent:
            any_sent = True

    if not any_sent:
        # This log IS the lead when SMTP is down — the visitor still gets a 204.
        # It has to be ERROR: nothing configures logging in this app, so the root
        # logger sits at WARNING and an info() record here is discarded, which
        # turned "keep the lead" into silent data loss.
        logger.error(
            "[contact] delivery failed, lead captured in log only: "
            "from=%s email=%s company=%s subject=%s message=%s",
            body.name, body.email, body.company, subject, body.message,
        )
    return None
