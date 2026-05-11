"""Support ticket models."""
import enum
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, DateTime
from app.core.database import Base


class TicketStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING_USER = "waiting_user"
    RESOLVED = "resolved"
    CLOSED = "closed"


class TicketPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class ChatStatus(str, enum.Enum):
    PENDING = "pending"   # support requested chat, waiting for user
    ACTIVE = "active"     # user accepted, chat in progress
    ENDED = "ended"       # chat ended by either side


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[TicketStatus] = mapped_column(
        SAEnum(TicketStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=TicketStatus.OPEN, index=True
    )
    priority: Mapped[TicketPriority] = mapped_column(
        SAEnum(TicketPriority, values_callable=lambda x: [e.value for e in x]), nullable=False, default=TicketPriority.MEDIUM, index=True
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    messages: Mapped[list["TicketMessage"]] = relationship(
        "TicketMessage", back_populates="ticket", cascade="all, delete-orphan", order_by="TicketMessage.created_at"
    )
    chat_session: Mapped["ChatSession | None"] = relationship(
        "ChatSession", back_populates="ticket", uselist=False, cascade="all, delete-orphan"
    )


class TicketMessage(Base):
    __tablename__ = "ticket_messages"

    ticket_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("support_tickets.id"), nullable=False, index=True
    )
    sender_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_support: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    ticket: Mapped["SupportTicket"] = relationship("SupportTicket", back_populates="messages")
    sender: Mapped["User"] = relationship("User", foreign_keys=[sender_id])


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    ticket_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("support_tickets.id"), nullable=False, unique=True, index=True
    )
    status: Mapped[ChatStatus] = mapped_column(
        SAEnum(ChatStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=ChatStatus.PENDING
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    ticket: Mapped["SupportTicket"] = relationship("SupportTicket", back_populates="chat_session")
