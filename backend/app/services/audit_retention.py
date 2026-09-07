"""Retention for the audit trail: seal, then purge — never purge alone.

See :mod:`app.models.audit_log_seal` for why a plain delete is not an option on
a hash-chained trail.

Safety is deliberately layered, because this is the only operation in the
platform that destroys evidence:

* a dry run is the default, and reports exactly what would go;
* a written reason is required and stored in the seal;
* nothing younger than :data:`ABSOLUTE_FLOOR_DAYS` is ever eligible, whatever
  the configured policy says, so a mistyped retention cannot erase last week;
* the seal is written and committed *before* the entries are removed, so an
  interruption leaves a seal covering entries that still exist (harmless and
  visible) rather than a gap covered by nothing.
"""
import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_log import ActivityLog
from app.models.audit_log_seal import AuditLogSeal
from app.models.tenant import Tenant

# No policy may purge anything younger than this. A bank's obligation is
# measured in years; a retention setting that would remove the last few months
# is far more likely to be a mistake than an intention.
ABSOLUTE_FLOOR_DAYS = 365

DEFAULT_POLICY = {
    "enabled": False,        # sealing is an explicit act, never a default
    "retention_days": 3650,  # ten years — the usual banking obligation
}


def resolve_policy(tenant_settings: dict | None) -> dict:
    policy = dict(DEFAULT_POLICY)
    if isinstance(tenant_settings, dict):
        override = tenant_settings.get("audit_retention")
        if isinstance(override, dict):
            for key in DEFAULT_POLICY:
                if key in override:
                    policy[key] = override[key]
    try:
        policy["retention_days"] = max(ABSOLUTE_FLOOR_DAYS, int(policy["retention_days"]))
    except (TypeError, ValueError):
        policy["retention_days"] = DEFAULT_POLICY["retention_days"]
    return policy


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def compute_seal_hash(seal: AuditLogSeal) -> str:
    payload = "|".join([
        seal.tenant_id or "", str(seal.from_seq), str(seal.to_seq),
        str(seal.entry_count), seal.first_prev_hash or "", seal.last_entry_hash or "",
        seal.entries_digest or "", seal.prev_seal_hash or "",
        seal.reason or "",
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def _last_seal(db: AsyncSession, tenant_id: str) -> AuditLogSeal | None:
    return (await db.execute(
        select(AuditLogSeal)
        .where(AuditLogSeal.tenant_id == tenant_id)
        .order_by(AuditLogSeal.to_seq.desc())
        .limit(1)
    )).scalars().first()


async def preview(db: AsyncSession, tenant_id: str, retention_days: int | None = None) -> dict:
    """What the policy would seal and purge, without touching anything."""
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    policy = resolve_policy(getattr(tenant, "settings", None))
    days = max(ABSOLUTE_FLOOR_DAYS, int(retention_days or policy["retention_days"]))
    cutoff = _utcnow() - timedelta(days=days)

    last = await _last_seal(db, tenant_id)
    start_seq = (last.to_seq + 1) if last else 1

    rows = (await db.execute(
        select(ActivityLog)
        .where(ActivityLog.tenant_id == tenant_id,
               ActivityLog.seq.isnot(None),
               ActivityLog.seq >= start_seq,
               ActivityLog.created_at < cutoff)
        .order_by(ActivityLog.seq.asc())
    )).scalars().all()

    total = (await db.execute(
        select(func.count(ActivityLog.id)).where(ActivityLog.tenant_id == tenant_id)
    )).scalar() or 0

    # Only a contiguous run from start_seq may be sealed: a seal stands in for a
    # range, and a range with holes in it proves nothing.
    eligible = []
    expected = start_seq
    for row in rows:
        if row.seq != expected:
            break
        eligible.append(row)
        expected += 1

    return {
        "policy": policy,
        "retention_days": days,
        "cutoff": cutoff.isoformat(timespec="seconds"),
        "total_entries": total,
        "eligible_count": len(eligible),
        "from_seq": eligible[0].seq if eligible else None,
        "to_seq": eligible[-1].seq if eligible else None,
        "period_start": eligible[0].created_at.isoformat(timespec="seconds") if eligible else None,
        "period_end": eligible[-1].created_at.isoformat(timespec="seconds") if eligible else None,
        "_rows": eligible,
    }


async def seal_and_purge(
    db: AsyncSession, tenant_id: str, reason: str, actor,
    retention_days: int | None = None,
) -> dict:
    """Seal the eligible range, commit the seal, then remove the entries."""
    plan = await preview(db, tenant_id, retention_days)
    rows = plan.pop("_rows")
    if not rows:
        return {**plan, "sealed": False, "purged": 0}

    digest = hashlib.sha256(
        "|".join(r.entry_hash or "" for r in rows).encode("utf-8")
    ).hexdigest()

    previous = await _last_seal(db, tenant_id)
    seal = AuditLogSeal(
        tenant_id=tenant_id,
        from_seq=rows[0].seq, to_seq=rows[-1].seq, entry_count=len(rows),
        period_start=rows[0].created_at, period_end=rows[-1].created_at,
        first_prev_hash=rows[0].prev_hash or "",
        last_entry_hash=rows[-1].entry_hash or "",
        entries_digest=digest,
        reason=reason,
        retention_days=plan["retention_days"],
        sealed_by_id=getattr(actor, "id", None),
        sealed_by_email=getattr(actor, "email", None),
        prev_seal_hash=previous.seal_hash if previous else "",
    )
    seal.seal_hash = compute_seal_hash(seal)
    db.add(seal)
    # Committed before the delete on purpose: if this is interrupted, a seal
    # covering entries that still exist is harmless and visible, whereas a gap
    # covered by nothing is the failure this whole design exists to prevent.
    await db.commit()

    for row in rows:
        await db.delete(row)
    await db.commit()

    return {
        **plan,
        "sealed": True,
        "purged": len(rows),
        "seal_id": seal.id,
        "seal_hash": seal.seal_hash,
        "entries_digest": digest,
    }
