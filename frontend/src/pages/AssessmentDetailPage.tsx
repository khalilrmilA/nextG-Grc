import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Upload, FileText, Play, Loader2,
  CheckCircle, XCircle, AlertTriangle, MinusCircle,
  ChevronDown, ChevronUp, Sparkles, Globe, GitBranch,
  Download, Table2, Eye, EyeOff, Trash2, ExternalLink,
  Link2, CheckSquare,
} from "lucide-react";
import { complianceApi, type EvidenceItem } from "@/api/endpoints";
import type { AssessmentDetail, GapDetail, ControlAssessmentDetail, LinkedChecklistDocument } from "@/types";
import PolicyGeneratorModal from "@/components/features/compliance/PolicyGeneratorModal";
import DocumentChecklistTab from "@/components/features/compliance/DocumentChecklistTab";
import GapReportTab from "@/components/features/compliance/GapReportTab";
import DocumentViewerModal, { type ViewableDoc } from "@/components/features/compliance/DocumentViewerModal";
import ShareLinkModal from "@/components/features/compliance/ShareLinkModal";
import { exportComplianceCSV, exportComplianceReport, exportDdA } from "@/utils/exportUtils";

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
  const { t } = useTranslation();
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.not_started;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      <cfg.icon className="w-3 h-3" />
      {t(`compliance.status_options.${status}`, { defaultValue: cfg.label })}
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
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [docs, setDocs] = useState(assessment.uploaded_documents);
  const [analyzeResult, setAnalyzeResult] = useState<null | { compliance_score: number }>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    for (const file of Array.from(files)) {
      try {
        const doc = await complianceApi.uploadDocument(assessment.id, file);
        setDocs((prev) => [...prev, doc]);
      } catch {
        setError(`Failed to upload ${file.name}. Only PDF, DOCX, XLSX, XLS, TXT are supported (max 10MB).`);
      }
    }
    setUploading(false);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setError("");
    try {
      await complianceApi.analyzeAssessment(assessment.id);
      // Poll every 4 seconds until the background job finishes
      pollRef.current = setInterval(async () => {
        try {
          const s = await complianceApi.getAnalyzeStatus(assessment.id);
          if (s.status === "completed") {
            stopPolling();
            setAnalyzing(false);
            setAnalyzeResult({ compliance_score: s.compliance_score ?? 0 });
            const updated = await complianceApi.getResults(assessment.id);
            onAnalyzed(updated);
          } else if (s.status === "failed") {
            stopPolling();
            setAnalyzing(false);
            setError(s.error ?? "Analysis failed. Make sure Ollama is running and the model is available.");
          }
        } catch {
          // transient poll error — keep trying
        }
      }, 4000);
    } catch {
      setAnalyzing(false);
      setError("Could not start analysis. Make sure documents are uploaded.");
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
          accept=".pdf,.docx,.xlsx,.xls,.txt"
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
          {uploading ? t("compliance.uploading") : t("compliance.drop_files")}
        </p>
        <p className="text-xs text-gray-400 mt-1">{t("compliance.file_types_hint")}</p>
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
          {t("compliance.analysis_complete_score", { score: analyzeResult.compliance_score })}
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
              {t("compliance.analyzing_controls", { framework: assessment.framework_short_name })}
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {t("compliance.run_ai_analysis")}
            </>
          )}
        </button>
      </div>

      {analyzing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          {t("compliance.ai_analyzing_notice")}
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
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "implemented" | "partial" | "gap">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [policyGap, setPolicyGap] = useState<GapDetail | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, { status: string; by: string; at: string }[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [savedJustifications, setSavedJustifications] = useState<Record<string, boolean>>({});
  const [uploadingEvidence, setUploadingEvidence] = useState<string | null>(null);
  const [evidenceMap, setEvidenceMap] = useState<Record<string, EvidenceItem[]>>({});
  const [deletingEvidence, setDeletingEvidence] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<ViewableDoc | null>(null);
  const [shareModalCa, setShareModalCa] = useState<ControlAssessmentDetail | null>(null);
  const [evidenceSharedToast, setEvidenceSharedToast] = useState<{ fileName: string; count: number } | null>(null);
  const justificationTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

  async function handleJustificationChange(caId: string, text: string) {
    setJustifications((prev) => ({ ...prev, [caId]: text }));
    setSavedJustifications((prev) => ({ ...prev, [caId]: false }));

    // Debounce auto-save
    if (justificationTimeouts.current[caId]) {
      clearTimeout(justificationTimeouts.current[caId]);
    }
    justificationTimeouts.current[caId] = setTimeout(async () => {
      try {
        await complianceApi.updateControlAssessment(caId, { notes: text });
        setSavedJustifications((prev) => ({ ...prev, [caId]: true }));
        setTimeout(() => setSavedJustifications((prev) => ({ ...prev, [caId]: false })), 2000);
      } catch {/* silent */}
    }, 800);
  }

  async function handleEvidenceUpload(caId: string, file: File) {
    if (!file) return;
    setUploadingEvidence(caId);
    try {
      const result = await complianceApi.uploadControlEvidence(caId, file);
      setEvidenceMap(prev => ({
        ...prev,
        [caId]: [...(prev[caId] ?? []), result],
      }));
      if ((result.shared_count ?? 0) > 0) {
        setEvidenceSharedToast({ fileName: file.name, count: result.shared_count! });
        setTimeout(() => setEvidenceSharedToast(null), 5000);
      }
    } catch {/* silent */} finally {
      setUploadingEvidence(null);
    }
  }

  async function handleDeleteEvidence(caId: string, evidenceId: string) {
    setDeletingEvidence(evidenceId);
    try {
      await complianceApi.deleteEvidence(evidenceId);
      setEvidenceMap(prev => ({
        ...prev,
        [caId]: (prev[caId] ?? []).filter(e => e.id !== evidenceId),
      }));
    } catch {/* silent */} finally {
      setDeletingEvidence(null);
    }
  }

  async function handleToggleVisibility(caId: string, evidenceId: string) {
    setTogglingVisibility(evidenceId);
    try {
      const updated = await complianceApi.toggleEvidenceVisibility(evidenceId);
      setEvidenceMap(prev => ({
        ...prev,
        [caId]: (prev[caId] ?? []).map(e => e.id === evidenceId ? updated : e),
      }));
    } catch {/* silent */} finally {
      setTogglingVisibility(null);
    }
  }

  function openEvidence(ev: EvidenceItem) {
    setViewingDoc({
      id: ev.id,
      fileName: ev.file_name ?? "evidence",
      contentType: ev.content_type,
      fileSizeBytes: ev.file_size_bytes,
      fetchUrl: complianceApi.downloadEvidenceUrl(ev.id),
    });
  }

  function openChecklistDoc(doc: LinkedChecklistDocument) {
    setViewingDoc({
      id: doc.id,
      fileName: doc.file_name,
      contentType: doc.content_type,
      fileSizeBytes: doc.file_size_bytes,
      subtitle: doc.clause_ref ? `Clause ${doc.clause_ref}` : undefined,
      fetchUrl: complianceApi.downloadDocumentUrl(doc.id),
    });
  }

  function handleEvidenceDrop(caId: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => handleEvidenceUpload(caId, f));
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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Load evidence if not already loaded
        if (!evidenceMap[id]) {
          complianceApi.listControlEvidence(id).then(items => {
            setEvidenceMap(prev => ({ ...prev, [id]: items }));
          }).catch(() => {});
        }
      }
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {viewingDoc && <DocumentViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />}
      {shareModalCa && (
        <ShareLinkModal
          caId={shareModalCa.id}
          controlTitle={shareModalCa.control_title}
          controlId={shareModalCa.control_identifier}
          onClose={() => setShareModalCa(null)}
        />
      )}

      {/* Cross-framework evidence sharing toast */}
      {evidenceSharedToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-indigo-600 text-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-3 max-w-sm animate-in slide-in-from-bottom-4">
          <Globe className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">{t("compliance.evidence_shared_title")}</p>
            <p className="text-xs text-indigo-200 mt-0.5">
              {t("compliance.evidence_shared_desc", { file: evidenceSharedToast.fileName, count: evidenceSharedToast.count })}
            </p>
          </div>
          <button onClick={() => setEvidenceSharedToast(null)} className="text-indigo-300 hover:text-white ml-1 flex-shrink-0">✕</button>
        </div>
      )}

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
          <p className="text-sm text-gray-500 mt-1">{t("compliance.compliance_score_label")}</p>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-4">
          {[
            { label: t("compliance.filter_compliant"), count: counts.implemented, color: "text-green-600" },
            { label: t("compliance.filter_partial"),   count: counts.partial,     color: "text-yellow-600" },
            { label: t("compliance.filter_gaps"),      count: counts.gap,         color: "text-red-600"   },
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
            {t("compliance.export_csv_btn")}
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
            {t("compliance.full_report_btn")}
          </button>
          <button
            onClick={() => exportDdA({
              assessmentName: assessment.name,
              frameworkName: assessment.framework_name ?? "",
              frameworkShortName: assessment.framework_short_name ?? "",
              complianceScore: assessment.compliance_score ?? null,
              generatedAt: new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }),
              org: "",
              controls: cas.map((c) => ({
                control_identifier: c.control_identifier,
                control_title: c.control_title,
                control_category: c.control_category,
                control_description: c.control_description,
                status: c.status,
                notes: c.notes,
                implementation_notes: c.implementation_notes,
                not_applicable_justification: c.not_applicable_justification,
                is_mandatory: c.is_mandatory,
              })),
            })}
            className="flex items-center gap-1.5 text-xs font-medium border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg transition-colors font-semibold"
          >
            <FileText className="w-3.5 h-3.5" />
            {t("compliance.dda_btn", "DdA / SoA")}
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
            {f === "all" ? t("compliance.filter_all") : f === "implemented" ? t("compliance.filter_compliant") : f === "partial" ? t("compliance.filter_partial") : t("compliance.filter_gaps")}
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
                      {ca.is_mandatory && (
                        <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                          {t("compliance.mandatory_badge")}
                        </span>
                      )}
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
                      {t("compliance.generate_policy_btn")}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShareModalCa(ca); }}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                    title="Share upload link with stakeholder"
                  >
                    <Link2 className="w-3 h-3" />
                    {t("compliance.share_btn")}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 ml-0 pl-4 border-l-2 border-gray-100 space-y-2">
                  {ca.control_description && (
                    <p className="text-xs text-gray-600">{ca.control_description}</p>
                  )}
                  {ca.implementation_notes && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">{t("compliance.ai_assessment_label")}</p>
                      <p className="text-xs text-gray-700">{ca.implementation_notes}</p>
                    </div>
                  )}
                  {gap && (
                    <div className="bg-red-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-semibold text-red-700">{t("compliance.gap_identified_label")}</p>
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
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("compliance.maps_to_label")}</p>
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
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">{t("compliance.override_status_label")}:</p>
                    <select
                      value={effectiveStatus(ca)}
                      onChange={(e) => handleStatusOverride(ca.id, effectiveStatus(ca), e.target.value)}
                      disabled={saving === ca.id}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="implemented">{t("compliance.status_options.implemented")}</option>
                      <option value="partially_implemented">{t("compliance.status_options.partially_implemented")}</option>
                      <option value="not_implemented">{t("compliance.status_options.not_implemented")}</option>
                      {!ca.is_mandatory && <option value="not_applicable">{t("compliance.status_options.not_applicable")}</option>}
                    </select>
                    {ca.is_mandatory && (
                      <span className="text-xs text-red-600">{t("compliance.mandatory_no_na")}</span>
                    )}
                    {saving === ca.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                    {overrides[ca.id] && (
                      <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{t("compliance.manually_overridden")}</span>
                    )}
                  </div>

                  {/* Status change history */}
                  {history[ca.id] && history[ca.id].length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t("compliance.status_history_label")}</p>
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

                  {/* Justification & Evidence - Themed Inline */}
                  <div className="pt-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2 items-start">
                      {/* Notes Textarea - Blue Theme */}
                      <div className="col-span-2">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <label className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{t("compliance.justification_label")}</label>
                        </div>
                        <textarea
                          value={justifications[ca.id] ?? ca.notes ?? ""}
                          onChange={(e) => handleJustificationChange(ca.id, e.target.value)}
                          placeholder={t("compliance.justification_placeholder")}
                          className="w-full px-3 py-2 text-xs border-2 border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none bg-blue-50 hover:bg-blue-50 transition-all placeholder-blue-400"
                          rows={1}
                        />
                        {savedJustifications[ca.id] && (
                          <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1 font-medium">
                            <CheckCircle className="w-3 h-3" /> {t("compliance.saved_label")}
                          </p>
                        )}
                      </div>

                      {/* Evidence Upload - Purple Theme */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div className="w-2 h-2 rounded-full bg-purple-500" />
                          <label className="text-xs font-semibold text-purple-700 uppercase tracking-wide">{t("compliance.files_label")}</label>
                        </div>
                        <div
                          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-purple-50", "border-purple-400", "shadow-md"); }}
                          onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove("bg-purple-50", "border-purple-400", "shadow-md"); }}
                          onDrop={(e) => {
                            handleEvidenceDrop(ca.id, e);
                            e.currentTarget.classList.remove("bg-purple-50", "border-purple-400", "shadow-md");
                          }}
                          className="border-2 border-dashed border-purple-300 rounded-lg p-2.5 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 hover:shadow-md transition-all bg-purple-50/40"
                        >
                          <input
                            type="file"
                            id={`evidence-input-${ca.id}`}
                            accept=".pdf,.docx,.xlsx,.xls,.txt"
                            multiple
                            onChange={(e) => {
                              if (e.target.files) {
                                Array.from(e.target.files).forEach(f => handleEvidenceUpload(ca.id, f));
                              }
                              e.target.value = "";
                            }}
                            className="hidden"
                          />
                          <label htmlFor={`evidence-input-${ca.id}`} className="cursor-pointer block">
                            {uploadingEvidence === ca.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-purple-600 mx-auto" />
                            ) : (
                              <Upload className="w-4 h-4 text-purple-600 mx-auto hover:text-purple-700 transition-colors" />
                            )}
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Linked Document Checklist files - Teal Theme */}
                    {(ca.linked_checklist_documents?.length ?? 0) > 0 && (
                      <div className="bg-gradient-to-r from-teal-50 to-cyan-50 border-2 border-teal-200 rounded-lg p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-teal-600" />
                          <span className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Document Checklist</span>
                          <span className="text-xs text-teal-500 font-normal ml-0.5">— auto-linked</span>
                          <span className="ml-auto text-xs font-bold text-teal-600 bg-white px-1.5 py-0.5 rounded-full">{ca.linked_checklist_documents!.length}</span>
                        </div>
                        <div className="space-y-1">
                          {ca.linked_checklist_documents!.map((doc: LinkedChecklistDocument) => (
                            <div key={doc.id} className="flex items-center gap-1.5 text-xs bg-white/60 px-2 py-1 rounded">
                              <FileText className="w-3.5 h-3.5 flex-shrink-0 text-teal-600" />
                              <div className="flex-1 min-w-0">
                                <span className="truncate font-medium text-teal-700 block">{doc.document_name ?? doc.file_name}</span>
                                {doc.clause_ref && <span className="text-teal-400 text-xs">Clause {doc.clause_ref}</span>}
                              </div>
                              <button
                                onClick={() => openChecklistDoc(doc)}
                                className="text-blue-600 hover:text-blue-800 flex-shrink-0"
                                title="View document"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Evidence Files - Green Theme */}
                    {(evidenceMap[ca.id]?.length > 0) && (
                      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-lg p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-green-600" />
                          <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">{t("compliance.evidence_files_label")}</span>
                          <span className="ml-auto text-xs font-bold text-green-600 bg-white px-1.5 py-0.5 rounded-full">{evidenceMap[ca.id].length}</span>
                        </div>
                        <div className="space-y-1">
                          {evidenceMap[ca.id].map((ev) => (
                            <div key={ev.id} className="flex items-center gap-1.5 text-xs bg-white/60 px-2 py-1 rounded">
                              <FileText className="w-3.5 h-3.5 flex-shrink-0 text-green-600" />
                              <span className="truncate font-medium text-green-700 flex-1">{ev.file_name}</span>
                              {ev.is_shared && (
                                <span title={t("compliance.evidence_auto_shared_title")} className="flex items-center gap-0.5 text-indigo-600 bg-indigo-50 rounded px-1 py-0.5 flex-shrink-0">
                                  <Globe className="w-2.5 h-2.5" />
                                  <span className="text-[10px] font-medium">{t("compliance.evidence_shared_badge")}</span>
                                </span>
                              )}
                              {/* Download/view button */}
                              <button
                                onClick={() => openEvidence(ev)}
                                className="text-blue-600 hover:text-blue-800 flex-shrink-0"
                                title={t("compliance.evidence_view_download")}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              {/* Auditor visibility toggle */}
                              <button
                                onClick={() => handleToggleVisibility(ca.id, ev.id)}
                                disabled={togglingVisibility === ev.id}
                                title={ev.is_visible_to_auditor ? "Visible to auditor — click to hide" : "Hidden from auditor — click to show"}
                                className={`flex-shrink-0 ${ev.is_visible_to_auditor ? "text-green-600" : "text-gray-400"}`}
                              >
                                {togglingVisibility === ev.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : ev.is_visible_to_auditor
                                    ? <Eye className="w-3 h-3" />
                                    : <EyeOff className="w-3 h-3" />}
                              </button>
                              {/* Delete */}
                              <button
                                onClick={() => handleDeleteEvidence(ca.id, ev.id)}
                                disabled={deletingEvidence === ev.id}
                                title="Delete evidence"
                                className="flex-shrink-0 text-red-400 hover:text-red-600"
                              >
                                {deletingEvidence === ev.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <Trash2 className="w-3 h-3" />}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const summary = assessment.cross_framework_summary;
  const entries = Object.entries(summary).sort((a, b) => b[1].percent - a[1].percent);

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium text-gray-500 mb-1">{t("compliance.no_other_frameworks")}</p>
        <p className="text-xs">{t("compliance.no_other_frameworks_desc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Evidence sharing explanation */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex gap-3">
        <Globe className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-indigo-800">{t("compliance.auto_evidence_title")}</p>
          <p className="text-xs text-indigo-600 mt-0.5">{t("compliance.auto_evidence_desc")}</p>
        </div>
      </div>
      <p className="text-sm text-gray-500">{t("compliance.cross_fw_subtitle")}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {entries.map(([fw, data]) => {
          const scoreClr = data.percent >= 75 ? "text-green-600" : data.percent >= 50 ? "text-yellow-600" : "text-red-600";
          const barClr = data.percent >= 75 ? "bg-green-500" : data.percent >= 50 ? "bg-yellow-400" : "bg-red-400";
          return (
            <div
              key={fw}
              onClick={() => data.assessment_id && navigate(`/compliance/${data.assessment_id}`)}
              className="bg-white rounded-2xl border border-gray-100 p-5 hover:border-blue-200 hover:shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded mb-1 inline-block">{fw}</span>
                  <p className="text-sm font-semibold text-gray-800 leading-tight mt-1 line-clamp-1">
                    {data.framework_name || fw}
                  </p>
                </div>
                <span className={`text-xl font-bold ${scoreClr} flex-shrink-0 ml-3`}>{data.percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-3">
                <div className={`h-full rounded-full transition-all ${barClr}`} style={{ width: `${data.percent}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-50 rounded-lg py-1.5">
                  <p className="text-sm font-bold text-gray-800">{data.total}</p>
                  <p className="text-xs text-gray-400">{t("compliance.controls_count_label")}</p>
                </div>
                <div className="bg-green-50 rounded-lg py-1.5">
                  <p className="text-sm font-bold text-green-700">{data.covered}</p>
                  <p className="text-xs text-green-500">{t("compliance.filter_compliant")}</p>
                </div>
                <div className="bg-red-50 rounded-lg py-1.5">
                  <p className="text-sm font-bold text-red-600">{data.gaps}</p>
                  <p className="text-xs text-red-400">{t("compliance.filter_gaps")}</p>
                </div>
              </div>
              <p className="text-xs text-blue-500 mt-3 group-hover:text-blue-700 text-right">
                {t("compliance.open_assessment")}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Per-Assessment Action Plan ────────────────────────────────────────────────

const PRIORITY_STYLE: Record<string, { color: string; bg: string; dot: string }> = {
  critical: { color: "text-red-700",    bg: "bg-red-100",    dot: "bg-red-500"    },
  high:     { color: "text-orange-700", bg: "bg-orange-100", dot: "bg-orange-500" },
  medium:   { color: "text-yellow-700", bg: "bg-yellow-100", dot: "bg-yellow-500" },
  low:      { color: "text-green-700",  bg: "bg-green-100",  dot: "bg-green-500"  },
};
const STATUS_STYLE_AP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  open:        { label: "To Do",       color: "text-gray-500",  bg: "bg-gray-100",  border: "border-gray-200"  },
  in_progress: { label: "In Progress", color: "text-blue-600",  bg: "bg-blue-50",   border: "border-blue-200"  },
  completed:   { label: "Done",        color: "text-green-600", bg: "bg-green-50",  border: "border-green-200" },
  cancelled:   { label: "Cancelled",   color: "text-gray-400",  bg: "bg-gray-50",   border: "border-gray-200"  },
};
const AP_COLS = ["open", "in_progress", "completed", "cancelled"] as const;

function AssessmentActionPlan({ assessmentId, assessmentName }: { assessmentId: string; assessmentName: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<import("@/api/endpoints").ActionPlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    complianceApi.listActionPlan(assessmentId)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [assessmentId]);

  async function changeStatus(id: string, newStatus: string) {
    const prev = items.find(i => i.id === id);
    if (!prev) return;
    setItems(all => all.map(i => i.id === id
      ? { ...i, status: newStatus as import("@/api/endpoints").ActionPlanItem["status"] }
      : i));
    try {
      await complianceApi.updateActionPlanItem(id, { status: newStatus });
    } catch {
      setItems(all => all.map(i => i.id === id ? { ...i, status: prev.status } : i));
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /></div>;

  const total    = items.length;
  const done     = items.filter(i => i.status === "completed").length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-indigo-600" />
            {t("action_plan.page_title", "Action Plan")} — {assessmentName}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{t("action_plan.page_subtitle", "Gaps converted to trackable tasks")}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/action-plan")}
          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {t("action_plan.view_global", "View global plan")}
        </button>
      </div>

      {/* Progress */}
      {total > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-4 shadow-sm">
          <div className="flex-1">
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-green-400 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <span className="text-sm font-bold text-indigo-600 flex-shrink-0">{progress}%</span>
          <span className="text-xs text-gray-400">{done}/{total} {t("action_plan.done_label", "done")}</span>
        </div>
      )}

      {total === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CheckCircle className="w-10 h-10 text-green-300" />
          <p className="text-sm text-gray-500">{t("action_plan.empty_title", "No action items yet")}</p>
          <p className="text-xs text-gray-400">{t("action_plan.empty_hint", "Run AI analysis first to generate gaps and action items.")}</p>
        </div>
      ) : (
        /* Compact Kanban */
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {AP_COLS.map(colKey => {
            const colItems = items.filter(i => i.status === colKey);
            const cfg = STATUS_STYLE_AP[colKey];
            return (
              <div key={colKey} className="flex flex-col gap-2">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${cfg.bg} border ${cfg.border}`}>
                  <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                  <span className="ml-auto text-xs font-semibold text-gray-500 bg-white/70 px-1.5 py-0.5 rounded-full">{colItems.length}</span>
                </div>
                <div className="flex flex-col gap-1.5 min-h-[60px]">
                  {colItems.length === 0 ? (
                    <div className="text-xs text-gray-300 text-center py-4 border-2 border-dashed border-gray-100 rounded-xl">—</div>
                  ) : colItems.map(item => {
                    const pStyle = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.medium;
                    return (
                      <div key={item.id} className={`bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col gap-2 ${item.status === "completed" ? "opacity-60" : ""}`}>
                        {/* Priority + blocker */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${pStyle.bg} ${pStyle.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${pStyle.dot}`} />
                            {item.priority}
                          </span>
                          {item.is_certification_blocker && (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-700">BLOCKER</span>
                          )}
                          {item.control_identifier && (
                            <span className="text-[9px] font-mono font-semibold px-1 py-0.5 bg-gray-100 text-gray-600 rounded">{item.control_identifier}</span>
                          )}
                        </div>
                        {/* Title */}
                        <p className={`text-xs font-semibold text-gray-800 leading-snug line-clamp-2 ${item.status === "completed" ? "line-through text-gray-400" : ""}`}>
                          {item.title}
                        </p>
                        {/* Action buttons */}
                        <div className="flex gap-1 flex-wrap">
                          {item.status !== "completed" && item.status !== "cancelled" && (
                            <button type="button" onClick={() => changeStatus(item.id, "completed")}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 transition-colors">
                              ✓ Done
                            </button>
                          )}
                          {item.status === "open" && (
                            <button type="button" onClick={() => changeStatus(item.id, "in_progress")}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors">
                              ▶ Start
                            </button>
                          )}
                          {item.status === "completed" && (
                            <button type="button" onClick={() => changeStatus(item.id, "open")}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors">
                              ↩ Reopen
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "upload" | "checklist" | "results" | "gapreport" | "crossfw" | "actionplan";

export default function AssessmentDetailPage() {
  const { t } = useTranslation();
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
        // Debug: log first control to see what fields we're getting
        if (data.control_assessments.length > 0) {
          console.log("First control received:", JSON.stringify(data.control_assessments[0], null, 2));
        }
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
        {t("compliance.not_found")}{" "}
        <button onClick={() => navigate("/compliance")} className="text-blue-600 underline">{t("compliance.back_btn")}</button>
      </div>
    );
  }

  const hasResults = assessment.control_assessments.length > 0;
  const gapCount = gaps.length;

  const tabs: { key: Tab; label: string; disabled?: boolean; icon?: React.ReactNode }[] = [
    { key: "upload",     label: t("compliance.upload_analyze") },
    { key: "checklist",  label: t("compliance.document_checklist") },
    { key: "results",    label: `${t("compliance.results")}${hasResults ? ` (${assessment.control_assessments.length})` : ""}`, disabled: !hasResults },
    { key: "gapreport",  label: `${t("compliance.gap_report")}${gapCount > 0 ? ` (${gapCount})` : ""}`, disabled: gapCount === 0 },
    { key: "crossfw",    label: `${t("compliance.cross_framework")}${Object.keys(assessment.cross_framework_summary).length > 0 ? ` (${Object.keys(assessment.cross_framework_summary).length})` : ""}` },
    { key: "actionplan", label: t("action_plan.page_title", "Action Plan"), icon: <CheckSquare className="w-3.5 h-3.5" /> },
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
          {t("compliance.back_to_assessments")}
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
                  {t(assessment.uploaded_documents.length === 1 ? "compliance.documents_label_one" : "compliance.documents_label_other", { count: assessment.uploaded_documents.length })}
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
                {t("compliance.traceability_matrix")}
              </button>
            )}
            {assessment.compliance_score != null && (
              <div className="text-right">
                <p className={`text-3xl font-bold ${scoreColor(assessment.compliance_score)}`}>
                  {assessment.compliance_score}%
                </p>
                <p className="text-xs text-gray-400">{t("compliance.compliance_score_label")}</p>
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
              <span className="flex items-center gap-1.5">
                {tab.icon}{tab.label}
              </span>
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
      {activeTab === "actionplan" && assessmentId && (
        <AssessmentActionPlan assessmentId={assessmentId} assessmentName={assessment.name} />
      )}
    </div>
  );
}
