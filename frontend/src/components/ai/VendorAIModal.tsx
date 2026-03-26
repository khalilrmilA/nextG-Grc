/**
 * VendorAIModal — AI-powered vendor risk assessment streamed from Ollama.
 * Accepts questionnaire responses (key→value) and streams a scored risk report.
 */
import { useState, useRef, useEffect } from "react";
import { X, RefreshCw, Copy, Download, Sparkles, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { aiApi } from "@/api/endpoints";

interface Props {
  vendorName: string;
  vendorIndustry?: string;
  vendorServices?: string;
  onClose: () => void;
}

// Default questionnaire for quick AI assessment when no custom Q&A provided
const DEFAULT_QUESTIONNAIRE: Record<string, string> = {
  "Does the vendor hold ISO 27001 certification?": "Unknown — not yet verified",
  "Does the vendor hold SOC 2 Type II certification?": "Unknown — not yet verified",
  "Does the vendor encrypt data at rest and in transit?": "Unknown — not yet verified",
  "Does the vendor have a documented incident response plan?": "Unknown — not yet verified",
  "Does the vendor conduct annual penetration testing?": "Unknown — not yet verified",
  "Does the vendor have a business continuity / DR plan?": "Unknown — not yet verified",
  "Does the vendor perform background checks on employees?": "Unknown — not yet verified",
  "Does the vendor use multi-factor authentication?": "Unknown — not yet verified",
  "Does the vendor have a vulnerability management program?": "Unknown — not yet verified",
  "Does the vendor maintain a list of sub-processors?": "Unknown — not yet verified",
};

function renderMarkdown(text: string) {
  return text
    .replace(/^## (.+)$/gm, '<h3 class="text-sm font-bold text-gray-900 mt-5 mb-2 border-b border-gray-200 pb-1">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-xs font-bold text-gray-700 mt-4 mb-1.5">$1</h4>')
    .replace(/^#### (.+)$/gm, '<h5 class="text-xs font-semibold text-blue-700 mt-3 mb-1">$1</h5>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 text-blue-700 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/^(\| .+)$/gm, (_, row) => {
      const cells = row.replace(/^\| /, "").replace(/ \|$/, "").split(" | ")
        .map((c: string) => `<td class="border border-gray-200 px-2 py-1 text-xs">${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-xs text-gray-600 leading-relaxed">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-xs text-gray-600 leading-relaxed">$2</li>')
    .replace(/\n/g, "<br/>");
}

// ── Questionnaire Builder ─────────────────────────────────────────────────────
function QuestionnairePanel({
  responses,
  onChange,
}: {
  readonly responses: Record<string, string>;
  readonly onChange: (q: string, a: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span>Edit Questionnaire Responses ({Object.keys(responses).length} questions)</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {Object.entries(responses).map(([q, a]) => (
            <div key={q} className="px-4 py-3 space-y-1.5">
              <p className="text-xs font-medium text-gray-700">{q}</p>
              <input
                type="text"
                value={a}
                onChange={e => onChange(q, e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function VendorAIModal({ vendorName, vendorIndustry, vendorServices, onClose }: Props) {
  const [responses, setResponses] = useState<Record<string, string>>(DEFAULT_QUESTIONNAIRE);
  const [output, setOutput]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);
  const [started, setStarted]     = useState(false);
  const abortRef  = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (loading) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  function handleResponseChange(q: string, a: string) {
    setResponses(prev => ({ ...prev, [q]: a }));
  }

  function analyze() {
    setOutput("");
    setDone(false);
    setLoading(true);
    setStarted(true);
    abortRef.current = new AbortController();
    aiApi.streamVendorAnalysis(
      vendorName,
      vendorIndustry || "Unknown",
      vendorServices || "",
      responses,
      (token) => setOutput(prev => prev + token),
      () => { setLoading(false); setDone(true); },
      abortRef.current.signal,
    ).catch(() => setLoading(false));
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(output);
  }

  function downloadMd() {
    const blob = new Blob([output], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${vendorName.replace(/\s+/g, "_")}_vendor_risk.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-sm">AI Vendor Risk Assessment</h2>
              <p className="text-xs text-gray-400">{vendorName}{vendorIndustry ? ` · ${vendorIndustry}` : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <button type="button" onClick={() => { abortRef.current?.abort(); setLoading(false); }}
                className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                Stop
              </button>
            )}
            {done && (
              <>
                <button type="button" onClick={analyze}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Regenerate
                </button>
                <button type="button" onClick={copyToClipboard}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                  <Copy className="w-3 h-3" /> Copy
                </button>
                <button type="button" onClick={downloadMd}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  <Download className="w-3 h-3" /> Download .md
                </button>
              </>
            )}
            <button type="button" onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Pre-analysis — questionnaire + launch */}
        {!started && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <p className="text-sm text-gray-600">
              Review and update the questionnaire responses below, then run the AI assessment.
              The AI will score the vendor across security domains and highlight critical risks.
            </p>
            {vendorServices && (
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-600">
                <span className="font-semibold text-gray-700">Services: </span>{vendorServices}
              </div>
            )}
            <QuestionnairePanel responses={responses} onChange={handleResponseChange} />
            <button
              type="button"
              onClick={analyze}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-medium transition-all shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              Run AI Risk Assessment
            </button>
          </div>
        )}

        {/* Streaming output */}
        {started && (
          <>
            <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
              <span><strong className="text-gray-700">Vendor:</strong> {vendorName}</span>
              {loading && <span className="ml-auto animate-pulse text-emerald-500">AI analyzing vendor risk…</span>}
              {done    && <span className="ml-auto text-green-600 font-medium flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Assessment complete</span>}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!output && loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                  <div className="flex gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <p className="text-sm">Analyzing vendor security posture…</p>
                </div>
              )}
              {output && (
                <div
                  className="prose-sm max-w-none text-gray-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
                />
              )}
              <div ref={bottomRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
