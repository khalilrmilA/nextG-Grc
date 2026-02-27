"""Subscription and billing models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, ForeignKey, Enum as SAEnum, JSON, Integer, Float
from app.core.database import Base


class SubscriptionTier(str, enum.Enum):
    STARTER = "starter"
    PROFESSIONAL = "professional"
    ENTERPRISE = "enterprise"


class SubscriptionStatus(str, enum.Enum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    PAUSED = "paused"


# Feature limits per tier
TIER_LIMITS = {
    SubscriptionTier.STARTER: {
        "max_frameworks": 3,
        "max_admin_users": 10,
        "max_vendors": 25,
        "max_integrations": 25,
        "ai_copilot": False,
        "trust_center": False,
        "sso_saml": False,
        "custom_frameworks": False,
        "audit_module": False,
        "financial_risk_quantification": False,
        "white_label": False,
        "sla_uptime": 99.5,
    },
    SubscriptionTier.PROFESSIONAL: {
        "max_frameworks": 10,
        "max_admin_users": 50,
        "max_vendors": 100,
        "max_integrations": 75,
        "ai_copilot": False,
        "trust_center": True,
        "sso_saml": False,
        "custom_frameworks": True,
        "audit_module": True,
        "financial_risk_quantification": False,
        "white_label": False,
        "sla_uptime": 99.9,
    },
    SubscriptionTier.ENTERPRISE: {
        "max_frameworks": -1,     # Unlimited
        "max_admin_users": -1,    # Unlimited
        "max_vendors": -1,        # Unlimited
        "max_integrations": -1,   # Unlimited
        "ai_copilot": True,
        "trust_center": True,
        "sso_saml": True,
        "custom_frameworks": True,
        "audit_module": True,
        "financial_risk_quantification": True,
        "white_label": True,
        "sla_uptime": 99.99,
    },
}


class Subscription(Base):
    """Tenant subscription details."""
    __tablename__ = "subscriptions"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, unique=True
    )
    tier: Mapped[SubscriptionTier] = mapped_column(
        SAEnum(SubscriptionTier), nullable=False, default=SubscriptionTier.STARTER
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        SAEnum(SubscriptionStatus), default=SubscriptionStatus.TRIALING
    )

    # Stripe
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Billing
    billing_cycle: Mapped[str] = mapped_column(String(20), default="annual")  # "monthly" or "annual"
    amount_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="USD")

    # Trial
    trial_ends_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Subscription dates
    current_period_start: Mapped[str | None] = mapped_column(String(30), nullable=True)
    current_period_end: Mapped[str | None] = mapped_column(String(30), nullable=True)
    canceled_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Override limits for custom enterprise deals
    custom_limits: Mapped[dict] = mapped_column(JSON, default=dict)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="subscription")

    @property
    def limits(self) -> dict:
        """Get effective limits, merging tier defaults with custom overrides."""
        base = TIER_LIMITS.get(self.tier, TIER_LIMITS[SubscriptionTier.STARTER]).copy()
        base.update(self.custom_limits or {})
        return base
