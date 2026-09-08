"""Asset cartography + organisation model (Elite Pack — RFP module 2).

Delivers the tenant-scoped organisation backbone (org entities + business
processes) and the asset cartography graph that links IT/business assets to the
business processes and org entities they support.

Every route is gated behind ``require_feature("asset_cartography")`` — the gate
returns the authenticated ``User`` and answers 402 when the tenant's plan does
not include the Elite Pack feature. That gate is a billing check, so every
*write* additionally carries a role gate (``_WRITE_GATE`` below). Tenant
isolation is enforced on every query via ``get_tenant_id``.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant, assert_user_in_tenant
from app.api.v1.dependencies.auth import get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.models.user import User, UserRole
from app.models.asset import Asset
from app.models.org_unit import OrgEntity, BusinessProcess

router = APIRouter()

_FEATURE = "asset_cartography"

# Feature entitlement AND role on every write. require_feature is a billing
# check: it answers "did this tenant buy the Elite Pack?", never "may this
# account edit the organisation chart?". On its own it left every authenticated
# user of an Elite tenant — an auditor, a vendor manager — able to rename or
# delete the org entities and business processes that compliance assessments,
# policies and control applicability are all scoped to. These are the same two
# roles that gate asset writes in endpoints/assets.py; tenant_admin and
# super_admin auto-pass inside require_roles(), as everywhere else.
_WRITE_GATE = require_roles(UserRole.BUSINESS_OWNER, UserRole.CISO)


# -- Schemas ---------------------------------------------------------------

class OrgEntityCreate(BaseModel):
    name: str
    parent_id: str | None = None
    entity_type: str | None = None
    description: str | None = None
    owner_id: str | None = None


class OrgEntityUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    entity_type: str | None = None
    description: str | None = None
    owner_id: str | None = None


class OrgEntityOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    parent_id: str | None
    entity_type: str | None
    description: str | None
    owner_id: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class BusinessProcessCreate(BaseModel):
    name: str
    description: str | None = None
    criticality: str | None = None
    owner_id: str | None = None
    entity_id: str | None = None
    asset_ids: list[str] = []


class BusinessProcessUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    criticality: str | None = None
    owner_id: str | None = None
    entity_id: str | None = None
    asset_ids: list[str] | None = None


class BusinessProcessOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    description: str | None
    criticality: str | None
    owner_id: str | None
    entity_id: str | None
    asset_ids: list
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class GraphNode(BaseModel):
    id: str
    label: str
    type: str  # "entity" | "process" | "asset"


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: str  # "belongs_to" | "operated_by" | "depends_on" | "owned_by"


class CartographyGraph(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: dict[str, int]


# -- Helpers ---------------------------------------------------------------

async def _get_entity(db: AsyncSession, tenant_id: str, eid: str) -> OrgEntity:
    r = await db.execute(
        select(OrgEntity).where(OrgEntity.id == eid, OrgEntity.tenant_id == tenant_id)
    )
    e = r.scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Org entity not found")
    return e


async def _get_process(db: AsyncSession, tenant_id: str, pid: str) -> BusinessProcess:
    r = await db.execute(
        select(BusinessProcess).where(
            BusinessProcess.id == pid, BusinessProcess.tenant_id == tenant_id
        )
    )
    p = r.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Business process not found")
    return p


async def _assert_no_parent_cycle(db: AsyncSession, tenant_id: str, eid: str, parent_id: str) -> None:
    """Refuse a reparent that would close a loop (A -> B -> A).

    Self-parenting was already refused, but a longer cycle was not, and an
    org chart that eats its own tail has no root: get_cartography's subtree
    filter survives it only because of a visited set, and every future
    consumer (a hierarchy export, a perimeter roll-up) would have to carry
    the same defence or hang.
    """
    seen = {eid}
    cur: str | None = parent_id
    while cur:
        if cur in seen:
            raise HTTPException(400, "That parent would create a cycle in the org chart")
        seen.add(cur)
        cur = (await db.execute(
            select(OrgEntity.parent_id).where(
                OrgEntity.id == cur, OrgEntity.tenant_id == tenant_id
            )
        )).scalar_one_or_none()


# -- Org entities ----------------------------------------------------------

@router.get("/org-entities", response_model=list[OrgEntityOut])
async def list_org_entities(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    tenant_id: str = Depends(get_tenant_id),
):
    q = select(OrgEntity).where(OrgEntity.tenant_id == tenant_id).order_by(OrgEntity.created_at.desc())
    return [OrgEntityOut.model_validate(e) for e in (await db.execute(q)).scalars().all()]


@router.post("/org-entities", response_model=OrgEntityOut, status_code=201)
async def create_org_entity(
    body: OrgEntityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    _: User = Depends(_WRITE_GATE),
    tenant_id: str = Depends(get_tenant_id),
):
    if body.parent_id:
        await _get_entity(db, tenant_id, body.parent_id)  # validate parent belongs to tenant
    # parent_id was validated, owner_id was not — so the head of a department
    # could be set to a user id from another tenant.
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    e = OrgEntity(
        tenant_id=tenant_id,
        name=body.name,
        parent_id=body.parent_id,
        entity_type=body.entity_type,
        description=body.description,
        owner_id=body.owner_id,
    )
    db.add(e)
    await db.flush()
    await db.commit()
    await db.refresh(e)
    return OrgEntityOut.model_validate(e)


@router.get("/org-entities/{eid}", response_model=OrgEntityOut)
async def get_org_entity(
    eid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    tenant_id: str = Depends(get_tenant_id),
):
    return OrgEntityOut.model_validate(await _get_entity(db, tenant_id, eid))


@router.patch("/org-entities/{eid}", response_model=OrgEntityOut)
async def update_org_entity(
    eid: str,
    body: OrgEntityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    _: User = Depends(_WRITE_GATE),
    tenant_id: str = Depends(get_tenant_id),
):
    e = await _get_entity(db, tenant_id, eid)
    if body.parent_id is not None:
        if body.parent_id == eid:
            raise HTTPException(400, "An org entity cannot be its own parent")
        if body.parent_id:
            await _get_entity(db, tenant_id, body.parent_id)
            await _assert_no_parent_cycle(db, tenant_id, eid, body.parent_id)
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    for f in ["name", "parent_id", "entity_type", "description", "owner_id"]:
        v = getattr(body, f, None)
        if v is not None:
            setattr(e, f, v)
    await db.commit()
    await db.refresh(e)
    return OrgEntityOut.model_validate(e)


@router.delete("/org-entities/{eid}", status_code=204)
async def delete_org_entity(
    eid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    _: User = Depends(_WRITE_GATE),
    tenant_id: str = Depends(get_tenant_id),
):
    e = await _get_entity(db, tenant_id, eid)
    # Detach children and processes so no rows dangle against a deleted entity.
    for child in (await db.execute(
        select(OrgEntity).where(OrgEntity.tenant_id == tenant_id, OrgEntity.parent_id == eid)
    )).scalars().all():
        child.parent_id = None
    for proc in (await db.execute(
        select(BusinessProcess).where(
            BusinessProcess.tenant_id == tenant_id, BusinessProcess.entity_id == eid
        )
    )).scalars().all():
        proc.entity_id = None
    # Assets carry the same link (Asset.org_entity_id) and were the one
    # referencing table this detach missed, so an asset kept pointing at an
    # entity that no longer existed.
    await db.execute(
        update(Asset)
        .where(Asset.tenant_id == tenant_id, Asset.org_entity_id == eid)
        .values(org_entity_id=None)
    )
    await db.delete(e)
    await db.commit()


# -- Business processes -----------------------------------------------------

@router.get("/business-processes", response_model=list[BusinessProcessOut])
async def list_business_processes(
    entity_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    tenant_id: str = Depends(get_tenant_id),
):
    q = select(BusinessProcess).where(BusinessProcess.tenant_id == tenant_id)
    if entity_id:
        q = q.where(BusinessProcess.entity_id == entity_id)
    q = q.order_by(BusinessProcess.created_at.desc())
    return [BusinessProcessOut.model_validate(p) for p in (await db.execute(q)).scalars().all()]


@router.post("/business-processes", response_model=BusinessProcessOut, status_code=201)
async def create_business_process(
    body: BusinessProcessCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    _: User = Depends(_WRITE_GATE),
    tenant_id: str = Depends(get_tenant_id),
):
    if body.entity_id:
        await _get_entity(db, tenant_id, body.entity_id)  # validate entity belongs to tenant
    # entity_id was validated; the process owner and the assets it depends on
    # were not, so either could be pointed at another tenant's row by id.
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    await assert_assets_in_tenant(db, body.asset_ids, tenant_id, field_name="asset_ids")
    p = BusinessProcess(
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        criticality=body.criticality,
        owner_id=body.owner_id,
        entity_id=body.entity_id,
        asset_ids=body.asset_ids or [],
    )
    db.add(p)
    await db.flush()
    await db.commit()
    await db.refresh(p)
    return BusinessProcessOut.model_validate(p)


@router.get("/business-processes/{pid}", response_model=BusinessProcessOut)
async def get_business_process(
    pid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    tenant_id: str = Depends(get_tenant_id),
):
    return BusinessProcessOut.model_validate(await _get_process(db, tenant_id, pid))


@router.patch("/business-processes/{pid}", response_model=BusinessProcessOut)
async def update_business_process(
    pid: str,
    body: BusinessProcessUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    _: User = Depends(_WRITE_GATE),
    tenant_id: str = Depends(get_tenant_id),
):
    p = await _get_process(db, tenant_id, pid)
    if body.entity_id:
        await _get_entity(db, tenant_id, body.entity_id)
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    await assert_assets_in_tenant(db, body.asset_ids, tenant_id, field_name="asset_ids")
    for f in ["name", "description", "criticality", "owner_id", "entity_id", "asset_ids"]:
        v = getattr(body, f, None)
        if v is not None:
            setattr(p, f, v)
    await db.commit()
    await db.refresh(p)
    return BusinessProcessOut.model_validate(p)


@router.delete("/business-processes/{pid}", status_code=204)
async def delete_business_process(
    pid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    _: User = Depends(_WRITE_GATE),
    tenant_id: str = Depends(get_tenant_id),
):
    p = await _get_process(db, tenant_id, pid)
    # Same rule as delete_org_entity: nothing should keep a link to a row that
    # is about to disappear. Asset.business_process_id has no cascade.
    await db.execute(
        update(Asset)
        .where(Asset.tenant_id == tenant_id, Asset.business_process_id == pid)
        .values(business_process_id=None)
    )
    await db.delete(p)
    await db.commit()


# -- Cartography graph ------------------------------------------------------

@router.get("/cartography", response_model=CartographyGraph)
async def get_cartography(
    entity: str | None = None,
    asset_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_feature(_FEATURE)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Return the asset cartography graph for the tenant.

    Nodes: org entities, business processes, and assets.
    Edges:
      * entity   -> parent entity  (kind="belongs_to")
      * process  -> org entity      (kind="operated_by")
      * process  -> asset           (kind="depends_on", from BusinessProcess.asset_ids
                                     and from Asset.business_process_id)
      * asset    -> org entity      (kind="belongs_to", from Asset.org_entity_id)
      * asset    -> process         (kind="owned_by", inferred when they share owner_id)

    Optional filters:
      * ``entity``     — restrict to an org entity and its descendant subtree
                          (plus the processes/assets connected to it).
      * ``asset_type`` — restrict asset nodes to a single Asset type.
    """
    entities = list((await db.execute(
        select(OrgEntity).where(OrgEntity.tenant_id == tenant_id)
    )).scalars().all())
    processes = list((await db.execute(
        select(BusinessProcess).where(BusinessProcess.tenant_id == tenant_id)
    )).scalars().all())

    asset_q = select(Asset).where(Asset.tenant_id == tenant_id)
    if asset_type:
        asset_q = asset_q.where(Asset.asset_type == asset_type)
    assets = list((await db.execute(asset_q)).scalars().all())

    # -- entity subtree filter --
    if entity:
        children_map: dict[str | None, list[str]] = {}
        for e in entities:
            children_map.setdefault(e.parent_id, []).append(e.id)
        included_entity_ids: set[str] = set()
        stack = [entity]
        while stack:
            cur = stack.pop()
            if cur in included_entity_ids:
                continue
            included_entity_ids.add(cur)
            stack.extend(children_map.get(cur, []))
        entities = [e for e in entities if e.id in included_entity_ids]
        processes = [p for p in processes if p.entity_id in included_entity_ids]

        # Keep only assets connected to the included processes (explicit link,
        # a link held on the asset itself, or shared owner).
        proc_owner_ids = {p.owner_id for p in processes if p.owner_id}
        included_process_ids = {p.id for p in processes}
        explicit_asset_ids: set[str] = set()
        for p in processes:
            explicit_asset_ids.update(p.asset_ids or [])
        assets = [
            a for a in assets
            if a.id in explicit_asset_ids
            or a.org_entity_id in included_entity_ids
            or a.business_process_id in included_process_ids
            or (a.owner_id and a.owner_id in proc_owner_ids)
        ]

    # -- build nodes --
    nodes: list[GraphNode] = []
    nodes.extend(GraphNode(id=e.id, label=e.name, type="entity") for e in entities)
    nodes.extend(GraphNode(id=p.id, label=p.name, type="process") for p in processes)
    nodes.extend(GraphNode(id=a.id, label=a.name, type="asset") for a in assets)
    node_ids = {n.id for n in nodes}

    # -- build edges --
    edges: list[GraphEdge] = []
    seen: set[tuple[str, str, str]] = set()

    def _add_edge(source: str, target: str, kind: str) -> None:
        if source in node_ids and target in node_ids:
            key = (source, target, kind)
            if key not in seen:
                seen.add(key)
                edges.append(GraphEdge(source=source, target=target, kind=kind))

    # entity hierarchy: child -> parent
    for e in entities:
        if e.parent_id:
            _add_edge(e.id, e.parent_id, "belongs_to")

    # process -> operating entity
    for p in processes:
        if p.entity_id:
            _add_edge(p.id, p.entity_id, "operated_by")

    # Index the assets by owner once, instead of scanning every asset for every
    # process. The previous form was O(processes x assets) on the event loop:
    # at STB's stated 10,000 assets and a few hundred processes that is millions
    # of iterations per request, blocking every other request on the worker.
    # This is O(assets + processes) and produces exactly the same edges.
    assets_by_owner: dict[str, list[str]] = {}
    # An asset can also name its process and its entity directly
    # (Asset.business_process_id / Asset.org_entity_id — "Cartography links" in
    # the model). Both were accepted and stored by the asset API and read by
    # nothing: the graph only ever looked at BusinessProcess.asset_ids and the
    # shared-owner heuristic, so setting them on the asset drew no edge at all.
    # They are indexed here so they behave exactly like the link from the other
    # side — same "depends_on" kind, and equally able to suppress the weaker
    # shared-owner inference below.
    assets_by_process: dict[str, list[str]] = {}
    for a in assets:
        if a.owner_id:
            assets_by_owner.setdefault(a.owner_id, []).append(a.id)
        if a.business_process_id:
            assets_by_process.setdefault(a.business_process_id, []).append(a.id)

    for p in processes:
        linked = set(p.asset_ids or []) | set(assets_by_process.get(p.id, ()))
        # explicit process -> asset dependency
        for aid in linked:
            _add_edge(p.id, aid, "depends_on")
        # inferred asset -> process by shared ownership (skip ones already linked)
        if p.owner_id:
            for aid in assets_by_owner.get(p.owner_id, ()):
                if aid not in linked:
                    _add_edge(aid, p.id, "owned_by")

    # asset -> owning org entity, the second link the asset carries itself.
    for a in assets:
        if a.org_entity_id:
            _add_edge(a.id, a.org_entity_id, "belongs_to")

    stats = {
        "entities": len(entities),
        "processes": len(processes),
        "assets": len(assets),
        "nodes": len(nodes),
        "edges": len(edges),
    }
    return CartographyGraph(nodes=nodes, edges=edges, stats=stats)
