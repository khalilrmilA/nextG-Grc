"""Vulnerability Management — track CVEs, misconfigs, and weaknesses.

Elite Pack (RFP module 3):
- Robust list-field coercion: ``affected_systems`` / ``affected_assets`` accept a
  comma-string OR a list and are always stored as a JSON list.
- Validation workflow: manual vulnerabilities start ``pending_validation`` and a
  security referent (CISO) validates them via POST /{id}/validate before they
  enter risk analysis.
- Composite impact scoring (gated: ``vuln_impact_scoring``) via POST /{id}/impact,
  tied to the risk scenarios the vulnerability feeds (GET/PUT /{id}/risk-scenarios)
  so an impact evaluation is traceable to the scenarios it informs, and every
  scored value is snapshotted with the scenario set it was judged against.

STB tender, objectif 2 (« tendances historiques »):
- GET /trend returns a monthly series of point-in-time vulnerability counts,
  read from the daily ``trend_snapshots`` history and degrading to an
  intake-volume proxy while that history is still empty.
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import String, cast, select, func
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant
from app.api.v1.dependencies.auth import (
    get_current_user, get_tenant_id, require_roles, require_roles_strict,
)
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
from app.models.risk_scenario import RiskScenario
from app.models.activity_log import ActivityLog
from app.models.trend_snapshot import METRIC_VULNERABILITIES, month_buckets
from app.services.activity_chain import chain_and_add
from app.services.risk_scoring import resolve_matrix
from app.services.trend_snapshot_scheduler import snapshot_series, unavailable_series

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

    @field_validator(
        "affected_assets", "affected_systems", "fixed_by_controls", "references", "tags",
        mode="before",
    )
    @classmethod
    def _none_to_list(cls, v):
        # A row whose JSON list column is NULL — one written before a column
        # existed, or by a script that bypassed the ORM default — used to fail
        # validation for the *whole* response, taking the entire register down
        # with a 500. Same guard IncidentOut and ThreatOut already carry.
        return v if isinstance(v, list) else ([] if v is None else v)


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
    linked_scenario_ids: list = []
    model_config = {"from_attributes": True}


class LinkedScenarioOut(BaseModel):
    """A risk scenario this vulnerability feeds, as shown next to its impact score."""
    id: str; name: str
    current_probability: int | None = None; current_impact: int | None = None
    current_risk_level: str | None = None
    linked_risk_id: str | None = None
    model_config = {"from_attributes": True}


class VulnScenarioLinkOut(BaseModel):
    """The impact evaluation's tie to the risk analysis.

    ``suggested_impact_level`` translates the 0-100 composite score onto the
    tenant's own impact scale (a 5x5 matrix gives 1-5). It is a suggestion and
    nothing more — it is never written to the scenario. Pushing a computed
    number straight into the scenario's ``current_impact`` would overwrite an
    assessor's deliberate judgement with an automatic one, and the two are
    different claims: the composite score rates this vulnerability on this
    asset, the scenario's impact rates the whole threat chain.
    """
    vulnerability_id: str
    impact_score: float | None = None
    impact_scale_size: int
    suggested_impact_level: int | None = None
    scenarios: list[LinkedScenarioOut] = []


class ScenarioLinkIn(BaseModel):
    """The exact set of scenarios that should reference this vulnerability."""
    scenario_ids: list[str] = []


async def _scenarios_for_vuln(db: AsyncSession, tenant_id: str, vid: str) -> list[RiskScenario]:
    """Scenarios whose threat chain includes this vulnerability.

    ``vulnerability_ids`` is a JSON list stored as text; the id is matched with
    its surrounding quotes so one uuid can never match another as a substring.
    """
    rows = (await db.execute(
        select(RiskScenario).where(
            RiskScenario.tenant_id == tenant_id,
            cast(RiskScenario.vulnerability_ids, String).ilike(f'%"{vid}"%'),
        ).order_by(RiskScenario.created_at.desc())
    )).scalars().all()
    # The LIKE is a pre-filter the database can run; confirm membership in Python
    # so a malformed JSON blob can never produce a false positive.
    return [s for s in rows if vid in (s.vulnerability_ids or [])]


def _suggested_impact_level(score: float | None, scale_size: int) -> int | None:
    """Map a 0-100 composite score onto a 1..scale_size impact scale."""
    if score is None or scale_size < 1:
        return None
    import math
    level = math.ceil((max(0.0, min(100.0, float(score))) / 100.0) * scale_size)
    return max(1, min(scale_size, level))


async def _scenario_link_view(
    db: AsyncSession, tenant_id: str, v: Vulnerability
) -> VulnScenarioLinkOut:
    definition, _name = await resolve_matrix(db, tenant_id)
    scale = int(((definition or {}).get("impact") or {}).get("count") or 5)
    scenarios = await _scenarios_for_vuln(db, tenant_id, v.id)
    return VulnScenarioLinkOut(
        vulnerability_id=v.id,
        impact_score=v.impact_score,
        impact_scale_size=scale,
        suggested_impact_level=_suggested_impact_level(v.impact_score, scale),
        scenarios=[LinkedScenarioOut.model_validate(s) for s in scenarios],
    )


@router.get("", response_model=list[VulnOut])
async def list_vulns(
    response: Response,
    severity: str | None = None,
    status_filter: str | None = None,
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Bounded: this used to return the whole table in one response.

    The list shape is unchanged so no client breaks; the total goes in
    X-Total-Count so a caller can tell when it has not seen everything.
    """
    q = select(Vulnerability).where(Vulnerability.tenant_id == tenant_id)
    if severity: q = q.where(Vulnerability.severity == severity)
    if status_filter: q = q.where(Vulnerability.status == status_filter)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    response.headers["X-Total-Count"] = str(total)
    rows = (await db.execute(
        q.order_by(Vulnerability.created_at.desc()).offset(offset).limit(limit)
    )).scalars().all()
    return [VulnOut.model_validate(v) for v in rows]

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

@router.get("/trend")
async def get_vuln_trend(
    # Declared BEFORE GET /{vid}: FastAPI matches in declaration order, so a
    # /trend route added after the path-parameter route would be swallowed by
    # it and answer "Vulnerability not found".
    db: Annotated[AsyncSession, Depends(get_db)],
    # Billing half + access half, exactly as endpoints/dashboards.py composes
    # them for GET /dashboards/vulnerabilities. This series IS that dashboard's
    # history, so it carries the same two gates: a looser gate here would be a
    # way around the restriction on the live tile. Objectif 2 phrases the
    # access clause as an exclusion (« limité aux analystes sécurité »), hence
    # require_roles_strict — no tenant_admin/super_admin auto-pass. CISO is
    # listed alongside SECURITY_ANALYST for the same reason as in dashboards.py:
    # no account on this installation holds security_analyst, so that role
    # alone would lock out every real user of the screen.
    _plan: Annotated[User, Depends(require_feature("custom_dashboards"))],
    _role: Annotated[User, Depends(require_roles_strict(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    months: int = Query(6, ge=1, le=24),
):
    """« Tendances historiques » for the vulnerability dashboard (objectif 2).

    Preferred source is ``trend_snapshots`` — one point-in-time row per tenant
    per UTC day written by app.services.trend_snapshot_scheduler — read back as
    the last snapshot on or before each month's end. That is a real balance:
    how many vulnerabilities stood open, by severity, on that date.

    Careful with the word "open" when labelling this on screen: ``counts.open``
    here is *unresolved* — everything except mitigated/accepted/closed/false
    positive, so it includes pending_validation, validated and in_remediation —
    while the ``open`` tile on GET /stats counts only the literal
    ``status == "open"``. On this database the demo tenant's six vulnerabilities
    are all ``pending_validation``, so the same register reads 6 here and 0 on
    the tile. Both are defensible; putting them side by side under the same word
    is not, so label the series "unresolved" (« non résolues ») or drive it from
    ``counts.by_status``, which carries every bucket unaggregated.

    Fallback (``source: "intake_volume"``) when no snapshot exists yet — a
    fresh deploy, or the window before the scheduler's first run. It buckets
    ``created_at`` by month, which counts what was *discovered* in each month
    and says nothing about what was fixed. It is a real signal and it is
    labelled as the different thing it is; ``source`` is how a caller tells
    them apart, and the two payloads deliberately do not pretend to carry the
    same breakdowns (an intake bucket cannot know a past status).
    """
    buckets = month_buckets(months)

    series = await snapshot_series(db, tenant_id, METRIC_VULNERABILITIES, buckets)
    if series is not None:
        return {
            "metric": METRIC_VULNERABILITIES,
            "months": months,
            "series": series,
            "source": "trend_snapshot_daily",
            "note": (
                "Point-in-time vulnerability counts as of the latest daily "
                "snapshot on or before each month's end."
            ),
        }

    # --- Fallback: intake volume from created_at -----------------------------
    # Bucketed in Python rather than with func.strftime('%Y-%m', ...): strftime
    # is SQLite-only and this application also targets PostgreSQL, Oracle and
    # SQL Server (see app/core/database.py). The window is bounded to the
    # requested months, so this reads at most a few hundred rows.
    window_start = datetime(buckets[0][0], buckets[0][1], 1)
    try:
        rows = (await db.execute(
            select(Vulnerability.created_at, Vulnerability.severity).where(
                Vulnerability.tenant_id == tenant_id,
                Vulnerability.created_at.isnot(None),
                Vulnerability.created_at >= window_start,
            )
        )).all()
    except (OperationalError, ProgrammingError):
        # Degrade rather than 5xx, and degrade to "unknown" rather than to a
        # month-by-month row of zeros: a chart that says "0 new vulnerabilities
        # in six months" because the query failed is a fabricated finding, and
        # on this product it would be a flattering one.
        await db.rollback()
        return {
            "metric": METRIC_VULNERABILITIES,
            "months": months,
            "series": unavailable_series(buckets),
            "source": "unavailable",
            "note": (
                "Vulnerability history could not be read on this database. "
                "No figures are shown rather than zeros."
            ),
        }
    per_month: dict[str, dict[str, int]] = {}
    for created_at, severity in rows:
        if not created_at:
            continue
        key = f"{created_at.year:04d}-{created_at.month:02d}"
        sev = severity.value if hasattr(severity, "value") else str(severity)
        bucket = per_month.setdefault(key, {})
        bucket[sev] = bucket.get(sev, 0) + 1

    fallback_series = []
    for (yy, mm) in buckets:
        key = f"{yy:04d}-{mm:02d}"
        by_severity = per_month.get(key, {})
        fallback_series.append({
            "month": datetime(yy, mm, 1).strftime("%b"),
            "period": key,
            "as_of": None,
            "total": sum(by_severity.values()),
            "counts": {"by_severity": by_severity},
        })
    return {
        "metric": METRIC_VULNERABILITIES,
        "months": months,
        "series": fallback_series,
        "source": "intake_volume",
        # Wording is deliberately "no snapshot is available" and not "none has
        # been recorded yet": snapshot_series() returns None both when the
        # history is genuinely empty AND when it could not be read (table not
        # created until the next restart, or a transient SQLite lock under the
        # 2 workers). Only the first of those is a fact about the register; the
        # second is a fact about this request. Stating the first when the second
        # happened is the same fabricated-figure problem as plotting a 0.
        "note": (
            "No point-in-time snapshot is available for this period — showing "
            "newly recorded vulnerabilities per month (discovery volume), not the "
            "open balance."
        ),
    }

@router.post("", response_model=VulnOut, status_code=201)
async def create_vuln(
    body: VulnCreate,
    db: AsyncSession = Depends(get_db),
    # Creating a security finding was the ONE write in this module still open to
    # every authenticated user, while PATCH / DELETE / validate / impact /
    # risk-scenario linking are all restricted to {CISO, RISK_MANAGER}. A VIEWER
    # ("Read-only access") or an EXECUTIVE could therefore insert rows into the
    # vulnerability register and then be unable to correct or remove them.
    # Same set as update_vuln so the module has one write role; tenant_admin and
    # super_admin auto-pass inside require_roles, and reads stay open.
    _: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
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

    # Capture the before-state so the edit leaves a history. The client requires
    # that a manually recorded vulnerability be modifiable only by authorised
    # users *with a record of the modifications* — the role gate above covers
    # the first half; without this the second half is missing, and the generic
    # request log records only that a PATCH happened, not what changed.
    tracked = ["title","description","cvss_score","affected_assets","affected_systems","remediation_plan","remediation_owner_id","remediation_due_date","fixed_by_controls","tags"] + ["severity", "status"]
    before = {f: getattr(v, f, None) for f in tracked}

    for f in ["title","description","cvss_score","affected_assets","affected_systems","remediation_plan","remediation_owner_id","remediation_due_date","fixed_by_controls","tags"]:
        val = getattr(body, f, None)
        if val is not None: setattr(v, f, val)
    if body.severity: v.severity = body.severity
    if body.status: v.status = body.status
    await db.commit(); await db.refresh(v)

    changed = {}
    for f in tracked:
        old, new = before[f], getattr(v, f, None)
        old = old.value if hasattr(old, "value") else old
        new = new.value if hasattr(new, "value") else new
        if old != new:
            changed[f] = {"from": old, "to": new}
    if changed:
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id,
                user_id=current_user.id,
                user_email=current_user.email,
                action="update",
                entity_type="vulnerability",
                entity_id=v.id,
                entity_name=v.title,
                details={"changed": changed, "source": v.source},
                origin="api",
            ))
        except Exception:
            pass
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
    # require_feature is the plan gate, not an access-control gate: on its own it
    # let anyone in an entitled tenant override a finding's impact — including
    # roles that cannot even PATCH the vulnerability. Same security-referent set
    # as the mutations above (admins auto-pass inside require_roles).
    _role: Annotated[User, Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER))],
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

    # The scenarios this evaluation applies to, as they stand right now — stored
    # on the history row so the record shows the scope that was actually judged
    # even after the links are edited.
    scenario_ids = [sc.id for sc in await _scenarios_for_vuln(db, tenant_id, v.id)]

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
            changed_by_id=current_user.id, linked_scenario_ids=scenario_ids,
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
        changed_by_id=current_user.id, linked_scenario_ids=scenario_ids,
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

@router.get("/{vid}/risk-scenarios", response_model=VulnScenarioLinkOut)
async def list_vuln_scenarios(
    vid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """The risk scenarios this vulnerability's impact evaluation is attached to.

    The link itself already existed in one direction — a scenario names the
    vulnerabilities in its threat chain — but there was no way to read it from
    the vulnerability, which is where the impact is actually assessed. Without
    it the composite score sat in isolation, unconnected to any risk analysis.
    """
    v = (await db.execute(
        select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vulnerability not found")
    return await _scenario_link_view(db, tenant_id, v)

@router.put("/{vid}/risk-scenarios", response_model=VulnScenarioLinkOut)
async def set_vuln_scenarios(
    vid: str,
    body: ScenarioLinkIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    # Deliberately the SAME gate as PATCH /risk-scenarios/{id} (risk_manager /
    # ciso). This endpoint writes RiskScenario.vulnerability_ids, so a looser
    # gate here would be a way around the one guarding the scenario itself.
    current_user: Annotated[User, Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Attach this vulnerability to (exactly) the given risk scenarios.

    Writes through to ``RiskScenario.vulnerability_ids``, the field the scenario
    screen and the risk consolidation already read, rather than introducing a
    second place the same link can live and drift.
    """
    v = (await db.execute(
        select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vulnerability not found")

    wanted = list(dict.fromkeys(body.scenario_ids or []))
    targets: dict[str, RiskScenario] = {}
    if wanted:
        rows = (await db.execute(
            select(RiskScenario).where(
                RiskScenario.tenant_id == tenant_id, RiskScenario.id.in_(wanted)
            )
        )).scalars().all()
        targets = {sc.id: sc for sc in rows}
        missing = [sid for sid in wanted if sid not in targets]
        if missing:
            raise HTTPException(422, f"Unknown risk scenario(s) for this tenant: {', '.join(missing)}")

    current = {sc.id: sc for sc in await _scenarios_for_vuln(db, tenant_id, v.id)}

    for sid, sc in targets.items():
        if sid not in current:
            # Reassign rather than mutate in place: SQLAlchemy does not track
            # in-place edits to a JSON column, so an .append() would be silently
            # dropped on commit.
            sc.vulnerability_ids = list(sc.vulnerability_ids or []) + [v.id]
    for sid, sc in current.items():
        if sid not in targets:
            sc.vulnerability_ids = [x for x in (sc.vulnerability_ids or []) if x != v.id]

    await db.commit()
    return await _scenario_link_view(db, tenant_id, v)

@router.delete("/{vid}", status_code=204)
async def delete_vuln(
    vid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    # Was a bare get_current_user: every authenticated tenant user — including
    # roles that cannot PATCH a vulnerability — could permanently delete a
    # security finding. Deleting is at least as sensitive as editing, so it
    # takes the same gate as PATCH /{vid}.
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    r = await db.execute(select(Vulnerability).where(Vulnerability.id == vid, Vulnerability.tenant_id == tenant_id))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Vulnerability not found")
    # The row is about to be gone for good and there is no soft-delete column on
    # this model, so the final state goes into the tamper-evident chain first —
    # otherwise the trail keeps only "someone DELETEd this id", not what the
    # finding said. Best-effort, exactly as in update_vuln above.
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=current_user.id,
            user_email=current_user.email,
            action="delete",
            entity_type="vulnerability",
            entity_id=v.id,
            entity_name=v.title,
            details={"deleted": {
                "ref_id": v.ref_id, "title": v.title,
                "severity": v.severity if isinstance(v.severity, str) else v.severity.value,
                "status": v.status if isinstance(v.status, str) else v.status.value,
                "cvss_score": v.cvss_score, "source": v.source,
                "affected_assets": list(v.affected_assets or []),
                "affected_systems": list(v.affected_systems or []),
                "impact_score": v.impact_score,
            }},
            origin="api",
        ))
    except Exception:
        pass
    await db.delete(v); await db.commit()
