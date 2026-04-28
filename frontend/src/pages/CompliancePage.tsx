import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import { CheckCircle, Clock, AlertCircle, XCircle, Plus, FileText, Loader2, X, FolderUp, Sparkles, BarChart3, Trash2 } from "lucide-react";
import { complianceApi, frameworksApi } from "@/api/endpoints";
import type { AssessmentListItem, Framework } from "@/types";

const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  draft:        { label: "Draft",        icon: XCircle,     color: "text-gray-500 bg-gray-100"    },
  in_progress:  { label: "In Progress",  icon: Clock,       color: "text-blue-600 bg-blue-50"     },
  under_review: { label: "Under Review", icon: AlertCircle, color: "text-orange-600 bg-orange-50" },
  completed:    { label: "Completed",    icon: CheckCircle, color: "text-green-600 bg-green-50"   },
  archived:     { label: "Archived",     icon: XCircle,     color: "text-gray-400 bg-gray-50"     },
};

function scoreColor(score: number) {
  if (score >= 80) return "text-green-700 bg-green-50";
  if (score >= 60) return "text-yellow-700 bg-yellow-50";
  return "text-red-700 bg-red-50";
}

function ScoreBadge({ score }: { readonly score: number | null | undefined }) {
  const { t } = useTranslation();
  if (score == null) return <span className="text-gray-400 text-sm italic">{t("compliance.score_not_run", "Not run")}</span>;
  return <span className={`text-xl font-bold px-3 py-1.5 rounded-xl ${scoreColor(score)}`}>{score}%</span>;
}

function StatusBadge({ status }: { readonly status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
      <s.icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

// ─── New Assessment Modal ──────────────────────────────────────────────────────

function NewAssessmentModal({
  frameworks,
  onClose,
  onCreate,
}: {
  readonly frameworks: Framework[];
  readonly onClose: () => void;
  readonly onCreate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [frameworkId, setFrameworkId] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!frameworkId || !name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await complianceApi.createAssessment({
        framework_id: frameworkId,
        name: name.trim(),
        scope_description: scope.trim() || undefined,
      });
      onCreate(result.id);
    } catch {
      setError("Failed to create assessment. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{t("compliance.modal_title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("compliance.framework")} *</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={frameworkId}
              onChange={(e) => setFrameworkId(e.target.value)}
              required
            >
              <option value="">{t("compliance.select_framework_placeholder")}</option>
              {frameworks.map((fw) => (
                <option key={fw.id} value={fw.id}>
                  {fw.name} ({t("compliance.controls_count", { count: fw.control_count })})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("compliance.assessment_name")} *</label>
            <input
              type="text"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("compliance.assessment_name_placeholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("compliance.scope")} ({t("common.optional")})</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
              placeholder={t("compliance.scope_optional_placeholder")}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !frameworkId || !name.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("compliance.create_assessment")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<AssessmentListItem[]>([]);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      complianceApi.listAssessments(),
      frameworksApi.list(),
    ]).then(([aResp, fwList]) => {
      setAssessments(aResp.items);
      setFrameworks(fwList.filter((fw) => fw.control_count > 0));
    }).finally(() => setLoading(false));
  }, []);

  const filtered = assessments.filter(
    (a) => statusFilter === "all" || a.status === statusFilter
  );

  const withScore = assessments.filter((a) => a.compliance_score != null);
  const avgScore = withScore.length > 0
    ? Math.round(withScore.reduce((s, a) => s + (a.compliance_score ?? 0), 0) / withScore.length)
    : null;

  function handleCreate(id: string) {
    setShowModal(false);
    navigate(`/compliance/${id}`);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await complianceApi.deleteAssessment(id);
      setAssessments(prev => prev.filter(a => a.id !== id));
    } catch {/* silent */} finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {showModal && (
        <NewAssessmentModal
          frameworks={frameworks}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("compliance.title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("compliance.assessments_subtitle", { count: assessments.length, active: assessments.filter((a) => a.status === "in_progress").length })}
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("compliance.new_assessment")}
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("compliance.kpi_avg_score"),    value: avgScore != null ? `${avgScore}%` : "—", sub: t("compliance.kpi_avg_score_sub") },
          { label: t("compliance.kpi_total"),        value: assessments.length,                       sub: t("compliance.kpi_total_sub") },
          { label: t("compliance.kpi_completed"),    value: assessments.filter((a) => a.status === "completed").length, sub: t("compliance.kpi_completed_sub") },
          { label: t("compliance.kpi_in_progress"),  value: assessments.filter((a) => a.status === "in_progress").length, sub: t("compliance.kpi_in_progress_sub") },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { key: "all",          label: t("common.all")                      },
          { key: "in_progress",  label: t("compliance.filter_in_progress")   },
          { key: "under_review", label: t("compliance.filter_under_review")  },
          { key: "completed",    label: t("compliance.filter_completed")     },
          { key: "draft",        label: t("compliance.filter_draft")         },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === tab.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Assessment cards */}
      <div className="space-y-4">
        {filtered.map((a) => (
          <div
            key={a.id}
            onClick={() => confirmDeleteId !== a.id && navigate(`/compliance/${a.id}`)}
            className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                    {a.name}
                  </h3>
                  <StatusBadge status={a.status} />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span className="font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
                    {a.framework_short_name}
                  </span>
                  <span>{a.framework_name}</span>
                  {a.document_count > 0 && (
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {a.document_count} doc{a.document_count !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="text-gray-400">
                    {t("common.created_at")} {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                <ScoreBadge score={a.compliance_score} />
                {a.status === "draft" && (
                  confirmDeleteId === a.id ? (
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-red-600 font-medium">Delete?</span>
                      <button
                        onClick={() => handleDelete(a.id)}
                        disabled={deletingId === a.id}
                        className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        {deletingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes, delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg border border-gray-200"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(a.id); }}
                      title="Delete this draft assessment"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )
                )}
              </div>
            </div>

            {a.compliance_score != null && (
              <div className="mt-4">
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      a.compliance_score >= 80
                        ? "bg-green-500"
                        : a.compliance_score >= 60
                        ? "bg-yellow-400"
                        : "bg-red-400"
                    }`}
                    style={{ width: `${a.compliance_score}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* How-to guide — shown when no assessments exist */}
      {assessments.length === 0 && !loading && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <FolderUp className="w-5 h-5 text-blue-600" />
            <p className="font-bold text-blue-900">{t("compliance.how_to_title")}</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { num: 1, icon: Plus,        color: "bg-blue-100 text-blue-600",    title: t("compliance.how_to_step1_title"), desc: t("compliance.how_to_step1_desc") },
              { num: 2, icon: FolderUp,    color: "bg-purple-100 text-purple-600", title: t("compliance.how_to_step2_title"), desc: t("compliance.how_to_step2_desc") },
              { num: 3, icon: Sparkles,    color: "bg-orange-100 text-orange-600", title: t("compliance.how_to_step3_title"), desc: t("compliance.how_to_step3_desc") },
              { num: 4, icon: BarChart3,   color: "bg-green-100 text-green-600",  title: t("compliance.how_to_step4_title"), desc: t("compliance.how_to_step4_desc") },
              { num: 5, icon: FileText,    color: "bg-teal-100 text-teal-600",    title: t("compliance.how_to_step5_title"), desc: t("compliance.how_to_step5_desc") },
              { num: 6, icon: CheckCircle, color: "bg-green-100 text-green-600",  title: t("compliance.how_to_step6_title"), desc: t("compliance.how_to_step6_desc") },
            ].map(({ num, icon: Icon, color, title, desc }) => (
              <div key={num} className="bg-white rounded-xl border border-blue-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-bold text-gray-400">{t("compliance.step_label", { num })}</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("compliance.create_first_assessment")}
            </button>
            <Link to="/help" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              {t("compliance.full_guide")}
            </Link>
          </div>
        </div>
      )}

      {filtered.length === 0 && assessments.length > 0 && !loading && (
        <div className="text-center py-16 text-gray-400 text-sm">
          {t("compliance.no_filter_match")}
        </div>
      )}
    </div>
  );
}
