"""Commercial package quotas — counting and enforcement.

The numbers live in app/models/subscription.py (TIER_LIMITS, FREE_ROLES); this
module only counts and refuses. Rules:

* Only NEW additions are refused: creating / activating a contributor, moving a
  free-role user to a contributor role, an assessment on a framework the tenant
  has not assessed yet, a new vendor. Nothing that already exists is ever
  hidden, locked or deleted, even when a tenant is already over a quota.
* Counts are fresh SQL queries every time. The backend runs 2 uvicorn workers,
  so an in-memory counter would be split-brained.
* A refusal is HTTP 402 with a structured detail::

      {"code": "plan_limit", "error": "plan_limit", "limit": "max_contributors",
       "current": 25, "max": 25, "tier": "professional", "plan": "Growth",
       "message": "..."}

  ``message`` is English and is localised to fr/ar by the global HTTPException
  handler (app.core.i18n_messages, templates in app/core/locales/messages_*.json).

Definitions
* contributor = an ACTIVE user of the tenant whose scalar ``role`` is not in
  FREE_ROLES (viewer / executive / auditor); super_admin is never counted.
* active framework = a distinct ``framework_id`` over the tenant's compliance
  assessments (every status — deleting an assessment frees its slot, archiving
  does not). ``Tenant.selected_framework_ids`` is a display preference (which
  frameworks the UI filters on) and creates no assessment, so it is not counted.
* vendor = any vendor row of the tenant (offboarded ones included — they are
  kept for history, and deleting one frees its slot).

Known limit: two concurrent requests on two workers can each see N-1 and both
succeed, overshooting a quota by one. Acceptable for a commercial quota.
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import (
    ENFORCED_QUOTAS,
    FREE_ROLES,
    PLAN_DISPLAY_NAMES,
    TIER_LIMITS,
    UNLIMITED,
    Subscription,
    SubscriptionTier,
)
from app.models.user import User, UserRole

NON_CONTRIBUTOR_ROLES = frozenset(FREE_ROLES | {"super_admin"})
_NON_CONTRIBUTOR_ENUMS = [UserRole(r) for r in sorted(NON_CONTRIBUTOR_ROLES)]

# English message templates — the exact strings the fr/ar catalogs translate.
LIMIT_MESSAGES = {
    "max_contributors": (
        "Your current plan allows up to {max} contributors and {current} are already in use. "
        "Viewers, executives and auditors are free. Contact us to upgrade."
    ),
    "max_frameworks": (
        "Your current plan allows up to {max} active frameworks and {current} are already in use. "
        "Existing assessments keep working. Contact us to upgrade."
    ),
    "max_vendors": (
        "Your current plan allows up to {max} third parties and {current} are already registered. "
        "Contact us to upgrade."
    ),
}
COPILOT_MESSAGE = (
    "The AI GRC assistant is included in the Enterprise and Elite plans. Contact us to upgrade."
)
LDAP_CONTRIBUTOR_MESSAGE = (
    "Your organization has reached the contributor limit of its plan ({max}). "
    "Ask your administrator to free a seat or upgrade the plan."
)


def _role_value(role: Any) -> str:
    return (getattr(role, "value", role) or "").lower()


def is_contributor_role(role: Any) -> bool:
    return _role_value(role) not in NON_CONTRIBUTOR_ROLES


def counts_as_contributor(role: Any, is_active: bool | None) -> bool:
    return bool(is_active) and is_contributor_role(role)


async def get_subscription(db: AsyncSession, tenant_id: str) -> Subscription | None:
    return (await db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    )).scalar_one_or_none()


async def effective_plan(db: AsyncSession, tenant_id: str) -> tuple[str, dict]:
    """(stored tier value, effective limits). No subscription row = Growth."""
    sub = await get_subscription(db, tenant_id)
    if sub is None:
        return SubscriptionTier.STARTER.value, dict(TIER_LIMITS[SubscriptionTier.STARTER])
    return sub.tier.value, sub.limits


def _max(limits: dict, key: str) -> int:
    try:
        value = int(limits.get(key, UNLIMITED))
    except (TypeError, ValueError):
        return UNLIMITED
    return value


# ── Counters (fresh SQL every call) ──────────────────────────────────────────

async def count_contributors(db: AsyncSession, tenant_id: str, exclude_user_id: str | None = None) -> int:
    q = select(func.count(User.id)).where(
        User.tenant_id == tenant_id,
        User.is_active == True,  # noqa: E712
        User.role.notin_(_NON_CONTRIBUTOR_ENUMS),
    )
    if exclude_user_id:
        q = q.where(User.id != exclude_user_id)
    return int((await db.execute(q)).scalar() or 0)


async def active_framework_ids(db: AsyncSession, tenant_id: str) -> set[str]:
    from app.models.compliance import ComplianceAssessment
    rows = (await db.execute(
        select(ComplianceAssessment.framework_id)
        .where(ComplianceAssessment.tenant_id == tenant_id)
        .distinct()
    )).scalars().all()
    return {r for r in rows if r}


async def count_vendors(db: AsyncSession, tenant_id: str) -> int:
    from app.models.vendor import Vendor
    return int((await db.execute(
        select(func.count(Vendor.id)).where(Vendor.tenant_id == tenant_id)
    )).scalar() or 0)


# ── Refusal ──────────────────────────────────────────────────────────────────

def plan_limit_detail(limit: str, current: int, maximum: int, tier: str) -> dict:
    return {
        "code": "plan_limit",
        "error": "plan_limit",
        "limit": limit,
        "current": current,
        "max": maximum,
        "tier": tier,
        "plan": PLAN_DISPLAY_NAMES.get(tier, "Growth"),
        "message": LIMIT_MESSAGES[limit].format(max=maximum, current=current),
    }


def plan_limit_exception(limit: str, current: int, maximum: int, tier: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail=plan_limit_detail(limit, current, maximum, tier),
    )


# ── Guards ───────────────────────────────────────────────────────────────────

async def ensure_contributor_seat(
    db: AsyncSession, tenant_id: str, *, exclude_user_id: str | None = None,
) -> None:
    """Raise 402 unless one more contributor fits. Call ONLY when the change
    makes a not-yet-counted user count (create / activate / free→contributor).

    ``exclude_user_id`` keeps the user being edited out of the count — its
    pending in-session change may already be autoflushed by the query."""
    tier, limits = await effective_plan(db, tenant_id)
    maximum = _max(limits, "max_contributors")
    if maximum < 0:
        return
    current = await count_contributors(db, tenant_id, exclude_user_id=exclude_user_id)
    if current + 1 > maximum:
        raise plan_limit_exception("max_contributors", current, maximum, tier)


async def ensure_contributor_change_allowed(
    db: AsyncSession, tenant_id: str, user_id: str,
    *, was_active: bool, old_role: Any, new_active: bool, new_role: Any,
) -> None:
    """Guard an edit of an existing user: refuse only when it turns a
    non-counted account into a counted one."""
    if counts_as_contributor(old_role, was_active):
        return
    if not counts_as_contributor(new_role, new_active):
        return
    await ensure_contributor_seat(db, tenant_id, exclude_user_id=user_id)


async def ensure_framework_slot(db: AsyncSession, tenant_id: str, framework_id: str) -> None:
    """Raise 402 when ``framework_id`` is a NEW framework for the tenant and the
    active-framework quota is full. A framework already assessed always passes."""
    tier, limits = await effective_plan(db, tenant_id)
    maximum = _max(limits, "max_frameworks")
    if maximum < 0:
        return
    active = await active_framework_ids(db, tenant_id)
    if framework_id in active:
        return
    if len(active) + 1 > maximum:
        raise plan_limit_exception("max_frameworks", len(active), maximum, tier)


async def framework_slots_left(db: AsyncSession, tenant_id: str) -> int | None:
    """New frameworks that still fit; None = unlimited."""
    _, limits = await effective_plan(db, tenant_id)
    maximum = _max(limits, "max_frameworks")
    if maximum < 0:
        return None
    return max(0, maximum - len(await active_framework_ids(db, tenant_id)))


async def vendor_slots_left(db: AsyncSession, tenant_id: str) -> tuple[int | None, int, int, str]:
    """(slots left or None=unlimited, current, max, tier)."""
    tier, limits = await effective_plan(db, tenant_id)
    maximum = _max(limits, "max_vendors")
    current = await count_vendors(db, tenant_id)
    if maximum < 0:
        return None, current, maximum, tier
    return max(0, maximum - current), current, maximum, tier


async def ensure_vendor_slot(db: AsyncSession, tenant_id: str) -> None:
    left, current, maximum, tier = await vendor_slots_left(db, tenant_id)
    if left is not None and left < 1:
        raise plan_limit_exception("max_vendors", current, maximum, tier)


# ── Usage ────────────────────────────────────────────────────────────────────

async def tenant_usage(db: AsyncSession, tenant_id: str) -> dict:
    tier, limits = await effective_plan(db, tenant_id)
    sub = await get_subscription(db, tenant_id)
    plan_tier = sub.plan_tier.value if sub else SubscriptionTier.PROFESSIONAL.value
    usage = {
        "contributors": await count_contributors(db, tenant_id),
        "frameworks": len(await active_framework_ids(db, tenant_id)),
        "vendors": await count_vendors(db, tenant_id),
    }
    quota_of = {"contributors": "max_contributors", "frameworks": "max_frameworks", "vendors": "max_vendors"}
    near, over = [], []
    for name, key in quota_of.items():
        maximum = _max(limits, key)
        if maximum < 0:
            continue
        used = usage[name]
        if used > maximum or (maximum == 0 and used > 0):
            over.append(name)
        elif used >= maximum or (maximum > 0 and used >= 0.9 * maximum):
            # at the limit: the next addition is refused -> warn as "near"
            near.append(name)
    return {
        "tier": tier,
        "plan_tier": plan_tier,
        "plan": PLAN_DISPLAY_NAMES.get(plan_tier, "Growth"),
        "status": sub.status.value if sub and sub.status else None,
        "limits": {key: _max(limits, key) for key in ENFORCED_QUOTAS}
                  | {"ai_copilot": bool(sub.has_feature("ai_copilot")) if sub else False},
        "usage": usage,
        "near_limit": near,
        "over_limit": over,
    }
