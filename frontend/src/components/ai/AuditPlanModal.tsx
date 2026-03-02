/**
 * AuditPlanModal — AI-generated audit program streamed from Ollama.
 * Triggered from the New Audit modal or audit detail page.
 */
import { useState, useRef, useEffect } from "react";
import { X, RefreshCw, Copy, Download, Sparkles, FileText } from "lucide-react";
import { aiApi } from "@/api/endpoints";

interface Props {
  auditTitle: string;
  frameworkName: string;
  frameworkShortName: string;
  auditScope?: string;
  auditObjective?: string;
  controls?: Array<{ control_id: string; title: string; category: string }>;
  onClose: () => void;
}

// Default controls for well-known frameworks when none are loaded from DB
const DEFAULT_CONTROLS: Record<string, Array<{ control_id: string; title: string; category: string }>> = {
  "ISO 27001": [
    { control_id: "A.5.1",  title: "Policies for information security",       category: "organizational" },
    { control_id: "A.5.15", title: "Access control",                          category: "organizational" },
    { control_id: "A.6.3",  title: "Information security awareness",          category: "people"         },
    { control_id: "A.7.1",  title: "Physical security perimeters",            category: "physical"       },
    { control_id: "A.8.1",  title: "User endpoint devices",                   category: "technical"      },
    { control_id: "A.8.7",  title: "Protection against malware",              category: "technical"      },
    { control_id: "A.8.8",  title: "Management of technical vulnerabilities", category: "technical"      },
    { control_id: "A.8.24", title: "Use of cryptography",                     category: "technical"      },
    { control_id: "A.5.28", title: "Collection of evidence",                  category: "organizational" },
    { control_id: "A.5.29", title: "Information security during disruption",  category: "organizational" },
  ],
  "SOC 2": [
    { control_id: "CC1.1", title: "COSO Principle 1 — Integrity and ethics",     category: "governance"     },
    { control_id: "CC6.1", title: "Logical access security",                     category: "technical"      },
    { control_id: "CC6.2", title: "Registration and authorization of new users", category: "technical"      },
    { control_id: "CC6.3", title: "Role-based access",                           category: "technical"      },
    { control_id: "CC7.1", title: "Detection and monitoring of anomalies",       category: "technical"      },
    { control_id: "CC7.2", title: "Monitoring system components",                category: "technical"      },
    { control_id: "CC8.1", title: "Change management controls",                  category: "organizational" },
    { control_id: "A1.1",  title: "Availability — capacity management",          category: "technical"      },
    { control_id: "C1.1",  title: "Confidentiality — data classification",       category: "organizational" },
    { control_id: "P1.1",  title: "Privacy — notice and communication",          category: "organizational" },
  ],
  "NIST CSF": [
    { control_id: "GV.OC", title: "Organizational context",                    category: "govern"   },
    { control_id: "ID.AM", title: "Asset management",                          category: "identify" },
    { control_id: "ID.RA", title: "Risk assessment",                           category: "identify" },
    { control_id: "PR.AA", title: "Identity management & access control",      category: "protect"  },
    { control_id: "PR.DS", title: "Data security",                             category: "protect"  },
    { control_id: "PR.IR", title: "Technology infrastructure resilience",      category: "protect"  },
    { control_id: "DE.AE", title: "Adverse event analysis",                    category: "detect"   },
    { control_id: "RS.MA", title: "Incident management",                       category: "respond"  },
    { control_id: "RC.RP", title: "Incident recovery plan",                    category: "recover"  },
  ],
};

function renderMarkdown(text: string) {
  return text
    .replace(/^## (.+)$/gm, '<h3 class="text-sm font-bold text-gray-900 mt-5 mb-2 border-b border-gray-200 pb-1">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-xs font-bold text-gray-700 mt-4 mb-1.5">$1</h4>')
    .replace(/^#### (.+)$/gm, '<h5 class="text-xs font-semibold text-blue-700 mt-3 mb-1">$1</h5>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 text-blue-700 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/^\| (.+)$/gm, (_, row) => {
      const cells = row.split(" | ").map((c: string) => `<td class="border border-gray-200 px-2 py-1 text-xs">${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-xs text-gray-600 leading-relaxed">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-xs text-gray-600 leading-relaxed">$2</li>')
    .replace(/\n/g, '<br/>');
}

export default function AuditPlanModal({
  auditTitle, frameworkName, frameworkShortName,
  auditScope, auditObjective, controls, onClose,
}: Props) {
  const [output, setOutput]   = useState("");
  const [loading, setLoading] = useState(true);
  const [done, setDone]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const resolvedControls = controls?.length
    ? controls
    : DEFAULT_CONTROLS[frameworkName] ?? DEFAULT_CONTROLS["ISO 27001"];

  useEffect(() => {
    generate();
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (loading) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  function generate() {
    setOutput("");
    setDone(false);
    setLoading(true);
    abortRef.current = new AbortController();
    aiApi.streamAuditPlan(
      { framework_name: frameworkName, framework_short_name: frameworkShortName,
        audit_title: auditTitle, audit_scope: auditScope, audit_objective: auditObjective,
        controls: resolvedControls },
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${auditTitle.replace(/\s+/g, "_")}_audit_plan.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 text-sm">AI Audit Program</h2>
              <p className="text-xs text-gray-400">{frameworkName} · {resolvedControls.length} controls in scope</p>
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
                <button type="button" onClick={generate}
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

        {/* Context bar */}
        <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
          <span><strong className="text-gray-700">Title:</strong> {auditTitle}</span>
          {auditScope && <span><strong className="text-gray-700">Scope:</strong> {auditScope}</span>}
          {loading && <span className="ml-auto animate-pulse text-indigo-500">AI generating audit program…</span>}
          {done && <span className="ml-auto text-green-600 font-medium flex items-center gap-1"><FileText className="w-3 h-3" /> Complete</span>}
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!output && loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <span key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="text-sm">Generating audit program…</p>
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
      </div>
    </div>
  );
}
