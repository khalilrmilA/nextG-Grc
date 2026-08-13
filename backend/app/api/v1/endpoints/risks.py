"""Risk management endpoints."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Any

from app.core.database import get_db
from app.models.risk import Risk, RiskStatus, RiskSeverity, RiskTreatment, RiskTreatmentOption
from app.models.risk_scenario import RiskScenario
from app.models.subscription import Subscription
from app.models.notification import NotificationType
from app.models.user import UserRole
from app.api.v1.dependencies import get_current_user, require_roles, get_tenant_id, PaginationParams
from app.api.v1.dependencies.features import require_feature
from app.models.user import User
from app.services import risk_scoring
from app.services.notification_generator import create_notification, get_recipients_for_tenant, notification_exists

router = APIRouter()

_RISK_NOT_FOUND = "Risk not found"


def _is_super_admin(user: User) -> bool:
    role = getattr(user, "role", None)
    return str(getattr(role, "value", role)).lower() == "super_admin"


async def _assert_feature(db: AsyncSession, tenant_id: str, user: User, flag: str) -> None:
    """Raise 402 (Elite upsell) unless the tenant's plan unlocks `flag`. Super admins bypass."""
    if _is_super_admin(user):
        return
    sub = (await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))).scalar_one_or_none()
    if not sub or not sub.has_feature(flag):
        raise HTTPException(
            status_code=402,
            detail={"error": "feature_not_in_plan", "feature": flag, "pack": "elite",
                    "message": "This capability requires the Elite Pack."},
        )


async def _apply_scoring(db: AsyncSession, tenant_id: str, risk: Risk) -> tuple[dict, str]:
    """Resolve the tenant's matrix and set risk.severity from it.

    Severity reflects the residual (post-control) position when residual scores are
    present, otherwise the inherent position — so the register shows the *current*
    risk level. Returns (definition, matrix_name) for response enrichment.
    """
    definition, name = await risk_scoring.resolve_matrix(db, tenant_id, getattr(risk, "risk_matrix_id", None))
    if risk.residual_likelihood and risk.residual_impact:
        risk.severity = risk_scoring.severity_for(definition, risk.residual_likelihood, risk.residual_impact)
    else:
        risk.severity = risk_scoring.severity_for(definition, risk.likelihood, risk.impact)
    return definition, name


async def _alert_over_appetite(db: AsyncSession, risk: Risk) -> int:
    """Notify risk owners/CISO that a risk's residual score exceeds its appetite threshold."""
    score = risk.residual_risk_score if risk.residual_risk_score is not None else risk.inherent_risk_score
    created = 0
    recipients = await get_recipients_for_tenant(db, risk.tenant_id)
    for user in recipients:
        if await notification_exists(db, user.id, NotificationType.RISK_OVER_APPETITE, risk.id, within_days=7):
            continue
        await create_notification(
            db, user=user, notif_type=NotificationType.RISK_OVER_APPETITE,
            title=f"Risk over appetite: {risk.title[:50]}",
            message=(f"Risk '{risk.title}' has a residual score of {score} which exceeds "
                     f"the appetite threshold of {risk.appetite_threshold}. Treatment is required."),
            entity_id=risk.id, entity_type="risk",
            link=f"/risks?highlight={risk.id}", severity="critical",
        )
        created += 1
    return created


class RiskCreate(BaseModel):
    title: str
    description: str | None = None
    risk_category: str | None = None
    owner_id: str | None = None
    likelihood: float | None = None  # 1-5
    impact: float | None = None      # 1-5
    residual_likelihood: float | None = None
    residual_impact: float | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None
    risk_matrix_id: str | None = None
    tags: list[str] = []
    linked_controls: list[str] = []
    linked_assets: list[str] = []
    next_review_date: str | None = None


class RiskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    risk_category: str | None = None
    owner_id: str | None = None
    status: RiskStatus | None = None
    likelihood: float | None = None
    impact: float | None = None
    residual_likelihood: float | None = None
    residual_impact: float | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None
    risk_matrix_id: str | None = None
    severity: RiskSeverity | None = None
    tags: list[str] | None = None
    linked_controls: list[str] | None = None
    next_review_date: str | None = None
    appetite_threshold: float | None = None


class RiskResponse(BaseModel):
    id: str
    tenant_id: str
    title: str
    description: str | None
    risk_category: str | None
    owner_id: str | None
    status: RiskStatus
    likelihood: float | None
    impact: float | None
    inherent_risk_score: float | None
    inherent_level: str | None = None
    residual_likelihood: float | None
    residual_impact: float | None
    residual_risk_score: float | None
    residual_level: str | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None
    target_risk_score: float | None = None
    target_level: str | None = None
    risk_matrix_id: str | None = None
    matrix_name: str | None = None
    severity: RiskSeverity | None
    appetite_threshold: float | None = None
    over_appetite: bool | None = None
    tags: list
    linked_controls: list
    linked_assets: list
    next_review_date: str | None
    last_reviewed_at: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


def _enrich(risk: Risk, definition: dict, matrix_name: str) -> RiskResponse:
    """Build a RiskResponse with matrix-derived qualitative levels for each tier."""
    _, inh_level = risk_scoring.score_and_level(definition, risk.likelihood, risk.impact)
    _, res_level = risk_scoring.score_and_level(definition, risk.residual_likelihood, risk.residual_impact)
    _, tgt_level = risk_scoring.score_and_level(definition, risk.target_likelihood, risk.target_impact)
    return RiskResponse(
        id=risk.id, tenant_id=risk.tenant_id, title=risk.title, description=risk.description,
        risk_category=risk.risk_category, owner_id=risk.owner_id, status=risk.status,
        likelihood=risk.likelihood, impact=risk.impact,
        inherent_risk_score=risk.inherent_risk_score, inherent_level=inh_level,
        residual_likelihood=risk.residual_likelihood, residual_impact=risk.residual_impact,
        residual_risk_score=risk.residual_risk_score, residual_level=res_level,
        target_likelihood=risk.target_likelihood, target_impact=risk.target_impact,
        target_risk_score=risk.target_risk_score, target_level=tgt_level,
        risk_matrix_id=getattr(risk, "risk_matrix_id", None), matrix_name=matrix_name,
        severity=risk.severity, appetite_threshold=risk.appetite_threshold, over_appetite=risk.over_appetite,
        tags=risk.tags or [], linked_controls=risk.linked_controls or [], linked_assets=risk.linked_assets or [],
        next_review_date=risk.next_review_date, last_reviewed_at=risk.last_reviewed_at,
        created_at=risk.created_at, updated_at=risk.updated_at,
    )


class PaginatedRisks(BaseModel):
    items: list[RiskResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get("", response_model=PaginatedRisks)
async def list_risks(
    pagination: PaginationParams = Depends(),
    status_filter: RiskStatus | None = Query(None, alias="status"),
    severity: RiskSeverity | None = None,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all risks for the tenant with optional filtering."""
    query = select(Risk).where(Risk.tenant_id == tenant_id)

    if status_filter:
        query = query.where(Risk.status == status_filter)
    if severity:
        query = query.where(Risk.severity == severity)

    # Count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Paginate
    query = query.offset(pagination.offset).limit(pagination.limit).order_by(Risk.created_at.desc())
    result = await db.execute(query)
    risks = result.scalars().all()

    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id)
    return PaginatedRisks(
        items=[_enrich(r, definition, matrix_name) for r in risks],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        total_pages=(total + pagination.page_size - 1) // pagination.page_size,
    )


@router.post("", response_model=RiskResponse, status_code=status.HTTP_201_CREATED)
async def create_risk(
    body: RiskCreate,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.CISO, UserRole.RISK_MANAGER
    )),
):
    risk = Risk(tenant_id=tenant_id, **body.model_dump())
    definition, matrix_name = await _apply_scoring(db, tenant_id, risk)
    db.add(risk)
    await db.flush()
    return _enrich(risk, definition, matrix_name)


@router.get("/{risk_id}", response_model=RiskResponse)
async def get_risk(
    risk_id: str,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)
    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id, risk.risk_matrix_id)
    return _enrich(risk, definition, matrix_name)


@router.patch("/{risk_id}", response_model=RiskResponse)
async def update_risk(
    risk_id: str,
    body: RiskUpdate,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER)),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)

    provided = body.model_dump(exclude_none=True)
    # Risk appetite is an Elite Pack capability — gate the write.
    if "appetite_threshold" in provided:
        await _assert_feature(db, tenant_id, current_user, "risk_appetite")

    was_over = risk.over_appetite
    for field, value in provided.items():
        setattr(risk, field, value)

    # Recompute severity from the matrix unless it was set explicitly.
    if "severity" not in provided:
        await _apply_scoring(db, tenant_id, risk)

    # Immediate alert when a risk newly breaches its appetite.
    if risk.over_appetite and not was_over:
        await _alert_over_appetite(db, risk)

    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id, risk.risk_matrix_id)
    return _enrich(risk, definition, matrix_name)


@router.delete("/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk(
    risk_id: str,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)
    await db.delete(risk)


@router.get("/heatmap/data")
async def get_risk_heatmap(
    view: str = Query("current", pattern="^(inherent|residual|current)$"),
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return risk data for a heat map, driven by the tenant's active risk matrix.

    view=inherent buckets by inherent likelihood/impact, view=residual by residual,
    view=current (default) uses residual where present else inherent.
    """
    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id)
    result = await db.execute(select(Risk).where(Risk.tenant_id == tenant_id))
    risks = result.scalars().all()

    grid: dict[str, list[dict]] = {}
    plotted = 0
    for risk in risks:
        if view == "inherent":
            likelihood, impact = risk.likelihood, risk.impact
        elif view == "residual":
            likelihood, impact = risk.residual_likelihood, risk.residual_impact
        else:  # current
            likelihood = risk.residual_likelihood or risk.likelihood
            impact = risk.residual_impact or risk.impact
        if not likelihood or not impact:
            continue
        key = f"{int(likelihood)},{int(impact)}"
        grid.setdefault(key, []).append({"id": risk.id, "title": risk.title, "severity": risk.severity})
        plotted += 1

    prob = definition.get("probability", {})
    imp = definition.get("impact", {})
    return {
        "grid": grid,
        "view": view,
        "matrix_name": matrix_name,
        "probability_count": prob.get("count", 5),
        "impact_count": imp.get("count", 5),
        "probability_labels": prob.get("labels", []),
        "impact_labels": imp.get("labels", []),
        "risk_levels": definition.get("risk_levels", []),
        "cells": definition.get("grid", []),
        "total_risks": plotted,
        "by_severity": {
            severity.value: sum(1 for r in risks if r.severity == severity)
            for severity in RiskSeverity
        },
    }


class AppetiteInput(BaseModel):
    appetite_threshold: float | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None


@router.put("/{risk_id}/appetite", response_model=RiskResponse)
async def set_risk_appetite(
    risk_id: str,
    body: AppetiteInput,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature("risk_appetite")),
):
    """Elite Pack: set a risk's appetite threshold + optional target tier; alert on new breach."""
    result = await db.execute(select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)

    was_over = risk.over_appetite
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(risk, field, value)
    definition, matrix_name = await _apply_scoring(db, tenant_id, risk)
    if risk.over_appetite and not was_over:
        await _alert_over_appetite(db, risk)
    await db.flush()
    return _enrich(risk, definition, matrix_name)


# ── Risk Quantification ──────────────────────────────────────────────────

class RiskQuantInput(BaseModel):
    risk_id: str
    annual_loss_min: float  # Minimum expected annual loss ($)
    annual_loss_max: float  # Maximum expected annual loss ($)
    annual_loss_most_likely: float  # Most likely annual loss ($)
    probability_percent: float = 50.0  # Probability of occurrence (0-100)
    control_effectiveness: float = 50.0  # How effective existing controls are (0-100)

class RiskQuantResult(BaseModel):
    risk_id: str
    risk_title: str
    ale: float           # Annualized Loss Expectancy
    sle: float           # Single Loss Expectancy
    aro: float           # Annual Rate of Occurrence
    residual_ale: float  # ALE after controls
    risk_reduction: float
    p90: float           # 90th percentile
    p95: float           # 95th percentile
    simulations: int
    distribution: list[dict]


@router.post("/quantify", response_model=RiskQuantResult)
async def quantify_risk(
    body: RiskQuantInput,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Run Monte Carlo simulation for financial risk quantification (Risk or Risk Scenario)."""
    import random

    # Try Risk first, then RiskScenario
    risk_result = await db.execute(select(Risk).where(Risk.id == body.risk_id, Risk.tenant_id == tenant_id))
    risk = risk_result.scalar_one_or_none()

    display_title: str = risk.title if risk else ""  # overwritten below if scenario
    if not risk:
        sc_result = await db.execute(select(RiskScenario).where(RiskScenario.id == body.risk_id, RiskScenario.tenant_id == tenant_id))
        scenario = sc_result.scalar_one_or_none()
        if not scenario:
            raise HTTPException(status_code=404, detail="Risk or Scenario not found")
        display_title = getattr(scenario, "name", None) or getattr(scenario, "title", None) or f"Scenario {scenario.id[:8]}"

    # Monte Carlo parameters
    num_simulations = 10000
    aro = body.probability_percent / 100.0  # Annual Rate of Occurrence
    control_eff = body.control_effectiveness / 100.0

    # Run Monte Carlo using PERT distribution (triangular approximation)
    losses = []
    for _ in range(num_simulations):
        # Generate loss amount using triangular distribution
        loss = random.triangular(body.annual_loss_min, body.annual_loss_max, body.annual_loss_most_likely)
        # Apply occurrence probability
        occurs = random.random() < aro
        if occurs:
            losses.append(loss)
        else:
            losses.append(0.0)

    # Calculate statistics
    losses.sort()
    total_losses = [l for l in losses if l > 0]
    ale = sum(losses) / num_simulations  # Average annual loss
    sle = body.annual_loss_most_likely  # Single Loss Expectancy
    residual_ale = ale * (1 - control_eff)
    p90 = losses[int(num_simulations * 0.90)]
    p95 = losses[int(num_simulations * 0.95)]

    # Build histogram (10 buckets)
    if max(losses) > 0:
        bucket_size = max(losses) / 10
        distribution = []
        for i in range(10):
            lo = i * bucket_size
            hi = (i + 1) * bucket_size
            count = sum(1 for l in losses if lo <= l < hi)
            distribution.append({
                "range_min": round(lo, 2),
                "range_max": round(hi, 2),
                "count": count,
                "percentage": round(count / num_simulations * 100, 1),
            })
    else:
        distribution = [{"range_min": 0, "range_max": 0, "count": num_simulations, "percentage": 100}]

    return RiskQuantResult(
        risk_id=body.risk_id,
        risk_title=display_title,
        ale=round(ale, 2),
        sle=round(sle, 2),
        aro=round(aro, 4),
        residual_ale=round(residual_ale, 2),
        risk_reduction=round(ale - residual_ale, 2),
        p90=round(p90, 2),
        p95=round(p95, 2),
        simulations=num_simulations,
        distribution=distribution,
    )
