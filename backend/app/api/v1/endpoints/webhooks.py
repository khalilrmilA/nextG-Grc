"""Webhook Management — register outbound webhooks for GRC events."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User

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
async def list_available_events():
    """List all available webhook event types."""
    return {"events": VALID_EVENTS}


@router.get("", response_model=WebhookListResponse)
async def list_webhooks(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
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
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    # Validate events
    invalid = [e for e in body.events if e not in VALID_EVENTS]
    if invalid:
        raise HTTPException(400, f"Invalid events: {invalid}. Valid: {VALID_EVENTS}")

    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")

    settings = tenant.settings or {}
    hooks = settings.get("webhooks", [])

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
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")

    settings = tenant.settings or {}
    hooks = settings.get("webhooks", [])
    settings["webhooks"] = [h for h in hooks if h.get("id") != webhook_id]
    tenant.settings = settings
    await db.commit()


@router.post("/{webhook_id}/test")
async def test_webhook(
    webhook_id: str,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Send a test event to a webhook."""
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant: raise HTTPException(404, "Tenant not found")

    hooks = (tenant.settings or {}).get("webhooks", [])
    hook = next((h for h in hooks if h.get("id") == webhook_id), None)
    if not hook: raise HTTPException(404, "Webhook not found")

    # Send test payload
    payload = {
        "event": "test.ping",
        "timestamp": datetime.utcnow().isoformat(),
        "data": {"message": "This is a test webhook from GRC Platform"},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(hook["url"], json=payload)
            return {"status": "sent", "response_code": resp.status_code}
    except Exception as e:
        return {"status": "failed", "error": str(e)}