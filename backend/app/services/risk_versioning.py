"""Archive a risk's state before each change, and expose the differences.

Writes into the caller's session and lets the caller commit — the discipline the
rest of this codebase settled on after the audit-chain helper deadlocked by
opening its own session while the caller held SQLite's write lock.
"""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.risk import Risk
from app.models.risk_version import RiskVersion
from app.models.user import User

# What a version captures. Enough to reconstruct the assessment and the
# lifecycle position; not the generated columns, which say nothing about a
# decision anybody made.
SNAPSHOT_FIELDS = (
    "title", "description", "risk_category", "status", "owner_id",
    "likelihood", "impact", "severity",
    "residual_likelihood", "residual_impact",
    "target_likelihood", "target_impact",
    "appetite_threshold", "risk_matrix_id", "next_review_date",
)

# A change to any of these is worth a version on its own. Editing a description
# is not the same event as moving a risk from assessed to closed, but both
# belong in the history.
def _value(risk: Risk, field: str):
    value = getattr(risk, field, None)
    return getattr(value, "value", value)


def snapshot(risk: Risk) -> dict:
    return {f: _value(risk, f) for f in SNAPSHOT_FIELDS}


def diff(before: dict, after: dict) -> dict:
    """{"field": {"from": x, "to": y}} for the fields that actually moved."""
    fields = set(before) | set(after)
    return {
        f: {"from": before.get(f), "to": after.get(f)}
        for f in sorted(fields)
        if before.get(f) != after.get(f)
    }


async def archive(
    db: AsyncSession,
    risk: Risk,
    actor: User | None,
    change_reason: str | None = None,
    transition_from: str | None = None,
    transition_to: str | None = None,
) -> RiskVersion:
    """Record the risk's current state as the next version. Caller commits.

    Called *before* the risk is mutated, so version N is the state the Nth edit
    started from.
    """
    count = (await db.execute(
        select(func.count()).select_from(RiskVersion).where(RiskVersion.risk_id == risk.id)
    )).scalar() or 0
    version = RiskVersion(
        risk_id=risk.id,
        tenant_id=risk.tenant_id,
        version_number=int(count) + 1,
        snapshot=snapshot(risk),
        risk_title=risk.title,
        transition_from=transition_from,
        transition_to=transition_to,
        change_reason=change_reason,
        author_id=getattr(actor, "id", None),
        author_email=getattr(actor, "email", None),
    )
    db.add(version)
    return version
