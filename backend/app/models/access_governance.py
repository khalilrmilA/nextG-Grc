"""Delegation and access recertification — advanced, traceable entitlements.

Two capabilities the client names for the Administrateur role and that had no
implementation at all:

**Délégations.** Handing your authority to a colleague for an absence, with a
start, an end, and a record that it happened. Delegated roles are resolved in
:func:`app.services.authz.get_effective_roles`, so every existing
``require_roles`` check honours them without being touched.

**Revues d'habilitations.** Periodic recertification: snapshot who holds what,
have an approver confirm or revoke each one, and act on the revocations. It is a
named ISO 27001 / SOC 2 control, and a GRC platform that cannot recertify its
own access is an uncomfortable audit finding.

Both are deliberately time-bounded and audited rather than silent: an
entitlement that cannot be seen to expire is the thing recertification exists to
catch.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AccessDelegation(Base):
    """One person's authority, lent to another for a bounded period.

    The delegate holds the delegated roles *in addition to* their own, only
    between ``starts_at`` and ``ends_at``, and only until someone revokes it.
    Expiry is evaluated at read time rather than by a job: a delegation that
    depends on a scheduler having run is a delegation that outlives its window
    when the scheduler is down.
    """
    __tablename__ = "access_delegations"

    __table_args__ = (
        Index("ix_delegation_delegate", "tenant_id", "delegate_id", "revoked_at"),
        Index("ix_delegation_delegator", "tenant_id", "delegator_id"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)

    # Whose authority is being lent, and to whom.
    delegator_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    delegate_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)

    # Roles granted for the window. Always a subset of what the delegator holds
    # and of ASSIGNABLE_ROLES — tenant_admin and super_admin are never lent,
    # matching the rule the rest of the application already applies.
    roles: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    def is_active(self, now: datetime) -> bool:
        return self.revoked_at is None and self.starts_at <= now <= self.ends_at


class AccessReviewCampaign(Base):
    """A recertification round: who was reviewed, by whom, and when it closed."""
    __tablename__ = "access_review_campaigns"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # open | completed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", index=True)
    due_date: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class AccessReviewItem(Base):
    """One person's entitlements as they stood when the campaign opened.

    ``roles_snapshot`` is captured at creation on purpose. Reviewing against
    live data would let an entitlement change mid-review and be confirmed by
    someone who never saw it — the snapshot is what the approver actually
    judged, and it is what the record should show afterwards.
    """
    __tablename__ = "access_review_items"

    __table_args__ = (
        Index("ix_review_item_campaign", "campaign_id", "decision"),
    )

    campaign_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("access_review_campaigns.id"), nullable=False, index=True
    )
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    roles_snapshot: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # pending | confirmed | revoked
    decision: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    decided_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Whether a "revoked" decision was actually applied to the account. A
    # decision that is recorded but never enforced is the failure mode that
    # makes access reviews theatre.
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CustomRole(Base):
    """A role the organisation defines for itself, in its own vocabulary.

    The built-in roles are a fixed set chosen for a generic GRC product; a bank
    has its own job titles and its own idea of what each one may do. A custom
    role carries the organisation's name for a job ("Analyste Conformité",
    "Pilote de Risque") and resolves to the built-in roles that job needs.

    It composes built-ins rather than defining permissions from scratch, and
    that is a deliberate limit: authorisation across the application is
    role-name based, so a role with a genuinely bespoke permission set would
    mean rewriting every route's check. Composition gives an organisation its
    own vocabulary and its own combinations today, without a rewrite that would
    put every existing authorisation decision at risk.

    Resolution happens in :func:`app.services.authz.get_effective_roles`, so
    every existing ``require_roles`` check honours a custom role without being
    modified.
    """
    __tablename__ = "custom_roles"

    __table_args__ = (
        Index("ix_custom_role_tenant_name", "tenant_id", "name", unique=True),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Built-in roles this custom role grants. Always a subset of
    # ASSIGNABLE_ROLES — tenant_admin and super_admin are never composable, or a
    # custom role would be a way to mint an administrator.
    base_roles: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
