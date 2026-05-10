import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  MessageSquare, X, Send, Loader2, ChevronDown, RotateCcw,
  Sparkles, Shield, CheckCircle, FileText, AlertTriangle, Building2,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

const QUICK_QUESTIONS = [
  { icon: Shield,        labelKey: "q_what",       textKey: "q_what_text" },
  { icon: CheckCircle,   labelKey: "q_frameworks", textKey: "q_frameworks_text" },
  { icon: FileText,      labelKey: "q_ai",         textKey: "q_ai_text" },
  { icon: AlertTriangle, labelKey: "q_risk",       textKey: "q_risk_text" },
  { icon: Building2,     labelKey: "q_vendor",     textKey: "q_vendor_text" },
] as const;

// Topics the frontend refuses before even calling the API
const BLOCKED_KEYWORDS = [
  "source code", "api key", "api token", "secret", "how is it built",
  "what model", "which model", "openai", "anthropic", "gpt", "llm",
  "python", "javascript", "sql", "database", "endpoint", "how to hack",
  "exploit", "vulnerability in", "penetration test",
];

function isBlocked(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_KEYWORDS.some(kw => lower.includes(kw));
}

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

type StreamCbs = { onToken: (t: string) => void; onDone: () => void };

function makeThinkFilter() {
  let inside = false;
  let buf = "";
  return function filter(raw: string): string {
    buf += raw;
    let out = "";
    while (buf.length > 0) {
      if (inside) {
        const ci = buf.indexOf("</think>");
        if (ci === -1) { buf = buf.length > 8 ? buf.slice(-8) : buf; return out; }
        inside = false;
        buf = buf.slice(ci + 8).replace(/^\n+/, "");
      } else {
        const oi = buf.indexOf("<think>");
        if (oi === -1) { out += buf; buf = ""; }
        else { out += buf.slice(0, oi); inside = true; buf = buf.slice(oi + 7); }
      }
    }
    return out;
  };
}

async function streamSupport(
  messages: { role: string; content: string }[],
  cbs: StreamCbs,
  signal: AbortSignal,
) {
  const resp = await fetch(`${API_BASE}/public/support-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `Error ${resp.status}`);
  }
  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const filter = makeThinkFilter();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") { cbs.onDone(); return; }
      try {
        const data = JSON.parse(payload);
        if (data.token) {
          const filtered = filter(data.token);
          if (filtered) cbs.onToken(filtered);
        }
        if (data.error) { cbs.onToken(`⚠️ ${data.error}`); cbs.onDone(); return; }
      } catch { /* ignore malformed */ }
    }
  }
  cbs.onDone();
}

function genId() { return Math.random().toString(36).slice(2); }

function RenderContent({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={i} className="bg-sky-100 text-blue-700 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        return (
          <span key={i}>
            {part.split("\n").map((line, j, arr) => (
              <span key={j}>{line}{j < arr.length - 1 && <br />}</span>
            ))}
          </span>
        );
      })}
    </>
  );
}

export default function SupportChat() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: t("public.chat.welcome"),
    },
  ]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && !minimized) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open, minimized]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");

    // Client-side topic guard
    if (isBlocked(trimmed)) {
      const id = genId();
      setMessages(prev => [
        ...prev,
        { id: genId(), role: "user", content: trimmed },
        { id, role: "assistant", content: t("public.chat.blocked") },
      ]);
      return;
    }

    const userMsg: Message = { id: genId(), role: "user", content: trimmed };
    const assistantId = genId();
    setMessages(prev => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", loading: true },
    ]);
    setLoading(true);

    const history = messages
      .filter(m => !m.loading)
      .map(m => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: trimmed });

    abortRef.current = new AbortController();

    try {
      await streamSupport(
        history,
        {
          onToken: (token) => setMessages(prev =>
            prev.map(m => m.id === assistantId
              ? { ...m, content: m.content + token, loading: false }
              : m
            )
          ),
          onDone: () => setLoading(false),
        },
        abortRef.current.signal,
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const errMsg = err?.message?.includes("429")
        ? t("public.chat.err_too_many")
        : t("public.chat.err_unreachable");
      setMessages(prev =>
        prev.map(m => m.id === assistantId
          ? { ...m, content: errMsg, loading: false }
          : m
        )
      );
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  function stop() {
    abortRef.current?.abort();
    setLoading(false);
    setMessages(prev => prev.map(m => m.loading ? { ...m, loading: false } : m));
  }

  function clear() {
    abortRef.current?.abort();
    setLoading(false);
    setMessages([{
      id: "welcome",
      role: "assistant",
      content: t("public.chat.cleared"),
    }]);
  }

  // ── Closed state ─────────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 rtl:right-auto rtl:left-4 sm:rtl:left-6 z-50 flex items-center gap-2.5 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white pl-4 pr-5 py-3 rounded-2xl shadow-xl shadow-blue-500/30 transition-all hover:scale-105 hover:shadow-blue-500/40 group"
        title={t("public.chat.title")}
      >
        <MessageSquare className="w-5 h-5" />
        <span className="text-sm font-semibold">{t("public.chat.button")}</span>
        <span className="absolute -top-1 -right-1 rtl:-right-auto rtl:-left-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-white animate-pulse" />
      </button>
    );
  }

  // ── Open state ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 rtl:right-auto rtl:left-0 sm:rtl:left-6 z-50 flex flex-col w-full sm:w-[400px] max-h-[100dvh] sm:max-h-[640px] bg-white sm:rounded-3xl shadow-2xl shadow-black/20 border-t sm:border border-sky-100 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">{t("public.chat.title")}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-blue-100">{t("public.chat.subtitle")}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={clear} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors" title={t("public.chat.clear")}>
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setMinimized(m => !m)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors" title={t("public.chat.minimize")}>
            <ChevronDown className={`w-4 h-4 transition-transform ${minimized ? "rotate-180" : ""}`} />
          </button>
          <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors" title={t("public.chat.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 max-h-[400px]">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                    <Sparkles className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : "bg-sky-50 text-gray-800 border border-sky-100 rounded-tl-sm"
                }`}>
                  {msg.loading ? (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  ) : (
                    <div><RenderContent text={msg.content} /></div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Quick questions — only on welcome screen */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 grid grid-cols-1 gap-1.5 flex-shrink-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1 mb-0.5">{t("public.chat.common")}</p>
              {QUICK_QUESTIONS.map(({ icon: Icon, labelKey, textKey }) => (
                <button
                  key={labelKey}
                  onClick={() => send(t(`public.chat.${textKey}`))}
                  className="flex items-center gap-2 px-3 py-2 bg-sky-50 hover:bg-blue-50 border border-sky-100 hover:border-blue-200 rounded-xl text-xs text-gray-600 hover:text-blue-700 font-medium transition-colors text-left rtl:text-right"
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
                  {t(`public.chat.${labelKey}`)}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-sky-100 flex-shrink-0">
            <div className="flex items-end gap-2 bg-sky-50 rounded-2xl border border-sky-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all px-3 py-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("public.chat.placeholder")}
                className="flex-1 bg-transparent resize-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none max-h-28 leading-relaxed"
                style={{ minHeight: "24px" }}
              />
              {loading ? (
                <button onClick={stop} className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center transition-colors" title={t("public.chat.stop")}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white flex items-center justify-center transition-colors"
                  title={t("public.chat.send")}
                >
                  <Send className="w-3.5 h-3.5 rtl:scale-x-[-1]" />
                </button>
              )}
            </div>
            <p className="text-center text-[10px] text-gray-300 mt-1.5">{t("public.chat.footer")}</p>
          </div>
        </>
      )}
    </div>
  );
}
