"""Contract Collaboration endpoints — real-time negotiation between CISO and vendor.

Flow:
  1. CISO creates collaboration session from an existing contract → gets share link
  2. AI generates inline fix suggestions + action plan (via /ai/stream-contract-analysis)
  3. Both parties edit the working contract draft and chat
  4. Either party can mark their side as "agreed"
  5. When both sides agree → status → "agreed"
"""
from __future__ import annotations
import json
from datetime import datetime, timezone, timedelta
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.api.v1.dependencies import get_tenant_id
from app.api.v1.dependencies.auth import get_current_user
from app.models.user import User
from app.models.vendor import Vendor, VendorContract
from app.models.contract_collaboration import ContractCollaboration, ContractMessage
from app.models.notification import NotificationType
from app.services.notification_generator import (
    get_recipients_for_tenant,
    create_notification,
    notification_exists,
)

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _get_collab_by_token(share_token: str, db: AsyncSession) -> ContractCollaboration:
    result = await db.execute(
        select(ContractCollaboration).where(ContractCollaboration.share_token == share_token)
    )
    collab = result.scalar_one_or_none()
    if not collab:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collaboration not found")
    if collab.share_expires_at and _now() > collab.share_expires_at:
        raise HTTPException(status.HTTP_410_GONE, "Share link has expired")
    return collab


# ── Schemas ───────────────────────────────────────────────────────────────────

class CollabResponse(BaseModel):
    id: str
    vendor_id: str
    vendor_name: str
    contract_id: str
    status: str
    contract_text: str | None
    ai_suggestions: str | None    # JSON string
    action_plan: str | None       # JSON string
    share_token: str
    share_expires_at: str | None
    vendor_email: str | None
    agreed_at: str | None
    agreed_by_internal: bool
    agreed_by_vendor: bool
    plan_finalized_at: str | None
    agreement_document: str | None = None
    ciso_signed_at: str | None = None
    ciso_signature: str | None = None
    vendor_signed_at: str | None = None
    vendor_signature: str | None = None
    signed_contract_id: str | None = None
    created_at: str

    model_config = {"from_attributes": True}


class SignRequest(BaseModel):
    signature: str  # typed full name as signature


class MessageResponse(BaseModel):
    id: str
    collaboration_id: str
    sender_type: str
    sender_name: str
    message: str
    created_at: str

    model_config = {"from_attributes": True}


class CreateCollabRequest(BaseModel):
    contract_id: str
    vendor_email: str | None = None
    share_days: int = 30     # how long the share link is valid


class UpdateContentRequest(BaseModel):
    contract_text: str | None = None
    ai_suggestions: str | None = None
    action_plan: str | None = None


class SendMessageRequest(BaseModel):
    message: str
    sender_name: str | None = None   # optional override; defaults to current user name


class VendorMessageRequest(BaseModel):
    message: str
    sender_name: str = "Vendor"


class FinalizePlanRequest(BaseModel):
    """CISO submits real calendar deadlines for each action item."""
    deadlines: list[dict]  # [{id, deadline: "YYYY-MM-DD"}, ...]


class VendorActionItemRequest(BaseModel):
    """Vendor checks/unchecks an action plan item."""
    item_id: str
    done: bool


# ── Internal endpoints (authenticated) ───────────────────────────────────────

@router.post("", response_model=CollabResponse, status_code=201)
async def create_collaboration(
    body: CreateCollabRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Start a collaboration session for a contract.
    If one already exists (active or agreed) it is returned instead of creating a duplicate.
    """
    # Validate contract belongs to this tenant
    contract = (await db.execute(
        select(VendorContract).where(VendorContract.id == body.contract_id)
    )).scalar_one_or_none()
    if not contract:
        raise HTTPException(404, "Contract not found")

    vendor = (await db.execute(
        select(Vendor).where(Vendor.id == contract.vendor_id, Vendor.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, "Vendor not found in this tenant")

    # Return existing active collaboration if present
    existing = (await db.execute(
        select(ContractCollaboration).where(
            ContractCollaboration.contract_id == body.contract_id,
            ContractCollaboration.tenant_id == tenant_id,
            ContractCollaboration.status.in_(["active", "agreed"]),
        )
    )).scalar_one_or_none()
    if existing:
        return _collab_to_response(existing)

    expires = _now() + timedelta(days=body.share_days)
    collab = ContractCollaboration(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        vendor_name=vendor.name,
        contract_id=body.contract_id,
        status="active",
        contract_text=contract.extracted_text or "",
        vendor_email=body.vendor_email,
        share_expires_at=expires,
        created_by_id=current_user.id,
    )
    db.add(collab)
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.get("/{collab_id}", response_model=CollabResponse)
async def get_collaboration(
    collab_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    collab = await _require_collab(collab_id, tenant_id, db)
    return _collab_to_response(collab)


@router.put("/{collab_id}/content", response_model=CollabResponse)
async def update_content(
    collab_id: str,
    body: UpdateContentRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Update contract text, AI suggestions, or action plan."""
    collab = await _require_collab(collab_id, tenant_id, db)
    if body.contract_text is not None:
        collab.contract_text = body.contract_text
    if body.ai_suggestions is not None:
        collab.ai_suggestions = body.ai_suggestions
    if body.action_plan is not None:
        collab.action_plan = body.action_plan
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/{collab_id}/messages", response_model=MessageResponse, status_code=201)
async def send_message(
    collab_id: str,
    body: SendMessageRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    collab = await _require_collab(collab_id, tenant_id, db)
    name = body.sender_name or f"{current_user.first_name} {current_user.last_name}".strip() or current_user.email
    msg = ContractMessage(
        collaboration_id=collab.id,
        sender_type="internal",
        sender_name=name,
        message=body.message,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return _msg_to_response(msg)


@router.get("/{collab_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    collab_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    collab = await _require_collab(collab_id, tenant_id, db)
    result = await db.execute(
        select(ContractMessage)
        .where(ContractMessage.collaboration_id == collab.id)
        .order_by(ContractMessage.created_at)
    )
    return [_msg_to_response(m) for m in result.scalars().all()]


@router.post("/{collab_id}/agree", response_model=CollabResponse)
async def mark_agreed_internal(
    collab_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Mark the internal side as agreed. If vendor already agreed → finalise."""
    collab = await _require_collab(collab_id, tenant_id, db)
    collab.agreed_by_internal = True
    if collab.agreed_by_vendor:
        collab.status = "agreed"
        collab.agreed_at = _now()
        if not collab.agreement_document:
            collab.agreement_document = _generate_agreement_document(collab)
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/{collab_id}/finalize-plan", response_model=CollabResponse)
async def finalize_plan(
    collab_id: str,
    body: FinalizePlanRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """CISO locks the action plan with real calendar deadlines.
    Updates each action item's deadline field and stamps plan_finalized_at.
    """
    collab = await _require_collab(collab_id, tenant_id, db)

    # Parse current action plan
    try:
        plan: list[dict] = json.loads(collab.action_plan or "[]")
    except (json.JSONDecodeError, TypeError):
        plan = []

    # Build deadline lookup
    deadline_map = {d["id"]: d["deadline"] for d in body.deadlines if "id" in d and "deadline" in d}

    # Apply real deadlines to each item
    for item in plan:
        item_id = item.get("id")
        if item_id and item_id in deadline_map:
            item["deadline"] = deadline_map[item_id]

    collab.action_plan = json.dumps(plan)
    collab.plan_finalized_at = _now()
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


# ── Vendor-facing endpoints (token-based, no login required) ──────────────────

@router.get("/vendor/{share_token}", response_model=CollabResponse)
async def vendor_get_collaboration(
    share_token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Public endpoint — vendor accesses collaboration via share token."""
    collab = await _get_collab_by_token(share_token, db)
    return _collab_to_response(collab)


@router.put("/vendor/{share_token}/content", response_model=CollabResponse)
async def vendor_update_content(
    share_token: str,
    body: UpdateContentRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Vendor edits the working contract draft."""
    collab = await _get_collab_by_token(share_token, db)
    if collab.status not in ("active",):
        raise HTTPException(400, "Collaboration is closed")
    if body.contract_text is not None:
        collab.contract_text = body.contract_text
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/vendor/{share_token}/messages", response_model=MessageResponse, status_code=201)
async def vendor_send_message(
    share_token: str,
    body: VendorMessageRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    collab = await _get_collab_by_token(share_token, db)

    # Snapshot scalar values now — before any commit expires the ORM object
    _tenant_id   = collab.tenant_id
    _collab_id   = collab.id
    _vendor_name = collab.vendor_name

    msg = ContractMessage(
        collaboration_id=_collab_id,
        sender_type="vendor",
        sender_name=body.sender_name,
        message=body.message,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)   # msg.id is now populated

    # Create an in-app notification for every CISO/admin in this tenant.
    # msg.id is unique per message so every message gets its own notification.
    try:
        recipients = await get_recipients_for_tenant(db, _tenant_id)
        if recipients:
            preview = body.message[:100] + ("..." if len(body.message) > 100 else "")
            for user in recipients:
                # Skip only if this exact message already has a notification (prevents double-fire)
                already = await notification_exists(
                    db, user.id, NotificationType.VENDOR_ALERT, msg.id, within_days=1
                )
                if not already:
                    await create_notification(
                        db,
                        user=user,
                        notif_type=NotificationType.VENDOR_ALERT,
                        title=f"New message from {body.sender_name} ({_vendor_name})",
                        message=preview,
                        entity_id=msg.id,
                        entity_type="collab_message",
                        link=f"/vendors/collaboration/{_collab_id}",
                        severity="info",
                    )
            await db.commit()
    except Exception as exc:
        # Log but never block the message response
        print(f"[collab] notification error for msg {msg.id}: {exc}")

    return _msg_to_response(msg)


@router.get("/vendor/{share_token}/messages", response_model=list[MessageResponse])
async def vendor_list_messages(
    share_token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    collab = await _get_collab_by_token(share_token, db)
    result = await db.execute(
        select(ContractMessage)
        .where(ContractMessage.collaboration_id == collab.id)
        .order_by(ContractMessage.created_at)
    )
    return [_msg_to_response(m) for m in result.scalars().all()]


@router.post("/{collab_id}/sign", response_model=CollabResponse)
async def sign_agreement_internal(
    collab_id: str,
    body: SignRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """CISO digitally signs the agreement document."""
    collab = await _require_collab(collab_id, tenant_id, db)
    if collab.status != "agreed":
        raise HTTPException(400, "Collaboration must be in agreed status to sign")
    if collab.ciso_signed_at:
        raise HTTPException(400, "Already signed by client")

    # Generate agreement document now if it was never created (e.g. old collab agreed before signing was added)
    if not collab.agreement_document:
        collab.agreement_document = _generate_agreement_document(collab)

    collab.ciso_signature = body.signature
    collab.ciso_signed_at = _now().isoformat()
    collab.updated_at = _now()

    # If vendor already signed, finalize
    if collab.vendor_signed_at:
        await _create_signed_contract(collab, db)

    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/vendor/{share_token}/agree", response_model=CollabResponse)
async def vendor_mark_agreed(
    share_token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    collab = await _get_collab_by_token(share_token, db)
    collab.agreed_by_vendor = True
    if collab.agreed_by_internal:
        collab.status = "agreed"
        collab.agreed_at = _now()
        if not collab.agreement_document:
            collab.agreement_document = _generate_agreement_document(collab)
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/vendor/{share_token}/sign", response_model=CollabResponse)
async def vendor_sign_agreement(
    share_token: str,
    body: SignRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Vendor digitally signs the agreement document."""
    collab = await _get_collab_by_token(share_token, db)
    if collab.status != "agreed":
        raise HTTPException(400, "Collaboration must be in agreed status to sign")
    if collab.vendor_signed_at:
        raise HTTPException(400, "Already signed by vendor")

    # Generate agreement document now if it was never created
    if not collab.agreement_document:
        collab.agreement_document = _generate_agreement_document(collab)

    collab.vendor_signature = body.signature
    collab.vendor_signed_at = _now().isoformat()
    collab.updated_at = _now()

    # If CISO already signed, finalize
    if collab.ciso_signed_at:
        await _create_signed_contract(collab, db)

    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/vendor/{share_token}/action-item", response_model=CollabResponse)
async def vendor_update_action_item(
    share_token: str,
    body: VendorActionItemRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Vendor checks or unchecks an action plan item."""
    collab = await _get_collab_by_token(share_token, db)
    if collab.status not in ("active",):
        raise HTTPException(400, "Collaboration is closed")

    try:
        plan: list[dict] = json.loads(collab.action_plan or "[]")
    except (json.JSONDecodeError, TypeError):
        plan = []

    for item in plan:
        if str(item.get("id", "")) == str(body.item_id):
            item["done"] = body.done
            break

    collab.action_plan = json.dumps(plan)
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


# ── Private helpers ───────────────────────────────────────────────────────────

def _generate_agreement_document(collab: ContractCollaboration) -> str:
    """Generate a plain-text digital agreement document from collaboration data."""
    now_str = _now().strftime("%B %d, %Y at %H:%M UTC")

    # Parse action plan
    try:
        plan: list[dict] = json.loads(collab.action_plan or "[]")
    except Exception:
        plan = []

    # Parse suggestions
    try:
        suggestions: list[dict] = json.loads(collab.ai_suggestions or "[]")
    except Exception:
        suggestions = []

    lines = [
        "=" * 70,
        "MUTUAL DIGITAL AGREEMENT",
        "=" * 70,
        "",
        f"Date of Agreement: {now_str}",
        f"Vendor / Third Party: {collab.vendor_name}",
        "",
        "-" * 70,
        "1. PARTIES",
        "-" * 70,
        "This agreement is entered into between:",
        "  \u2022 Client Organization (Internal party)",
        f"  \u2022 {collab.vendor_name} (Vendor / Third Party)",
        "",
        "Both parties have reviewed the contract terms and negotiated modifications",
        "through the GRC Platform collaboration workspace.",
        "",
        "-" * 70,
        "2. AGREED CONTRACT TEXT",
        "-" * 70,
    ]

    contract_preview = (collab.contract_text or "").strip()
    if len(contract_preview) > 3000:
        contract_preview = contract_preview[:3000] + "\n... [full contract text on file] ..."
    lines.append(contract_preview or "(No contract text provided)")
    lines.append("")

    if plan:
        lines += [
            "-" * 70,
            "3. ACTION PLAN \u2014 AGREED COMMITMENTS",
            "-" * 70,
            "The following action items have been agreed upon by both parties:",
            "",
        ]
        for i, item in enumerate(plan, 1):
            status = "\u2713 COMPLETED" if item.get("done") else "\u25cb PENDING"
            deadline = item.get("deadline", "TBD")
            responsible = item.get("responsible", "TBD")
            priority = item.get("priority", "medium").upper()
            lines.append(f"  {i}. [{priority}] {item.get('action', '')}")
            lines.append(f"     Responsible: {responsible}  |  Deadline: {deadline}  |  {status}")
            lines.append("")

    accepted_issues = [s for s in suggestions if s.get("status") == "accepted"]
    if accepted_issues:
        lines += [
            "-" * 70,
            "4. ISSUES ADDRESSED",
            "-" * 70,
            "",
        ]
        for issue in accepted_issues:
            lines.append(f"  \u2022 [{issue.get('severity','').upper()}] {issue.get('clause','')} \u2014 {issue.get('issue','')}")
        lines.append("")

    lines += [
        "-" * 70,
        "5. SIGNATURES",
        "-" * 70,
        "",
        "By signing below, both parties confirm they have read, understood,",
        "and agree to the terms set out in this document.",
        "",
        "CLIENT SIGNATURE:",
        "  Name: ______________________________",
        "  Date: ______________________________",
        "",
        "VENDOR SIGNATURE:",
        "  Name: ______________________________",
        "  Date: ______________________________",
        "",
        "=" * 70,
        "This document was generated by the GRC Platform.",
        "Document ID: " + collab.id,
        "=" * 70,
    ]

    return "\n".join(lines)


async def _create_signed_contract(collab: ContractCollaboration, db: AsyncSession) -> None:
    """Create a VendorContract record representing the fully-executed signed agreement."""
    if collab.signed_contract_id:
        return  # already created

    # Build final document with actual signatures inserted
    doc = collab.agreement_document or _generate_agreement_document(collab)
    doc = doc.replace(
        "CLIENT SIGNATURE:\n  Name: ______________________________\n  Date: ______________________________",
        f"CLIENT SIGNATURE:\n  Name: {collab.ciso_signature}\n  Date: {collab.ciso_signed_at}"
    )
    doc = doc.replace(
        "VENDOR SIGNATURE:\n  Name: ______________________________\n  Date: ______________________________",
        f"VENDOR SIGNATURE:\n  Name: {collab.vendor_signature}\n  Date: {collab.vendor_signed_at}"
    )

    contract = VendorContract(
        vendor_id=collab.vendor_id,
        file_name=f"Signed Agreement \u2014 {collab.vendor_name} ({_now().strftime('%Y-%m-%d')}).txt",
        file_path=f"collab://{collab.id}",  # virtual path — no file on disk
        file_size=len(doc.encode()),
        extracted_text=doc,
        ai_review=None,
        review_status="completed",
        validation_status="signed",
        version=1,
    )
    db.add(contract)
    await db.flush()  # get the ID without committing
    collab.signed_contract_id = contract.id


async def _require_collab(collab_id: str, tenant_id: str, db: AsyncSession) -> ContractCollaboration:
    result = await db.execute(
        select(ContractCollaboration).where(
            ContractCollaboration.id == collab_id,
            ContractCollaboration.tenant_id == tenant_id,
        )
    )
    collab = result.scalar_one_or_none()
    if not collab:
        raise HTTPException(404, "Collaboration not found")
    return collab


def _collab_to_response(c: ContractCollaboration) -> CollabResponse:
    if hasattr(c.plan_finalized_at, "isoformat"):
        plan_finalized_at = c.plan_finalized_at.isoformat()
    elif c.plan_finalized_at:
        plan_finalized_at = str(c.plan_finalized_at)
    else:
        plan_finalized_at = None

    return CollabResponse(
        id=c.id,
        vendor_id=c.vendor_id,
        vendor_name=c.vendor_name,
        contract_id=c.contract_id,
        status=c.status,
        contract_text=c.contract_text,
        ai_suggestions=c.ai_suggestions,
        action_plan=c.action_plan,
        share_token=c.share_token,
        share_expires_at=c.share_expires_at.isoformat() if c.share_expires_at else None,
        vendor_email=c.vendor_email,
        agreed_at=c.agreed_at.isoformat() if c.agreed_at else None,
        agreed_by_internal=c.agreed_by_internal or False,
        agreed_by_vendor=c.agreed_by_vendor or False,
        plan_finalized_at=plan_finalized_at,
        agreement_document=c.agreement_document,
        ciso_signed_at=c.ciso_signed_at,
        ciso_signature=c.ciso_signature,
        vendor_signed_at=c.vendor_signed_at,
        vendor_signature=c.vendor_signature,
        signed_contract_id=c.signed_contract_id,
        created_at=c.created_at.isoformat() if c.created_at else "",
    )


def _msg_to_response(m: ContractMessage) -> MessageResponse:
    return MessageResponse(
        id=m.id,
        collaboration_id=m.collaboration_id,
        sender_type=m.sender_type,
        sender_name=m.sender_name,
        message=m.message,
        created_at=m.created_at.isoformat() if m.created_at else "",
    )
