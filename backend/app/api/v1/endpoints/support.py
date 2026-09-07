"""Support ticket endpoints with real-time chat via WebSocket and SSE notifications."""
from __future__ import annotations
import asyncio
import enum
import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, Query, status
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_current_user_ws
from app.models.user import User, UserRole
from app.models.support import SupportTicket, TicketMessage, ChatSession, TicketStatus, TicketPriority, ChatStatus

router = APIRouter()


# ── WebSocket connection manager ────────────────────────────────────────────

class _ChatManager:
    def __init__(self):
        self._rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, ticket_id: str, ws: WebSocket):
        await ws.accept()
        self._rooms.setdefault(ticket_id, []).append(ws)

    def disconnect(self, ticket_id: str, ws: WebSocket):
        room = self._rooms.get(ticket_id, [])
        if ws in room:
            room.remove(ws)
        if not room:
            self._rooms.pop(ticket_id, None)

    async def broadcast(self, ticket_id: str, payload: dict):
        for ws in list(self._rooms.get(ticket_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    def count(self, ticket_id: str) -> int:
        return len(self._rooms.get(ticket_id, []))


_manager = _ChatManager()


class _NotifyManager:
    """SSE-based notification manager — works through any WAF/proxy (plain HTTP)."""

    def __init__(self):
        self._user_queues: dict[str, list[asyncio.Queue]] = {}
        self._admin_queues: list[asyncio.Queue] = []

    def subscribe_user(self, user_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._user_queues.setdefault(user_id, []).append(q)
        return q

    def subscribe_admin(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._admin_queues.append(q)
        return q

    def unsubscribe_user(self, user_id: str, q: asyncio.Queue):
        qs = self._user_queues.get(user_id, [])
        if q in qs:
            qs.remove(q)
        if not qs:
            self._user_queues.pop(user_id, None)

    def unsubscribe_admin(self, q: asyncio.Queue):
        if q in self._admin_queues:
            self._admin_queues.remove(q)

    async def notify_user(self, user_id: str, payload: dict):
        for q in list(self._user_queues.get(user_id, [])):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def notify_admins(self, payload: dict):
        for q in list(self._admin_queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass


_notify = _NotifyManager()


# ── Pydantic schemas ────────────────────────────────────────────────────────

class TicketCreate(BaseModel):
    title: str
    description: str
    priority: TicketPriority = TicketPriority.MEDIUM


class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None


class MessageCreate(BaseModel):
    content: str


class SenderOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    role: str
    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: str
    ticket_id: str
    content: str
    is_support: bool
    sender: SenderOut
    created_at: datetime
    model_config = {"from_attributes": True}


class ChatSessionOut(BaseModel):
    id: str
    ticket_id: str
    status: ChatStatus
    requested_at: Optional[datetime]
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    model_config = {"from_attributes": True}


class TicketOut(BaseModel):
    id: str
    tenant_id: str
    user_id: str
    title: str
    description: str
    status: TicketStatus
    priority: TicketPriority
    created_at: datetime
    updated_at: datetime
    user: SenderOut
    messages: list[MessageOut] = []
    chat_session: Optional[ChatSessionOut] = None
    model_config = {"from_attributes": True}


class TicketListItem(BaseModel):
    id: str
    tenant_id: str
    user_id: str
    title: str
    status: TicketStatus
    priority: TicketPriority
    created_at: datetime
    updated_at: datetime
    user: SenderOut
    message_count: int = 0
    has_chat: bool = False
    model_config = {"from_attributes": True}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _is_support(user: User) -> bool:
    return user.role in (UserRole.SUPER_ADMIN,)


async def _fetch_full(ticket_id: str, db: AsyncSession) -> SupportTicket:
    """Re-fetch ticket with all relationships eagerly loaded (avoids MissingGreenlet on updated_at)."""
    result = await db.execute(
        select(SupportTicket)
        .where(SupportTicket.id == ticket_id)
        .options(
            selectinload(SupportTicket.user),
            selectinload(SupportTicket.messages).selectinload(TicketMessage.sender),
            selectinload(SupportTicket.chat_session),
        )
    )
    return result.scalar_one()


async def _get_ticket(ticket_id: str, user: User, db: AsyncSession, require_write: bool = False) -> SupportTicket:
    result = await db.execute(
        select(SupportTicket)
        .where(SupportTicket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # non-support users can only see their own tickets
    if not _is_support(user) and ticket.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return ticket


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/notify/stream")
async def notify_stream(
    request: Request,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """SSE notification channel — works through any WAF/proxy (plain HTTP GET)."""
    try:
        user = await get_current_user_ws(token=token, db=db)
    except Exception:
        return Response(status_code=401)

    is_admin = _is_support(user)
    queue = _notify.subscribe_admin() if is_admin else _notify.subscribe_user(user.id)

    async def event_stream():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            if is_admin:
                _notify.unsubscribe_admin(queue)
            else:
                _notify.unsubscribe_user(user.id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("", response_model=TicketOut, status_code=201)
async def create_ticket(
    body: TicketCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = SupportTicket(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        title=body.title,
        description=body.description,
        priority=body.priority,
    )
    db.add(ticket)
    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    return await _fetch_full(ticket.id, db)


@router.get("", response_model=list[TicketListItem])
async def list_tickets(
    status_filter: Optional[str] = Query(None, alias="status"),
    priority_filter: Optional[str] = Query(None, alias="priority"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(SupportTicket)
    if not _is_support(current_user):
        q = q.where(SupportTicket.user_id == current_user.id)
    if status_filter:
        q = q.where(SupportTicket.status == status_filter)
    if priority_filter:
        q = q.where(SupportTicket.priority == priority_filter)
    q = q.order_by(SupportTicket.created_at.desc())
    result = await db.execute(q)
    tickets = result.scalars().all()

    # Eager-load user for each
    out = []
    for t in tickets:
        await db.refresh(t, ["user", "messages", "chat_session"])
        item = TicketListItem(
            id=t.id,
            tenant_id=t.tenant_id,
            user_id=t.user_id,
            title=t.title,
            status=t.status,
            priority=t.priority,
            created_at=t.created_at,
            updated_at=t.updated_at,
            user=SenderOut.model_validate(t.user),
            message_count=len(t.messages),
            has_chat=t.chat_session is not None and t.chat_session.status != ChatStatus.ENDED,
        )
        out.append(item)
    return out


@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_ticket(ticket_id, current_user, db)
    return await _fetch_full(ticket_id, db)


@router.patch("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: str,
    body: TicketUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await _get_ticket(ticket_id, current_user, db)
    # only support can change status/priority
    if not _is_support(current_user):
        raise HTTPException(status_code=403, detail="Only support staff can update ticket status")
    if body.status is not None:
        ticket.status = body.status
        await _manager.broadcast(ticket_id, {"type": "status_changed", "status": body.status.value})
    if body.priority is not None:
        ticket.priority = body.priority
    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    return await _fetch_full(ticket_id, db)


@router.delete("/{ticket_id}", status_code=204)
async def delete_ticket(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await _get_ticket(ticket_id, current_user, db)
    if not _is_support(current_user) and ticket.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.delete(ticket)
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()


# ── Messages ─────────────────────────────────────────────────────────────────

@router.get("/{ticket_id}/messages", response_model=list[MessageOut])
async def list_messages(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_ticket(ticket_id, current_user, db)
    result = await db.execute(
        select(TicketMessage)
        .where(TicketMessage.ticket_id == ticket_id)
        .order_by(TicketMessage.created_at)
    )
    messages = result.scalars().all()
    for msg in messages:
        await db.refresh(msg, ["sender"])
    return messages


@router.post("/{ticket_id}/messages", response_model=MessageOut, status_code=201)
async def post_message(
    ticket_id: str,
    body: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await _get_ticket(ticket_id, current_user, db)
    is_sup = _is_support(current_user)
    msg = TicketMessage(
        ticket_id=ticket_id,
        sender_id=current_user.id,
        content=body.content,
        is_support=is_sup,
    )
    db.add(msg)
    # auto-update ticket status
    if is_sup and ticket.status == TicketStatus.OPEN:
        ticket.status = TicketStatus.IN_PROGRESS
    elif not is_sup and ticket.status == TicketStatus.WAITING_USER:
        ticket.status = TicketStatus.IN_PROGRESS
    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    await db.refresh(msg, ["sender"])

    payload = {
        "type": "message",
        "id": msg.id,
        "ticket_id": ticket_id,
        "ticket_title": ticket.title,
        "content": msg.content,
        "is_support": msg.is_support,
        "sender_name": f"{current_user.first_name} {current_user.last_name}",
        "created_at": msg.created_at.isoformat(),
    }
    # Broadcast to live-chat participants
    await _manager.broadcast(ticket_id, payload)
    # Real-time notification: support replied → notify the ticket owner
    if is_sup:
        await _notify.notify_user(ticket.user_id, payload)
    # Real-time notification: user replied → notify all connected super-admins
    else:
        await _notify.notify_admins(payload)
    return msg


# ── Chat session ──────────────────────────────────────────────────────────────

@router.post("/{ticket_id}/chat", response_model=ChatSessionOut, status_code=201)
async def request_chat(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Support requests a real-time chat session."""
    if not _is_support(current_user):
        raise HTTPException(status_code=403, detail="Only support staff can initiate chat")
    ticket = await _get_ticket(ticket_id, current_user, db)
    await db.refresh(ticket, ["chat_session"])

    if ticket.chat_session and ticket.chat_session.status == ChatStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Chat already active")

    if ticket.chat_session:
        # reuse / reset
        ticket.chat_session.status = ChatStatus.PENDING
        ticket.chat_session.requested_at = datetime.now(timezone.utc)
        ticket.chat_session.started_at = None
        ticket.chat_session.ended_at = None
        session = ticket.chat_session
    else:
        session = ChatSession(
            ticket_id=ticket_id,
            status=ChatStatus.PENDING,
            requested_at=datetime.now(timezone.utc),
        )
        db.add(session)

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    await db.refresh(session)

    # notify the ticket room that a chat was requested
    await _manager.broadcast(ticket_id, {
        "type": "chat_requested",
        "session_id": session.id,
        "status": session.status.value,
    })
    return session


@router.patch("/{ticket_id}/chat", response_model=ChatSessionOut)
async def update_chat(
    ticket_id: str,
    action: str = Query(..., description="accept | end"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """User accepts or either side ends the chat."""
    await _get_ticket(ticket_id, current_user, db)
    result = await db.execute(select(ChatSession).where(ChatSession.ticket_id == ticket_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="No chat session")

    if action == "accept":
        if _is_support(current_user):
            raise HTTPException(status_code=403, detail="Only user accepts chat")
        if session.status != ChatStatus.PENDING:
            raise HTTPException(status_code=400, detail="Chat not in pending state")
        session.status = ChatStatus.ACTIVE
        session.started_at = datetime.now(timezone.utc)
        await _manager.broadcast(ticket_id, {"type": "chat_accepted"})

    elif action == "end":
        session.status = ChatStatus.ENDED
        session.ended_at = datetime.now(timezone.utc)
        await _manager.broadcast(ticket_id, {"type": "chat_ended"})

    else:
        raise HTTPException(status_code=400, detail="action must be accept or end")

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/{ticket_id}/chat", response_model=Optional[ChatSessionOut])
async def get_chat_status(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_ticket(ticket_id, current_user, db)
    result = await db.execute(select(ChatSession).where(ChatSession.ticket_id == ticket_id))
    return result.scalar_one_or_none()


# ── WebSocket real-time chat ──────────────────────────────────────────────────

@router.websocket("/{ticket_id}/chat/ws")
async def chat_websocket(
    ticket_id: str,
    websocket: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Real-time bidirectional chat for an active ticket chat session."""
    # authenticate via token query param
    try:
        user = await get_current_user_ws(token=token, db=db)
    except Exception:
        await websocket.close(code=4001)
        return

    # verify ticket access
    result = await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        await websocket.close(code=4004)
        return
    if not _is_support(user) and ticket.user_id != user.id:
        await websocket.close(code=4003)
        return

    # verify chat session is active
    result = await db.execute(select(ChatSession).where(ChatSession.ticket_id == ticket_id))
    session = result.scalar_one_or_none()
    if not session or session.status != ChatStatus.ACTIVE:
        await websocket.close(code=4002)
        return

    await _manager.connect(ticket_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            content = data.get("content", "").strip()
            if not content:
                continue
            is_sup = _is_support(user)
            msg = TicketMessage(
                ticket_id=ticket_id,
                sender_id=user.id,
                content=content,
                is_support=is_sup,
            )
            db.add(msg)
            await db.flush()
            await db.refresh(msg)

            await _manager.broadcast(ticket_id, {
                "type": "message",
                "id": msg.id,
                "content": content,
                "is_support": is_sup,
                "sender_name": f"{user.first_name} {user.last_name}",
                "created_at": msg.created_at.isoformat(),
            })
    except WebSocketDisconnect:
        _manager.disconnect(ticket_id, websocket)
        await db.commit()
