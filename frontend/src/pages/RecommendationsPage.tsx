/**
 * RecommendationsPage — objectif 7, « Suivi des recommandations ».
 *
 * The three buckets the tender names — en attente / en cours / clôturées — with
 * their counts, the responsable, the date d'échéance with the overdue rows
 * called out, and the progression rolled up from the action items attached to
 * each recommendation's finding. « Clôture effective » is a deliberate act with
 * a note behind it, never a status typed into a field.
 *
 * The page is created here but NOT routed here: see needs_integration.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Loader2, RefreshCw, X, CheckCircle, Clock, AlertTriangle, ListChecks,
  Pencil, Trash2, ShieldCheck, ExternalLink, Filter, ListPlus,
} from "lucide-react";
import { auditsApi, usersApi, complianceApi } from "@/api/endpoints";
import { useAuthStore, hasAnyRole } from "@/store/auth";
import type { AuditRecommendation, AuditRecommendationSummary } from "@/types";

const BUCKETS = ["pending", "in_progress", "closed"] as const;
type Bucket = typeof BUCKETS[number];

const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  closed:      "bg-green-100 text-green-700",
  rejected:    "bg-slate-100 text-slate-600",
  overdue:     "bg-red-100 text-red-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high:     "bg-orange-100 text-orange-700",
  medium:   "bg-yellow-100 text-yellow-700",
  low:      "bg-slate-100 text-slate-600",
};

const PRIORITIES = ["critical", "high", "medium", "low"] as const;

interface DirectoryEntry { id: string; name: string }

function daysBetween(dateIso: string, todayIso: string): number {
  const a = new Date(dateIso).getTime();
  const b = new Date(todayIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ── Close a recommendation ────────────────────────────────────────────────────

function CloseRecommendationModal({
  recommendation, onClose, onSaved,
}: {
  readonly recommendation: AuditRecommendation;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"closed" | "rejected">("closed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) { setError(t("recommendations.close_note_required")); return; }
    setSaving(true);
    setError("");
    try {
      await auditsApi.closeRecommendation(recommendation.id, { closure_note: note.trim(), status });
      onSaved();
      onClose();
    } catch {
      setError(t("recommendations.error_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-green-600" /> {t("recommendations.close")}
          </h2>
          <button type="button" onClick={onClose} title={t("common.close")} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <p className="text-sm text-gray-600">{recommendation.title}</p>

          <div>
            <label htmlFor="rc-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.status")}</label>
            <select id="rc-status" value={status} onChange={(e) => setStatus(e.target.value as "closed" | "rejected")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="closed">{t("recommendations.statuses.closed")}</option>
              <option value="rejected">{t("recommendations.statuses.rejected")}</option>
            </select>
          </div>

          <div>
            <label htmlFor="rc-note" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {t("recommendations.close_note")} *
            </label>
            <textarea id="rc-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("recommendations.close_note_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("recommendations.close")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit a recommendation ─────────────────────────────────────────────────────

function EditRecommendationModal({
  recommendation, directory, onClose, onSaved,
}: {
  readonly recommendation: AuditRecommendation;
  readonly directory: DirectoryEntry[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: recommendation.title,
    description: recommendation.description ?? "",
    ref_code: recommendation.ref_code ?? "",
    priority: recommendation.priority ?? "medium",
    status: recommendation.status,
    owner_id: recommendation.owner_id ?? "",
    due_date: recommendation.due_date ?? "",
    progress: recommendation.progress ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("recommendations.error_save_failed")); return; }
    setSaving(true);
    setError("");
    try {
      await auditsApi.updateRecommendation(recommendation.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        ref_code: form.ref_code.trim() || null,
        priority: form.priority || null,
        // "closed" and "rejected" are set through the closure route, which
        // records the note that justifies them.
        status: form.status === "closed" || form.status === "rejected" ? undefined : form.status,
        owner_id: form.owner_id || null,
        due_date: form.due_date || null,
        progress: Number(form.progress) || 0,
      });
      onSaved();
      onClose();
    } catch {
      setError(t("recommendations.error_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{t("recommendations.edit")}</h2>
          <button type="button" onClick={onClose} title={t("common.close")} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label htmlFor="er-ref" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.ref")}</label>
              <input id="er-ref" value={form.ref_code} onChange={(e) => setForm((f) => ({ ...f, ref_code: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-3">
              <label htmlFor="er-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.recommendation")} *</label>
              <input id="er-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t("recommendations.recommendation_placeholder")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label htmlFor="er-desc" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.description")}</label>
            <textarea id="er-desc" rows={3} value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label htmlFor="er-priority" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.priority")}</label>
              <select id="er-priority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {PRIORITIES.map((p) => <option key={p} value={p}>{t(`audits.finding_${p}`, p)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="er-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.status")}</label>
              <select id="er-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {(["pending", "in_progress", "closed", "rejected"] as const).map((s) => (
                  <option key={s} value={s} disabled={s === "closed" || s === "rejected"}>
                    {t(`recommendations.statuses.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="er-owner" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.owner")}</label>
              <select id="er-owner" value={form.owner_id} onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t("common.none")}</option>
                {directory.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="er-due" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.due_date")}</label>
              <input id="er-due" type="date" value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label htmlFor="er-progress" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {t("recommendations.progress")} — {form.progress}%
            </label>
            <input id="er-progress" type="range" min={0} max={100} step={5} value={form.progress}
              onChange={(e) => setForm((f) => ({ ...f, progress: Number(e.target.value) }))}
              className="w-full accent-blue-600" />
            <p className="text-xs text-gray-400 mt-1">{t("recommendations.rollup_hint")}</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/** Plan an action that answers a recommendation (R2 6.1). The backend links it
 *  to the recommendation's finding, so the finding roll-up and the audit report's
 *  « plan d'action » section both see it. */
function AddActionModal({ rec, onClose, onCreated }: {
  readonly rec: AuditRecommendation; readonly onClose: () => void; readonly onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(rec.title);
  const [due, setDue] = useState(rec.due_date ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setError("");
    try {
      await complianceApi.createActionPlanItem({
        title: title.trim(), due_date: due || null, recommendation_id: rec.id, action_type: "corrective",
      });
      onCreated();
      onClose();
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : t("r2.audits.add_action_failed"));
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{t("r2.audits.add_action_title")}</h3>
          <button type="button" onClick={onClose} title={t("common.close")} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500">{t("r2.audits.add_action_hint")}</p>
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div>
          <label htmlFor="ra-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("r2.audits.action_title")} *</label>
          <input id="ra-title" value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label htmlFor="ra-due" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("r2.audits.action_due")}</label>
          <input id="ra-due" type="date" value={due} onChange={(e) => setDue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
          <button type="submit" disabled={busy || !title.trim()}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("r2.audits.add_action")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RecommendationsPage() {
  const { t } = useTranslation();
  // POST /compliance/action-plan is CISO-only (admins auto-pass).
  const canPlanAction = hasAnyRole(useAuthStore((u) => u), ["ciso", "tenant_admin", "super_admin"]);
  const [addingAction, setAddingAction] = useState<AuditRecommendation | null>(null);

  const [rows, setRows] = useState<AuditRecommendation[]>([]);
  const [summary, setSummary] = useState<AuditRecommendationSummary | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [rollingUp, setRollingUp] = useState(false);

  const [statusFilter, setStatusFilter] = useState<Bucket | "">("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [auditFilter, setAuditFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [closing, setClosing] = useState<AuditRecommendation | null>(null);
  const [editing, setEditing] = useState<AuditRecommendation | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, sum] = await Promise.allSettled([
      auditsApi.listRecommendations({
        status_filter: statusFilter || undefined,
        owner_id: ownerFilter || undefined,
        audit_id: auditFilter || undefined,
        overdue: overdueOnly || undefined,
        limit: 500,
      }),
      auditsApi.recommendationsSummary(),
    ]);
    if (list.status === "fulfilled") setRows(list.value);
    else { setRows([]); setNotice(t("recommendations.load_error")); }
    if (sum.status === "fulfilled") setSummary(sum.value);
    setLoading(false);
  }, [statusFilter, ownerFilter, auditFilter, overdueOnly, t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function loadDirectory() {
      try {
        const users = await usersApi.directory();
        if (!cancelled) {
          setDirectory(users.map((u) => ({
            id: u.id,
            name: `${u.first_name} ${u.last_name}`.trim() || u.email,
          })));
        }
      } catch {
        // GET /users is administrator-only: without it the owner picker simply
        // falls back to the names the recommendations already carry.
      }
    }
    loadDirectory();
    return () => { cancelled = true; };
  }, []);

  const auditOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.audit_id && !seen.has(r.audit_id)) seen.set(r.audit_id, r.audit_title || r.audit_id);
    return Array.from(seen, ([id, title]) => ({ id, title }));
  }, [rows]);

  const ownerOptions = useMemo(() => {
    if (directory.length > 0) return directory;
    const seen = new Map<string, string>();
    for (const r of rows) if (r.owner_id && !seen.has(r.owner_id)) seen.set(r.owner_id, r.owner_name || r.owner_id);
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [directory, rows]);

  const counts = useMemo(() => ({
    total:       summary?.total ?? rows.length,
    pending:     summary?.pending ?? rows.filter((r) => r.status === "pending").length,
    in_progress: summary?.in_progress ?? rows.filter((r) => r.status === "in_progress").length,
    closed:      summary?.closed ?? rows.filter((r) => r.status === "closed").length,
    overdue:     summary?.overdue ?? rows.filter((r) => r.is_overdue).length,
    avg:         summary?.avg_progress ?? 0,
  }), [summary, rows]);

  const closureRate = counts.total > 0 ? Math.round((counts.closed * 100) / counts.total) : 0;

  async function runRollup() {
    setRollingUp(true);
    setNotice("");
    try {
      const result = await auditsApi.rollupRecommendations();
      const updated = Number((result as { recommendations_updated?: number })?.recommendations_updated ?? 0);
      setNotice(t("recommendations.rollup_done", { count: updated }));
      await load();
    } catch {
      setNotice(t("recommendations.error_save_failed"));
    } finally {
      setRollingUp(false);
    }
  }

  async function remove(id: string) {
    try {
      await auditsApi.deleteRecommendation(id);
      setConfirmDelete(null);
      await load();
    } catch {
      setNotice(t("recommendations.error_save_failed"));
    }
  }

  const BUCKET_META: Record<Bucket, { label: string; sub: string; value: number; icon: typeof Clock; tone: string }> = {
    pending:     { label: t("recommendations.stat_pending"),     sub: t("recommendations.stat_pending_sub"),     value: counts.pending,     icon: Clock,       tone: "text-gray-500" },
    in_progress: { label: t("recommendations.stat_in_progress"), sub: t("recommendations.stat_in_progress_sub"), value: counts.in_progress, icon: ListChecks,  tone: "text-blue-600" },
    closed:      { label: t("recommendations.stat_closed"),      sub: t("recommendations.stat_closed_sub"),      value: counts.closed,      icon: CheckCircle, tone: "text-green-600" },
  };

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("recommendations.title")}</h1>
          <p className="text-gray-500 text-sm mt-1">{t("recommendations.subtitle")}</p>
        </div>
        <button type="button" onClick={runRollup} disabled={rollingUp}
          title={t("recommendations.rollup_hint")}
          className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          {rollingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {t("recommendations.rollup")}
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} title={t("common.close")}>
            <X className="w-4 h-4 opacity-50 hover:opacity-100" />
          </button>
        </div>
      )}

      {/* Buckets — en attente / en cours / clôturées */}
      <div className="grid grid-cols-5 gap-4">
        {BUCKETS.map((bucket) => {
          const meta = BUCKET_META[bucket];
          const active = statusFilter === bucket;
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => setStatusFilter(active ? "" : bucket)}
              className={`text-start bg-white rounded-2xl border shadow-sm p-5 transition-all ${
                active ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-100 hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-2xl font-bold text-gray-900">{meta.value}</p>
                <meta.icon className={`w-5 h-5 ${meta.tone}`} />
              </div>
              <p className="text-sm font-medium text-gray-600 mt-0.5">{meta.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{meta.sub}</p>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setOverdueOnly((v) => !v)}
          className={`text-start bg-white rounded-2xl border shadow-sm p-5 transition-all ${
            overdueOnly ? "border-red-400 ring-2 ring-red-100" : "border-gray-100 hover:shadow-md"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold text-red-600">{counts.overdue}</p>
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-sm font-medium text-gray-600 mt-0.5">{t("recommendations.stat_overdue")}</p>
          <p className="text-xs text-gray-400 mt-0.5">{t("recommendations.stat_overdue_sub")}</p>
        </button>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-2xl font-bold text-gray-900">{closureRate}%</p>
          <p className="text-sm font-medium text-gray-600 mt-0.5">{t("recommendations.stat_closure_rate")}</p>
          <p className="text-xs text-gray-400 mt-0.5">{t("recommendations.stat_closure_rate_sub")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Bucket | "")}
            title={t("recommendations.filter_status")}
          >
            <option value="">{t("recommendations.all_statuses")}</option>
            {BUCKETS.map((b) => <option key={b} value={b}>{t(`recommendations.statuses.${b}`)}</option>)}
          </select>
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
            title={t("recommendations.filter_owner")}
          >
            <option value="">{t("recommendations.all_owners")}</option>
            {ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)}
            title={t("recommendations.filter_audit")}
          >
            <option value="">{t("recommendations.all_audits")}</option>
            {auditOptions.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer px-2">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)}
              className="w-3.5 h-3.5 accent-red-500" />
            {t("recommendations.filter_overdue")}
          </label>
          {(statusFilter || ownerFilter || auditFilter || overdueOnly) && (
            <button type="button"
              onClick={() => { setStatusFilter(""); setOwnerFilter(""); setAuditFilter(""); setOverdueOnly(false); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg">
              <Filter className="w-3.5 h-3.5" /> {t("activity_log.clear_filters")}
            </button>
          )}
          <button type="button" onClick={() => load()} title={t("common.refresh")}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors ms-auto">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <CheckCircle className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500">{t("recommendations.empty_title")}</p>
          <p className="text-xs text-gray-400 mt-1">{t("recommendations.empty_hint")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-start px-5 py-3 font-medium text-gray-500">{t("recommendations.ref")}</th>
                  <th className="text-start px-3 py-3 font-medium text-gray-500">{t("recommendations.recommendation")}</th>
                  <th className="text-start px-3 py-3 font-medium text-gray-500">{t("recommendations.audit")}</th>
                  <th className="text-start px-3 py-3 font-medium text-gray-500">{t("recommendations.owner")}</th>
                  <th className="text-start px-3 py-3 font-medium text-gray-500">{t("recommendations.due_date")}</th>
                  <th className="text-start px-3 py-3 font-medium text-gray-500">{t("recommendations.progress")}</th>
                  <th className="text-start px-3 py-3 font-medium text-gray-500">{t("recommendations.status")}</th>
                  <th className="text-end px-5 py-3 font-medium text-gray-500">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late = r.is_overdue || (!!r.due_date && r.due_date < today && r.status !== "closed" && r.status !== "rejected");
                  const lateDays = r.due_date && late ? daysBetween(r.due_date, today) : 0;
                  const terminal = r.status === "closed" || r.status === "rejected";
                  return (
                    <tr key={r.id} className={`border-b border-gray-50 transition-colors ${late ? "bg-red-50/40" : "hover:bg-gray-50/50"}`}>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">{r.ref_code || "—"}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-72">{r.title}</p>
                        {r.description && <p className="text-xs text-gray-400 truncate max-w-72">{r.description}</p>}
                        {r.priority && (
                          <span className={`inline-flex mt-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[r.priority] ?? "bg-gray-100 text-gray-600"}`}>
                            {t(`audits.finding_${r.priority}`, r.priority)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600">
                        <Link to={`/audits/${r.audit_id}`} className="inline-flex items-center gap-1 hover:text-blue-600">
                          <span className="truncate max-w-40">{r.audit_title || r.audit_id}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600 truncate max-w-36">
                        {r.owner_name || (r.owner_id ? directory.find((d) => d.id === r.owner_id)?.name ?? r.owner_id : "—")}
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        <span className={late ? "text-red-600 font-medium" : "text-gray-600"}>{r.due_date || "—"}</span>
                        {late && lateDays > 0 && (
                          <span className="block text-xs text-red-500">{t("recommendations.days_late", { count: lateDays })}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="w-28">
                          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                            <span>{r.progress}%</span>
                            <span className="text-gray-400">{r.action_items_done ?? 0}/{r.action_items_total ?? 0}</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${late ? "bg-red-500" : "bg-blue-500"}`}
                              style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {t(`recommendations.statuses.${r.status}`, r.status)}
                        </span>
                        {late && (
                          <span className="ms-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                            {t("recommendations.overdue_badge")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {!terminal && canPlanAction && (
                            <button type="button" onClick={() => setAddingAction(r)} title={t("r2.audits.add_action")}
                              aria-label={t("r2.audits.add_action")}
                              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                              <ListPlus className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!terminal && (
                            <button type="button" onClick={() => setClosing(r)} title={t("recommendations.close")}
                              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button type="button" onClick={() => setEditing(r)} title={t("common.edit")}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {confirmDelete === r.id ? (
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => remove(r.id)}
                                className="px-2 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700">
                                {t("audits.yes_delete")}
                              </button>
                              <button type="button" onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md hover:bg-gray-200">
                                {t("common.cancel")}
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setConfirmDelete(r.id)} title={t("recommendations.delete")}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By owner — « qui porte quoi » */}
      {summary && (summary.by_owner?.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">{t("recommendations.by_owner")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-start px-3 py-2 font-medium text-gray-500">{t("recommendations.owner")}</th>
                  <th className="text-start px-3 py-2 font-medium text-gray-500">{t("recommendations.stat_total")}</th>
                  <th className="text-start px-3 py-2 font-medium text-gray-500">{t("recommendations.stat_in_progress")}</th>
                  <th className="text-start px-3 py-2 font-medium text-gray-500">{t("recommendations.stat_overdue")}</th>
                </tr>
              </thead>
              <tbody>
                {(summary.by_owner ?? []).map((raw, index) => {
                  const row = raw as { owner_id?: string; owner_name?: string; total?: number; open?: number; overdue?: number };
                  return (
                    <tr key={row.owner_id ?? `owner-${index}`} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-xs text-gray-700">
                        {row.owner_name || (row.owner_id ? directory.find((d) => d.id === row.owner_id)?.name ?? row.owner_id : t("common.none"))}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{row.total ?? 0}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{row.open ?? 0}</td>
                      <td className="px-3 py-2 text-xs text-red-600">{row.overdue ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addingAction && (
        <AddActionModal rec={addingAction} onClose={() => setAddingAction(null)}
          onCreated={() => { setNotice(t("r2.audits.action_added")); load(); }} />
      )}
      {closing && (
        <CloseRecommendationModal
          recommendation={closing}
          onClose={() => setClosing(null)}
          onSaved={load}
        />
      )}

      {editing && (
        <EditRecommendationModal
          recommendation={editing}
          directory={ownerOptions}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
