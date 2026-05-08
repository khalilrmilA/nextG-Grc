import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wand2, ChevronRight, Loader2, Copy, CheckCheck,
  Download, Save, RotateCcw, FileText, BookOpen,
  ClipboardList, Shield, Sparkles, X, Pencil, Eye,
  CheckCircle, CheckSquare, Square, ChevronDown, Search, Clock, Trash2,
} from "lucide-react";
import { aiApi, frameworksApi, policiesApi } from "@/api/endpoints";
import AiGate from "@/components/features/ai/AiGate";
import { makeThinkFilter } from "@/lib/sse";
import { useAuthStore } from "@/store/auth";
import { useAiTokenRefresh } from "@/hooks/useAiTokenRefresh";
import type { Framework, FrameworkControl } from "@/types";

// ── Document catalogue ─────────────────────────────────────────────────────────

const DOCUMENT_CATEGORIES = [
  {
    id: "foundation",
    label: "Foundation Documents",
    icon: Shield,
    color: "text-blue-600 bg-blue-50",
    description: "Core ISMS governance documents — start here",
    docs: [
      "Information Security Policy",
      "ISMS Scope Statement",
      "Statement of Applicability (SoA) Template",
      "Information Security Objectives",
      "Management Review Agenda & Minutes Template",
    ],
  },
  {
    id: "policies",
    label: "Security Policies",
    icon: BookOpen,
    color: "text-purple-600 bg-purple-50",
    description: "Control-area specific policy documents",
    docs: [
      "Access Control Policy",
      "Acceptable Use Policy",
      "Data Classification & Handling Policy",
      "Cryptography & Encryption Policy",
      "Clear Desk & Clear Screen Policy",
      "Remote Work & Teleworking Policy",
      "Password & Authentication Policy",
      "Physical & Environmental Security Policy",
      "Third-Party & Supplier Security Policy",
      "Bring Your Own Device (BYOD) Policy",
    ],
  },
  {
    id: "procedures",
    label: "Procedures & Standards",
    icon: ClipboardList,
    color: "text-green-600 bg-green-50",
    description: "Operational how-to documents",
    docs: [
      "User Access Management Procedure",
      "Incident Response Procedure",
      "Change Management Procedure",
      "Backup & Recovery Procedure",
      "Vulnerability Management Procedure",
      "Security Awareness Training Procedure",
      "Asset Inventory & Management Procedure",
      "Log Management & Monitoring Procedure",
    ],
  },
  {
    id: "plans",
    label: "Plans",
    icon: FileText,
    color: "text-orange-600 bg-orange-50",
    description: "Event-driven and continuity plans",
    docs: [
      "Business Continuity Plan (BCP)",
      "Disaster Recovery Plan (DRP)",
      "Incident Response Plan (IRP)",
      "Risk Assessment & Treatment Plan",
    ],
  },
] as const;

const INDUSTRIES = [
  "Technology / SaaS", "Financial Services", "Healthcare", "Retail & E-commerce",
  "Manufacturing", "Professional Services", "Government", "Education",
  "Energy & Utilities", "Telecommunications", "Other",
];

const SIZES = [
  { value: "startup",   label: "Startup",    sub: "1–50 employees" },
  { value: "smb",       label: "SMB",         sub: "51–500 employees" },
  { value: "midmarket", label: "Mid-Market",  sub: "501–5,000 employees" },
  { value: "enterprise",label: "Enterprise",  sub: "5,000+ employees" },
];

const FRAMEWORKS = ["ISO 27001:2022", "SOC 2", "NIST CSF 2.0", "GDPR", "HIPAA", "PCI DSS 4.0", "NIST 800-53"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── Render markdown-like output ────────────────────────────────────────────────

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("# "))  return <h1 key={i} className="text-xl font-bold text-gray-900 mt-6 mb-2">{line.slice(2)}</h1>;
    if (line.startsWith("## ")) return <h2 key={i} className="text-base font-bold text-blue-800 mt-5 mb-2 border-b border-blue-100 pb-1">{line.slice(3)}</h2>;
    if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-bold text-gray-700 mt-4 mb-1">{line.slice(4)}</h3>;
    if (line.startsWith("#### ")) return <h4 key={i} className="text-sm font-semibold text-gray-600 mt-3 mb-1">{line.slice(5)}</h4>;
    if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="text-sm text-gray-700 ml-5 mb-0.5 list-disc">{line.slice(2)}</li>;
    if (/^\d+\. /.test(line)) return <li key={i} className="text-sm text-gray-700 ml-5 mb-0.5 list-decimal">{line.replace(/^\d+\. /, "")}</li>;
    if (line.startsWith("| ")) return <div key={i} className="font-mono text-xs text-gray-600 leading-5">{line}</div>;
    if (line.startsWith("---") || line.startsWith("===")) return <hr key={i} className="my-3 border-gray-200" />;
    if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
      return <p key={i} className="text-sm font-semibold text-gray-800 mt-3 mb-0.5">{line.slice(2, -2)}</p>;
    }
    if (line.trim() === "") return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm text-gray-700 leading-relaxed mb-0.5">{line}</p>;
  });
}

// ── Control Picker Modal ───────────────────────────────────────────────────────

function ControlPickerModal({
  open,
  onClose,
  onConfirm,
  initial,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (controls: FrameworkControl[], frameworkName: string) => void;
  readonly initial: FrameworkControl[];
}) {
  const [frameworks, setFrameworks]   = useState<Framework[]>([]);
  const [activeFw, setActiveFw]       = useState<Framework | null>(null);
  const [controls, setControls]       = useState<FrameworkControl[]>([]);
  const [loadingFw, setLoadingFw]     = useState(false);
  const [loadingCtrl, setLoadingCtrl] = useState(false);
  const [selected, setSelected]       = useState<Set<string>>(new Set(initial.map(c => c.id)));
  const [selectedControls, setSelectedControls] = useState<FrameworkControl[]>([...initial]);
  const [search, setSearch]           = useState("");
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set());

  // Load frameworks list
  useEffect(() => {
    if (!open) return;
    setLoadingFw(true);
    frameworksApi.list()
      .then(list => { setFrameworks(list); if (!activeFw && list.length > 0) setActiveFw(list[0]); })
      .catch(() => {})
      .finally(() => setLoadingFw(false));
  }, [open]);

  // Load controls when framework changes
  useEffect(() => {
    if (!activeFw) return;
    setLoadingCtrl(true);
    setControls([]);
    frameworksApi.getControls(activeFw.id)
      .then(setControls)
      .catch(() => setControls([]))
      .finally(() => setLoadingCtrl(false));
  }, [activeFw]);

  function toggleControl(ctrl: FrameworkControl) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(ctrl.id)) {
        next.delete(ctrl.id);
        setSelectedControls(sc => sc.filter(c => c.id !== ctrl.id));
      } else {
        next.add(ctrl.id);
        setSelectedControls(sc => [...sc, ctrl]);
      }
      return next;
    });
  }

  function toggleGroup(items: FrameworkControl[]) {
    const allOn = items.every(c => selected.has(c.id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allOn) {
        items.forEach(c => { next.delete(c.id); });
        setSelectedControls(sc => sc.filter(c => !items.some(i => i.id === c.id)));
      } else {
        items.forEach(c => next.add(c.id));
        setSelectedControls(sc => {
          const existing = new Set(sc.map(c => c.id));
          return [...sc, ...items.filter(c => !existing.has(c.id))];
        });
      }
      return next;
    });
  }

  function toggleCollapse(grp: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(grp) ? n.delete(grp) : n.add(grp); return n; });
  }

  const filtered = controls.filter(c =>
    !search || c.control_id.toLowerCase().includes(search.toLowerCase()) || c.title.toLowerCase().includes(search.toLowerCase())
  );

  const groups: Record<string, FrameworkControl[]> = {};
  for (const c of filtered) {
    const g = c.category || "General";
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  }
  const groupNames = Object.keys(groups).sort();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-base">Select Target Controls</h2>
            <p className="text-xs text-gray-400 mt-0.5">Choose controls to include as context for the AI document generator</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left: Framework list */}
          <div className="w-48 border-r border-gray-100 flex flex-col flex-shrink-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-2">Frameworks</p>
            {loadingFw ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {frameworks.map(fw => {
                  const isActive = activeFw?.id === fw.id;
                  return (
                    <button
                      key={fw.id}
                      type="button"
                      onClick={() => setActiveFw(fw)}
                      className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors flex items-center justify-between gap-2 ${
                        isActive ? "bg-blue-50 text-blue-700 border-r-2 border-blue-600" : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <span className="truncate">{fw.short_name}</span>
                      {fw.control_count && fw.control_count > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${isActive ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"}`}>
                          {fw.control_count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Controls list */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Search + stats */}
            <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search controls…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {selected.size > 0 && (
                <p className="text-xs text-blue-600 font-medium">{selected.size} control{selected.size !== 1 ? "s" : ""} selected total</p>
              )}
            </div>

            {/* Controls */}
            <div className="flex-1 overflow-y-auto">
              {loadingCtrl ? (
                <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading controls…</span>
                </div>
              ) : controls.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <BookOpen className="w-8 h-8 text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">No controls for this framework</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {groupNames.map(grp => {
                    const items = groups[grp];
                    const allOn = items.every(c => selected.has(c.id));
                    const someOn = items.some(c => selected.has(c.id));
                    const isCol = collapsed.has(grp);
                    return (
                      <div key={grp}>
                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 sticky top-0 z-10">
                          <button type="button" onClick={() => toggleGroup(items)} className="flex-shrink-0">
                            {allOn
                              ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                              : someOn
                              ? <CheckSquare className="w-3.5 h-3.5 text-blue-300" />
                              : <Square className="w-3.5 h-3.5 text-gray-300" />}
                          </button>
                          <button type="button" onClick={() => toggleCollapse(grp)} className="flex items-center gap-1.5 flex-1 text-left">
                            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{grp}</span>
                            <span className="text-[10px] text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">{items.length}</span>
                            {isCol ? <ChevronRight className="w-3 h-3 text-gray-400 ml-auto" /> : <ChevronDown className="w-3 h-3 text-gray-400 ml-auto" />}
                          </button>
                        </div>
                        {!isCol && items.map(ctrl => (
                          <div
                            key={ctrl.id}
                            onClick={() => toggleControl(ctrl)}
                            className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-blue-50/50 ${selected.has(ctrl.id) ? "bg-blue-50/30" : ""}`}
                          >
                            <div className="flex-shrink-0 mt-0.5">
                              {selected.has(ctrl.id)
                                ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                                : <Square className="w-3.5 h-3.5 text-gray-300" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{ctrl.control_id}</span>
                                <span className="text-xs font-medium text-gray-800 leading-snug">{ctrl.title}</span>
                              </div>
                              {ctrl.description && (
                                <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{ctrl.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0 bg-white">
          <div className="flex items-center gap-2">
            {selected.size > 0 ? (
              <>
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-gray-700">{selected.size} control{selected.size !== 1 ? "s" : ""} selected</span>
              </>
            ) : (
              <span className="text-sm text-gray-400">No controls selected yet</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onConfirm(selectedControls, activeFw?.name ?? ""); onClose(); }}
              className="px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
            >
              Apply {selected.size > 0 ? `(${selected.size})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PolicyGeneratorPage() {
  const user = useAuthStore((u) => u);
  const orgName = user?.org ?? "";
  const { refreshAiTokens } = useAiTokenRefresh();

  const [activeCategory, setActiveCategory] = useState<string>("foundation");
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);

  // Right sidebar
  const [showSidebar, setShowSidebar] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);

  // Control picker modal
  const [showControlPicker, setShowControlPicker] = useState(false);
  const [targetControls, setTargetControls] = useState<FrameworkControl[]>([]);

  // Load pre-selected controls from Frameworks page (via sessionStorage)
  const [preselectedControls, setPreselectedControls] = useState<{ control_id: string; title: string }[]>([]);
  const [preselectedFramework, setPreselectedFramework] = useState<{ name: string; short_name: string } | null>(null);

  useEffect(() => {
    try {
      const fwRaw = sessionStorage.getItem("docgen_framework");
      const ctrlRaw = sessionStorage.getItem("docgen_controls");
      if (fwRaw) setPreselectedFramework(JSON.parse(fwRaw));
      if (ctrlRaw) setPreselectedControls(JSON.parse(ctrlRaw));
    } catch { /* ignore */ }
  }, []);

  // Org context form
  const [form, setForm] = useState({
    org_name: orgName,
    industry: "",
    size: "smb",
    country: "US",
    frameworks: [] as string[],
    specific_requirements: "",
  });

  // Generation state
  const [output, setOutput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [approved, setApproved] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<string>("");

  // Auto-populate framework from Frameworks page selection
  useEffect(() => {
    if (preselectedFramework) {
      setForm(f => ({
        ...f,
        frameworks: f.frameworks.includes(preselectedFramework.short_name)
          ? f.frameworks
          : [...f.frameworks, preselectedFramework.short_name],
      }));
    }
  }, [preselectedFramework]);

  // Auto-scroll while streaming
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, streaming]);

  // Fetch user's previously generated policies
  const { data: policiesData, refetch: refetchPolicies } = useQuery({
    queryKey: ["policies"],
    queryFn: () => policiesApi.list({ limit: 50 }),
    retry: false,
  });

  const previousPolicies = Array.isArray(policiesData) ? policiesData : (policiesData as any)?.items || [];

  const handleDeletePolicy = async (policyId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    try {
      await policiesApi.delete(policyId);
      await refetchPolicies();
      if (selectedPolicyId === policyId) {
        setSelectedPolicyId(null);
        setOutput("");
        setEditContent("");
        setDone(false);
      }
    } catch (err: any) {
      alert(`Delete failed: ${err?.response?.status} ${err?.response?.data?.detail ?? err?.message}`);
      console.error("Failed to delete policy:", err);
    }
  };

  const generate = useCallback(async () => {
    if (!selectedDoc || !form.org_name || !form.industry) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setOutput("");
    setDone(false);
    setError("");
    setSaved(false);
    setEditing(false);
    setEditContent("");
    outputRef.current = "";
    setApproved(false);
    setStreaming(true);

    const filter = makeThinkFilter();

    try {
      await aiApi.streamDocumentGeneration(
        {
          document_type: selectedDoc,
          org_name: form.org_name,
          industry: form.industry,
          size: form.size,
          country: form.country,
          frameworks: form.frameworks.length > 0 ? form.frameworks.join(", ") : undefined,
          specific_requirements: (() => {
          const parts: string[] = [];
          if (form.specific_requirements) parts.push(form.specific_requirements);
          const allControls = [
            ...targetControls,
            ...preselectedControls.map(c => ({ control_id: c.control_id, title: c.title } as FrameworkControl)),
          ];
          if (allControls.length > 0)
            parts.push(`Target controls: ${allControls.map(c => `${c.control_id} (${c.title})`).join("; ")}`);
          return parts.length > 0 ? parts.join("\n") : undefined;
        })(),
        },
        (token) => {
          const filtered = filter(token);
          if (filtered) {
            outputRef.current += filtered;
            setOutput((prev) => prev + filtered);
          }
        },
        async () => {
          setStreaming(false);
          setDone(true);
          await refreshAiTokens();
          // Auto-save as draft so it appears in history immediately
          if (selectedDoc && outputRef.current.trim()) {
            try {
              const category = DOCUMENT_CATEGORIES.find(c => c.docs.some(d => d === selectedDoc))?.label || "General";
              await policiesApi.create({
                title: selectedDoc,
                description: `AI-generated ${selectedDoc} for ${form.org_name}. Industry: ${form.industry}. Frameworks: ${form.frameworks.join(", ") || "None"}.`,
                category,
                linked_controls: [],
                content: outputRef.current,
              } as any);
              setSaved(true);
              await refetchPolicies();
            } catch {
              // silent — user can still save manually
            }
          }
        },
        ctrl.signal,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError("Generation failed. Make sure Ollama is running.");
      }
      setStreaming(false);
    }
  }, [selectedDoc, form]);

  // The authoritative content — original AI output, or user-edited version
  const currentContent = editing ? editContent : (editContent || output);

  function handleEnterEdit() {
    setEditContent(output);
    setEditing(true);
  }

  function handleExitEdit() {
    // Keep edits in editContent so they persist when switching back
    setEditing(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    if (!selectedDoc || !currentContent) return;
    // Convert markdown-like content to styled HTML then print as PDF
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${selectedDoc}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.6; margin: 40px; color: #1a1a1a; }
    h1 { font-size: 20pt; font-weight: bold; margin-top: 24px; margin-bottom: 8px; }
    h2 { font-size: 15pt; font-weight: bold; margin-top: 20px; margin-bottom: 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; color: #1e3a8a; }
    h3 { font-size: 13pt; font-weight: bold; margin-top: 16px; margin-bottom: 4px; }
    h4 { font-size: 12pt; font-weight: 600; margin-top: 12px; margin-bottom: 4px; color: #444; }
    p { margin: 4px 0 6px 0; }
    li { margin: 2px 0; }
    ul, ol { padding-left: 24px; }
    hr { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
${currentContent
  .split("\n")
  .map(line => {
    if (line.startsWith("# "))   return `<h1>${line.slice(2)}</h1>`;
    if (line.startsWith("## "))  return `<h2>${line.slice(3)}</h2>`;
    if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
    if (line.startsWith("#### ")) return `<h4>${line.slice(5)}</h4>`;
    if (line.startsWith("- ") || line.startsWith("* ")) return `<li>${line.slice(2)}</li>`;
    if (/^\d+\. /.test(line)) return `<li>${line.replace(/^\d+\. /, "")}</li>`;
    if (line.startsWith("---")) return `<hr>`;
    if (line.trim() === "") return `<br>`;
    return `<p>${line}</p>`;
  })
  .join("\n")}
</body>
</html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(htmlContent);
    win.document.close();
    win.onload = () => {
      win.focus();
      win.print();
      win.close();
    };
  }

  async function handleSaveToPolicies() {
    if (!selectedDoc) return;
    try {
      const content = editing ? editContent : output;
      const category = DOCUMENT_CATEGORIES.find(c => c.docs.some(d => d === selectedDoc))?.label || "General";

      await policiesApi.create({
        title: selectedDoc,
        description: `AI-generated ${selectedDoc} for ${form.org_name}. Industry: ${form.industry}. Frameworks: ${form.frameworks.join(", ") || "None"}.`,
        category,
        linked_controls: preselectedControls.map(c => c.control_id),
        content, // initial version content
      } as any);

      setSaved(true);
      await refetchPolicies();
    } catch (err) {
      console.error("Failed to save policy:", err);
      setError("Failed to save document. Please try again.");
    }
  }

  async function handleApprove() {
    if (!selectedDoc) return;
    try {
      const content = editing ? editContent : output;
      const category = DOCUMENT_CATEGORIES.find(c => c.docs.some(d => d === selectedDoc))?.label || "General";

      await policiesApi.create({
        title: selectedDoc,
        description: `AI-generated ${selectedDoc} for ${form.org_name}. Industry: ${form.industry}. Frameworks: ${form.frameworks.join(", ") || "None"}.`,
        category,
        status: "approved",
        linked_controls: preselectedControls.map(c => c.control_id),
        content, // initial version content
      } as any);

      setApproved(true);
      setSaved(true);
      await refetchPolicies();
    } catch (err) {
      console.error("Failed to approve policy:", err);
      setError("Failed to save document. Please try again.");
    }
  }

  const canGenerate = !!selectedDoc && !!form.org_name.trim() && !!form.industry && !streaming;
  const currentCat = DOCUMENT_CATEGORIES.find((c) => c.id === activeCategory);

  return (
    <AiGate featureLabel="Document Generator">
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">

      {/* ── LEFT PANEL ────────────────────────────────────────────────────── */}
      <div className="w-96 flex-shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-base font-bold text-gray-900">Document Generator</h1>
          </div>
          <p className="text-xs text-gray-400 ml-9">AI-powered GRC documents tailored to your organization</p>
        </div>

        {/* Category tabs */}
        <div className="px-3 pt-3 flex gap-1 flex-wrap">
          {DOCUMENT_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? "bg-white shadow-sm border border-gray-200 text-gray-800" : "text-gray-500 hover:text-gray-700 hover:bg-white/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {cat.label.split(" ")[0]}
              </button>
            );
          })}
        </div>

        {/* Document list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {currentCat && (
            <>
              <p className="text-[11px] text-gray-400 px-1 py-1.5">{currentCat.description}</p>
              <div className="space-y-0.5">
                {(currentCat.docs as readonly string[]).map((doc) => {
                  const isSelected = selectedDoc === doc;
                  return (
                    <button
                      key={doc}
                      onClick={() => { setSelectedDoc(doc); setOutput(""); setDone(false); setError(""); }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left text-sm transition-colors ${
                        isSelected
                          ? "bg-blue-600 text-white"
                          : "text-gray-700 hover:bg-white hover:shadow-sm"
                      }`}
                    >
                      <span className="truncate font-medium">{doc}</span>
                      <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? "text-white/70" : "text-gray-300"}`} />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Org context form */}
        <div className="border-t border-gray-200 bg-white px-4 py-4 space-y-3 overflow-y-auto max-h-[55vh] flex-shrink-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Organization</p>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Company Name *</label>
            <input
              type="text"
              value={form.org_name}
              onChange={(e) => setForm((f) => ({ ...f, org_name: e.target.value }))}
              placeholder="Acme Corp"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Industry *</label>
              <select
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select…</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Company Size *</label>
              <select
                value={form.size}
                onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {SIZES.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.sub})</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Country / Jurisdiction</label>
            <input
              type="text"
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              placeholder="US, France, UK…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Target Frameworks</label>
            <div className="flex flex-wrap gap-1.5">
              {FRAMEWORKS.map((fw) => {
                const on = form.frameworks.includes(fw);
                return (
                  <button
                    key={fw}
                    onClick={() => setForm((f) => ({
                      ...f,
                      frameworks: on ? f.frameworks.filter((x) => x !== fw) : [...f.frameworks, fw],
                    }))}
                    className={`text-xs px-2 py-0.5 rounded-md border font-medium transition-colors ${
                      on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    {fw}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target Controls */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-500">Target Controls <span className="text-gray-400">(optional)</span></label>
              {targetControls.length > 0 && (
                <button type="button" onClick={() => setTargetControls([])}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                  Clear all
                </button>
              )}
            </div>

            {/* Selected control chips */}
            {targetControls.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2 max-h-16 overflow-y-auto p-2 bg-gray-50 rounded-lg border border-gray-100">
                {targetControls.map(c => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 text-[10px] font-mono font-medium bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded cursor-pointer hover:bg-red-100 hover:text-red-600 transition-colors"
                    title={c.title}
                    onClick={() => setTargetControls(prev => prev.filter(x => x.id !== c.id))}
                  >
                    {c.control_id} <X className="w-2.5 h-2.5" />
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowControlPicker(true)}
              className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-300 rounded-lg text-xs font-medium text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {targetControls.length > 0 ? `${targetControls.length} controls selected — click to edit` : "Pick controls from a framework…"}
            </button>
          </div>

          {/* Pre-selected controls banner (from Frameworks page) */}
          {preselectedControls.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-blue-700">
                  {preselectedControls.length} controls pre-selected from {preselectedFramework?.short_name ?? "framework"}
                </p>
                <button
                  type="button"
                  onClick={() => { setPreselectedControls([]); sessionStorage.removeItem("docgen_controls"); sessionStorage.removeItem("docgen_framework"); }}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {preselectedControls.map(c => (
                  <span key={c.control_id} className="text-[10px] font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                    {c.control_id}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Special Requirements <span className="text-gray-400">(optional)</span></label>
            <textarea
              rows={2}
              value={form.specific_requirements}
              onChange={(e) => setForm((f) => ({ ...f, specific_requirements: e.target.value }))}
              placeholder="e.g. We process EU personal data (GDPR), we have PCI scope for card payments…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <button
            onClick={generate}
            disabled={!canGenerate}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-40 text-white font-semibold text-sm py-2.5 rounded-xl transition-all"
          >
            {streaming ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Generate Document</>
            )}
          </button>
        </div>
      </div>

      {/* ── RIGHT PANEL ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">

        {/* Output toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            {selectedDoc ? (
              <>
                <span className="text-sm font-semibold text-gray-800">{selectedDoc}</span>
                {streaming && (
                  <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                    <Loader2 className="w-3 h-3 animate-spin" /> Writing…
                  </span>
                )}
                {done && !editing && !approved && (
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Ready to review</span>
                )}
                {editing && (
                  <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> Editing
                  </span>
                )}
                {approved && (
                  <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Approved
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm text-gray-400">Select a document type to get started</span>
            )}
          </div>

          {done && output && (
            <div className="flex items-center gap-2">
              {/* Edit / Preview toggle */}
              {!approved && (
                <button
                  onClick={editing ? handleExitEdit : handleEnterEdit}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                    editing
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {editing ? <><Eye className="w-3.5 h-3.5" /> Preview</> : <><Pencil className="w-3.5 h-3.5" /> Edit</>}
                </button>
              )}

              <div className="w-px h-4 bg-gray-200" />

              <button
                onClick={generate}
                disabled={editing}
                className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Regenerate
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>

              <div className="w-px h-4 bg-gray-200" />

              {!approved ? (
                <>
                  <button
                    onClick={handleSaveToPolicies}
                    disabled={saved}
                    className="flex items-center gap-1.5 text-xs text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" /> Save as Draft
                  </button>
                  <button
                    onClick={handleApprove}
                    className="flex items-center gap-1.5 text-xs text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Approve & Save
                  </button>
                </>
              ) : (
                <span className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${approved ? "text-green-700 bg-green-50 border border-green-200" : "text-blue-700 bg-blue-50 border border-blue-200"}`}>
                  <CheckCheck className="w-3.5 h-3.5" />
                  {approved ? "Approved & Saved" : "Saved as Draft"}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Output area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6">
          {error && (
            <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              <X className="w-4 h-4 flex-shrink-0" />
              {error}
              <button onClick={generate} className="ml-2 underline text-red-600">Retry</button>
            </div>
          )}

          {output ? (
            <div className="max-w-3xl mx-auto">
              {editing ? (
                /* ── Edit mode: raw textarea ── */
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                    <Pencil className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Editing mode — modify the document below. Click <strong>Preview</strong> to see the formatted result.</span>
                  </div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full min-h-[70vh] border border-indigo-200 rounded-xl px-4 py-4 text-sm font-mono text-gray-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none bg-white"
                    spellCheck={false}
                  />
                </div>
              ) : (
                /* ── Preview mode: rendered markdown ── */
                <>
                  {editContent && editContent !== output && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
                      <Pencil className="w-3.5 h-3.5 flex-shrink-0" />
                      This document has been edited. Click <strong className="ml-1">Edit</strong> to continue editing.
                    </div>
                  )}
                  {renderMarkdown(editContent || output)}
                  {streaming && (
                    <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-0.5 rounded-sm align-text-bottom" />
                  )}
                </>
              )}
            </div>
          ) : !streaming ? (
            // Empty state
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center mb-5">
                <Wand2 className="w-9 h-9 text-purple-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-800 mb-2">AI Document Generator</h2>
              <p className="text-sm text-gray-400 max-w-sm mb-6">
                Select a document type from the left panel, fill in your organization details,
                and let AI generate a complete, ready-to-adapt GRC document in seconds.
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md text-left">
                {DOCUMENT_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all text-left`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cat.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-700">{cat.label}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{cat.docs.length} documents</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-purple-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting generation…
            </div>
          )}
        </div>

        {/* Tip footer */}
        {!output && !streaming && (
          <div className="border-t border-gray-50 px-6 py-3 flex-shrink-0">
            <p className="text-xs text-gray-400 text-center">
              💡 Tip: Add your specific requirements (GDPR scope, PCI cardholder data, etc.) for a more tailored document
            </p>
          </div>
        )}
      </div>

      {/* ── RIGHT SIDEBAR (Collapsible Previous Documents) ────────────────────────────── */}
      {showSidebar && (
        <div className="w-72 flex-shrink-0 border-l border-gray-100 bg-white flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">Previously Generated</h2>
              </div>
              <p className="text-xs text-gray-400">Your recent documents</p>
            </div>
            <button
              onClick={() => setShowSidebar(false)}
              className="p-1 hover:bg-gray-200 text-gray-400 hover:text-gray-600 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Documents list */}
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-2 p-3">
              {previousPolicies.length > 0 ? (
                previousPolicies.map((policy: any) => {
                  const isSelected = selectedPolicyId === policy.id;
                  return (
                    <div
                      key={policy.id}
                      onClick={async () => {
                        setSelectedPolicyId(policy.id);
                        setSelectedDoc(policy.title);
                        setEditing(false);
                        setEditContent("");
                        setDone(true);
                        try {
                          const versions = await policiesApi.getVersions(String(policy.id));
                          const current = versions.find(v => v.is_current) ?? versions[0];
                          setOutput(current?.content ?? "No content found for this document.");
                        } catch {
                          setOutput("Failed to load document content.");
                        }
                      }}
                      className={`group p-3 rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? "border-blue-300 shadow-md bg-blue-50"
                          : "border-gray-100 hover:border-gray-200 hover:shadow-sm bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <FileText className="w-3.5 h-3.5 text-purple-500 flex-shrink-0 mt-1" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${isSelected ? "text-blue-900" : "text-gray-900"}`}>
                            {policy.title}
                          </p>
                          <p className={`text-[11px] mt-0.5 ${isSelected ? "text-blue-600" : "text-gray-400"}`}>
                            {new Date(policy.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                            policy.status === "approved"
                              ? "bg-green-50 text-green-700"
                              : "bg-yellow-50 text-yellow-700"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              policy.status === "approved" ? "bg-green-500" : "bg-yellow-500"
                            }`}
                          />
                          {policy.status === "approved" ? "Approved" : "Draft"}
                        </span>
                        <button
                          onClick={(e) => handleDeletePolicy(String(policy.id), e)}
                          className="p-1 hover:bg-red-50 text-gray-300 hover:text-red-600 rounded transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <FileText className="w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-xs font-medium text-gray-500 mb-1">No documents yet</p>
                  <p className="text-[11px] text-gray-400">Generate your first document using the form on the left</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 px-3 py-3 bg-gray-50 flex-shrink-0">
            <a href="/policies" className="w-full block text-center text-xs text-blue-600 hover:text-blue-700 font-medium py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
              View all documents →
            </a>
          </div>
        </div>
      )}

      {/* Toggle sidebar button (when closed) */}
      {!showSidebar && (
        <button
          onClick={() => setShowSidebar(true)}
          className="w-12 flex-shrink-0 border-l border-gray-100 bg-white hover:bg-gray-50 flex items-center justify-center transition-colors"
          title="Show previous documents"
        >
          <Clock className="w-5 h-5 text-gray-400 hover:text-gray-600" />
        </button>
      )}

      {/* Control Picker Modal */}
      <ControlPickerModal
        open={showControlPicker}
        onClose={() => setShowControlPicker(false)}
        onConfirm={(controls) => setTargetControls(controls)}
        initial={targetControls}
      />
    </div>
    </AiGate>
  );
}
