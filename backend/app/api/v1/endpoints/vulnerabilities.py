"""Vulnerability Management — track CVEs, misconfigs, and weaknesses."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.vulnerability import Vulnerability, VulnSeverity, VulnStatus

router = APIRouter()

class VulnCreate(BaseModel):
    ref_id: str | None = None; title: str; description: str | None = None
    severity: str = "medium"; cvss_score: float | None = None
    affected_assets: list[str] = []; affected_systems: list[str] = []
    remediation_plan: str | None = None; remediation_owner_id: str | None = None
    remediation_due_date: str | None = None; source: str | None = None
    references: list[str] = []; tags: list[str] = []

class VulnUpdate(BaseModel):
    title: str | None = None; description: str | None = None
    severity: str | None = None; status: str | None = None
    cvss_score: float | None = None; affected_assets: list[str] | None = None
    remediation_plan: str | None = None; remediation_owner_id: str | None = None
    remediation_due_date: str | None = None; fixed_by_controls: list[str] | None = None
    tags: list[str] | None = None

class VulnOut(BaseModel):
    id: str; tenant_id: str; ref_id: str | None; title: str; description: str | None
    severity: str; status: str; cvss_score: float | None
    affected_assets: list; affected_systems: list
    remediation_plan: str | None; remediation_owner_id: str | None
    remediation_due_date: str | None; fixed_by_controls: list
    source: str | None; references: list; tags: list
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class VulnStats(BaseModel):
    total: int; open: int; in_remediation: int; mitigated: int; closed: int
    by_severity: dict[str, int]; avg_cvss: float | None

@router.get("", response_model=list[VulnOut])
async def list_vulns(severity: str | None = None, status_filter: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(Vulnerability).where(Vulnerability.tenant_id == tenant_id)
    if severity: q = q.where(Vulnerability.severity == severity)
    if status_filter: q = q.where(Vulnerability.status == status_filter)
    return [VulnOut.model_validate(v) for v in (await db.execute(q.order_by(Vulnerability.created_at.desc()))).scalars().all()]

@router.get("/stats", response_model=VulnStats)
async def get_stats(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    vulns = list((await db.execute(select(Vulnerability).where(Vulnerability.tenant_id == tenant_id))).scalars().all())
    by_sev: dict[str, int] = {}
    status_counts = {"open": 0, "in_remediation": 0, "mitigated": 0, "closed": 0}
    cvss_scores = []
    for v in vulns:
        s = v.severity if isinstance(v.severity, str) else v.severity.value
        by_sev[s] = by_sev.get(s, 0) + 1
        st = v.status if isinstance(v.status, str) else v.status.value
        if st in status_counts: status_counts[st] += 1
        if v.cvss_score: cvss_scores.append(v.cvss_score)
    return VulnStats(total=len(vulns), by_severity=by_sev, avg_cvss=round(sum(cvss_scores)/len(cvss_scores), 1) if cvss_scores else None, **status_counts)

@router.post("", response_model=VulnOut, status_code=201)
async def create_vuln(body: VulnCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    v = Vulnerability(tenant_id=tenant_id, ref_id=body.ref_id, title=body.title, description=body.description,
                      severity=body.severity, cvss_score=body.cvss_score, affected_assets=body.affected_assets,
                      affected_systems=body.affected_systems, remediation_plan=body.remediation_plan,
                      remediation_owner_id=body.remediation_owner_id, remediation_due_date=body.remediation_due_date,
                      source=body.source, references=body.references, tags=body.tags)
    db.add(v); await db.flush(); await db.commit(); await db.refresh(v)
    return VulnOut.model_validate(v)

@router.get("/{vid}", response_model=VulnOut)
async def get_vuln(vid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Vulnerability not found")
    return VulnOut.model_validate(v)

@router.patch("/{vid}", response_model=VulnOut)
async def update_vuln(vid: str, body: VulnUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Vulnerability not found")
    for f in ["title","description","cvss_score","affected_assets","remediation_plan","remediation_owner_id","remediation_due_date","fixed_by_controls","tags"]:
        val = getattr(body, f, None)
        if val is not None: setattr(v, f, val)
    if body.severity: v.severity = body.severity
    if body.status: v.status = body.status
    await db.commit(); await db.refresh(v)
    return VulnOut.model_validate(v)

@router.delete("/{vid}", status_code=204)
async def delete_vuln(vid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Vulnerability not found")
    await db.delete(v); await db.commit()
