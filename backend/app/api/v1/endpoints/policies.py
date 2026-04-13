"""Policy Management — full policy lifecycle with versioning and attestations."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.policy import Policy, PolicyVersion, PolicyAttestation, PolicyStatus, AttestationStatus

router = APIRouter()


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

class PolicyOut(BaseModel):
    id: str; tenant_id: str; title: str; policy_number: str | None
    description: str | None; category: str | None; owner_id: str | None
    status: str; linked_controls: list; review_frequency_months: int
    next_review_date: str | None; version_count: int = 0
    attestation_count: int = 0; pending_attestations: int = 0
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

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
async def create_policy(body: PolicyCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    p = Policy(tenant_id=tenant_id, title=body.title, description=body.description,
               category=body.category, policy_number=body.policy_number,
               owner_id=body.owner_id or user.id, linked_controls=body.linked_controls,
               review_frequency_months=body.review_frequency_months,
               next_review_date=body.next_review_date)
    if body.status:
        p.status = PolicyStatus(body.status)
    db.add(p); await db.flush()
    # Create initial version if content provided
    if body.content:
        v = PolicyVersion(policy_id=p.id, version_number=1, content=body.content,
                          is_current=True, authored_by_id=user.id, change_summary="Initial version")
        db.add(v)
    await db.commit(); await db.refresh(p)
    return await _enrich(db, p)

@router.get("/{pid}", response_model=PolicyOut)
async def get_policy(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return await _enrich(db, await _policy(db, pid, tenant_id))

@router.patch("/{pid}", response_model=PolicyOut)
async def update_policy(pid: str, body: PolicyUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
    for f in ["title","description","category","owner_id","linked_controls","review_frequency_months","next_review_date"]:
        v = getattr(body, f, None)
        if v is not None: setattr(p, f, v)
    if body.status: p.status = PolicyStatus(body.status)
    await db.commit(); await db.refresh(p)
    return await _enrich(db, p)

@router.delete("/{pid}", status_code=204)
async def delete_policy(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id); await db.delete(p); await db.commit()


# ── Versions ─────────────────────────────────────────────────────────────

@router.get("/{pid}/versions", response_model=list[VersionOut])
async def list_versions(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    return [VersionOut.model_validate(v) for v in (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid).order_by(PolicyVersion.version_number.desc()))).scalars().all()]

@router.post("/{pid}/versions", response_model=VersionOut, status_code=201)
async def create_version(pid: str, body: VersionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
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
async def approve_version(pid: str, vid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    r = await db.execute(select(PolicyVersion).where(PolicyVersion.id == vid, PolicyVersion.policy_id == pid))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Version not found")
    v.approved_by_id = user.id; v.approved_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(v)
    return VersionOut.model_validate(v)


# ── Attestations ─────────────────────────────────────────────────────────

@router.get("/{pid}/attestations", response_model=list[AttestationOut])
async def list_attestations(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    return [AttestationOut.model_validate(a) for a in (await db.execute(select(PolicyAttestation).where(PolicyAttestation.policy_id == pid).order_by(PolicyAttestation.created_at.desc()))).scalars().all()]

@router.post("/{pid}/attestations", response_model=list[AttestationOut], status_code=201)
async def create_attestations(pid: str, body: AttestationCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
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
