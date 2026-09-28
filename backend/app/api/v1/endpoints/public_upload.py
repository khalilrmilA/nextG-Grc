"""Public evidence upload endpoints — no auth required, uses share tokens."""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import shared_state
from app.core.config import settings
from app.core.database import get_db
from app.core.security_utils import (
    assert_safe_upload_name,
    sanitize_filename,
    server_extension_for,
    verify_file_signature,
)
from app.models.compliance import ControlAssessment, Evidence, EvidenceType, UploadedDocument
from app.models.evidence_upload_token import EvidenceUploadToken
from app.models.framework import FrameworkControl
from app.models.mandatory_document import MandatoryDocument
from app.models.notification import Notification, NotificationStatus, NotificationType
from app.models.user import User, UserRole
from app.services import file_integrity
from app.services.ai_locale import get_request_language

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_MIME = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/plain",
}
MAX_FILE_SIZE = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

# Both routes here are opened by external stakeholders of the tenant — a supplier,
# an external auditor — from a link mailed to them, i.e. by people who have no
# account and never chose a language in the app. English-only errors on that page
# are the one place a bank's counterparty sees the product, so the detail strings
# follow the same local en/fr/ar table the authenticated modules use (vendors.py,
# trust_center.py); `lang` comes from Accept-Language, which the browser always sends.
_MESSAGES: dict[str, dict[str, str]] = {
    "rate_limited": {
        "en": "Too many requests. Please wait a few minutes and try again.",
        "fr": "Trop de requêtes. Veuillez patienter quelques minutes et réessayer.",
        "ar": "عدد كبير جداً من الطلبات. يرجى الانتظار بضع دقائق ثم المحاولة مجدداً.",
    },
    "link_not_found": {
        "en": "Upload link not found",
        "fr": "Lien de dépôt introuvable",
        "ar": "رابط الرفع غير موجود",
    },
    "link_revoked": {
        "en": "Upload link is invalid or has been revoked",
        "fr": "Le lien de dépôt est invalide ou a été révoqué",
        "ar": "رابط الرفع غير صالح أو تم إلغاؤه",
    },
    "link_expired": {
        "en": "Upload link has expired",
        "fr": "Le lien de dépôt a expiré",
        "ar": "انتهت صلاحية رابط الرفع",
    },
    "link_maxed": {
        "en": "Upload link has reached its maximum number of uses",
        "fr": "Le lien de dépôt a atteint son nombre maximal d'utilisations",
        "ar": "بلغ رابط الرفع الحد الأقصى لعدد مرات الاستخدام",
    },
    "file_too_large": {
        "en": "File exceeds {mb} MB limit",
        "fr": "Le fichier dépasse la limite de {mb} Mo",
        "ar": "يتجاوز الملف الحد المسموح به وهو {mb} ميغابايت",
    },
    "unsupported_type": {
        "en": "Unsupported file type. Only PDF, DOCX, XLSX, XLS, and TXT files are supported.",
        "fr": "Type de fichier non pris en charge. Seuls les fichiers PDF, DOCX, XLSX, XLS et TXT sont acceptés.",
        "ar": "نوع الملف غير مدعوم. الملفات المقبولة هي PDF وDOCX وXLSX وXLS وTXT فقط.",
    },
    "signature_mismatch": {
        "en": "File contents do not match the declared type.",
        "fr": "Le contenu du fichier ne correspond pas au type déclaré.",
        "ar": "محتوى الملف لا يطابق النوع المُعلن.",
    },
}


def _msg(key: str, lang: str, **values) -> str:
    table = _MESSAGES[key]
    text = table.get(lang) or table["en"]
    return text.format(**values) if values else text

# Who hears about a share link being opened / used. TENANT_ADMIN was dropped from
# both this set and the query below by the global role rename in 5e6598b ("fix
# tenant_admin"), which rewrote them to {CISO, CISO} / ["ciso", "ciso"] — so a
# tenant whose only admin is a tenant_admin has been receiving nothing since.
_NOTIFY_ROLES = {UserRole.TENANT_ADMIN, UserRole.CISO}

# ── Rate limits (per IP, counted in shared state so the cap holds across the two
# uvicorn workers — see app/core/shared_state.py). Both routes below are fully
# unauthenticated: the GET writes notification rows and the POST writes a file to
# the uploads volume, so neither may be unbounded.
_INFO_RATE_LIMIT, _INFO_RATE_WINDOW = 60, 600      # 60 link previews / 10 min
_UPLOAD_RATE_LIMIT, _UPLOAD_RATE_WINDOW = 20, 3600  # 20 uploads / hour


def _client_ip(request: Request) -> str:
    """The caller's address, not the gateway's.

    uvicorn runs WITHOUT --proxy-headers behind gateway.js (`--host 127.0.0.1 --port
    8000`), so ``request.client.host`` is 127.0.0.1 for every request that arrives
    through the front door. Keying on it collapses these per-IP buckets into ONE
    global bucket shared by the whole internet — 20 uploads an hour for every
    tenant's suppliers combined, and a single external auditor's session could lock
    the evidence-upload page for everyone else.

    gateway.js appends its own socket peer to any client-supplied X-Forwarded-For, so
    the LAST entry is the address our edge actually saw and is the only one a caller
    cannot forge. auth.py::_client_ip takes the FIRST entry deliberately — it is
    journalling what the client claimed, not gating on it.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        last = xff.split(",")[-1].strip()
        if last:
            return last[:64]
    return request.client.host if request.client else "unknown"


async def _check_rate_limit(request: Request, bucket: str, limit: int, window: int, lang: str = "en") -> None:
    ip = _client_ip(request)
    hits = await shared_state.incr(f"ratelimit:public_upload:{bucket}:{ip}", 1, window)
    if hits > limit:
        raise HTTPException(
            status_code=429,
            detail=_msg("rate_limited", lang),
        )


async def _notify_tenant_admins(
    db: AsyncSession,
    tenant_id: str,
    notif_type: NotificationType,
    title: str,
    message: str,
    link: str | None = None,
    *,
    title_key: str | None = None,
    message_key: str | None = None,
    params: dict | None = None,
) -> None:
    """Create an in-app notification for every admin/CISO in the tenant.

    title/message are the stored English; the key triple lets the feed render
    the row in each reader's language (services/notification_i18n).
    """
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            User.role.in_([r.value for r in _NOTIFY_ROLES]),
        )
    )
    for user in result.scalars().all():
        db.add(Notification(
            tenant_id=tenant_id,
            user_id=user.id,
            type=notif_type,
            status=NotificationStatus.UNREAD,
            title=title,
            message=message,
            title_key=title_key,
            message_key=message_key,
            params=params,
            data={"link": link} if link else {},
        ))


class ShareLinkInfo(BaseModel):
    token: str
    label: str | None
    instructions: str | None
    control_title: str | None
    control_identifier: str | None
    expires_at: str | None
    max_uses: int | None
    use_count: int
    is_valid: bool


@router.get("/evidence-upload/{token}", response_model=ShareLinkInfo)
async def get_share_link_info(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    lang: str = Depends(get_request_language),
):
    """Get information about an upload share link (no auth)."""
    await _check_rate_limit(request, "info", _INFO_RATE_LIMIT, _INFO_RATE_WINDOW, lang)
    tok = (await db.execute(
        select(EvidenceUploadToken).where(EvidenceUploadToken.token == token)
    )).scalar_one_or_none()

    if not tok:
        raise HTTPException(404, _msg("link_not_found", lang))

    # Resolve control info
    ca = (await db.execute(
        select(ControlAssessment).where(ControlAssessment.id == tok.control_assessment_id)
    )).scalar_one_or_none()

    ctrl_title = None
    ctrl_id = None
    if ca:
        fc = (await db.execute(
            select(FrameworkControl).where(FrameworkControl.id == ca.control_id)
        )).scalar_one_or_none()
        if fc:
            ctrl_title = fc.title
            ctrl_id = fc.control_id

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    is_expired = tok.expires_at is not None and tok.expires_at < now
    is_maxed = tok.max_uses is not None and tok.use_count >= tok.max_uses
    is_valid = tok.is_active and not is_expired and not is_maxed

    # Build the response BEFORE attempting the notification: an AsyncSession
    # rollback expires every loaded object, so reading tok.* after the except
    # branch below fired a lazy load in async context (MissingGreenlet -> 500),
    # which is exactly what that except exists to prevent — and any 5xx hard-
    # redirects the SPA to /service-down.
    info = ShareLinkInfo(
        token=tok.token,
        label=tok.label,
        instructions=tok.instructions,
        control_title=ctrl_title,
        control_identifier=ctrl_id,
        expires_at=tok.expires_at.isoformat() if tok.expires_at else None,
        max_uses=tok.max_uses,
        use_count=tok.use_count,
        is_valid=is_valid,
    )

    # Notify tenant admins that the link was opened (only when valid).
    if is_valid:
        try:
            link_label = tok.label or ctrl_id or "share link"
            ctrl_display = f" ({ctrl_id} — {ctrl_title})" if ctrl_id else ""
            await _notify_tenant_admins(
                db, tok.tenant_id,
                NotificationType.SHARE_LINK_VIEWED,
                title="Stakeholder opened upload link",
                message=f'The share link "{link_label}"{ctrl_display} was opened by an external stakeholder.',
                title_key="notifications.share_link_viewed.title",
                message_key="notifications.share_link_viewed.message",
                params={"link": link_label, "control_id": ctrl_id or None,
                        "control_title": ctrl_title if ctrl_id else None},
            )
            await db.commit()
        except Exception:
            # Non-fatal: the visitor still gets the link info. Logged rather
            # than swallowed silently so a broken notify path is visible.
            logger.exception("share-link view notification failed (token=%s)", tok.id)
            await db.rollback()

    return info


@router.post("/evidence-upload/{token}")
async def upload_evidence_via_token(
    token: str,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    lang: str = Depends(get_request_language),
):
    """Upload evidence via share token (no auth)."""
    await _check_rate_limit(request, "upload", _UPLOAD_RATE_LIMIT, _UPLOAD_RATE_WINDOW, lang)
    # Reject filenames whose extension must never reach the uploads
    # volume — see security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(file.filename, field_name="file")
    tok = (await db.execute(
        select(EvidenceUploadToken).where(EvidenceUploadToken.token == token)
    )).scalar_one_or_none()
    if not tok or not tok.is_active:
        raise HTTPException(403, _msg("link_revoked", lang))

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if tok.expires_at and tok.expires_at < now:
        raise HTTPException(403, _msg("link_expired", lang))
    if tok.max_uses is not None and tok.use_count >= tok.max_uses:
        raise HTTPException(403, _msg("link_maxed", lang))

    # Validate file size, declared MIME, and verify magic bytes match the
    # declared MIME (clients can spoof Content-Type otherwise).
    # Read one byte past the cap rather than the whole body: this route is
    # unauthenticated, and an unbounded read() pulls the entire multipart part
    # into this worker's memory before the size check can reject it.
    content = await file.read(MAX_FILE_SIZE + 1)
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, _msg("file_too_large", lang, mb=settings.MAX_UPLOAD_SIZE_MB))
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, _msg("unsupported_type", lang))
    if not verify_file_signature(content, file.content_type):
        raise HTTPException(415, _msg("signature_mismatch", lang))

    # Save file using a server-derived filename — never trust the client suffix.
    uploads_dir = Path(settings.UPLOADS_DIR)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    safe_display_name = sanitize_filename(file.filename, default="upload")
    ext = server_extension_for(file.content_type)
    file_id = str(uuid.uuid4())
    rel_path = f"evidence/{file_id}{ext}"
    full_path = uploads_dir / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    # Disk write off the event loop: a slow/contended uploads volume would
    # otherwise stall every other request this worker is serving.
    await asyncio.to_thread(full_path.write_bytes, content)
    # Hashed once and reused by both rows below (it was computed twice over the
    # same bytes) — same file on disk, so it must be the same digest.
    content_sha256 = file_integrity.sha256_bytes(content)

    # Create evidence record — use sanitized filename for display only
    evidence = Evidence(
        id=file_id,
        control_assessment_id=tok.control_assessment_id,
        tenant_id=tok.tenant_id,
        name=safe_display_name,
        file_name=safe_display_name,
        file_path=rel_path,
        file_size_bytes=len(content),
        file_sha256=content_sha256,
        content_type=file.content_type,
        evidence_type=EvidenceType.DOCUMENT,
        is_automated=False,
        is_visible_to_auditor=True,
        uploaded_by_id=None,
    )
    db.add(evidence)
    await db.flush()
    await file_integrity.record_version(
        db, tenant_id=tok.tenant_id, entity_type=file_integrity.EVIDENCE,
        entity_id=evidence.id, parent_type="control_assessment",
        parent_id=tok.control_assessment_id,
        file_path=rel_path, file_name=safe_display_name,
        file_sha256=evidence.file_sha256, file_size_bytes=len(content),
        content_type=file.content_type, uploaded_by_id=None,
        note="Uploaded via share link",
    )

    # Also create an UploadedDocument so the file appears in the Document Checklist tab
    ca = (await db.execute(
        select(ControlAssessment).where(ControlAssessment.id == tok.control_assessment_id)
    )).scalar_one_or_none()

    ctrl_id = None
    ctrl_title = None
    if ca:
        fc = (await db.execute(
            select(FrameworkControl).where(FrameworkControl.id == ca.control_id)
        )).scalar_one_or_none()
        if fc:
            ctrl_id = fc.control_id
            ctrl_title = fc.title

        # Try to match against a MandatoryDocument by clause_ref = fc.control_id (human-readable)
        doc_type_key = None
        if fc:
            md = (await db.execute(
                select(MandatoryDocument).where(MandatoryDocument.clause_ref == fc.control_id)
            )).scalar_one_or_none()
            if md:
                doc_type_key = md.document_type_key

        db.add(UploadedDocument(
            assessment_id=ca.assessment_id,
            tenant_id=tok.tenant_id,
            file_name=safe_display_name,
            file_path=rel_path,
            content_type=file.content_type,
            file_size_bytes=len(content),
            # Same bytes, same file on disk as the Evidence row above, so it
            # carries the same digest — otherwise this row is reported
            # "unrecorded" while its twin verifies, and the /documents download
            # guard has nothing to check against.
            file_sha256=content_sha256,
            document_type_key=doc_type_key,
            is_visible_to_auditor=True,
            uploaded_by_id=None,
        ))

    # Increment use count and commit the evidence/document records
    await db.execute(
        sa_update(EvidenceUploadToken)
        .where(EvidenceUploadToken.id == tok.id)
        .values(use_count=tok.use_count + 1)
    )
    await db.commit()

    # Notify tenant admins of the upload (non-fatal — commit already done above)
    try:
        link_label = tok.label or ctrl_id or "share link"
        ctrl_display = f" for {ctrl_id} — {ctrl_title}" if ctrl_id else ""
        size_kb = round(len(content) / 1024, 1)
        await _notify_tenant_admins(
            db, tok.tenant_id,
            NotificationType.SHARE_LINK_UPLOAD,
            title="New evidence file received",
            message=(
                f'A stakeholder uploaded "{safe_display_name}" ({size_kb} KB){ctrl_display} '
                f'via share link "{link_label}".'
            ),
            title_key="notifications.share_link_upload.title",
            message_key="notifications.share_link_upload.message",
            params={"file": safe_display_name, "size_kb": size_kb, "link": link_label,
                    "control_id": ctrl_id or None,
                    "control_title": ctrl_title if ctrl_id else None},
        )
        await db.commit()
    except Exception:
        # Non-fatal: the evidence is already committed above. Logged rather than
        # swallowed silently so a broken notify path is visible.
        logger.exception("share-link upload notification failed (token=%s)", tok.id)
        await db.rollback()

    return {"status": "uploaded", "file_name": safe_display_name, "evidence_id": file_id}
