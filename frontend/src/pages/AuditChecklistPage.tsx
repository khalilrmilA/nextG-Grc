import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Loader2, CheckCircle, XCircle, AlertTriangle,
  Eye, MinusCircle, ChevronDown, ChevronUp, Save, FileText,
} from "lucide-react";
import { auditorPortalApi, type AuditChecklistControl } from "@/api/endpoints";

const VERDICT_OPTIONS = [
  { value: "verified",    label: "Verified",    icon: CheckCircle,   color: "text-green-700 bg-green-50 border-green-200"   },
  { value: "finding",     label: "Finding",     icon: XCircle,       color: "text-red-700 bg-red-50 border-red-200"         },
  { value: "observation", label: "Observation", icon: AlertTriangle, color: "text-yellow-700 bg-yellow-50 border-yellow-200"},
  { value: "na",          label: "N/A",         icon: MinusCircle,   color: "text-gray-500 bg-gray-50 border-gray-200"      },
] as const;

type VerdictValue = typeof VERDICT_OPTIONS[number]["value"];

interface ControlRow extends AuditChecklistControl {
  localVerdict: VerdictValue | "";
  localNotes: string;
  saving: boolean;
  saved: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  implemented:           "text-green-600 bg-green-50",
  partially_implemented: "text-yellow-600 bg-yellow-50",
  not_implemented:       "text-red-600 bg-red-50",
  not_applicable:        "text-gray-400 bg-gray-50",
  not_started:           "text-gray-400 bg-gray-50",
};

function parseAuditorVerdict(notes: string | undefined): { verdict: VerdictValue | ""; text: string } {
  if (!notes) return { verdict: "", text: "" };
  const match = notes.match(/^\[AUDITOR:(\w+)\] ?(.*)/s);
  if (!match) return { verdict: "", text: notes };
  const v = match[1] as VerdictValue;
  return { verdict: VERDICT_OPTIONS.find((o) => o.value === v) ? v : "", text: match[2] ?? "" };
}

export default function AuditChecklistPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ControlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "pending" | "verified" | "finding">("all");

  useEffect(() => {
    if (!assessmentId) return;
    auditorPortalApi.getChecklist(assessmentId)
      .then((data) => {
        setRows(
          data.controls.map((c) => {
            const { verdict, text } = parseAuditorVerdict(c.auditor_notes);
            return { ...c, localVerdict: verdict, localNotes: text, saving: false, saved: false };
          })
        );
      })
      .catch(() => setError("Failed to load checklist. Check your assignment status."))
      .finally(() => setLoading(false));
  }, [assessmentId]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function setField(id: string, field: "localVerdict" | "localNotes", value: string) {
    setRows((prev) => prev.map((r) => r.control_assessment_id === id ? { ...r, [field]: value, saved: false } : r));
  }

  async function saveVerdict(row: ControlRow) {
    if (!row.localVerdict) return;
    setRows((prev) => prev.map((r) => r.control_assessment_id === row.control_assessment_id ? { ...r, saving: true } : r));
    try {
      await auditorPortalApi.recordVerdict(row.control_assessment_id, row.localVerdict, row.localNotes);
      setRows((prev) =>
        prev.map((r) => r.control_assessment_id === row.control_assessment_id ? { ...r, saving: false, saved: true } : r)
      );
    } catch {
      setRows((prev) => prev.map((r) => r.control_assessment_id === row.control_assessment_id ? { ...r, saving: false } : r));
    }
  }

  const filtered = rows.filter((r) => {
    if (filter === "pending")  return !r.localVerdict;
    if (filter === "verified") return r.localVerdict === "verified";
    if (filter === "finding")  return r.localVerdict === "finding" || r.localVerdict === "observation";
    return true;
  });

  const counts = {
    all:      rows.length,
    pending:  rows.filter((r) => !r.localVerdict).length,
    verified: rows.filter((r) => r.localVerdict === "verified").length,
    finding:  rows.filter((r) => r.localVerdict === "finding" || r.localVerdict === "observation").length,
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/auditor/portal")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to my assignments
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Audit Checklist</h1>
            <p className="text-sm text-gray-500 mt-1">Review and record your verdict for each control</p>
          </div>
          <button
            onClick={() => navigate(`/auditor/portal/${assessmentId}/report`)}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <FileText className="w-4 h-4" />
            Generate Report
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Progress summary */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span>{counts.verified} verified</span>
            <span>{counts.pending} pending</span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${counts.all > 0 ? Math.round((counts.verified / counts.all) * 100) : 0}%` }}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">
            {counts.all > 0 ? Math.round((counts.verified / counts.all) * 100) : 0}%
          </p>
          <p className="text-xs text-gray-400">complete</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "pending", "verified", "finding"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === f
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f === "finding" ? "Findings" : f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1.5 opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No controls in this category.</div>
        )}
        {filtered.map((row) => {
          const isExpanded = expanded.has(row.control_assessment_id);
          const statusCfg = STATUS_COLOR[row.status] ?? "text-gray-400 bg-gray-50";

          return (
            <div key={row.control_assessment_id} className="p-4">
              {/* Header row */}
              <button
                onClick={() => toggleExpand(row.control_assessment_id)}
                className="w-full flex items-start gap-3 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                      {row.control_identifier}
                    </span>
                    {row.control_category && (
                      <span className="text-xs text-gray-400">{row.control_category}</span>
                    )}
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${statusCfg}`}>
                      {row.status.replace(/_/g, " ")}
                    </span>
                    {row.localVerdict && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                        VERDICT_OPTIONS.find((o) => o.value === row.localVerdict)?.color ?? ""
                      }`}>
                        {VERDICT_OPTIONS.find((o) => o.value === row.localVerdict)?.label}
                      </span>
                    )}
                    {row.saved && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Saved
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-800">{row.control_title}</p>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                )}
              </button>

              {isExpanded && (
                <div className="mt-4 space-y-4 pl-4 border-l-2 border-gray-100">
                  {/* Control description */}
                  {row.control_description && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                      <p className="text-xs text-gray-600">{row.control_description}</p>
                    </div>
                  )}

                  {/* Company evidence / AI assessment */}
                  {(row.implementation_notes || row.company_notes) && (
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <Eye className="w-3 h-3" /> Company Evidence
                      </p>
                      {row.implementation_notes && (
                        <p className="text-xs text-blue-800">{row.implementation_notes}</p>
                      )}
                      {row.company_notes && (
                        <p className="text-xs text-blue-700 mt-1 opacity-80">{row.company_notes}</p>
                      )}
                    </div>
                  )}

                  {/* Auditor verdict */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your Verdict</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {VERDICT_OPTIONS.map(({ value, label, icon: Icon, color }) => (
                        <button
                          key={value}
                          onClick={() => setField(row.control_assessment_id, "localVerdict", value)}
                          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                            row.localVerdict === value
                              ? color + " shadow-sm scale-105"
                              : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={row.localNotes}
                      onChange={(e) => setField(row.control_assessment_id, "localNotes", e.target.value)}
                      rows={2}
                      placeholder="Auditor notes, evidence reviewed, findings detail…"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />

                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => saveVerdict(row)}
                        disabled={!row.localVerdict || row.saving}
                        className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
                      >
                        {row.saving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        {row.saving ? "Saving…" : "Save Verdict"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
