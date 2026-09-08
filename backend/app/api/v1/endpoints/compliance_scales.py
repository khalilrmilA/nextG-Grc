"""Configurable conformity scales — STB objectif 2, « grille d'évaluation personnalisable ».

The tender names three levels (conforme / partiellement conforme / non conforme)
but requires the grid itself to be customisable — banks routinely add « non
applicable », « à confirmer », or a five-level maturity scale. Today
``ControlStatus`` is a hard-coded Python enum and the score is a hard-coded
``implemented + 0.5 × partially_implemented``.

This module is the CRUD half of the fix, modelled on ``risk_matrices.py``, which
already solves the identical problem for risk:

* a **built-in** scale (``tenant_id`` NULL) shared read-only by every tenant;
* **tenant-owned** scales that may be created, edited, retired and marked default;
* the definition is JSON, so a new scale needs no migration and no code change.

Two constraints this file enforces that the rest of the platform depends on:

1. Every level must declare a ``legacy_status`` from ``ControlStatus``. The
   ``control_assessments.status`` enum column keeps being written alongside
   ``status_key``, so all 1 743 existing rows, every query, every export and
   every report keep working exactly as they do — a custom scale is additive,
   never a fork of the data model.
2. A level still referenced by a recorded verdict cannot be removed, and a scale
   in use cannot be deleted. Losing the meaning of an answer already given is
   worse than refusing the edit.

Scoring itself (``weight``) and gap creation (``counts_as_gap``) are consumed by
``endpoints/compliance.py``; this module only guarantees the definition is sane.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.core.database import get_db
from app.models.activity_log import ActivityLog
from app.models.compliance import ComplianceAssessment, ControlAssessment, ControlStatus
from app.models.compliance_scale import DEFAULT_SCALE_LEVELS, ComplianceScale
from app.models.user import User, UserRole
from app.services.activity_chain import chain_and_add

router = APIRouter()

SCALE_MANAGERS = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER)

LEGACY_STATUSES = {s.value for s in ControlStatus}

# A fixed primary key for the shared built-in row. Deterministic on purpose:
# with 2 uvicorn workers two requests can try to materialise it at the same
# instant, and a colliding PK makes the loser fail cleanly and re-read instead
# of leaving the platform with two "built-in" scales.
BUILTIN_SCALE_ID = "builtin-compliance-scale-default"
BUILTIN_SCALE_NAME = "Échelle de conformité STB (par défaut)"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ScaleCreate(BaseModel):
    name: str
    description: str | None = None
    levels: list[dict]
    is_default: bool = False


class ScaleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    levels: list[dict] | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ScaleOut(BaseModel):
    id: str
    tenant_id: str | None
    name: str
    description: str | None
    levels: list
    is_default: bool
    is_builtin: bool
    is_active: bool
    created_by_id: str | None
    # How many assessments are graded on this scale — what the UI needs to warn
    # "changing this re-scores 12 assessments" before the edit, not after.
    assessment_count: int
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_levels(levels: Any) -> list[dict]:
    """Reject a scale that would break scoring, gap creation or the legacy enum."""
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
        # A null weight keeps the level out of the score entirely — that is how
        # « non applicable » stays neutral instead of scoring zero.
        if weight is not None:
            if not isinstance(weight, (int, float)) or isinstance(weight, bool):
                raise HTTPException(422, f"levels[{i}].weight must be a number or null")
            if not 0.0 <= float(weight) <= 1.0:
                raise HTTPException(422, f"levels[{i}].weight must be between 0 and 1")

        legacy = str(lvl.get("legacy_status") or "").strip()
        if legacy not in LEGACY_STATUSES:
            raise HTTPException(
                422,
                f"levels[{i}].legacy_status must be one of {sorted(LEGACY_STATUSES)} — "
                "control_assessments.status keeps being written alongside status_key "
                "so existing queries, exports and reports are unaffected.",
            )
        cleaned.append({
            "key": key,
            "label_fr": lvl.get("label_fr"),
            "label_en": lvl.get("label_en"),
            "label_ar": lvl.get("label_ar"),
            "color": lvl.get("color"),
            "weight": None if weight is None else float(weight),
            "counts_as_gap": bool(lvl.get("counts_as_gap", False)),
            "legacy_status": legacy,
        })
    if not any(lvl["weight"] is not None for lvl in cleaned):
        raise HTTPException(422, "at least one level must carry a weight, or no score can be computed")
    return cleaned


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _ensure_builtin(db: AsyncSession) -> None:
    """Materialise the shared built-in scale the first time anyone asks for it.

    A seed script would be the tidier home for this, but the feature must not
    depend on a script having been run on a machine we do not control: without a
    real row there is no id for ``compliance_assessments.scale_id`` to point at,
    and the whole customisable grid stays theoretical. Idempotent, and safe to
    lose — a failure here degrades to "no built-in listed", never to an error.
    """
    try:
        exists = (await db.execute(
            select(ComplianceScale.id).where(ComplianceScale.is_builtin == True).limit(1)  # noqa: E712
        )).first()
    except (OperationalError, ProgrammingError):
        # compliance_scales itself is built by create_all() at startup. Before
        # that restart even the probe raises, and a 5xx here bounces the whole SPA
        # to /service-down; "no grid available yet" is the truthful answer.
        await db.rollback()
        return
    if exists:
        return
    try:
        db.add(ComplianceScale(
            id=BUILTIN_SCALE_ID, tenant_id=None, name=BUILTIN_SCALE_NAME,
            description="Conforme / partiellement conforme / non conforme / non applicable.",
            levels=list(DEFAULT_SCALE_LEVELS),
            is_default=True, is_builtin=True, is_active=True,
        ))
        await db.commit()
    except (IntegrityError, OperationalError):
        # Another worker won the race, or the database is momentarily locked.
        await db.rollback()


async def _usage_counts(db: AsyncSession, scale_ids: list[str]) -> dict[str, int]:
    """How many assessments each scale grades — one grouped query, not one per row."""
    if not scale_ids:
        return {}
    rows = (await db.execute(
        select(ComplianceAssessment.scale_id, func.count(ComplianceAssessment.id))
        .where(ComplianceAssessment.scale_id.in_(scale_ids))
        .group_by(ComplianceAssessment.scale_id)
    )).all()
    return {sid: int(n) for sid, n in rows}


def _to_out(scale: ComplianceScale, usage: int) -> ScaleOut:
    return ScaleOut(
        id=scale.id, tenant_id=scale.tenant_id, name=scale.name,
        description=scale.description, levels=list(scale.levels or []),
        is_default=scale.is_default, is_builtin=scale.is_builtin,
        is_active=scale.is_active, created_by_id=scale.created_by_id,
        assessment_count=usage,
        created_at=scale.created_at, updated_at=scale.updated_at,
    )


async def _get_scale(db: AsyncSession, tenant_id: str, scale_id: str) -> ComplianceScale:
    """A tenant sees its own scales and the shared built-ins, nothing else."""
    scale = (await db.execute(
        select(ComplianceScale).where(
            ComplianceScale.id == scale_id,
            or_(ComplianceScale.tenant_id == tenant_id,
                ComplianceScale.is_builtin == True),  # noqa: E712
        )
    )).scalar_one_or_none()
    if scale is None:
        raise HTTPException(404, "Scale not found")
    return scale


def _assert_editable(scale: ComplianceScale, tenant_id: str) -> None:
    """Built-in rows are shared across every tenant — editing one would change
    the yardstick for other banks. Same rule as built-in frameworks and matrices."""
    if scale.is_builtin or scale.tenant_id is None:
        raise HTTPException(403, "Built-in scales are read-only. Duplicate it to customise it.")
    if scale.tenant_id != tenant_id:
        raise HTTPException(404, "Scale not found")


async def _log(db: AsyncSession, tenant_id: str, user: User, scale: ComplianceScale,
               action: str, reason: str | None, details: dict | None = None) -> None:
    """The scale is the yardstick a bank's whole compliance position is measured
    on. Who changed it, when and why has to be recoverable years later — so it
    goes into the hash-chained trail, never into activity_logs directly."""
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=user.id, user_email=user.email,
        action=action, entity_type="compliance_scale",
        entity_id=scale.id, entity_name=scale.name,
        details={"reason": reason, **(details or {})},
    ))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/default-levels", response_model=list[dict])
async def default_levels(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """The template a « start from the standard scale » button copies.

    Declared before ``/{scale_id}`` so the literal path wins the match.
    """
    return list(DEFAULT_SCALE_LEVELS)


@router.get("", response_model=list[ScaleOut])
async def list_scales(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    is_active: bool | None = None,
):
    """Every scale this tenant may grade an assessment on: the shared built-ins
    plus its own."""
    await _ensure_builtin(db)
    q = select(ComplianceScale).where(
        or_(ComplianceScale.tenant_id == tenant_id,
            ComplianceScale.is_builtin == True)  # noqa: E712
    )
    if is_active is not None:
        q = q.where(ComplianceScale.is_active == is_active)
    try:
        scales = (await db.execute(
            q.order_by(ComplianceScale.is_builtin.desc(), ComplianceScale.is_default.desc(),
                       ComplianceScale.name, ComplianceScale.id)
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        # Same reason as in _ensure_builtin: an empty list of grids, not a 5xx
        # that ejects the user from the application. GET /default-levels still
        # answers, so the "start from the standard scale" button keeps working.
        await db.rollback()
        return []
    usage = await _usage_counts(db, [s.id for s in scales])
    return [_to_out(s, usage.get(s.id, 0)) for s in scales]


@router.get("/{scale_id}", response_model=ScaleOut)
async def get_scale(
    scale_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    scale = await _get_scale(db, tenant_id, scale_id)
    usage = await _usage_counts(db, [scale.id])
    return _to_out(scale, usage.get(scale.id, 0))


@router.post("", response_model=ScaleOut, status_code=201)
async def create_scale(
    body: ScaleCreate,
    user: Annotated[User, Depends(require_roles(*SCALE_MANAGERS))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    reason: str = Query(..., min_length=5,
                        description="Governance justification for introducing this scale"),
):
    """Create a tenant-owned scale. Grades nothing until an assessment points at it.

    ``reason`` is mandatory, exactly as on ``POST /risk-matrices`` — the module
    this one mirrors. Without it a bank could introduce the yardstick its whole
    compliance position is measured on, and (with ``is_default``) make it the
    active one, with nothing in the trail saying on whose authority.
    """
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    levels = validate_levels(body.levels)

    scale = ComplianceScale(
        tenant_id=tenant_id, name=name, description=body.description,
        levels=levels, is_default=bool(body.is_default),
        is_builtin=False, is_active=True, created_by_id=user.id,
    )
    db.add(scale)
    await db.flush()
    if scale.is_default:
        await _clear_other_defaults(db, tenant_id, scale.id)
    await db.commit()
    await _log(db, tenant_id, user, scale, "create", reason,
               {"levels": [lvl["key"] for lvl in levels]})
    await db.refresh(scale)
    return _to_out(scale, 0)


async def _clear_other_defaults(db: AsyncSession, tenant_id: str, keep_id: str) -> None:
    """One default per tenant — the built-in default is not touched, it is the
    fallback for tenants that never defined one."""
    others = (await db.execute(
        select(ComplianceScale).where(
            ComplianceScale.tenant_id == tenant_id,
            ComplianceScale.is_default == True,   # noqa: E712
            ComplianceScale.id != keep_id,
        )
    )).scalars().all()
    for o in others:
        o.is_default = False


@router.patch("/{scale_id}", response_model=ScaleOut)
async def update_scale(
    scale_id: str,
    body: ScaleUpdate,
    user: Annotated[User, Depends(require_roles(*SCALE_MANAGERS))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    reason: str | None = Query(
        None, description="Required once the scale grades a live assessment, "
                          "and whenever this edit makes the scale the default"),
):
    """Edit a tenant-owned scale.

    Two guards, both about not destroying meaning already recorded:
    a level whose key is still carried by a ``control_assessments.status_key``
    cannot disappear, and any edit to a scale that grades live assessments has
    to carry a written reason — that edit re-scores them.
    """
    scale = await _get_scale(db, tenant_id, scale_id)
    _assert_editable(scale, tenant_id)

    usage = (await _usage_counts(db, [scale.id])).get(scale.id, 0)
    if usage and not (reason or "").strip():
        raise HTTPException(
            422,
            f"This scale grades {usage} assessment(s); changing it re-scores them. "
            "Provide `reason` so the governance decision is recorded.",
        )
    # Promoting a scale to default is the same governance act as
    # PUT /{scale_id}/default, which demands a reason; the PATCH must not be a
    # way around it.
    if body.is_default and not scale.is_default and not (reason or "").strip():
        raise HTTPException(
            422,
            "Making a scale the default is a governance decision. "
            "Provide `reason`, or use PUT /compliance-scales/{id}/default.",
        )

    changed: dict[str, Any] = {}
    if body.levels is not None:
        new_levels = validate_levels(body.levels)
        new_keys = {lvl["key"] for lvl in new_levels}
        used = set((await db.execute(
            select(ControlAssessment.status_key)
            .join(ComplianceAssessment, ComplianceAssessment.id == ControlAssessment.assessment_id)
            .where(ComplianceAssessment.scale_id == scale.id,
                   ControlAssessment.status_key.isnot(None))
            .distinct()
        )).scalars().all())
        orphaned = used - new_keys
        if orphaned:
            raise HTTPException(
                409,
                f"Level(s) {sorted(orphaned)} are still recorded on control assessments. "
                "Re-answer those controls before removing the level.",
            )
        scale.levels = new_levels
        changed["levels"] = sorted(new_keys)

    for field in ("name", "description", "is_active"):
        new = getattr(body, field)
        if new is not None and getattr(scale, field) != new:
            changed[field] = new
            setattr(scale, field, new)

    if body.is_default is not None and scale.is_default != body.is_default:
        scale.is_default = body.is_default
        changed["is_default"] = body.is_default
        if body.is_default:
            await _clear_other_defaults(db, tenant_id, scale.id)

    if not changed:
        return _to_out(scale, usage)
    await db.commit()
    await _log(db, tenant_id, user, scale, "update", reason, {"changed": changed, "assessments": usage})
    await db.refresh(scale)
    return _to_out(scale, usage)


@router.put("/{scale_id}/default", response_model=ScaleOut)
async def set_default_scale(
    scale_id: str,
    user: Annotated[User, Depends(require_roles(*SCALE_MANAGERS))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    reason: str = Query(..., min_length=5,
                        description="Governance justification — this becomes the yardstick for new assessments"),
):
    """Make a tenant-owned scale the one new assessments are graded on.

    ``reason`` is mandatory here, exactly as it is on
    ``PUT /risk-matrices/{id}/default``: this is the decision an auditor will ask
    about, and a timestamp alone does not answer them.
    """
    scale = await _get_scale(db, tenant_id, scale_id)
    _assert_editable(scale, tenant_id)
    if not scale.is_active:
        raise HTTPException(409, "A retired scale cannot be made the default")

    previous = (await db.execute(
        select(ComplianceScale.name).where(
            ComplianceScale.tenant_id == tenant_id,
            ComplianceScale.is_default == True,   # noqa: E712
            ComplianceScale.id != scale.id,
        ).limit(1)
    )).scalar_one_or_none()

    await _clear_other_defaults(db, tenant_id, scale.id)
    scale.is_default = True
    await db.commit()
    await _log(db, tenant_id, user, scale, "update", reason,
               {"became_default": True, "previous_default": previous})
    await db.refresh(scale)
    usage = (await _usage_counts(db, [scale.id])).get(scale.id, 0)
    return _to_out(scale, usage)


@router.delete("/{scale_id}", status_code=204)
async def delete_scale(
    scale_id: str,
    user: Annotated[User, Depends(require_roles(*SCALE_MANAGERS))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    reason: str = Query(..., min_length=5, description="Governance justification for withdrawing this scale"),
):
    """Delete a tenant-owned scale nothing is graded on. One in use is retired
    (``is_active=false``) instead — deleting it would strip the meaning from
    every ``status_key`` recorded against it."""
    scale = await _get_scale(db, tenant_id, scale_id)
    _assert_editable(scale, tenant_id)
    usage = (await _usage_counts(db, [scale.id])).get(scale.id, 0)
    if usage:
        raise HTTPException(
            409,
            f"{usage} assessment(s) are graded on this scale. "
            "Set is_active=false to retire it instead of deleting it.",
        )
    # Recorded before the delete: afterwards this entry is the only evidence the
    # scale existed and on whose authority it was withdrawn.
    await _log(db, tenant_id, user, scale, "delete", reason, {"levels": list(scale.levels or [])})
    await db.delete(scale)
    await db.commit()
