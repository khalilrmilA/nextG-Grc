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
import logging
from datetime import datetime, timezone, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from app.core.database import get_db
from app.api.v1.dependencies import get_tenant_id
from app.api.v1.dependencies.auth import get_current_user, require_roles
from app.models.user import User, UserRole
from app.models.vendor import Vendor, VendorContract
from app.models.contract_collaboration import ContractCollaboration, ContractMessage
from app.models.notification import NotificationType
from app.services import file_integrity
from app.services.ai_locale import get_request_language
from app.services.notification_generator import (
    get_recipients_for_tenant,
    create_notification,
    notification_exists,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ── User-facing messages (en | fr | ar) ───────────────────────────────────────
# Same shape as endpoints/regulatory.py: the caller's Accept-Language decides.
# Both parties of a negotiation read these — the vendor side is unauthenticated
# and often francophone — so none of them may stay English-only.

_MESSAGES: dict[str, dict[str, str]] = {
    "collab_not_found": {
        "en": "Collaboration not found",
        "fr": "Espace de collaboration introuvable",
        "ar": "مساحة التعاون غير موجودة",
    },
    "link_expired": {
        "en": "Share link has expired",
        "fr": "Le lien de partage a expiré",
        "ar": "انتهت صلاحية رابط المشاركة",
    },
    "contract_not_found": {
        "en": "Contract not found",
        "fr": "Contrat introuvable",
        "ar": "العقد غير موجود",
    },
    "collab_closed": {
        "en": "Collaboration is closed",
        "fr": "L'espace de collaboration est clôturé",
        "ar": "تم إغلاق مساحة التعاون",
    },
    "must_be_agreed": {
        "en": "Collaboration must be in agreed status to sign",
        "fr": "L'accord doit être conclu par les deux parties avant la signature",
        "ar": "يجب أن تكون الحالة \"متفق عليه\" قبل التوقيع",
    },
    "already_signed_client": {
        "en": "Already signed by client",
        "fr": "Déjà signé par le client",
        "ar": "تم التوقيع من قبل العميل بالفعل",
    },
    "already_signed_vendor": {
        "en": "Already signed by vendor",
        "fr": "Déjà signé par le fournisseur",
        "ar": "تم التوقيع من قبل المورّد بالفعل",
    },
}


def _msg(key: str, lang: str, **values) -> str:
    table = _MESSAGES[key]
    text = table.get(lang) or table["en"]
    return text.format(**values) if values else text


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _get_collab_by_token(share_token: str, db: AsyncSession, lang: str = "en") -> ContractCollaboration:
    result = await db.execute(
        select(ContractCollaboration).where(ContractCollaboration.share_token == share_token)
    )
    collab = result.scalar_one_or_none()
    if not collab:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _msg("collab_not_found", lang))
    if collab.share_expires_at and _now() > collab.share_expires_at:
        raise HTTPException(status.HTTP_410_GONE, _msg("link_expired", lang))
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
    current_user: Annotated[User, Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """Start a collaboration session for a contract.
    If one already exists (active or agreed) it is returned instead of creating a duplicate.
    """
    # Validate contract belongs to this tenant. A contract that exists in ANOTHER tenant
    # answers exactly like one that does not exist at all — the previous pair of distinct
    # messages let a caller tell the two apart, i.e. probe other tenants' contract ids.
    contract = (await db.execute(
        select(VendorContract).where(VendorContract.id == body.contract_id)
    )).scalar_one_or_none()
    if not contract:
        raise HTTPException(404, _msg("contract_not_found", lang))

    vendor = (await db.execute(
        select(Vendor).where(Vendor.id == contract.vendor_id, Vendor.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, _msg("contract_not_found", lang))

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
    lang: Annotated[str, Depends(get_request_language)],
):
    collab = await _require_collab(collab_id, tenant_id, db, lang)
    return _collab_to_response(collab)


@router.put("/{collab_id}/content", response_model=CollabResponse)
async def update_content(
    collab_id: str,
    body: UpdateContentRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """Update contract text, AI suggestions, or action plan."""
    collab = await _require_collab(collab_id, tenant_id, db, lang)
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
    current_user: Annotated[User, Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    lang: Annotated[str, Depends(get_request_language)],
):
    collab = await _require_collab(collab_id, tenant_id, db, lang)
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
    lang: Annotated[str, Depends(get_request_language)],
):
    collab = await _require_collab(collab_id, tenant_id, db, lang)
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
    current_user: Annotated[User, Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """Mark the internal side as agreed. If vendor already agreed → finalise."""
    collab = await _require_collab(collab_id, tenant_id, db, lang)
    if collab.status == "closed":
        raise HTTPException(400, _msg("collab_closed", lang))
    collab.agreed_by_internal = True
    # agreed_at and the agreement document are records of the moment the two sides met:
    # only stamped on the transition into "agreed", never re-stamped by a repeat call.
    if collab.agreed_by_vendor and collab.status != "agreed":
        collab.status = "agreed"
        collab.agreed_at = _now()
        if not collab.agreement_document:
            collab.agreement_document = _generate_agreement_document(collab, lang)
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/{collab_id}/finalize-plan", response_model=CollabResponse)
async def finalize_plan(
    collab_id: str,
    body: FinalizePlanRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """CISO locks the action plan with real calendar deadlines.
    Updates each action item's deadline field and stamps plan_finalized_at.
    """
    collab = await _require_collab(collab_id, tenant_id, db, lang)

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
    lang: Annotated[str, Depends(get_request_language)],
):
    """Public endpoint — vendor accesses collaboration via share token."""
    collab = await _get_collab_by_token(share_token, db, lang)
    return _collab_to_response(collab)


@router.put("/vendor/{share_token}/content", response_model=CollabResponse)
async def vendor_update_content(
    share_token: str,
    body: UpdateContentRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """Vendor edits the working contract draft."""
    collab = await _get_collab_by_token(share_token, db, lang)
    if collab.status not in ("active",):
        raise HTTPException(400, _msg("collab_closed", lang))
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
    lang: Annotated[str, Depends(get_request_language)],
):
    collab = await _get_collab_by_token(share_token, db, lang)

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
                        title_key="notifications.collab_vendor_message.title",
                        message_key="notifications.collab_vendor_message.message",
                        params={"sender": body.sender_name, "vendor": _vendor_name,
                                "preview": preview},
                    )
            await db.commit()
    except Exception:  # noqa: BLE001 — never block the message response on a notification failure
        # Logged with the traceback: this used to print to stdout, where nothing collects it.
        logger.exception("collab.vendor_message.notify_failed collab_id=%s msg_id=%s", _collab_id, msg.id)

    return _msg_to_response(msg)


@router.get("/vendor/{share_token}/messages", response_model=list[MessageResponse])
async def vendor_list_messages(
    share_token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    lang: Annotated[str, Depends(get_request_language)],
):
    collab = await _get_collab_by_token(share_token, db, lang)
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
    current_user: Annotated[User, Depends(require_roles(UserRole.VENDOR_MANAGER, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """CISO digitally signs the agreement document."""
    collab = await _require_collab(collab_id, tenant_id, db, lang)
    if collab.status != "agreed":
        raise HTTPException(400, _msg("must_be_agreed", lang))
    if collab.ciso_signed_at:
        raise HTTPException(400, _msg("already_signed_client", lang))

    # Generate agreement document now if it was never created (e.g. old collab agreed before signing was added)
    if not collab.agreement_document:
        collab.agreement_document = _generate_agreement_document(collab, lang)

    collab.ciso_signature = body.signature
    collab.ciso_signed_at = _now().isoformat()
    collab.updated_at = _now()

    # If vendor already signed, finalize
    if collab.vendor_signed_at:
        await _create_signed_contract(collab, db, lang)

    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/vendor/{share_token}/agree", response_model=CollabResponse)
async def vendor_mark_agreed(
    share_token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    lang: Annotated[str, Depends(get_request_language)],
):
    collab = await _get_collab_by_token(share_token, db, lang)
    # A closed negotiation cannot be re-opened from the share link (the other
    # vendor-side writes already refuse it); and agreed_at / the agreement
    # document are stamped once, on the transition, never by a repeat call.
    if collab.status == "closed":
        raise HTTPException(400, _msg("collab_closed", lang))
    collab.agreed_by_vendor = True
    if collab.agreed_by_internal and collab.status != "agreed":
        collab.status = "agreed"
        collab.agreed_at = _now()
        if not collab.agreement_document:
            collab.agreement_document = _generate_agreement_document(collab, lang)
    collab.updated_at = _now()
    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/vendor/{share_token}/sign", response_model=CollabResponse)
async def vendor_sign_agreement(
    share_token: str,
    body: SignRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """Vendor digitally signs the agreement document."""
    collab = await _get_collab_by_token(share_token, db, lang)
    if collab.status != "agreed":
        raise HTTPException(400, _msg("must_be_agreed", lang))
    if collab.vendor_signed_at:
        raise HTTPException(400, _msg("already_signed_vendor", lang))

    # Generate agreement document now if it was never created
    if not collab.agreement_document:
        collab.agreement_document = _generate_agreement_document(collab, lang)

    collab.vendor_signature = body.signature
    collab.vendor_signed_at = _now().isoformat()
    collab.updated_at = _now()

    # If CISO already signed, finalize
    if collab.ciso_signed_at:
        await _create_signed_contract(collab, db, lang)

    await db.commit()
    await db.refresh(collab)
    return _collab_to_response(collab)


@router.post("/vendor/{share_token}/action-item", response_model=CollabResponse)
async def vendor_update_action_item(
    share_token: str,
    body: VendorActionItemRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    lang: Annotated[str, Depends(get_request_language)],
):
    """Vendor checks or unchecks an action plan item."""
    collab = await _get_collab_by_token(share_token, db, lang)
    if collab.status not in ("active",):
        raise HTTPException(400, _msg("collab_closed", lang))

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

# The signature placeholders are part of the document both parties read before they
# sign; they are filled in verbatim by _insert_signatures() once both signatures exist.
_SIG_BLANK = "_" * 30

# Agreement wording per UI language. The document is the artefact the vendor is asked
# to sign, so it follows the language of the party who triggered its generation (same
# rule as the AI contract review in endpoints/vendors.py). Priority/severity words come
# from the AI payload and stay as they are — they are identifiers, not prose.
_AGREEMENT_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "colon": ": ",
        "date_fmt": "%B %d, %Y at %H:%M UTC",
        "title": "MUTUAL DIGITAL AGREEMENT",
        "date_of": "Date of Agreement",
        "vendor_of": "Vendor / Third Party",
        "s1": "1. PARTIES",
        "between": "This agreement is entered into between:",
        "client_party": "Client Organization (Internal party)",
        "vendor_party": "(Vendor / Third Party)",
        "negotiated": "Both parties have reviewed the contract terms and negotiated modifications\nthrough the GRC Platform collaboration workspace.",
        "s2": "2. AGREED CONTRACT TEXT",
        "no_text": "(No contract text provided)",
        "more_text": "... [full contract text on file] ...",
        "s3": "3. ACTION PLAN \u2014 AGREED COMMITMENTS",
        "plan_intro": "The following action items have been agreed upon by both parties:",
        "responsible": "Responsible",
        "deadline": "Deadline",
        "tbd": "TBD",
        "done": "\u2713 COMPLETED",
        "pending": "\u25cb PENDING",
        "s4": "4. ISSUES ADDRESSED",
        "s5": "5. SIGNATURES",
        "sign_intro": "By signing below, both parties confirm they have read, understood,\nand agree to the terms set out in this document.",
        "client_sig": "CLIENT SIGNATURE:",
        "vendor_sig": "VENDOR SIGNATURE:",
        "name": "Name",
        "date": "Date",
        "footer": "This document was generated by the GRC Platform.",
        "doc_id": "Document ID",
        "file_name": "Signed Agreement",
    },
    "fr": {
        "colon": " : ",     # French typography: a space before the colon
        # No %B: month names would come out in English on the server locale.
        "date_fmt": "%d/%m/%Y à %H:%M UTC",
        "title": "ACCORD NUMÉRIQUE MUTUEL",
        "date_of": "Date de l'accord",
        "vendor_of": "Fournisseur / Tiers",
        "s1": "1. PARTIES",
        "between": "Le présent accord est conclu entre :",
        "client_party": "Organisation cliente (partie interne)",
        "vendor_party": "(Fournisseur / Tiers)",
        "negotiated": "Les deux parties ont examiné les clauses du contrat et négocié les modifications\ndans l'espace de collaboration de la plateforme GRC.",
        "s2": "2. TEXTE CONTRACTUEL CONVENU",
        "no_text": "(Aucun texte contractuel fourni)",
        "more_text": "... [texte intégral du contrat archivé] ...",
        "s3": "3. PLAN D'ACTION \u2014 ENGAGEMENTS CONVENUS",
        "plan_intro": "Les actions suivantes ont été convenues par les deux parties :",
        "responsible": "Responsable",
        "deadline": "Échéance",
        "tbd": "À définir",
        "done": "\u2713 RÉALISÉ",
        "pending": "\u25cb EN COURS",
        "s4": "4. POINTS TRAITÉS",
        "s5": "5. SIGNATURES",
        "sign_intro": "En signant ci-dessous, les deux parties confirment avoir lu, compris\net accepté les termes énoncés dans le présent document.",
        "client_sig": "SIGNATURE DU CLIENT :",
        "vendor_sig": "SIGNATURE DU FOURNISSEUR :",
        "name": "Nom",
        "date": "Date",
        "footer": "Ce document a été généré par la plateforme GRC.",
        "doc_id": "Identifiant du document",
        "file_name": "Accord signé",
    },
    "ar": {
        "colon": ": ",
        "date_fmt": "%Y-%m-%d %H:%M UTC",
        "title": "اتفاق رقمي متبادل",
        "date_of": "تاريخ الاتفاق",
        "vendor_of": "المورّد / الطرف الثالث",
        "s1": "1. الأطراف",
        "between": "يُبرم هذا الاتفاق بين:",
        "client_party": "المؤسسة العميلة (الطرف الداخلي)",
        "vendor_party": "(المورّد / الطرف الثالث)",
        "negotiated": "راجع الطرفان بنود العقد وتفاوضا على التعديلات\nفي مساحة التعاون بمنصة GRC.",
        "s2": "2. نص العقد المتفق عليه",
        "no_text": "(لم يُقدّم نص للعقد)",
        "more_text": "... [النص الكامل للعقد محفوظ] ...",
        "s3": "3. خطة العمل \u2014 الالتزامات المتفق عليها",
        "plan_intro": "اتفق الطرفان على بنود العمل التالية:",
        "responsible": "المسؤول",
        "deadline": "الموعد النهائي",
        "tbd": "يُحدّد لاحقاً",
        "done": "\u2713 مكتمل",
        "pending": "\u25cb قيد التنفيذ",
        "s4": "4. النقاط التي تمت معالجتها",
        "s5": "5. التوقيعات",
        "sign_intro": "بالتوقيع أدناه، يؤكد الطرفان أنهما قرأا وفهما\nووافقا على البنود الواردة في هذا المستند.",
        "client_sig": "توقيع العميل:",
        "vendor_sig": "توقيع المورّد:",
        "name": "الاسم",
        "date": "التاريخ",
        "footer": "تم إنشاء هذا المستند بواسطة منصة GRC.",
        "doc_id": "معرّف المستند",
        "file_name": "اتفاق موقّع",
    },
}


def _labels(lang: str) -> dict[str, str]:
    return _AGREEMENT_LABELS.get(lang) or _AGREEMENT_LABELS["en"]


def _signature_block(L: dict[str, str], party: str, name: str | None = None, when: str | None = None) -> str:
    """The three lines of one signature block — blank, or filled with a real signature."""
    return "\n".join([
        L[party],
        "  %s%s" % (L["name"] + L["colon"], name or _SIG_BLANK),
        "  %s%s" % (L["date"] + L["colon"], when or _SIG_BLANK),
    ])


def _generate_agreement_document(collab: ContractCollaboration, lang: str = "en") -> str:
    """Generate a plain-text digital agreement document from collaboration data."""
    L = _labels(lang)
    now_str = _now().strftime(L["date_fmt"])

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
        L["title"],
        "=" * 70,
        "",
        f"{L['date_of']}{L['colon']}{now_str}",
        f"{L['vendor_of']}{L['colon']}{collab.vendor_name}",
        "",
        "-" * 70,
        L["s1"],
        "-" * 70,
        L["between"],
        "  \u2022 " + L["client_party"],
        f"  \u2022 {collab.vendor_name} {L['vendor_party']}",
        "",
        L["negotiated"],
        "",
        "-" * 70,
        L["s2"],
        "-" * 70,
    ]

    contract_preview = (collab.contract_text or "").strip()
    if len(contract_preview) > 3000:
        contract_preview = contract_preview[:3000] + "\n" + L["more_text"]
    lines.append(contract_preview or L["no_text"])
    lines.append("")

    if plan:
        lines += [
            "-" * 70,
            L["s3"],
            "-" * 70,
            L["plan_intro"],
            "",
        ]
        for i, item in enumerate(plan, 1):
            state = L["done"] if item.get("done") else L["pending"]
            deadline = item.get("deadline") or L["tbd"]
            responsible = item.get("responsible") or L["tbd"]
            # `or` not a dict default: the plan is client-supplied JSON, and an item
            # whose priority/action key is present but null used to crash this whole
            # document generator (and with it the signing step) on .upper().
            priority = str(item.get("priority") or "medium").upper()
            lines.append(f"  {i}. [{priority}] {item.get('action') or ''}")
            lines.append(f"     {L['responsible']}{L['colon']}{responsible}  |  {L['deadline']}{L['colon']}{deadline}  |  {state}")
            lines.append("")

    accepted_issues = [s for s in suggestions if s.get("status") == "accepted"]
    if accepted_issues:
        lines += [
            "-" * 70,
            L["s4"],
            "-" * 70,
            "",
        ]
        for issue in accepted_issues:
            lines.append(f"  \u2022 [{str(issue.get('severity') or '').upper()}] {issue.get('clause') or ''} \u2014 {issue.get('issue') or ''}")
        lines.append("")

    lines += [
        "-" * 70,
        L["s5"],
        "-" * 70,
        "",
        L["sign_intro"],
        "",
        _signature_block(L, "client_sig"),
        "",
        _signature_block(L, "vendor_sig"),
        "",
        "=" * 70,
        L["footer"],
        L["doc_id"] + L["colon"] + collab.id,
        "=" * 70,
    ]

    return "\n".join(lines)


def _insert_signatures(doc: str, collab: ContractCollaboration) -> str:
    """Fill both signature blocks in ``doc`` with the signatures actually collected.

    The document may have been generated in any of the three languages (whichever the
    party who closed the agreement was using) and the language is not stored, so every
    label set is tried; only the one the document was written in matches.
    """
    for L in _AGREEMENT_LABELS.values():
        doc = doc.replace(
            _signature_block(L, "client_sig"),
            _signature_block(L, "client_sig", collab.ciso_signature, collab.ciso_signed_at),
        )
        doc = doc.replace(
            _signature_block(L, "vendor_sig"),
            _signature_block(L, "vendor_sig", collab.vendor_signature, collab.vendor_signed_at),
        )
    return doc


async def _create_signed_contract(collab: ContractCollaboration, db: AsyncSession, lang: str = "en") -> None:
    """Create a VendorContract record representing the fully-executed signed agreement."""
    if collab.signed_contract_id:
        return  # already created

    # Build final document with actual signatures inserted
    doc = _insert_signatures(collab.agreement_document or _generate_agreement_document(collab, lang), collab)

    # Continue the vendor's contract version series. This used to be hard-coded to 1,
    # which gave the signed agreement the same version number as the uploaded contract
    # it came from (and made the next upload skip a number, since that one counts rows).
    last_version = (await db.execute(
        select(func.max(VendorContract.version)).where(VendorContract.vendor_id == collab.vendor_id)
    )).scalar()

    body = doc.encode()
    contract = VendorContract(
        vendor_id=collab.vendor_id,
        # Same language as the agreement itself — this name is what the contracts list shows.
        file_name=f"{_labels(lang)['file_name']} \u2014 {collab.vendor_name} ({_now().strftime('%Y-%m-%d')}).txt",
        file_path=f"collab://{collab.id}",  # virtual path — no file on disk
        file_size=len(body),
        # The executed agreement is an issued document: record its digest like every other
        # contract version so a later read can be checked against what was signed.
        file_sha256=file_integrity.sha256_bytes(body),
        extracted_text=doc,
        ai_review=None,
        review_status="completed",
        validation_status="signed",
        version=int(last_version or 0) + 1,
    )
    db.add(contract)
    await db.flush()  # get the ID without committing

    # Put the executed agreement in the same version series as the vendor's uploaded
    # contracts. Without this it was the one contract document outside the retention /
    # verification machinery — a digest with nothing to check it against, and no
    # "what was attached before" entry when the next version is uploaded. The virtual
    # path is what file_retention already expects here (see unresolvable_reason: a
    # ``collab://<id>`` row has no bytes on disk and must never be purge-resolved), and
    # is_absolute_path matches how upload_vendor_contract records the real files.
    # record_version writes into THIS session; both callers commit right after.
    await file_integrity.record_version(
        db, tenant_id=collab.tenant_id, entity_type=file_integrity.CONTRACT,
        entity_id=contract.id, parent_type="vendor", parent_id=collab.vendor_id,
        file_path=contract.file_path, file_name=contract.file_name,
        file_sha256=contract.file_sha256, file_size_bytes=len(body),
        content_type="text/plain", is_absolute_path=True,
        note="Executed agreement signed by both parties",
    )

    collab.signed_contract_id = contract.id


async def _require_collab(collab_id: str, tenant_id: str, db: AsyncSession,
                          lang: str = "en") -> ContractCollaboration:
    result = await db.execute(
        select(ContractCollaboration).where(
            ContractCollaboration.id == collab_id,
            ContractCollaboration.tenant_id == tenant_id,
        )
    )
    collab = result.scalar_one_or_none()
    if not collab:
        raise HTTPException(404, _msg("collab_not_found", lang))
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
