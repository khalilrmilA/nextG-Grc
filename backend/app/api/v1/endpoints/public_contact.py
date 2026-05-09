"""
Public contact form — no authentication required.

POST /public/contact
- Sends an email to sales@ via the existing email service
- Rate-limited per IP (5 submissions per hour)
- No data stored in DB (avoids needing a new model)
"""
import logging
import time
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from app.core.config import settings
from app.services.email_service import send_email

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory rate limiter (per IP, 5 submissions per hour)
_rate_store: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT = 5
_RATE_WINDOW = 3600  # 1 hour in seconds

SALES_EMAIL = "sales@grceye.io"


def _check_rate_limit(ip: str) -> None:
    now = time.time()
    _rate_store[ip] = [t for t in _rate_store[ip] if now - t < _RATE_WINDOW]
    if len(_rate_store[ip]) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many contact submissions. Please try again later.",
        )
    _rate_store[ip].append(now)


class ContactRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    company: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=200)
    message: str = Field(..., min_length=10, max_length=5000)


@router.post("/contact", status_code=status.HTTP_204_NO_CONTENT)
async def submit_contact_form(request: Request, body: ContactRequest):
    """Public contact form — sends an email to sales@."""
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)

    subject = body.subject or "New contact form submission"
    safe_message = body.message.replace("\n", "<br>")
    company_line = f"<p><strong>Company:</strong> {body.company}</p>" if body.company else ""

    sent = await send_email(
        to_email=SALES_EMAIL,
        subject=f"[GRCEye Contact] {subject}",
        template_name="notification.html",
        context={
            "title": "New contact form submission",
            "message": (
                f"<p><strong>From:</strong> {body.name} &lt;{body.email}&gt;</p>"
                f"{company_line}"
                f"<p><strong>Subject:</strong> {subject}</p>"
                f"<hr>"
                f"<p>{safe_message}</p>"
                f"<hr>"
                f"<p style='color:#888;font-size:12px;'>Submitted from IP {ip}</p>"
            ),
        },
    )

    if not sent:
        # SMTP may be unconfigured in dev — still log it so we have a record.
        logger.info(
            "[contact] from=%s email=%s company=%s subject=%s message=%s",
            body.name, body.email, body.company, subject, body.message,
        )
    return None
