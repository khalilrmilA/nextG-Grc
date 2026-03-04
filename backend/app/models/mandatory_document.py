"""Mandatory document model — documents required by compliance frameworks."""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, Boolean, Integer
from app.core.database import Base


class MandatoryDocument(Base):
    """
    A document required by a compliance framework for a specific clause.
    Seeded from framework reference materials (e.g. ISO 27001 mandatory doc list).
    """
    __tablename__ = "mandatory_documents"

    framework_short_name: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # "ISO27001"
    clause_ref: Mapped[str] = mapped_column(String(20), nullable=False)  # "6.1.3", "A.8.1"
    document_name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)  # slug key used for matching
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
