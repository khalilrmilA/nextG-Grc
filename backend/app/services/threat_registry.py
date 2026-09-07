"""Threat register helpers: change history, profile state, review cadence.

Everything here writes into the **caller's** session and lets the caller
commit. That is deliberate: an isolated session cannot write while the caller
still holds SQLite's single write lock, which is how the audit-chain helper
deadlocked earlier in this codebase. One transaction means the threat change
and the record of it either both land or neither does.
"""
from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.threat import (
    CATEGORY_TO_TYPE,
    REQUIRED_PROFILE_FIELDS,
    Threat,
    ThreatType,
    missing_profile_fields,
)

# Fields that make up the signed-off profile. Editing any of them invalidates a
# validation, wherever the edit came in — some live on the main record rather
# than the profile payload.
PROFILE_FIELDS = frozenset(REQUIRED_PROFILE_FIELDS) | {
    "objectives", "mode_operatoire", "aggravating_factors", "estimated_frequency",
    "threat_type", "linked_asset_ids", "linked_vulnerability_ids",
}
from app.models.threat_history import ThreatHistory
from app.models.user import User

# Fields whose before/after is worth keeping. Deliberately excludes generated
# columns (updated_at) and the validation bookkeeping the action itself already
# describes, so a diff shows the change rather than its own side effects.
TRACKED_FIELDS = (
    "ref_id", "name", "description", "category", "threat_type",
    "typical_threat_actors", "typical_attack_vectors", "affected_assets", "mitre_ids",
    "origin", "objectives", "aggravating_factors", "occurrence_conditions",
    "estimated_frequency", "mode_operatoire", "probability_level", "severity_level",
    "linked_asset_ids", "linked_vulnerability_ids",
    "review_frequency_months", "is_pending",
)


def snapshot(threat: Threat) -> dict:
    """Current values of the tracked fields, safe to compare and to store."""
    out = {}
    for field in TRACKED_FIELDS:
        value = getattr(threat, field, None)
        out[field] = list(value) if isinstance(value, list) else value
    return out


def diff(before: dict, after: dict) -> dict:
    """{"field": {"from": x, "to": y}} for the fields that actually moved."""
    return {
        field: {"from": before.get(field), "to": after.get(field)}
        for field in after
        if before.get(field) != after.get(field)
    }


def record(
    db: AsyncSession,
    threat: Threat,
    action: str,
    actor: User | None = None,
    changes: dict | None = None,
    note: str | None = None,
) -> ThreatHistory:
    """Append one history row. The caller commits.

    ``tenant_id`` comes from the threat where it has one; a built-in has none,
    so the caller passes the acting user's tenant instead — a built-in is only
    ever touched through an adoption, which belongs to that tenant.
    """
    tenant_id = threat.tenant_id or (actor.tenant_id if actor else None)
    entry = ThreatHistory(
        threat_id=threat.id,
        tenant_id=tenant_id,
        threat_ref_id=threat.ref_id,
        threat_name=threat.name,
        action=action,
        changes=changes or {},
        note=note,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
    )
    db.add(entry)
    return entry


def effective_type(threat: Threat) -> tuple[str | None, bool]:
    """(type, was_derived). A derived type is a default, not an assessment."""
    if threat.threat_type:
        return threat.threat_type, False
    category = threat.category if isinstance(threat.category, str) else getattr(threat.category, "value", None)
    return CATEGORY_TO_TYPE.get(category or ""), True


def _add_months(start: date, months: int) -> date:
    """Calendar-month arithmetic without a dateutil dependency.

    Clamps the day so a review set on the 31st does not fall off the end of a
    short month — the alternative (rolling into the next month) quietly moves
    every subsequent due date.
    """
    total = (start.year * 12 + start.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    day = min(start.day, [31, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28,
                          31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def schedule_next_review(threat: Threat, from_date: date | None = None) -> str:
    """Set and return the next review due date from the cadence."""
    months = threat.review_frequency_months or 12
    due = _add_months(from_date or date.today(), max(1, months))
    threat.next_review_due = due.isoformat()
    return threat.next_review_due


def review_is_overdue(threat: Threat, today: date | None = None) -> bool:
    if not threat.next_review_due:
        return False
    try:
        due = date.fromisoformat(str(threat.next_review_due)[:10])
    except ValueError:
        return False
    return due < (today or date.today())


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def profile_gaps(threat: Threat) -> list[str]:
    """Re-exported so endpoints do not reach into the model for it."""
    return missing_profile_fields(threat)


VALID_TYPES = tuple(t.value for t in ThreatType)
