"""Per-tenant AI provider configuration — bring your own AI.

Customers who will not send their data to the bundled model can point the
platform at their own endpoint with their own API key.

Why this is its own table rather than a key in Tenant.settings: "ai" is already
in _SETTINGS_ALLOWED_KEYS, and GET /tenants/current returns the entire settings
dict to every authenticated user, including viewer and auditor. Putting an API
key there would hand it to everyone in the tenant. A separate table lets the read
path expose only a masked hint.

New table, so create_all() creates it on restart. No hand-written ALTER script
and no appliance_cli MIGRATIONS entry is needed.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TenantAIConfig(Base):
    __tablename__ = "tenant_ai_configs"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), unique=True, index=True, nullable=False
    )

    # An explicit switch rather than inferring intent from empty fields. Blanking
    # a field must never silently fall back to the platform's own key and start
    # billing the vendor for the customer's traffic.
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # "" | "ollama" | "openai". Empty means inherit the deployment default.
    provider: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(200), default="", nullable=False)

    # AES-256-GCM, keyed from SECRET_KEY. See app/core/secret_box.py.
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Last 4 characters only, so the UI can show WHICH key is set without
    # showing the key. Never widen this.
    api_key_last4: Mapped[str] = mapped_column(String(8), default="", nullable=False)

    # Result of the last "test connection", so an operator can tell a typo from
    # an outage without reading logs they cannot reach on an appliance.
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verify_error: Mapped[str] = mapped_column(String(500), default="", nullable=False)

    updated_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    def __repr__(self) -> str:
        # Never let the ciphertext or anything key-shaped reach a log line.
        return "<TenantAIConfig tenant=%s enabled=%s provider=%s key=%s>" % (
            self.tenant_id,
            self.enabled,
            self.provider or "-",
            "set" if self.api_key_encrypted else "unset",
        )

    __str__ = __repr__
