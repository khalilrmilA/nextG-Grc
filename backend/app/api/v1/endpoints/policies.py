"""Policy Management — full policy lifecycle with versioning and attestations."""
import io
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_user_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.policy import Policy, PolicyVersion, PolicyAttestation, PolicyStatus, AttestationStatus
from app.models.framework import Framework, FrameworkControl
from app.models.tenant import Tenant
from app.models.org_unit import OrgEntity, BusinessProcess
from app.services import pdf_arabic
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

router = APIRouter()


def _enum_or_400(enum_cls, value: str, field: str):
    """Coerce a request string onto an enum, answering 400 rather than 500.

    ``PolicyStatus(body.status)`` raises ValueError on an unknown value, which FastAPI
    reports as a 500 — a client typo read as a server fault, and one that leaks a
    traceback on this box (DEBUG is on in production)."""
    try:
        return enum_cls(value)
    except ValueError:
        raise HTTPException(
            400, "%s must be one of: %s" % (field, ", ".join(e.value for e in enum_cls)),
        )


# ── Schemas ──────────────────────────────────────────────────────────────

class PolicyCreate(BaseModel):
    title: str
    description: str | None = None
    category: str | None = None
    policy_number: str | None = None
    owner_id: str | None = None
    status: str | None = None  # draft, in_review, approved, published
    linked_controls: list[str] = []
    review_frequency_months: int = 12
    next_review_date: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    business_process_id: str | None = None
    org_entity_id: str | None = None
    content: str | None = None  # initial version content

class PolicyUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    status: str | None = None
    owner_id: str | None = None
    linked_controls: list[str] | None = None
    review_frequency_months: int | None = None
    next_review_date: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    business_process_id: str | None = None
    org_entity_id: str | None = None

class PolicyOut(BaseModel):
    id: str; tenant_id: str; title: str; policy_number: str | None
    description: str | None; category: str | None; owner_id: str | None
    status: str; linked_controls: list; review_frequency_months: int
    next_review_date: str | None
    effective_date: str | None = None; expiration_date: str | None = None
    business_process_id: str | None = None; org_entity_id: str | None = None
    version_count: int = 0
    attestation_count: int = 0; pending_attestations: int = 0
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

# « Permet de gérer un référentiel centralisé des […] politiques internes » — the link
# between an internal policy and the requirement it satisfies. It existed as a JSON
# column nothing could write on purpose and nothing could read back except as a count.

class LinkedControlOut(BaseModel):
    """One requirement a policy claims to cover, resolved for display."""
    id: str
    control_ref: str            # "A.5.1" — what an auditor calls it
    title: str
    framework_id: str
    framework_name: str | None = None
    framework_short_name: str | None = None
    domain: str | None = None
    requirement_type: str | None = None

class CoveringPolicyOut(BaseModel):
    """One internal policy that covers a requirement."""
    id: str
    title: str
    policy_number: str | None
    category: str | None
    status: str
    owner_id: str | None
    effective_date: str | None
    next_review_date: str | None
    current_version_number: int | None = None
    matched_on: str            # "id" | "reference" — how the link was recorded

class ControlPoliciesOut(BaseModel):
    """The requirement, plus every internal policy that claims to cover it."""
    control_id: str | None
    control_ref: str | None
    control_title: str | None
    framework_id: str | None
    framework_short_name: str | None
    policies: list[CoveringPolicyOut] = []

class VersionCreate(BaseModel):
    content: str
    change_summary: str | None = None

class VersionOut(BaseModel):
    id: str; policy_id: str; version_number: int; content: str
    change_summary: str | None; is_current: bool
    authored_by_id: str | None; approved_by_id: str | None; approved_at: str | None
    created_at: datetime
    model_config = {"from_attributes": True}

class AttestationCreate(BaseModel):
    user_ids: list[str]
    due_date: str | None = None

class AttestationOut(BaseModel):
    id: str; policy_id: str; policy_version_id: str; user_id: str
    status: str; due_date: str | None; acknowledged_at: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────

async def _policy(db, pid, tid):
    r = await db.execute(select(Policy).where(Policy.id == pid, Policy.tenant_id == tid))
    p = r.scalar_one_or_none()
    if not p: raise HTTPException(404, "Policy not found")
    return p

async def _assert_process_in_tenant(db, process_id, tenant_id):
    """Close cross-tenant IDOR on attacker-supplied business_process_id (mirrors assert_user_in_tenant)."""
    if not process_id: return
    r = await db.execute(select(BusinessProcess.id).where(BusinessProcess.id == process_id, BusinessProcess.tenant_id == tenant_id))
    if r.scalar_one_or_none() is None:
        raise HTTPException(400, "Invalid business_process_id: not in this tenant")

async def _assert_entity_in_tenant(db, entity_id, tenant_id):
    """Close cross-tenant IDOR on attacker-supplied org_entity_id (mirrors assert_user_in_tenant)."""
    if not entity_id: return
    r = await db.execute(select(OrgEntity.id).where(OrgEntity.id == entity_id, OrgEntity.tenant_id == tenant_id))
    if r.scalar_one_or_none() is None:
        raise HTTPException(400, "Invalid org_entity_id: not in this tenant")

def _visible_frameworks(tenant_id):
    """Built-in frameworks are shared; a tenant additionally sees its own forks."""
    return (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id)  # noqa: E712


async def _scope_framework_ids(db, tenant_id) -> set[str]:
    """The frameworks this organisation actually works with: the ones it selected plus
    the forks it owns.

    Needed because a bare control REFERENCE is nowhere near unique: 452 references in
    the built-in catalogue ("5.1", "6.2", "A.5.1" ...) exist in up to fifteen different
    frameworks at once. Matching a stored reference against every visible framework
    therefore claims a policy covers fifteen unrelated requirements. Narrowing to the
    organisation's own scope is what turns that back into one answer."""
    ids: set[str] = set()
    selected = (await db.execute(
        select(Tenant.selected_framework_ids).where(Tenant.id == tenant_id)
    )).scalar_one_or_none()
    for fid in (selected or []):
        if fid:
            ids.add(str(fid))
    for (fid,) in (await db.execute(
        select(Framework.id).where(Framework.tenant_id == tenant_id)
    )).all():
        ids.add(fid)
    return ids


def _narrow(candidates: list, scope: set[str]) -> list:
    """Cut a set of same-reference controls down to the organisation's own scope.

    ``candidates`` are ``(control, framework)`` pairs. A tenant-owned fork wins over a
    built-in carrying the same numbering — it is the copy the organisation edits."""
    if len(candidates) <= 1:
        return candidates
    narrowed = [pair for pair in candidates if pair[1].id in scope] or candidates
    if len(narrowed) > 1:
        owned = [pair for pair in narrowed if not pair[1].is_builtin]
        if owned:
            narrowed = owned
    return narrowed


async def _normalize_linked_controls(db, tenant_id, refs: list[str], *, strict: bool = True) -> list[str]:
    """Validate `linked_controls` and pin each entry to a real requirement.

    The column holds two shapes today and both have to keep working: the policy
    generator writes the control REFERENCE ("A.5.1"), while the gap-driven flow writes
    the FrameworkControl id. An unambiguous reference is normalised to the id, so new
    links point at exactly one requirement; a reference that exists in several visible
    frameworks is kept as typed rather than silently pinned to whichever row came back
    first — the by-control lookup below matches both shapes, so it still resolves.

    An entry matching nothing this tenant can see is refused when ``strict`` — a policy
    claiming to cover a requirement nobody can name is the kind of link an auditor asks
    about. Creation passes ``strict=False``: the AI generator hands over whatever the
    document was written against, and losing a just-generated policy to a 422 over one
    stale reference would be a worse outcome than storing that reference unresolved.
    """
    wanted = list(dict.fromkeys(str(r).strip() for r in (refs or []) if str(r).strip()))
    if not wanted:
        return []
    rows = (await db.execute(
        select(FrameworkControl, Framework)
        .join(Framework, FrameworkControl.framework_id == Framework.id)
        .where(
            _visible_frameworks(tenant_id),
            (FrameworkControl.id.in_(wanted)) | (FrameworkControl.control_id.in_(wanted)),
        )
    )).all()
    by_id = {c.id: (c, fw) for c, fw in rows}
    by_ref: dict[str, list] = {}
    for c, fw in rows:
        by_ref.setdefault(c.control_id, []).append((c, fw))
    scope = await _scope_framework_ids(db, tenant_id) if by_ref else set()

    out: list[str] = []
    unknown: list[str] = []
    for ref in wanted:
        if ref in by_id:
            out.append(ref)
            continue
        candidates = _narrow(by_ref.get(ref, []), scope)
        if len(candidates) == 1:
            out.append(candidates[0][0].id)
        elif candidates:
            out.append(ref)                     # still ambiguous — kept as typed
        else:
            unknown.append(ref)
    if unknown and strict:
        raise HTTPException(
            422,
            "Unknown control(s): %s. A linked control must be a control id or a control "
            "reference from a framework this organisation can see." % ", ".join(unknown[:10]),
        )
    return list(dict.fromkeys(out + unknown))


async def _resolve_controls(db, tenant_id, refs: list[str]) -> list[LinkedControlOut]:
    """Turn stored `linked_controls` entries into something displayable.

    Unresolvable entries are dropped rather than raising: a framework can be deleted
    after a policy linked to it, and that must not break the policy page."""
    wanted = list(dict.fromkeys(str(r).strip() for r in (refs or []) if str(r).strip()))
    if not wanted:
        return []
    rows = (await db.execute(
        select(FrameworkControl, Framework)
        .join(Framework, FrameworkControl.framework_id == Framework.id)
        .where(
            _visible_frameworks(tenant_id),
            (FrameworkControl.id.in_(wanted)) | (FrameworkControl.control_id.in_(wanted)),
        )
    )).all()
    by_id = {c.id: (c, fw) for c, fw in rows}
    by_ref: dict[str, list] = {}
    for c, fw in rows:
        by_ref.setdefault(c.control_id, []).append((c, fw))
    scope = await _scope_framework_ids(db, tenant_id) if by_ref else set()

    # Resolved ENTRY BY ENTRY, not row by row: a stored reference such as "5.1" matches a
    # control in fifteen built-in frameworks, and returning all fifteen would tell the
    # reviewer this policy covers fifteen requirements it has never heard of. _narrow
    # keeps the organisation's own scope; a genuinely ambiguous leftover is shown as the
    # few candidates that survive rather than silently pinned to one.
    seen: set[str] = set()
    out: list[LinkedControlOut] = []
    for ref in wanted:
        pair = by_id.get(ref)
        candidates = [pair] if pair else _narrow(by_ref.get(ref, []), scope)
        for c, fw in candidates:
            if c.id in seen:
                continue
            seen.add(c.id)
            out.append(LinkedControlOut(
                id=c.id, control_ref=c.control_id, title=c.title,
                framework_id=fw.id, framework_name=fw.name, framework_short_name=fw.short_name,
                domain=getattr(c, "domain", None), requirement_type=getattr(c, "requirement_type", None),
            ))
    return out


async def _enrich(db, policy):
    vc = (await db.execute(select(func.count(PolicyVersion.id)).where(PolicyVersion.policy_id == policy.id))).scalar() or 0
    ac = (await db.execute(select(func.count(PolicyAttestation.id)).where(PolicyAttestation.policy_id == policy.id))).scalar() or 0
    pa = (await db.execute(select(func.count(PolicyAttestation.id)).where(PolicyAttestation.policy_id == policy.id, PolicyAttestation.status == AttestationStatus.PENDING))).scalar() or 0
    o = PolicyOut.model_validate(policy)
    o.version_count = vc; o.attestation_count = ac; o.pending_attestations = pa
    return o


# ── Policy CRUD ──────────────────────────────────────────────────────────

@router.get("", response_model=list[PolicyOut])
async def list_policies(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    policies = list((await db.execute(select(Policy).where(Policy.tenant_id == tenant_id).order_by(Policy.created_at.desc()))).scalars().all())
    return [await _enrich(db, p) for p in policies]

@router.post("", response_model=PolicyOut, status_code=201)
async def create_policy(body: PolicyCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    await _assert_process_in_tenant(db, body.business_process_id, tenant_id)
    await _assert_entity_in_tenant(db, body.org_entity_id, tenant_id)
    p = Policy(tenant_id=tenant_id, title=body.title, description=body.description,
               category=body.category, policy_number=body.policy_number,
               owner_id=body.owner_id or user.id,
               linked_controls=await _normalize_linked_controls(db, tenant_id, body.linked_controls, strict=False),
               review_frequency_months=body.review_frequency_months,
               next_review_date=body.next_review_date,
               effective_date=body.effective_date, expiration_date=body.expiration_date,
               business_process_id=body.business_process_id, org_entity_id=body.org_entity_id)
    if body.status:
        p.status = _enum_or_400(PolicyStatus, body.status, "status")
    db.add(p); await db.flush()
    # Create initial version if content provided
    if body.content:
        v = PolicyVersion(policy_id=p.id, version_number=1, content=body.content,
                          is_current=True, authored_by_id=user.id, change_summary="Initial version")
        db.add(v)
    await db.commit(); await db.refresh(p)
    return await _enrich(db, p)

@router.get("/by-control/{control_id}", response_model=ControlPoliciesOut)
async def policies_by_control(control_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """Which internal policies cover this requirement.

    The missing half of « référentiel centralisé […] et politiques internes »: the link
    could be written but never read back from the requirement's side, so a control page
    could not show the document that satisfies it.

    ``control_id`` accepts either the FrameworkControl id or its reference ("A.5.1"),
    and BOTH shapes are matched against the stored links — the policy generator records
    the reference while the gap-driven flow records the id, so a lookup that understood
    only one of them would miss half the real links.

    Declared BEFORE `GET /{pid}`: FastAPI matches in declaration order.
    """
    ref = (control_id or "").strip()
    if not ref:
        raise HTTPException(404, "Control not found")

    # Resolve the requirement first, so the answer names what was asked about and so the
    # id form and the reference form of the same control give the same answer.
    row = (await db.execute(
        select(FrameworkControl, Framework)
        .join(Framework, FrameworkControl.framework_id == Framework.id)
        .where(_visible_frameworks(tenant_id), FrameworkControl.id == ref)
    )).first()
    ref_siblings: list = []
    if row is None:
        # A bare reference is not unique — "5.1" names a control in fifteen built-in
        # frameworks. Narrow to the organisation's own scope before picking one, rather
        # than taking whichever row the ORDER BY happened to put first.
        ref_siblings = (await db.execute(
            select(FrameworkControl, Framework)
            .join(Framework, FrameworkControl.framework_id == Framework.id)
            .where(_visible_frameworks(tenant_id), FrameworkControl.control_id == ref)
            .order_by(Framework.is_builtin, Framework.short_name)
        )).all()
        narrowed = _narrow(ref_siblings, await _scope_framework_ids(db, tenant_id))
        row = narrowed[0] if narrowed else None
    if row is None:
        raise HTTPException(404, "Control not found")
    control, framework = row

    # A stored REFERENCE only counts as covering THIS control when this control is the
    # one that reference resolves to for this organisation. Without that check, a policy
    # linked to "5.1" would be reported as covering the "5.1" of every framework in the
    # catalogue — fifteen false coverage claims from one link.
    if not ref_siblings:
        ref_siblings = (await db.execute(
            select(FrameworkControl, Framework)
            .join(Framework, FrameworkControl.framework_id == Framework.id)
            .where(_visible_frameworks(tenant_id), FrameworkControl.control_id == control.control_id)
        )).all()
    ref_resolves_here = any(
        c.id == control.id
        for c, _fw in _narrow(ref_siblings, await _scope_framework_ids(db, tenant_id))
    )
    keys = {control.id} | ({control.control_id} if ref_resolves_here else set())

    # Membership is checked in Python, not in SQL: no JSON-containment operator is
    # portable across SQLite/PostgreSQL/Oracle, and casting a JSON column to VARCHAR
    # (the obvious prefilter) is itself a hard error on PostgreSQL. A tenant holds a
    # handful of policies, so the scan costs nothing and the answer is exact.
    candidates = (await db.execute(
        select(Policy).where(Policy.tenant_id == tenant_id).order_by(Policy.created_at.desc())
    )).scalars().all()
    matched = [p for p in candidates if keys.intersection(str(c) for c in (p.linked_controls or []))]

    current_versions: dict[str, int] = {}
    if matched:
        for pid_, vnum in (await db.execute(
            select(PolicyVersion.policy_id, PolicyVersion.version_number).where(
                PolicyVersion.policy_id.in_([p.id for p in matched]),
                PolicyVersion.is_current == True,  # noqa: E712
            )
        )).all():
            current_versions[pid_] = vnum

    return ControlPoliciesOut(
        control_id=control.id,
        control_ref=control.control_id,
        control_title=control.title,
        framework_id=framework.id,
        framework_short_name=framework.short_name,
        policies=[
            CoveringPolicyOut(
                id=p.id, title=p.title, policy_number=p.policy_number, category=p.category,
                status=p.status.value if hasattr(p.status, "value") else str(p.status),
                owner_id=p.owner_id, effective_date=p.effective_date,
                next_review_date=p.next_review_date,
                current_version_number=current_versions.get(p.id),
                matched_on="id" if control.id in (p.linked_controls or []) else "reference",
            )
            for p in matched
        ],
    )


@router.get("/{pid}", response_model=PolicyOut)
async def get_policy(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return await _enrich(db, await _policy(db, pid, tenant_id))

@router.patch("/{pid}", response_model=PolicyOut)
async def update_policy(pid: str, body: PolicyUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    await _assert_process_in_tenant(db, body.business_process_id, tenant_id)
    await _assert_entity_in_tenant(db, body.org_entity_id, tenant_id)

    # linked_controls is handled outside the generic loop: it is the policy <-> exigence
    # link, so each entry is checked against a requirement this tenant can actually see
    # and pinned to its id where that is unambiguous. `[]` still means "clear the links".
    linked_before: list[str] = list(p.linked_controls or [])
    linked_after: list[str] | None = None
    if body.linked_controls is not None:
        linked_after = await _normalize_linked_controls(db, tenant_id, body.linked_controls)

    for f in ["title","description","category","owner_id","review_frequency_months","next_review_date",
              "effective_date","expiration_date","business_process_id","org_entity_id"]:
        v = getattr(body, f, None)
        if v is not None: setattr(p, f, v)
    if linked_after is not None:
        p.linked_controls = linked_after
    if body.status: p.status = _enum_or_400(PolicyStatus, body.status, "status")
    await db.commit(); await db.refresh(p)

    # The response is built BEFORE the audit entry: chain_and_add rolls back internally
    # when it loses the seq race, and a rollback expires every ORM instance in this
    # session — enriching `p` afterwards would fire a lazy load outside the greenlet
    # context. Same reason the identifiers below are captured as plain strings.
    result = await _enrich(db, p)

    # Attaching a policy to (or detaching it from) a requirement changes what the
    # organisation claims to cover, which is exactly what an auditor re-reads later — so
    # it is recorded explicitly instead of as a generic "PATCH /policies/{id}".
    if linked_after is not None and set(linked_after) != set(linked_before):
        entry = ActivityLog(
            tenant_id=tenant_id,
            user_id=user.id,
            user_email=user.email,
            action="link_controls",
            entity_type="policy",
            entity_id=p.id,
            entity_name=(p.title or "")[:255] or None,
            details={
                "added": [c for c in linked_after if c not in linked_before],
                "removed": [c for c in linked_before if c not in linked_after],
                "total": len(linked_after),
            },
            origin="api",
        )
        try:
            await chain_and_add(db, entry)
        except Exception:
            pass

    return result

@router.get("/{pid}/controls", response_model=list[LinkedControlOut])
async def list_policy_controls(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """The requirements this policy claims to cover, resolved to titles and frameworks.

    ``linked_controls`` was only ever surfaced as a number ("3 linked controls"), which
    is not something a reviewer can check. Entries that no longer resolve are dropped
    rather than raising — a framework can be deleted after a policy linked to it."""
    p = await _policy(db, pid, tenant_id)
    return await _resolve_controls(db, tenant_id, p.linked_controls or [])


@router.delete("/{pid}", status_code=204)
async def delete_policy(pid: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
    # Delete child records before the policy to avoid FK constraint errors
    versions = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid))).scalars().all()
    attestations = (await db.execute(select(PolicyAttestation).where(PolicyAttestation.policy_id == pid))).scalars().all()

    # Destroying an approved policy also destroys every version of it and every
    # attestation anyone signed against it — the exact record a bank auditor asks
    # for after the fact. delete_framework and governance.delete_document both
    # write a pre-delete trace into the hash chain first; this one did not, so the
    # rows simply vanished. Everything the entry needs is captured as plain values
    # BEFORE the deletes, because chain_and_add rolls back internally when it loses
    # the seq race and a rollback expires every ORM instance in this session.
    trace = {
        "policy_number": p.policy_number,
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "category": p.category,
        "owner_id": p.owner_id,
        "linked_controls": list(p.linked_controls or []),
        "versions": [
            {"version_number": v.version_number,
             "is_current": bool(v.is_current),
             "authored_by_id": v.authored_by_id,
             "approved_by_id": v.approved_by_id,
             "content_length": len(v.content or "")}
            for v in versions
        ],
        "attestations": [
            {"user_id": a.user_id,
             "status": a.status.value if hasattr(a.status, "value") else str(a.status),
             "acknowledged_at": str(a.acknowledged_at) if a.acknowledged_at else None}
            for a in attestations
        ],
    }
    title = (p.title or "")[:255] or None

    for v in versions:
        await db.delete(v)
    for a in attestations:
        await db.delete(a)
    await db.delete(p)
    await db.commit()

    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=user.id,
            user_email=user.email,
            action="delete",
            entity_type="policy",
            entity_id=pid,
            entity_name=title,
            details=trace,
            origin="api",
        ))
    except Exception:
        # Log-and-continue: a chain failure must not turn a completed delete into
        # a 500 the SPA reads as /service-down.
        pass


# ── Versions ─────────────────────────────────────────────────────────────

@router.get("/{pid}/versions", response_model=list[VersionOut])
async def list_versions(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    return [VersionOut.model_validate(v) for v in (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid).order_by(PolicyVersion.version_number.desc()))).scalars().all()]

@router.post("/{pid}/versions", response_model=VersionOut, status_code=201)
async def create_version(pid: str, body: VersionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    # Get next version number
    max_v = (await db.execute(select(func.max(PolicyVersion.version_number)).where(PolicyVersion.policy_id == pid))).scalar() or 0
    # Mark old as not current
    old = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalars().all()  # noqa: E712
    for o in old: o.is_current = False
    v = PolicyVersion(policy_id=pid, version_number=max_v + 1, content=body.content,
                      change_summary=body.change_summary, is_current=True, authored_by_id=user.id)
    db.add(v); await db.flush(); await db.commit(); await db.refresh(v)
    return VersionOut.model_validate(v)

@router.patch("/{pid}/versions/{vid}/approve", response_model=VersionOut)
async def approve_version(pid: str, vid: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    r = await db.execute(select(PolicyVersion).where(PolicyVersion.id == vid, PolicyVersion.policy_id == pid))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Version not found")
    v.approved_by_id = user.id; v.approved_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(v)
    return VersionOut.model_validate(v)


@router.post("/{pid}/versions/{vid}/restore", response_model=VersionOut, status_code=201)
async def restore_version(
    pid: str,
    vid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Return a policy to an earlier version — "retour à l'état antérieur".

    History was previously readable but not actionable: an operator could see
    that version 3 was wrong and see what version 2 said, with no way to go
    back except retyping it.

    Restoring APPENDS rather than rewrites. The old content becomes a new
    current version, so the erroneous version stays in the record and the
    revert is itself a dated, attributed event. Deleting versions to "undo"
    would destroy the audit trail that makes the history worth keeping, and an
    auditor asking "what did this policy say last March, and who changed it"
    must still get an answer afterwards.
    """
    await _policy(db, pid, tenant_id)
    r = await db.execute(select(PolicyVersion).where(PolicyVersion.id == vid, PolicyVersion.policy_id == pid))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Version not found")
    if source.is_current:
        raise HTTPException(400, "That version is already the current one.")

    max_v = (await db.execute(
        select(func.max(PolicyVersion.version_number)).where(PolicyVersion.policy_id == pid)
    )).scalar() or 0

    current = (await db.execute(select(PolicyVersion).where(
        PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalars().all()  # noqa: E712
    for c in current:
        c.is_current = False

    restored = PolicyVersion(
        policy_id=pid,
        version_number=max_v + 1,
        content=source.content,
        change_summary=f"Restored from version {source.version_number}",
        is_current=True,
        authored_by_id=user.id,
    )
    db.add(restored)
    await db.flush()
    await db.commit()
    await db.refresh(restored)

    # A revert of an approved document is exactly the kind of change an auditor
    # looks for, so it is recorded explicitly rather than left as a generic
    # "POST /versions" in the request log.
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=user.id,
            user_email=user.email,
            action="restore",
            entity_type="policy",
            entity_id=pid,
            entity_name=None,
            details={
                "restored_from_version": source.version_number,
                "new_version": restored.version_number,
                "replaced_version": current[0].version_number if current else None,
            },
            origin="api",
        ))
    except Exception:
        pass

    return VersionOut.model_validate(restored)


# ── Attestations ─────────────────────────────────────────────────────────

@router.get("/{pid}/attestations", response_model=list[AttestationOut])
async def list_attestations(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    return [AttestationOut.model_validate(a) for a in (await db.execute(select(PolicyAttestation).where(PolicyAttestation.policy_id == pid).order_by(PolicyAttestation.created_at.desc()))).scalars().all()]

@router.post("/{pid}/attestations", response_model=list[AttestationOut], status_code=201)
async def create_attestations(pid: str, body: AttestationCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
    # Verify each user_id belongs to this tenant (close cross-tenant IDOR).
    for uid in body.user_ids:
        await assert_user_in_tenant(db, uid, tenant_id, field_name="user_id")
    # Get current version
    cv = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalar_one_or_none()  # noqa: E712
    if not cv: raise HTTPException(400, "No current version to attest")
    created = []
    for uid in body.user_ids:
        att = PolicyAttestation(policy_id=pid, policy_version_id=cv.id, user_id=uid, due_date=body.due_date)
        db.add(att); created.append(att)
    await db.flush(); await db.commit()
    for a in created: await db.refresh(a)
    return [AttestationOut.model_validate(a) for a in created]

@router.patch("/{pid}/attestations/{aid}/acknowledge", response_model=AttestationOut)
async def acknowledge_attestation(pid: str, aid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(PolicyAttestation).where(PolicyAttestation.id == aid, PolicyAttestation.policy_id == pid, PolicyAttestation.user_id == user.id))
    att = r.scalar_one_or_none()
    if not att: raise HTTPException(404, "Attestation not found")
    att.status = AttestationStatus.ACKNOWLEDGED; att.acknowledged_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(att)
    return AttestationOut.model_validate(att)


# ── PDF Export ───────────────────────────────────────────────────────────

@router.get("/{pid}/export-pdf")
async def export_policy_pdf(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib.enums import TA_LEFT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

    p = await _policy(db, pid, tenant_id)
    cv = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalar_one_or_none()  # noqa: E712

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()

    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=22, spaceAfter=8, textColor=colors.HexColor("#0f172a"))
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=14, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1e3a5f"))
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=11, leading=16, textColor=colors.HexColor("#334155"))
    label_style = ParagraphStyle("Label", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#64748b"))

    story = []
    story.append(Paragraph(pdf_arabic.paragraph_markup(p.title, bold=True), h1))
    if p.policy_number:
        story.append(Paragraph(f"Policy No. {p.policy_number}", label_style))
    story.append(Spacer(1, 0.3*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 0.4*cm))

    meta = [
        ["Category", p.category or "—"],
        ["Status", p.status.replace("_", " ").title()],
        ["Review Cycle", f"{p.review_frequency_months} months"],
        ["Next Review", p.next_review_date or "—"],
        ["Version", f"v{cv.version_number}" if cv else "—"],
    ]
    tbl = Table(meta, colWidths=[4*cm, 13*cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 7),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
    ]))
    story.append(tbl)

    if p.description:
        story.append(Paragraph("Description", h2))
        story.append(Paragraph(pdf_arabic.paragraph_markup(p.description), body))

    if cv:
        story.append(Paragraph(f"Policy Content — v{cv.version_number}", h2))
        if cv.change_summary:
            story.append(Paragraph("Change summary: " + pdf_arabic.paragraph_markup(cv.change_summary), label_style))
        story.append(Spacer(1, 0.3*cm))
        for line in cv.content.split("\n"):
            if line.strip():
                story.append(Paragraph(pdf_arabic.paragraph_markup(line), body))
            else:
                story.append(Spacer(1, 0.25*cm))

    doc.build(story)
    buf.seek(0)
    safe_name = "".join(c if c.isalnum() or c in (" ", "_", "-") else "_" for c in p.title)
    ver = cv.version_number if cv else 1
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{safe_name}_v{ver}.pdf"'})
