"""Action-plan attachments — STB objectif 3, « pièces justificatives ».

The requirement lists « pièces justificatives » alongside owner and dates as part of
what an action must carry. Today evidence can be attached to a *control assessment*
but never to an action item, so the proof that a corrective action was carried out
has nowhere to live.

The field set deliberately mirrors compliance.Evidence so the existing generic file
services apply unchanged: services/file_integrity.py records a version and a SHA-256
per upload, and services/file_retention.py can later purge superseded versions.

New table — created by create_all() on restart.
"""
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ActionItemAttachment(Base):
    """A file proving an action was performed."""

    __tablename__ = "action_item_attachments"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    action_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("action_items.id"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Same semantics as Evidence.file_sha256: NULL means "unrecorded", never
    # "tampered with".
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    is_visible_to_auditor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
