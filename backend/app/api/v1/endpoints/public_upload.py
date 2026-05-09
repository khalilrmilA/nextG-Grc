"""Public evidence upload endpoints — no auth required, uses share tokens."""
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security_utils import (
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

router = APIRouter()

ALLOWED_MIME = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
MAX_FILE_SIZE = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

_NOTIFY_ROLES = {UserRole.TENANT_ADMIN, UserRole.CISO}


async def _notify_tenant_admins(
    db: AsyncSession,
    tenant_id: str,
    notif_type: NotificationType,
    title: str,
    message: str,
    link: str | None = None,
) -> None:
    """Create an in-app notification for every admin/CISO in the tenant."""
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
            User.role.in_(["tenant_admin", "ciso"]),
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
async def get_share_link_info(token: str, db: AsyncSession = Depends(get_db)):
    """Get information about an upload share link (no auth)."""
    tok = (await db.execute(
        select(EvidenceUploadToken).where(EvidenceUploadToken.token == token)
    )).scalar_one_or_none()

    if not tok:
        raise HTTPException(404, "Upload link not found")

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

    # Notify tenant admins that the link was opened (only when valid)
    if is_valid:
        try:
            link_label = tok.label or ctrl_id or "share link"
            ctrl_display = f" ({ctrl_id} — {ctrl_title})" if ctrl_id else ""
            await _notify_tenant_admins(
                db, tok.tenant_id,
                NotificationType.SHARE_LINK_VIEWED,
                title="Stakeholder opened upload link",
                message=f'The share link "{link_label}"{ctrl_display} was opened by an external stakeholder.',
            )
            await db.commit()
        except Exception:
            await db.rollback()

    return ShareLinkInfo(
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


@router.post("/evidence-upload/{token}")
async def upload_evidence_via_token(
    token: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload evidence via share token (no auth)."""
    tok = (await db.execute(
        select(EvidenceUploadToken).where(EvidenceUploadToken.token == token)
    )).scalar_one_or_none()
    if not tok or not tok.is_active:
        raise HTTPException(403, "Upload link is invalid or has been revoked")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if tok.expires_at and tok.expires_at < now:
        raise HTTPException(403, "Upload link has expired")
    if tok.max_uses is not None and tok.use_count >= tok.max_uses:
        raise HTTPException(403, "Upload link has reached its maximum number of uses")

    # Validate file size, declared MIME, and verify magic bytes match the
    # declared MIME (clients can spoof Content-Type otherwise).
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, "Unsupported file type. Only PDF, DOCX, and TXT files are supported.")
    if not verify_file_signature(content, file.content_type):
        raise HTTPException(415, "File contents do not match the declared type.")

    # Save file using a server-derived filename — never trust the client suffix.
    uploads_dir = Path(settings.UPLOADS_DIR)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    safe_display_name = sanitize_filename(file.filename, default="upload")
    ext = server_extension_for(file.content_type)
    file_id = str(uuid.uuid4())
    rel_path = f"evidence/{file_id}{ext}"
    full_path = uploads_dir / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)

    # Create evidence record — use sanitized filename for display only
    evidence = Evidence(
        id=file_id,
        control_assessment_id=tok.control_assessment_id,
        tenant_id=tok.tenant_id,
        name=safe_display_name,
        file_name=safe_display_name,
        file_path=rel_path,
        file_size_bytes=len(content),
        content_type=file.content_type,
        evidence_type=EvidenceType.DOCUMENT,
        is_automated=False,
        is_visible_to_auditor=True,
        uploaded_by_id=None,
    )
    db.add(evidence)

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
        )
        await db.commit()
    except Exception:
        await db.rollback()

    return {"status": "uploaded", "file_name": safe_display_name, "evidence_id": file_id}
