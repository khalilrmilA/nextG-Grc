"""Risk management endpoints."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Any

from app.core.database import get_db
from app.models.risk import Risk, RiskStatus, RiskSeverity, RiskTreatment, RiskTreatmentOption
from app.models.user import UserRole
from app.api.v1.dependencies import get_current_user, require_roles, get_tenant_id, PaginationParams
from app.models.user import User

router = APIRouter()


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
        UserRole.TENANT_ADMIN, UserRole.CISO, UserRole.RISK_MANAGER
    )),
):
    # Auto-calculate severity
    severity = None
    if body.likelihood and body.impact:
        score = body.likelihood * body.impact
        if score >= 20:
            severity = RiskSeverity.CRITICAL
        elif score >= 12:
            severity = RiskSeverity.HIGH
        elif score >= 6:
            severity = RiskSeverity.MEDIUM
        else:
            severity = RiskSeverity.LOW

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
        raise HTTPException(status_code=404, detail="Risk not found")
    return RiskResponse.model_validate(risk)


@router.patch("/{risk_id}", response_model=RiskResponse)
async def update_risk(
    risk_id: str,
    body: RiskUpdate,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO, UserRole.RISK_MANAGER)),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(risk, field, value)

    return RiskResponse.model_validate(risk)


@router.delete("/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk(
    risk_id: str,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
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
