"""Asset cartography + org model endpoints (Elite Pack, RFP module 2).

Gated behind require_feature("asset_cartography"). Manages organizational
entities and business processes, and serves an auto-generated graph linking
assets to the processes and entities they belong to (filterable).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.org_unit import OrgEntity, BusinessProcess
from app.models.asset import Asset
from app.api.v1.dependencies.auth import get_tenant_id
from app.api.v1.dependencies.features import require_feature

router = APIRouter()

_GATE = require_feature("asset_cartography")


# ----- Org entities ---------------------------------------------------------
class EntityIn(BaseModel):
    name: str
    parent_id: str | None = None
    description: str | None = None


class EntityOut(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    description: str | None = None
    model_config = {"from_attributes": True}


@router.get("/entities", response_model=list[EntityOut])
async def list_entities(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(OrgEntity).where(OrgEntity.tenant_id == tenant_id))
    return list(result.scalars().all())


@router.post("/entities", response_model=EntityOut, status_code=status.HTTP_201_CREATED)
async def create_entity(
    body: EntityIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    entity = OrgEntity(tenant_id=tenant_id, **body.model_dump())
    db.add(entity)
    await db.commit()
    await db.refresh(entity)
    return entity


# ----- Business processes ---------------------------------------------------
class ProcessIn(BaseModel):
    name: str
    owner_id: str | None = None
    entity_id: str | None = None
    description: str | None = None


class ProcessOut(BaseModel):
    id: str
    name: str
    owner_id: str | None = None
    entity_id: str | None = None
    description: str | None = None
    model_config = {"from_attributes": True}


@router.get("/processes", response_model=list[ProcessOut])
async def list_processes(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(BusinessProcess).where(BusinessProcess.tenant_id == tenant_id))
    return list(result.scalars().all())


@router.post("/processes", response_model=ProcessOut, status_code=status.HTTP_201_CREATED)
async def create_process(
    body: ProcessIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    proc = BusinessProcess(tenant_id=tenant_id, **body.model_dump())
    db.add(proc)
    await db.commit()
    await db.refresh(proc)
    return proc


# ----- Cartography graph ----------------------------------------------------
@router.get("/cartography")
async def cartography(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    entity: str | None = None,
    asset_type: str | None = None,
):
    """Auto-generated graph: assets <-> business processes <-> org entities."""
    entities = (await db.execute(
        select(OrgEntity).where(OrgEntity.tenant_id == tenant_id)
    )).scalars().all()
    processes = (await db.execute(
        select(BusinessProcess).where(BusinessProcess.tenant_id == tenant_id)
    )).scalars().all()
    asset_stmt = select(Asset).where(Asset.tenant_id == tenant_id)
    if asset_type:
        asset_stmt = asset_stmt.where(Asset.asset_type == asset_type)
    assets = (await db.execute(asset_stmt)).scalars().all()

    nodes = []
    edges = []
    for e in entities:
        if entity and e.id != entity:
            continue
        nodes.append({"id": e.id, "label": e.name, "type": "entity"})
        if e.parent_id:
            edges.append({"source": e.id, "target": e.parent_id, "kind": "child_of"})
    for p in processes:
        if entity and p.entity_id != entity:
            continue
        nodes.append({"id": p.id, "label": p.name, "type": "process"})
        if p.entity_id:
            edges.append({"source": p.id, "target": p.entity_id, "kind": "belongs_to"})
    process_ids = {p.id for p in processes}
    entity_ids = {e.id for e in entities}
    for a in assets:
        # Optional links, present once the assets module adds them.
        proc_id = getattr(a, "business_process_id", None)
        ent_id = getattr(a, "org_entity_id", None)
        if entity and ent_id != entity and proc_id not in process_ids:
            # Skip assets unrelated to the filtered entity.
            if not (proc_id and any(p.id == proc_id and p.entity_id == entity for p in processes)):
                continue
        nodes.append({"id": a.id, "label": a.name, "type": "asset", "asset_type": a.asset_type})
        if proc_id and proc_id in process_ids:
            edges.append({"source": a.id, "target": proc_id, "kind": "supports"})
        if ent_id and ent_id in entity_ids:
            edges.append({"source": a.id, "target": ent_id, "kind": "owned_by"})

    return {"nodes": nodes, "edges": edges}
