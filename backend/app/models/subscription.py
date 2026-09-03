"""Subscription and billing models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, ForeignKey, Enum as SAEnum, JSON, Integer, Float
from app.core.database import Base


class SubscriptionTier(str, enum.Enum):
    STARTER = "starter"
    PROFESSIONAL = "professional"
    ENTERPRISE = "enterprise"
    ELITE = "elite"  # Elite Pack — unlocks the full STB / RFP cyber-risk capability set

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            for member in cls:
                if member.value == value.lower():
                    return member
        return None


class SubscriptionStatus(str, enum.Enum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    PAUSED = "paused"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            for member in cls:
                if member.value == value.lower():
                    return member
        return None


# ---------------------------------------------------------------------------
# Elite Pack — the feature set delivered for the STB AO 20/2026 cyber-risk RFP.
# These flags are unlocked ONLY by the ELITE tier (or an explicit custom_limits
# override, or platform super admins). Every non-Elite tier gets them as False.
# Gate endpoints with app.api.v1.dependencies.features.require_feature("<flag>").
# ---------------------------------------------------------------------------
ELITE_FEATURES = (
    "elite_pack",             # master flag
    "ad_ldap_sso",            # Active Directory / LDAP + OIDC SSO
    "mfa",                    # TOTP multi-factor authentication
    "cia_valuation",          # asset CID valuation grid + history
    "asset_cartography",      # interactive asset ↔ process ↔ entity graph
    "asset_lifecycle",        # lifecycle states + end-of-life alerts
    "vuln_scanner_import",    # Nessus / Qualys / OpenVAS ingestion
    "cve_knowledge_base",     # CVE/CWE/CAPEC base + daily NVD sync
    "vuln_impact_scoring",    # composite CVSS × context × asset-value scoring
    "threat_profiles",        # detailed threat profiles + probability/severity scales
    "scenario_versioning",    # scenario/risk version history + timeline + diff
    "control_effectiveness",  # 5-criteria control effectiveness evaluation
    "risk_appetite",          # appetite thresholds + target-vs-threshold gating
    "risk_treatment_plans",   # treatment options + multi-action plans + tracking
    "advanced_reporting",     # report builder + Excel + scheduling + templates
    "custom_dashboards",      # the full 9-dashboard set + export
    "raci_governance",        # RACI matrix + document repository
    "document_repository",    # unified governance document store with per-doc rights
    "archiving",              # rule-based archiving + retention enforcement
    "multi_db_support",       # Oracle 19c / SQL Server 2019 compatibility
    "ocr_capture",            # optional French OCR document capture
    "tamper_evident_log",     # hash-chained activity log integrity + login journaling views
)

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

# Elite tier = everything Enterprise has (unlimited) PLUS every Elite Pack feature.
TIER_LIMITS[SubscriptionTier.ELITE] = {
    **TIER_LIMITS[SubscriptionTier.ENTERPRISE],
    **{feature: True for feature in ELITE_FEATURES},
    "sla_uptime": 99.99,
}

# Every non-Elite tier gets the Elite Pack features defaulted to False (keeps the
# `limits` map complete so gating checks never KeyError on older tiers).
for _tier_limits in TIER_LIMITS.values():
    for _feature in ELITE_FEATURES:
        _tier_limits.setdefault(_feature, False)


class Subscription(Base):
    """Tenant subscription details."""
    __tablename__ = "subscriptions"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, unique=True
    )
    tier: Mapped[SubscriptionTier] = mapped_column(
        SAEnum(SubscriptionTier, values_callable=lambda x: [e.value for e in x]),
        nullable=False, default=SubscriptionTier.STARTER
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        SAEnum(SubscriptionStatus, values_callable=lambda x: [e.value for e in x]),
        default=SubscriptionStatus.TRIALING
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

    def has_feature(self, feature: str) -> bool:
        """True if the tenant's effective plan unlocks `feature`.

        Elite Pack is god mode — EVERY feature is unlocked, including any flag added in
        the future that isn't yet listed in ELITE_FEATURES. Non-Elite tiers fall back to
        their effective limits map (tier defaults + custom_limits overrides).
        """
        # An EXPLICIT override always wins, including over Elite. Without this,
        # a platform owner cannot take a single feature away from an Elite
        # tenant, which is the exact case the Access Control page exists for.
        # Absent an override the behaviour is unchanged: Elite unlocks
        # everything, including flags added after ELITE_FEATURES was written.
        override = (self.custom_limits or {}).get(feature)
        if override is not None:
            return bool(override)
        if self.tier == SubscriptionTier.ELITE:
            return True
        return bool(self.limits.get(feature, False))


# ── The canonical list of boolean entitlements ────────────────────────────────
#
# Defined here, next to TIER_LIMITS and ELITE_FEATURES, because more than one
# place needs it and a second hand-written copy would drift:
#
#   admin.py            renders the super admin's Access Control switches
#   subscriptions.py    tells the dashboard what to show the current tenant
#   require_feature     enforces it on the API
#
# If the switch list, the UI gate and the API gate are not derived from the same
# source, a feature eventually appears enabled in the UI and returns 402 when
# clicked, or is hidden while its endpoints stay open. Both have happened here.

# Numeric or non-boolean limits. They are quotas, not on/off switches, so they
# are never rendered as toggles and never gate a page.
NON_TOGGLE_LIMITS = frozenset({
    "max_frameworks", "max_admin_users", "max_vendors",
    "max_integrations", "sla_uptime",
})


def togglable_features() -> list[tuple[str, str]]:
    """Every boolean entitlement, paired with the group it belongs to.

    Group is decided by membership of ELITE_FEATURES, NOT by which dict the key
    was found in. That distinction matters: the module-level back-fill below
    TIER_LIMITS adds every Elite feature to every tier (defaulted to False) so
    that gating checks never KeyError. A side effect is that
    TIER_LIMITS[ENTERPRISE] ends up containing all of them, so classifying by
    iteration order labelled all 29 features "platform" and left the Elite group
    empty. The Access Control page then showed one undifferentiated wall of
    switches instead of the packs it exists to manage.

    Order is stable: platform features first, in TIER_LIMITS order, then the
    Elite Pack in its declared order.
    """
    elite = set(ELITE_FEATURES)
    platform = [
        key for key in TIER_LIMITS[SubscriptionTier.ENTERPRISE]
        if key not in NON_TOGGLE_LIMITS and key not in elite
    ]
    return (
        [(key, "platform") for key in platform]
        + [(key, "elite_pack") for key in ELITE_FEATURES]
    )
