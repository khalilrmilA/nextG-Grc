"""Change history for the applied-controls register.

Writes into the **caller's** session and lets the caller commit — the same
discipline as :mod:`app.services.threat_registry`. An isolated session cannot
write while the caller holds SQLite's write lock, which is how the audit-chain
helper deadlocked earlier in this codebase.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applied_control import AppliedControl
from app.models.applied_control_history import AppliedControlHistory
from app.models.user import User

# Fields whose before/after is worth keeping. Excludes generated columns and the
# validation bookkeeping the action itself already describes.
TRACKED_FIELDS = (
    "ref_id", "name", "description", "category", "csf_function",
    "status", "progress", "eta", "expiration",
    "effort", "cost", "recurring_cost",
    "framework_control_ids", "risk_scenario_ids", "risk_ids",
    "vulnerability_ids", "evidence_ids",
    "owner_id", "link", "tags",
)

# A change to any of these is a change to the control's operational state, and
# the requirement singles that out for "traçabilité complète".
STATUS_FIELDS = ("status", "progress", "expiration")


def snapshot(control: AppliedControl) -> dict:
    out = {}
    for field in TRACKED_FIELDS:
        value = getattr(control, field, None)
        out[field] = list(value) if isinstance(value, list) else (
            value if not hasattr(value, "value") else value.value
        )
    return out


def diff(before: dict, after: dict) -> dict:
    return {
        field: {"from": before.get(field), "to": after.get(field)}
        for field in after
        if before.get(field) != after.get(field)
    }


def record(
    db: AsyncSession,
    control: AppliedControl,
    action: str,
    actor: User | None = None,
    changes: dict | None = None,
    note: str | None = None,
) -> AppliedControlHistory:
    """Append one history row. The caller commits."""
    entry = AppliedControlHistory(
        applied_control_id=control.id,
        tenant_id=control.tenant_id or (actor.tenant_id if actor else None),
        control_ref_id=getattr(control, "ref_id", None),
        control_name=control.name,
        action=action,
        changes=changes or {},
        note=note,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
    )
    db.add(entry)
    return entry


def action_for(changes: dict) -> str:
    """"status_changed" when the operational state moved, else "updated".

    Distinguished because the requirement treats a status change as its own
    traceability obligation, and a reviewer scanning the history wants to find
    those without reading every field diff.
    """
    return "status_changed" if any(f in changes for f in STATUS_FIELDS) else "updated"
