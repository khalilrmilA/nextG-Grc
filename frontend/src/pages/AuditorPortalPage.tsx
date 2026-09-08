import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ClipboardCheck, Loader2, RefreshCw, ChevronRight,
  CheckCircle, AlertTriangle, Clock, BarChart2,
  FileText, Shield, BookOpen, ExternalLink, MessageSquare,
  Grid3x3, CalendarDays, ClipboardList,
} from "lucide-react";
import { auditorPortalApi, policiesApi, auditCommentsApi, type AuditorAssignment } from "@/api/endpoints";
import { useAuthStore } from "@/store/auth";
import type { Policy, AuditorEngagement, PendingAuditComment } from "@/types";

// ─── Status vocabulary ────────────────────────────────────────────────────────
// The engagement status (planning → fieldwork → review → reporting → closed) and
// the legacy assessment status are two different vocabularies; each gets its own
// map so neither borrows a label that does not describe it.

const ENGAGEMENT_STATUS_CLS: Record<string, string> = {
  planning:  "bg-gray-100 text-gray-600",
  fieldwork: "bg-blue-100 text-blue-700",
  review:    "bg-purple-100 text-purple-700",
  reporting: "bg-amber-100 text-amber-700",
  closed:    "bg-green-100 text-green-700",
};

const ASSESSMENT_STATUS_KEY: Record<string, string> = {
  draft:        "compliance.draft",
  in_progress:  "compliance.in_progress",
  under_review: "compliance.filter_under_review",
  completed:    "compliance.completed",
  archived:     "compliance.archived",
};

const POLICY_STATUS_KEY: Record<string, string> = {
  draft:     "policies.draft",
  in_review: "policies.in_review",
  approved:  "policies.approved",
  published: "policies.published",
  retired:   "policies.retired",
  archived:  "policies.archived",
};

const ASSESSMENT_STATUS_CLS: Record<string, string> = {
  draft:        "bg-gray-100 text-gray-600",
  in_progress:  "bg-blue-100 text-blue-700",
  under_review: "bg-purple-100 text-purple-700",
  completed:    "bg-green-100 text-green-700",
  archived:     "bg-gray-100 text-gray-500",
};

const REPORT_STATUS_CLS: Record<string, string> = {
  draft:       "bg-gray-100 text-gray-600",
  submitted:   "bg-blue-100 text-blue-700",
  approved:    "bg-green-100 text-green-700",
  rejected:    "bg-red-100 text-red-700",
  issued:      "bg-emerald-100 text-emerald-700",
  distributed: "bg-emerald-100 text-emerald-700",
};

function scoreColor(s: number) {
  if (s >= 80) return "text-green-600";
  if (s >= 60) return "text-yellow-600";
  return "text-red-600";
}

function pct(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/** `progress` is an open metric bag on the wire — read it defensively. */
function metric(bag: Record<string, unknown> | undefined, key: string): number {
  const raw = bag?.[key];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function barColor(p: number) {
  if (p >= 80) return "bg-green-500";
  if (p >= 40) return "bg-blue-500";
  return "bg-gray-300";
}

export default function AuditorPortalPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((u) => u);

  const [engagements, setEngagements] = useState<AuditorEngagement[]>([]);
  const [assignments, setAssignments] = useState<AuditorAssignment[]>([]);
  const [pending, setPending]         = useState<PendingAuditComment[]>([]);
  const [policies, setPolicies]       = useState<Policy[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const [eng, asgn, pend, docs] = await Promise.allSettled([
      auditorPortalApi.getMyAudits(),
      auditorPortalApi.getMyAssignments(),
      auditCommentsApi.pending(10),
      policiesApi.list({ page_size: 50 }),
    ]);
    if (eng.status === "fulfilled") setEngagements(Array.isArray(eng.value) ? eng.value : []);
    if (asgn.status === "fulfilled") setAssignments(Array.isArray(asgn.value) ? asgn.value : []);
    if (pend.status === "fulfilled") setPending(Array.isArray(pend.value) ? pend.value : []);
    if (docs.status === "fulfilled") setPolicies(docs.value ?? []);
    // Only a total failure of both engagement feeds is worth an error banner —
    // an auditor with no legacy assignment is a normal, empty state.
    if (eng.status === "rejected" && asgn.status === "rejected") {
      setError(t("errors.load_failed"));
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totals = useMemo(() => {
    const reviewed = engagements.reduce((s, e) => s + metric(e.progress, "items_reviewed"), 0)
      + assignments.reduce((s, a) => s + a.controls_verified, 0);
    const points = engagements.reduce((s, e) => s + metric(e.progress, "items_total"), 0)
      + assignments.reduce((s, a) => s + a.controls_total, 0);
    const openFindings = engagements.reduce((s, e) => s + (e.findings_open ?? 0), 0);
    return { reviewed, points, openFindings };
  }, [engagements, assignments]);

  function fmtDate(value?: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(i18n.language);
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-purple-600" />
            {t("auditor.title", { defaultValue: t("nav.audit_portal") })}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("auditor.subtitle", "The engagements you were appointed to, and the documents that go with them")}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t("common.refresh")}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { key: "eng",  label: t("auditor.stat_engagements", { defaultValue: t("audit_campaign.stat_audits") }), value: engagements.length,                       icon: ClipboardList,  color: "text-purple-600 bg-purple-50" },
          { key: "rev",  label: t("auditor.stat_reviewed", { defaultValue: t("audit_detail.progress") }), value: `${totals.reviewed}/${totals.points}`,  icon: CheckCircle,    color: "text-green-600 bg-green-50"   },
          { key: "find", label: t("auditor.stat_open_findings", { defaultValue: t("audit_campaign.stat_open_findings") }), value: totals.openFindings,                  icon: AlertTriangle,  color: "text-amber-600 bg-amber-50"   },
          { key: "msg",  label: t("audit_comments.pending_title"), value: pending.length,                                      icon: MessageSquare,  color: "text-blue-600 bg-blue-50"     },
        ].map(({ key, label, value, icon: Icon, color }) => (
          <div key={key} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-gray-900 truncate">{value}</p>
              <p className="text-xs text-gray-500 truncate">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── My engagements (GET /auditor-portal/audits) ── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-purple-600" />
            {t("auditor.engagements", { defaultValue: t("audit_campaign.stat_audits") })}
          </h2>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{engagements.length}</span>
        </div>

        {engagements.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
            <ClipboardCheck className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-base font-semibold text-gray-600">{t("auditor.no_engagements", { defaultValue: t("audits.no_assignments") })}</p>
            <p className="text-sm text-gray-400 mt-1">
              {t("auditor.no_engagements_hint", "The audit team will appoint you to an engagement. It will appear here.")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {engagements.map((eng) => {
              const total = metric(eng.progress, "items_total");
              const done  = metric(eng.progress, "items_reviewed");
              const p     = pct(done, total);
              const statusCls = ENGAGEMENT_STATUS_CLS[eng.status] ?? ENGAGEMENT_STATUS_CLS.planning;
              const reportCls = REPORT_STATUS_CLS[eng.report_status] ?? REPORT_STATUS_CLS.draft;
              return (
                <div key={eng.audit_id} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        {eng.framework_short_name && (
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-purple-50 text-purple-700">
                            {eng.framework_short_name}
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusCls}`}>
                          {t(`audits.status_${eng.status}`, eng.status)}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${reportCls}`}>
                          {t("audits.audit_report")} · {t(`audit_report.statuses.${eng.report_status}`, eng.report_status)}
                        </span>
                        {eng.grid_name && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-teal-50 text-teal-700">
                            <Grid3x3 className="w-3 h-3" />
                            {eng.grid_name}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-gray-900 truncate">{eng.title}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {eng.framework_name ?? eng.assessment_name ?? t("common.none")}
                      </p>
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                        <CalendarDays className="w-3 h-3" />
                        {t("audit_detail.period")}: {fmtDate(eng.planned_start)} — {fmtDate(eng.planned_end)}
                      </p>
                    </div>

                    <div className="flex items-center gap-5 flex-shrink-0">
                      <div className="text-center">
                        <p className="text-xl font-bold text-gray-800">{p}%</p>
                        <p className="text-xs text-gray-400">{t("audit_detail.progress")}</p>
                      </div>
                      <div className="text-center">
                        <p className={`text-xl font-bold ${eng.findings_open > 0 ? "text-amber-600" : "text-gray-800"}`}>
                          {eng.findings_open}
                        </p>
                        <p className="text-xs text-gray-400">{t("audits.findings")}</p>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        {t("audit_detail.progress_evaluated", { done, total })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-300" />
                        {Math.max(total - done, 0)}
                      </span>
                      <span className="flex items-center gap-1">
                        <BarChart2 className="w-3 h-3 text-gray-400" />
                        {total}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${barColor(p)}`} style={{ width: `${p}%` }} />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/auditor/portal/audits/${eng.audit_id}`)}
                      className="inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      {t("auditor.open_checklist", { defaultValue: t("audit_detail.tab_checklist") })}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/auditor/portal/audits/${eng.audit_id}/report`)}
                      className="inline-flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {t("audits.audit_report")}
                    </button>
                    {eng.report_status === "rejected" && eng.report_rejected_reason && (
                      <span className="text-xs text-red-600">
                        {t("audit_report.rejected_reason_label")}: {eng.report_rejected_reason}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Exchanges awaiting my answer ── */}
      {pending.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-600" />
              {t("audit_comments.pending_title")}
            </h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{pending.length}</span>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {pending.map((p) => (
              <button
                key={p.comment_id}
                type="button"
                onClick={() => { if (p.audit_id) navigate(`/auditor/portal/audits/${p.audit_id}`); }}
                className="w-full text-left flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {p.finding_title
                      ? t("audit_comments.thread_on_finding", { title: p.finding_title })
                      : p.audit_title ?? t("audit_comments.thread_on_audit")}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{p.excerpt}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {p.author_name ?? t("common.none")} · {fmtDate(p.created_at)}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1 rtl:rotate-180" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Legacy assessment assignments ── */}
      {assignments.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-purple-600" />
              {t("audits.my_assignments")}
            </h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{assignments.length}</span>
          </div>
          <div className="grid gap-4">
            {assignments.map((asgn) => {
              const p = pct(asgn.controls_verified, asgn.controls_total);
              const statusCls = ASSESSMENT_STATUS_CLS[asgn.status] ?? ASSESSMENT_STATUS_CLS.in_progress;
              return (
                <button
                  key={asgn.assignment_id}
                  type="button"
                  onClick={() => navigate(`/auditor/portal/${asgn.assessment_id}`)}
                  className="w-full text-left bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-purple-50 text-purple-700">
                          {asgn.framework_short_name}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusCls}`}>
                          {t(ASSESSMENT_STATUS_KEY[asgn.status] ?? "common.status")}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-gray-900">{asgn.assessment_name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{asgn.framework_name}</p>
                    </div>
                    <div className="flex items-center gap-5 flex-shrink-0">
                      {asgn.compliance_score != null && (
                        <div className="text-center">
                          <p className={`text-xl font-bold ${scoreColor(asgn.compliance_score)}`}>{asgn.compliance_score}%</p>
                          <p className="text-xs text-gray-400">{t("compliance.score", "score")}</p>
                        </div>
                      )}
                      <div className="text-center">
                        <p className="text-xl font-bold text-gray-800">{p}%</p>
                        <p className="text-xs text-gray-400">{t("audit_detail.progress")}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-300 rtl:rotate-180" />
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        {t("audit_detail.progress_evaluated", { done: asgn.controls_verified, total: asgn.controls_total })}
                      </span>
                      <span className="flex items-center gap-1">
                        <BarChart2 className="w-3 h-3 text-gray-400" />
                        {asgn.controls_total}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${barColor(p)}`} style={{ width: `${p}%` }} />
                    </div>
                  </div>

                  {asgn.reference_document_ids.length > 0 && (
                    <p className="mt-2 text-xs text-gray-400">
                      {t("audits.reference_docs")}: {asgn.reference_document_ids.length}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Company documents ── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            {user?.org ? `${user.org} — ${t("auditor.company_documents", { defaultValue: t("audits.reference_docs") })}` : t("auditor.company_documents", { defaultValue: t("audits.reference_docs") })}
          </h2>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{policies.length}</span>
        </div>

        {policies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <BookOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">{t("auditor.no_documents", { defaultValue: t("docgen.no_docs") })}</p>
            <p className="text-xs text-gray-400 mt-1">
              {t("auditor.no_documents_hint", "The audited entity has not published any policy or procedure yet.")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {policies.map((doc) => (
              <div key={doc.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
                <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {doc.policy_type && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                        {doc.policy_type.replace(/_/g, " ")}
                      </span>
                    )}
                    {doc.status && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        doc.status === "approved" ? "bg-green-50 text-green-600" :
                        doc.status === "draft"    ? "bg-yellow-50 text-yellow-600" :
                        "bg-gray-50 text-gray-500"
                      }`}>
                        {t(POLICY_STATUS_KEY[doc.status] ?? "common.status")}
                      </span>
                    )}
                    {doc.version != null && <span className="text-xs text-gray-400">v{doc.version}</span>}
                  </div>
                </div>
                <span
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-300"
                  title={t("common.view")}
                  aria-label={t("common.view")}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
