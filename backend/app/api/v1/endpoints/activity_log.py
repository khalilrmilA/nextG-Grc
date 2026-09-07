"""Activity Log endpoints — audit trail for all user actions."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.models.user import User, UserRole
from app.models.audit_log_seal import AuditLogSeal
from app.services import audit_retention
from app.models.activity_log import ActivityLog
from app.models.tenant import Tenant
from app.services.activity_chain import chain_and_add
from app.models.login_event import LoginEvent
from app.services.activity_chain import compute_entry_hash, _utcnow

router = APIRouter()


class LogEntry(BaseModel):
    id: str
    user_id: str
    user_email: str
    action: str
    entity_type: str
    entity_id: str | None
    entity_name: str | None
    details: dict | None
    ip_address: str | None
    origin: str | None = None
    seq: int | None = None
    entry_hash: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class LogListResponse(BaseModel):
    items: list[LogEntry]
    total: int


# Who may read the audit trail. "Seules les personnes autorisées peuvent
# consulter ces informations, comme les auditeurs externes quand ils ont la
# permission" — every endpoint here was open to any authenticated user, so a
# viewer could read who did what across the whole organisation. The trail
# records security actions, account changes and their actors; it is not
# general-purpose reporting.
#
# The auditor role is included deliberately: an external auditor is exactly the
# reader the requirement names, and they already reach the platform through the
# auditor portal. require_roles() also auto-passes tenant_admin and super_admin.
AUDIT_READERS = (
    UserRole.CISO,
    UserRole.COMPLIANCE_MANAGER,
    UserRole.AUDITOR,
    UserRole.RISK_MANAGER,
)


@router.get("", response_model=LogListResponse)
async def list_activity_logs(
    entity_type: str | None = None,
    action: str | None = None,
    user_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*AUDIT_READERS)),
    tenant_id: str = Depends(get_tenant_id),
):
    """List activity logs with optional filtering."""
    q = select(ActivityLog).where(ActivityLog.tenant_id == tenant_id)
    cq = select(func.count(ActivityLog.id)).where(ActivityLog.tenant_id == tenant_id)

    if entity_type:
        q = q.where(ActivityLog.entity_type == entity_type)
        cq = cq.where(ActivityLog.entity_type == entity_type)
    if action:
        q = q.where(ActivityLog.action == action)
        cq = cq.where(ActivityLog.action == action)
    if user_id:
        q = q.where(ActivityLog.user_id == user_id)
        cq = cq.where(ActivityLog.user_id == user_id)

    total = (await db.execute(cq)).scalar() or 0
    items = list((await db.execute(q.order_by(ActivityLog.created_at.desc()).limit(limit).offset(offset))).scalars().all())

    return LogListResponse(
        items=[LogEntry.model_validate(i) for i in items],
        total=total,
    )


@router.get("/verify")
async def verify_chain(
    db: AsyncSession = Depends(get_db),
    # Feature entitlement AND role. require_feature alone is a billing check —
    # it says the tenant bought the capability, not that this user may use it.
    _feature: User = Depends(require_feature("tamper_evident_log")),
    _: User = Depends(require_roles(*AUDIT_READERS)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Recompute the tenant's activity-log hash chain and report its integrity (Elite Pack).

    Walks the chained entries in seq order; any tampered/deleted/reordered row makes the
    recomputed hash diverge and is reported as the first broken sequence number.
    """
    # Ranges that retention removed. Verification walks *across* a seal rather
    # than stopping at the gap: the surviving entry after a sealed range must
    # still carry that range's last hash as its prev_hash, so the chain stays
    # provable end to end with the removed entries accounted for.
    seals = list((await db.execute(
        select(AuditLogSeal)
        .where(AuditLogSeal.tenant_id == tenant_id)
        .order_by(AuditLogSeal.from_seq.asc())
    )).scalars().all())

    rows = list((await db.execute(
        select(ActivityLog)
        .where(ActivityLog.tenant_id == tenant_id, ActivityLog.seq.isnot(None))
        .order_by(ActivityLog.seq.asc())
    )).scalars().all())

    unchained = (await db.execute(
        select(func.count(ActivityLog.id)).where(
            ActivityLog.tenant_id == tenant_id, ActivityLog.seq.is_(None)
        )
    )).scalar() or 0

    prev_hash = ""
    expected_seq = 1
    broken_seq: int | None = None
    reason: str | None = None

    # Replay the seals first: each stands in for a contiguous purged range and
    # hands the chain on at the hash it recorded. A tampered or removed seal
    # shows up here as a broken seal chain, not as a silent gap.
    prev_seal_hash = ""
    sealed_total = 0
    for seal in seals:
        if seal.prev_seal_hash != prev_seal_hash:
            broken_seq, reason = seal.from_seq, "seal chain broken (a seal was altered or removed)"
            break
        if audit_retention.compute_seal_hash(seal) != seal.seal_hash:
            broken_seq, reason = seal.from_seq, "seal hash mismatch (the seal was altered)"
            break
        if seal.from_seq != expected_seq:
            broken_seq, reason = seal.from_seq, (
                f"sealed range does not continue the chain "
                f"(expected {expected_seq}, seal starts at {seal.from_seq})"
            )
            break
        if (seal.first_prev_hash or "") != prev_hash:
            broken_seq, reason = seal.from_seq, "sealed range does not link to the entry before it"
            break
        prev_hash = seal.last_entry_hash
        expected_seq = seal.to_seq + 1
        prev_seal_hash = seal.seal_hash
        sealed_total += seal.entry_count

    for row in (rows if broken_seq is None else []):
        if row.seq != expected_seq:
            broken_seq, reason = row.seq, f"sequence gap (expected {expected_seq}, got {row.seq})"
            break
        if (row.prev_hash or "") != prev_hash:
            broken_seq, reason = row.seq, "prev_hash mismatch"
            break
        if row.entry_hash != compute_entry_hash(row, prev_hash):
            broken_seq, reason = row.seq, "entry_hash mismatch (row was altered)"
            break
        prev_hash = row.entry_hash
        expected_seq += 1

    return {
        "valid": broken_seq is None,
        "chained_entries": len(rows),
        "unchained_legacy_entries": unchained,
        # Entries removed under the retention policy, still provable through
        # their seals. Reported separately so "fewer rows than expected" is
        # never mistaken for loss.
        "sealed_entries": sealed_total,
        "seals": len(seals),
        "first_broken_seq": broken_seq,
        "reason": reason,
        "verified_at": _utcnow().isoformat(timespec="seconds"),
    }


class RetentionPolicyOut(BaseModel):
    enabled: bool
    retention_days: int
    absolute_floor_days: int
    cutoff: str
    total_entries: int
    eligible_count: int
    from_seq: int | None = None
    to_seq: int | None = None
    period_start: str | None = None
    period_end: str | None = None


class RetentionPolicyUpdate(BaseModel):
    enabled: bool | None = None
    retention_days: int | None = None


class SealRequest(BaseModel):
    # Long enough to be a justification rather than a keystroke. This is the
    # only record of why evidence was destroyed.
    reason: str = Field(..., min_length=20)
    retention_days: int | None = None
    # Destroying evidence is not something to do by omission.
    confirm: bool = False


class SealOut(BaseModel):
    id: str
    from_seq: int; to_seq: int; entry_count: int
    period_start: datetime | None = None
    period_end: datetime | None = None
    entries_digest: str
    seal_hash: str
    reason: str
    retention_days: int | None = None
    sealed_by_email: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


@router.get("/retention", response_model=RetentionPolicyOut)
async def get_retention(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*AUDIT_READERS)),
    tenant_id: str = Depends(get_tenant_id),
):
    """The retention policy and what it currently makes eligible for sealing."""
    plan = await audit_retention.preview(db, tenant_id)
    plan.pop("_rows", None)
    return RetentionPolicyOut(
        enabled=plan["policy"]["enabled"],
        retention_days=plan["retention_days"],
        absolute_floor_days=audit_retention.ABSOLUTE_FLOOR_DAYS,
        cutoff=plan["cutoff"], total_entries=plan["total_entries"],
        eligible_count=plan["eligible_count"],
        from_seq=plan["from_seq"], to_seq=plan["to_seq"],
        period_start=plan["period_start"], period_end=plan["period_end"],
    )


@router.patch("/retention", response_model=RetentionPolicyOut)
async def set_retention(
    body: RetentionPolicyUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Set how long the organisation keeps its audit trail.

    Administrator only, and recorded in the trail itself: the retention period
    is a governance decision, and changing it is the change that decides how
    much evidence survives.
    """
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    patch = body.model_dump(exclude_unset=True)
    if "retention_days" in patch and patch["retention_days"] is not None:
        if int(patch["retention_days"]) < audit_retention.ABSOLUTE_FLOOR_DAYS:
            raise HTTPException(
                422,
                f"Retention cannot be shorter than {audit_retention.ABSOLUTE_FLOOR_DAYS} days. "
                f"A shorter period is far more likely to be a mistake than an intention.",
            )

    settings_dict = dict(tenant.settings or {})
    block = dict(settings_dict.get("audit_retention") or {})
    before = dict(block)
    for key, value in patch.items():
        if value is not None:
            block[key] = value
    settings_dict["audit_retention"] = block
    tenant.settings = settings_dict
    await db.commit()

    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=user.id, user_email=user.email,
        action="update", entity_type="audit_retention_policy", entity_id=tenant_id,
        entity_name="Audit trail retention policy",
        details={"from": before, "to": block},
    ))
    await db.commit()
    return await get_retention(db=db, _=user, tenant_id=tenant_id)


@router.post("/retention/seal")
async def seal_retention(
    body: SealRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.TENANT_ADMIN)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Seal and remove audit entries older than the retention period.

    The only operation in the platform that destroys evidence, so it is
    administrator-only, needs a written reason, and does nothing without an
    explicit ``confirm``. Without confirmation it reports what *would* go.

    The removed range is not simply deleted: a seal records its sequence range,
    period, entry count, closing hash and a digest over every entry hash in it,
    and is itself chained to the previous seal. Verification then walks across
    the seal, so exercising retention leaves the chain provable rather than
    apparently tampered with.
    """
    plan = await audit_retention.preview(db, tenant_id, body.retention_days)
    plan.pop("_rows", None)
    if not body.confirm:
        return {**plan, "dry_run": True, "sealed": False, "purged": 0,
                "message": ("Nothing eligible." if not plan["eligible_count"]
                            else f"{plan['eligible_count']} entries would be sealed and removed. "
                                 f"Re-send with confirm=true to proceed.")}

    result = await audit_retention.seal_and_purge(
        db, tenant_id, body.reason.strip(), user, body.retention_days
    )
    if result.get("sealed"):
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=user.id, user_email=user.email,
            action="delete", entity_type="audit_log_seal", entity_id=result.get("seal_id"),
            entity_name=f"Sealed audit entries {result['from_seq']}-{result['to_seq']}",
            details={"reason": body.reason.strip(), "purged": result["purged"],
                     "entries_digest": result["entries_digest"],
                     "seal_hash": result["seal_hash"]},
        ))
        await db.commit()
    return {**result, "dry_run": False}


@router.get("/seals", response_model=list[SealOut])
async def list_seals(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*AUDIT_READERS)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Every range retention has removed, and on whose authority."""
    rows = (await db.execute(
        select(AuditLogSeal).where(AuditLogSeal.tenant_id == tenant_id)
        .order_by(AuditLogSeal.from_seq.asc())
    )).scalars().all()
    return [SealOut.model_validate(r) for r in rows]


class LoginEventOut(BaseModel):
    id: str
    tenant_id: str | None
    user_id: str | None
    email: str
    success: bool
    reason: str | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


@router.get("/login-events", response_model=list[LoginEventOut])
async def list_login_events(
    success: bool | None = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    # Who signed in, when and from where is exactly the data the requirement
    # restricts. The feature flag says the tenant bought the capability; the
    # role says this person may read it.
    _feature: User = Depends(require_feature("tamper_evident_log")),
    _: User = Depends(require_roles(*AUDIT_READERS)),
    tenant_id: str = Depends(get_tenant_id),
):
    """List authentication attempts for the tenant, newest first (Elite Pack).

    Includes failures (bad password / locked / unknown user) that never reach the
    normal activity log.
    """
    q = select(LoginEvent).where(LoginEvent.tenant_id == tenant_id)
    if success is not None:
        q = q.where(LoginEvent.success == success)
    rows = (await db.execute(q.order_by(LoginEvent.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    return [LoginEventOut.model_validate(r) for r in rows]


async def log_activity(
    db: AsyncSession,
    tenant_id: str,
    user: User,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    entity_name: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
):
    """Helper to create an activity log entry. Call from other endpoints."""
    entry = ActivityLog(
        tenant_id=tenant_id,
        user_id=user.id,
        user_email=user.email,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        details=details,
        ip_address=ip_address,
    )
    db.add(entry)
