"""Risk-scenario versioning (Elite Pack) — RFP module 5.

Snapshot a scenario's state, browse the change timeline, and diff any two
versions. Snapshots capture a fixed field set via defensive getattr, so schema
drift never breaks the endpoint. Gated behind ``scenario_versioning``.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.risk_scenario import RiskScenario
from app.models.scenario_version import RiskScenarioVersion
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

# Fields captured in each snapshot (pulled defensively — missing → None).
_SNAPSHOT_FIELDS = [
    "name", "description", "justification",
    "current_probability", "current_impact", "current_risk_level",
    "target_probability", "target_impact", "target_risk_level",
    "treatment_option", "threat_ids", "vulnerability_ids", "asset_ids",
    "applied_control_ids",
]


def _snapshot(scenario) -> dict:
    return {f: _json_safe(getattr(scenario, f, None)) for f in _SNAPSHOT_FIELDS}


def _json_safe(value):
    if isinstance(value, (list, dict, str, int, float, bool)) or value is None:
        return value
    return str(value)


async def _scenario(db: AsyncSession, scenario_id: str, tenant_id: str) -> RiskScenario:
    result = await db.execute(
        select(RiskScenario).where(
            RiskScenario.id == scenario_id, RiskScenario.tenant_id == tenant_id
        )
    )
    scenario = result.scalar_one_or_none()
    if scenario is None:
        raise HTTPException(status_code=404, detail="Risk scenario not found")
    return scenario


class SnapshotIn(BaseModel):
    change_reason: str | None = None


class VersionOut(BaseModel):
    id: str
    scenario_id: str
    version_number: int
    snapshot: dict
    change_reason: str | None
    author_id: str | None
    model_config = {"from_attributes": True}


@router.post("/{scenario_id}/snapshot", response_model=VersionOut, status_code=201)
async def create_snapshot(
    scenario_id: str,
    body: SnapshotIn,
    current_user: Annotated[User, Depends(require_feature("scenario_versioning"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    scenario = await _scenario(db, scenario_id, tenant_id)
    count = (await db.execute(
        select(func.count()).select_from(RiskScenarioVersion)
        .where(RiskScenarioVersion.scenario_id == scenario_id)
    )).scalar() or 0
    version = RiskScenarioVersion(
        scenario_id=scenario_id, version_number=int(count) + 1,
        snapshot=_snapshot(scenario), change_reason=body.change_reason,
        author_id=current_user.id,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version


@router.get("/{scenario_id}", response_model=list[VersionOut])
async def list_versions(
    scenario_id: str,
    current_user: Annotated[User, Depends(require_feature("scenario_versioning"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _scenario(db, scenario_id, tenant_id)  # tenant ownership check
    result = await db.execute(
        select(RiskScenarioVersion)
        .where(RiskScenarioVersion.scenario_id == scenario_id)
        .order_by(RiskScenarioVersion.version_number.desc())
    )
    return list(result.scalars().all())


class DiffCell(BaseModel):
    field: str
    from_value: object | None = None
    to_value: object | None = None


@router.get("/{scenario_id}/diff", response_model=list[DiffCell])
async def diff_versions(
    scenario_id: str,
    current_user: Annotated[User, Depends(require_feature("scenario_versioning"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_version: int,
    to_version: int,
):
    await _scenario(db, scenario_id, tenant_id)

    async def _load(n: int) -> dict:
        row = (await db.execute(
            select(RiskScenarioVersion).where(
                RiskScenarioVersion.scenario_id == scenario_id,
                RiskScenarioVersion.version_number == n,
            )
        )).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Version {n} not found")
        return row.snapshot or {}

    a = await _load(from_version)
    b = await _load(to_version)
    diffs: list[DiffCell] = []
    for field in _SNAPSHOT_FIELDS:
        if a.get(field) != b.get(field):
            diffs.append(DiffCell(field=field, from_value=a.get(field), to_value=b.get(field)))
    return diffs
