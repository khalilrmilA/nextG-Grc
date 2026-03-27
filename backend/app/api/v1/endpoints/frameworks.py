"""Framework management endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from pydantic import BaseModel, field_validator
from typing import Annotated

from app.core.database import get_db
from app.models.framework import Framework, FrameworkControl, ControlCategory, ControlRequirement, FrameworkStatus
from app.api.v1.dependencies import get_current_user, get_tenant_id, get_current_user_optional, get_tenant_id_optional
from app.api.v1.dependencies.auth import require_roles
from app.models.user import User, UserRole
from app.workers.tasks.notifications import notify_framework_new, notify_framework_updated

_VALID_CATEGORIES = {c.name for c in ControlCategory}

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
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User | None, Depends(get_current_user_optional)],
    tenant_id: Annotated[str | None, Depends(get_tenant_id_optional)],
):
    """List all available frameworks (built-in + tenant custom). Public for registration step."""
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


# ─── Custom Framework Builder ──────────────────────────────────────────────────


class FrameworkCreate(BaseModel):
    name: str
    short_name: str
    version: str = "1.0"
    description: str | None = None
    issuing_body: str | None = None
    applicable_regions: list[str] = []
    applicable_industries: list[str] = []


class ControlCreate(BaseModel):
    control_id: str
    title: str
    description: str | None = None
    guidance: str | None = None
    category: str | None = None
    parent_id: str | None = None
    tags: list[str] = []

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v: str | None) -> str | None:
        if v is None:
            return None
        upper = v.upper().strip().replace(" ", "_")
        return upper if upper in _VALID_CATEGORIES else "TECHNICAL"


class ControlUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    guidance: str | None = None
    category: str | None = None
    tags: list[str] | None = None


class RequirementCreate(BaseModel):
    requirement_text: str
    level: str = "must"   # must / should / may


async def _get_tenant_framework(
    db: AsyncSession, framework_id: str, tenant_id: str
) -> Framework:
    """Fetch a tenant-owned framework. Raises 404 or 403 as appropriate."""
    result = await db.execute(select(Framework).where(Framework.id == framework_id))
    fw = result.scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")
    if fw.is_builtin or fw.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot modify a built-in or another tenant's framework")
    return fw


@router.post("", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
async def create_framework(
    body: FrameworkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a custom (tenant-owned) framework."""
    fw = Framework(
        name=body.name,
        short_name=body.short_name,
        version=body.version,
        description=body.description,
        issuing_body=body.issuing_body,
        applicable_regions=body.applicable_regions,
        applicable_industries=body.applicable_industries,
        is_builtin=False,
        tenant_id=tenant_id,
        status=FrameworkStatus.DRAFT,
    )
    db.add(fw)
    await db.flush()
    resp = FrameworkResponse.model_validate(fw)
    resp.control_count = 0

    # Send notification to all users
    notify_framework_new.delay(fw.id, body.name)

    return resp


@router.post("/{framework_id}/controls", response_model=ControlResponse, status_code=status.HTTP_201_CREATED)
async def add_control(
    framework_id: str,
    body: ControlCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a control to a custom framework."""
    await _get_tenant_framework(db, framework_id, tenant_id)

    count_result = await db.execute(
        select(func.count()).where(FrameworkControl.framework_id == framework_id)
    )
    sort_order = count_result.scalar_one()

    control = FrameworkControl(
        framework_id=framework_id,
        control_id=body.control_id,
        title=body.title,
        description=body.description,
        guidance=body.guidance,
        category=body.category,
        parent_id=body.parent_id,
        tags=body.tags,
        sort_order=sort_order,
        mapped_controls=[],
    )
    db.add(control)
    await db.flush()
    return ControlResponse.model_validate(control)


@router.patch("/{framework_id}/controls/{control_db_id}", response_model=ControlResponse)
async def update_control(
    framework_id: str,
    control_db_id: str,
    body: ControlUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Update a control on a tenant-owned framework."""
    await _get_tenant_framework(db, framework_id, tenant_id)

    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    control = result.scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    if body.title is not None:
        control.title = body.title
    if body.description is not None:
        control.description = body.description
    if body.guidance is not None:
        control.guidance = body.guidance
    if body.category is not None:
        control.category = body.category
    if body.tags is not None:
        control.tags = body.tags

    await db.flush()

    # Get framework name for notification
    fw_result = await db.execute(
        select(Framework).where(Framework.id == framework_id)
    )
    fw = fw_result.scalar_one_or_none()
    if fw:
        # Send notification to all users that framework was updated
        notify_framework_updated.delay(fw.id, fw.name)

    return ControlResponse.model_validate(control)


@router.delete("/{framework_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_framework(
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete a tenant-owned custom framework and all its controls."""
    fw = await _get_tenant_framework(db, framework_id, tenant_id)
    await db.delete(fw)


@router.delete("/{framework_id}/controls/{control_db_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_control(
    framework_id: str,
    control_db_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete a control from a tenant-owned framework."""
    await _get_tenant_framework(db, framework_id, tenant_id)

    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    control = result.scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    await db.delete(control)


@router.post("/{framework_id}/controls/{control_db_id}/requirements", status_code=status.HTTP_201_CREATED)
async def add_requirement(
    framework_id: str,
    control_db_id: str,
    body: RequirementCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a requirement to a control on a tenant-owned framework."""
    await _get_tenant_framework(db, framework_id, tenant_id)

    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Control not found")

    req = ControlRequirement(
        control_id=control_db_id,
        requirement_text=body.requirement_text,
        requirement_level=body.level,
    )
    db.add(req)
    await db.flush()
    return {"id": req.id, "control_id": req.control_id, "text": req.requirement_text, "level": req.requirement_level}
