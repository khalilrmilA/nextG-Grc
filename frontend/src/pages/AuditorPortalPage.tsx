import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardCheck, Loader2, RefreshCw, ChevronRight,
  CheckCircle, AlertTriangle, Clock, BarChart2,
  FileText, Shield, BookOpen, ExternalLink,
} from "lucide-react";
import { auditorPortalApi, policiesApi, type AuditorAssignment } from "@/api/endpoints";
import { useAuthStore } from "@/store/auth";
import type { Policy } from "@/types";

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  draft:        { label: "Draft",        color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
  in_progress:  { label: "In Progress",  color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
  under_review: { label: "Under Review", color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  completed:    { label: "Completed",    color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
  archived:     { label: "Archived",     color: "bg-gray-100 text-gray-500",     dot: "bg-gray-300"   },
};

function scoreColor(s: number) {
  if (s >= 80) return "text-green-600";
  if (s >= 60) return "text-yellow-600";
  return "text-red-600";
}

function progressPct(verified: number, total: number) {
  if (total === 0) return 0;
  return Math.round((verified / total) * 100);
}

export default function AuditorPortalPage() {
  const navigate = useNavigate();
  const user = useAuthStore(u => u);
  const [assignments, setAssignments] = useState<AuditorAssignment[]>([]);
  const [policies, setPolicies]       = useState<Policy[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [data, policyData] = await Promise.allSettled([
        auditorPortalApi.getMyAssignments(),
        policiesApi.list({ page_size: 50 }),
      ]);
      if (data.status === "fulfilled") setAssignments(data.value);
      else setError("Failed to load assignments.");
      if (policyData.status === "fulfilled") setPolicies(policyData.value.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-purple-600" />
            Auditor Portal
          </h1>
          <p className="text-sm text-gray-500 mt-1">Your active audit assignments</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && assignments.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <ClipboardCheck className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-base font-semibold text-gray-600">No assignments yet</p>
          <p className="text-sm text-gray-400 mt-1">
            An admin will assign you to an assessment. Check back later.
          </p>
        </div>
      )}

      {assignments.length > 0 && (
        <div className="grid gap-4">
          {assignments.map((asgn) => {
            const pct = progressPct(asgn.controls_verified, asgn.controls_total);
            const statusCfg = STATUS_MAP[asgn.status] ?? STATUS_MAP.in_progress;
            return (
              <div
                key={asgn.assignment_id}
                className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/auditor/portal/${asgn.assessment_id}`)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700">
                        {asgn.framework_short_name}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${statusCfg.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                        {statusCfg.label}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">{asgn.assessment_name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{asgn.framework_name}</p>
                  </div>

                  <div className="flex items-center gap-5 flex-shrink-0">
                    {asgn.compliance_score != null && (
                      <div className="text-center">
                        <p className={`text-xl font-bold ${scoreColor(asgn.compliance_score)}`}>
                          {asgn.compliance_score}%
                        </p>
                        <p className="text-xs text-gray-400">score</p>
                      </div>
                    )}
                    <div className="text-center">
                      <p className="text-xl font-bold text-gray-800">{pct}%</p>
                      <p className="text-xs text-gray-400">reviewed</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300" />
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                    <span className="flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      {asgn.controls_verified} verified
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-300" />
                      {asgn.controls_total - asgn.controls_verified} remaining
                    </span>
                    <span className="flex items-center gap-1">
                      <BarChart2 className="w-3 h-3 text-gray-400" />
                      {asgn.controls_total} total
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-blue-500" : "bg-gray-300"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {asgn.reference_document_ids.length > 0 && (
                  <p className="mt-2 text-xs text-gray-400">
                    {asgn.reference_document_ids.length} reference document{asgn.reference_document_ids.length !== 1 ? "s" : ""} attached
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Assignments",      value: assignments.length,                                                              icon: ClipboardCheck, color: "text-purple-600 bg-purple-50" },
          { label: "Controls Reviewed",value: assignments.reduce((s, a) => s + a.controls_verified, 0),                       icon: CheckCircle,    color: "text-green-600 bg-green-50"  },
          { label: "Pending Review",   value: assignments.reduce((s, a) => s + (a.controls_total - a.controls_verified), 0),  icon: AlertTriangle,  color: "text-yellow-600 bg-yellow-50"},
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Company Documents */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            {user?.org} — Company Documents
          </h2>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{policies.length}</span>
        </div>

        {policies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <BookOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">No documents available yet</p>
            <p className="text-xs text-gray-400 mt-1">The company hasn't published any policies or documents yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {policies.map(doc => (
              <div key={doc.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {doc.policy_type && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded capitalize">{doc.policy_type.replace(/_/g, " ")}</span>
                    )}
                    {doc.status && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        doc.status === "approved" ? "bg-green-50 text-green-600" :
                        doc.status === "draft"    ? "bg-yellow-50 text-yellow-600" :
                        "bg-gray-50 text-gray-500"
                      }`}>{doc.status}</span>
                    )}
                    {doc.version && <span className="text-[10px] text-gray-400">v{doc.version}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="flex-shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-purple-600 transition-colors"
                  title="View document"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
