import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot, X, Send, Loader2, Sparkles, ChevronDown,
  Shield, AlertTriangle, CheckSquare, FileText, RotateCcw,
} from "lucide-react";
import { aiLanguageHeaders, uiLanguage } from "@/lib/sse";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** UI-owned messages (welcome / cleared) store a key so they follow the UI language. */
  i18nKey?: string;
  loading?: boolean;
}

// Labels and prompt texts are i18n keys (ai_assistant.prompts.<id>_label / _text).
const QUICK_PROMPTS = [
  { icon: Shield,        id: "iso_gap" },
  { icon: AlertTriangle, id: "risk_treatment" },
  { icon: CheckSquare,   id: "soc2" },
  { icon: FileText,      id: "draft_policy" },
];

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

type StreamCallbacks = { onToken: (t: string) => void; onDone: () => void };

/** Strips <think>...</think> blocks from streamed tokens. Stateful across calls. */
function makeThinkFilter() {
  let insideThink = false;
  let buffer = "";

  return function filter(raw: string): string {
    buffer += raw;
    let out = "";

    while (buffer.length > 0) {
      if (insideThink) {
        const closeIdx = buffer.indexOf("</think>");
        if (closeIdx === -1) {
          // Haven't seen closing tag yet — discard buffered content but keep partial tag possibility
          buffer = buffer.length > 8 ? buffer.slice(-8) : buffer;
          return out;
        }
        insideThink = false;
        buffer = buffer.slice(closeIdx + 8);
        // Skip any leading newline right after </think>
        buffer = buffer.replace(/^\n+/, "");
      } else {
        const openIdx = buffer.indexOf("<think>");
        if (openIdx === -1) {
          out += buffer;
          buffer = "";
        } else {
          out += buffer.slice(0, openIdx);
          insideThink = true;
          buffer = buffer.slice(openIdx + 7);
        }
      }
    }
    return out;
  };
}

/** Parse one SSE line and call the appropriate callback. Returns true if stream should stop. */
function handleSseLine(
  line: string,
  { onToken, onDone }: StreamCallbacks,
  filter: (t: string) => string,
): boolean {
  if (!line.startsWith("data: ")) return false;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") { onDone(); return true; }
  try {
    const data = JSON.parse(payload);
    if (data.token) {
      const filtered = filter(data.token);
      if (filtered) onToken(filtered);
    }
    if (data.error) { onToken(`⚠️ ${data.error}`); onDone(); return true; }
  } catch {
    // ignore malformed JSON lines
  }
  return false;
}

async function streamChat(
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  onDone: () => void,
  signal: AbortSignal,
  language = "en",
) {
  // Use a combined signal with a 90s timeout to allow model cold-start
  const timeoutId = setTimeout(() => {
    if (!signal.aborted) {
      const c = new AbortController(); c.abort();
    }
  }, 90_000);
  const stored = localStorage.getItem("grc_user_v2");
  const token = stored ? (JSON.parse(stored)?.accessToken ?? "") : "";
  const resp = await fetch(`${API_BASE}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // UI language, not the browser's (raw fetch bypasses the axios interceptor).
      ...aiLanguageHeaders(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, stream: true, language: language || uiLanguage() }),
    signal,
  });
  clearTimeout(timeoutId);

  if (resp.status === 402) {
    // The AI GRC assistant is an Enterprise / Elite capability (Growth: 402
    // feature_not_in_plan ai_copilot). Raw fetch bypasses client.ts, so surface
    // it here as a plan message rather than "assistant unreachable".
    throw Object.assign(new Error("plan_copilot"), { code: "plan_copilot" });
  }
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const cbs: StreamCallbacks = { onToken, onDone };
  const filter = makeThinkFilter();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value, { stream: true }).split("\n");
    for (const line of lines) {
      if (handleSseLine(line, cbs, filter)) return;
    }
  }
  onDone();
}

export default function AIAssistant() {
  const { t, i18n } = useTranslation();
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "",
      i18nKey: "ai_assistant.welcome",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  function genId() {
    return Math.random().toString(36).slice(2);
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setInput("");
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
      .map(m => ({ role: m.role, content: m.i18nKey ? t(m.i18nKey as never) : m.content }));
    history.push({ role: "user", content: trimmed });

    abortRef.current = new AbortController();

    try {
      await streamChat(
        history,
        (token) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: m.content + token, loading: false }
                : m
            )
          );
        },
        () => setLoading(false),
        abortRef.current.signal,
        i18n.language,
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const content = err?.code === "plan_copilot"
        ? t("plan_limits.copilot_locked")
        : t("ai_assistant.error_unreachable");
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content, loading: false }
            : m
        )
      );
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
    setLoading(false);
    setMessages(prev =>
      prev.map(m => m.loading ? { ...m, loading: false } : m)
    );
  }

  function clearChat() {
    setMessages([{
      id: "welcome",
      role: "assistant",
      content: "",
      i18nKey: "ai_assistant.cleared",
    }]);
    setLoading(false);
    abortRef.current?.abort();
  }

  function renderContent(text: string) {
    // Simple markdown-like rendering: bold, code blocks, line breaks
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={i} className="bg-gray-100 text-blue-700 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
      }
      return <span key={i}>{part.split("\n").map((line, j, arr) => (
        <span key={j}>{line}{j < arr.length - 1 && <br />}</span>
      ))}</span>;
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="ai-assistant-button fixed bottom-6 right-6 rtl:right-auto rtl:left-6 z-50 w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl shadow-xl shadow-blue-500/30 flex items-center justify-center transition-all hover:scale-110 group"
        title={t("ai_assistant.button_title")}
        aria-label={t("ai_assistant.button_title")}
      >
        <Bot className="w-6 h-6" />
        <span className="absolute -top-1 -right-1 rtl:right-auto rtl:-left-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-white" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 rtl:right-auto rtl:left-6 z-50 flex flex-col w-[400px] max-h-[620px] bg-white rounded-3xl shadow-2xl shadow-black/20 border border-gray-100 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">{t("ai_assistant.title")}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              <span className="text-xs text-blue-100">{t("ai_assistant.online")}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors"
            title={t("public.chat.clear")}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMinimized(m => !m)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors"
            title={t("public.chat.minimize")}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${minimized ? "rotate-180" : ""}`} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors"
            title={t("common.close")}
          >
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
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0 me-2 mt-0.5">
                    <Sparkles className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-sm"
                    : "bg-gray-50 text-gray-800 border border-gray-100 rounded-tl-sm"
                }`}>
                  {msg.loading ? (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  ) : (
                    <div>{renderContent(msg.i18nKey ? t(msg.i18nKey as never) : msg.content)}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts (only when 1 message = welcome) */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 grid grid-cols-2 gap-2 flex-shrink-0">
              {QUICK_PROMPTS.map(({ icon: Icon, id }) => (
                <button
                  key={id}
                  onClick={() => sendMessage(t(`ai_assistant.prompts.${id}_text` as never))}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-xl text-xs text-gray-600 hover:text-blue-700 font-medium transition-colors text-start"
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
                  {t(`ai_assistant.prompts.${id}_label` as never)}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex-shrink-0">
            <div className="flex items-end gap-2 bg-gray-50 rounded-2xl border border-gray-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all px-3 py-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("ai_assistant.placeholder")}
                className="flex-1 bg-transparent resize-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none max-h-28 leading-relaxed"
                style={{ minHeight: "24px" }}
              />
              {loading ? (
                <button
                  onClick={stopGeneration}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center transition-colors"
                  title={t("public.chat.stop")}
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white flex items-center justify-center transition-colors"
                  title={t("public.chat.send")}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-center text-xs text-gray-300 mt-1.5">{t("ai_assistant.input_hint")}</p>
          </div>
        </>
      )}
    </div>
  );
}
