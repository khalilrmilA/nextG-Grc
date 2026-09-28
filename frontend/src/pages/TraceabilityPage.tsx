import { TranslatedText } from "@/components/common/AutoTranslatedBadge";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Loader2, CheckCircle, XCircle, AlertTriangle,
  MinusCircle, ChevronDown, ChevronUp, Download,
} from "lucide-react";
import { traceabilityApi, type TraceabilityMatrix, type TraceabilityRow } from "@/api/endpoints";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-700 bg-red-100",
  high:     "text-orange-700 bg-orange-100",
  medium:   "text-yellow-700 bg-yellow-100",
  low:      "text-gray-600 bg-gray-100",
};

const ACTION_STATUS_COLOR: Record<string, string> = {
  open:        "text-yellow-700 bg-yellow-50 border-yellow-200",
  in_progress: "text-blue-700 bg-blue-50 border-blue-200",
  completed:   "text-green-700 bg-green-50 border-green-200",
  cancelled:   "text-gray-400 bg-gray-50 border-gray-200",
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "text-red-700",
  high:     "text-orange-600",
  medium:   "text-yellow-600",
  low:      "text-gray-500",
};

function ControlStatusIcon({ status }: { readonly status: string }) {
  if (status === "implemented")           return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === "partially_implemented") return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
  if (status === "not_implemented")       return <XCircle className="w-4 h-4 text-red-500" />;
  return <MinusCircle className="w-4 h-4 text-gray-300" />;
}

// ─── Row component ─────────────────────────────────────────────────────────────

function MatrixRow({
  row,
  expanded,
  onToggle,
}: {
  readonly row: TraceabilityRow;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const { t } = useTranslation();
  const actionStatus = (st: string) => t(`traceability.action_status.${st}`, { defaultValue: st.replace("_", " ") });
  const hasGap = row.gap_id !== null;
  const hasActions = row.action_items.length > 0;

  return (
    <tbody>
      <tr
        className={`border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${hasGap ? "" : "opacity-60"}`}
        onClick={onToggle}
      >
        {/* Control */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <ControlStatusIcon status={row.control_status} />
            <div>
              <span className="text-xs font-mono text-gray-400 mr-1.5">{row.control_identifier}</span>
              <TranslatedText item={row} field="control_title" className="text-sm text-gray-800" />
              {row.control_category && (
                <span className="ml-2 text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{row.control_category}</span>
              )}
            </div>
          </div>
        </td>

        {/* Gap */}
        <td className="px-4 py-3">
          {hasGap ? (
            <div>
              <p className="text-xs text-gray-700 line-clamp-1">{row.gap_description}</p>
              <div className="flex items-center gap-2 mt-1">
                {row.gap_severity && (
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${SEVERITY_COLOR[row.gap_severity] ?? ""}`}>
                    {t(`compliance.severities.${row.gap_severity}`, { defaultValue: row.gap_severity })}
                  </span>
                )}
                {row.is_certification_blocker && (
                  <span className="text-xs">🔴 {t("compliance.blocker")}</span>
                )}
                {row.recommendation_status && (
                  <span className="text-xs text-gray-400 capitalize">{t(`compliance.rec_status.${row.recommendation_status}`, { defaultValue: row.recommendation_status })}</span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> {t("traceability.no_gap")}
            </span>
          )}
        </td>

        {/* Action Items */}
        <td className="px-4 py-3">
          {hasActions ? (
            <div className="flex flex-wrap gap-1">
              {row.action_items.slice(0, 2).map((ai) => (
                <span
                  key={ai.id}
                  className={`text-xs font-medium px-2 py-0.5 rounded-full border ${ACTION_STATUS_COLOR[ai.status] ?? ""}`}
                >
                  {actionStatus(ai.status)}
                </span>
              ))}
              {row.action_items.length > 2 && (
                <span className="text-xs text-gray-400">+{row.action_items.length - 2}</span>
              )}
            </div>
          ) : hasGap ? (
            <span className="text-xs text-yellow-600">{t("traceability.no_action_yet")}</span>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>

        {/* Expand toggle */}
        <td className="px-4 py-3 text-right">
          {(hasGap || hasActions) ? (
            expanded
              ? <ChevronUp className="w-4 h-4 text-gray-400 inline" />
              : <ChevronDown className="w-4 h-4 text-gray-400 inline" />
          ) : null}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (hasGap || hasActions) && (
        <tr className="bg-gray-50/60 border-b border-gray-100">
          <td colSpan={4} className="px-6 py-4">
            <div className="grid grid-cols-2 gap-6">
              {/* Gap detail */}
              {hasGap && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("traceability.gap_detail")}</p>
                  <p className="text-sm text-gray-700">{row.gap_description}</p>
                  {row.remediation_priority != null && (
                    <p className="text-xs text-gray-400 mt-1">
                      {t("traceability.priority_score")}: <strong>{row.remediation_priority}</strong>
                    </p>
                  )}
                  {row.ai_confidence != null && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t("compliance.ai_confidence")}: <strong>{Math.round(row.ai_confidence * 100)}%</strong>
                    </p>
                  )}
                </div>
              )}

              {/* Action items */}
              {hasActions && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {t("traceability.action_items")} ({row.action_items.length})
                  </p>
                  <div className="space-y-2">
                    {row.action_items.map((ai) => (
                      <div key={ai.id} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-gray-800">{ai.title}</p>
                          <span className={`text-xs font-semibold ${PRIORITY_COLOR[ai.priority] ?? "text-gray-500"}`}>
                            {t(`action_plan.priority_${ai.priority}`, { defaultValue: ai.priority })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${ACTION_STATUS_COLOR[ai.status] ?? ""}`}>
                            {actionStatus(ai.status)}
                          </span>
                          {ai.due_date && (
                            <span className="text-xs text-gray-400">{t("traceability.due", { date: ai.due_date })}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function TraceabilityPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [matrix, setMatrix] = useState<TraceabilityMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "gaps" | "actions" | "compliant" | "blockers">("all");

  useEffect(() => {
    if (!assessmentId) return;
    traceabilityApi.getMatrix(assessmentId)
      .then(setMatrix)
      .catch(() => setError(t("traceability.load_failed")))
      .finally(() => setLoading(false));
  }, [assessmentId]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !matrix) {
    return (
      <div className="p-8 text-center text-sm text-red-600">{error || t("common.no_data")}</div>
    );
  }

  const filtered = matrix.rows.filter((r) => {
    if (filter === "gaps")      return r.gap_id !== null;
    if (filter === "actions")   return r.action_items.length > 0;
    if (filter === "compliant") return r.control_status === "implemented";
    if (filter === "blockers")  return r.is_certification_blocker;
    return true;
  });

  const { summary } = matrix;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate(`/compliance/${assessmentId}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("compliance.back_to_assessment")}
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("compliance.traceability_matrix")}</h1>
            <p className="text-sm text-gray-500 mt-1">{matrix.assessment_name}</p>
          </div>
          <button className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors">
            <Download className="w-4 h-4" />
            {t("compliance.export_csv_btn")}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: t("compliance.controls"),     value: summary.total_controls, color: "text-gray-800"  },
          { label: t("compliance.filter_compliant"),    value: summary.compliant,      color: "text-green-600" },
          { label: t("traceability.partial"),      value: summary.partial,        color: "text-yellow-600"},
          { label: t("compliance.gaps"),         value: summary.gaps,           color: "text-red-600"   },
          { label: t("traceability.action_items"), value: summary.action_items_total, color: "text-blue-600" },
          { label: t("traceability.open_actions"), value: summary.action_items_open,  color: "text-orange-600"},
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: "all",      label: t("traceability.all_controls"),  count: matrix.rows.length },
          { key: "gaps",     label: t("traceability.with_gaps"),     count: matrix.rows.filter(r => r.gap_id).length },
          { key: "blockers", label: `🔴 ${t("compliance.blockers")}`,   count: matrix.rows.filter(r => r.is_certification_blocker).length },
          { key: "actions",  label: t("traceability.has_actions"),   count: matrix.rows.filter(r => r.action_items.length > 0).length },
          { key: "compliant",label: t("compliance.filter_compliant"),     count: matrix.rows.filter(r => r.control_status === "implemented").length },
        ] as const).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {label} <span className="opacity-70 ml-1">{count}</span>
          </button>
        ))}
      </div>

      {/* Matrix table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-2/5">{t("traceability.control")}</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-2/5">{t("traceability.gap")}</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-1/5">{t("traceability.action_items")}</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            {filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={4} className="py-12 text-center text-sm text-gray-400">
                    {t("traceability.no_rows")}
                  </td>
                </tr>
              </tbody>
            ) : (
              filtered.map((row) => {
                const key = row.gap_id ?? row.control_id;
                return (
                  <MatrixRow
                    key={key}
                    row={row}
                    expanded={expanded.has(key)}
                    onToggle={() => toggle(key)}
                  />
                );
              })
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
