"""CVE knowledge base endpoints (Elite Pack, RFP module 3).

Gated behind require_feature("cve_knowledge_base"). Advanced search over the NVD
catalog, an on-demand sync trigger, per-tenant relevance annotation, and the
detailed per-CVE sheet that joins NVD's data to MITRE's weakness taxonomy.
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import String, and_, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.v1.dependencies.auth import get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant
from app.models.cve_entry import CveAnnotation, CveEntry, RELEVANCE_VALUES
from app.models.cwe_entry import CweEntry
from app.models.user import User, UserRole
from app.services.nvd_sync import sync_all

router = APIRouter()

_GATE = require_feature("cve_knowledge_base")

# require_feature only says the tenant's plan includes the knowledge base. Pulling
# from NVD/MITRE is an outbound job that writes the catalog every tenant reads and
# takes minutes of worker time, so it carries the same role gate the platform's
# other feed pulls already have (threats.py /fetch-news, regulatory.py /fetch-news).
_FEED_OPERATOR = require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO)

# A fourth, synthetic relevance filter: everything the tenant has not judged
# yet. It is the working queue for the triage the requirement describes, and
# without it the only way to find untriaged CVEs is to eyeball the whole list.
_UNTRIAGED = "untriaged"


class CweRef(BaseModel):
    """A weakness code with MITRE's own name for it, so "CWE-321" reads as
    "Use of Hard-coded Cryptographic Key" wherever it is shown."""
    cwe_id: str
    name: str | None = None


class CweDetail(BaseModel):
    cwe_id: str
    name: str
    description: str | None = None
    extended_description: str | None = None
    mitigations: list = []
    capec_ids: list = []
    status: str | None = None
    abstraction: str | None = None
    model_config = {"from_attributes": True}


class CveOut(BaseModel):
    id: str
    cve_id: str
    description: str | None = None
    cvss_score: float | None = None
    cvss_vector: str | None = None
    cwe_ids: list = []
    cwe: list[CweRef] = []
    references: list = []
    # CISA "Known Exploited Vulnerabilities". Actively exploited outranks a
    # higher theoretical score, so it belongs on every row, not only the sheet.
    known_exploited: bool = False
    kev_added_at: str | None = None
    kev_due_date: str | None = None
    kev_action: str | None = None
    published_at: datetime | None = None
    last_modified: datetime | None = None
    relevance: str | None = None
    notes: str | None = None
    linked_asset_ids: list = []
    model_config = {"from_attributes": True}


class CveDetailOut(CveOut):
    """The full sheet: everything in the list row, plus MITRE's text for each
    weakness the CVE is classified against — which is where the known
    workarounds come from."""
    weaknesses: list[CweDetail] = []


class AnnotationIn(BaseModel):
    relevance: str
    notes: str | None = None
    linked_asset_ids: list[str] = []


def _normalise_cwe(value: str) -> str:
    """Turn "79", "cwe-79" or "CWE-79" into "CWE-79".

    Returns "" for anything that is not a weakness code (a name like "XSS", or a
    bare "cwe"), which the caller treats as a name search instead. Returning a
    half-formed "CWE-" here would match every weakness code in the catalog and
    look like a filter that silently does nothing.
    """
    token = (value or "").strip().upper()
    if token.startswith("CWE-"):
        token = token[4:]
    return f"CWE-{token}" if token.isdigit() else ""


async def _cwe_codes_for_name(db: AsyncSession, term: str, limit: int = 25) -> list[str]:
    """Weakness codes whose MITRE name matches `term`.

    Lets the flaw-type filter accept "cross-site scripting" as well as
    "CWE-79" — nobody searching a knowledge base should have to know the number.
    """
    rows = (await db.execute(
        select(CweEntry.cwe_id).where(CweEntry.name.ilike(f"%{term.strip()}%")).limit(limit)
    )).all()
    return [r[0] for r in rows]


async def _attach_cwe_names(db: AsyncSession, items: list[CveOut]) -> None:
    """Resolve every referenced CWE code to MITRE's name, in one query."""
    codes = {c for item in items for c in (item.cwe_ids or [])}
    if not codes:
        return
    rows = (await db.execute(
        select(CweEntry.cwe_id, CweEntry.name).where(CweEntry.cwe_id.in_(list(codes)))
    )).all()
    names = {cwe_id: name for cwe_id, name in rows}
    for item in items:
        item.cwe = [CweRef(cwe_id=c, name=names.get(c)) for c in (item.cwe_ids or [])]


@router.get("/cwe", response_model=list[CweDetail])
async def search_cwe(
    current_user: Annotated[User, Depends(_GATE)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    """Search the MITRE weakness catalog by code or name.

    Declared before ``/{cve_id}`` on purpose — otherwise the path parameter
    swallows "cwe" and this route is unreachable.
    """
    stmt = select(CweEntry)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where((CweEntry.cwe_id.ilike(like)) | (CweEntry.name.ilike(like)))
    stmt = stmt.order_by(CweEntry.cwe_id).limit(limit)
    return [CweDetail.model_validate(r) for r in (await db.execute(stmt)).scalars().all()]


@router.get("", response_model=list[CveOut])
async def search_cve(
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = None,
    min_cvss: float | None = None,
    cwe: str | None = None,
    vector: str | None = None,
    published_after: datetime | None = None,
    published_before: datetime | None = None,
    relevance: str | None = None,
    known_exploited: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Advanced search: flaw type (CWE), criticality, attack vector, publication
    date, and the tenant's own relevance triage.

    The annotation is LEFT JOINed rather than fetched separately because the
    relevance filter has to run in SQL. It used to be applied in Python *after*
    ``OFFSET/LIMIT``, so "show me everything marked pertinent" searched only
    within one page of the catalog — with 8,000+ entries and a handful triaged,
    that reliably returned an empty list.
    """
    ann = aliased(CveAnnotation)
    stmt = select(CveEntry, ann).outerjoin(
        ann, and_(ann.cve_id == CveEntry.cve_id, ann.tenant_id == tenant_id)
    )

    if q:
        like = f"%{q}%"
        stmt = stmt.where((CveEntry.cve_id.ilike(like)) | (CveEntry.description.ilike(like)))
    if min_cvss is not None:
        stmt = stmt.where(CveEntry.cvss_score >= min_cvss)
    if cwe:
        # JSON list stored as text; cast + ILIKE works on both SQLite and Postgres.
        # Matched with the surrounding quotes so "CWE-79" cannot also match
        # CWE-798 / CWE-790 — a bare substring made the flaw-type filter return
        # unrelated weaknesses.
        token = _normalise_cwe(cwe)
        if token:
            stmt = stmt.where(cast(CveEntry.cwe_ids, String).ilike(f'%"{token}"%'))
        else:
            # Not a code — treat it as a weakness *name* ("cross-site scripting").
            codes = await _cwe_codes_for_name(db, cwe)
            if not codes:
                return []
            stmt = stmt.where(or_(*[
                cast(CveEntry.cwe_ids, String).ilike(f'%"{c}"%') for c in codes
            ]))
    if vector:
        # Substring match on a fragment like "AV:N" is the practical filter shape
        # for a free-text CVSS vector ("CVSS:3.1/AV:N/AC:L/...").
        stmt = stmt.where(CveEntry.cvss_vector.ilike(f"%{vector}%"))
    if known_exploited is not None:
        stmt = stmt.where(CveEntry.known_exploited == known_exploited)
    if published_after is not None:
        stmt = stmt.where(CveEntry.published_at >= published_after)
    if published_before is not None:
        stmt = stmt.where(CveEntry.published_at <= published_before)
    if relevance:
        if relevance == _UNTRIAGED:
            stmt = stmt.where(ann.id.is_(None))
        elif relevance in RELEVANCE_VALUES:
            stmt = stmt.where(ann.relevance == relevance)
        else:
            raise HTTPException(
                status_code=422,
                detail=f"relevance must be one of {RELEVANCE_VALUES + (_UNTRIAGED,)}",
            )

    # Newest-published first so the catalog surfaces the latest CVEs, not decade-old
    # entries that NVD merely re-scored recently.
    stmt = stmt.order_by(
        CveEntry.published_at.desc().nullslast(), CveEntry.last_modified.desc().nullslast()
    ).offset((page - 1) * page_size).limit(page_size)

    out: list[CveOut] = []
    for entry, annotation in (await db.execute(stmt)).all():
        item = CveOut.model_validate(entry)
        item.relevance = annotation.relevance if annotation else None
        item.notes = annotation.notes if annotation else None
        item.linked_asset_ids = (annotation.linked_asset_ids or []) if annotation else []
        out.append(item)
    await _attach_cwe_names(db, out)
    return out


@router.post("/sync")
async def trigger_sync(
    current_user: Annotated[User, Depends(_GATE)],
    _role: Annotated[User, Depends(_FEED_OPERATOR)],
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(3, ge=1, le=30),
    refresh_days: int | None = Query(None, ge=1, le=120),
):
    """Pull from the official sources: newly published CVEs from NVD, analysis
    updates for CVEs already held, and the MITRE CWE catalog when it is stale.

    Same work the nightly job does, so the button and the schedule cannot drift.

    ``refresh_days`` widens only the second pass. It exists for catching up a
    catalog that was built before that pass existed: a one-off ``refresh_days=30``
    walks a month of NVD analysis updates and fills in entries that were
    ingested on their publication day with no score. It costs one NVD page per
    2,000 records, so leave it unset for routine syncs.
    """
    return await sync_all(db, days=days, refresh_days=refresh_days or min(days, 7))


@router.get("/{cve_id}", response_model=CveDetailOut)
async def get_cve(
    cve_id: str,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """The detailed sheet for one CVE: description, criticality, attack vector,
    the weaknesses it is classified against with MITRE's published mitigations,
    the tagged reference links, and the tenant's own triage."""
    entry = (await db.execute(
        select(CveEntry).where(CveEntry.cve_id == cve_id)
    )).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="CVE not found in catalog")

    annotation = (await db.execute(
        select(CveAnnotation).where(
            CveAnnotation.tenant_id == tenant_id, CveAnnotation.cve_id == cve_id
        )
    )).scalar_one_or_none()

    item = CveDetailOut.model_validate(entry)
    item.relevance = annotation.relevance if annotation else None
    item.notes = annotation.notes if annotation else None
    item.linked_asset_ids = (annotation.linked_asset_ids or []) if annotation else []

    codes = list(entry.cwe_ids or [])
    if codes:
        rows = (await db.execute(
            select(CweEntry).where(CweEntry.cwe_id.in_(codes))
        )).scalars().all()
        found = {r.cwe_id: r for r in rows}
        item.weaknesses = [CweDetail.model_validate(found[c]) for c in codes if c in found]
        item.cwe = [CweRef(cwe_id=c, name=found[c].name if c in found else None) for c in codes]
    return item


@router.put("/{cve_id}/annotation", response_model=CveOut)
async def set_annotation(
    cve_id: str,
    body: AnnotationIn,
    current_user: Annotated[User, Depends(_GATE)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if body.relevance not in RELEVANCE_VALUES:
        raise HTTPException(status_code=422, detail=f"relevance must be one of {RELEVANCE_VALUES}")
    # The linked assets were stored verbatim, so a typo produced an annotation
    # pointing at nothing and a forged id pointed it at another tenant's asset.
    # Same check threats.py already applies to its profile links.
    await assert_assets_in_tenant(db, body.linked_asset_ids, tenant_id, field_name="linked_asset_ids")
    entry = (await db.execute(select(CveEntry).where(CveEntry.cve_id == cve_id))).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="CVE not found in catalog")

    ann = (await db.execute(
        select(CveAnnotation).where(
            CveAnnotation.tenant_id == tenant_id, CveAnnotation.cve_id == cve_id
        )
    )).scalar_one_or_none()
    if ann is None:
        ann = CveAnnotation(tenant_id=tenant_id, cve_id=cve_id)
        db.add(ann)
    ann.relevance = body.relevance
    ann.notes = body.notes
    ann.linked_asset_ids = body.linked_asset_ids
    await db.commit()

    item = CveOut.model_validate(entry)
    item.relevance = body.relevance
    item.notes = body.notes
    item.linked_asset_ids = body.linked_asset_ids
    await _attach_cwe_names(db, [item])
    return item
