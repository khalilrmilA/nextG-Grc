import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Upload, FileText, Play, Loader2,
  CheckCircle, XCircle, AlertTriangle, MinusCircle,
  ChevronDown, ChevronUp, Sparkles, Globe, GitBranch,
  Download, Table2,
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
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, { status: string; by: string; at: string }[]>>({});
  const [saving, setSaving] = useState<string | null>(null);

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

function CrossFrameworkTab({ assessment }: { readonly assessment: AssessmentDetail }) {
  const summary = assessment.cross_framework_summary;
  const entries = Object.entries(summary).sort((a, b) => b[1].percent - a[1].percent);

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
        No cross-framework mappings found. Run analysis first, or this framework may not have cross-walk data.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Based on your compliance against <strong>{assessment.framework_short_name}</strong>, here is the estimated coverage in other frameworks.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {entries.map(([fw, data]) => (
          <div key={fw} className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">{fw}</h3>
              <span className={`text-sm font-bold ${scoreColor(data.percent)}`}>{data.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
              <div
                className={`h-full rounded-full ${data.percent >= 80 ? "bg-green-500" : data.percent >= 60 ? "bg-yellow-400" : "bg-red-400"}`}
                style={{ width: `${data.percent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">{data.covered} of {data.total_mapped} mapped controls covered</p>
            {data.controls.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {data.controls.slice(0, 8).map((c, i) => (
                  <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-mono">{c}</span>
                ))}
                {data.controls.length > 8 && (
                  <span className="text-xs text-gray-400">+{data.controls.length - 8} more</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
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
    { key: "crossfw",   label: `Cross-Framework${Object.keys(assessment.cross_framework_summary).length > 0 ? ` (${Object.keys(assessment.cross_framework_summary).length})` : ""}`, disabled: !hasResults },
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
        <CrossFrameworkTab assessment={assessment} />
      )}
    </div>
  );
}
