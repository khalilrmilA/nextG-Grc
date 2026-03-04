import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle, XCircle, AlertTriangle, Download,
  Sparkles, Loader2, Filter,
} from "lucide-react";
import { complianceApi } from "@/api/endpoints";
import type { GapDetail } from "@/types";
import GapConfirmModal from "./GapConfirmModal";

interface Props {
  readonly assessmentId: string;
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

export default function GapReportTab({ assessmentId, gaps, onGapUpdated }: Props) {
  const navigate = useNavigate();
  const [confirmGap, setConfirmGap] = useState<GapDetail | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [bulkAccepting, setBulkAccepting] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "rejected" | "blockers">("all");

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

  async function handleReject(gapId: string) {
    setRejectingId(gapId);
    try {
      await complianceApi.actOnRecommendation(assessmentId, gapId, { action: "reject" });
      onGapUpdated(gapId, "rejected");
    } catch {/* silent */} finally {
      setRejectingId(null);
    }
  }

  async function handleBulkAcceptCritical() {
    setBulkAccepting(true);
    try {
      await complianceApi.bulkActOnRecommendations(assessmentId, { action: "accept", filter: "critical" });
      gaps
        .filter((g) => g.severity === "critical" && (g.recommendation_status ?? "pending") === "pending")
        .forEach((g) => onGapUpdated(g.id, "accepted"));
    } catch {/* silent */} finally {
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

      {/* Summary banner */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-semibold text-gray-800">{gaps.length} gaps total</span>
            {counts.blockers > 0 && (
              <span className="text-red-600 font-medium">
                🔴 {counts.blockers} certification blocker{counts.blockers !== 1 ? "s" : ""}
              </span>
            )}
            <span className="text-yellow-600">{counts.pending} pending review</span>
            <span className="text-green-600">{counts.accepted} accepted</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkAcceptCritical}
              disabled={bulkAccepting || counts.pending === 0}
              className="flex items-center gap-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {bulkAccepting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Accept All Critical
            </button>
            <button
              onClick={() => navigate(`/compliance/assessments/${assessmentId}/remediation-plan`)}
              className="flex items-center gap-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate 90-day Plan
            </button>
            <button className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors">
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
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
            {f === "all" ? "All" : f === "blockers" ? "Blockers" : f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Gap table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle className="w-10 h-10 text-green-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No gaps in this category.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Ref</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Control</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Severity</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Blocker</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Action</th>
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
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_COLOR[gap.severity] ?? SEVERITY_COLOR.low}`}>
                          {gap.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {gap.is_certification_blocker ? (
                          <span title="Certification blocker" className="text-base">🔴</span>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${REC_COLOR[recStatus]}`}>
                          {recStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isDone ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setConfirmGap(gap)}
                              title="Accept — create action item"
                              className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1 rounded-lg transition-colors"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Accept
                            </button>
                            <button
                              onClick={() => handleReject(gap.id)}
                              disabled={rejectingId === gap.id}
                              title="Reject — mark as not applicable"
                              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {rejectingId === gap.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5" />
                              )}
                              Reject
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1 text-xs text-gray-400">
                            {recStatus === "accepted" ? (
                              <><CheckCircle className="w-3.5 h-3.5 text-green-500" /> Action item created</>
                            ) : (
                              <><AlertTriangle className="w-3.5 h-3.5" /> Rejected</>
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
