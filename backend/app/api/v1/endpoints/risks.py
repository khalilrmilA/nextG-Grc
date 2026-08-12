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
from app.models.user import UserRole
from app.api.v1.dependencies import get_current_user, require_roles, get_tenant_id, PaginationParams
from app.models.user import User

router = APIRouter()

_RISK_NOT_FOUND = "Risk not found"


def _compute_severity(likelihood: float | None, impact: float | None) -> RiskSeverity | None:
    """Derive severity from likelihood × impact (shared by create + update)."""
    if likelihood and impact:
        score = likelihood * impact
        if score >= 20:
            return RiskSeverity.CRITICAL
        if score >= 12:
            return RiskSeverity.HIGH
        if score >= 6:
            return RiskSeverity.MEDIUM
        return RiskSeverity.LOW
    return None


class RiskCreate(BaseModel):
    title: str
    description: str | None = None
    risk_category: str | None = None
    owner_id: str | None = None
    likelihood: float | None = None  # 1-5
    impact: float | None = None      # 1-5
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
    residual_likelihood: float | None
    residual_impact: float | None
    residual_risk_score: float | None
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

    return PaginatedRisks(
        items=[RiskResponse.model_validate(r) for r in risks],
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
    # Auto-calculate severity
    severity = _compute_severity(body.likelihood, body.impact)

    risk = Risk(
        tenant_id=tenant_id,
        severity=severity,
        **body.model_dump(),
    )
    db.add(risk)
    await db.flush()
    return RiskResponse.model_validate(risk)


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
    return RiskResponse.model_validate(risk)


@router.patch("/{risk_id}", response_model=RiskResponse)
async def update_risk(
    risk_id: str,
    body: RiskUpdate,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER)),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)

    provided = body.model_dump(exclude_none=True)
    for field, value in provided.items():
        setattr(risk, field, value)

    # Recompute severity when likelihood/impact changed and severity wasn't set explicitly.
    if "severity" not in provided and ("likelihood" in provided or "impact" in provided):
        risk.severity = _compute_severity(risk.likelihood, risk.impact)

    return RiskResponse.model_validate(risk)


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
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return risk data formatted for a 5x5 risk heat map."""
    result = await db.execute(
        select(Risk).where(Risk.tenant_id == tenant_id, Risk.likelihood.isnot(None), Risk.impact.isnot(None))
    )
    risks = result.scalars().all()

    # Build 5x5 grid
    grid: dict[str, list[dict]] = {}
    for risk in risks:
        key = f"{int(risk.likelihood)},{int(risk.impact)}"
        if key not in grid:
            grid[key] = []
        grid[key].append({"id": risk.id, "title": risk.title, "severity": risk.severity})

    return {
        "grid": grid,
        "total_risks": len(risks),
        "by_severity": {
            severity.value: sum(1 for r in risks if r.severity == severity)
            for severity in RiskSeverity
        },
    }


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
