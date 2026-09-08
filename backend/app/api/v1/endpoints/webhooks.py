"""Webhook Management — register outbound webhooks for GRC events."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.core.database import get_db
from app.core.security_utils import validate_outbound_url
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole

router = APIRouter()

# In-memory webhook store (would be a DB model in production)
# For now we use tenant settings to store webhook configs
from app.models.tenant import Tenant


class WebhookConfig(BaseModel):
    id: str | None = None
    url: str
    events: list[str]  # e.g. ["risk.created", "incident.created", "compliance.score_changed"]
    secret: str | None = None
    is_active: bool = True
    description: str | None = None

class WebhookListResponse(BaseModel):
    webhooks: list[WebhookConfig]

VALID_EVENTS = [
    "risk.created", "risk.updated", "risk.deleted",
    "incident.created", "incident.updated", "incident.resolved",
    "compliance.assessment_created", "compliance.score_changed", "compliance.gap_found",
    "vendor.created", "vendor.contract_uploaded", "vendor.contract_approved",
    "audit.created", "audit.finding_created", "audit.completed",
    "policy.created", "policy.approved", "policy.published",
    "user.login", "user.created",
]


@router.get("/events")
async def list_available_events(_: User = Depends(get_current_user)):
    """List all available webhook event types."""
    return {"events": VALID_EVENTS}


@router.get("", response_model=WebhookListResponse)
async def list_webhooks(
    db: AsyncSession = Depends(get_db),
    # Same gate as create/delete/test: the listing carries each hook's signing
    # `secret`, which authenticates our payloads to the customer's endpoint.
    # Behind a bare get_current_user any authenticated tenant user could read
    # (and then forge with) it. require_roles still auto-passes tenant_admin /
    # super_admin, which is exactly who the SPA's /webhooks page is gated to.
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")
    hooks = (tenant.settings or {}).get("webhooks", [])
    return WebhookListResponse(webhooks=[WebhookConfig(**h) for h in hooks])


@router.post("", response_model=WebhookConfig, status_code=201)
async def create_webhook(
    body: WebhookConfig,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    # Validate URL — reject SSRF targets (private IPs, localhost, non-http schemes).
    body.url = validate_outbound_url(body.url)

    # Validate events
    invalid = [e for e in body.events if e not in VALID_EVENTS]
    if invalid:
        raise HTTPException(400, f"Invalid events: {invalid}. Valid: {VALID_EVENTS}")

    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")

    # Copy before mutating. Tenant.settings is a plain JSON column (not
    # MutableDict), so mutating the loaded dict in place and re-assigning the
    # SAME object leaves SQLAlchemy comparing the value against itself at flush:
    # no UPDATE is emitted and the new webhook is silently lost. It only
    # "worked" for a tenant whose settings were still empty ({} or None), where
    # `or {}` happened to produce a fresh dict. Same copy-then-assign pattern as
    # tenants.py's settings merge.
    settings = dict(tenant.settings or {})
    hooks = list(settings.get("webhooks") or [])

    import uuid
    body.id = str(uuid.uuid4())[:8]
    hooks.append(body.model_dump())
    settings["webhooks"] = hooks
    tenant.settings = settings
    await db.commit()
    return body


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")

    # Copy before mutating — see create_webhook: without it the DELETE returned
    # 204 while the hook stayed in the settings blob (a revocation that did not
    # revoke).
    settings = dict(tenant.settings or {})
    hooks = settings.get("webhooks") or []
    settings["webhooks"] = [h for h in hooks if h.get("id") != webhook_id]
    tenant.settings = settings
    await db.commit()


@router.post("/{webhook_id}/test")
async def test_webhook(
    webhook_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Send a test event to a webhook."""
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")

    hooks = (tenant.settings or {}).get("webhooks", [])
    hook = next((h for h in hooks if h.get("id") == webhook_id), None)
    if not hook: raise HTTPException(404, "Webhook not found")

    # Re-validate URL at delivery time — webhook configs persisted before the
    # SSRF guard was added must still be checked.
    validate_outbound_url(hook.get("url", ""))

    payload = {
        "event": "test.ping",
        "timestamp": datetime.utcnow().isoformat(),
        "data": {"message": "This is a test webhook from GRC Platform"},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.post(hook["url"], json=payload)
            return {"status": "sent", "response_code": resp.status_code}
    except Exception:
        return {"status": "failed", "error": "Delivery failed"}