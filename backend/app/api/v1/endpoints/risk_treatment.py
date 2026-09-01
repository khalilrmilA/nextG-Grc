"""Risk treatment plans (Elite Pack, RFP module 8).

Wires up the previously-unused RiskTreatment model: one treatment decision per
risk (accept / mitigate / transfer / avoid) with justification, schedule, cost,
owner and progress, direct links to the risk scenario(s) it addresses
(linked_scenario_ids), plus an execution-tracking view — flat (GET /tracking)
or aggregated by responsible owner (GET /tracking/by-responsible) — that flags
overdue / at-risk / over-budget plans. Gated behind
require_feature("risk_treatment_plans").

One-plan-per-risk is still enforced (both the DB's risk_treatments.risk_id
UNIQUE constraint and the create-or-replace logic in upsert_treatment below).
The RFP asks for this to be relaxed; it is deliberately NOT done in this pass
because SQLite can't drop an inline column UNIQUE constraint without a full
table rebuild, which is too risky to run against a database backing live
production data — see the RiskTreatment model docstring (app/models/risk.py)
and the `fix(treatment-refinement)` commit message for the full reasoning.

M8.2 gap fix (RFP module 8): "no supersede workflow for submitting a new plan
for an already-planned risk, and no plan-level version history". Since
risk_id stays unique (the row is updated in place, never replaced), a plain
PATCH silently loses the prior plan's values. POST /{risk_id}/supersede
snapshots the CURRENT row into RiskTreatmentVersion (app/models/
risk_treatment_version.py — mirrors the RiskScenarioVersion pattern in
scenario_versions.py) before applying the new submitted fields in place, and
requires a `change_summary` justification (distinct from a plain PATCH, which
stays available for minor edits like a progress-percentage bump).
GET /{risk_id}/versions lists that history, newest first.
"""
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.risk import Risk, RiskTreatment, RiskTreatmentOption
from app.models.risk_scenario import RiskScenario, ScenarioTreatment
from app.models.risk_treatment_version import RiskTreatmentVersion
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_GATE = require_feature("risk_treatment_plans")

# Fields snapshotted into RiskTreatmentVersion whenever a plan is superseded —
# mirrors risk_scenarios' _SNAPSHOT_FIELDS pattern (scenario_versions.py).
_SNAPSHOT_FIELDS = [
    "treatment_option", "description", "due_date", "start_date", "owner_id",
    "progress_percentage", "estimated_cost", "actual_cost", "priority",
    "transfer_to", "acceptance_justification", "linked_scenario_ids",
]


def _json_safe(value):
    if isinstance(value, (list, dict, str, int, float, bool)) or value is None:
        return value
    # Enum members (e.g. RiskTreatmentOption) -> their plain value.
    return getattr(value, "value", str(value))


def _snapshot_treatment(t: RiskTreatment) -> dict:
    return {f: _json_safe(getattr(t, f, None)) for f in _SNAPSHOT_FIELDS}


class TreatmentIn(BaseModel):
    risk_id: str
    treatment_option: RiskTreatmentOption
    description: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    owner_id: str | None = None
    progress_percentage: int = 0
    estimated_cost: float | None = None
    actual_cost: float | None = None
    transfer_to: str | None = None
    acceptance_justification: str | None = None
    # RFP gap fix: direct plan -> scenario(s) association. Validated tenant-scoped
    # (each id must be a RiskScenario belonging to this tenant) in the handler.
    linked_scenario_ids: list[str] = []


class TreatmentPatch(BaseModel):
    treatment_option: RiskTreatmentOption | None = None
    description: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    owner_id: str | None = None
    progress_percentage: int | None = None
    estimated_cost: float | None = None
    actual_cost: float | None = None
    transfer_to: str | None = None
    acceptance_justification: str | None = None
    linked_scenario_ids: list[str] | None = None


class TreatmentOut(BaseModel):
    id: str
    risk_id: str
    treatment_option: RiskTreatmentOption
    description: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    owner_id: str | None = None
    progress_percentage: int
    estimated_cost: float | None = None
    actual_cost: float | None = None
    priority: str | None = None
    transfer_to: str | None = None
    acceptance_justification: str | None = None
    linked_scenario_ids: list[str] = []
    model_config = {"from_attributes": True}

    @field_validator("linked_scenario_ids", mode="before")
    @classmethod
    def _default_scenario_list(cls, v):
        # Rows written before the migration have this column as NULL, not [].
        return v or []


class SupersedeIn(BaseModel):
    """New plan submitted to replace the risk's current treatment plan.

    Same fields as TreatmentIn (minus risk_id, which comes from the path) plus
    a required `change_summary` — the M8.2 gap explicitly wants a meaningfully
    new plan distinguished from a plain PATCH edit.
    """
    treatment_option: RiskTreatmentOption
    description: str | None = None
    due_date: str | None = None
    start_date: str | None = None
    owner_id: str | None = None
    progress_percentage: int = 0
    estimated_cost: float | None = None
    actual_cost: float | None = None
    transfer_to: str | None = None
    acceptance_justification: str | None = None
    linked_scenario_ids: list[str] = []
    change_summary: str


class VersionOut(BaseModel):
    id: str
    risk_id: str
    treatment_id: str
    version_number: int
    snapshot: dict
    change_summary: str | None
    created_by_id: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class TrackingRow(BaseModel):
    id: str
    risk_id: str
    treatment_option: RiskTreatmentOption
    owner_id: str | None = None
    progress_percentage: int
    due_date: str | None = None
    estimated_cost: float | None = None
    actual_cost: float | None = None
    overdue: bool
    at_risk: bool
    over_budget: bool


async def _risk_in_tenant(risk_id: str, tenant_id: str, db: AsyncSession) -> Risk:
    risk = (await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=404, detail="Risk not found")
    return risk


async def _assert_scenarios_in_tenant(scenario_ids: list[str] | None, tenant_id: str, db: AsyncSession) -> None:
    """Tenant-scoped IDOR check for `linked_scenario_ids`.

    Mirrors `assert_assets_in_tenant` (app/core/security_utils.py, used by
    vulnerabilities.py's affected_assets) but implemented locally against
    RiskScenario since risk_treatment.py already imports that model.
    Pass-through if scenario_ids is falsy (empty list / not provided).
    """
    if not scenario_ids:
        return
    ids = list(dict.fromkeys(scenario_ids))  # de-dupe, preserve order
    result = await db.execute(
        select(RiskScenario.id).where(RiskScenario.id.in_(ids), RiskScenario.tenant_id == tenant_id)
    )
    found = {row[0] for row in result.all()}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid linked_scenario_ids: unknown scenario id(s) {missing}",
        )


def _require_justification(option: RiskTreatmentOption, justification: str | None) -> None:
    """RFP rule: "une justification est requise pour chaque décision" — every
    treatment option (mitigate/accept/transfer/avoid), not just acceptance."""
    if not (justification and justification.strip()):
        raise HTTPException(
            status_code=422,
            detail=f"A justification is required for treatment option '{option.value}'.",
        )


_SEVERITY_TO_PRIORITY = {
    "critical": "critical", "high": "high", "medium": "medium", "low": "low", "info": "low",
}


def _derive_treatment_priority(risk: Risk) -> str:
    """RFP gap fix: auto-derive the treatment plan's priority from its linked risk,
    reusing the same critical/high/medium/low tiering compliance.py's ActionItem
    remediation already uses (there: gap.remediation_priority -> ActionItemPriority;
    here: risk.severity -> priority).

    Simplified from the RFP's "criticité x complexité" formula to severity alone —
    this codebase has no existing notion of treatment "complexity" to multiply
    against, and inventing one would be a materially bigger feature than this gap
    fix warrants. Falls back to the raw likelihood x impact score when severity
    hasn't been computed yet (bands mirror the register's qualitative 1-5 scale:
    >=20 critical, >=12 high, >=6 medium, else low).
    """
    severity = risk.severity
    if severity is not None:
        sev = severity.value if hasattr(severity, "value") else str(severity)
        return _SEVERITY_TO_PRIORITY.get(sev, "medium")
    score = risk.residual_risk_score if risk.residual_risk_score is not None else risk.inherent_risk_score
    if score is None:
        return "medium"
    if score >= 20:
        return "critical"
    if score >= 12:
        return "high"
    if score >= 6:
        return "medium"
    return "low"


@router.post("", response_model=TreatmentOut, status_code=status.HTTP_201_CREATED)
async def upsert_treatment(
    body: TreatmentIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create or replace the treatment plan for a risk (one per risk).

    NOTE: still enforced as one-per-risk (create-or-replace) at both the DB
    level (risk_treatments.risk_id UNIQUE) and here — see the deferred
    constraint-relaxation note on the RiskTreatment model / this session's
    commit message.
    """
    risk = await _risk_in_tenant(body.risk_id, tenant_id, db)
    _require_justification(body.treatment_option, body.acceptance_justification)
    await _assert_scenarios_in_tenant(body.linked_scenario_ids, tenant_id, db)

    existing = (await db.execute(
        select(RiskTreatment).where(RiskTreatment.risk_id == body.risk_id)
    )).scalar_one_or_none()

    data = body.model_dump()
    priority = _derive_treatment_priority(risk)
    if existing is None:
        treatment = RiskTreatment(**data, priority=priority)
        db.add(treatment)
    else:
        for k, v in data.items():
            setattr(existing, k, v)
        existing.priority = priority
        treatment = existing
    await db.commit()
    await db.refresh(treatment)
    return treatment


@router.get("", response_model=list[TreatmentOut])
async def list_treatments(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    risk_id: str | None = None,
):
    stmt = (
        select(RiskTreatment)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(Risk.tenant_id == tenant_id)
    )
    if risk_id:
        stmt = stmt.where(RiskTreatment.risk_id == risk_id)
    return list((await db.execute(stmt)).scalars().all())


def _build_tracking_row(t: RiskTreatment, today: str) -> TrackingRow:
    """Shared row-shaping for the flat and by-responsible tracking views."""
    overdue = bool(t.due_date and t.due_date < today and (t.progress_percentage or 0) < 100)
    at_risk = bool(
        not overdue and t.due_date and t.due_date <= today and (t.progress_percentage or 0) < 100
    )
    over_budget = bool(
        t.actual_cost is not None and t.estimated_cost is not None and t.actual_cost > t.estimated_cost
    )
    return TrackingRow(
        id=t.id, risk_id=t.risk_id, treatment_option=t.treatment_option, owner_id=t.owner_id,
        progress_percentage=t.progress_percentage or 0, due_date=t.due_date,
        estimated_cost=t.estimated_cost, actual_cost=t.actual_cost,
        overdue=overdue, at_risk=at_risk, over_budget=over_budget,
    )


async def _tenant_treatments(tenant_id: str, db: AsyncSession) -> list[RiskTreatment]:
    return list((await db.execute(
        select(RiskTreatment)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(Risk.tenant_id == tenant_id)
    )).scalars().all())


@router.get("/tracking", response_model=list[TrackingRow])
async def tracking(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Execution tracking: flag overdue (past due, <100%), at-risk, and
    over-budget (actual_cost > estimated_cost) plans."""
    rows = await _tenant_treatments(tenant_id, db)
    today = date.today().isoformat()
    return [_build_tracking_row(t, today) for t in rows]


class ResponsibleGroupOut(BaseModel):
    """One responsible owner's slice of the tracking view (RFP gap fix: 'la vue
    de suivi n'agrege pas par responsable')."""
    owner_id: str | None = None
    total: int
    overdue: int
    at_risk: int
    over_budget: int
    avg_progress: float
    treatments: list[TrackingRow]


@router.get("/tracking/by-responsible", response_model=list[ResponsibleGroupOut])
async def tracking_by_responsible(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Same execution-tracking data as GET /tracking, aggregated by the treatment
    plan's owner_id (the RFP's "responsable"). `owner_id=None` groups plans with
    no owner assigned yet, sorted last. Per-group counts: total, overdue, at-risk,
    and over-budget (actual_cost > estimated_cost, from this session's earlier
    actual_cost field)."""
    rows = await _tenant_treatments(tenant_id, db)
    today = date.today().isoformat()

    groups: dict[str | None, list[TrackingRow]] = {}
    for t in rows:
        groups.setdefault(t.owner_id, []).append(_build_tracking_row(t, today))

    out = [
        ResponsibleGroupOut(
            owner_id=owner_id,
            total=len(items),
            overdue=sum(1 for i in items if i.overdue),
            at_risk=sum(1 for i in items if i.at_risk),
            over_budget=sum(1 for i in items if i.over_budget),
            avg_progress=round(sum(i.progress_percentage for i in items) / len(items), 1) if items else 0.0,
            treatments=items,
        )
        for owner_id, items in groups.items()
    ]
    out.sort(key=lambda g: (g.owner_id is None, g.owner_id or ""))
    return out


@router.patch("/{treatment_id}", response_model=TreatmentOut)
async def patch_treatment(
    treatment_id: str,
    body: TreatmentPatch,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    treatment = (await db.execute(
        select(RiskTreatment)
        .join(Risk, Risk.id == RiskTreatment.risk_id)
        .where(RiskTreatment.id == treatment_id, Risk.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if treatment is None:
        raise HTTPException(status_code=404, detail="Treatment not found")
    updates = body.model_dump(exclude_none=True)
    option = updates.get("treatment_option", treatment.treatment_option)
    justification = updates.get("acceptance_justification", treatment.acceptance_justification)
    _require_justification(option, justification)
    if "linked_scenario_ids" in updates:
        await _assert_scenarios_in_tenant(updates["linked_scenario_ids"], tenant_id, db)
    for k, v in updates.items():
        setattr(treatment, k, v)
    # Re-derive priority from the linked risk on every update — its severity may
    # have changed since the treatment plan was created.
    risk = await _risk_in_tenant(treatment.risk_id, tenant_id, db)
    treatment.priority = _derive_treatment_priority(risk)
    await db.commit()
    await db.refresh(treatment)
    return treatment


@router.post("/{risk_id}/supersede", response_model=TreatmentOut)
async def supersede_treatment(
    risk_id: str,
    body: SupersedeIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Submit a meaningfully new treatment plan for a risk that already has one.

    M8.2 gap fix: risk_treatments.risk_id stays unique (see module docstring),
    so this snapshots the CURRENT plan's field values into RiskTreatmentVersion
    — preserving them instead of letting them be silently overwritten — then
    updates the existing row in place with the newly submitted fields. Requires
    an existing plan (404 otherwise — use POST "" to create the first plan for
    a risk) and a non-empty `change_summary`, which is what distinguishes this
    from a plain PATCH (still available for minor edits).
    """
    if not (body.change_summary and body.change_summary.strip()):
        raise HTTPException(status_code=422, detail="A change_summary is required to supersede a treatment plan.")
    risk = await _risk_in_tenant(risk_id, tenant_id, db)
    treatment = (await db.execute(
        select(RiskTreatment).where(RiskTreatment.risk_id == risk_id)
    )).scalar_one_or_none()
    if treatment is None:
        raise HTTPException(
            status_code=404,
            detail="No existing treatment plan for this risk — use POST /risk-treatment to create one.",
        )
    _require_justification(body.treatment_option, body.acceptance_justification)
    await _assert_scenarios_in_tenant(body.linked_scenario_ids, tenant_id, db)

    # Snapshot the CURRENT (soon-to-be-overwritten) plan before mutating it.
    count = (await db.execute(
        select(func.count()).select_from(RiskTreatmentVersion)
        .where(RiskTreatmentVersion.risk_id == risk_id)
    )).scalar() or 0
    db.add(RiskTreatmentVersion(
        risk_id=risk_id, treatment_id=treatment.id, version_number=int(count) + 1,
        snapshot=_snapshot_treatment(treatment), change_summary=body.change_summary.strip(),
        created_by_id=current_user.id,
    ))

    # Apply the newly submitted fields to the existing (unique-per-risk) row.
    data = body.model_dump(exclude={"change_summary"})
    for k, v in data.items():
        setattr(treatment, k, v)
    treatment.priority = _derive_treatment_priority(risk)

    await db.commit()
    await db.refresh(treatment)
    return treatment


@router.get("/{risk_id}/versions", response_model=list[VersionOut])
async def list_treatment_versions(
    risk_id: str,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Newest-first version history of superseded treatment plans for a risk.

    Tenant-scoped through the parent Risk row (via _risk_in_tenant) rather than
    trusting a bare risk_id — a 404 here means the risk doesn't exist or
    doesn't belong to this tenant, so another tenant's history can't leak.
    """
    await _risk_in_tenant(risk_id, tenant_id, db)
    rows = (await db.execute(
        select(RiskTreatmentVersion)
        .where(RiskTreatmentVersion.risk_id == risk_id)
        .order_by(RiskTreatmentVersion.version_number.desc())
    )).scalars().all()
    return list(rows)


class UntreatedScenarioOut(BaseModel):
    id: str
    name: str
    current_probability: int | None = None
    current_impact: int | None = None
    current_risk_level: str | None = None
    owner_id: str | None = None
    model_config = {"from_attributes": True}


@router.get("/untreated", response_model=list[UntreatedScenarioOut])
async def untreated_evaluated_scenarios(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """RFP rule: "le choix d'une option n'est pas rendu obligatoire pour tout risque
    évalué" — surface risk scenarios still at the default `untreated` state that
    have actually been evaluated (probability + impact both set), so the gap is
    visible/actionable instead of silently sitting on default data.

    Deliberately NOT a blocking DB constraint: many existing scenarios are already
    `untreated` and a hard requirement would break them retroactively.
    """
    rows = (await db.execute(
        select(RiskScenario).where(
            RiskScenario.tenant_id == tenant_id,
            RiskScenario.treatment == ScenarioTreatment.UNTREATED.value,
            RiskScenario.current_probability.isnot(None),
            RiskScenario.current_impact.isnot(None),
        ).order_by(RiskScenario.created_at.desc())
    )).scalars().all()
    return rows
