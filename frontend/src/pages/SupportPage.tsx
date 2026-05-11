import { useState, useEffect, useRef, useCallback } from "react";
import {
  supportApi,
  type SupportTicketListItem,
  type SupportTicketDetail,
  type ChatSessionData,
  type TicketStatus,
  type TicketPriority,
} from "../api/endpoints";
import {
  Headphones, Plus, ChevronRight, MessageSquare, Clock,
  Loader2, Send, Video, PhoneOff, RefreshCw, X,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<TicketStatus, string> = {
  open:         "bg-blue-100 text-blue-700",
  in_progress:  "bg-amber-100 text-amber-700",
  waiting_user: "bg-purple-100 text-purple-700",
  resolved:     "bg-emerald-100 text-emerald-700",
  closed:       "bg-gray-100 text-gray-500",
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low:    "bg-gray-100 text-gray-500",
  medium: "bg-blue-100 text-blue-700",
  high:   "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PRIORITY_STYLES[priority]}`}>
      {priority}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ── Create Ticket Modal ───────────────────────────────────────────────────────

function CreateTicketModal({ onClose, onCreate }: { onClose: () => void; onCreate: (t: SupportTicketDetail) => void }) {
  const [title, setTitle]       = useState("");
  const [description, setDesc]  = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) { setError("Title and description are required."); return; }
    setSaving(true);
    try {
      const ticket = await supportApi.create({ title: title.trim(), description: description.trim(), priority });
      onCreate(ticket);
    } catch {
      setError("Failed to create ticket. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">New Support Ticket</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Brief description of your issue"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
            <textarea
              value={description} onChange={e => setDesc(e.target.value)}
              rows={5}
              placeholder="Describe your issue in detail — what you expected, what happened, and any steps to reproduce."
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Priority</label>
            <select
              value={priority} onChange={e => setPriority(e.target.value as TicketPriority)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────

function ChatPanel({
  ticket,
  chatSession,
  onChatUpdate,
}: {
  ticket: SupportTicketDetail;
  chatSession: ChatSessionData;
  onChatUpdate: (s: ChatSessionData) => void;
}) {
  const [msgs, setMsgs] = useState<{ id: string; content: string; is_support: boolean; sender_name: string; created_at: string }[]>([]);
  const [input, setInput] = useState("");
  const [wsReady, setWsReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  // Connect WebSocket when chat is active
  useEffect(() => {
    if (chatSession.status !== "active") return;
    const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token") || "";
    const wsBase = (import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1").replace(/^http/, "ws");
    const ws = new WebSocket(`${wsBase}/support/tickets/${ticket.id}/chat/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen  = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "message") {
          setMsgs(prev => [...prev, data]);
        } else if (data.type === "chat_ended") {
          onChatUpdate({ ...chatSession, status: "ended" });
        }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); };
  }, [chatSession.status, ticket.id]);

  function sendMessage() {
    const content = input.trim();
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ content }));
    setInput("");
  }

  async function endChat() {
    try {
      const updated = await supportApi.updateChat(ticket.id, "end");
      onChatUpdate(updated);
      wsRef.current?.close();
    } catch { /* ignore */ }
  }

  if (chatSession.status === "ended") return null;

  return (
    <div className="flex flex-col h-80 border border-blue-200 rounded-2xl overflow-hidden mt-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white">
        <Video className="w-4 h-4" />
        <span className="text-sm font-semibold flex-1">Live Chat with Support</span>
        {wsReady
          ? <span className="flex items-center gap-1 text-xs text-blue-200"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Connected</span>
          : <span className="text-xs text-blue-300">Connecting…</span>}
        <button onClick={endChat} className="ml-2 p-1 rounded-lg hover:bg-blue-700 transition-colors" title="End chat">
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
        {msgs.length === 0 && (
          <p className="text-center text-xs text-gray-400 mt-8">Chat started — say hello!</p>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.is_support ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-xs px-3 py-2 rounded-2xl text-sm ${m.is_support ? "bg-white border border-gray-200 text-gray-800" : "bg-blue-600 text-white"}`}>
              {m.is_support && <p className="text-xs font-semibold text-blue-600 mb-0.5">{m.sender_name}</p>}
              <p>{m.content}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 bg-white">
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="Type a message…"
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={!wsReady}
        />
        <button
          onClick={sendMessage}
          disabled={!wsReady || !input.trim()}
          className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Ticket Detail ─────────────────────────────────────────────────────────────

function TicketDetail({
  ticket: initial,
  onBack,
  onUpdated,
}: {
  ticket: SupportTicketDetail;
  onBack: () => void;
  onUpdated: (t: SupportTicketDetail) => void;
}) {
  const [ticket, setTicket]   = useState(initial);
  const [newMsg, setNewMsg]   = useState("");
  const [sending, setSending] = useState(false);
  const [chatSession, setChat] = useState<ChatSessionData | null>(ticket.chat_session);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ticket.messages]);

  // Poll chat status when session is pending (user waiting for request)
  useEffect(() => {
    if (!chatSession || chatSession.status !== "pending") return;
    const id = setInterval(async () => {
      try {
        const s = await supportApi.getChatStatus(ticket.id);
        if (s) setChat(s);
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(id);
  }, [chatSession?.status, ticket.id]);

  async function reload() {
    try {
      const t = await supportApi.get(ticket.id);
      setTicket(t);
      setChat(t.chat_session);
      onUpdated(t);
    } catch { /* ignore */ }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMsg.trim()) return;
    setSending(true);
    try {
      const msg = await supportApi.postMessage(ticket.id, newMsg.trim());
      setTicket(prev => ({ ...prev, messages: [...prev.messages, msg] }));
      setNewMsg("");
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  }

  async function acceptChat() {
    try {
      const s = await supportApi.updateChat(ticket.id, "accept");
      setChat(s);
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Back + title */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <ChevronRight className="w-5 h-5 rotate-180 text-gray-500" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900">{ticket.title}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <span className="text-xs text-gray-400">{fmtDate(ticket.created_at)}</span>
          </div>
        </div>
        <button onClick={reload} className="p-2 rounded-xl hover:bg-gray-100" title="Refresh">
          <RefreshCw className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Description */}
      <div className="bg-gray-50 rounded-2xl px-5 py-4 mb-5">
        <p className="text-sm font-semibold text-gray-500 mb-1">Description</p>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
      </div>

      {/* Chat request banner */}
      {chatSession && chatSession.status === "pending" && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3.5 mb-4">
          <Video className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-800">Support wants to chat with you live</p>
            <p className="text-xs text-blue-600">Accept to open a real-time chat window with the support team.</p>
          </div>
          <button onClick={acceptChat} className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
            Accept
          </button>
        </div>
      )}

      {/* Live chat panel */}
      {chatSession && chatSession.status === "active" && (
        <ChatPanel ticket={ticket} chatSession={chatSession} onChatUpdate={setChat} />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-4">
        {ticket.messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">No messages yet. Start by writing below.</p>
        )}
        {ticket.messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.is_support ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.is_support ? "bg-white border border-gray-200" : "bg-blue-600 text-white"}`}>
              <div className={`text-xs font-semibold mb-1 ${msg.is_support ? "text-blue-600" : "text-blue-200"}`}>
                {msg.is_support ? `Support — ${msg.sender.first_name} ${msg.sender.last_name}` : "You"} · {fmtDate(msg.created_at)}
              </div>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      {ticket.status !== "closed" && ticket.status !== "resolved" && (
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            value={newMsg} onChange={e => setNewMsg(e.target.value)}
            placeholder="Write a reply…"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={sending || !newMsg.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm font-semibold"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send
          </button>
        </form>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupportPage() {
  const [tickets, setTickets]         = useState<SupportTicketListItem[]>([]);
  const [selected, setSelected]       = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading]         = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const data = await supportApi.list(statusFilter !== "all" ? { status: statusFilter } : {});
      setTickets(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function openTicket(id: string) {
    try {
      const detail = await supportApi.get(id);
      setSelected(detail);
    } catch { /* ignore */ }
  }

  function handleCreate(ticket: SupportTicketDetail) {
    setShowCreate(false);
    setTickets(prev => [
      {
        id: ticket.id, tenant_id: ticket.tenant_id, user_id: ticket.user_id,
        title: ticket.title, status: ticket.status, priority: ticket.priority,
        created_at: ticket.created_at, updated_at: ticket.updated_at,
        user: ticket.user, message_count: 0, has_chat: false,
      },
      ...prev,
    ]);
    setSelected(ticket);
  }

  function handleUpdated(ticket: SupportTicketDetail) {
    setTickets(prev => prev.map(t => t.id === ticket.id
      ? { ...t, status: ticket.status, priority: ticket.priority, message_count: ticket.messages.length }
      : t
    ));
  }

  const STATUSES = ["all", "open", "in_progress", "waiting_user", "resolved", "closed"];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <Headphones className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Support</h1>
            <p className="text-sm text-gray-500">Submit and track your support requests</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 text-sm shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Ticket
        </button>
      </div>

      {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Ticket list */}
        <div className={`${selected ? "hidden lg:block" : ""} lg:col-span-2 space-y-4`}>
          {/* Filter */}
          <div className="flex gap-1 flex-wrap">
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${statusFilter === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Headphones className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-semibold">No tickets yet</p>
              <p className="text-sm mt-1">Click New Ticket to get help</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map(ticket => (
                <button
                  key={ticket.id}
                  onClick={() => openTicket(ticket.id)}
                  className={`w-full text-left border rounded-2xl px-5 py-4 hover:shadow-sm transition-all group ${selected?.id === ticket.id ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-semibold text-gray-900 text-sm leading-snug group-hover:text-blue-700 transition-colors">{ticket.title}</p>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={ticket.status} />
                    <PriorityBadge priority={ticket.priority} />
                    {ticket.has_chat && (
                      <span className="flex items-center gap-1 text-xs text-blue-600 font-semibold">
                        <Video className="w-3 h-3" />Chat
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{ticket.message_count}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDate(ticket.updated_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3">
          {selected ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 h-[70vh] flex flex-col">
              <TicketDetail
                ticket={selected}
                onBack={() => setSelected(null)}
                onUpdated={handleUpdated}
              />
            </div>
          ) : (
            <div className="hidden lg:flex bg-gray-50 border border-gray-200 rounded-2xl h-[70vh] items-center justify-center text-gray-400 flex-col gap-3">
              <MessageSquare className="w-10 h-10 opacity-30" />
              <p className="font-semibold">Select a ticket to view</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
