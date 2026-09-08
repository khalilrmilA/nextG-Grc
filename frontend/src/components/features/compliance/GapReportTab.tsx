import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle, XCircle, AlertTriangle, Download,
  Sparkles, Loader2, Filter, FileText, Table2, ChevronDown, X,
} from "lucide-react";
import { complianceApi } from "@/api/endpoints";
import type { GapDetail } from "@/types";
import GapConfirmModal from "./GapConfirmModal";
import { exportGapsCSV, exportComplianceReport } from "@/utils/exportUtils";

interface Props {
  readonly assessmentId: string;
  readonly assessmentName?: string;
  readonly frameworkName?: string;
  readonly frameworkShortName?: string;
  readonly gaps: GapDetail[];
  readonly onGapUpdated: (gapId: string, status: "accepted" | "rejected") => void;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-700 bg-red-100",
  high:     "text-orange-700 bg-orange-100",
  medium:   "text-yellow-700 bg-yellow-100",
  low:      "text-gray-600 bg-gray-100",
};
const REC_COLOR: Record<string, string> = {
  accepted: "text-green-700 bg-green-50 border border-green-200",
  rejected: "text-gray-400 bg-gray-50 border border-gray-200",
  pending:  "text-yellow-700 bg-yellow-50 border border-yellow-200",
};

/** What POST /gaps/bulk-action answers with. */
interface BulkActionResult {
  processed?: number;
  action?: string;
}

export default function GapReportTab({ assessmentId, assessmentName = "Assessment", frameworkName = "", frameworkShortName = "", gaps, onGapUpdated }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirmGap, setConfirmGap] = useState<GapDetail | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [bulkAccepting, setBulkAccepting] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "rejected" | "blockers">("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const sorted = [...gaps].sort((a, b) => {
    const sOrd = (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    if (sOrd !== 0) return sOrd;
    return (b.remediation_priority ?? 50) - (a.remediation_priority ?? 50);
  });

  const filtered = sorted.filter((g) => {
    if (filter === "pending")   return (g.recommendation_status ?? "pending") === "pending";
    if (filter === "accepted")  return g.recommendation_status === "accepted";
    if (filter === "rejected")  return g.recommendation_status === "rejected";
    if (filter === "blockers")  return g.is_certification_blocker;
    return true;
  });

  const counts = {
    all:      gaps.length,
    pending:  gaps.filter((g) => (g.recommendation_status ?? "pending") === "pending").length,
    accepted: gaps.filter((g) => g.recommendation_status === "accepted").length,
    rejected: gaps.filter((g) => g.recommendation_status === "rejected").length,
    blockers: gaps.filter((g) => g.is_certification_blocker).length,
  };

  const pendingCritical = gaps.filter(
    (g) => g.severity === "critical" && (g.recommendation_status ?? "pending") === "pending",
  );

  const FILTER_LABEL: Record<typeof filter, string> = {
    all:      t("compliance.filter_all"),
    blockers: t("compliance.blockers", "Blockers"),
    pending:  t("compliance.rec_status.pending", "Pending"),
    accepted: t("compliance.rec_status.accepted", "Accepted"),
    rejected: t("compliance.rec_status.rejected", "Rejected"),
  };

  function recStatusLabel(status: string) {
    return t(`compliance.rec_status.${status}`, {
      defaultValue: status.charAt(0).toUpperCase() + status.slice(1),
    });
  }

  async function handleReject(gapId: string) {
    setRejectingId(gapId);
    setError("");
    try {
      await complianceApi.actOnRecommendation(assessmentId, gapId, { action: "reject" });
      onGapUpdated(gapId, "rejected");
    } catch {
      // Previously swallowed: the row looked untouched and the user never knew
      // the rejection had not been recorded.
      setError(t("compliance.reject_failed", "The rejection could not be recorded. Nothing was changed."));
    } finally {
      setRejectingId(null);
    }
  }

  function handleExportCSV() {
    exportGapsCSV(gaps, assessmentName);
    setExportOpen(false);
  }

  function handleExportReport() {
    const statusCounts = {
      implemented: 0,
      partially_implemented: 0,
      not_implemented: gaps.length,
      not_applicable: 0,
      total: gaps.length,
    };
    exportComplianceReport({
      assessmentName,
      frameworkName,
      frameworkShortName,
      complianceScore: null,
      generatedAt: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      org: "",
      statusCounts,
      gaps: gaps.map((g) => ({
        control_identifier: g.control_identifier,
        control_title: g.control_title,
        severity: g.severity,
        gap_description: g.gap_description,
        remediation_steps: g.remediation_steps,
        is_certification_blocker: g.is_certification_blocker,
        recommendation_status: g.recommendation_status ?? "pending",
      })),
      controls: [],
    });
    setExportOpen(false);
  }

  /**
   * « Accepter en masse les non-conformités critiques ».
   *
   * This used to post a body the endpoint rejected with a 422 while the UI
   * optimistically painted every critical gap as accepted — a fake success that
   * survived a page reload as "still pending". The endpoint now accepts
   * {action, filter}; the answer's `processed` count is what the screen trusts,
   * and a failure leaves every row exactly where it was.
   */
  async function handleBulkAcceptCritical() {
    setBulkAccepting(true);
    setError("");
    setNotice("");
    try {
      const result = (await complianceApi.bulkActOnRecommendations(assessmentId, {
        action: "accept",
        filter: "critical",
      })) as BulkActionResult;
      const processed = typeof result?.processed === "number" ? result.processed : 0;
      if (processed === 0) {
        setNotice(t("compliance.bulk_accept_none", "No pending gap matched this selection."));
        return;
      }
      pendingCritical.forEach((g) => onGapUpdated(g.id, "accepted"));
      setNotice(
        t(
          processed === 1 ? "compliance.bulk_accept_done_one" : "compliance.bulk_accept_done_other",
          "{{count}} gaps accepted",
          { count: processed },
        ),
      );
    } catch {
      setError(t("compliance.bulk_accept_failed", "The bulk acceptance failed. Nothing was changed."));
    } finally {
      setBulkAccepting(false);
    }
  }

  return (
    <div className="space-y-5">
      {confirmGap && (
        <GapConfirmModal
          gap={confirmGap}
          assessmentId={assessmentId}
          onClose={() => setConfirmGap(null)}
          onAccepted={(id) => onGapUpdated(id, "accepted")}
        />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-600" title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 flex-shrink-0" />{notice}</span>
          <button onClick={() => setNotice("")} className="text-green-500 hover:text-green-700" title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary banner */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-semibold text-gray-800">
              {t("compliance.gaps_total", "{{count}} gaps in total", { count: gaps.length })}
            </span>
            {counts.blockers > 0 && (
              <span className="text-red-600 font-medium">
                {t(
                  counts.blockers === 1 ? "compliance.blockers_count_one" : "compliance.blockers_count_other",
                  "{{count}} certification blockers",
                  { count: counts.blockers },
                )}
              </span>
            )}
            <span className="text-yellow-600">
              {t("compliance.pending_review_count", "{{count}} pending review", { count: counts.pending })}
            </span>
            <span className="text-green-600">
              {t("compliance.accepted_count", "{{count}} accepted", { count: counts.accepted })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkAcceptCritical}
              disabled={bulkAccepting || pendingCritical.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {bulkAccepting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              {t("compliance.accept_all_critical")}
            </button>
            <button
              onClick={() => navigate(`/compliance/assessments/${assessmentId}/remediation-plan`)}
              className="flex items-center gap-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t("compliance.generate_plan")}
            </button>
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportOpen((o) => !o)}
                className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {t("common.export")}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {exportOpen && (
                <div className="absolute end-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-10 py-1 text-xs">
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-50 text-gray-700"
                  >
                    <Table2 className="w-3.5 h-3.5 text-gray-400" />
                    {t("compliance.export_gaps_csv", "Export gaps (CSV)")}
                  </button>
                  <button
                    onClick={handleExportReport}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-50 text-gray-700"
                  >
                    <FileText className="w-3.5 h-3.5 text-gray-400" />
                    {t("compliance.full_report_btn")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "blockers", "pending", "accepted", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === f
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f === "blockers" && <Filter className="w-3 h-3" />}
            {FILTER_LABEL[f]}
            <span className="opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Gap table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle className="w-10 h-10 text-green-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">{t("compliance.no_gaps_in_category", "No gap in this category.")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("compliance.control_id")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("compliance.control_title")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{t("common.severity")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{t("compliance.blocker")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{t("common.status")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-end">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((gap) => {
                  const recStatus = gap.recommendation_status ?? "pending";
                  const isDone = recStatus !== "pending";
                  return (
                    <tr key={gap.id} className={`hover:bg-gray-50 transition-colors ${isDone ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500 whitespace-nowrap">
                        {gap.control_identifier}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-sm text-gray-800 font-medium truncate">{gap.control_title}</p>
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{gap.gap_description}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLOR[gap.severity] ?? SEVERITY_COLOR.low}`}>
                          {t(`compliance.severities.${gap.severity}`, { defaultValue: gap.severity })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {gap.is_certification_blocker ? (
                          <span title={t("compliance.blocker")} className="text-base">🔴</span>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REC_COLOR[recStatus] ?? REC_COLOR.pending}`}>
                          {recStatusLabel(recStatus)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end">
                        {!isDone ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setConfirmGap(gap)}
                              title={t("compliance.create_action_item")}
                              className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1 rounded-lg transition-colors"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              {t("compliance.accept_gap")}
                            </button>
                            <button
                              onClick={() => handleReject(gap.id)}
                              disabled={rejectingId === gap.id}
                              title={t("compliance.reject_gap")}
                              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {rejectingId === gap.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5" />
                              )}
                              {t("compliance.reject_gap")}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1 text-xs text-gray-400">
                            {recStatus === "accepted" ? (
                              <><CheckCircle className="w-3.5 h-3.5 text-green-500" /> {t("compliance.action_item_created", "Action item created")}</>
                            ) : (
                              <><AlertTriangle className="w-3.5 h-3.5" /> {recStatusLabel("rejected")}</>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
