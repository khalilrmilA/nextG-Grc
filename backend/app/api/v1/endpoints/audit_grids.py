"""Customisable audit grids — STB objectif 5, « en suivant une grille d'évaluation
personnalisable ».

Today an auditor's checklist is always *the controls of the audit's framework*,
scored on a fixed six-value Python enum. Two halves of the requirement were
missing: the rows (which points are checked) and the scale (which verdicts may
be given). Both are now data.

    AuditGrid          the grid + its verdict scale (JSON `levels`)
    AuditGridItem      one row to assess
    AuditGridResponse  one verdict, for one item, on one engagement

Three rules this module exists to enforce:

1. **Seeding copies, never references.** `POST /{id}/seed-from-framework` writes
   new AuditGridItem rows. Built-in frameworks are shared across every tenant, so
   a grid that edited them in place would rewrite the standard for everybody.
   `AuditGridItem.control_id` keeps the provenance link so a verdict can still be
   carried back to a compliance assessment.
2. **The scale validates against itself.** A verdict is checked against *this
   grid's* `levels`, not against a hard-coded enum. A grid with a five-level
   maturity scale therefore works with no code change — which is the whole
   meaning of « personnalisable ».
3. **A null grid changes nothing.** `audits.grid_id` is nullable and the
   checklist endpoint reports `fallback="framework_controls"` when it is unset,
   so the three live engagements keep behaving exactly as they do today.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.core.database import get_db
from app.models.activity_log import ActivityLog
from app.models.audit import Audit
from app.models.audit_grid import DEFAULT_GRID_LEVELS, AuditGrid, AuditGridItem, AuditGridResponse
from app.models.framework import Framework, FrameworkControl
from app.models.user import User, UserRole
from app.services.activity_chain import chain_and_add
# The engagement-access rules live with the comments module (their only other
# consumer); importing beats a second, drifting copy of the same twenty lines.
from app.api.v1.endpoints.audit_comments import can_access_audit, is_audit_team, load_audit

router = APIRouter()

GRID_MANAGERS = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.AUDITOR)

# Seats that run the tenant's own governance — see require_grid_manager below.
GOVERNANCE_SEATS = (
    UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN, UserRole.CISO, UserRole.COMPLIANCE_MANAGER,
)


def require_grid_manager():
    """GRID_MANAGERS, minus the appointed outside firm.

    Same carve-out as endpoints/audit_campaigns.require_campaign_manager, for the
    same reason: `auditor` must stay in the list because the internal audit team
    authors the grids, but a grid is a tenant-wide yardstick and an outside firm
    (`is_external`) is confined to the engagements it was appointed to — it
    answers grids, it does not write or delete them.
    """
    checked = require_roles(*GRID_MANAGERS)

    # `Depends` as a default rather than inside Annotated: this module runs under
    # `from __future__ import annotations`, so an Annotated[...] here would be a
    # string FastAPI resolves against MODULE globals — and `checked` is a local.
    async def _dep(user: User = Depends(checked)) -> User:
        if user.is_external and user.role not in GOVERNANCE_SEATS:
            raise HTTPException(
                403,
                "An external auditor records verdicts on a grid; the tenant's grids "
                "are not theirs to author.",
            )
        return user

    return _dep

# A grid seeded from NIST 800-53 would be well over a thousand rows; past this
# the request stops being a grid and starts being an import. Callers are told to
# narrow by domain instead of silently getting a truncated checklist.
MAX_SEEDED_ITEMS = 1500


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class GridCreate(BaseModel):
    name: str
    description: str | None = None
    levels: list[dict] | None = None     # null = use DEFAULT_GRID_LEVELS
    source_framework_id: str | None = None
    is_default: bool = False


class GridUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    levels: list[dict] | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class GridOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    description: str | None
    source_framework_id: str | None
    levels: list | None                  # as stored — null means "the default"
    levels_resolved: list                # what the UI should actually render
    is_default: bool
    is_active: bool
    created_by_id: str | None
    item_count: int
    created_at: datetime
    updated_at: datetime


class GridItemIn(BaseModel):
    title: str
    ref_code: str | None = None
    description: str | None = None
    guidance: str | None = None
    section: str | None = None
    sort_order: int | None = None
    control_id: str | None = None
    is_mandatory: bool = False


class GridItemUpdate(BaseModel):
    title: str | None = None
    ref_code: str | None = None
    description: str | None = None
    guidance: str | None = None
    section: str | None = None
    sort_order: int | None = None
    is_mandatory: bool | None = None


class GridItemOut(BaseModel):
    id: str
    grid_id: str
    ref_code: str | None
    title: str
    description: str | None
    guidance: str | None
    section: str | None
    sort_order: int
    control_id: str | None
    is_mandatory: bool
    model_config = {"from_attributes": True}


class GridDetailOut(BaseModel):
    grid: GridOut
    items: list[GridItemOut]


class SeedFromFrameworkIn(BaseModel):
    framework_id: str
    domain: str | None = None            # narrow a large framework to one domain
    replace: bool = False                # wipe the grid's current rows first


class SeedResultOut(BaseModel):
    created: int
    skipped: int
    total_items: int


class ResponseIn(BaseModel):
    verdict: str | None = None           # a key of the grid's levels, or null to clear
    note: str | None = None


class BulkResponseIn(BaseModel):
    responses: dict[str, ResponseIn]     # item_id -> verdict/note


class ResponseOut(BaseModel):
    id: str
    audit_id: str
    item_id: str
    verdict: str | None
    note: str | None
    answered_by_id: str | None
    answered_at: datetime | None
    model_config = {"from_attributes": True}


class ChecklistOut(BaseModel):
    """What the auditor works through for one engagement."""

    audit_id: str
    grid: GridOut | None
    items: list[GridItemOut]
    responses: list[ResponseOut]
    # "grid" when the engagement has one, "framework_controls" when it does not —
    # the caller then keeps using today's framework-controls checklist unchanged.
    source: str
    can_answer: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def resolve_levels(grid: AuditGrid) -> list[dict]:
    """The grid's own scale, or the default when it never defined one."""
    return list(grid.levels) if grid.levels else list(DEFAULT_GRID_LEVELS)


def _validate_levels(levels: Any) -> list[dict]:
    """A scale the whole engagement is measured on has to be well-formed.

    Validated here rather than in the model because the column is JSON for
    portability (SQLite/PostgreSQL/Oracle/MSSQL all store it as text).
    """
    if not isinstance(levels, list) or not levels:
        raise HTTPException(422, "levels must be a non-empty list")
    seen: set[str] = set()
    cleaned: list[dict] = []
    for i, lvl in enumerate(levels):
        if not isinstance(lvl, dict):
            raise HTTPException(422, f"levels[{i}] must be an object")
        key = str(lvl.get("key") or "").strip()
        if not key:
            raise HTTPException(422, f"levels[{i}].key is required")
        if key in seen:
            raise HTTPException(422, f"duplicate level key '{key}'")
        seen.add(key)
        if not any(str(lvl.get(f) or "").strip() for f in ("label_fr", "label_en", "label_ar")):
            raise HTTPException(422, f"levels[{i}] needs at least one of label_fr/label_en/label_ar")
        weight = lvl.get("weight")
        # null weight is meaningful — it is how « non applicable » stays out of
        # the score instead of counting as a zero.
        if weight is not None:
            if not isinstance(weight, (int, float)) or isinstance(weight, bool):
                raise HTTPException(422, f"levels[{i}].weight must be a number or null")
            if not 0.0 <= float(weight) <= 1.0:
                raise HTTPException(422, f"levels[{i}].weight must be between 0 and 1")
        cleaned.append({
            "key": key,
            "label_fr": lvl.get("label_fr"),
            "label_en": lvl.get("label_en"),
            "label_ar": lvl.get("label_ar"),
            "color": lvl.get("color"),
            "weight": None if weight is None else float(weight),
            "is_gap": bool(lvl.get("is_gap", False)),
        })
    return cleaned


async def _grid_out(db: AsyncSession, grid: AuditGrid, item_count: int | None = None) -> GridOut:
    """`item_count` lets a list pass a pre-computed count and avoid one query
    per grid; omitted, the count is fetched for this grid alone."""
    if item_count is None:
        item_count = (await db.execute(
            select(func.count(AuditGridItem.id)).where(AuditGridItem.grid_id == grid.id)
        )).scalar() or 0
    count = item_count
    return GridOut(
        id=grid.id, tenant_id=grid.tenant_id, name=grid.name, description=grid.description,
        source_framework_id=grid.source_framework_id,
        levels=grid.levels, levels_resolved=resolve_levels(grid),
        is_default=grid.is_default, is_active=grid.is_active,
        created_by_id=grid.created_by_id, item_count=int(count),
        created_at=grid.created_at, updated_at=grid.updated_at,
    )


async def _get_grid(db: AsyncSession, tenant_id: str, grid_id: str) -> AuditGrid:
    grid = (await db.execute(
        select(AuditGrid).where(AuditGrid.id == grid_id, AuditGrid.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if grid is None:
        raise HTTPException(404, "Grid not found")
    return grid


async def _log(db: AsyncSession, tenant_id: str, user: User, grid: AuditGrid,
               action: str, details: dict | None = None) -> None:
    """A grid is the yardstick a whole engagement is measured with — changing it
    is a governance act and belongs in the hash-chained trail."""
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=user.id, user_email=user.email,
        action=action, entity_type="audit_grid",
        entity_id=grid.id, entity_name=grid.name, details=details or {},
    ))


# ---------------------------------------------------------------------------
# Grid CRUD
# ---------------------------------------------------------------------------
@router.get("", response_model=list[GridOut])
async def list_grids(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    is_active: bool | None = None,
    search: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    q = select(AuditGrid).where(AuditGrid.tenant_id == tenant_id)
    if is_active is not None:
        q = q.where(AuditGrid.is_active == is_active)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        q = q.where(or_(AuditGrid.name.ilike(pattern), AuditGrid.description.ilike(pattern)))
    try:
        grids = (await db.execute(
            q.order_by(AuditGrid.is_default.desc(), AuditGrid.name, AuditGrid.id)
            .limit(limit).offset(offset)
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        # audit_grids is created by create_all() at startup; before that restart
        # this list raises, and client.ts hard-redirects the SPA to /service-down
        # on any 5xx — the user is ejected from the application rather than shown
        # an empty « grilles d'audit » screen. No table means no grids, which is
        # exactly true. Same tolerance compliance.py gives its own new tables.
        await db.rollback()
        return []
    if not grids:
        return []
    # One grouped count for the whole page — a per-grid count meant a query per
    # row, and a tenant's grid list is rendered on every audit-creation screen.
    counts = dict((await db.execute(
        select(AuditGridItem.grid_id, func.count(AuditGridItem.id))
        .where(AuditGridItem.grid_id.in_([g.id for g in grids]))
        .group_by(AuditGridItem.grid_id)
    )).all())
    return [await _grid_out(db, g, int(counts.get(g.id, 0))) for g in grids]


@router.post("", response_model=GridOut, status_code=201)
async def create_grid(
    body: GridCreate,
    user: Annotated[User, Depends(require_grid_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    levels = _validate_levels(body.levels) if body.levels is not None else None
    if body.source_framework_id:
        await _framework_in_scope(db, tenant_id, body.source_framework_id)

    grid = AuditGrid(
        tenant_id=tenant_id, name=name, description=body.description,
        source_framework_id=body.source_framework_id, levels=levels,
        is_default=bool(body.is_default), created_by_id=user.id,
    )
    db.add(grid)
    await db.flush()
    if grid.is_default:
        await _clear_other_defaults(db, tenant_id, grid.id)
    await db.commit()
    await _log(db, tenant_id, user, grid, "create",
               {"levels": len(resolve_levels(grid)), "source_framework_id": grid.source_framework_id})
    await db.refresh(grid)
    return await _grid_out(db, grid)


async def _clear_other_defaults(db: AsyncSession, tenant_id: str, keep_id: str) -> None:
    """Exactly one default grid per tenant — same rule risk_matrices applies."""
    others = (await db.execute(
        select(AuditGrid).where(
            AuditGrid.tenant_id == tenant_id,
            AuditGrid.is_default == True,          # noqa: E712
            AuditGrid.id != keep_id,
        )
    )).scalars().all()
    for o in others:
        o.is_default = False


@router.get("/{grid_id}", response_model=GridDetailOut)
async def get_grid(
    grid_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    grid = await _get_grid(db, tenant_id, grid_id)
    items = (await db.execute(
        select(AuditGridItem).where(AuditGridItem.grid_id == grid.id)
        .order_by(AuditGridItem.sort_order, AuditGridItem.ref_code, AuditGridItem.id)
    )).scalars().all()
    return GridDetailOut(
        grid=await _grid_out(db, grid),
        items=[GridItemOut.model_validate(i) for i in items],
    )


@router.patch("/{grid_id}", response_model=GridOut)
async def update_grid(
    grid_id: str,
    body: GridUpdate,
    user: Annotated[User, Depends(require_grid_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Rename a grid, retire it, or change its scale.

    Changing the scale while verdicts already reference the old keys would leave
    orphaned answers, so any level key still in use must survive the edit.
    """
    grid = await _get_grid(db, tenant_id, grid_id)
    changed: dict[str, Any] = {}

    if body.levels is not None:
        new_levels = _validate_levels(body.levels)
        new_keys = {lvl["key"] for lvl in new_levels}
        used = set((await db.execute(
            select(AuditGridResponse.verdict)
            .join(AuditGridItem, AuditGridItem.id == AuditGridResponse.item_id)
            .where(AuditGridItem.grid_id == grid.id, AuditGridResponse.verdict.isnot(None))
            .distinct()
        )).scalars().all())
        orphaned = used - new_keys
        if orphaned:
            raise HTTPException(
                409,
                f"Level(s) {sorted(orphaned)} are still used by recorded verdicts. "
                "Re-answer or clear those items before removing the level.",
            )
        grid.levels = new_levels
        changed["levels"] = sorted(new_keys)

    for field in ("name", "description", "is_active"):
        new = getattr(body, field)
        if new is not None and getattr(grid, field) != new:
            changed[field] = new
            setattr(grid, field, new)

    if body.is_default is not None and grid.is_default != body.is_default:
        grid.is_default = body.is_default
        changed["is_default"] = body.is_default
        if body.is_default:
            await _clear_other_defaults(db, tenant_id, grid.id)

    if not changed:
        return await _grid_out(db, grid)
    await db.commit()
    await _log(db, tenant_id, user, grid, "update", {"changed": changed})
    await db.refresh(grid)
    return await _grid_out(db, grid)


@router.delete("/{grid_id}", status_code=204)
async def delete_grid(
    grid_id: str,
    user: Annotated[User, Depends(require_grid_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a grid no engagement uses. One that has been used is retired instead.

    Deleting it would strand `audits.grid_id` and destroy the record of what the
    auditor was actually asked to check.
    """
    grid = await _get_grid(db, tenant_id, grid_id)
    in_use = (await db.execute(
        select(func.count(Audit.id)).where(
            Audit.grid_id == grid.id, Audit.tenant_id == tenant_id
        )
    )).scalar() or 0
    if in_use:
        raise HTTPException(
            409,
            f"{in_use} audit(s) are conducted on this grid. "
            "Set is_active=false to retire it instead of deleting it.",
        )
    # `in_use` counts engagements, not answers. An engagement that was re-pointed
    # to another grid leaves its verdicts behind on this one, and
    # audit_grid_responses.item_id declares no ORM relationship — so deleting the
    # rows below would not fail, it would silently orphan recorded audit evidence.
    answered = (await db.execute(
        select(func.count(AuditGridResponse.id))
        .join(AuditGridItem, AuditGridItem.id == AuditGridResponse.item_id)
        .where(AuditGridItem.grid_id == grid.id)
    )).scalar() or 0
    if answered:
        raise HTTPException(
            409,
            f"{answered} verdict(s) are recorded against this grid's rows. "
            "Set is_active=false to retire it instead of deleting it.",
        )
    await _log(db, tenant_id, user, grid, "delete", {"levels": resolve_levels(grid)})
    # No cascade is configured on the FK, so the rows are removed explicitly.
    # Safe: a grid with no engagement can carry no responses either.
    items = (await db.execute(
        select(AuditGridItem).where(AuditGridItem.grid_id == grid.id)
    )).scalars().all()
    for i in items:
        await db.delete(i)
    await db.delete(grid)
    await db.commit()


# ---------------------------------------------------------------------------
# Grid rows
# ---------------------------------------------------------------------------
@router.post("/{grid_id}/items", response_model=GridItemOut, status_code=201)
async def add_item(
    grid_id: str,
    body: GridItemIn,
    user: Annotated[User, Depends(require_grid_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    grid = await _get_grid(db, tenant_id, grid_id)
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(422, "title is required")
    if body.control_id:
        # A row may cite a control, but only one the tenant can actually see.
        await _control_in_scope(db, tenant_id, body.control_id)

    sort_order = body.sort_order
    if sort_order is None:
        current_max = (await db.execute(
            select(func.max(AuditGridItem.sort_order)).where(AuditGridItem.grid_id == grid.id)
        )).scalar()
        sort_order = int(current_max or 0) + 10

    item = AuditGridItem(
        grid_id=grid.id, ref_code=body.ref_code, title=title,
        description=body.description, guidance=body.guidance, section=body.section,
        sort_order=sort_order, control_id=body.control_id,
        is_mandatory=bool(body.is_mandatory),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    # A row of the grid IS the yardstick; adding one is a governance act and
    # belongs in the same hash-chained trail as changing the grid's scale.
    await _log(db, tenant_id, user, grid, "update",
               {"grid_item": "add", "item_id": item.id, "title": item.title})
    return GridItemOut.model_validate(item)


@router.patch("/{grid_id}/items/{item_id}", response_model=GridItemOut)
async def update_item(
    grid_id: str,
    item_id: str,
    body: GridItemUpdate,
    user: Annotated[User, Depends(require_grid_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    grid = await _get_grid(db, tenant_id, grid_id)
    item = (await db.execute(
        select(AuditGridItem).where(AuditGridItem.id == item_id, AuditGridItem.grid_id == grid.id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Grid item not found")
    changed: dict[str, Any] = {}
    for field in ("title", "ref_code", "description", "guidance", "section",
                  "sort_order", "is_mandatory"):
        new = getattr(body, field)
        if new is not None and getattr(item, field) != new:
            changed[field] = new
            setattr(item, field, new)
    if not changed:
        return GridItemOut.model_validate(item)
    await db.commit()
    await db.refresh(item)
    await _log(db, tenant_id, user, grid, "update",
               {"grid_item": "edit", "item_id": item.id, "changed": changed})
    return GridItemOut.model_validate(item)


@router.delete("/{grid_id}/items/{item_id}", status_code=204)
async def delete_item(
    grid_id: str,
    item_id: str,
    user: Annotated[User, Depends(require_grid_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove a row that nobody has answered yet.

    An answered row carries an auditor's recorded verdict; deleting it would
    delete audit evidence, so the request is refused rather than cascaded.
    """
    grid = await _get_grid(db, tenant_id, grid_id)
    item = (await db.execute(
        select(AuditGridItem).where(AuditGridItem.id == item_id, AuditGridItem.grid_id == grid.id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Grid item not found")
    answered = (await db.execute(
        select(func.count(AuditGridResponse.id)).where(AuditGridResponse.item_id == item.id)
    )).scalar() or 0
    if answered:
        raise HTTPException(409, f"{answered} recorded verdict(s) reference this row; it cannot be deleted.")
    # Recorded before the delete: afterwards this entry is the only trace the
    # row was ever part of what the auditor was asked to check.
    await _log(db, tenant_id, user, grid, "update",
               {"grid_item": "delete", "item_id": item.id, "title": item.title,
                "ref_code": item.ref_code})
    await db.delete(item)
    await db.commit()


# ---------------------------------------------------------------------------
# Seeding from a framework
# ---------------------------------------------------------------------------
async def _framework_in_scope(db: AsyncSession, tenant_id: str, framework_id: str) -> Framework:
    """A tenant may seed from a built-in (shared, read-only) or its own fork."""
    fw = (await db.execute(
        select(Framework).where(
            Framework.id == framework_id,
            or_(Framework.is_builtin == True, Framework.tenant_id == tenant_id),  # noqa: E712
        )
    )).scalar_one_or_none()
    if fw is None:
        raise HTTPException(404, "Framework not found")
    return fw


async def _control_in_scope(db: AsyncSession, tenant_id: str, control_id: str) -> FrameworkControl:
    ctrl = (await db.execute(
        select(FrameworkControl)
        .join(Framework, Framework.id == FrameworkControl.framework_id)
        .where(
            FrameworkControl.id == control_id,
            or_(Framework.is_builtin == True, Framework.tenant_id == tenant_id),  # noqa: E712
        )
    )).scalar_one_or_none()
    if ctrl is None:
        raise HTTPException(404, "Control not found")
    return ctrl


@router.post("/{grid_id}/seed-from-framework", response_model=SeedResultOut)
async def seed_from_framework(
    grid_id: str,
    body: SeedFromFrameworkIn,
    user: Annotated[User, Depends(require_grid_manager())],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Fill a grid with copies of a framework's controls.

    Copies — the built-in framework is shared by every tenant and is never
    touched. Re-running is idempotent: a control already present as a row is
    skipped, so seeding twice does not double the checklist.
    """
    grid = await _get_grid(db, tenant_id, grid_id)
    fw = await _framework_in_scope(db, tenant_id, body.framework_id)

    q = select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
    if body.domain:
        d = body.domain.strip().lower()
        # `domain` is the new controlled column and is still NULL everywhere until
        # the backfill runs; `category` is the free-text value that is populated
        # today, with case variants — hence the lower() on both.
        q = q.where(or_(func.lower(FrameworkControl.domain) == d,
                        func.lower(FrameworkControl.category) == d))
    controls = (await db.execute(
        q.order_by(FrameworkControl.sort_order, FrameworkControl.control_id)
    )).scalars().all()
    if len(controls) > MAX_SEEDED_ITEMS:
        raise HTTPException(
            422,
            f"{len(controls)} controls exceed the {MAX_SEEDED_ITEMS}-row grid limit. "
            "Narrow the seed with a `domain`.",
        )

    if body.replace:
        answered = (await db.execute(
            select(func.count(AuditGridResponse.id))
            .join(AuditGridItem, AuditGridItem.id == AuditGridResponse.item_id)
            .where(AuditGridItem.grid_id == grid.id)
        )).scalar() or 0
        if answered:
            raise HTTPException(
                409,
                f"{answered} verdict(s) already recorded on this grid; refusing to replace its rows.",
            )
        for old in (await db.execute(
            select(AuditGridItem).where(AuditGridItem.grid_id == grid.id)
        )).scalars().all():
            await db.delete(old)
        await db.flush()

    existing = set((await db.execute(
        select(AuditGridItem.control_id).where(
            AuditGridItem.grid_id == grid.id, AuditGridItem.control_id.isnot(None)
        )
    )).scalars().all())

    created = skipped = 0
    for idx, c in enumerate(controls):
        if c.id in existing:
            skipped += 1
            continue
        db.add(AuditGridItem(
            grid_id=grid.id,
            ref_code=c.control_id,
            title=c.title,
            description=c.description,
            guidance=c.guidance,
            section=(c.domain or (c.category.lower() if c.category else None)),
            sort_order=(c.sort_order or 0) * 10 + idx,
            control_id=c.id,
            is_mandatory=bool(c.is_mandatory),
        ))
        created += 1

    if grid.source_framework_id is None:
        grid.source_framework_id = fw.id
    await db.commit()
    await _log(db, tenant_id, user, grid, "update", {
        "seeded_from": fw.short_name, "framework_id": fw.id,
        "created": created, "skipped": skipped, "domain": body.domain,
    })
    total = (await db.execute(
        select(func.count(AuditGridItem.id)).where(AuditGridItem.grid_id == grid.id)
    )).scalar() or 0
    return SeedResultOut(created=created, skipped=skipped, total_items=int(total))


# ---------------------------------------------------------------------------
# Conducting the audit on the grid
# ---------------------------------------------------------------------------
@router.get("/audits/{audit_id}/checklist", response_model=ChecklistOut)
async def audit_checklist(
    audit_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """The engagement's grid, its rows and the verdicts recorded so far.

    When the engagement has no grid, `source` comes back as
    "framework_controls" with empty rows — the caller then renders today's
    framework-controls checklist exactly as before. That is the fallback that
    keeps the three live engagements working.
    """
    audit = await load_audit(db, tenant_id, audit_id)
    if not await can_access_audit(db, current_user, tenant_id, audit):
        raise HTTPException(403, "You are not assigned to this audit")
    can_answer = await is_audit_team(db, current_user, audit)

    if not audit.grid_id:
        return ChecklistOut(audit_id=audit.id, grid=None, items=[], responses=[],
                            source="framework_controls", can_answer=can_answer)

    grid = (await db.execute(
        select(AuditGrid).where(AuditGrid.id == audit.grid_id, AuditGrid.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if grid is None:
        # The engagement points at a grid from another tenant or one since
        # removed. Degrade to the legacy checklist rather than 500.
        return ChecklistOut(audit_id=audit.id, grid=None, items=[], responses=[],
                            source="framework_controls", can_answer=can_answer)

    items = (await db.execute(
        select(AuditGridItem).where(AuditGridItem.grid_id == grid.id)
        .order_by(AuditGridItem.sort_order, AuditGridItem.ref_code, AuditGridItem.id)
    )).scalars().all()
    responses = (await db.execute(
        select(AuditGridResponse).where(AuditGridResponse.audit_id == audit.id)
    )).scalars().all()
    return ChecklistOut(
        audit_id=audit.id,
        grid=await _grid_out(db, grid),
        items=[GridItemOut.model_validate(i) for i in items],
        responses=[ResponseOut.model_validate(r) for r in responses],
        source="grid",
        can_answer=can_answer,
    )


async def _upsert_response(
    db: AsyncSession, audit: Audit, grid: AuditGrid, item: AuditGridItem,
    user: User, verdict: str | None, note: str | None,
) -> AuditGridResponse:
    valid_keys = {lvl["key"] for lvl in resolve_levels(grid)}
    if verdict is not None and verdict not in valid_keys:
        # Validated against THIS grid's scale — the point of « personnalisable ».
        raise HTTPException(422, f"verdict must be one of {sorted(valid_keys)}")

    row = (await db.execute(
        select(AuditGridResponse).where(
            AuditGridResponse.audit_id == audit.id, AuditGridResponse.item_id == item.id
        )
    )).scalar_one_or_none()
    if row is None:
        row = AuditGridResponse(audit_id=audit.id, item_id=item.id)
        db.add(row)
    row.verdict = verdict
    if note is not None:
        row.note = note
    row.answered_by_id = user.id
    row.answered_at = datetime.now(timezone.utc)
    return row


async def _load_audit_grid(
    db: AsyncSession, user: User, tenant_id: str, audit_id: str
) -> tuple[Audit, AuditGrid]:
    audit = await load_audit(db, tenant_id, audit_id)
    if not await can_access_audit(db, user, tenant_id, audit):
        raise HTTPException(403, "You are not assigned to this audit")
    # Recording a verdict is the auditor's act; an auditee may read the grid but
    # never answer it.
    if not await is_audit_team(db, user, audit):
        raise HTTPException(403, "Only the audit team can record a verdict")
    if not audit.grid_id:
        raise HTTPException(409, "This audit is not conducted on a grid")
    grid = (await db.execute(
        select(AuditGrid).where(AuditGrid.id == audit.grid_id, AuditGrid.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if grid is None:
        raise HTTPException(404, "The audit's grid was not found")
    return audit, grid


@router.put("/audits/{audit_id}/responses/{item_id}", response_model=ResponseOut)
async def set_response(
    audit_id: str,
    item_id: str,
    body: ResponseIn,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record (or clear) the verdict on one row of the engagement's grid."""
    audit, grid = await _load_audit_grid(db, current_user, tenant_id, audit_id)
    item = (await db.execute(
        select(AuditGridItem).where(AuditGridItem.id == item_id, AuditGridItem.grid_id == grid.id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Grid item not found on this audit's grid")
    row = await _upsert_response(db, audit, grid, item, current_user, body.verdict, body.note)
    await db.commit()
    await db.refresh(row)
    return ResponseOut.model_validate(row)


@router.put("/audits/{audit_id}/responses", response_model=list[ResponseOut])
async def set_responses_bulk(
    audit_id: str,
    body: BulkResponseIn,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Save a page of the checklist in one call.

    A grid page holds dozens of rows; one request per row would mean dozens of
    round trips and a partially-saved page whenever one of them failed. Here the
    whole page commits or none of it does.
    """
    if not body.responses:
        return []
    audit, grid = await _load_audit_grid(db, current_user, tenant_id, audit_id)
    items = {
        i.id: i for i in (await db.execute(
            select(AuditGridItem).where(
                AuditGridItem.grid_id == grid.id,
                AuditGridItem.id.in_(list(body.responses.keys())),
            )
        )).scalars().all()
    }
    unknown = set(body.responses) - set(items)
    if unknown:
        raise HTTPException(404, f"Rows not on this audit's grid: {sorted(unknown)}")

    rows = [
        await _upsert_response(db, audit, grid, items[item_id], current_user, r.verdict, r.note)
        for item_id, r in body.responses.items()
    ]
    await db.commit()
    for r in rows:
        await db.refresh(r)
    return [ResponseOut.model_validate(r) for r in rows]
