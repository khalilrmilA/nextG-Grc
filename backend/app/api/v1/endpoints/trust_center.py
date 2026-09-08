"""Trust Center — public-facing compliance status page.
No authentication required. Shows tenant's compliance posture externally.
Controlled by tenant settings (which frameworks/certs to show publicly).
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.compliance import ComplianceAssessment
from app.models.policy import Policy, PolicyStatus
from app.models.vendor import Vendor
from app.services.ai_locale import get_request_language

router = APIRouter()

# The public page answers anonymous visitors, so a single message covers both
# "no such organization" and "trust center switched off": telling the two apart
# would let anyone walk the slug space and enumerate this platform's customers.
_NOT_PUBLIC: dict[str, str] = {
    "en": "No public trust center is available for this organization.",
    "fr": "Aucun centre de confiance public n'est disponible pour cette organisation.",
    "ar": "لا يوجد مركز ثقة عام متاح لهذه المؤسسة.",
}

# The two authenticated routes raise this when the token's tenant has no row.
_TENANT_NOT_FOUND: dict[str, str] = {
    "en": "Tenant not found",
    "fr": "Organisation introuvable",
    "ar": "المؤسسة غير موجودة",
}


# ── Schemas ──────────────────────────────────────────────────────────────

class TrustCenterConfig(BaseModel):
    enabled: bool = False
    show_frameworks: bool = True
    show_policies: bool = True
    show_certifications: bool = True
    show_subprocessors: bool = False
    custom_message: str | None = None
    contact_email: str | None = None

class TrustCenterPublic(BaseModel):
    org_name: str
    industry: str | None
    custom_message: str | None
    contact_email: str | None
    frameworks: list[dict]
    policies: list[dict]
    certifications: list[dict]
    subprocessors: list[dict]
    last_updated: str | None


# ── Admin endpoints (authenticated) ──────────────────────────────────────

@router.get("/config", response_model=TrustCenterConfig)
async def get_trust_center_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Get current trust center configuration."""
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, _TENANT_NOT_FOUND.get(lang) or _TENANT_NOT_FOUND["en"])
    tc = (tenant.settings or {}).get("trust_center", {})
    return TrustCenterConfig(**tc) if tc else TrustCenterConfig()


@router.put("/config", response_model=TrustCenterConfig)
async def update_trust_center_config(
    body: TrustCenterConfig,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """Update trust center configuration."""
    r = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = r.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, _TENANT_NOT_FOUND.get(lang) or _TENANT_NOT_FOUND["en"])
    # dict(...) — Tenant.settings is a plain JSON column with no mutation
    # tracking, so mutating the dict in place leaves SQLAlchemy seeing no change
    # and the UPDATE is never emitted. Every save after the first was silently
    # discarded on any tenant that already had a non-empty settings blob.
    settings = dict(tenant.settings or {})
    settings["trust_center"] = body.model_dump()
    tenant.settings = settings
    await db.commit()
    return body


# ── Public endpoint (NO auth) ────────────────────────────────────────────

@router.get("/public/{tenant_slug}", response_model=TrustCenterPublic)
async def get_public_trust_center(
    tenant_slug: str,
    db: AsyncSession = Depends(get_db),
    lang: str = Depends(get_request_language),
):
    """Public trust center page — no authentication required."""
    r = await db.execute(select(Tenant).where(Tenant.slug == tenant_slug))
    tenant = r.scalar_one_or_none()
    not_public = _NOT_PUBLIC.get(lang) or _NOT_PUBLIC["en"]
    if not tenant:
        raise HTTPException(404, not_public)

    tc = (tenant.settings or {}).get("trust_center", {})
    if not tc.get("enabled", False):
        raise HTTPException(404, not_public)

    result = TrustCenterPublic(
        org_name=tenant.name,
        industry=tenant.industry,
        custom_message=tc.get("custom_message"),
        contact_email=tc.get("contact_email"),
        frameworks=[],
        policies=[],
        certifications=[],
        subprocessors=[],
        last_updated=None,
    )

    # Anything published below also dates the page: last_updated is the most recent
    # change among exactly the records shown, and stays null when nothing is shown.
    # It was declared in the response and never filled by anything.
    shown_updates: list = []

    # Frameworks & compliance scores
    if tc.get("show_frameworks", True):
        assessments = list((await db.execute(
            select(ComplianceAssessment).where(ComplianceAssessment.tenant_id == tenant.id)
        )).scalars().all())
        for a in assessments:
            if a.compliance_score is not None and a.compliance_score > 0:
                result.frameworks.append({
                    "name": a.name or "Assessment",
                    "status": a.status.value if hasattr(a.status, "value") else str(a.status),
                    "score": round(a.compliance_score, 1) if a.compliance_score else None,
                })
                shown_updates.append(a.updated_at)

    # Published policies (names only)
    if tc.get("show_policies", True):
        policies = list((await db.execute(
            select(Policy).where(
                Policy.tenant_id == tenant.id,
                Policy.status.in_([PolicyStatus.PUBLISHED, PolicyStatus.APPROVED]),
            )
        )).scalars().all())
        for p in policies:
            result.policies.append({
                "title": p.title,
                "category": p.category,
                # "last_reviewed" used to carry next_review_date — a date in the FUTURE
                # published under a "last reviewed" label. The key stays (nothing may be
                # removed from a response) but now carries the only "as of" fact on the
                # record; the review due date travels under its own name.
                "last_reviewed": p.effective_date,
                "next_review": p.next_review_date,
            })
            shown_updates.append(p.updated_at)

    # Certifications (from frameworks with high scores)
    if tc.get("show_certifications", True):
        for fw in result.frameworks:
            if fw.get("score") and fw["score"] >= 70:
                result.certifications.append({
                    "name": fw["name"],
                    "status": "Compliant" if fw["score"] >= 90 else "In Progress",
                    "score": fw["score"],
                })

    # Subprocessors — public output is intentionally minimal: only an aggregate
    # count and a list of distinct countries to support data-residency disclosures.
    # Per-vendor names/services are NOT exposed publicly to avoid leaking the
    # tenant's supplier list to competitors or attackers.
    if tc.get("show_subprocessors", False):
        vendors = list((await db.execute(
            select(Vendor).where(Vendor.tenant_id == tenant.id, Vendor.status == "active")
        )).scalars().all())
        countries = sorted({(v.country or "").strip() for v in vendors if v.country})
        result.subprocessors.append({
            "subprocessor_count": len(vendors),
            "countries": countries,
        })

    dated = [d for d in shown_updates if isinstance(d, datetime)]
    if dated:
        result.last_updated = max(dated).date().isoformat()

    return result
