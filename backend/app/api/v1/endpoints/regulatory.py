"""Regulatory Change Tracking — monitor and manage regulatory updates."""
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.regulatory_update import RegulatoryUpdate, UpdateImpact, UpdateStatus
from app.models.tenant import Tenant
from app.models.framework import Framework
from app.core.config import settings


# ── RSS Feed sources ───────────────────────────────────────────────────────────
REGULATORY_FEEDS = [
    {
        "url": "https://www.cisa.gov/cybersecurity-advisories/all.xml",
        "source": "CISA",
        "default_regulation": "CISA Advisory",
    },
    {
        "url": "https://www.ncsc.gov.uk/api/1/services/v1/report-rss-feed.xml",
        "source": "UK NCSC",
        "default_regulation": "UK Cyber",
    },
    {
        "url": "https://isc.sans.edu/rssfeed.xml",
        "source": "SANS ISC",
        "default_regulation": "Security Advisory",
    },
    {
        "url": "https://krebsonsecurity.com/feed/",
        "source": "Krebs on Security",
        "default_regulation": "Security News",
    },
]


def _make_item(title: str, summary: str, url: str, source: str, regulation: str) -> dict:
    return {"title": title[:500], "summary": summary[:600], "url": url or None, "source": source, "regulation_name": regulation}


def _parse_rss(channel, source: str, regulation: str) -> list[dict]:
    items = []
    for entry in channel.findall("item")[:12]:
        title = (entry.findtext("title") or "").strip()
        if title:
            link = (entry.findtext("link") or "").strip()
            desc = (entry.findtext("description") or "").strip()
            items.append(_make_item(title, desc, link, source, regulation))
    return items


def _parse_atom(root, source: str, regulation: str) -> list[dict]:
    ns = "{http://www.w3.org/2005/Atom}"
    items = []
    for entry in root.findall(f"{ns}entry")[:12]:
        title = (entry.findtext(f"{ns}title") or "").strip()
        if title:
            link_el = entry.find(f"{ns}link")
            link = link_el.get("href", "") if link_el is not None else ""
            summary = (entry.findtext(f"{ns}summary") or entry.findtext(f"{ns}content") or "").strip()
            items.append(_make_item(title, summary, link, source, regulation))
    return items


def _parse_feed(xml_text: str, source: str, default_regulation: str) -> list[dict]:
    """Parse RSS 2.0 or Atom XML and return list of items."""
    try:
        root = ET.fromstring(xml_text)
        channel = root.find("channel")
        if channel is not None:
            return _parse_rss(channel, source, default_regulation)
        return _parse_atom(root, source, default_regulation)
    except Exception:
        return []


async def _assess_with_ollama(items: list[dict], tenant_frameworks: list[str] | None = None, user_id: str | None = None) -> list[dict]:
    """Ask Ollama to filter and classify items relevant to the tenant's frameworks."""
    fw_context = ", ".join(tenant_frameworks) if tenant_frameworks else "ISO 27001, GDPR, NIST CSF, SOC 2, PCI DSS"
    numbered = "\n".join(
        f"{i + 1}. [{it['source']}] {it['title']} — {it['summary'][:180]}"
        for i, it in enumerate(items)
    )
    prompt = (
        f"You are a GRC compliance analyst. This organization uses: {fw_context}.\n"
        "Analyze these security/regulatory news items and decide which are relevant "
        "to the organization's compliance obligations or cybersecurity posture.\n\n"
        f"Items:\n{numbered}\n\n"
        "Respond with a JSON array. Include ONLY relevant items:\n"
        "[\n"
        '  {"index": 1, "is_relevant": true, "impact": "high", '
        f'"regulation_name": "ISO 27001", "affected_frameworks": {json.dumps(tenant_frameworks or [])}, '
        '"summary": "2-sentence compliance impact summary"}\n'
        "]\n"
        "impact must be one of: critical, high, medium, low, informational\n"
        "Return ONLY valid JSON array, no extra text."
    )
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": settings.OLLAMA_CHAT_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "format": "json",
                },
            )
            if resp.status_code == 200:
                if user_id:
                    from app.core import ai_quota
                    ai_quota.record_from_ollama_response(user_id, resp.json())
                content = resp.json().get("message", {}).get("content", "[]")
                assessed = json.loads(content)
                if not isinstance(assessed, list):
                    assessed = []
                result = []
                for a in assessed:
                    idx = int(a.get("index", 1)) - 1
                    if 0 <= idx < len(items) and a.get("is_relevant"):
                        result.append({**items[idx], **a})
                return result
    except Exception:
        pass
    # Ollama unavailable — return all items as medium, unclassified
    return [{**it, "is_relevant": True, "impact": "medium", "affected_frameworks": []} for it in items]

router = APIRouter()


class RegUpdateCreate(BaseModel):
    title: str
    description: str | None = None
    source: str | None = None
    regulation_name: str | None = None
    impact: str = "medium"
    effective_date: str | None = None
    deadline: str | None = None
    url: str | None = None
    affected_frameworks: list[str] = []
    affected_controls: list[str] = []
    assigned_to_id: str | None = None

class RegUpdateMod(BaseModel):
    title: str | None = None
    description: str | None = None
    source: str | None = None
    regulation_name: str | None = None
    impact: str | None = None
    status: str | None = None
    effective_date: str | None = None
    deadline: str | None = None
    url: str | None = None
    affected_frameworks: list[str] | None = None
    affected_controls: list[str] | None = None
    action_items: list[dict] | None = None
    assigned_to_id: str | None = None
    notes: str | None = None

class RegUpdateOut(BaseModel):
    id: str; tenant_id: str; title: str; description: str | None
    source: str | None; regulation_name: str | None; impact: str; status: str
    effective_date: str | None; deadline: str | None; url: str | None
    affected_frameworks: list; affected_controls: list; action_items: list
    assigned_to_id: str | None; notes: str | None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


@router.get("", response_model=list[RegUpdateOut])
async def list_updates(status_filter: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    q = select(RegulatoryUpdate).where(RegulatoryUpdate.tenant_id == tenant_id)
    if status_filter: q = q.where(RegulatoryUpdate.status == status_filter)
    return [RegUpdateOut.model_validate(u) for u in (await db.execute(q.order_by(RegulatoryUpdate.created_at.desc()))).scalars().all()]

@router.post("", response_model=RegUpdateOut, status_code=201)
async def create_update(body: RegUpdateCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    u = RegulatoryUpdate(
        tenant_id=tenant_id, title=body.title, description=body.description,
        source=body.source, regulation_name=body.regulation_name,
        impact=UpdateImpact(body.impact), effective_date=body.effective_date,
        deadline=body.deadline, url=body.url, affected_frameworks=body.affected_frameworks,
        affected_controls=body.affected_controls, assigned_to_id=body.assigned_to_id,
    )
    db.add(u); await db.flush(); await db.commit(); await db.refresh(u)
    return RegUpdateOut.model_validate(u)

@router.get("/{uid}", response_model=RegUpdateOut)
async def get_update(uid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u: raise HTTPException(404, "Update not found")
    return RegUpdateOut.model_validate(u)

@router.patch("/{uid}", response_model=RegUpdateOut)
async def modify_update(uid: str, body: RegUpdateMod, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u: raise HTTPException(404, "Update not found")
    for f in ["title","description","source","regulation_name","effective_date","deadline","url","affected_frameworks","affected_controls","action_items","assigned_to_id","notes"]:
        v = getattr(body, f, None)
        if v is not None: setattr(u, f, v)
    if body.impact: u.impact = UpdateImpact(body.impact)
    if body.status: u.status = UpdateStatus(body.status)
    await db.commit(); await db.refresh(u)
    return RegUpdateOut.model_validate(u)

@router.delete("/{uid}", status_code=204)
async def delete_update(uid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u: raise HTTPException(404, "Update not found")
    await db.delete(u); await db.commit()


class FetchNewsOut(BaseModel):
    created: int
    skipped: int
    message: str
    titles: list[str]


@router.post("/fetch-news", response_model=FetchNewsOut)
async def fetch_regulatory_news(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Fetch RSS feeds from regulatory bodies, assess with AI, and create draft updates."""
    from app.core import ai_quota
    ai_quota.check_quota_or_raise(current_user.id)
    # 1. Fetch all feeds concurrently
    raw_items: list[dict] = []
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers={"User-Agent": "GRC-Platform/1.0"}) as client:
        for feed in REGULATORY_FEEDS:
            try:
                resp = await client.get(feed["url"])
                if resp.status_code == 200:
                    raw_items.extend(_parse_feed(resp.text, feed["source"], feed["default_regulation"]))
            except Exception:
                continue

    if not raw_items:
        return FetchNewsOut(created=0, skipped=0, message="Could not reach any regulatory feed. Check your internet connection.", titles=[])

    # 2. Skip titles already in DB (both approved and pending)
    existing_result = await db.execute(
        select(RegulatoryUpdate.title).where(RegulatoryUpdate.tenant_id == tenant_id)
    )
    existing_titles = {row[0].lower() for row in existing_result.all()}
    new_items = [it for it in raw_items if it["title"].lower() not in existing_titles]

    if not new_items:
        return FetchNewsOut(created=0, skipped=len(raw_items), message="All fetched items already exist in your database.", titles=[])

    # 3. Resolve tenant's selected framework names to pass as context to Ollama
    tenant_row = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant_obj = tenant_row.scalar_one_or_none()
    tenant_frameworks: list[str] = []
    if tenant_obj and tenant_obj.selected_framework_ids:
        fw_rows = await db.execute(
            select(Framework.short_name).where(Framework.id.in_(tenant_obj.selected_framework_ids))
        )
        tenant_frameworks = [r[0] for r in fw_rows.all()]

    # 4. Ask Ollama to classify relevance against the tenant's frameworks
    assessed = await _assess_with_ollama(new_items, tenant_frameworks or None, current_user.id)

    # 5. Persist as pending_approval — user must approve before they appear in the main list
    created_titles: list[str] = []
    for item in assessed:
        try:
            impact_val = UpdateImpact(item.get("impact", "medium"))
        except ValueError:
            impact_val = UpdateImpact.MEDIUM
        u = RegulatoryUpdate(
            tenant_id=tenant_id,
            title=item["title"],
            description=item.get("summary") or None,
            source=item.get("source"),
            regulation_name=item.get("regulation_name"),
            impact=impact_val,
            url=item.get("url"),
            affected_frameworks=item.get("affected_frameworks", []),
            status=UpdateStatus.PENDING_APPROVAL,
        )
        db.add(u)
        created_titles.append(item["title"])

    await db.commit()
    skipped = len(raw_items) - len(new_items)
    return FetchNewsOut(
        created=len(created_titles),
        skipped=skipped,
        message=f"Found {len(raw_items)} items. {len(created_titles)} proposals ready for your review.",
        titles=created_titles,
    )


@router.post("/{uid}/approve", response_model=RegUpdateOut)
async def approve_update(
    uid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Approve a pending_approval update — moves it to 'new' status."""
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "Update not found")
    u.status = UpdateStatus.NEW
    await db.commit()
    await db.refresh(u)
    return RegUpdateOut.model_validate(u)


@router.delete("/{uid}/reject", status_code=204)
async def reject_update(
    uid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Reject a pending_approval update — permanently deletes it."""
    r = await db.execute(select(RegulatoryUpdate).where(RegulatoryUpdate.id == uid, RegulatoryUpdate.tenant_id == tenant_id))
    u = r.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "Update not found")
    await db.delete(u)
    await db.commit()
