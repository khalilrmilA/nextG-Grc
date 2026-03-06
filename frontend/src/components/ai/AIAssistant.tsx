import { useState, useRef, useEffect } from "react";
import {
  Bot, X, Send, Loader2, Sparkles, ChevronDown,
  Shield, AlertTriangle, CheckSquare, FileText, RotateCcw,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

const QUICK_PROMPTS = [
  { icon: Shield,        label: "ISO 27001 gap",    text: "What are the most common ISO 27001:2022 gaps for a SaaS company?" },
  { icon: AlertTriangle, label: "Risk treatment",   text: "Explain the 4 risk treatment options (accept, avoid, transfer, mitigate) with examples." },
  { icon: CheckSquare,   label: "SOC 2 controls",   text: "What are the key SOC 2 Trust Service Criteria I need to implement first?" },
  { icon: FileText,      label: "Draft policy",     text: "Draft a concise Information Security Policy for a 50-person SaaS company." },
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
  clearTimeout(timeoutId);

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
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm your GRC AI assistant powered by **DeepSeek R1**.\n\nI can help you with ISO 27001, SOC 2, GDPR, risk assessments, policy drafting, audit prep, and more.\n\n⚡ First response may take ~10s while the model loads. What do you need help with?",
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
      .map(m => ({ role: m.role, content: m.content }));
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
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: "Sorry, I couldn't reach the AI service. Make sure the backend and Ollama are running.", loading: false }
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
      content: "Chat cleared. How can I help you with your GRC work?",
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
        className="ai-assistant-button fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl shadow-xl shadow-blue-500/30 flex items-center justify-center transition-all hover:scale-110 group"
        title="GRC AI Assistant"
      >
        <Bot className="w-6 h-6" />
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-white" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[400px] max-h-[620px] bg-white rounded-3xl shadow-2xl shadow-black/20 border border-gray-100 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">GRC Assistant</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              <span className="text-xs text-blue-100">DeepSeek R1 · Local AI</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors"
            title="Clear chat"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMinimized(m => !m)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors"
            title="Minimize"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${minimized ? "rotate-180" : ""}`} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/20 transition-colors"
            title="Close"
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
                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
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
                    <div>{renderContent(msg.content)}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts (only when 1 message = welcome) */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 grid grid-cols-2 gap-2 flex-shrink-0">
              {QUICK_PROMPTS.map(({ icon: Icon, label, text }) => (
                <button
                  key={label}
                  onClick={() => sendMessage(text)}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-xl text-xs text-gray-600 hover:text-blue-700 font-medium transition-colors text-left"
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
                  {label}
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
                placeholder="Ask about ISO 27001, risks, policies..."
                className="flex-1 bg-transparent resize-none text-sm text-gray-800 placeholder-gray-400 focus:outline-none max-h-28 leading-relaxed"
                style={{ minHeight: "24px" }}
              />
              {loading ? (
                <button
                  onClick={stopGeneration}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center transition-colors"
                  title="Stop"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white flex items-center justify-center transition-colors"
                  title="Send (Enter)"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-center text-xs text-gray-300 mt-1.5">Enter to send · Shift+Enter for new line</p>
          </div>
        </>
      )}
    </div>
  );
}
