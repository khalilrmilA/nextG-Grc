"""Framework management endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.models.framework import Framework, FrameworkControl
from app.api.v1.dependencies import get_current_user, get_tenant_id
from app.models.user import User

router = APIRouter()


class FrameworkResponse(BaseModel):
    id: str
    name: str
    short_name: str
    version: str
    description: str | None
    issuing_body: str | None
    applicable_regions: list
    applicable_industries: list
    status: str
    is_builtin: bool
    control_count: int = 0

    model_config = {"from_attributes": True}


class ControlResponse(BaseModel):
    id: str
    framework_id: str
    control_id: str
    title: str
    description: str | None
    guidance: str | None
    category: str | None
    parent_id: str | None
    sort_order: int
    mapped_controls: list
    tags: list

    model_config = {"from_attributes": True}


@router.get("", response_model=list[FrameworkResponse])
async def list_frameworks(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all available frameworks (built-in + tenant custom)."""
    result = await db.execute(
        select(Framework).where(
            (Framework.is_builtin == True) |
            (Framework.tenant_id == tenant_id)
        ).order_by(Framework.name)
    )
    frameworks = result.scalars().all()

    responses = []
    for fw in frameworks:
        # Count controls
        count_result = await db.execute(
            select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
        )
        controls = count_result.scalars().all()
        resp = FrameworkResponse.model_validate(fw)
        resp.control_count = len(controls)
        responses.append(resp)

    return responses


@router.get("/{framework_id}", response_model=FrameworkResponse)
async def get_framework(
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Framework).where(Framework.id == framework_id))
    fw = result.scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")
    return FrameworkResponse.model_validate(fw)


@router.get("/{framework_id}/controls", response_model=list[ControlResponse])
async def get_framework_controls(
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get all controls for a framework."""
    result = await db.execute(
        select(FrameworkControl)
        .where(FrameworkControl.framework_id == framework_id)
        .order_by(FrameworkControl.sort_order, FrameworkControl.control_id)
    )
    controls = result.scalars().all()
    return [ControlResponse.model_validate(c) for c in controls]


@router.get("/{framework_id}/controls/{control_id}/crosswalk")
async def get_control_crosswalk(
    framework_id: str,
    control_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Get cross-framework mappings for a control.
    Returns all equivalent controls in other frameworks.
    """
    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.framework_id == framework_id,
            FrameworkControl.id == control_id,
        )
    )
    control = result.scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    return {
        "control": ControlResponse.model_validate(control),
        "mapped_to": control.mapped_controls,
    }
