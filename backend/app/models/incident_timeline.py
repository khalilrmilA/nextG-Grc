"""Incident Timeline — timestamped entry-by-entry log for incident investigation."""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, ForeignKey
from app.core.database import Base


class IncidentTimelineEntry(Base):
    """A single timestamped entry in an incident's timeline."""
    __tablename__ = "incident_timeline_entries"

    incident_id: Mapped[str] = mapped_column(String(36), ForeignKey("incidents.id"), nullable=False, index=True)
    entry: Mapped[str] = mapped_column(Text, nullable=False)
    entry_type: Mapped[str] = mapped_column(String(50), nullable=False)  # detection, investigation, containment, eradication, recovery, communication, post_mortem
    observation: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[str] = mapped_column(String(30), nullable=False)  # ISO datetime of when this happened
    author_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
