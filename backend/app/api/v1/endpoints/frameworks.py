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


# ── Custom Framework Builder Endpoints (must come BEFORE /{framework_id}) ──

class BrowseControlsResponse(BaseModel):
    """Controls grouped by source framework."""
    framework_id: str
    framework_name: str
    framework_short_name: str
    controls: list[ControlResponse]


class AISuggestionsRequest(BaseModel):
    """Request AI to suggest controls based on industry/region/use case."""
    industry: str
    region: str | None = None
    use_case: str | None = None
    selected_control_ids: list[str] = []


class AISuggestion(BaseModel):
    """A single AI control suggestion."""
    title: str
    description: str
    category: str
    rationale: str
    priority: str


class AISuggestionsResponse(BaseModel):
    """AI-generated control suggestions."""
    suggestions: list[AISuggestion]
    rationale: str


class CustomControlInput(BaseModel):
    """A control to include in the custom framework."""
    control_id: str
    title: str
    description: str | None = None
    category: str | None = None
    source_framework: str | None = None


class BuildCustomFrameworkRequest(BaseModel):
    """Request to build a custom framework from selected controls."""
    name: str
    short_name: str
    version: str = "1.0"
    description: str | None = None
    issuing_body: str | None = None
    applicable_regions: list[str] = []
    applicable_industries: list[str] = []
    controls: list[CustomControlInput]


@router.get("/builder/browse-controls", response_model=list[BrowseControlsResponse])
async def browse_controls_by_framework(
    framework_ids: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Browse controls from one or more existing frameworks."""
    if framework_ids:
        ids_list = [i.strip() for i in framework_ids.split(",") if i.strip()]
        fw_result = await db.execute(
            select(Framework).where(Framework.id.in_(ids_list))
        )
    else:
        fw_result = await db.execute(
            select(Framework).where(Framework.is_builtin == True).order_by(Framework.name)  # noqa: E712
        )
    frameworks = fw_result.scalars().all()

    result = []
    for fw in frameworks:
        controls_result = await db.execute(
            select(FrameworkControl)
            .where(FrameworkControl.framework_id == fw.id)
            .order_by(FrameworkControl.sort_order)
        )
        controls = list(controls_result.scalars().all())
        result.append(BrowseControlsResponse(
            framework_id=fw.id,
            framework_name=fw.name,
            framework_short_name=fw.short_name,
            controls=[ControlResponse.model_validate(c) for c in controls],
        ))

    return result


@router.post("/builder/ai-suggestions", response_model=AISuggestionsResponse)
async def get_ai_control_suggestions(
    body: AISuggestionsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get AI-suggested controls based on industry, region, and use case."""
    import httpx
    import json as json_lib
    from app.core.config import settings
    from app.core import ai_quota
    ai_quota.check_quota_or_raise(current_user.id)

    selected_context = ""
    if body.selected_control_ids:
        ctrl_result = await db.execute(
            select(FrameworkControl).where(FrameworkControl.id.in_(body.selected_control_ids))
        )
        selected = list(ctrl_result.scalars().all())
        selected_context = f"\n\nALREADY SELECTED CONTROLS ({len(selected)}):\n"
        for c in selected[:30]:
            selected_context += f"- {c.control_id}: {c.title}\n"

    prompt = f"""You are a senior compliance consultant helping build a custom compliance framework.

CONTEXT:
- Industry: {body.industry}
- Region: {body.region or 'Global'}
- Use Case: {body.use_case or 'General security and compliance'}
{selected_context}

TASK:
Suggest 8-12 essential compliance controls tailored to this industry and region.
Avoid suggesting controls similar to those already selected.
Focus on practical, implementable controls that address common gaps.

Return ONLY valid JSON in this exact format:

{{
  "suggestions": [
    {{
      "title": "Control title",
      "description": "Clear, actionable description (1-2 sentences)",
      "category": "Access Control | Data Protection | Incident Response | Risk Management | Compliance | Operations | Vendor Management | Other",
      "rationale": "Why this control is important for this industry/region",
      "priority": "high | medium | low"
    }}
  ],
  "rationale": "Overall explanation of why these controls were chosen"
}}"""

    base_url = settings.OLLAMA_BASE_URL.rstrip("/")
    ollama_url = f"{base_url}/api/chat"
    payload = {
        "model": settings.OLLAMA_CHAT_MODEL,
        "stream": False,
        "format": "json",
        "messages": [{"role": "user", "content": prompt}],
    }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(ollama_url, json=payload)
            if resp.status_code != 200:
                raise HTTPException(status_code=500, detail=f"Ollama error {resp.status_code}")
            data = resp.json()
            ai_quota.record_from_ollama_response(current_user.id, data)
            ai_text = data.get("message", {}).get("content", "")

        try:
            ai_result = json_lib.loads(ai_text)
        except json_lib.JSONDecodeError:
            import re
            match = re.search(r'\{[\s\S]*\}', ai_text)
            if match:
                ai_result = json_lib.loads(match.group())
            else:
                raise HTTPException(status_code=500, detail="AI returned invalid format")

        return AISuggestionsResponse(
            suggestions=[AISuggestion(**s) for s in ai_result.get("suggestions", [])],
            rationale=ai_result.get("rationale", ""),
        )

    except httpx.RequestError:
        import logging
        logging.getLogger(__name__).exception("framework.ai_suggest.ollama_unreachable")
        raise HTTPException(status_code=503, detail="AI service temporarily unavailable")
    except Exception:
        import logging
        logging.getLogger(__name__).exception("framework.ai_suggest.error")
        raise HTTPException(status_code=500, detail="AI suggestions failed")


@router.post("/builder/create", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
async def build_custom_framework(
    body: BuildCustomFrameworkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a new custom framework with the provided list of controls."""
    if not body.controls:
        raise HTTPException(status_code=400, detail="At least one control is required")

    fw = Framework(
        name=body.name,
        short_name=body.short_name,
        version=body.version,
        description=body.description or f"Custom framework with {len(body.controls)} controls",
        issuing_body=body.issuing_body or "Custom",
        applicable_regions=body.applicable_regions,
        applicable_industries=body.applicable_industries,
        is_builtin=False,
        tenant_id=tenant_id,
        status=FrameworkStatus.ACTIVE,
    )
    db.add(fw)
    await db.flush()

    for idx, ctrl_input in enumerate(body.controls):
        category_value = None
        if ctrl_input.category:
            cat_upper = ctrl_input.category.upper().replace(" ", "_").replace("&", "AND")
            if cat_upper in _VALID_CATEGORIES:
                category_value = cat_upper

        control = FrameworkControl(
            framework_id=fw.id,
            control_id=ctrl_input.control_id,
            title=ctrl_input.title,
            description=ctrl_input.description,
            category=category_value,
            sort_order=idx,
            mapped_controls=[],
            tags=[ctrl_input.source_framework] if ctrl_input.source_framework else [],
        )
        db.add(control)

    await db.commit()
    await db.refresh(fw)

    try:
        notify_framework_new.delay(fw.id, body.name)
    except Exception:
        pass

    resp = FrameworkResponse.model_validate(fw)
    resp.control_count = len(body.controls)
    return resp


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


class FrameworkUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    version: str | None = None
    description: str | None = None
    issuing_body: str | None = None
    applicable_regions: list[str] | None = None
    applicable_industries: list[str] | None = None


class CloneFrameworkRequest(BaseModel):
    name: str | None = None
    short_name: str | None = None


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


@router.post("/{framework_id}/clone", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
async def clone_framework(
    framework_id: str,
    body: CloneFrameworkRequest = CloneFrameworkRequest(),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Fork any framework (built-in or custom) into a tenant-owned editable copy.
    Duplicates the framework metadata, all controls (preserving parent/child links),
    and all requirements.
    """
    src_result = await db.execute(select(Framework).where(Framework.id == framework_id))
    src = src_result.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Source framework not found")

    new_fw = Framework(
        name=body.name or f"{src.name} (Custom)",
        short_name=body.short_name or f"{src.short_name}-CUSTOM",
        version=src.version,
        description=src.description,
        issuing_body=src.issuing_body,
        applicable_regions=list(src.applicable_regions or []),
        applicable_industries=list(src.applicable_industries or []),
        is_builtin=False,
        tenant_id=tenant_id,
        status=FrameworkStatus.ACTIVE,
    )
    db.add(new_fw)
    await db.flush()

    src_controls_result = await db.execute(
        select(FrameworkControl)
        .where(FrameworkControl.framework_id == src.id)
        .order_by(FrameworkControl.sort_order)
    )
    src_controls = list(src_controls_result.scalars().all())

    pairs: list[tuple[FrameworkControl, FrameworkControl]] = []
    for src_ctrl in src_controls:
        new_ctrl = FrameworkControl(
            framework_id=new_fw.id,
            control_id=src_ctrl.control_id,
            title=src_ctrl.title,
            description=src_ctrl.description,
            guidance=src_ctrl.guidance,
            category=src_ctrl.category,
            parent_id=None,  # remap below
            sort_order=src_ctrl.sort_order,
            mapped_controls=list(src_ctrl.mapped_controls or []),
            tags=list(src_ctrl.tags or []),
            is_mandatory=src_ctrl.is_mandatory,
        )
        db.add(new_ctrl)
        pairs.append((src_ctrl, new_ctrl))

    await db.flush()
    id_map = {src_ctrl.id: new_ctrl.id for src_ctrl, new_ctrl in pairs}
    for src_ctrl, new_ctrl in pairs:
        if src_ctrl.parent_id and src_ctrl.parent_id in id_map:
            new_ctrl.parent_id = id_map[src_ctrl.parent_id]

    if pairs:
        src_ids = [s.id for s, _ in pairs]
        reqs_result = await db.execute(
            select(ControlRequirement).where(ControlRequirement.control_id.in_(src_ids))
        )
        for src_req in reqs_result.scalars().all():
            db.add(ControlRequirement(
                control_id=id_map[src_req.control_id],
                requirement_text=src_req.requirement_text,
                requirement_level=src_req.requirement_level,
            ))

    await db.commit()
    await db.refresh(new_fw)

    resp = FrameworkResponse.model_validate(new_fw)
    resp.control_count = len(pairs)
    return resp


@router.patch("/{framework_id}", response_model=FrameworkResponse)
async def update_framework(
    framework_id: str,
    body: FrameworkUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.TENANT_ADMIN, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Update tenant-owned framework metadata (name, short_name, etc.)."""
    fw = await _get_tenant_framework(db, framework_id, tenant_id)

    if body.name is not None:                  fw.name = body.name
    if body.short_name is not None:            fw.short_name = body.short_name
    if body.version is not None:               fw.version = body.version
    if body.description is not None:           fw.description = body.description
    if body.issuing_body is not None:          fw.issuing_body = body.issuing_body
    if body.applicable_regions is not None:    fw.applicable_regions = body.applicable_regions
    if body.applicable_industries is not None: fw.applicable_industries = body.applicable_industries

    await db.flush()

    count_result = await db.execute(
        select(func.count()).where(FrameworkControl.framework_id == framework_id)
    )
    resp = FrameworkResponse.model_validate(fw)
    resp.control_count = count_result.scalar_one()
    return resp


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

    # Best-effort notification — broker may be unavailable in dev (no Redis).
    try:
        notify_framework_new.delay(fw.id, body.name)
    except Exception:
        pass

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
        # Best-effort notification — broker may be unavailable in dev (no Redis).
        try:
            notify_framework_updated.delay(fw.id, fw.name)
        except Exception:
            pass

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
    await db.commit()


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
    await db.commit()


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


