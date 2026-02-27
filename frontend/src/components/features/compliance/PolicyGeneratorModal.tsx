import { useState, useRef, useEffect } from "react";
import { X, Sparkles, Copy, RotateCcw, Loader2, CheckCheck } from "lucide-react";
import { aiApi } from "@/api/endpoints";
import { makeThinkFilter } from "@/lib/sse";
import type { GapDetail } from "@/types";

interface PolicyGeneratorModalProps {
  readonly gap: GapDetail;
  readonly frameworkShortName: string;
  readonly assessmentContext?: string;
  readonly onClose: () => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-700 bg-red-100",
  high:     "text-orange-700 bg-orange-100",
  medium:   "text-yellow-700 bg-yellow-100",
  low:      "text-gray-600 bg-gray-100",
};

export default function PolicyGeneratorModal({
  gap,
  frameworkShortName,
  assessmentContext,
  onClose,
}: PolicyGeneratorModalProps) {
  const [output, setOutput]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  async function generate() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutput("");
    setLoading(true);

    const filter = makeThinkFilter();

    try {
      await aiApi.streamPolicyGeneration(
        {
          control_identifier: gap.control_identifier,
          control_title: gap.control_title,
          framework_short_name: frameworkShortName,
          control_description: gap.control_description,
          gap_description: gap.gap_description,
          existing_context: assessmentContext,
        },
        (token) => {
          // Apply think filter inline (handleSseLine already applied it via readSseStream,
          // but here we're using a direct token callback so filter here too)
          const filtered = filter(token);
          if (filtered) setOutput((prev) => prev + filtered);
        },
        () => setLoading(false),
        ctrl.signal,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setOutput((prev) => prev + "\n\n⚠️ Generation failed. Make sure Ollama is running.");
      }
      setLoading(false);
    }
  }

  // Auto-start on mount
  useEffect(() => {
    generate();
    return () => abortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  async function copyToClipboard() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-100 rounded-xl flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Generate Policy — {gap.control_identifier}: {gap.control_title}
              </h2>
              <p className="text-xs text-gray-400">{frameworkShortName} · AI-powered policy generation</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 gap-0">
          {/* Left: context panel */}
          <div className="w-64 flex-shrink-0 border-r border-gray-100 p-4 space-y-4 overflow-y-auto">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Gap Identified</p>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLOR[gap.severity] ?? "text-gray-600 bg-gray-100"}`}>
                  {gap.severity} severity
                </span>
              </div>
              <p className="text-xs text-gray-700 leading-relaxed">{gap.gap_description}</p>
            </div>

            {gap.control_description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Control Requirement</p>
                <p className="text-xs text-gray-600 leading-relaxed">{gap.control_description}</p>
              </div>
            )}

            {gap.remediation_steps && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Suggested Remediation</p>
                <p className="text-xs text-gray-600 leading-relaxed">{gap.remediation_steps}</p>
              </div>
            )}
          </div>

          {/* Right: output panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto p-5 font-mono text-sm text-gray-800 whitespace-pre-wrap leading-relaxed"
            >
              {output || (
                loading ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Generating policy document…</span>
                  </div>
                ) : (
                  <span className="text-gray-300">Policy will appear here…</span>
                )
              )}
              {loading && output && (
                <span className="inline-block w-1.5 h-4 bg-purple-500 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-400">
            {loading ? "AI is writing your policy…" : output ? "Review and adapt before use" : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => generate()}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Regenerate
            </button>
            <button
              onClick={copyToClipboard}
              disabled={!output}
              className="flex items-center gap-1.5 text-xs text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy policy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
