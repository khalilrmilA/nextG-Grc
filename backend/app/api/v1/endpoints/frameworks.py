"""Framework management endpoints.

The AI control-suggestion endpoint (POST /builder/ai-suggestions) runs on the shared AI
foundation: an expert system prompt + output schema from ``app.services.ai_prompts`` (task
"framework_builder"), a validated structured call from ``ai_structured`` (schema validation,
a semantic consistency check, one repair retry), transport + untrusted-text delimiting +
deterministic decoding + quota metering from ``ai_provider`` (tenant BYO-AI honoured), and
request-language resolution from ``ai_locale`` (Accept-Language en|fr|ar). Only Ollama is
ever called, and only through ``ai_provider``. A failed or still-inconsistent reply surfaces
as an explicit HTTP 424 (never a 5xx — client.ts hard-redirects the SPA to /service-down on
any 5xx) — never a silently invented suggestion set.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from pydantic import BaseModel, field_validator
from typing import Annotated

from app.core.database import get_db
from app.core import ai_quota
from app.models.framework import Framework, FrameworkControl, ControlCategory, ControlRequirement, FrameworkStatus, FrameworkControlVersion
from app.api.v1.dependencies import get_current_user, get_tenant_id, get_current_user_optional, get_tenant_id_optional
from app.api.v1.dependencies.auth import require_roles
from app.models.user import User, UserRole
from app.workers.tasks.notifications import notify_framework_new, notify_framework_updated
from app.services import ai_chunking, ai_prompts, ai_provider
from app.services.ai_locale import failure_message, get_request_language
from app.services.ai_structured import AiResult, ai_structured

_VALID_CATEGORIES = {c.name for c in ControlCategory}

router = APIRouter()
logger = logging.getLogger(__name__)


def _ai_failure_detail(res: AiResult, lang: str) -> str:
    """"<localised sentence> (<kind>: <admin-safe detail>)" for an HTTPException(424, ...)."""
    return "%s (%s)" % (res.user_message(lang), res.failure_detail())


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


class ControlVersionResponse(BaseModel):
    """A past snapshot of a control's editable fields (RFP: suivi des modifications
    réglementaires avec historique — see FrameworkControlVersion's docstring)."""
    id: str
    control_id: str
    version_number: int
    title: str
    description: str | None
    guidance: str | None
    category: str | None
    tags: list
    changed_by_id: str | None
    created_at: datetime

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
    """A single AI control suggestion (ai_prompts "framework_builder" task)."""
    title: str
    description: str
    category: str
    rationale: str
    priority: str
    # Additive: traceability to a real published clause (schema field "source_reference" /
    # "source_confidence") and which already-selected control this complements. Absent when
    # the model did not supply them (both are optional in FRAMEWORK_BUILDER_SCHEMA).
    source_reference: str | None = None
    source_confidence: float | None = None
    complements: str | None = None


class AISuggestionsResponse(BaseModel):
    """AI-generated control suggestions."""
    suggestions: list[AISuggestion]
    rationale: str
    # Additive: e.g. a prompt-injection attempt spotted in the untrusted use-case text.
    warnings: list[str] = []


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
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """AI-suggested controls for the custom Framework Builder ("framework_builder" task).

    Runs on the shared AI foundation (see module docstring). A failed call, or a reply that
    still fails the schema / duplicate-title / source-reference consistency check after one
    repair retry, is surfaced as HTTP 424 with an honest, localised reason — never a silently
    invented suggestion set (the old "greedy-regex JSON recovery -> generic 500" behaviour is
    gone).
    """
    ai_quota.check_quota_or_raise(current_user.id)

    # Already-selected controls: restricted to frameworks visible to this tenant (built-in or
    # tenant-owned — same visibility rule as list_frameworks) so a stray/foreign id cannot pull
    # another tenant's control text into the prompt. The rich id+title+description context is
    # packed by token budget instead of a hard 30-row, title-only cut, so "avoid similar
    # controls" has real signal; the true total is always reported even when not every row gets
    # the rich treatment, and every title (not just the rich subset) is still surfaced to the
    # model in compact form so the duplicate-title check below never demands the impossible.
    ids = list(dict.fromkeys(str(i).strip() for i in body.selected_control_ids if str(i).strip()))[:200]
    selected: list[FrameworkControl] = []
    if ids:
        ctrl_result = await db.execute(
            select(FrameworkControl)
            .join(Framework, Framework.id == FrameworkControl.framework_id)
            .where(
                FrameworkControl.id.in_(ids),
                (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id),  # noqa: E712
            )
        )
        selected = list(ctrl_result.scalars().all())

    def _render_selected(c: FrameworkControl) -> str:
        cid = ai_provider.clean_field(c.control_id, 60) or "?"
        title = ai_provider.clean_field(c.title, 160)
        desc = ai_provider.clean_field(c.description or "", 200)
        line = "- %s: %s" % (cid, title)
        return "%s — %s" % (line, desc) if desc else line

    # Titles only, for the duplicate/collision consistency check (ai_prompts.consistency_issues
    # compares case-folded titles). This IS the check's `allowed_values`, so every title in it
    # must also be visible to the model in the prompt below — otherwise the check can fail on a
    # collision the model had no way to avoid, and (being a `check=` callback replayed verbatim
    # on the repair retry) the second attempt has no better chance either. Cleaned the same way
    # `_render_selected` cleans titles, so the two agree on the exact string.
    selected_titles = list(dict.fromkeys(
        ai_provider.clean_field(c.title, 160) for c in selected if c.title
    ))

    shown: list[FrameworkControl] = []
    if selected:
        groups = ai_chunking.chunk_items(selected, ai_chunking.CONTROL_BATCH_TOKENS, _render_selected)
        shown = groups[0] if groups else selected
    selected_body = "\n".join(_render_selected(c) for c in shown)
    if len(selected) > len(shown):
        # The rich id+title+description block above is token-budget-limited and a large-but-
        # ordinary selection (the browse step lets a user pull in 100+ controls; ids are capped
        # at 200) can exceed it well before every control is detailed. Titles alone are far
        # cheaper to render than full lines, so — mirroring compliance.py's clause_coverage
        # pattern, where the check's allow-list and the prompt's allow-list are always the same
        # set — the FULL remaining title set (exactly what `selected_titles` above enforces) is
        # always appended in compact form, not just summarised as "+N more not shown".
        shown_titles = {ai_provider.clean_field(c.title, 160) for c in shown if c.title}
        remaining_titles = [t for t in selected_titles if t not in shown_titles]
        selected_body += (
            "\n- (+%d more controls not detailed above; ALL of their titles are listed next so "
            "you can still avoid duplicating them)\n"
            "OTHER ALREADY-SELECTED TITLES (do not propose a new or near-equal title to any of "
            "these either):\n- %s"
        ) % (len(selected) - len(shown), "\n- ".join(remaining_titles) if remaining_titles else "(none)")
    selected_lines = (
        ai_provider.delimit_untrusted(selected_body, "ALREADY SELECTED CONTROLS", max_len=len(selected_body) + 1)
        if selected_body else "(none)"
    )

    use_case_text = (body.use_case or "").strip()
    use_case_block = (
        ai_provider.delimit_untrusted(use_case_text, "USE CASE", max_len=len(use_case_text) + 1)
        if use_case_text else "USE CASE: not provided"
    )

    # industry/region are free text on the wire (the frontend's <select> is UI-only, not
    # a server-side constraint) — clean_field() only single-lines and length-caps, it does
    # not neutralise fence look-alikes or mark the text as data-not-instructions, so it must
    # not be treated as trusted context (same class of bug already fixed for Framework.name
    # in compliance.py and feed titles in regulatory.py).
    industry_text = ai_provider.clean_field(body.industry, 100)
    region_text = ai_provider.clean_field(body.region, 100)
    industry_block = (
        ai_provider.delimit_untrusted(industry_text, "INDUSTRY", max_len=len(industry_text) + 1)
        if industry_text else "not stated"
    )
    region_block = (
        ai_provider.delimit_untrusted(region_text, "REGION", max_len=len(region_text) + 1)
        if region_text else "Global"
    )

    task = "framework_builder"
    try:
        system = ai_prompts.system_prompt(task, lang=lang)
        user = ai_prompts.render_user_prompt(
            task,
            industry=industry_block,
            region=region_block,
            use_case_block=use_case_block,
            selected_count=len(selected),
            shown_count=len(shown),
            selected_lines=selected_lines,
        )
        d = ai_prompts.task_defaults(task)
        res: AiResult = await ai_structured(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            ai_prompts.task_schema(task), schema_in_prompt=False,   # system_prompt already carries the schema
            check=lambda data: ai_prompts.consistency_issues(task, data, allowed_values=selected_titles),
            user_id=current_user.id, tenant_id=tenant_id, db=db, task="frameworks.ai_suggestions",
            **ai_provider.decoding(d["preset"], temperature=d["temperature"]),
        )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — never a 5xx: the SPA redirects to /service-down
        logger.exception("framework.ai_suggest.error tenant=%s", tenant_id)
        raise HTTPException(status_code=424,
                            detail="%s (error: framework suggestion generation failed unexpectedly)" % failure_message("error", lang))

    if not res.ok:
        logger.warning("framework.ai_suggest.failed tenant=%s kind=%s attempts=%d: %s",
                       tenant_id, res.kind, res.attempts, res.error)
        raise HTTPException(status_code=424, detail=_ai_failure_detail(res, lang))

    data = ai_prompts.apply_fixups(task, res.data)

    return AISuggestionsResponse(
        suggestions=[AISuggestion(**s) for s in (data.get("suggestions") or [])],
        rationale=data.get("rationale") or "",
        warnings=list(data.get("warnings") or []),
    )


@router.post("/builder/create", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
async def build_custom_framework(
    body: BuildCustomFrameworkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
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
    _: User = Depends(require_roles(UserRole.CISO)),
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
    _: User = Depends(require_roles(UserRole.CISO)),
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
    current_user: User = Depends(require_roles(UserRole.CISO)),
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
    current_user: User = Depends(require_roles(UserRole.CISO)),
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
    current_user: User = Depends(require_roles(UserRole.CISO)),
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

    # Snapshot the PRE-edit state before applying any change, but only if a
    # snapshotted field is actually about to change — a PATCH that touches
    # nothing (or only fields we don't version) shouldn't create version noise.
    changing = (
        (body.title is not None and body.title != control.title)
        or (body.description is not None and body.description != control.description)
        or (body.guidance is not None and body.guidance != control.guidance)
        or (body.category is not None and body.category != control.category)
        or (body.tags is not None and body.tags != control.tags)
    )
    if changing:
        last = (
            await db.execute(
                select(func.max(FrameworkControlVersion.version_number)).where(
                    FrameworkControlVersion.control_id == control.id
                )
            )
        ).scalar_one()
        db.add(FrameworkControlVersion(
            control_id=control.id,
            version_number=(last or 0) + 1,
            title=control.title,
            description=control.description,
            guidance=control.guidance,
            category=control.category,
            tags=control.tags,
            changed_by_id=current_user.id,
        ))

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


@router.get("/{framework_id}/controls/{control_db_id}/versions", response_model=list[ControlVersionResponse])
async def list_control_versions(
    framework_id: str,
    control_db_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Edit history for a control on a tenant-owned framework, newest first.

    Read access is broader than edit access (any authenticated tenant member,
    not CISO-only) — same asymmetry as everywhere else GET vs. PATCH is split
    in this file. Built-in frameworks are never editable, so they never have
    version rows; ``_get_tenant_framework`` 403s a built-in/foreign framework
    the same way ``update_control`` does, so history can't leak cross-tenant.
    """
    await _get_tenant_framework(db, framework_id, tenant_id)

    control_result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    if control_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Control not found")

    result = await db.execute(
        select(FrameworkControlVersion)
        .where(FrameworkControlVersion.control_id == control_db_id)
        .order_by(FrameworkControlVersion.version_number.desc())
    )
    return list(result.scalars().all())


@router.delete("/{framework_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_framework(
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
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
    _: User = Depends(require_roles(UserRole.CISO)),
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
    _: User = Depends(require_roles(UserRole.CISO)),
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


