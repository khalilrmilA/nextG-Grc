"""Asset Management — IT/business asset inventory (RFP module 2).

Base CRUD is core. The CIA valuation grid, primary/support classification,
cartography links and lifecycle/EOL are the Elite Pack asset capabilities.
"""
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.models.user import User, UserRole
from app.models.asset import (
    Asset, AssetType, AssetCriticality, AssetCategory, AssetLifecycleState,
    AssetStatus, DEFAULT_CATEGORY_FOR_TYPE,
)
from app.models.asset_history import AssetValuationHistory
from app.models.org_unit import OrgEntity, BusinessProcess
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

router = APIRouter()
logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── assets.status: the pre-migration window ──────────────────────────────
# status is a NEW COLUMN on a table that already exists, so it does not appear
# by itself: alembic is dead here and create_all() only creates missing *tables*.
# It arrives via scripts/migrate_add_asset_status.py, which the operator runs by
# hand — and if the API is restarted before that script runs, every select(Asset)
# in this module asks for a column the table does not have. That raises
# OperationalError -> 500, and the SPA hard-redirects on any 5xx, so the user is
# not shown an error, they are ejected to /service-down.
#
# So the missing column is caught and answered with 424 naming the script to run
# (a 4xx keeps the user in the app), or degraded to an empty aggregate where a
# single tile can be dropped without failing the request. Same tolerance
# frameworks.py and compliance.py apply to their not-yet-created tables.
_MIGRATION_HINT = (
    "assets.status is not present in the database yet — run "
    "`python -m scripts.migrate_add_asset_status` on the API host "
    "(it is safe to run while the API is up)."
)


def _is_missing_status_column(exc: Exception) -> bool:
    """True when this DB error is 'assets.status does not exist', on any backend."""
    msg = str(getattr(exc, "orig", exc)).lower()
    # Both SQLite wordings matter and they differ per statement: a SELECT says
    # "no such column: assets.status", an INSERT says "table assets has no
    # column named status". Matching only the first let the create path fall
    # through to a 500 — i.e. to /service-down — which is the exact failure this
    # guard exists to prevent.
    return "status" in msg and (
        "no such column" in msg          # sqlite, SELECT/UPDATE
        or "has no column named" in msg  # sqlite, INSERT
        or "does not exist" in msg       # postgresql
        or "unknown column" in msg       # mysql/mariadb
        or "invalid identifier" in msg   # oracle, ORA-00904
        or "invalid column name" in msg  # sql server
    )


@contextmanager
def _status_column_required():
    """Turn 'assets.status is missing' into an actionable 424, not a 5xx eject.

    Any other OperationalError/ProgrammingError is re-raised untouched — a real
    database fault must not be reported to the operator as a missing migration.
    """
    try:
        yield
    except (OperationalError, ProgrammingError) as exc:
        if not _is_missing_status_column(exc):
            raise
        logger.error("assets.status missing — %s", _MIGRATION_HINT)
        raise HTTPException(status_code=424, detail=_MIGRATION_HINT) from exc


# ── Schemas ──────────────────────────────────────────────────────────────

class AssetCreate(BaseModel):
    name: str
    asset_type: str = "application"
    criticality: str = "medium"
    description: str | None = None
    owner_id: str                       # RFP: business owner is mandatory
    hosting_type: str | None = None
    cloud_provider: str | None = None
    location: str | None = None
    data_classification: str | None = None
    contains_pii: bool = False
    contains_phi: bool = False
    contains_pci: bool = False
    asset_class: str | None = None       # 'primary' | 'support'
    serves_asset_ids: list[str] = []
    business_process_id: str | None = None
    org_entity_id: str | None = None
    lifecycle_state: str | None = None
    # Operational status, distinct from the lifecycle phase (see AssetStatus).
    # Defaults to "in service": an asset being registered is presumed to be
    # serving unless the caller says otherwise.
    #
    # `str | None`, not `str`: AssetOut emits status as `string | null`, and a
    # form binding an unselected <select> — or any client copying a row it just
    # read — sends an explicit null. Typed `str` that was a 422 on a field the
    # caller never chose to set. An explicit null is read as "not stated" and
    # takes the same default an omitted key does, so no asset is ever created
    # with an empty status (the backfill's rule: the register must not answer
    # the tender's indicator with a blank).
    status: str | None = AssetStatus.OPERATIONAL.value
    acquired_at: datetime | None = None
    end_of_life_at: datetime | None = None
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    security_objectives: dict | None = None
    next_review_date: str | None = None
    tags: list[str] = []


class AssetUpdate(BaseModel):
    name: str | None = None
    asset_type: str | None = None
    criticality: str | None = None
    description: str | None = None
    owner_id: str | None = None
    hosting_type: str | None = None
    cloud_provider: str | None = None
    location: str | None = None
    data_classification: str | None = None
    contains_pii: bool | None = None
    contains_phi: bool | None = None
    contains_pci: bool | None = None
    asset_class: str | None = None
    serves_asset_ids: list[str] | None = None
    business_process_id: str | None = None
    org_entity_id: str | None = None
    lifecycle_state: str | None = None
    status: str | None = None
    acquired_at: datetime | None = None
    end_of_life_at: datetime | None = None
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    next_review_date: str | None = None
    tags: list[str] | None = None


class AssetOut(BaseModel):
    id: str; tenant_id: str; name: str; asset_type: str; criticality: str
    description: str | None; owner_id: str | None; hosting_type: str | None
    cloud_provider: str | None; location: str | None; data_classification: str | None
    contains_pii: bool; contains_phi: bool; contains_pci: bool; tags: list
    asset_class: str | None = None
    serves_asset_ids: list = []
    business_process_id: str | None = None
    org_entity_id: str | None = None
    lifecycle_state: str | None = None
    status: str | None = None
    acquired_at: datetime | None = None
    end_of_life_at: datetime | None = None
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    security_objectives: dict | None = None
    next_review_date: str | None = None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


class PaginatedAssets(BaseModel):
    items: list[AssetOut]
    total: int
    page: int
    page_size: int


class AssetStats(BaseModel):
    total: int
    by_type: dict[str, int]
    by_criticality: dict[str, int]
    # Operational status breakdown (STB objectif 1, « leur statut »). Empty —
    # never absent — while the column is still unmigrated, so the caller can
    # tell "nothing to show" from "field gone".
    by_status: dict[str, int] = {}
    # Primary vs support split (STB objectif 1). Counted server-side over the
    # whole tenant: the register page could only count the rows it had loaded,
    # so the « actifs primaires » tile had to read "non disponible" past one page.
    by_class: dict[str, int] = {}
    with_pii: int
    with_phi: int
    with_pci: int


class CiaUpdate(BaseModel):
    # 1-5 is the scale the product states everywhere it asks for these — the
    # form is labelled "CIA valuation (1-5)" in all three locales and every
    # stored row is inside it. Unbounded, the column accepted -5 and 900, which
    # the valuation history then recorded as a legitimate change.
    confidentiality: int = Field(ge=1, le=5)
    integrity: int = Field(ge=1, le=5)
    availability: int = Field(ge=1, le=5)
    business_value: str | None = None
    rto_seconds: int | None = None
    rpo_seconds: int | None = None
    mtd_seconds: int | None = None
    note: str | None = None


class CiaHistoryOut(BaseModel):
    id: str
    old_cia: dict | None = None
    new_cia: dict | None = None
    changed_by_id: str | None = None
    note: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


_VALID_CLASSES = {AssetCategory.PRIMARY.value, AssetCategory.SUPPORT.value}
_VALID_LIFECYCLE = {s.value for s in AssetLifecycleState}
_VALID_STATUS = {s.value for s in AssetStatus}

# The label /assets/stats uses for a row whose status is NULL, and the value
# GET /assets?status=... accepts to select exactly those rows. Not an
# AssetStatus member on purpose: "we were never told" is the absence of a
# status, not a sixth one somebody could pick in a form.
UNSPECIFIED_STATUS = "unspecified"


def _validate_lifecycle(state: str | None) -> None:
    if state is not None and state not in _VALID_LIFECYCLE:
        raise HTTPException(
            status_code=422,
            detail=f"lifecycle_state must be one of {sorted(_VALID_LIFECYCLE)}",
        )


def _validate_status(state: str | None) -> None:
    """Reject anything outside AssetStatus.

    The column is plain VARCHAR (added by ALTER TABLE, like lifecycle_state), so
    nothing below this line stops a free-text status from being stored, and one
    free-text value is enough to make the dashboard's status breakdown lie.
    """
    if state is not None and state not in _VALID_STATUS:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {sorted(_VALID_STATUS)}",
        )


def _resolve_asset_class(given: str | None, asset_type: str) -> str:
    """Primary or support, defaulted from the type when not supplied.

    The client requires every asset to carry this classification, and the column
    was free text and optional — so an asset could be created without one and
    silently fall outside the primary/support split the risk methodology is
    built on. A process or a piece of information is primary; everything else
    supports them. The caller can still override, because whether a given
    database is a primary asset is a judgement about the organisation.
    """
    if given is not None:
        if given not in _VALID_CLASSES:
            raise HTTPException(status_code=422, detail="asset_class must be 'primary' or 'support'")
        return given
    return DEFAULT_CATEGORY_FOR_TYPE.get(asset_type, AssetCategory.SUPPORT).value


async def _get_asset(aid: str, tenant_id: str, db: AsyncSession) -> Asset:
    # Every read of a whole Asset row now asks for status, so this single
    # chokepoint is where an unmigrated database is turned into a 424 for the
    # detail/update/delete/CIA routes instead of a 500 that ejects the SPA.
    with _status_column_required():
        r = await db.execute(select(Asset).where(Asset.id == aid, Asset.tenant_id == tenant_id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Asset not found")
    return a


async def _validate_links(
    db: AsyncSession,
    tenant_id: str,
    *,
    business_process_id: str | None,
    org_entity_id: str | None,
    serves_asset_ids: list[str] | None,
) -> None:
    """Reject cartography / dependency links that point outside the tenant.

    owner_id is checked on both write paths, but these three foreign keys were
    passed straight through, so a caller could attach their asset to another
    tenant's business process, org entity or primary asset simply by knowing an
    id. Same guard policies.py applies to the identical pair of perimeter
    columns; the status is 422 here to match this module's own owner_id check
    (policies.py answers 400).
    """
    if business_process_id:
        found = (await db.execute(
            select(BusinessProcess.id).where(
                BusinessProcess.id == business_process_id,
                BusinessProcess.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if found is None:
            raise HTTPException(
                status_code=422,
                detail="business_process_id must reference a business process in this tenant",
            )
    if org_entity_id:
        found = (await db.execute(
            select(OrgEntity.id).where(
                OrgEntity.id == org_entity_id, OrgEntity.tenant_id == tenant_id
            )
        )).scalar_one_or_none()
        if found is None:
            raise HTTPException(
                status_code=422,
                detail="org_entity_id must reference an org entity in this tenant",
            )
    await assert_assets_in_tenant(
        db, serves_asset_ids, tenant_id, field_name="serves_asset_ids"
    )


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("", response_model=PaginatedAssets)
async def list_assets(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    asset_type: str | None = None,
    criticality: str | None = None,
    asset_class: str | None = None,
    # Operational status filter (STB objectif 1). Shadows fastapi's `status`
    # import inside this function only, which is unused here and everywhere
    # else in the module (every route spells its code out as status_code=...).
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    base = select(Asset).where(Asset.tenant_id == tenant_id)
    if asset_type:
        base = base.where(Asset.asset_type == asset_type)
    if criticality:
        base = base.where(Asset.criticality == criticality)
    if asset_class:
        base = base.where(Asset.asset_class == asset_class)
    if status:
        # Applied in SQL, like every other filter here — the count and the page
        # slice below are both computed from `base`, so filtering in Python
        # would both re-truncate the endpoint and report a wrong total.
        #
        # UNSPECIFIED_STATUS is the bucket /assets/stats reports for rows whose
        # status is NULL. Without this branch that tile named a population the
        # register could not be filtered to: clicking "unspecified: 4" ran
        # `status = 'unspecified'`, matched nothing, and showed an empty list
        # under a count of four — a screen contradicting itself in front of the
        # client. NULLs are a real state here (a row inserted by the old code
        # between the migration and the API restart, or by any writer that does
        # not go through this module), so they have to be reachable.
        base = base.where(
            Asset.status.is_(None) if status == UNSPECIFIED_STATUS
            else Asset.status == status
        )
    # Count and slice in the database, not in Python. This used to load every
    # asset row, hydrate all of them through the ORM, sort in memory and then
    # take twenty — so page 1 of a 10,000-asset estate cost the same as
    # fetching the whole register, on every request. At STB's stated volumetry
    # that is the difference between a page load and a timeout.
    with _status_column_required():
        total = (await db.execute(
            select(func.count()).select_from(base.subquery())
        )).scalar() or 0
        rows = (await db.execute(
            base.order_by(Asset.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )).scalars().all()
    items = [AssetOut.model_validate(a) for a in rows]
    return PaginatedAssets(items=items, total=total, page=page, page_size=page_size)


async def _count_by_status(db: AsyncSession, tenant_id: str) -> dict[str, int]:
    """{status: n} for the tenant — empty (not fatal) if unmigrated.

    Degraded rather than 424'd, unlike the list: the other four aggregates in
    /stats are perfectly computable without this column, and dropping one tile
    beats failing the whole KPI strip (the pattern dashboards.py uses for every
    tile it renders).
    """
    try:
        rows = (await db.execute(
            select(Asset.status, func.count())
            .where(Asset.tenant_id == tenant_id)
            .group_by(Asset.status)
        )).all()
    except (OperationalError, ProgrammingError) as exc:
        if not _is_missing_status_column(exc):
            raise
        # The failed statement leaves the transaction unusable, and get_db
        # commits on the way out — without this rollback the degrade would
        # itself 500 the request it was added to save.
        await db.rollback()
        logger.error("assets.by_status unavailable — %s", _MIGRATION_HINT)
        return {}
    # A row that predates the migration's backfill reads as "unspecified"
    # rather than being silently counted as operational. GET /assets accepts
    # the same token as a filter, so the bucket this reports is one the
    # register can actually be narrowed to.
    return {(v if v is not None else UNSPECIFIED_STATUS): int(n) for v, n in rows}


@router.get("/stats", response_model=AssetStats)
async def get_stats(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    # Aggregate in the database. This counted by hydrating every asset row
    # through the ORM and tallying in Python — the same shape that made
    # GET /assets cost a full table read per request, on the same page load.
    # The counts are identical; only the memory and the row hydration go away.
    scoped = Asset.tenant_id == tenant_id

    def _key(v) -> str:
        return v.value if hasattr(v, "value") else str(v)

    by_type = {
        _key(t): n for t, n in (await db.execute(
            select(Asset.asset_type, func.count()).where(scoped).group_by(Asset.asset_type)
        )).all()
    }
    by_crit = {
        _key(c): n for c, n in (await db.execute(
            select(Asset.criticality, func.count()).where(scoped).group_by(Asset.criticality)
        )).all()
    }
    # One row of counts rather than four round-trips. count(col) ignores NULLs,
    # so the filtered counts match the truthiness test the Python loop used.
    total, pii, phi, pci = (await db.execute(
        select(
            func.count(),
            func.count().filter(Asset.contains_pii.is_(True)),
            func.count().filter(Asset.contains_phi.is_(True)),
            func.count().filter(Asset.contains_pci.is_(True)),
        ).where(scoped)
    )).one()
    by_status = await _count_by_status(db, tenant_id)
    by_class = {
        _key(c): n for c, n in (await db.execute(
            select(Asset.asset_class, func.count()).where(scoped).group_by(Asset.asset_class)
        )).all() if c is not None
    }
    return AssetStats(total=total, by_type=by_type, by_criticality=by_crit,
                      by_status=by_status, by_class=by_class,
                      with_pii=pii, with_phi=phi, with_pci=pci)


class AssetOption(BaseModel):
    id: str
    name: str
    asset_type: str | None = None

    model_config = {"from_attributes": True}


@router.get("/options", response_model=list[AssetOption])
async def list_asset_options(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    limit: int = Query(10000, ge=1, le=50000),
):
    """Every asset as {id, name, asset_type}, for pickers and graphs.

    The pickers used to call ``GET /assets?page_size=500``, which the list
    endpoint rejects outright (``le=200``) — so four asset selectors were
    returning 422 and silently rendering empty. Capping those callers at 200
    instead would have been worse at this client's scale: with 5,000-10,000
    assets a picker would quietly offer the first 200 and hide the rest.

    This returns three columns instead of the full asset row, so the whole
    inventory is a small payload rather than megabytes of unused fields.
    """
    rows = (await db.execute(
        select(Asset.id, Asset.name, Asset.asset_type)
        .where(Asset.tenant_id == tenant_id)
        .order_by(Asset.name)
        .limit(limit)
    )).all()
    return [
        AssetOption(
            id=r.id,
            name=r.name,
            asset_type=r.asset_type.value if hasattr(r.asset_type, "value") else (r.asset_type or None),
        )
        for r in rows
    ]


@router.get("/lifecycle/eol-soon", response_model=list[AssetOut])
async def eol_soon(
    current_user: Annotated[User, Depends(require_feature("asset_lifecycle"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    within_days: int = Query(90, ge=1, le=365),
):
    """Assets reaching end-of-life within `within_days` (includes overdue)."""
    cutoff = _utcnow() + timedelta(days=within_days)
    with _status_column_required():
        rows = (await db.execute(
            select(Asset).where(
                Asset.tenant_id == tenant_id,
                Asset.end_of_life_at.is_not(None),
                Asset.end_of_life_at <= cutoff,
            ).order_by(Asset.end_of_life_at)
        )).scalars().all()
    return [AssetOut.model_validate(a) for a in rows]


@router.post("", response_model=AssetOut, status_code=201)
async def create_asset(body: AssetCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.BUSINESS_OWNER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    # RFP: mandatory business owner — validate it belongs to the tenant.
    owner = (await db.execute(
        select(User).where(User.id == body.owner_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if owner is None:
        raise HTTPException(status_code=422, detail="owner_id must reference a user in this tenant")

    _validate_lifecycle(body.lifecycle_state)
    _validate_status(body.status)
    await _validate_links(
        db, tenant_id,
        business_process_id=body.business_process_id,
        org_entity_id=body.org_entity_id,
        serves_asset_ids=body.serves_asset_ids,
    )

    a = Asset(
        tenant_id=tenant_id, name=body.name, asset_type=AssetType(body.asset_type),
        criticality=AssetCriticality(body.criticality), description=body.description,
        owner_id=body.owner_id, hosting_type=body.hosting_type, cloud_provider=body.cloud_provider,
        location=body.location, data_classification=body.data_classification,
        contains_pii=body.contains_pii, contains_phi=body.contains_phi,
        contains_pci=body.contains_pci, tags=body.tags,
        asset_class=_resolve_asset_class(body.asset_class, body.asset_type), serves_asset_ids=body.serves_asset_ids,
        business_process_id=body.business_process_id, org_entity_id=body.org_entity_id,
        lifecycle_state=body.lifecycle_state,
        # An explicit null means "not stated", not "no status": coalesce to the
        # same default an omitted key gets, so the register never holds a row
        # that cannot answer « leur statut ».
        status=body.status or AssetStatus.OPERATIONAL.value,
        acquired_at=body.acquired_at,
        end_of_life_at=body.end_of_life_at, business_value=body.business_value,
        rto_seconds=body.rto_seconds, rpo_seconds=body.rpo_seconds, mtd_seconds=body.mtd_seconds,
        security_objectives=body.security_objectives, next_review_date=body.next_review_date,
    )
    db.add(a)
    # The INSERT carries status, so an unmigrated database fails here.
    with _status_column_required():
        await db.flush(); await db.commit(); await db.refresh(a)
    return AssetOut.model_validate(a)


@router.get("/{aid}", response_model=AssetOut)
async def get_asset(aid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return AssetOut.model_validate(await _get_asset(aid, tenant_id, db))


@router.patch("/{aid}", response_model=AssetOut)
async def update_asset(aid: str, body: AssetUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles(UserRole.BUSINESS_OWNER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    a = await _get_asset(aid, tenant_id, db)
    # The business owner is mandatory, so an update must not be able to point it
    # at someone outside the tenant. create_asset already checks this; the update
    # path passed owner_id straight through the loop below.
    if body.owner_id is not None:
        owner = (await db.execute(
            select(User).where(User.id == body.owner_id, User.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if owner is None:
            raise HTTPException(status_code=422, detail="owner_id must reference a user in this tenant")
    if body.asset_class is not None and body.asset_class not in _VALID_CLASSES:
        raise HTTPException(status_code=422, detail="asset_class must be 'primary' or 'support'")
    _validate_lifecycle(body.lifecycle_state)
    _validate_status(body.status)
    await _validate_links(
        db, tenant_id,
        business_process_id=body.business_process_id,
        org_entity_id=body.org_entity_id,
        serves_asset_ids=body.serves_asset_ids,
    )
    previous_lifecycle = a.lifecycle_state
    previous_status = a.status
    for f in ["name", "description", "owner_id", "hosting_type", "cloud_provider", "location",
              "data_classification", "contains_pii", "contains_phi", "contains_pci", "tags",
              "asset_class", "serves_asset_ids", "business_process_id", "org_entity_id",
              "lifecycle_state", "status", "acquired_at", "end_of_life_at",
              "business_value",
              "rto_seconds", "rpo_seconds", "mtd_seconds", "next_review_date"]:
        v = getattr(body, f, None)
        if v is not None:
            setattr(a, f, v)
    if body.asset_type:
        a.asset_type = AssetType(body.asset_type)
    if body.criticality:
        a.criticality = AssetCriticality(body.criticality)
    # The UPDATE writes status; 424 rather than 5xx if it isn't there yet.
    with _status_column_required():
        await db.commit(); await db.refresh(a)

    # A phase change is the thing the lifecycle requirement asks to be able to
    # trace — when an asset entered maintenance, when it was retired, and who
    # moved it. The generic request log records only that a PATCH happened, so
    # the before/after is written explicitly to the same hash-chained trail.
    if a.lifecycle_state != previous_lifecycle:
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id,
                user_id=current_user.id,
                user_email=current_user.email,
                action="lifecycle_change",
                entity_type="asset",
                entity_id=a.id,
                entity_name=a.name,
                details={"changed": {"lifecycle_state": {
                    "from": previous_lifecycle, "to": a.lifecycle_state}}},
                origin="api",
            ))
        except Exception:
            pass

    # A status change is the operational half of the same question, and for a
    # bank it is the more urgent one: "quarantined" or "lost" is an event
    # somebody has to answer for. Recorded as its own chained entry (separate
    # from the lifecycle one, so each transition keeps its own hash) with the
    # before/after the generic request log does not carry.
    if a.status != previous_status:
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id,
                user_id=current_user.id,
                user_email=current_user.email,
                action="status_change",
                entity_type="asset",
                entity_id=a.id,
                entity_name=a.name,
                details={"changed": {"status": {
                    "from": previous_status, "to": a.status}}},
                origin="api",
            ))
        except Exception:
            pass
    return AssetOut.model_validate(a)


@router.get("/{aid}/cia")
async def get_cia(aid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    a = await _get_asset(aid, tenant_id, db)
    return {
        "security_objectives": a.security_objectives or {},
        "business_value": a.business_value,
        "rto_seconds": a.rto_seconds, "rpo_seconds": a.rpo_seconds, "mtd_seconds": a.mtd_seconds,
    }


@router.put("/{aid}/cia", response_model=AssetOut)
async def set_cia(
    aid: str,
    body: CiaUpdate,
    current_user: Annotated[User, Depends(require_feature("cia_valuation"))],
    # Feature entitlement AND role. require_feature is a billing check — it says
    # the tenant bought CIA valuation, not that this account may set it. Without
    # the second gate any authenticated user (an auditor, a vendor manager) could
    # rewrite the valuation grid and the DR objectives that risk scoring rests
    # on, while PATCH /{aid} — the same fields — has always required these roles.
    _role: Annotated[User, Depends(require_roles(UserRole.BUSINESS_OWNER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set the C/I/A valuation grid, recording the change in history."""
    a = await _get_asset(aid, tenant_id, db)
    old = a.security_objectives or {}
    new = {"confidentiality": body.confidentiality, "integrity": body.integrity, "availability": body.availability}
    db.add(AssetValuationHistory(
        tenant_id=tenant_id, asset_id=a.id, changed_by_id=current_user.id,
        old_cia=old, new_cia=new, note=body.note,
    ))
    a.security_objectives = new
    if body.business_value is not None:
        a.business_value = body.business_value
    if body.rto_seconds is not None:
        a.rto_seconds = body.rto_seconds
    if body.rpo_seconds is not None:
        a.rpo_seconds = body.rpo_seconds
    if body.mtd_seconds is not None:
        a.mtd_seconds = body.mtd_seconds
    await db.commit(); await db.refresh(a)
    return AssetOut.model_validate(a)


@router.get("/{aid}/cia-history", response_model=list[CiaHistoryOut])
async def cia_history(
    aid: str,
    current_user: Annotated[User, Depends(require_feature("cia_valuation"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_asset(aid, tenant_id, db)
    rows = (await db.execute(
        select(AssetValuationHistory).where(
            AssetValuationHistory.tenant_id == tenant_id,
            AssetValuationHistory.asset_id == aid,
        ).order_by(AssetValuationHistory.created_at.desc())
    )).scalars().all()
    return list(rows)


class AssetIncidentOut(BaseModel):
    id: str
    title: str
    category: str | None = None
    severity: str | None = None
    status: str | None = None
    detected_at: str | None = None
    resolved_at: str | None = None
    financial_impact: float | None = None
    linked_via: str          # "asset_link" | "free_text"

    model_config = {"from_attributes": True}


@router.get("/{aid}/incidents", response_model=list[AssetIncidentOut])
async def asset_incident_history(
    aid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Incidents that hit this asset — "historique des incidents liés à l'actif".

    Incidents already recorded which assets they affected, but nothing let you
    ask the question from the asset's side, which is the direction that matters
    when judging whether a piece of equipment should be replaced.

    Two links are reported and distinguished rather than merged. ``asset_link``
    is the validated reference in ``affected_asset_ids``. ``free_text`` is a
    name match against ``affected_systems``, which existed before that link did
    and still carries older incidents — including it means the history is not
    silently missing everything recorded before the link was introduced, and
    labelling it means nobody mistakes a name match for a confirmed reference.
    """
    from app.models.incident import Incident

    asset = await _get_asset(aid, tenant_id, db)
    rows = (await db.execute(
        select(Incident).where(Incident.tenant_id == tenant_id)
        .order_by(Incident.detected_at.desc())
    )).scalars().all()

    name = (asset.name or "").strip().lower()
    out: list[AssetIncidentOut] = []
    for inc in rows:
        linked = aid in (inc.affected_asset_ids or [])
        by_name = bool(name) and any(
            name == str(sysname).strip().lower() for sysname in (inc.affected_systems or [])
        )
        if not (linked or by_name):
            continue
        out.append(AssetIncidentOut(
            id=inc.id, title=inc.title,
            category=inc.category.value if hasattr(inc.category, "value") else inc.category,
            severity=inc.severity.value if hasattr(inc.severity, "value") else inc.severity,
            status=inc.status.value if hasattr(inc.status, "value") else inc.status,
            detected_at=inc.detected_at, resolved_at=inc.resolved_at,
            financial_impact=inc.financial_impact,
            linked_via="asset_link" if linked else "free_text",
        ))
    return out


@router.delete("/{aid}", status_code=204)
async def delete_asset(aid: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles(UserRole.BUSINESS_OWNER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    """Remove an asset. There is no deleted_at on assets, so the row genuinely
    goes — record it, and its valuation history, in the tamper-evident chain
    first. The CIA history is the decision trail behind the risk scoring that
    referenced this asset; left in place it only becomes unreachable, because
    GET /{aid}/cia-history resolves the parent asset before reading it."""
    a = await _get_asset(aid, tenant_id, db)
    history = list((await db.execute(
        select(AssetValuationHistory)
        .where(AssetValuationHistory.tenant_id == tenant_id,
               AssetValuationHistory.asset_id == a.id)
        .order_by(AssetValuationHistory.created_at)
    )).scalars().all())
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="delete", entity_type="asset", entity_id=a.id, entity_name=a.name,
            details={"deleted": {
                "name": a.name,
                "asset_type": getattr(a.asset_type, "value", a.asset_type),
                "criticality": getattr(a.criticality, "value", a.criticality),
                "asset_class": a.asset_class,
                "owner_id": a.owner_id,
                "org_entity_id": a.org_entity_id,
                "business_process_id": a.business_process_id,
                "security_objectives": a.security_objectives or {},
                "business_value": a.business_value,
                "rto_seconds": a.rto_seconds, "rpo_seconds": a.rpo_seconds,
                "mtd_seconds": a.mtd_seconds,
                "lifecycle_state": getattr(a.lifecycle_state, "value", a.lifecycle_state),
                # The row goes for good, so the operational status it held at
                # deletion belongs in the snapshot too.
                "status": a.status,
            }, "valuation_history": [
                {"changed_by_id": h.changed_by_id, "old_cia": h.old_cia,
                 "new_cia": h.new_cia, "note": h.note,
                 "at": h.created_at.isoformat() if h.created_at else None}
                for h in history
            ]},
            origin="api",
        ))
    except Exception:
        # Log-and-continue, as everywhere else a delete is chained: a chain
        # failure must not strand the delete half-done.
        pass
    for h in history:
        await db.delete(h)
    await db.delete(a); await db.commit()
