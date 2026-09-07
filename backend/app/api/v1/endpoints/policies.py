"""Policy Management — full policy lifecycle with versioning and attestations."""
import io
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_user_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.policy import Policy, PolicyVersion, PolicyAttestation, PolicyStatus, AttestationStatus
from app.models.org_unit import OrgEntity, BusinessProcess
from app.services import pdf_arabic
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class PolicyCreate(BaseModel):
    title: str
    description: str | None = None
    category: str | None = None
    policy_number: str | None = None
    owner_id: str | None = None
    status: str | None = None  # draft, in_review, approved, published
    linked_controls: list[str] = []
    review_frequency_months: int = 12
    next_review_date: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    business_process_id: str | None = None
    org_entity_id: str | None = None
    content: str | None = None  # initial version content

class PolicyUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    status: str | None = None
    owner_id: str | None = None
    linked_controls: list[str] | None = None
    review_frequency_months: int | None = None
    next_review_date: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    business_process_id: str | None = None
    org_entity_id: str | None = None

class PolicyOut(BaseModel):
    id: str; tenant_id: str; title: str; policy_number: str | None
    description: str | None; category: str | None; owner_id: str | None
    status: str; linked_controls: list; review_frequency_months: int
    next_review_date: str | None
    effective_date: str | None = None; expiration_date: str | None = None
    business_process_id: str | None = None; org_entity_id: str | None = None
    version_count: int = 0
    attestation_count: int = 0; pending_attestations: int = 0
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

class VersionCreate(BaseModel):
    content: str
    change_summary: str | None = None

class VersionOut(BaseModel):
    id: str; policy_id: str; version_number: int; content: str
    change_summary: str | None; is_current: bool
    authored_by_id: str | None; approved_by_id: str | None; approved_at: str | None
    created_at: datetime
    model_config = {"from_attributes": True}

class AttestationCreate(BaseModel):
    user_ids: list[str]
    due_date: str | None = None

class AttestationOut(BaseModel):
    id: str; policy_id: str; policy_version_id: str; user_id: str
    status: str; due_date: str | None; acknowledged_at: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────

async def _policy(db, pid, tid):
    r = await db.execute(select(Policy).where(Policy.id == pid, Policy.tenant_id == tid))
    p = r.scalar_one_or_none()
    if not p: raise HTTPException(404, "Policy not found")
    return p

async def _assert_process_in_tenant(db, process_id, tenant_id):
    """Close cross-tenant IDOR on attacker-supplied business_process_id (mirrors assert_user_in_tenant)."""
    if not process_id: return
    r = await db.execute(select(BusinessProcess.id).where(BusinessProcess.id == process_id, BusinessProcess.tenant_id == tenant_id))
    if r.scalar_one_or_none() is None:
        raise HTTPException(400, "Invalid business_process_id: not in this tenant")

async def _assert_entity_in_tenant(db, entity_id, tenant_id):
    """Close cross-tenant IDOR on attacker-supplied org_entity_id (mirrors assert_user_in_tenant)."""
    if not entity_id: return
    r = await db.execute(select(OrgEntity.id).where(OrgEntity.id == entity_id, OrgEntity.tenant_id == tenant_id))
    if r.scalar_one_or_none() is None:
        raise HTTPException(400, "Invalid org_entity_id: not in this tenant")

async def _enrich(db, policy):
    vc = (await db.execute(select(func.count(PolicyVersion.id)).where(PolicyVersion.policy_id == policy.id))).scalar() or 0
    ac = (await db.execute(select(func.count(PolicyAttestation.id)).where(PolicyAttestation.policy_id == policy.id))).scalar() or 0
    pa = (await db.execute(select(func.count(PolicyAttestation.id)).where(PolicyAttestation.policy_id == policy.id, PolicyAttestation.status == AttestationStatus.PENDING))).scalar() or 0
    o = PolicyOut.model_validate(policy)
    o.version_count = vc; o.attestation_count = ac; o.pending_attestations = pa
    return o


# ── Policy CRUD ──────────────────────────────────────────────────────────

@router.get("", response_model=list[PolicyOut])
async def list_policies(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    policies = list((await db.execute(select(Policy).where(Policy.tenant_id == tenant_id).order_by(Policy.created_at.desc()))).scalars().all())
    return [await _enrich(db, p) for p in policies]

@router.post("", response_model=PolicyOut, status_code=201)
async def create_policy(body: PolicyCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    await _assert_process_in_tenant(db, body.business_process_id, tenant_id)
    await _assert_entity_in_tenant(db, body.org_entity_id, tenant_id)
    p = Policy(tenant_id=tenant_id, title=body.title, description=body.description,
               category=body.category, policy_number=body.policy_number,
               owner_id=body.owner_id or user.id, linked_controls=body.linked_controls,
               review_frequency_months=body.review_frequency_months,
               next_review_date=body.next_review_date,
               effective_date=body.effective_date, expiration_date=body.expiration_date,
               business_process_id=body.business_process_id, org_entity_id=body.org_entity_id)
    if body.status:
        p.status = PolicyStatus(body.status)
    db.add(p); await db.flush()
    # Create initial version if content provided
    if body.content:
        v = PolicyVersion(policy_id=p.id, version_number=1, content=body.content,
                          is_current=True, authored_by_id=user.id, change_summary="Initial version")
        db.add(v)
    await db.commit(); await db.refresh(p)
    return await _enrich(db, p)

@router.get("/{pid}", response_model=PolicyOut)
async def get_policy(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return await _enrich(db, await _policy(db, pid, tenant_id))

@router.patch("/{pid}", response_model=PolicyOut)
async def update_policy(pid: str, body: PolicyUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    await _assert_process_in_tenant(db, body.business_process_id, tenant_id)
    await _assert_entity_in_tenant(db, body.org_entity_id, tenant_id)
    for f in ["title","description","category","owner_id","linked_controls","review_frequency_months","next_review_date",
              "effective_date","expiration_date","business_process_id","org_entity_id"]:
        v = getattr(body, f, None)
        if v is not None: setattr(p, f, v)
    if body.status: p.status = PolicyStatus(body.status)
    await db.commit(); await db.refresh(p)
    return await _enrich(db, p)

@router.delete("/{pid}", status_code=204)
async def delete_policy(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
    # Delete child records before the policy to avoid FK constraint errors
    versions = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid))).scalars().all()
    attestations = (await db.execute(select(PolicyAttestation).where(PolicyAttestation.policy_id == pid))).scalars().all()
    for v in versions:
        await db.delete(v)
    for a in attestations:
        await db.delete(a)
    await db.delete(p)
    await db.commit()


# ── Versions ─────────────────────────────────────────────────────────────

@router.get("/{pid}/versions", response_model=list[VersionOut])
async def list_versions(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    return [VersionOut.model_validate(v) for v in (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid).order_by(PolicyVersion.version_number.desc()))).scalars().all()]

@router.post("/{pid}/versions", response_model=VersionOut, status_code=201)
async def create_version(pid: str, body: VersionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    # Get next version number
    max_v = (await db.execute(select(func.max(PolicyVersion.version_number)).where(PolicyVersion.policy_id == pid))).scalar() or 0
    # Mark old as not current
    old = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalars().all()  # noqa: E712
    for o in old: o.is_current = False
    v = PolicyVersion(policy_id=pid, version_number=max_v + 1, content=body.content,
                      change_summary=body.change_summary, is_current=True, authored_by_id=user.id)
    db.add(v); await db.flush(); await db.commit(); await db.refresh(v)
    return VersionOut.model_validate(v)

@router.patch("/{pid}/versions/{vid}/approve", response_model=VersionOut)
async def approve_version(pid: str, vid: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    r = await db.execute(select(PolicyVersion).where(PolicyVersion.id == vid, PolicyVersion.policy_id == pid))
    v = r.scalar_one_or_none()
    if not v: raise HTTPException(404, "Version not found")
    v.approved_by_id = user.id; v.approved_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(v)
    return VersionOut.model_validate(v)


@router.post("/{pid}/versions/{vid}/restore", response_model=VersionOut, status_code=201)
async def restore_version(
    pid: str,
    vid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Return a policy to an earlier version — "retour à l'état antérieur".

    History was previously readable but not actionable: an operator could see
    that version 3 was wrong and see what version 2 said, with no way to go
    back except retyping it.

    Restoring APPENDS rather than rewrites. The old content becomes a new
    current version, so the erroneous version stays in the record and the
    revert is itself a dated, attributed event. Deleting versions to "undo"
    would destroy the audit trail that makes the history worth keeping, and an
    auditor asking "what did this policy say last March, and who changed it"
    must still get an answer afterwards.
    """
    await _policy(db, pid, tenant_id)
    r = await db.execute(select(PolicyVersion).where(PolicyVersion.id == vid, PolicyVersion.policy_id == pid))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Version not found")
    if source.is_current:
        raise HTTPException(400, "That version is already the current one.")

    max_v = (await db.execute(
        select(func.max(PolicyVersion.version_number)).where(PolicyVersion.policy_id == pid)
    )).scalar() or 0

    current = (await db.execute(select(PolicyVersion).where(
        PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalars().all()  # noqa: E712
    for c in current:
        c.is_current = False

    restored = PolicyVersion(
        policy_id=pid,
        version_number=max_v + 1,
        content=source.content,
        change_summary=f"Restored from version {source.version_number}",
        is_current=True,
        authored_by_id=user.id,
    )
    db.add(restored)
    await db.flush()
    await db.commit()
    await db.refresh(restored)

    # A revert of an approved document is exactly the kind of change an auditor
    # looks for, so it is recorded explicitly rather than left as a generic
    # "POST /versions" in the request log.
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=user.id,
            user_email=user.email,
            action="restore",
            entity_type="policy",
            entity_id=pid,
            entity_name=None,
            details={
                "restored_from_version": source.version_number,
                "new_version": restored.version_number,
                "replaced_version": current[0].version_number if current else None,
            },
            origin="api",
        ))
    except Exception:
        pass

    return VersionOut.model_validate(restored)


# ── Attestations ─────────────────────────────────────────────────────────

@router.get("/{pid}/attestations", response_model=list[AttestationOut])
async def list_attestations(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    await _policy(db, pid, tenant_id)
    return [AttestationOut.model_validate(a) for a in (await db.execute(select(PolicyAttestation).where(PolicyAttestation.policy_id == pid).order_by(PolicyAttestation.created_at.desc()))).scalars().all()]

@router.post("/{pid}/attestations", response_model=list[AttestationOut], status_code=201)
async def create_attestations(pid: str, body: AttestationCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles(UserRole.POLICY_MANAGER, UserRole.CISO)), tenant_id: str = Depends(get_tenant_id)):
    p = await _policy(db, pid, tenant_id)
    # Verify each user_id belongs to this tenant (close cross-tenant IDOR).
    for uid in body.user_ids:
        await assert_user_in_tenant(db, uid, tenant_id, field_name="user_id")
    # Get current version
    cv = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalar_one_or_none()  # noqa: E712
    if not cv: raise HTTPException(400, "No current version to attest")
    created = []
    for uid in body.user_ids:
        att = PolicyAttestation(policy_id=pid, policy_version_id=cv.id, user_id=uid, due_date=body.due_date)
        db.add(att); created.append(att)
    await db.flush(); await db.commit()
    for a in created: await db.refresh(a)
    return [AttestationOut.model_validate(a) for a in created]

@router.patch("/{pid}/attestations/{aid}/acknowledge", response_model=AttestationOut)
async def acknowledge_attestation(pid: str, aid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(PolicyAttestation).where(PolicyAttestation.id == aid, PolicyAttestation.policy_id == pid, PolicyAttestation.user_id == user.id))
    att = r.scalar_one_or_none()
    if not att: raise HTTPException(404, "Attestation not found")
    att.status = AttestationStatus.ACKNOWLEDGED; att.acknowledged_at = datetime.utcnow().isoformat()
    await db.commit(); await db.refresh(att)
    return AttestationOut.model_validate(att)


# ── PDF Export ───────────────────────────────────────────────────────────

@router.get("/{pid}/export-pdf")
async def export_policy_pdf(pid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib.enums import TA_LEFT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

    p = await _policy(db, pid, tenant_id)
    cv = (await db.execute(select(PolicyVersion).where(PolicyVersion.policy_id == pid, PolicyVersion.is_current == True))).scalar_one_or_none()  # noqa: E712

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()

    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=22, spaceAfter=8, textColor=colors.HexColor("#0f172a"))
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=14, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1e3a5f"))
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=11, leading=16, textColor=colors.HexColor("#334155"))
    label_style = ParagraphStyle("Label", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#64748b"))

    story = []
    story.append(Paragraph(pdf_arabic.paragraph_markup(p.title, bold=True), h1))
    if p.policy_number:
        story.append(Paragraph(f"Policy No. {p.policy_number}", label_style))
    story.append(Spacer(1, 0.3*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 0.4*cm))

    meta = [
        ["Category", p.category or "—"],
        ["Status", p.status.replace("_", " ").title()],
        ["Review Cycle", f"{p.review_frequency_months} months"],
        ["Next Review", p.next_review_date or "—"],
        ["Version", f"v{cv.version_number}" if cv else "—"],
    ]
    tbl = Table(meta, colWidths=[4*cm, 13*cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 7),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
    ]))
    story.append(tbl)

    if p.description:
        story.append(Paragraph("Description", h2))
        story.append(Paragraph(pdf_arabic.paragraph_markup(p.description), body))

    if cv:
        story.append(Paragraph(f"Policy Content — v{cv.version_number}", h2))
        if cv.change_summary:
            story.append(Paragraph("Change summary: " + pdf_arabic.paragraph_markup(cv.change_summary), label_style))
        story.append(Spacer(1, 0.3*cm))
        for line in cv.content.split("\n"):
            if line.strip():
                story.append(Paragraph(pdf_arabic.paragraph_markup(line), body))
            else:
                story.append(Spacer(1, 0.25*cm))

    doc.build(story)
    buf.seek(0)
    safe_name = "".join(c if c.isalnum() or c in (" ", "_", "-") else "_" for c in p.title)
    ver = cv.version_number if cv else 1
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{safe_name}_v{ver}.pdf"'})
