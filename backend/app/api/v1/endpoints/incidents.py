"""Incident Management — track, investigate, and resolve security incidents.

Elite Pack (RFP gap fix M2.4): ``affected_asset_ids`` is a validated FK-style
link to real tenant Assets, alongside the pre-existing free-text
``affected_systems`` (kept for backward compat / free-text notes). Each id is
checked against this tenant's Asset table on create/update — same IDOR-safe
pattern as vulnerabilities.py's ``affected_assets`` (see
app/core/security_utils.py's ``assert_assets_in_tenant``).
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.activity_log import ActivityLog
from app.models.incident import Incident, IncidentSeverity, IncidentStatus, IncidentCategory
from app.services.activity_chain import chain_and_add

router = APIRouter()


def _enum(enum_cls, value: str, field: str):
    """Coerce a client string onto an enum member — 422, not 500, when it isn't one.

    ``IncidentCategory("ransomware")`` raises ValueError, which reached the client
    as an unhandled 500 for what is plainly a bad request.
    """
    try:
        return enum_cls(value)
    except ValueError:
        raise HTTPException(
            422,
            f"Invalid {field} '{value}'. Expected one of: {', '.join(e.value for e in enum_cls)}",
        )


def _parse_ts(value: str | None) -> datetime | None:
    """Parse one of the ISO timestamp columns, as naive UTC. None when unparseable.

    detected_at / resolved_at are free-form String(30) columns fed straight from
    the client, so anything in them may not be a timestamp at all.
    """
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


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
    # Dead column until now: IncidentOut has always returned regulatory_reference
    # but nothing could set it (all-NULL in production). Accepted here so the
    # breach-notification reference can actually be recorded.
    regulatory_reference: str | None = None
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

    @field_validator(
        "affected_systems", "affected_asset_ids", "data_types_affected",
        "linked_risks", "linked_controls",
        "linked_vendors", "linked_vulnerabilities", "tags",
        mode="before",
    )
    @classmethod
    def _default_asset_list(cls, v):
        # Rows written before the migration have these columns as NULL, not [].
        # One such row used to fail validation for the *whole* response, so a
        # single legacy or imported incident took the entire list down with a
        # 500. Same guard ThreatOut already carries for the same reason.
        return v if isinstance(v, list) else ([] if v is None else v)

class IncidentStats(BaseModel):
    total: int; open: int; investigating: int; contained: int; resolved: int; closed: int
    # IncidentStatus.POST_MORTEM is an accepted status that was counted in no
    # bucket, so `total` stopped equalling the sum of the statuses as soon as an
    # incident reached it. Defaulted like `critical` below so a client that does
    # not know the field is unaffected.
    post_mortem: int = 0
    # Count of severity=critical. Additive: the Incidents page has always read
    # `stats.critical` for its fourth KPI tile, which the API never returned, so
    # the tile rendered empty.
    critical: int = 0
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
    status_counts = {"open": 0, "investigating": 0, "contained": 0, "resolved": 0,
                     "closed": 0, "post_mortem": 0}
    breach_count = 0
    # Detected -> resolved, in hours. This was hard-coded to None, so the field
    # was always null for every tenant.
    resolution_hours: list[float] = []

    for i in incidents:
        s = i.severity.value if hasattr(i.severity, "value") else str(i.severity)
        c = i.category.value if hasattr(i.category, "value") else str(i.category)
        st = i.status.value if hasattr(i.status, "value") else str(i.status)
        by_sev[s] = by_sev.get(s, 0) + 1
        by_cat[c] = by_cat.get(c, 0) + 1
        if st in status_counts: status_counts[st] += 1
        if i.breach_notification_required: breach_count += 1
        start, end = _parse_ts(i.detected_at), _parse_ts(i.resolved_at)
        if start and end and end >= start:
            resolution_hours.append((end - start).total_seconds() / 3600.0)

    return IncidentStats(
        total=len(incidents), critical=by_sev.get("critical", 0),
        by_severity=by_sev, by_category=by_cat,
        breach_notifications=breach_count,
        avg_resolution_hours=round(sum(resolution_hours) / len(resolution_hours), 1) if resolution_hours else None,
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
        category=_enum(IncidentCategory, body.category, "category"),
        severity=_enum(IncidentSeverity, body.severity, "severity"),
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
              "regulatory_reference",
              "linked_risks","linked_controls","linked_vendors","linked_vulnerabilities","tags"]:
        v = getattr(body, f, None)
        if v is not None: setattr(inc, f, v)
    if body.severity: inc.severity = _enum(IncidentSeverity, body.severity, "severity")
    if body.status: inc.status = _enum(IncidentStatus, body.status, "status")
    if body.category: inc.category = _enum(IncidentCategory, body.category, "category")
    await db.commit(); await db.refresh(inc)
    return IncidentOut.model_validate(inc)

@router.delete("/{iid}", status_code=204)
async def delete_incident(iid: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(Incident).where(Incident.id == iid, Incident.tenant_id == tenant_id))
    inc = r.scalar_one_or_none()
    if not inc: raise HTTPException(404, "Incident not found")
    # An incident is a record of fact — it can carry a regulatory breach
    # notification — and this row is about to be gone for good. The generic
    # request log would keep only "someone DELETEd this id", so the final state
    # goes into the tamper-evident chain first, the same way threats.py records
    # a deletion before it happens. Best-effort: an audit failure must not
    # leave the caller unable to delete.
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=user.id, user_email=user.email,
            action="delete", entity_type="incident", entity_id=inc.id,
            entity_name=inc.title,
            details={"deleted": {
                "title": inc.title,
                "category": inc.category.value if hasattr(inc.category, "value") else inc.category,
                "severity": inc.severity.value if hasattr(inc.severity, "value") else inc.severity,
                "status": inc.status.value if hasattr(inc.status, "value") else inc.status,
                "detected_at": inc.detected_at, "resolved_at": inc.resolved_at,
                "breach_notification_required": inc.breach_notification_required,
                "notification_sent_at": inc.notification_sent_at,
                "financial_impact": inc.financial_impact,
            }},
            origin="api",
        ))
    except Exception:
        pass
    await db.delete(inc); await db.commit()


# ─── Incident → Risk Scenario draft ────────────────────────────────────────
# Deterministic (no AI call): turns an incident that already happened into a
# pre-filled Risk Scenario draft. Nothing is persisted here — the frontend
# takes this payload, lets the user review/edit it, then POSTs it to the
# normal POST /risk-scenarios create endpoint like any manually-entered
# scenario. Keeps Incidents and Risk Scenarios connected without letting an
# incident silently spawn a scenario record behind the user's back.

_CATEGORY_TO_THREAT_CATEGORY: dict[str, str] = {
    "data_breach": "cyber_attack",
    "unauthorized_access": "cyber_attack",
    "malware": "cyber_attack",
    "dos_attack": "cyber_attack",
    "phishing": "social_engineering",
    "insider_threat": "insider_threat",
    "physical_security": "physical",
    "system_outage": "technical_failure",
    "policy_violation": "human_error",
}

_SEVERITY_TO_PROBABILITY: dict[str, int] = {"critical": 5, "high": 5, "medium": 4, "low": 3}
_SEVERITY_TO_IMPACT: dict[str, int] = {"critical": 5, "high": 4, "medium": 3, "low": 2}


class ScenarioDraft(BaseModel):
    name: str
    description: str | None
    justification: str
    asset_ids: list[str]
    threat_ids: list[str]
    current_probability: int
    current_impact: int
    source_incident_id: str


@router.get("/{iid}/scenario-draft", response_model=ScenarioDraft)
async def get_incident_scenario_draft(iid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    from app.models.threat import Threat

    r = await db.execute(select(Incident).where(Incident.id == iid, Incident.tenant_id == tenant_id))
    inc = r.scalar_one_or_none()
    if not inc: raise HTTPException(404, "Incident not found")

    severity = inc.severity.value if hasattr(inc.severity, "value") else str(inc.severity)
    category = inc.category.value if hasattr(inc.category, "value") else str(inc.category)

    threat_ids: list[str] = []
    threat_category = _CATEGORY_TO_THREAT_CATEGORY.get(category)
    if threat_category:
        tr = await db.execute(
            select(Threat.id)
            .where(
                (Threat.is_builtin == True) | (Threat.tenant_id == tenant_id),  # noqa: E712
                Threat.is_pending == False,  # noqa: E712
                Threat.category == threat_category,
            )
            .limit(5)
        )
        threat_ids = [row[0] for row in tr.all()]

    detected = inc.detected_at or "an unknown date"
    justification = (
        f"Drafted from incident \"{inc.title}\" (severity: {severity}, detected {detected}). "
        f"This scenario captures the risk this incident demonstrated actually materialized — "
        f"review and adjust before saving."
    )

    return ScenarioDraft(
        name=f"[From incident] {inc.title}",
        description=inc.description,
        justification=justification,
        asset_ids=list(inc.affected_asset_ids or []),
        threat_ids=threat_ids,
        current_probability=_SEVERITY_TO_PROBABILITY.get(severity, 3),
        current_impact=_SEVERITY_TO_IMPACT.get(severity, 3),
        source_incident_id=inc.id,
    )
