/**
 * RiskAIPanel — streams AI treatment suggestions for a risk.
 * Drop into the AddRisk or RiskDetail modal.
 */
import { useState, useRef, useEffect } from "react";
import { Sparkles, X, RefreshCw, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { aiApi } from "@/api/endpoints";

interface Props {
  title: string;
  description: string;
  category: string;
}

export default function RiskAIPanel({ title, description, category }: Props) {
  const [open, setOpen]       = useState(false);
  const [output, setOutput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !output && !loading) analyze();
  }, [open]);

  useEffect(() => {
    if (loading) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  function analyze() {
    if (!title.trim()) return;
    setOutput("");
    setDone(false);
    setLoading(true);
    abortRef.current = new AbortController();
    aiApi.streamRiskAnalysis(
      title, description, category,
      (token) => setOutput(prev => prev + token),
      () => { setLoading(false); setDone(true); },
      abortRef.current.signal,
    ).catch(() => setLoading(false));
  }

  function stop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(output);
  }

  // Simple markdown bold renderer
  function renderMarkdown(text: string) {
    return text
      .replace(/^## (.+)$/gm, '<h3 class="text-sm font-bold text-gray-900 mt-4 mb-1 border-b border-gray-100 pb-1">$1</h3>')
      .replace(/^### (.+)$/gm, '<h4 class="text-xs font-semibold text-gray-700 mt-3 mb-1">$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-xs text-gray-600">$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-xs text-gray-600">$2</li>')
      .replace(/\n/g, '<br/>');
  }

  return (
    <div className="border border-blue-100 rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-800">AI Risk Analysis</span>
          {loading && <span className="text-xs text-blue-500 animate-pulse">Analyzing…</span>}
          {done && <span className="text-xs text-green-600 font-medium">Ready</span>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-blue-400" /> : <ChevronDown className="w-4 h-4 text-blue-400" />}
      </button>

      {open && (
        <div className="bg-white">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
            <button
              type="button"
              onClick={analyze}
              disabled={loading || !title.trim()}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Analyzing…" : "Regenerate"}
            </button>
            {loading && (
              <button type="button" onClick={stop}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                <X className="w-3 h-3" /> Stop
              </button>
            )}
            {done && (
              <button type="button" onClick={copyToClipboard}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                <Copy className="w-3 h-3" /> Copy
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">Powered by Ollama · {category}</span>
          </div>

          {/* Output */}
          <div className="max-h-80 overflow-y-auto px-4 py-3 text-xs text-gray-700 leading-relaxed">
            {!output && !loading && (
              <p className="text-gray-400 italic text-center py-4">
                {title.trim() ? "Click Regenerate to analyze this risk." : "Enter a risk title first."}
              </p>
            )}
            {output && (
              <div
                className="prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
              />
            )}
            {loading && !output && (
              <div className="flex items-center gap-2 py-4 justify-center text-gray-400">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
