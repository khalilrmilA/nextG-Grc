"""Threat Library — browse, import MITRE ATT&CK, and fetch live threat feeds."""
from datetime import datetime
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.threat import Threat, ThreatCategory
from app.services.threat_feeds import fetch_all_threat_feeds

router = APIRouter()

# ── MITRE ATT&CK source ────────────────────────────────────────────────────────
MITRE_ATTACK_URL = "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _mitre_phase_to_category(name: str) -> str:
    name_lower = name.lower()
    if any(k in name_lower for k in ("phishing", "spearphish", "social engineering", "pretexting")):
        return ThreatCategory.SOCIAL_ENGINEERING.value
    if any(k in name_lower for k in ("supply chain", "compromise software", "trusted relationship")):
        return ThreatCategory.SUPPLY_CHAIN.value
    if any(k in name_lower for k in ("insider", "abuse elevation", "valid accounts")):
        return ThreatCategory.INSIDER_THREAT.value
    return ThreatCategory.CYBER_ATTACK.value


# ── Schemas ────────────────────────────────────────────────────────────────────

class ThreatCreate(BaseModel):
    ref_id: str
    name: str
    description: str | None = None
    category: str = "cyber_attack"
    typical_threat_actors: list[str] = []
    typical_attack_vectors: list[str] = []
    affected_assets: list[str] = []
    mitre_ids: list[str] = []


class ThreatOut(BaseModel):
    id: str; ref_id: str; name: str; description: str | None
    category: str; typical_threat_actors: list; typical_attack_vectors: list
    affected_assets: list; mitre_ids: list; is_builtin: bool; is_pending: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class ImportOut(BaseModel):
    imported: int
    skipped: int
    message: str


class FetchOut(BaseModel):
    created: int
    skipped: int
    message: str
    names: list[str]


# ── CRUD endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ThreatOut])
async def list_threats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    category: str | None = None,
):
    q = select(Threat).where(
        ((Threat.is_builtin == True) | (Threat.tenant_id == tenant_id)),  # noqa: E712
        Threat.is_pending == False,  # noqa: E712
    )
    if category:
        q = q.where(Threat.category == category)
    return [ThreatOut.model_validate(t) for t in (await db.execute(q.order_by(Threat.ref_id))).scalars().all()]


@router.post("", response_model=ThreatOut, status_code=201)
async def create_threat(
    body: ThreatCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    t = Threat(ref_id=body.ref_id, name=body.name, description=body.description,
               category=body.category, typical_threat_actors=body.typical_threat_actors,
               typical_attack_vectors=body.typical_attack_vectors, affected_assets=body.affected_assets,
               mitre_ids=body.mitre_ids, is_builtin=False, is_pending=False, tenant_id=tenant_id)
    db.add(t)
    await db.flush()
    await db.commit()
    await db.refresh(t)
    return ThreatOut.model_validate(t)


@router.delete("/{tid}", status_code=204)
async def delete_threat(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    r = await db.execute(select(Threat).where(Threat.id == tid, Threat.tenant_id == tenant_id, Threat.is_builtin == False))  # noqa: E712
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Threat not found or is built-in")
    await db.delete(t)
    await db.commit()


# ── MITRE ATT&CK one-time import ───────────────────────────────────────────────

@router.post("/import-mitre", response_model=ImportOut)
async def import_mitre(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Bulk-import all MITRE ATT&CK Enterprise techniques (one-time seed)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(MITRE_ATTACK_URL)
        if resp.status_code != 200:
            raise HTTPException(502, "Failed to fetch MITRE ATT&CK data")
        data = resp.json()

    techniques = [
        o for o in data.get("objects", [])
        if o.get("type") == "attack-pattern"
        and not o.get("revoked")
        and not o.get("x_mitre_deprecated")
    ]

    existing_result = await db.execute(select(Threat.ref_id).where(Threat.is_builtin == True))  # noqa: E712
    existing_ids = {r[0] for r in existing_result.all()}

    imported = 0
    skipped = 0
    for tech in techniques:
        ext_refs = tech.get("external_references", [])
        mitre_id = next(
            (e.get("external_id") for e in ext_refs if e.get("external_id", "").startswith("T")),
            None,
        )
        if not mitre_id or mitre_id in existing_ids:
            skipped += 1
            continue

        phases = [p.get("phase_name", "") for p in tech.get("kill_chain_phases", [])]
        category = _mitre_phase_to_category(tech.get("name", ""))
        desc = (tech.get("description") or "")[:1000]

        t = Threat(
            ref_id=mitre_id,
            name=tech.get("name", "")[:500],
            description=desc,
            category=category,
            typical_threat_actors=[],
            typical_attack_vectors=phases[:4],
            affected_assets=[],
            mitre_ids=[mitre_id],
            is_builtin=True,
            is_pending=False,
            tenant_id=None,
        )
        db.add(t)
        existing_ids.add(mitre_id)
        imported += 1

    await db.commit()
    return ImportOut(
        imported=imported,
        skipped=skipped,
        message=f"Imported {imported} MITRE ATT&CK techniques. {skipped} already existed.",
    )


# ── Ongoing threat feed ────────────────────────────────────────────────────────

@router.post("/fetch-news", response_model=FetchOut)
async def fetch_threat_news(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Fetch latest threats from CISA KEV, SANS ISC, and opensourcemalware.com."""
    raw = await fetch_all_threat_feeds()

    if not raw:
        return FetchOut(created=0, skipped=0, message="Could not reach any threat feed.", names=[])

    # Skip duplicates (by ref_id for KEV, by name for RSS items)
    existing_refs = await db.execute(select(Threat.ref_id).where(
        (Threat.is_builtin == True) | (Threat.tenant_id == tenant_id)  # noqa: E712
    ))
    existing_ref_set = {r[0].lower() for r in existing_refs.all()}
    existing_names = await db.execute(select(Threat.name).where(
        (Threat.is_builtin == True) | (Threat.tenant_id == tenant_id)  # noqa: E712
    ))
    existing_name_set = {r[0].lower() for r in existing_names.all()}

    new_items = [
        it for it in raw
        if it["name"].lower() not in existing_name_set
        and (not it["ref_id"] or it["ref_id"].lower() not in existing_ref_set)
    ]

    if not new_items:
        return FetchOut(created=0, skipped=len(raw), message="No new threats found — all items already in your library.", names=[])

    created_names: list[str] = []
    for item in new_items:
        ref = item["ref_id"] or f"FEED-{item['source'][:4].upper()}-{len(created_names)+1}"
        t = Threat(
            ref_id=ref,
            name=item["name"],
            description=item.get("description") or None,
            category=item.get("category", ThreatCategory.CYBER_ATTACK.value),
            typical_threat_actors=item.get("typical_threat_actors", []),
            typical_attack_vectors=item.get("typical_attack_vectors", []),
            affected_assets=[],
            mitre_ids=[],
            is_builtin=False,
            is_pending=True,
            tenant_id=tenant_id,
        )
        db.add(t)
        created_names.append(item["name"])

    await db.commit()
    skipped = len(raw) - len(new_items)
    return FetchOut(
        created=len(created_names),
        skipped=skipped,
        message=f"Fetched {len(raw)} items. {len(created_names)} new threats pending your review.",
        names=created_names,
    )


# ── Approve / Reject pending threats ──────────────────────────────────────────

@router.get("/pending", response_model=list[ThreatOut])
async def list_pending(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Return all threats pending approval for this tenant."""
    q = select(Threat).where(Threat.tenant_id == tenant_id, Threat.is_pending == True)  # noqa: E712
    return [ThreatOut.model_validate(t) for t in (await db.execute(q.order_by(Threat.created_at.desc()))).scalars().all()]


@router.post("/{tid}/approve", response_model=ThreatOut)
async def approve_threat(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    r = await db.execute(select(Threat).where(Threat.id == tid, Threat.tenant_id == tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Threat not found")
    t.is_pending = False
    await db.commit()
    await db.refresh(t)
    return ThreatOut.model_validate(t)


@router.delete("/{tid}/reject", status_code=204)
async def reject_threat(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    r = await db.execute(select(Threat).where(Threat.id == tid, Threat.tenant_id == tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Threat not found")
    await db.delete(t)
    await db.commit()
