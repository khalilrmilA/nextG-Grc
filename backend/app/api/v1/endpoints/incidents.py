"""Incident Management — track, investigate, and resolve security incidents.

Elite Pack (RFP gap fix M2.4): ``affected_asset_ids`` is a validated FK-style
link to real tenant Assets, alongside the pre-existing free-text
``affected_systems`` (kept for backward compat / free-text notes). Each id is
checked against this tenant's Asset table on create/update — same IDOR-safe
pattern as vulnerabilities.py's ``affected_assets`` (see
app/core/security_utils.py's ``assert_assets_in_tenant``).
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.incident import Incident, IncidentSeverity, IncidentStatus, IncidentCategory

router = APIRouter()


class IncidentCreate(BaseModel):
    title: str
    description: str | None = None
    category: str = "other"
    severity: str = "medium"
    assigned_to_id: str | None = None
    detected_at: str | None = None
    affected_systems: list[str] = []
    # RFP gap fix (M2.4): real Asset ids, validated tenant-scoped in create_incident()
    # below. Optional — unlike vulnerabilities.py's affected_assets, an incident isn't
    # required to already have a linked asset at report time.
    affected_asset_ids: list[str] = []
    affected_users_count: int | None = None
    data_types_affected: list[str] = []
    breach_notification_required: bool = False
    linked_risks: list[str] = []
    linked_controls: list[str] = []
    linked_vendors: list[str] = []
    linked_vulnerabilities: list[str] = []
    tags: list[str] = []

class IncidentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    severity: str | None = None
    status: str | None = None
    assigned_to_id: str | None = None
    detected_at: str | None = None
    contained_at: str | None = None
    resolved_at: str | None = None
    affected_systems: list[str] | None = None
    affected_asset_ids: list[str] | None = None
    affected_users_count: int | None = None
    data_types_affected: list[str] | None = None
    business_impact: str | None = None
    financial_impact: float | None = None
    root_cause: str | None = None
    containment_actions: str | None = None
    remediation_actions: str | None = None
    lessons_learned: str | None = None
    post_mortem_url: str | None = None
    breach_notification_required: bool | None = None
    notification_sent_at: str | None = None
    linked_risks: list[str] | None = None
    linked_controls: list[str] | None = None
    linked_vendors: list[str] | None = None
    linked_vulnerabilities: list[str] | None = None
    tags: list[str] | None = None

class IncidentOut(BaseModel):
    id: str; tenant_id: str; title: str; description: str | None
    category: str; severity: str; status: str
    reporter_id: str | None; assigned_to_id: str | None
    detected_at: str | None; contained_at: str | None; resolved_at: str | None
    affected_systems: list; affected_asset_ids: list = []; affected_users_count: int | None
    data_types_affected: list; business_impact: str | None
    financial_impact: float | None; root_cause: str | None
    containment_actions: str | None; remediation_actions: str | None
    lessons_learned: str | None; post_mortem_url: str | None
    breach_notification_required: bool
    notification_sent_at: str | None; regulatory_reference: str | None
    linked_risks: list; linked_controls: list; linked_vendors: list; linked_vulnerabilities: list; tags: list
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

    @field_validator("affected_asset_ids", mode="before")
    @classmethod
    def _default_asset_list(cls, v):
        # Rows written before the migration have this column as NULL, not [].
        return v or []

class IncidentStats(BaseModel):
    total: int; open: int; investigating: int; contained: int; resolved: int; closed: int
    by_severity: dict[str, int]
    by_category: dict[str, int]
    avg_resolution_hours: float | None
    breach_notifications: int


@router.get("", response_model=list[IncidentOut])
async def list_incidents(
    status_filter: str | None = None, severity: str | None = None,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    q = select(Incident).where(Incident.tenant_id == tenant_id)
    if status_filter: q = q.where(Incident.status == status_filter)
    if severity: q = q.where(Incident.severity == severity)
    return [IncidentOut.model_validate(i) for i in (await db.execute(q.order_by(Incident.created_at.desc()))).scalars().all()]

@router.get("/stats", response_model=IncidentStats)
async def get_incident_stats(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    incidents = list((await db.execute(select(Incident).where(Incident.tenant_id == tenant_id))).scalars().all())
    by_sev: dict[str, int] = {}
    by_cat: dict[str, int] = {}
    status_counts = {"open": 0, "investigating": 0, "contained": 0, "resolved": 0, "closed": 0}
    breach_count = 0

    for i in incidents:
        s = i.severity.value if hasattr(i.severity, "value") else str(i.severity)
        c = i.category.value if hasattr(i.category, "value") else str(i.category)
        st = i.status.value if hasattr(i.status, "value") else str(i.status)
        by_sev[s] = by_sev.get(s, 0) + 1
        by_cat[c] = by_cat.get(c, 0) + 1
        if st in status_counts: status_counts[st] += 1
        if i.breach_notification_required: breach_count += 1

    return IncidentStats(
        total=len(incidents), by_severity=by_sev, by_category=by_cat,
        breach_notifications=breach_count, avg_resolution_hours=None,
        **status_counts,
    )

@router.post("", response_model=IncidentOut, status_code=201)
async def create_incident(
    body: IncidentCreate, db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id),
):
    # RFP gap fix (M2.4): each affected-asset id must resolve to a real Asset
    # owned by this tenant (422 listing whichever ids don't) — closes the same
    # cross-tenant IDOR that assert_assets_in_tenant already closes for
    # vulnerabilities.py's affected_assets. Pass-through if the list is empty.
    await assert_assets_in_tenant(db, body.affected_asset_ids, tenant_id, field_name="affected_asset_ids")
    inc = Incident(
        tenant_id=tenant_id, title=body.title, description=body.description,
        category=IncidentCategory(body.category), severity=IncidentSeverity(body.severity),
        reporter_id=user.id, assigned_to_id=body.assigned_to_id,
        detected_at=body.detected_at or datetime.utcnow().isoformat(),
        affected_systems=body.affected_systems, affected_asset_ids=body.affected_asset_ids,
        affected_users_count=body.affected_users_count,
        data_types_affected=body.data_types_affected,
        breach_notification_required=body.breach_notification_required,
        linked_risks=body.linked_risks, linked_controls=body.linked_controls,
        linked_vendors=body.linked_vendors, linked_vulnerabilities=body.linked_vulnerabilities, tags=body.tags,
    )
    db.add(inc); await db.flush(); await db.commit(); await db.refresh(inc)
    return IncidentOut.model_validate(inc)

@router.get("/{iid}", response_model=IncidentOut)
async def get_incident(iid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Incident).where(Incident.id == iid, Incident.tenant_id == tenant_id))
    inc = r.scalar_one_or_none()
    if not inc: raise HTTPException(404, "Incident not found")
    return IncidentOut.model_validate(inc)

@router.patch("/{iid}", response_model=IncidentOut)
async def update_incident(iid: str, body: IncidentUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Incident).where(Incident.id == iid, Incident.tenant_id == tenant_id))
    inc = r.scalar_one_or_none()
    if not inc: raise HTTPException(404, "Incident not found")
    if body.affected_asset_ids is not None:
        await assert_assets_in_tenant(db, body.affected_asset_ids, tenant_id, field_name="affected_asset_ids")
    for f in ["title","description","assigned_to_id","detected_at","contained_at","resolved_at",
              "affected_systems","affected_asset_ids","affected_users_count","data_types_affected","business_impact",
              "financial_impact","root_cause","containment_actions","remediation_actions",
              "lessons_learned","post_mortem_url","breach_notification_required","notification_sent_at",
              "linked_risks","linked_controls","linked_vendors","linked_vulnerabilities","tags"]:
        v = getattr(body, f, None)
        if v is not None: setattr(inc, f, v)
    if body.severity: inc.severity = IncidentSeverity(body.severity)
    if body.status: inc.status = IncidentStatus(body.status)
    if body.category: inc.category = IncidentCategory(body.category)
    await db.commit(); await db.refresh(inc)
    return IncidentOut.model_validate(inc)

@router.delete("/{iid}", status_code=204)
async def delete_incident(iid: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Incident).where(Incident.id == iid, Incident.tenant_id == tenant_id))
    inc = r.scalar_one_or_none()
    if not inc: raise HTTPException(404, "Incident not found")
    await db.delete(inc); await db.commit()
