"""Risk Scenarios — threat-vulnerability-asset-control chains."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.risk_scenario import RiskScenario
from app.models.risk import Risk
from app.models.scenario_version import RiskScenarioVersion
from app.models.subscription import Subscription
from app.models.notification import NotificationType
from app.services import risk_scoring
from app.services.notification_generator import create_notification, get_recipients_for_tenant, notification_exists
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
    appetite_threshold: float | None = None
    next_review_date: str | None = None
    regulatory_exposure_weight: float | None = None
    priority_score: float | None = None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

def _level(definition, prob, impact):
    """Qualitative risk level from the tenant's active matrix (unified with the risk register)."""
    return risk_scoring.score_and_level(definition, prob, impact)[1]

def _clamp01(v: float | None) -> float | None:
    """Clamp regulatory_exposure_weight to [0.0, 1.0] rather than rejecting an
    out-of-range value — mirrors Vulnerability.resolve_context_weight's clamp style."""
    if v is None:
        return None
    return max(0.0, min(1.0, v))

def _priority_score(definition, prob, impact, weight: float | None) -> float | None:
    """M5.3: weighted prioritization criterion on top of the matrix score.

    Business rule (deliberately simple, documented since it's non-obvious):
    priority_score = matrix_score * (1 + regulatory_exposure_weight). weight=0 (or
    unset) leaves the score unchanged; weight=1 (max regulatory exposure — e.g. the
    scenario touches PCI-DSS/GDPR/central-bank-reportable data) doubles it. This lets
    two scenarios with an identical probability x impact score be ranked apart by
    regulatory exposure without discarding the underlying matrix score. None if the
    scenario has no current probability/impact yet (nothing to rank).
    """
    score, _ = risk_scoring.score_and_level(definition, prob, impact)
    if score is None:
        return None
    return round(score * (1 + (weight or 0.0)), 2)

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
        await create_notification(
            db, user=user, notif_type=NotificationType.SCENARIO_OVER_APPETITE,
            title=f"Scenario over appetite: {s.name[:50]}",
            message=(f"Risk scenario '{s.name}' has a current score of {score} which exceeds "
                     f"its own appetite threshold of {s.appetite_threshold}. Treatment is required."),
            entity_id=s.id, entity_type="risk_scenario",
            link=f"/risk-scenarios?highlight={s.id}", severity="critical",
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
    return [ScenarioOut.model_validate(s) for s in scenarios]

@router.post("", response_model=ScenarioOut, status_code=201)
async def create_scenario(body: ScenarioCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    # Per-scenario appetite threshold is an Elite Pack capability (RFP gap fix),
    # same flag as the risk-register version.
    if body.appetite_threshold is not None:
        await _assert_feature(db, tenant_id, user, "risk_appetite")

    definition, _ = await risk_scoring.resolve_matrix(db, tenant_id)
    reg_weight = _clamp01(body.regulatory_exposure_weight)
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
        priority_score=_priority_score(definition, body.current_probability, body.current_impact, reg_weight),
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
    return ScenarioOut.model_validate(s)

@router.get("/{sid}", response_model=ScenarioOut)
async def get_scenario(sid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")
    return ScenarioOut.model_validate(s)

@router.patch("/{sid}", response_model=ScenarioOut)
async def update_scenario(sid: str, body: ScenarioUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
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
              "regulatory_exposure_weight"]:
        v = getattr(body, f, None)
        if v is not None: setattr(s, f, v)
    if body.regulatory_exposure_weight is not None:
        s.regulatory_exposure_weight = _clamp01(s.regulatory_exposure_weight)
    definition, _ = await risk_scoring.resolve_matrix(db, tenant_id)
    s.current_risk_level = _level(definition, s.current_probability, s.current_impact)
    s.target_risk_level = _level(definition, s.target_probability, s.target_impact)
    # M5.3: keep priority_score in sync whenever the score inputs (probability,
    # impact) or the weight itself change.
    s.priority_score = _priority_score(definition, s.current_probability, s.current_impact, s.regulatory_exposure_weight)

    # RFP rule: keep the linked risk-register entry's likelihood/impact (and
    # matrix-derived severity) in sync with the scenario's current probability/impact.
    if s.linked_risk_id:
        linked = (await db.execute(
            select(Risk).where(Risk.id == s.linked_risk_id, Risk.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if linked is not None:
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
    return ScenarioOut.model_validate(s)

@router.delete("/{sid}", status_code=204)
async def delete_scenario(sid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskScenario).where(RiskScenario.id == sid, RiskScenario.tenant_id == tenant_id))
    s = r.scalar_one_or_none()
    if not s: raise HTTPException(404, "Scenario not found")
    await db.delete(s); await db.commit()
