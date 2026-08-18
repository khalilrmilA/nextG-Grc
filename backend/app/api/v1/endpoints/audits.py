"""Audit Management — full audit lifecycle with findings and evidence."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_user_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.audit import (
    Audit, AuditFinding, AuditEvidence,
    AuditType, AuditStatus, FindingSeverity, FindingStatus,
)
from app.workers.tasks.notifications import notify_audit_assigned

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class AuditCreate(BaseModel):
    title: str
    description: str | None = None
    audit_type: str = "internal"
    lead_auditor_id: str | None = None
    framework_id: str | None = None
    planned_start: str | None = None
    planned_end: str | None = None
    scope: str | None = None
    in_scope_systems: list[str] = []

class AuditUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    lead_auditor_id: str | None = None
    planned_start: str | None = None
    planned_end: str | None = None
    actual_start: str | None = None
    actual_end: str | None = None
    scope: str | None = None
    executive_summary: str | None = None
    in_scope_systems: list[str] | None = None

class AuditOut(BaseModel):
    id: str; tenant_id: str; title: str; description: str | None
    audit_type: str; status: str; lead_auditor_id: str | None
    framework_id: str | None; planned_start: str | None; planned_end: str | None
    actual_start: str | None; actual_end: str | None; scope: str | None
    executive_summary: str | None; in_scope_systems: list
    finding_count: int = 0
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class FindingCreate(BaseModel):
    title: str; description: str; severity: str = "medium"
    control_id: str | None = None; remediation_owner_id: str | None = None
    due_date: str | None = None; recommendation: str | None = None

class FindingUpdate(BaseModel):
    title: str | None = None; description: str | None = None
    severity: str | None = None; status: str | None = None
    remediation_owner_id: str | None = None; due_date: str | None = None
    recommendation: str | None = None; management_response: str | None = None
    remediation_notes: str | None = None

class FindingOut(BaseModel):
    id: str; audit_id: str; title: str; description: str
    severity: str; status: str; control_id: str | None
    remediation_owner_id: str | None; due_date: str | None
    recommendation: str | None; management_response: str | None
    remediation_notes: str | None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────

async def _audit(db, audit_id, tenant_id):
    r = await db.execute(select(Audit).where(Audit.id == audit_id, Audit.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a: raise HTTPException(404, "Audit not found")
    return a

async def _with_count(db, audit):
    fc = (await db.execute(select(func.count(AuditFinding.id)).where(AuditFinding.audit_id == audit.id))).scalar() or 0
    o = AuditOut.model_validate(audit); o.finding_count = fc; return o


# ── Audit CRUD ───────────────────────────────────────────────────────────

@router.get("", response_model=list[AuditOut])
async def list_audits(status_filter: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(Audit).where(Audit.tenant_id == tenant_id)
    if status_filter: q = q.where(Audit.status == status_filter)
    audits = list((await db.execute(q.order_by(Audit.created_at.desc()))).scalars().all())
    return [await _with_count(db, a) for a in audits]

@router.post("", response_model=AuditOut, status_code=201)
async def create_audit(body: AuditCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await assert_user_in_tenant(db, body.lead_auditor_id, tenant_id, field_name="lead_auditor_id")
    a = Audit(tenant_id=tenant_id, title=body.title, description=body.description,
              audit_type=AuditType(body.audit_type), lead_auditor_id=body.lead_auditor_id or user.id,
              framework_id=body.framework_id, planned_start=body.planned_start,
              planned_end=body.planned_end, scope=body.scope, in_scope_systems=body.in_scope_systems)
    db.add(a); await db.flush(); await db.commit(); await db.refresh(a)
    if a.lead_auditor_id:
        # Best-effort notification — broker may be unavailable in dev (no Redis).
        try:
            notify_audit_assigned.delay(a.id, a.lead_auditor_id)
        except Exception:
            pass
    o = AuditOut.model_validate(a); o.finding_count = 0; return o

@router.get("/{audit_id}", response_model=AuditOut)
async def get_audit(audit_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return await _with_count(db, await _audit(db, audit_id, tenant_id))

@router.patch("/{audit_id}", response_model=AuditOut)
async def update_audit(audit_id: str, body: AuditUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = await _audit(db, audit_id, tenant_id)
    await assert_user_in_tenant(db, body.lead_auditor_id, tenant_id, field_name="lead_auditor_id")
    prev_lead_auditor_id = a.lead_auditor_id
    for f in ["title","description","lead_auditor_id","planned_start","planned_end","actual_start","actual_end","scope","executive_summary","in_scope_systems"]:
        v = getattr(body, f, None)
        if v is not None: setattr(a, f, v)
    if body.status: a.status = AuditStatus(body.status)
    await db.commit(); await db.refresh(a)
    if a.lead_auditor_id and a.lead_auditor_id != prev_lead_auditor_id:
        # Best-effort notification — broker may be unavailable in dev (no Redis).
        try:
            notify_audit_assigned.delay(a.id, a.lead_auditor_id)
        except Exception:
            pass
    return await _with_count(db, a)

@router.delete("/{audit_id}", status_code=204)
async def delete_audit(audit_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = await _audit(db, audit_id, tenant_id); await db.delete(a); await db.commit()


# ── Findings CRUD ────────────────────────────────────────────────────────

@router.get("/{audit_id}/findings", response_model=list[FindingOut])
async def list_findings(audit_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _audit(db, audit_id, tenant_id)
    return [FindingOut.model_validate(f) for f in (await db.execute(select(AuditFinding).where(AuditFinding.audit_id == audit_id).order_by(AuditFinding.created_at.desc()))).scalars().all()]

@router.post("/{audit_id}/findings", response_model=FindingOut, status_code=201)
async def create_finding(audit_id: str, body: FindingCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _audit(db, audit_id, tenant_id)
    await assert_user_in_tenant(db, body.remediation_owner_id, tenant_id, field_name="remediation_owner_id")
    f = AuditFinding(audit_id=audit_id, title=body.title, description=body.description,
                     severity=FindingSeverity(body.severity), control_id=body.control_id,
                     remediation_owner_id=body.remediation_owner_id, due_date=body.due_date, recommendation=body.recommendation)
    db.add(f); await db.flush(); await db.commit(); await db.refresh(f)
    return FindingOut.model_validate(f)

@router.patch("/{audit_id}/findings/{fid}", response_model=FindingOut)
async def update_finding(audit_id: str, fid: str, body: FindingUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _audit(db, audit_id, tenant_id)
    r = await db.execute(select(AuditFinding).where(AuditFinding.id == fid, AuditFinding.audit_id == audit_id))
    f = r.scalar_one_or_none()
    if not f: raise HTTPException(404, "Finding not found")
    await assert_user_in_tenant(db, body.remediation_owner_id, tenant_id, field_name="remediation_owner_id")
    for fld in ["title","description","remediation_owner_id","due_date","recommendation","management_response","remediation_notes"]:
        v = getattr(body, fld, None)
        if v is not None: setattr(f, fld, v)
    if body.severity: f.severity = FindingSeverity(body.severity)
    if body.status: f.status = FindingStatus(body.status)
    await db.commit(); await db.refresh(f)
    return FindingOut.model_validate(f)

@router.delete("/{audit_id}/findings/{fid}", status_code=204)
async def delete_finding(audit_id: str, fid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _audit(db, audit_id, tenant_id)
    r = await db.execute(select(AuditFinding).where(AuditFinding.id == fid, AuditFinding.audit_id == audit_id))
    f = r.scalar_one_or_none()
    if not f: raise HTTPException(404, "Finding not found")
    await db.delete(f); await db.commit()


# ── Evidence (activates the AuditEvidence model, which had no endpoints) ──────

class EvidenceCreate(BaseModel):
    name: str
    description: str | None = None
    file_name: str | None = None
    s3_key: str | None = None

class EvidenceOut(BaseModel):
    id: str; audit_id: str; name: str; description: str | None
    file_name: str | None; s3_key: str | None; uploaded_by_id: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


@router.get("/{audit_id}/evidence", response_model=list[EvidenceOut])
async def list_evidence(audit_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _audit(db, audit_id, tenant_id)
    rows = (await db.execute(select(AuditEvidence).where(AuditEvidence.audit_id == audit_id).order_by(AuditEvidence.created_at.desc()))).scalars().all()
    return [EvidenceOut.model_validate(e) for e in rows]

@router.post("/{audit_id}/evidence", response_model=EvidenceOut, status_code=201)
async def create_evidence(audit_id: str, body: EvidenceCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _audit(db, audit_id, tenant_id)
    e = AuditEvidence(audit_id=audit_id, name=body.name, description=body.description,
                      file_name=body.file_name, s3_key=body.s3_key, uploaded_by_id=user.id)
    db.add(e); await db.flush(); await db.commit(); await db.refresh(e)
    return EvidenceOut.model_validate(e)

@router.delete("/{audit_id}/evidence/{eid}", status_code=204)
async def delete_evidence(audit_id: str, eid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _audit(db, audit_id, tenant_id)
    r = await db.execute(select(AuditEvidence).where(AuditEvidence.id == eid, AuditEvidence.audit_id == audit_id))
    e = r.scalar_one_or_none()
    if not e: raise HTTPException(404, "Evidence not found")
    await db.delete(e); await db.commit()


# ── Recommendation tracking: overdue findings across the tenant's audits ─────

class OverdueFindingOut(BaseModel):
    id: str; audit_id: str; audit_title: str; title: str
    severity: str; status: str; due_date: str | None
    remediation_owner_id: str | None; recommendation: str | None

@router.get("/findings/overdue", response_model=list[OverdueFindingOut])
async def overdue_findings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """Open/in-remediation findings whose due_date has passed (ISO dates compare lexically)."""
    today = datetime.utcnow().date().isoformat()
    q = (
        select(AuditFinding, Audit.title)
        .join(Audit, AuditFinding.audit_id == Audit.id)
        .where(
            Audit.tenant_id == tenant_id,
            AuditFinding.due_date.is_not(None),
            AuditFinding.due_date != "",
            AuditFinding.due_date < today,
            AuditFinding.status.in_([FindingStatus.OPEN, FindingStatus.IN_REMEDIATION]),
        )
        .order_by(AuditFinding.due_date.asc())
    )
    out = []
    for f, audit_title in (await db.execute(q)).all():
        out.append(OverdueFindingOut(
            id=f.id, audit_id=f.audit_id, audit_title=audit_title, title=f.title,
            severity=f.severity.value if hasattr(f.severity, "value") else str(f.severity),
            status=f.status.value if hasattr(f.status, "value") else str(f.status),
            due_date=f.due_date, remediation_owner_id=f.remediation_owner_id,
            recommendation=f.recommendation,
        ))
    return out
