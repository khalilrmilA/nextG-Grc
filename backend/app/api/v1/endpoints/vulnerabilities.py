"""Vulnerability Management — track CVEs, misconfigs, and weaknesses.

Elite Pack (RFP module 3):
- Robust list-field coercion: ``affected_systems`` / ``affected_assets`` accept a
  comma-string OR a list and are always stored as a JSON list.
- Validation workflow: manual vulnerabilities start ``pending_validation`` and a
  security referent (CISO) validates them via POST /{id}/validate before they
  enter risk analysis.
- Composite impact scoring (gated: ``vuln_impact_scoring``) via POST /{id}/impact.
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.models.user import User, UserRole
from app.models.asset import Asset
from app.models.vulnerability import (
    Vulnerability,
    VulnSeverity,
    VulnStatus,
    compute_impact_score,
    resolve_context_weight,
)
from app.models.vulnerability_impact_history import VulnerabilityImpactHistory

router = APIRouter()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_str_list(value) -> list[str]:
    """Coerce a comma-string OR list (OR None) into a clean list[str].

    Fixes the bug where the frontend posted ``affected_systems`` as a single
    comma-separated string straight into a JSON-list column.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [s.strip() for s in value.split(",") if s.strip()]
    if isinstance(value, (list, tuple, set)):
        out: list[str] = []
        for item in value:
            if item is None:
                continue
            s = str(item).strip()
            if s:
                out.append(s)
        return out
    s = str(value).strip()
    return [s] if s else []


# Business value -> rank, to pick the most valuable linked asset for scoring.
_BUSINESS_VALUE_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}


class VulnCreate(BaseModel):
    ref_id: str | None = None; title: str; description: str | None = None
    severity: str = "medium"; cvss_score: float | None = None
    affected_assets: list[str] | str = []; affected_systems: list[str] | str = []
    remediation_plan: str | None = None; remediation_owner_id: str | None = None
    remediation_due_date: str | None = None; source: str | None = None
    references: list[str] = []; tags: list[str] = []

    @field_validator("affected_assets", "affected_systems", mode="before")
    @classmethod
    def _coerce_lists(cls, v):
        return _to_str_list(v)

    @model_validator(mode="after")
    def _require_asset_link(self):
        # RFP gap: a new manual vulnerability must be linked to at least one
        # real asset — no longer optional. Each id is further resolved against
        # this tenant's Asset table in create_vuln() below (needs DB access,
        # so can't happen in a pure pydantic validator). Existing rows created
        # before this rule (including free-text values) are untouched — this
        # only gates new creates.
        #
        # A model_validator (not a plain field_validator) is required here:
        # pydantic v2 skips field-level validators for fields left at their
        # default (e.g. affected_assets simply omitted from the request body),
        # which would otherwise let an omitted field slip past an empty-list
        # check. model_validator(mode="after") always runs on the fully
        # constructed model, so an omitted field is caught the same as an
        # explicit `affected_assets: []`.
        if not self.affected_assets:
            raise ValueError("At least one affected asset is required (affected_assets must not be empty)")
        return self


class VulnUpdate(BaseModel):
    title: str | None = None; description: str | None = None
    severity: str | None = None; status: str | None = None
    cvss_score: float | None = None; affected_assets: list[str] | str | None = None
    affected_systems: list[str] | str | None = None
    remediation_plan: str | None = None; remediation_owner_id: str | None = None
    remediation_due_date: str | None = None; fixed_by_controls: list[str] | None = None
    tags: list[str] | None = None

    @field_validator("affected_assets", "affected_systems", mode="before")
    @classmethod
    def _coerce_lists(cls, v):
        return None if v is None else _to_str_list(v)


class ImpactRequest(BaseModel):
    """Recompute (context weight / label) or override the composite impact score."""
    operational_context: str | None = None   # label, e.g. "internet_facing"
    context_weight: float | None = None       # explicit multiplier, wins over label
    override: float | None = None             # direct 0-100 override
    justification: str | None = None          # required when overriding


class VulnOut(BaseModel):
    id: str; tenant_id: str; ref_id: str | None; title: str; description: str | None
    severity: str; status: str; cvss_score: float | None
    affected_assets: list; affected_systems: list
    remediation_plan: str | None; remediation_owner_id: str | None
    remediation_due_date: str | None; fixed_by_controls: list
    source: str | None; references: list; tags: list
    validated_by_id: str | None; validated_at: datetime | None
    impact_score: float | None; impact_override: float | None; impact_justification: str | None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


class VulnStats(BaseModel):
    total: int; open: int; in_remediation: int; mitigated: int; closed: int
    by_severity: dict[str, int]; avg_cvss: float | None


class ImpactHistoryOut(BaseModel):
    """A single before/after snapshot of a vulnerability's impact score (RFP gap
    fix: the prior audit trail kept only the latest score, not the successive
    values)."""
    id: str; vulnerability_id: str; score: float; override: bool
    context_weight: float | None; justification: str | None
    changed_by_id: str | None; created_at: datetime
    model_config = {"from_attributes": True}


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
    # Each affected-asset id must resolve to a real Asset owned by this tenant
    # (422 listing whichever ids don't). affected_assets is required non-empty
    # by VulnCreate's model_validator above.
    await assert_assets_in_tenant(db, body.affected_assets, tenant_id, field_name="affected_assets")
    # New manual vulnerabilities enter the validation queue before risk analysis.
    v = Vulnerability(tenant_id=tenant_id, ref_id=body.ref_id, title=body.title, description=body.description,
                      severity=body.severity, status=VulnStatus.PENDING_VALIDATION.value,
                      cvss_score=body.cvss_score, affected_assets=body.affected_assets,
                      affected_systems=body.affected_systems, remediation_plan=body.remediation_plan,
                      remediation_owner_id=body.remediation_owner_id, remediation_due_date=body.remediation_due_date,
                      source=body.source or "manual", references=body.references, tags=body.tags)
    db.add(v); await db.flush(); await db.commit(); await db.refresh(v)
    return VulnOut.model_validate(v)

@router.get("/{vid}", response_model=VulnOut)
async def get_vuln(vid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Vulnerability not found")
    return VulnOut.model_validate(v)

@router.patch("/{vid}", response_model=VulnOut)
async def update_vuln(
    vid: str,
    body: VulnUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    # Modifying a security finding is restricted to the security-referent role
    # set (same tuple used for risk mutations in risks.py). super_admin and
    # tenant_admin always auto-pass inside require_roles(); read access (GET
    # /list) stays open to any authenticated tenant user.
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Vulnerability not found")
    for f in ["title","description","cvss_score","affected_assets","affected_systems","remediation_plan","remediation_owner_id","remediation_due_date","fixed_by_controls","tags"]:
        val = getattr(body, f, None)
        if val is not None: setattr(v, f, val)
    if body.severity: v.severity = body.severity
    if body.status: v.status = body.status
    await db.commit(); await db.refresh(v)
    return VulnOut.model_validate(v)

@router.post("/{vid}/validate", response_model=VulnOut)
async def validate_vuln(
    vid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Security-referent validation gate — moves a vuln into risk analysis.

    Restricted to the security referent (CISO; tenant/super admins auto-pass).
    """
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vulnerability not found")
    current = v.status if isinstance(v.status, str) else v.status.value
    if current != VulnStatus.PENDING_VALIDATION.value:
        raise HTTPException(400, "Vulnerability is not pending validation")
    v.status = VulnStatus.VALIDATED.value
    v.validated_by_id = current_user.id
    v.validated_at = _utcnow()
    await db.commit(); await db.refresh(v)
    return VulnOut.model_validate(v)

@router.post("/{vid}/impact", response_model=VulnOut)
async def score_impact(
    vid: str,
    body: ImpactRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_feature("vuln_impact_scoring"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Recompute or override the composite impact score (Elite Pack).

    Without ``override``: recomputes ``impact_score`` = f(CVSS, operational
    context weight, most-valuable linked asset's business value).
    With ``override``: stores the manual value + required justification.
    """
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vulnerability not found")

    if body.override is not None:
        if not (body.justification and body.justification.strip()):
            raise HTTPException(400, "A justification is required to override the impact score")
        v.impact_override = round(max(0.0, min(100.0, float(body.override))), 1)
        v.impact_justification = body.justification.strip()
        v.impact_score = v.impact_override
        # RFP gap fix: persist a before/after history row, not just the latest value.
        db.add(VulnerabilityImpactHistory(
            vulnerability_id=v.id, score=v.impact_score, override=True,
            context_weight=None, justification=v.impact_justification,
            changed_by_id=current_user.id,
        ))
        await db.commit(); await db.refresh(v)
        return VulnOut.model_validate(v)

    # Recompute from CVSS + operational context + most-valuable linked asset.
    business_value = None
    asset_ids = v.affected_assets or []
    if asset_ids:
        assets = (await db.execute(
            select(Asset).where(Asset.tenant_id == tenant_id, Asset.id.in_(asset_ids))
        )).scalars().all()
        best_rank = -1
        for a in assets:
            rank = _BUSINESS_VALUE_RANK.get((a.business_value or "").strip().lower(), 0)
            if rank > best_rank:
                best_rank = rank
                business_value = a.business_value

    severity = v.severity if isinstance(v.severity, str) else v.severity.value
    weight = resolve_context_weight(body.operational_context, body.context_weight)
    v.impact_score = compute_impact_score(v.cvss_score, weight, business_value, severity)
    v.impact_override = None  # recompute clears any prior manual override
    if body.justification and body.justification.strip():
        v.impact_justification = body.justification.strip()
    # RFP gap fix: persist a before/after history row, not just the latest value.
    db.add(VulnerabilityImpactHistory(
        vulnerability_id=v.id, score=v.impact_score, override=False,
        context_weight=weight, justification=v.impact_justification,
        changed_by_id=current_user.id,
    ))
    await db.commit(); await db.refresh(v)
    return VulnOut.model_validate(v)

@router.get("/{vid}/impact-history", response_model=list[ImpactHistoryOut])
async def get_impact_history(
    vid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Ordered (newest-first) before/after impact-score history for a vulnerability.

    Tenant-scoped through the parent Vulnerability row rather than trusting a bare
    vulnerability_id — a 404 here means either the vulnerability doesn't exist or
    doesn't belong to this tenant, so history for another tenant's vulnerability
    can never leak.
    """
    v = (await db.execute(
        select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vulnerability not found")
    rows = (await db.execute(
        select(VulnerabilityImpactHistory)
        .where(VulnerabilityImpactHistory.vulnerability_id == vid)
        .order_by(VulnerabilityImpactHistory.created_at.desc())
    )).scalars().all()
    return [ImpactHistoryOut.model_validate(r) for r in rows]

@router.delete("/{vid}", status_code=204)
async def delete_vuln(vid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Vulnerability not found")
    await db.delete(v); await db.commit()
