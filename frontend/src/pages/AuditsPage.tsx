import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardList, Plus, AlertTriangle, Calendar, Tag, X,
  ChevronRight, Sparkles, UserPlus, Users, Loader2,
  Trash2, Shield, RefreshCw, CheckCircle,
} from "lucide-react";
import AuditPlanModal from "../components/ai/AuditPlanModal";
import CreateAuditorModal from "../components/features/compliance/CreateAuditorModal";
import { auditsApi, usersApi, complianceApi } from "@/api/endpoints";
import type { AuditorUser, AuditorAssignmentRecord } from "@/api/endpoints";

const TYPE_COLORS: Record<string, string> = {
  internal:      "bg-slate-100 text-slate-600",
  external:      "bg-violet-100 text-violet-700",
  certification: "bg-amber-100 text-amber-700",
  regulatory:    "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, { color: string; dot: string }> = {
  planning:  { color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
  fieldwork: { color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
  review:    { color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  reporting: { color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  closed:    { color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
};

// ── New Audit Modal ───────────────────────────────────────────────────────────

function NewAuditModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: "", audit_type: "internal", status: "planning",
    planned_start: "", planned_end: "", scope: "", lead_auditor: "", recurrence: "none",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("audits.title_required")); return; }
    if (!form.planned_start || !form.planned_end) { setError(t("audits.dates_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      await auditsApi.create({
        title: form.title.trim(),
        audit_type: form.audit_type as "internal" | "external" | "regulatory" | "certification",
        planned_start: form.planned_start,
        planned_end: form.planned_end,
        scope: form.scope.trim() || undefined,
        recurrence: form.recurrence as "annual" | "semi_annual" | "none",
      });
      onSaved();
      onClose();
    } catch {
      setError(t("audits.error_create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const STATUS_KEYS = ["planning", "fieldwork", "review", "reporting", "closed"] as const;
  const TYPE_KEYS   = ["internal", "external", "certification", "regulatory"] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{t("audits.new_audit")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_title")} *</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("audits.form_title_placeholder")}
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_type")}</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.audit_type} onChange={e => setForm(f => ({ ...f, audit_type: e.target.value }))}>
                {TYPE_KEYS.map(k => <option key={k} value={k}>{t(`audits.type_${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_status")}</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_KEYS.map(k => <option key={k} value={k}>{t(`audits.status_${k}`)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_start_date")} *</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_end_date")} *</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.planned_end} onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_recurrence")}</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={form.recurrence} onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))}>
              <option value="none">{t("audits.recurrence_none")}</option>
              <option value="annual">{t("audits.recurrence_annual")}</option>
              <option value="semi_annual">{t("audits.recurrence_semi_annual")}</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">{t("audits.form_recurrence_hint")}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_scope")}</label>
            <textarea rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("audits.form_scope_placeholder")}
              value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("audits.create_audit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Assign Auditor Modal ──────────────────────────────────────────────────────

function AssignAuditorModal({
  auditors,
  assessments,
  onClose,
  onSaved,
}: {
  readonly auditors: AuditorUser[];
  readonly assessments: any[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [auditorId, setAuditorId] = useState(auditors[0]?.id ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleAssessment(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!auditorId) { setError(t("audits.error_select_auditor")); return; }
    if (selectedIds.size === 0) { setError(t("audits.error_select_assessment")); return; }
    setSubmitting(true);
    setError("");
    let anyFailed = false;
    try {
      for (const assessmentId of selectedIds) {
        try {
          await usersApi.assignAuditor(auditorId, assessmentId);
        } catch (err: any) {
          const msg = err?.response?.data?.detail || "";
          if (!msg.toLowerCase().includes("already")) anyFailed = true;
        }
      }
      onSaved();
      onClose();
    } catch {
      anyFailed = true;
    } finally {
      setSubmitting(false);
      if (anyFailed) setError(t("audits.error_assignments_failed"));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-600" /> {t("audits.assign_auditor_to_assessments")}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.auditor")}</label>
              {auditors.length === 0 ? (
                <p className="text-sm text-gray-400 italic">{t("audits.no_auditor_create_first")}</p>
              ) : (
                <select
                  value={auditorId}
                  onChange={e => setAuditorId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                >
                  {auditors.map(a => (
                    <option key={a.id} value={a.id}>{a.first_name} {a.last_name} — {a.email}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {t("audits.compliance_assessments")}
                </label>
                {selectedIds.size > 0 && (
                  <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                    {t("audits.selected_count", { count: selectedIds.size })}
                  </span>
                )}
              </div>
              {assessments.length === 0 ? (
                <p className="text-sm text-gray-400 italic">{t("audits.no_assessments")}</p>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                  {assessments.map((a: any) => (
                    <label
                      key={a.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        selectedIds.has(a.id) ? "bg-purple-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleAssessment(a.id)}
                        className="w-4 h-4 accent-purple-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                        {a.framework_name && (
                          <p className="text-xs text-gray-400 truncate">{a.framework_name}</p>
                        )}
                      </div>
                      {selectedIds.has(a.id) && (
                        <span className="text-purple-600 shrink-0">✓</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-xs text-purple-700">
              {t("audits.auditor_access_info")}
            </div>
          </div>

          <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={submitting || !auditorId || selectedIds.size === 0}
              className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? t("audits.assigning") : selectedIds.size > 1 ? t("audits.selected_count", { count: selectedIds.size }) : t("audits.assign")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuditsPage() {
  const { t } = useTranslation();

  const [tab, setTab] = useState<"audits" | "auditors">("audits");

  const [audits, setAudits]     = useState<any[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(true);

  const [auditors, setAuditors]         = useState<AuditorUser[]>([]);
  const [assignments, setAssignments]   = useState<AuditorAssignmentRecord[]>([]);
  const [assessments, setAssessments]   = useState<any[]>([]);
  const [loadingAuditors, setLoadingAuditors] = useState(true);

  const [showAdd, setShowAdd]                   = useState(false);
  const [showCreateAuditor, setShowCreateAuditor] = useState(false);
  const [showAssign, setShowAssign]             = useState(false);
  const [planAudit, setPlanAudit]               = useState<any | null>(null);

  const [notice, setNotice] = useState<string>("");
  const [confirmDeleteAuditorId, setConfirmDeleteAuditorId] = useState<string | null>(null);
  const [deletingAuditorId, setDeletingAuditorId] = useState<string | null>(null);

  async function loadAudits() {
    setLoadingAudits(true);
    try {
      const data = await auditsApi.list({ page_size: 20 });
      setAudits(Array.isArray(data) ? data : (data as any).items ?? []);
    } catch {
      setAudits([]);
    } finally {
      setLoadingAudits(false);
    }
  }

  async function loadAuditors() {
    setLoadingAuditors(true);
    try {
      const [auditorData, assignmentData, assessmentData] = await Promise.allSettled([
        usersApi.listAuditors(),
        usersApi.listAssignments(),
        complianceApi.listAssessments(),
      ]);
      if (auditorData.status === "fulfilled") setAuditors(auditorData.value);
      if (assignmentData.status === "fulfilled") setAssignments(assignmentData.value);
      if (assessmentData.status === "fulfilled") {
        const d = assessmentData.value;
        setAssessments(Array.isArray(d) ? d : (d as any).items ?? []);
      }
    } finally {
      setLoadingAuditors(false);
    }
  }

  useEffect(() => { loadAudits(); loadAuditors(); }, []);

  async function handleUnassign(assignmentId: string) {
    if (!confirm(t("audits.delete_account_confirm"))) return;
    try {
      await usersApi.unassignAuditor(assignmentId);
      setAssignments(prev => prev.filter(a => a.id !== assignmentId));
    } catch {
      setNotice(t("audits.error_assignments_failed"));
    }
  }

  async function handleDeleteAuditor(auditorId: string) {
    setDeletingAuditorId(auditorId);
    try {
      await usersApi.deleteAuditor(auditorId);
      setAuditors(prev => prev.filter(a => a.id !== auditorId));
      setAssignments(prev => prev.filter(a => a.auditor_id !== auditorId));
    } catch {
      setNotice(t("audits.error_create_failed"));
    } finally {
      setDeletingAuditorId(null);
      setConfirmDeleteAuditorId(null);
    }
  }

  const activeAudits  = audits.filter(a => a.status !== "closed");
  const closedAudits  = audits.filter(a => a.status === "closed");

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("audits.management_title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {audits.length} {t("audits.title").toLowerCase()} · {activeAudits.length} {t("audits.kpi_active").toLowerCase()} · {auditors.length} {t("audits.auditor")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateAuditor(true)}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UserPlus className="w-4 h-4" /> {t("audits.add_auditor")}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> {t("audits.new_audit")}
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice("")}><X className="w-4 h-4 opacity-50 hover:opacity-100" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(["audits", "auditors"] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize flex items-center gap-1.5 ${
              tab === tabKey ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tabKey === "audits" ? <ClipboardList className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            {tabKey === "audits" ? t("audits.tab_audits") : t("audits.auditor_accounts")}
            <span className="ml-1 text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">
              {tabKey === "audits" ? audits.length : auditors.length}
            </span>
          </button>
        ))}
      </div>

      {/* ── AUDITS TAB ── */}
      {tab === "audits" && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: t("audits.kpi_active"),       value: activeAudits.length,  sub: t("audits.kpi_active_sub") },
              { label: t("audits.kpi_closed"),        value: closedAudits.length,  sub: t("audits.kpi_closed_sub") },
              { label: t("audits.kpi_total_findings"), value: audits.reduce((s, a) => s + (a.finding_count || 0), 0), sub: t("audits.kpi_total_findings_sub") },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {loadingAudits ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : audits.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
              <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">{t("audits.no_audits")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("audits.no_audits_help")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {audits.map((audit: any) => {
                const st = STATUS_COLORS[audit.status] ?? STATUS_COLORS.planning;
                const statusLabel = String(t(`audits.status_${audit.status}` as never, audit.status));
                return (
                  <div
                    key={audit.id}
                    className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-all group cursor-pointer"
                    onClick={() => setPlanAudit(audit)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-orange-100 transition-colors">
                          <ClipboardList className="w-5 h-5 text-orange-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{audit.title}</h3>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-md capitalize ${TYPE_COLORS[audit.audit_type] ?? "bg-gray-100 text-gray-600"}`}>
                              <Tag className="w-2.5 h-2.5 inline mr-1" />{String(t(`audits.type_${audit.audit_type}` as never, audit.audit_type))}
                            </span>
                            {audit.planned_start && (
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Calendar className="w-3 h-3" />
                                {audit.planned_start} → {audit.planned_end}
                              </span>
                            )}
                            {audit.finding_count > 0 && (
                              <span className="flex items-center gap-1 text-xs text-orange-600 font-medium">
                                <AlertTriangle className="w-3 h-3" />{audit.finding_count} {t("audits.findings").toLowerCase()}
                              </span>
                            )}
                            {audit.recurrence && audit.recurrence !== "none" && (
                              <span className="flex items-center gap-1 text-xs text-indigo-600 font-medium">
                                <RefreshCw className="w-3 h-3" />
                                {String(t(`audits.recurrence_${audit.recurrence}` as never, audit.recurrence))}
                              </span>
                            )}
                          </div>
                          {audit.scope && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{audit.scope}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${st.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{statusLabel}
                        </span>
                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── AUDITORS TAB ── */}
      {tab === "auditors" && (
        <div className="space-y-6">
          {loadingAuditors ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
            </div>
          ) : (
            <>
              {/* Auditor accounts */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-600" /> {t("audits.auditor_accounts")}
                  </h2>
                  <button
                    onClick={() => setShowCreateAuditor(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> {t("audits.create_auditor")}
                  </button>
                </div>
                {auditors.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">{t("audits.no_auditor_accounts")}</p>
                    <p className="text-xs text-gray-400 mt-1">{t("audits.no_auditor_accounts_help")}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {auditors.map(a => (
                      <div key={a.id} className="flex items-center gap-4 px-6 py-3 group">
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-semibold text-sm shrink-0">
                          {a.first_name[0]}{a.last_name[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{a.first_name} {a.last_name}</p>
                          <p className="text-xs text-gray-400">{a.email}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {a.is_active ? t("audits.active_status") : t("audits.inactive_status")}
                        </span>
                        {confirmDeleteAuditorId === a.id ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs text-red-600 font-medium">{t("audits.delete_account_confirm")}</span>
                            <button
                              onClick={() => handleDeleteAuditor(a.id)}
                              disabled={deletingAuditorId === a.id}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {deletingAuditorId === a.id ? t("audits.deleting") : t("audits.yes_delete")}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteAuditorId(null)}
                              className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md hover:bg-gray-200 transition-colors"
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteAuditorId(a.id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            title={t("audits.delete_account_confirm")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Assignments */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" /> {t("audits.assessment_assignments")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadAuditors()}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title={t("common.refresh")}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setShowAssign(true)}
                      disabled={auditors.length === 0 || assessments.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> {t("audits.assign_auditor")}
                    </button>
                  </div>
                </div>
                {assignments.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <Shield className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">{t("audits.no_assignments")}</p>
                    <p className="text-xs text-gray-400 mt-1">{t("audits.no_assignments_help")}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {assignments.map(a => (
                      <div key={a.id} className="flex items-center gap-4 px-6 py-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{a.auditor_name}</p>
                          <p className="text-xs text-gray-400">{a.auditor_email}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-medium text-gray-700 truncate max-w-48">{a.assessment_name}</p>
                          <p className="text-xs text-gray-400">{t("audits.assessment")}</p>
                        </div>
                        <button
                          onClick={() => handleUnassign(a.id)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title={t("common.delete")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Login instructions */}
              <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-purple-900 mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> {t("audits.how_auditors_login")}
                </h3>
                <ol className="text-xs text-purple-700 space-y-1.5 list-decimal list-inside">
                  <li>{t("audits.how_login_step1")}</li>
                  <li>{t("audits.how_login_step2")}</li>
                  <li>{t("audits.how_login_step3")}</li>
                  <li>{t("audits.how_login_step4")}</li>
                  <li>{t("audits.how_login_step5")}</li>
                </ol>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <NewAuditModal
          onClose={() => setShowAdd(false)}
          onSaved={loadAudits}
        />
      )}

      {showCreateAuditor && (
        <CreateAuditorModal
          onClose={() => setShowCreateAuditor(false)}
          onCreated={() => {
            loadAuditors();
            setShowCreateAuditor(false);
            setTab("auditors");
          }}
        />
      )}

      {showAssign && (
        <AssignAuditorModal
          auditors={auditors}
          assessments={assessments}
          onClose={() => setShowAssign(false)}
          onSaved={loadAuditors}
        />
      )}

      {planAudit && (
        <AuditPlanModal
          auditTitle={planAudit.title}
          frameworkName={planAudit.framework_id ?? ""}
          frameworkShortName=""
          auditScope={planAudit.scope ?? ""}
          auditObjective=""
          onClose={() => setPlanAudit(null)}
        />
      )}
    </div>
  );
}
