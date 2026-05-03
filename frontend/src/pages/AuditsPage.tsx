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

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  internal:      "bg-slate-100 text-slate-600",
  external:      "bg-violet-100 text-violet-700",
  certification: "bg-amber-100 text-amber-700",
  regulatory:    "bg-red-100 text-red-700",
};

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  planning:  { label: "Planning",  color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
  fieldwork: { label: "Fieldwork", color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
  review:    { label: "Review",    color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  reporting: { label: "Reporting", color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  closed:    { label: "Closed",    color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
};

// ── New Audit Modal ───────────────────────────────────────────────────────────

function NewAuditModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: "", audit_type: "internal", status: "planning",
    planned_start: "", planned_end: "", scope: "", lead_auditor: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required"); return; }
    if (!form.planned_start || !form.planned_end) { setError("Start and end dates are required"); return; }
    setSubmitting(true);
    setError("");
    try {
      await auditsApi.create({
        title: form.title.trim(),
        audit_type: form.audit_type as "internal" | "external" | "regulatory" | "certification",
        planned_start: form.planned_start,
        planned_end: form.planned_end,
        scope: form.scope.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch {
      setError("Failed to create audit — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

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
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Title *</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. ISO 27001 External Audit Q2 2026"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Type</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.audit_type} onChange={e => setForm(f => ({ ...f, audit_type: e.target.value }))}>
                <option value="internal">Internal</option>
                <option value="external">External</option>
                <option value="certification">Certification</option>
                <option value="regulatory">Regulatory</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Status</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Start Date *</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">End Date *</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.planned_end} onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Scope</label>
            <textarea rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Systems, processes, and locations in scope..."
              value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Audit
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
    if (!auditorId) { setError("Select an auditor."); return; }
    if (selectedIds.size === 0) { setError("Select at least one assessment."); return; }
    setSubmitting(true);
    setError("");
    let anyFailed = false;
    try {
      for (const assessmentId of selectedIds) {
        try {
          await usersApi.assignAuditor(auditorId, assessmentId);
        } catch (err: any) {
          // skip "already assigned" silently, surface other errors
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
      if (anyFailed) setError("One or more assignments failed.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-600" /> Assign Auditor to Assessments
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            {/* Auditor selector */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Auditor</label>
              {auditors.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No auditor accounts yet — create one first.</p>
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

            {/* Multi-select assessment checklist */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Compliance Assessments
                </label>
                {selectedIds.size > 0 && (
                  <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                    {selectedIds.size} selected
                  </span>
                )}
              </div>
              {assessments.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No assessments found — create one in Compliance first.</p>
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
              The auditor will be able to log in and see all selected assessments' controls, company policies, and record their verdicts.
            </div>
          </div>

          <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !auditorId || selectedIds.size === 0}
              className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? "Assigning…" : `Assign${selectedIds.size > 1 ? ` (${selectedIds.size})` : ""}`}
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

  // Tab: "audits" | "auditors"
  const [tab, setTab] = useState<"audits" | "auditors">("audits");

  // Audits
  const [audits, setAudits]     = useState<any[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(true);

  // Auditors
  const [auditors, setAuditors]         = useState<AuditorUser[]>([]);
  const [assignments, setAssignments]   = useState<AuditorAssignmentRecord[]>([]);
  const [assessments, setAssessments]   = useState<any[]>([]);
  const [loadingAuditors, setLoadingAuditors] = useState(true);

  // Modals
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
    if (!confirm("Remove this auditor assignment?")) return;
    try {
      await usersApi.unassignAuditor(assignmentId);
      setAssignments(prev => prev.filter(a => a.id !== assignmentId));
    } catch {
      setNotice("Failed to remove assignment.");
    }
  }

  async function handleDeleteAuditor(auditorId: string) {
    setDeletingAuditorId(auditorId);
    try {
      await usersApi.deleteAuditor(auditorId);
      setAuditors(prev => prev.filter(a => a.id !== auditorId));
      setAssignments(prev => prev.filter(a => a.auditor_id !== auditorId));
    } catch {
      setNotice("Failed to delete auditor account.");
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
            {audits.length} audits · {activeAudits.length} active · {auditors.length} auditor{auditors.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateAuditor(true)}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Add Auditor
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Audit
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
        {(["audits", "auditors"] as const).map(t2 => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize flex items-center gap-1.5 ${
              tab === t2 ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t2 === "audits" ? <ClipboardList className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            {t2 === "audits" ? "Audits" : "Auditor Accounts"}
            <span className="ml-1 text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">
              {t2 === "audits" ? audits.length : auditors.length}
            </span>
          </button>
        ))}
      </div>

      {/* ── AUDITS TAB ── */}
      {tab === "audits" && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Active Audits",  value: activeAudits.length,  sub: "In progress" },
              { label: "Closed Audits",  value: closedAudits.length,  sub: "Completed" },
              { label: "Total Findings", value: audits.reduce((s, a) => s + (a.finding_count || 0), 0), sub: "Across all audits" },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Audit list */}
          {loadingAudits ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : audits.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
              <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">No audits yet</p>
              <p className="text-xs text-gray-400 mt-1">Click <strong>New Audit</strong> to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {audits.map((audit: any) => {
                const st = STATUS_CFG[audit.status] ?? STATUS_CFG.planning;
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
                              <Tag className="w-2.5 h-2.5 inline mr-1" />{audit.audit_type}
                            </span>
                            {audit.planned_start && (
                              <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Calendar className="w-3 h-3" />
                                {audit.planned_start} → {audit.planned_end}
                              </span>
                            )}
                            {audit.finding_count > 0 && (
                              <span className="flex items-center gap-1 text-xs text-orange-600 font-medium">
                                <AlertTriangle className="w-3 h-3" />{audit.finding_count} finding{audit.finding_count !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          {audit.scope && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{audit.scope}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${st.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
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
                    <Users className="w-4 h-4 text-purple-600" /> Auditor Accounts
                  </h2>
                  <button
                    onClick={() => setShowCreateAuditor(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Create Auditor
                  </button>
                </div>
                {auditors.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No auditor accounts yet.</p>
                    <p className="text-xs text-gray-400 mt-1">Create an account and share the credentials with your external auditor.</p>
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
                          {a.is_active ? "Active" : "Inactive"}
                        </span>
                        {confirmDeleteAuditorId === a.id ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs text-red-600 font-medium">Delete account?</span>
                            <button
                              onClick={() => handleDeleteAuditor(a.id)}
                              disabled={deletingAuditorId === a.id}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {deletingAuditorId === a.id ? "Deleting…" : "Yes, delete"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteAuditorId(null)}
                              className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md hover:bg-gray-200 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteAuditorId(a.id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            title="Delete auditor account"
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
                    <Shield className="w-4 h-4 text-blue-600" /> Assessment Assignments
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadAuditors()}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Refresh"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setShowAssign(true)}
                      disabled={auditors.length === 0 || assessments.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Assign Auditor
                    </button>
                  </div>
                </div>
                {assignments.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <Shield className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No assignments yet.</p>
                    <p className="text-xs text-gray-400 mt-1">Assign an auditor to a compliance assessment so they can review controls.</p>
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
                          <p className="text-xs text-gray-400">Assessment</p>
                        </div>
                        <button
                          onClick={() => handleUnassign(a.id)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove assignment"
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
                  <Sparkles className="w-4 h-4" /> How auditors log in
                </h3>
                <ol className="text-xs text-purple-700 space-y-1.5 list-decimal list-inside">
                  <li>Create an auditor account with <strong>Create Auditor</strong> above</li>
                  <li>Assign them to the compliance assessment they need to review</li>
                  <li>Share the login URL and credentials with your auditor</li>
                  <li>The auditor logs in at <strong>/login</strong> and lands on the <strong>Auditor Portal</strong></li>
                  <li>They can review each control, record verdicts, and generate an AI audit report</li>
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
            setTab("auditors"); // switch to auditors tab so user sees the new account
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
