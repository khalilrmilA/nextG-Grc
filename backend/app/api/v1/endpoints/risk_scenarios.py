"""Risk Scenarios — threat-vulnerability-asset-control chains."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.risk_scenario import RiskScenario
from app.models.risk import Risk
from app.models.scenario_version import RiskScenarioVersion
from app.models.subscription import Subscription
from app.models.tenant import Tenant
from app.models.asset import Asset
from app.models.incident import Incident
from app.models.notification import NotificationType
from app.models.activity_log import ActivityLog
from app.services import risk_scoring, risk_versioning, scenario_mirror, scenario_priority
from app.services.notification_generator import create_notification, get_recipients_for_tenant, notification_exists
from app.services.activity_chain import chain_and_add
from app.api.v1.endpoints.risks import _apply_scoring, _assert_feature
from app.api.v1.endpoints.scenario_versions import _snapshot as _version_snapshot

router = APIRouter()

# RFP gap fix: fields whose change should trigger an automatic pre-update snapshot
# (manual snapshots via POST /scenario-versions/{id}/snapshot still work as before —
# this just adds an automatic one on top, using the exact same _snapshot() shape).
_AUTO_SNAPSHOT_TRIGGER_FIELDS = ["current_probability", "current_impact", "treatment", "justification", "description"]

class ScenarioCreate(BaseModel):
    name: str; description: str | None = None; treatment: str = "untreated"
    threat_ids: list[str] = []; vulnerability_ids: list[str] = []; asset_ids: list[str] = []
    applied_control_ids: list[str] = []; current_probability: int | None = None
    current_impact: int | None = None; target_probability: int | None = None
    target_impact: int | None = None; strength_of_knowledge: str = "medium"
    threat_actor: str | None = None; owner_id: str | None = None
    estimated_loss_min: float | None = None; estimated_loss_max: float | None = None
    estimated_loss_likely: float | None = None; justification: str | None = None
    existing_controls_description: str | None = None; tags: list[str] = []
    appetite_threshold: float | None = None
    next_review_date: str | None = None
    regulatory_exposure_weight: float | None = None
    # Was accepted by PATCH only — a scenario created with incident links lost them.
    linked_incident_ids: list[str] = []

class ScenarioUpdate(BaseModel):
    name: str | None = None; description: str | None = None; treatment: str | None = None
    threat_ids: list[str] | None = None; vulnerability_ids: list[str] | None = None
    asset_ids: list[str] | None = None; applied_control_ids: list[str] | None = None
    current_probability: int | None = None; current_impact: int | None = None
    target_probability: int | None = None; target_impact: int | None = None
    strength_of_knowledge: str | None = None; threat_actor: str | None = None
    owner_id: str | None = None; estimated_loss_min: float | None = None
    estimated_loss_max: float | None = None; estimated_loss_likely: float | None = None
    justification: str | None = None; existing_controls_description: str | None = None
    tags: list[str] | None = None
    appetite_threshold: float | None = None
    next_review_date: str | None = None
    regulatory_exposure_weight: float | None = None
    linked_incident_ids: list[str] | None = None

class ScenarioOut(BaseModel):
    id: str; tenant_id: str; name: str; description: str | None; treatment: str
    threat_ids: list; vulnerability_ids: list; asset_ids: list; applied_control_ids: list
    current_probability: int | None; current_impact: int | None; current_risk_level: str | None
    target_probability: int | None; target_impact: int | None; target_risk_level: str | None
    strength_of_knowledge: str; existing_controls_description: str | None
    threat_actor: str | None; estimated_loss_min: float | None
    estimated_loss_max: float | None; estimated_loss_likely: float | None
    justification: str | None; owner_id: str | None; tags: list
    linked_risk_id: str | None = None
    ref_id: str | None = None
    linked_incident_ids: list = []
    appetite_threshold: float | None = None
    next_review_date: str | None = None
    regulatory_exposure_weight: float | None = None
    priority_score: float | None = None
    # True when the score has reached the tenant's configured alert threshold.
    over_priority_threshold: bool = False
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

async def _assert_incidents_in_tenant(db: AsyncSession, tenant_id: str, incident_ids: list) -> None:
    """Every linked incident must be a real one this tenant owns.

    A scenario is adjusted in light of what actually happened, so these links
    carry weight in the annual review. An unchecked id would put a dangling
    reference into that evidence.
    """
    if not incident_ids:
        return
    rows = (await db.execute(
        select(Incident.id).where(Incident.tenant_id == tenant_id, Incident.id.in_(list(incident_ids)))
    )).all()
    found = {r[0] for r in rows}
    missing = [i for i in incident_ids if i not in found]
    if missing:
        raise HTTPException(422, f"Unknown incident id(s) for this tenant: {', '.join(missing)}")


async def _next_ref_id(db: AsyncSession, tenant_id: str) -> str:
    """Next free "RS-000n" for this tenant.

    Derived from the highest existing number rather than a count, so deleting a
    scenario never causes a reference to be reused — a reused identifier in an
    audit trail is worse than a gap in the sequence.
    """
    rows = (await db.execute(
        select(RiskScenario.ref_id).where(
            RiskScenario.tenant_id == tenant_id, RiskScenario.ref_id.isnot(None)
        )
    )).all()
    highest = 0
    for (ref,) in rows:
        try:
            highest = max(highest, int(str(ref).rsplit("-", 1)[-1]))
        except (ValueError, IndexError):
            continue
    return f"RS-{highest + 1:04d}"


def _level(definition, prob, impact):
    """Qualitative risk level from the tenant's active matrix (unified with the risk register)."""
    return risk_scoring.score_and_level(definition, prob, impact)[1]

def _clamp01(v: float | None) -> float | None:
    """Clamp regulatory_exposure_weight to [0.0, 1.0] rather than rejecting an
    out-of-range value — mirrors Vulnerability.resolve_context_weight's clamp style."""
    if v is None:
        return None
    return max(0.0, min(1.0, v))

async def _tenant_criteria(db: AsyncSession, tenant_id: str) -> dict:
    """The tenant's prioritisation criteria, defaults applied.

    The formula used to be fixed: matrix_score x (1 + regulatory_exposure).
    Two organisations with different risk policies got the same ranking, which
    the requirement explicitly rules out. The defaults reproduce that formula
    exactly, so a tenant that never configures anything is unaffected.
    """
    t = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    return scenario_priority.resolve_criteria(getattr(t, "settings", None))


async def _max_asset_criticality(db: AsyncSession, tenant_id: str, asset_ids: list) -> str | None:
    """Highest criticality among the scenario's assets — an optional criterion.

    Only queried when the tenant has actually enabled it, so the default
    configuration costs no extra round trip.
    """
    if not asset_ids:
        return None
    rows = (await db.execute(
        select(Asset.criticality).where(Asset.tenant_id == tenant_id, Asset.id.in_(list(asset_ids)))
    )).all()
    order = ["low", "medium", "high", "critical"]
    best, rank = None, -1
    for (value,) in rows:
        key = (value if isinstance(value, str) else getattr(value, "value", "") or "").strip().lower()
        if key in order and order.index(key) > rank:
            best, rank = key, order.index(key)
    return best


async def _priority_for(
    db: AsyncSession, tenant_id: str, definition, prob, impact,
    weight: float | None, asset_ids: list | None = None,
) -> tuple[float | None, dict]:
    """(priority_score, criteria) under this tenant's configured criteria."""
    criteria = await _tenant_criteria(db, tenant_id)
    criticality = None
    if criteria.get("asset_criticality_multiplier"):
        criticality = await _max_asset_criticality(db, tenant_id, asset_ids or [])
    return scenario_priority.compute(
        definition, prob, impact, weight, criteria, criticality
    ), criteria

def _scenario_out(s: RiskScenario, criteria: dict) -> ScenarioOut:
    """ScenarioOut with over_priority_threshold actually evaluated.

    The flag was computed in the list view only, so the detail view and every
    write response reported False for a scenario the list showed as over the
    tenant's alert threshold.
    """
    item = ScenarioOut.model_validate(s)
    item.over_priority_threshold = scenario_priority.over_threshold(s.priority_score, criteria)
    return item

def _new_linked_risk(tenant_id: str, s: RiskScenario) -> Risk:
    """RFP rule: auto-consolidate a scenario into the risk register (additive only —
    only ever called when the scenario has no link yet, so a pre-existing
    manually-created Risk is never touched or orphaned)."""
    return Risk(
        tenant_id=tenant_id, title=s.name, description=s.description,
        likelihood=s.current_probability, impact=s.current_impact, owner_id=s.owner_id,
    )

def _scenario_score(s: RiskScenario) -> float | None:
    """Current (inherent, pre-treatment) probability x impact score, used for the
    appetite-breach check below. Deliberately kept as the plain matrix axes product
    (not the weighted priority_score) so the appetite threshold's semantics stay
    predictable — appetite is "is the inherent risk itself too high", a different
    question from "how should this scenario rank against others" (see
    priority_score / _priority_score for the M5.3 weighted-ranking criterion)."""
    if s.current_probability is not None and s.current_impact is not None:
        return s.current_probability * s.current_impact
    return None

def _scenario_over_appetite(s: RiskScenario) -> bool | None:
    if s.appetite_threshold is None:
        return None
    score = _scenario_score(s)
    if score is None:
        return None
    return score > s.appetite_threshold

async def _alert_scenario_over_appetite(db: AsyncSession, tenant_id: str, s: RiskScenario) -> int:
    """RFP gap fix: a scenario can carry its OWN appetite threshold, independent of
    its linked Risk's (risks.py's appetite_threshold/_alert_over_appetite already
    covers the risk-register level). Mirrors that pattern closely but uses a
    distinct NotificationType.SCENARIO_OVER_APPETITE (rather than reusing
    RISK_OVER_APPETITE) so scenario-level and risk-level breaches stay
    distinguishable in the notification feed/filtering — noted here since the task
    allowed either choice.

    Uses the plain probability x impact score (not the weighted priority_score) —
    see _scenario_score's docstring for why appetite and ranking stay separate
    concepts even though both now exist (M5.3 added priority_score/
    regulatory_exposure_weight for ranking; this alert is unchanged by that).
    """
    score = _scenario_score(s)
    created = 0
    recipients = await get_recipients_for_tenant(db, tenant_id)
    for user in recipients:
        if await notification_exists(db, user.id, NotificationType.SCENARIO_OVER_APPETITE, s.id, within_days=7):
            continue
        # STB: the client renders the keys with params so the alert reaches a
        # Tunisian bank in French or Arabic; the strings stay the fallback.
        await create_notification(
            db, user=user, notif_type=NotificationType.SCENARIO_OVER_APPETITE,
            title=f"Scenario over appetite: {s.name[:50]}",
            message=(f"Risk scenario '{s.name}' has a current score of {score} which exceeds "
                     f"its own appetite threshold of {s.appetite_threshold}. Treatment is required."),
            entity_id=s.id, entity_type="risk_scenario",
            link=f"/risk-scenarios?highlight={s.id}", severity="critical",
            title_key="notifications.scenario_over_appetite.title",
            message_key="notifications.scenario_over_appetite.message",
            params={"scenario": s.name, "score": score,
                    "threshold": s.appetite_threshold},
        )
        created += 1
    return created

async def _scenario_versioning_enabled(db: AsyncSession, tenant_id: str) -> bool:
    """Bool check (vs. require_feature's raise-402) used to silently skip the
    automatic pre-update snapshot for tenants without the scenario_versioning
    entitlement — the manual snapshot endpoint stays feature-gated as before."""
    sub = (await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))).scalar_one_or_none()
    return bool(sub and sub.has_feature("scenario_versioning"))

async def _auto_snapshot_if_changed(db: AsyncSession, tenant_id: str, s: RiskScenario, body: "ScenarioUpdate", author_id: str) -> None:
    """RFP gap fix: "l'instantané de version est déclenché manuellement... et non
    archivé automatiquement à chaque modification." Archive the PRE-update state
    whenever a meaningful field (probability, impact, treatment, or the
    justification/description) actually changes — using the exact same _snapshot()
    shape/version-numbering as the manual POST /scenario-versions/{id}/snapshot
    endpoint, so the two are indistinguishable in the timeline other than
    change_reason. Must be called BEFORE the scenario's fields are mutated.
    """
    changed = any(
        getattr(body, f, None) is not None and getattr(body, f) != getattr(s, f)
        for f in _AUTO_SNAPSHOT_TRIGGER_FIELDS
    )
    if not changed or not await _scenario_versioning_enabled(db, tenant_id):
        return
    count = (await db.execute(
        select(func.count()).select_from(RiskScenarioVersion)
        .where(RiskScenarioVersion.scenario_id == s.id)
    )).scalar() or 0
    db.add(RiskScenarioVersion(
        scenario_id=s.id, version_number=int(count) + 1,
        snapshot=_version_snapshot(s), change_reason="Auto-snapshot: pre-update state",
        author_id=author_id,
    ))

class PriorityCriteriaOut(BaseModel):
    """How this organisation ranks its risk scenarios."""
    regulatory_multiplier: float
    asset_criticality_multiplier: float
    alert_threshold: float | None = None
    # Which keys this tenant has actually set, as opposed to inherited.
    configured_keys: list[str] = []


class PriorityCriteriaUpdate(BaseModel):
    regulatory_multiplier: float | None = None
    asset_criticality_multiplier: float | None = None
    alert_threshold: float | None = None
    # Clearing the threshold is a real configuration ("stop alerting"), and it
    # cannot be expressed by omitting the field, which means "leave unchanged".
    clear_alert_threshold: bool = False


@router.get("/priority-criteria", response_model=PriorityCriteriaOut)
async def get_priority_criteria(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """The prioritisation criteria in force. Declared before "/{sid}" so the
    path parameter does not capture it."""
    t = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    stored = ((t.settings or {}).get("risk_priority") or {}) if t and isinstance(t.settings, dict) else {}
    criteria = scenario_priority.resolve_criteria(getattr(t, "settings", None))
    return PriorityCriteriaOut(**criteria, configured_keys=sorted(stored))


@router.patch("/priority-criteria", response_model=PriorityCriteriaOut)
async def set_priority_criteria(
    body: PriorityCriteriaUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Change how scenarios are ranked, and re-score every scenario at once.

    Re-scoring here is the point: the requirement asks for scores to be
    recalculated on every update, and a criteria change updates all of them.
    Leaving existing scenarios on their old scores would mean the register
    ranks by two different policies at the same time.
    """
    t = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Tenant not found")

    patch = body.model_dump(exclude_unset=True)
    for key in ("regulatory_multiplier", "asset_criticality_multiplier"):
        if key in patch and patch[key] is not None and not (0.0 <= float(patch[key]) <= 5.0):
            raise HTTPException(422, f"{key} must be between 0 and 5")

    settings_dict = dict(t.settings or {})
    block = dict(settings_dict.get("risk_priority") or {})
    for key in ("regulatory_multiplier", "asset_criticality_multiplier", "alert_threshold"):
        if key in patch and patch[key] is not None:
            block[key] = patch[key]
    if body.clear_alert_threshold:
        block.pop("alert_threshold", None)
    settings_dict["risk_priority"] = block
    t.settings = settings_dict

    # Re-score every scenario under the new criteria, and record that it
    # happened — "toute modification des criteres ou des scores doit etre
    # historisee" covers the criteria change itself, not only per-scenario edits.
    definition, _name = await risk_scoring.resolve_matrix(db, tenant_id)
    criteria = scenario_priority.resolve_criteria(settings_dict)
    scenarios = (await db.execute(
        select(RiskScenario).where(RiskScenario.tenant_id == tenant_id)
    )).scalars().all()
    versioning_on = await _scenario_versioning_enabled(db, tenant_id)
    rescored = 0
    for sc in scenarios:
        criticality = None
        if criteria.get("asset_criticality_multiplier"):
            criticality = await _max_asset_criticality(db, tenant_id, sc.asset_ids or [])
        new_score = scenario_priority.compute(
            definition, sc.current_probability, sc.current_impact,
            sc.regulatory_exposure_weight, criteria, criticality,
        )
        if new_score != sc.priority_score:
            # Snapshot the pre-change state on each scenario whose score
            # actually moved. Recording only the criteria change would leave a
            # reviewer looking at one scenario's timeline seeing its score jump
            # with nothing to explain it — and the rule is that any change to
            # the criteria *or the scores* is historised.
            if versioning_on:
                count = (await db.execute(
                    select(func.count()).select_from(RiskScenarioVersion)
                    .where(RiskScenarioVersion.scenario_id == sc.id)
                )).scalar() or 0
                db.add(RiskScenarioVersion(
                    scenario_id=sc.id, version_number=int(count) + 1,
                    snapshot=_version_snapshot(sc), author_id=user.id,
                    change_reason=(
                        f"Prioritisation criteria changed; score "
                        f"{sc.priority_score} -> {new_score}"
                    ),
                ))
            sc.priority_score = new_score
            rescored += 1

    await db.commit()
    # The trail is hash-chained. A bare db.add wrote an entry with no seq and no
    # hash — invisible to /activity-log/verify and indistinguishable from one
    # somebody had unlinked. chain_and_add commits, so the criteria change and
    # the re-scored scenarios go in first (the order risk_matrices.py uses).
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=user.id, user_email=user.email,
        action="update", entity_type="risk_priority_criteria", entity_id=tenant_id,
        entity_name="Risk prioritisation criteria",
        details={"criteria": block, "scenarios_rescored": rescored},
    ))
    return PriorityCriteriaOut(**criteria, configured_keys=sorted(block))


@router.get("", response_model=list[ScenarioOut])
async def list_scenarios(
    treatment: str | None = None,
    sort: str | None = None,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id),
):
    q = select(RiskScenario).where(RiskScenario.tenant_id == tenant_id)
    if treatment: q = q.where(RiskScenario.treatment == treatment)
    scenarios = list((await db.execute(q.order_by(RiskScenario.created_at.desc()))).scalars().all())
    if sort == "priority":
        # M5.3: rank by the weighted priority_score instead of creation order.
        # Scenarios with no score yet (no current probability/impact) sort last.
        scenarios.sort(key=lambda s: s.priority_score if s.priority_score is not None else -1.0, reverse=True)
    criteria = await _tenant_criteria(db, tenant_id)
    return [_scenario_out(sc, criteria) for sc in scenarios]

@router.post("", response_model=ScenarioOut, status_code=201)
async def create_scenario(body: ScenarioCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    # Per-scenario appetite threshold is an Elite Pack capability (RFP gap fix),
    # same flag as the risk-register version.
    if body.appetite_threshold is not None:
        await _assert_feature(db, tenant_id, user, "risk_appetite")
    await _assert_incidents_in_tenant(db, tenant_id, body.linked_incident_ids)

    definition, _ = await risk_scoring.resolve_matrix(db, tenant_id)
    ref_id = await _next_ref_id(db, tenant_id)
    reg_weight = _clamp01(body.regulatory_exposure_weight)
    priority_score, criteria = await _priority_for(
        db, tenant_id, definition, body.current_probability,
        body.current_impact, reg_weight, body.asset_ids)
    s = RiskScenario(
        tenant_id=tenant_id, name=body.name, description=body.description,
        treatment=body.treatment, threat_ids=body.threat_ids,
        vulnerability_ids=body.vulnerability_ids, asset_ids=body.asset_ids,
        applied_control_ids=body.applied_control_ids,
        current_probability=body.current_probability, current_impact=body.current_impact,
        current_risk_level=_level(definition, body.current_probability, body.current_impact),
        target_probability=body.target_probability, target_impact=body.target_impact,
        target_risk_level=_level(definition, body.target_probability, body.target_impact),
        strength_of_knowledge=body.strength_of_knowledge, threat_actor=body.threat_actor,
        owner_id=body.owner_id or user.id, estimated_loss_min=body.estimated_loss_min,
        estimated_loss_max=body.estimated_loss_max, estimated_loss_likely=body.estimated_loss_likely,
        justification=body.justification, existing_controls_description=body.existing_controls_description,
        tags=body.tags, appetite_threshold=body.appetite_threshold,
        next_review_date=body.next_review_date,
        regulatory_exposure_weight=reg_weight,
        linked_incident_ids=list(body.linked_incident_ids),
        ref_id=ref_id,
        priority_score=priority_score,
    )
    db.add(s); await db.flush()

    # RFP rule: scenario -> risk-register consolidation. Every new scenario gets a
    # linked Risk row so the register reflects it automatically (additive-only).
    risk = _new_linked_risk(tenant_id, s)
    db.add(risk)
    await _apply_scoring(db, tenant_id, risk)
    await db.flush()
    s.linked_risk_id = risk.id

    # RFP gap fix: immediate alert if the brand-new scenario already breaches its
    # own appetite threshold.
    if _scenario_over_appetite(s):
        await _alert_scenario_over_appetite(db, tenant_id, s)

    await db.commit(); await db.refresh(s)
    return _scenario_out(s, criteria)

@router.get("/{sid}", response_model=ScenarioOut)
async def get_scenario(sid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")
    return _scenario_out(s, await _tenant_criteria(db, tenant_id))

@router.patch("/{sid}", response_model=ScenarioOut)
async def update_scenario(sid: str, body: ScenarioUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")

    # RFP gap fix: archive a version snapshot of the PRE-update state automatically
    # whenever a meaningful field is actually changing — must run before any
    # mutation below. The manual snapshot endpoint (POST /scenario-versions/{id}
    # /snapshot) is untouched and still available for on-demand snapshots.
    await _auto_snapshot_if_changed(db, tenant_id, s, body, current_user.id)

    # Per-scenario appetite threshold is an Elite Pack capability (RFP gap fix).
    if body.appetite_threshold is not None:
        await _assert_feature(db, tenant_id, current_user, "risk_appetite")
    was_over = _scenario_over_appetite(s)

    for f in ["name","description","treatment","threat_ids","vulnerability_ids","asset_ids","applied_control_ids",
              "current_probability","current_impact","target_probability","target_impact","strength_of_knowledge",
              "threat_actor","owner_id","estimated_loss_min","estimated_loss_max","estimated_loss_likely",
              "justification","existing_controls_description","tags","appetite_threshold","next_review_date",
              "regulatory_exposure_weight","linked_incident_ids"]:
        v = getattr(body, f, None)
        if v is not None: setattr(s, f, v)
    if body.linked_incident_ids is not None:
        await _assert_incidents_in_tenant(db, tenant_id, body.linked_incident_ids)
    if body.regulatory_exposure_weight is not None:
        s.regulatory_exposure_weight = _clamp01(s.regulatory_exposure_weight)
    definition, _ = await risk_scoring.resolve_matrix(db, tenant_id)
    s.current_risk_level = _level(definition, s.current_probability, s.current_impact)
    s.target_risk_level = _level(definition, s.target_probability, s.target_impact)
    # M5.3: keep priority_score in sync whenever the score inputs (probability,
    # impact) or the weight itself change.
    s.priority_score, criteria = await _priority_for(
        db, tenant_id, definition, s.current_probability, s.current_impact,
        s.regulatory_exposure_weight, s.asset_ids,
    )

    # RFP rule: keep the linked risk-register entry's likelihood/impact (and
    # matrix-derived severity) in sync with the scenario's current probability/impact.
    if s.linked_risk_id:
        linked = (await db.execute(
            select(Risk).where(Risk.id == s.linked_risk_id, Risk.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if linked is not None:
            # Follow-up C-5: version the register entry BEFORE the re-score, so its
            # History credits the scenario edit instead of showing an unexplained jump.
            if (linked.likelihood, linked.impact) != (s.current_probability, s.current_impact):
                await risk_versioning.archive(
                    db, linked, current_user, change_reason=f"Re-scored from risk scenario: {s.name}")
            linked.likelihood = s.current_probability
            linked.impact = s.current_impact
            await _apply_scoring(db, tenant_id, linked)
    elif s.current_probability is not None or s.current_impact is not None:
        # Backfill: this scenario predates auto-consolidation and has no link yet.
        # Safe to create one now since there was no pre-existing link to orphan.
        risk = _new_linked_risk(tenant_id, s)
        db.add(risk)
        await _apply_scoring(db, tenant_id, risk)
        await db.flush()
        s.linked_risk_id = risk.id

    # RFP gap fix: alert when the scenario newly breaches its OWN appetite threshold.
    if _scenario_over_appetite(s) and not was_over:
        await _alert_scenario_over_appetite(db, tenant_id, s)

    await db.commit(); await db.refresh(s)
    return _scenario_out(s, criteria)

@router.delete("/{sid}", status_code=204)
async def delete_scenario(sid: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")

    # This was the last hard-delete in the risk group leaving nothing behind but
    # the middleware's {method, path}: risks, incidents, vulnerabilities and
    # assets all chain their final state first. Snapshot the same fields the
    # version history stores, so the analysis that was destroyed is still
    # readable from the tamper-evident chain.
    scenario_name = s.name
    payload = _version_snapshot(s)
    # Recorded so a later reader (and scripts/backfill_scenario_mirrors.py) can
    # tell which register entry this scenario had created.
    payload["linked_risk_id"] = s.linked_risk_id

    # RiskScenarioVersion rows hang off scenario_id with no database-level
    # cascade (SQLite runs with foreign_keys off), and GET /scenario-versions/{id}
    # resolves the parent scenario first — so left behind they 404 forever while
    # the rows stay in the table. Record their identity, then remove them here.
    versions = list((await db.execute(
        select(RiskScenarioVersion)
        .where(RiskScenarioVersion.scenario_id == sid)
        .order_by(RiskScenarioVersion.version_number.desc())
    )).scalars().all())

    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="delete", entity_type="risk_scenario", entity_id=sid,
            entity_name=scenario_name,
            details={"deleted": payload, "archived_versions": [
                {"version_number": v.version_number, "change_reason": v.change_reason,
                 "author_id": v.author_id}
                for v in versions
            ]},
            origin="api",
        ))
    except Exception:
        # Log-and-continue, as in risks.delete_risk: an audit failure must not
        # strand the delete half-done.
        pass

    for v in versions:
        await db.delete(v)

    # Follow-up C-5: the register entry this scenario created goes with it —
    # deleted if nothing else rests on it, otherwise closed ("Scenario deleted").
    mirror_outcome = None
    mirror_id = s.linked_risk_id
    if mirror_id:
        mirror = (await db.execute(
            select(Risk).where(Risk.id == mirror_id, Risk.tenant_id == tenant_id))).scalar_one_or_none()
        if mirror is not None:
            mirror_title = mirror.title
            mirror_outcome = await scenario_mirror.retire(
                db, tenant_id, mirror, current_user, scenario_id=sid, scenario_name=scenario_name)
    await db.delete(s); await db.commit()
    if mirror_outcome in ("deleted", "closed"):
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
                action="delete" if mirror_outcome == "deleted" else "close", entity_type="risk",
                entity_id=mirror_id, entity_name=mirror_title,
                details={"reason": scenario_mirror.SCENARIO_DELETED, "scenario_id": sid,
                         "scenario_name": scenario_name}, origin="api",
            ))
        except Exception:
            pass
