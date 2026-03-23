import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Upload, FileText, Play, Loader2,
  CheckCircle, XCircle, AlertTriangle, MinusCircle,
  ChevronDown, ChevronUp, Sparkles, Globe, GitBranch,
  Download, Table2, Paperclip, X, MessageSquare,
} from "lucide-react";
import { complianceApi } from "@/api/endpoints";
import type { AssessmentDetail, GapDetail, ControlAssessmentDetail } from "@/types";
import PolicyGeneratorModal from "@/components/features/compliance/PolicyGeneratorModal";
import DocumentChecklistTab from "@/components/features/compliance/DocumentChecklistTab";
import GapReportTab from "@/components/features/compliance/GapReportTab";
import { exportComplianceCSV, exportComplianceReport } from "@/utils/exportUtils";

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  implemented:           { label: "Compliant",  icon: CheckCircle,   color: "text-green-600 bg-green-50"  },
  partially_implemented: { label: "Partial",    icon: AlertTriangle, color: "text-yellow-600 bg-yellow-50"},
  not_implemented:       { label: "Gap",        icon: XCircle,       color: "text-red-600 bg-red-50"      },
  not_applicable:        { label: "N/A",        icon: MinusCircle,   color: "text-gray-400 bg-gray-50"    },
  not_started:           { label: "Not Started",icon: MinusCircle,   color: "text-gray-400 bg-gray-50"    },
  in_progress:           { label: "In Progress",icon: Loader2,       color: "text-blue-600 bg-blue-50"    },
} as const;

function ControlStatusBadge({ status }: { readonly status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.not_started;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      <cfg.icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-700 bg-red-100",
  high:     "text-orange-700 bg-orange-100",
  medium:   "text-yellow-700 bg-yellow-100",
  low:      "text-gray-600 bg-gray-100",
};

function scoreColor(s: number) {
  if (s >= 80) return "text-green-700";
  if (s >= 60) return "text-yellow-600";
  return "text-red-600";
}

// ─── Tab: Upload & Analyze ─────────────────────────────────────────────────────

function UploadTab({
  assessment,
  onAnalyzed,
}: {
  readonly assessment: AssessmentDetail;
  readonly onAnalyzed: (updated: AssessmentDetail) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [docs, setDocs] = useState(assessment.uploaded_documents);
  const [analyzeResult, setAnalyzeResult] = useState<null | { controls_analyzed: number; compliance_score: number }>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    for (const file of Array.from(files)) {
      try {
        const doc = await complianceApi.uploadDocument(assessment.id, file);
        setDocs((prev) => [...prev, doc]);
      } catch {
        setError(`Failed to upload ${file.name}. Only PDF, DOCX, TXT are supported (max 10MB).`);
      }
    }
    setUploading(false);
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setError("");
    try {
      const result = await complianceApi.analyzeAssessment(assessment.id);
      setAnalyzeResult(result);
      // Reload full assessment
      const updated = await complianceApi.getResults(assessment.id);
      onAnalyzed(updated);
    } catch {
      setError("Analysis failed. Make sure Ollama is running and the model is available.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
          dragOver ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploading ? (
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" />
        ) : (
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        )}
        <p className="text-sm font-medium text-gray-700">
          {uploading ? "Uploading…" : "Drop files here or click to browse"}
        </p>
        <p className="text-xs text-gray-400 mt-1">PDF, DOCX, TXT — max 10 MB each</p>
      </div>

      {/* Uploaded docs */}
      {docs.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{doc.file_name}</p>
                {doc.file_size_bytes && (
                  <p className="text-xs text-gray-400">{(doc.file_size_bytes / 1024).toFixed(1)} KB</p>
                )}
              </div>
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {analyzeResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
          Analysis complete — {analyzeResult.controls_analyzed} controls evaluated, score: {analyzeResult.compliance_score}%
        </div>
      )}

      {/* Analyze button */}
      <div className="flex justify-end">
        <button
          onClick={runAnalysis}
          disabled={docs.length === 0 || analyzing}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
        >
          {analyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing {assessment.framework_short_name} controls…
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run AI Analysis
            </>
          )}
        </button>
      </div>

      {analyzing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          AI is analyzing your documents against the framework controls. This may take 1–5 minutes depending on the model and number of controls.
        </div>
      )}
    </div>
  );
}

// ─── Tab: Results ──────────────────────────────────────────────────────────────

function ResultsTab({
  assessment,
}: {
  readonly assessment: AssessmentDetail;
}) {
  const [filter, setFilter] = useState<"all" | "implemented" | "partial" | "gap">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [policyGap, setPolicyGap] = useState<GapDetail | null>(null);
  const [overrides, setOverrides]         = useState<Record<string, string>>({});
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [attachments, setAttachments]     = useState<Record<string, File>>({});
  const [dragOver, setDragOver]           = useState<string | null>(null);
  const [history, setHistory]             = useState<Record<string, { status: string; by: string; at: string }[]>>({});
  const [saving, setSaving]               = useState<string | null>(null);

  async function handleStatusOverride(caId: string, currentStatus: string, newStatus: string) {
    if (newStatus === currentStatus) return;
    setSaving(caId);
    try {
      await complianceApi.updateControlAssessment(caId, { status: newStatus as import("@/types").ControlStatus });
      setOverrides((prev) => ({ ...prev, [caId]: newStatus }));
      setHistory((prev) => ({
        ...prev,
        [caId]: [
          ...(prev[caId] ?? [{ status: currentStatus, by: "AI Analysis", at: new Date(assessment.updated_at).toLocaleDateString() }]),
          { status: newStatus, by: "Manual override", at: new Date().toLocaleDateString() },
        ],
      }));
    } catch {/* silent */} finally {
      setSaving(null);
    }
  }

  async function saveJustification(caId: string) {
    const text = justifications[caId];
    if (!text?.trim()) return;
    setSaving(caId);
    try {
      await complianceApi.updateControlAssessment(caId, { notes: text } as never);
    } catch {/* silent */} finally {
      setSaving(null);
    }
  }

  function handleFileDrop(caId: string, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file) setAttachments(prev => ({ ...prev, [caId]: file }));
  }

  function handleFileInput(caId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setAttachments(prev => ({ ...prev, [caId]: file }));
  }

  const cas = assessment.control_assessments;
  function effectiveStatus(ca: ControlAssessmentDetail) {
    return overrides[ca.id] ?? ca.status;
  }

  const filtered = cas.filter((ca) => {
    const st = effectiveStatus(ca);
    if (filter === "implemented") return st === "implemented";
    if (filter === "partial") return st === "partially_implemented";
    if (filter === "gap") return st === "not_implemented";
    return true;
  });

  const counts = {
    all: cas.length,
    implemented: cas.filter((c) => effectiveStatus(c) === "implemented").length,
    partial: cas.filter((c) => effectiveStatus(c) === "partially_implemented").length,
    gap: cas.filter((c) => effectiveStatus(c) === "not_implemented").length,
  };

  function findGap(ca: ControlAssessmentDetail): GapDetail | undefined {
    return assessment.gaps.find((g) => g.control_id === ca.control_id);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {policyGap && (
        <PolicyGeneratorModal
          gap={policyGap}
          frameworkShortName={assessment.framework_short_name}
          assessmentContext={assessment.scope_description}
          onClose={() => setPolicyGap(null)}
        />
      )}

      {/* Score summary */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 flex items-center gap-6">
        <div className="text-center">
          <p className={`text-5xl font-bold ${scoreColor(assessment.compliance_score ?? 0)}`}>
            {assessment.compliance_score ?? 0}%
          </p>
          <p className="text-sm text-gray-500 mt-1">Compliance score</p>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-4">
          {[
            { label: "Compliant",  count: counts.implemented, color: "text-green-600" },
            { label: "Partial",    count: counts.partial,     color: "text-yellow-600" },
            { label: "Gaps",       count: counts.gap,         color: "text-red-600"   },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={() => exportComplianceCSV(
              cas.map((c) => ({
                control_identifier: c.control_identifier,
                control_title: c.control_title,
                control_category: c.control_category,
                status: c.status,
                notes: c.notes,
                implementation_notes: c.implementation_notes,
              })),
              assessment.name,
              assessment.framework_name ?? assessment.framework_short_name ?? ""
            )}
            className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Table2 className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            onClick={() => exportComplianceReport({
              assessmentName: assessment.name,
              frameworkName: assessment.framework_name ?? "",
              frameworkShortName: assessment.framework_short_name ?? "",
              complianceScore: assessment.compliance_score ?? null,
              generatedAt: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
              org: "",
              statusCounts: {
                implemented: counts.implemented,
                partially_implemented: counts.partial,
                not_implemented: counts.gap,
                not_applicable: cas.filter((c) => c.status === "not_applicable").length,
                total: cas.length,
              },
              gaps: assessment.gaps.map((g) => ({
                control_identifier: g.control_identifier,
                control_title: g.control_title,
                severity: g.severity,
                gap_description: g.gap_description,
                remediation_steps: g.remediation_steps,
                is_certification_blocker: g.is_certification_blocker,
                recommendation_status: g.recommendation_status ?? "pending",
              })),
              controls: cas.map((c) => ({
                control_identifier: c.control_identifier,
                control_title: c.control_title,
                control_category: c.control_category,
                status: c.status,
                notes: c.notes,
                implementation_notes: c.implementation_notes,
              })),
            })}
            className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Full Report
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "implemented", "partial", "gap"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === f
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f === "all" ? "All" : f === "implemented" ? "Compliant" : f === "partial" ? "Partial" : "Gaps"}
            <span className="ml-1.5 opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Controls list */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
        {filtered.map((ca) => {
          const gap = findGap(ca);
          const isExpanded = expanded.has(ca.id);
          return (
            <div key={ca.id} className="p-4">
              <div className="flex items-start gap-3">
                <button
                  onClick={() => toggleExpand(ca.id)}
                  className="flex items-start gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                        {ca.control_identifier}
                      </span>
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {ca.control_title}
                      </span>
                      {ca.control_category && (
                        <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                          {ca.control_category}
                        </span>
                      )}
                    </div>
                    {ca.implementation_notes && !isExpanded && (
                      <p className="text-xs text-gray-500 truncate">{ca.implementation_notes}</p>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  )}
                </button>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {ca.ai_confidence != null && (
                    <span className="text-xs text-gray-400">{Math.round(ca.ai_confidence * 100)}%</span>
                  )}
                  <ControlStatusBadge status={effectiveStatus(ca)} />
                  {gap && (
                    <button
                      onClick={() => setPolicyGap(gap)}
                      className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded-full transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      Generate policy
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 ml-0 pl-4 border-l-2 border-gray-100 space-y-2">
                  {ca.control_description && (
                    <p className="text-xs text-gray-600">{ca.control_description}</p>
                  )}
                  {ca.implementation_notes && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">AI Assessment</p>
                      <p className="text-xs text-gray-700">{ca.implementation_notes}</p>
                    </div>
                  )}
                  {gap && (
                    <div className="bg-red-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-semibold text-red-700">Gap identified</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLOR[gap.severity] ?? "text-gray-600 bg-gray-100"}`}>
                          {gap.severity}
                        </span>
                      </div>
                      <p className="text-xs text-red-700">{gap.gap_description}</p>
                      {gap.remediation_steps && (
                        <p className="text-xs text-gray-600 mt-1">{gap.remediation_steps}</p>
                      )}
                    </div>
                  )}
                  {ca.cross_framework_coverage.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Maps to</p>
                      <div className="flex flex-wrap gap-1">
                        {ca.cross_framework_coverage.map((m, i) => (
                          <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">
                            {m.framework} {m.control}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Manual override */}
                  <div className="flex items-center gap-2 pt-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Override status:</p>
                    <select
                      value={effectiveStatus(ca)}
                      onChange={(e) => handleStatusOverride(ca.id, effectiveStatus(ca), e.target.value)}
                      disabled={saving === ca.id}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="implemented">Compliant</option>
                      <option value="partially_implemented">Partial</option>
                      <option value="not_implemented">Gap</option>
                      <option value="not_applicable">N/A</option>
                    </select>
                    {saving === ca.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                    {overrides[ca.id] && (
                      <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">manually overridden</span>
                    )}
                  </div>

                  {/* Justification + evidence */}
                  <div className="mt-3 space-y-2">
                    {/* Text justification */}
                    <div className="relative">
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquare className="w-3 h-3 text-gray-400" />
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Justification</p>
                      </div>
                      <textarea
                        rows={2}
                        value={justifications[ca.id] ?? ""}
                        onChange={e => setJustifications(prev => ({ ...prev, [ca.id]: e.target.value }))}
                        onBlur={() => saveJustification(ca.id)}
                        placeholder="Explain why this status was set — e.g. control is covered by policy X, compensating control in place, risk accepted…"
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none text-gray-700 placeholder-gray-300"
                      />
                    </div>

                    {/* File drop zone */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Paperclip className="w-3 h-3 text-gray-400" />
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Evidence file</p>
                      </div>
                      {attachments[ca.id] ? (
                        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                          <FileText className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                          <span className="text-xs text-green-700 font-medium flex-1 truncate">{attachments[ca.id].name}</span>
                          <span className="text-[10px] text-green-500">{(attachments[ca.id].size / 1024).toFixed(0)} KB</span>
                          <button
                            type="button"
                            onClick={() => setAttachments(prev => { const n = { ...prev }; delete n[ca.id]; return n; })}
                            className="p-0.5 rounded hover:bg-green-100 text-green-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div
                          onDragOver={e => { e.preventDefault(); setDragOver(ca.id); }}
                          onDragLeave={() => setDragOver(null)}
                          onDrop={e => handleFileDrop(ca.id, e)}
                          className={`relative flex items-center gap-2 px-3 py-2.5 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                            dragOver === ca.id
                              ? "border-blue-400 bg-blue-50"
                              : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                          }`}
                        >
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.png,.jpg,.xlsx,.csv"
                            onChange={e => handleFileInput(ca.id, e)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          <Upload className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                          <span className="text-xs text-gray-400">
                            Drop a file or <span className="text-blue-500 font-medium">browse</span>
                            <span className="text-gray-300 ml-1">· PDF, DOC, PNG, XLSX</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status change history */}
                  {history[ca.id] && history[ca.id].length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Status History</p>
                      <div className="space-y-1">
                        {history[ca.id].map((h, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                            <span className="font-medium text-gray-700">{STATUS_CONFIG[h.status as keyof typeof STATUS_CONFIG]?.label ?? h.status}</span>
                            <span>·</span>
                            <span>{h.by}</span>
                            <span>·</span>
                            <span className="text-gray-400">{h.at}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400">No controls in this category.</div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Cross-Framework Coverage ────────────────────────────────────────────

const FW_DESCRIPTIONS: Record<string, { desc: string; category: string; color: string; bg: string }> = {
  "SOC 2":          { desc: "Trust Services Criteria for SaaS/cloud providers", category: "Audit",       color: "text-purple-700", bg: "bg-purple-50" },
  "NIST CSF":       { desc: "Cybersecurity Framework — Govern, Identify, Protect, Detect, Respond", category: "Security",    color: "text-indigo-700", bg: "bg-indigo-50" },
  "NIST 800-53":    { desc: "Comprehensive controls for US federal systems", category: "Government",  color: "text-slate-700",  bg: "bg-slate-50"   },
  "GDPR":           { desc: "EU data protection regulation", category: "Privacy",     color: "text-emerald-700", bg: "bg-emerald-50" },
  "HIPAA":          { desc: "US healthcare data protection (PHI/ePHI)", category: "Healthcare",  color: "text-red-700",    bg: "bg-red-50"     },
  "PCI DSS":        { desc: "Payment card data security standard", category: "Finance",     color: "text-orange-700", bg: "bg-orange-50"  },
  "CIS Controls":   { desc: "18 prioritized security controls", category: "Security",    color: "text-cyan-700",   bg: "bg-cyan-50"    },
  "ISO 27001":      { desc: "Information Security Management System", category: "Security",    color: "text-blue-700",   bg: "bg-blue-50"    },
};

function fitLabel(pct: number): { label: string; color: string; bg: string } {
  if (pct >= 75) return { label: "Excellent fit",  color: "text-green-700",  bg: "bg-green-50 border-green-200"  };
  if (pct >= 50) return { label: "Good fit",        color: "text-blue-700",   bg: "bg-blue-50 border-blue-200"    };
  if (pct >= 25) return { label: "Partial fit",     color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200"};
  return               { label: "Low overlap",      color: "text-gray-500",   bg: "bg-gray-50 border-gray-200"    };
}

function CrossFrameworkTab({
  assessment,
  onRerunAnalysis,
}: {
  readonly assessment: AssessmentDetail;
  readonly onRerunAnalysis: () => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const summary = assessment.cross_framework_summary;
  const entries = Object.entries(summary).sort((a, b) => b[1].percent - a[1].percent);

  async function runAnalysis() {
    setRunning(true);
    try { await onRerunAnalysis(); } finally { setRunning(false); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Cross-Framework Coverage</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Based on your <strong>{assessment.framework_short_name}</strong> compliance, see which other frameworks you already partially satisfy — and which to adopt next.
          </p>
        </div>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex-shrink-0"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
          {running ? "Analyzing…" : entries.length === 0 ? "Run Analysis" : "Re-run Analysis"}
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl py-14 text-center">
          <GitBranch className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No cross-framework data yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Run the analysis to discover which frameworks your current compliance already covers.</p>
          <button
            type="button"
            onClick={runAnalysis}
            disabled={running}
            className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {running ? "Running…" : "Run Cross-Framework Analysis"}
          </button>
        </div>
      ) : (
        <>
          {/* Summary legend */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Frameworks mapped",    value: entries.length,                                              color: "text-indigo-600" },
              { label: "Best overlap",          value: `${entries[0]?.[1].percent ?? 0}%`,                         color: "text-green-600"  },
              { label: "Ready to certify (≥75%)", value: entries.filter(([,d]) => d.percent >= 75).length,         color: "text-blue-600"   },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Framework cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {entries.map(([fw, data]) => {
              const meta = FW_DESCRIPTIONS[fw] ?? { desc: "", category: "Security", color: "text-gray-700", bg: "bg-gray-50" };
              const fit  = fitLabel(data.percent);
              const isOpen = expanded === fw;
              const gap = data.total_mapped - data.covered;
              return (
                <div
                  key={fw}
                  className={`bg-white rounded-2xl border transition-all ${isOpen ? "border-indigo-200 shadow-md" : "border-gray-100 hover:border-indigo-100 hover:shadow-sm"}`}
                >
                  <button
                    type="button"
                    className="w-full text-left p-5"
                    onClick={() => setExpanded(isOpen ? null : fw)}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{meta.category}</span>
                        <h3 className="text-sm font-bold text-gray-900">{fw}</h3>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${fit.bg} ${fit.color}`}>{fit.label}</span>
                        <span className={`text-base font-bold ${scoreColor(data.percent)}`}>{data.percent}%</span>
                      </div>
                    </div>

                    {meta.desc && <p className="text-xs text-gray-400 mb-3">{meta.desc}</p>}

                    {/* Progress bar */}
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full transition-all ${data.percent >= 75 ? "bg-green-500" : data.percent >= 50 ? "bg-blue-500" : data.percent >= 25 ? "bg-yellow-400" : "bg-red-400"}`}
                        style={{ width: `${data.percent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span><strong className="text-green-600">{data.covered}</strong> controls covered</span>
                      <span><strong className="text-red-400">{gap}</strong> gaps remaining</span>
                      <span className="text-gray-300">{data.total_mapped} mapped total</span>
                    </div>
                  </button>

                  {/* Expanded: covered controls + recommendation */}
                  {isOpen && (
                    <div className="px-5 pb-5 border-t border-gray-50 pt-4 space-y-3">
                      {data.controls.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Already covered controls</p>
                          <div className="flex flex-wrap gap-1">
                            {data.controls.map((c, i) => (
                              <span key={i} className="text-xs font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-100">{c}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className={`rounded-xl p-3 ${data.percent >= 75 ? "bg-green-50 border border-green-100" : data.percent >= 50 ? "bg-blue-50 border border-blue-100" : "bg-yellow-50 border border-yellow-100"}`}>
                        <p className="text-xs font-semibold mb-1 text-gray-700">
                          {data.percent >= 75 ? "✅ Ready to pursue certification" : data.percent >= 50 ? "🔵 Good starting point" : "⚠️ Significant gaps remain"}
                        </p>
                        <p className="text-xs text-gray-600">
                          {data.percent >= 75
                            ? `You already satisfy ${data.percent}% of ${fw} requirements through your ${assessment.framework_short_name} work. Consider starting a ${fw} assessment.`
                            : data.percent >= 50
                            ? `You're halfway there. ${gap} more controls need attention before pursuing ${fw} certification.`
                            : `${fw} requires significant additional work beyond ${assessment.framework_short_name}. Evaluate if business needs justify the investment.`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "upload" | "checklist" | "results" | "gapreport" | "crossfw";

export default function AssessmentDetailPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [gaps, setGaps] = useState<GapDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("upload");

  useEffect(() => {
    if (!assessmentId) return;
    complianceApi.getAssessment(assessmentId)
      .then((data) => {
        setAssessment(data);
        setGaps(data.gaps);
        if (data.control_assessments.length > 0) setActiveTab("results");
      })
      .finally(() => setLoading(false));
  }, [assessmentId]);

  function handleGapUpdated(gapId: string, status: "accepted" | "rejected") {
    setGaps((prev) =>
      prev.map((g) => g.id === gapId ? { ...g, recommendation_status: status } : g)
    );
  }

  async function rerunAnalysis() {
    if (!assessmentId) return;
    try {
      await complianceApi.analyzeAssessment(assessmentId);
      // Reload assessment to get updated cross_framework_summary + control assessments
      const updated = await complianceApi.getAssessment(assessmentId);
      setAssessment(updated);
      setGaps(updated.gaps);
    } catch (err) {
      alert(`Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="p-8 text-center text-gray-500">
        Assessment not found.{" "}
        <button onClick={() => navigate("/compliance")} className="text-blue-600 underline">Back</button>
      </div>
    );
  }

  const hasResults = assessment.control_assessments.length > 0;
  const gapCount = gaps.length;

  const tabs: { key: Tab; label: string; disabled?: boolean }[] = [
    { key: "upload",    label: "Upload & Analyze" },
    { key: "checklist", label: "Document Checklist" },
    { key: "results",   label: `Results${hasResults ? ` (${assessment.control_assessments.length})` : ""}`, disabled: !hasResults },
    { key: "gapreport", label: `Gap Report${gapCount > 0 ? ` (${gapCount})` : ""}`, disabled: gapCount === 0 },
    { key: "crossfw",   label: `Cross-Framework${Object.keys(assessment.cross_framework_summary).length > 0 ? ` (${Object.keys(assessment.cross_framework_summary).length})` : ""}` },
  ];

  return (
    <div className="p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/compliance")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to assessments
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{assessment.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className="font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs">
                {assessment.framework_short_name}
              </span>
              <span>{assessment.framework_name}</span>
              {assessment.uploaded_documents.length > 0 && (
                <span className="flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" />
                  {assessment.uploaded_documents.length} document{assessment.uploaded_documents.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {hasResults && (
              <button
                onClick={() => navigate(`/compliance/${assessmentId}/traceability`)}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors"
              >
                <GitBranch className="w-4 h-4" />
                Traceability Matrix
              </button>
            )}
            {assessment.compliance_score != null && (
              <div className="text-right">
                <p className={`text-3xl font-bold ${scoreColor(assessment.compliance_score)}`}>
                  {assessment.compliance_score}%
                </p>
                <p className="text-xs text-gray-400">compliance score</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => !tab.disabled && setActiveTab(tab.key)}
              disabled={tab.disabled}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : tab.disabled
                  ? "border-transparent text-gray-300 cursor-not-allowed"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "upload" && (
        <UploadTab
          assessment={assessment}
          onAnalyzed={(updated) => {
            setAssessment(updated);
            setGaps(updated.gaps);
            setActiveTab("results");
          }}
        />
      )}
      {activeTab === "checklist" && assessmentId && (
        <DocumentChecklistTab
          assessmentId={assessmentId}
          frameworkShortName={assessment.framework_short_name}
        />
      )}
      {activeTab === "results" && (
        <ResultsTab assessment={assessment} />
      )}
      {activeTab === "gapreport" && assessmentId && (
        <GapReportTab
          assessmentId={assessmentId}
          assessmentName={assessment?.name}
          frameworkName={assessment?.framework_name}
          frameworkShortName={assessment?.framework_short_name}
          gaps={gaps}
          onGapUpdated={handleGapUpdated}
        />
      )}
      {activeTab === "crossfw" && (
        <CrossFrameworkTab assessment={assessment} onRerunAnalysis={rerunAnalysis} />
      )}
    </div>
  );
}
