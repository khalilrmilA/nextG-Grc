import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  FileText, Plus, CheckCircle, Clock, AlertCircle, Calendar, Link2, X,
  ChevronRight, Wand2, Trash2, Search, Download, Send, History,
  Edit3, AlertTriangle, Users, Sparkles, StopCircle, Loader2, Save, BookOpen,
} from "lucide-react";
import { policiesApi, usersApi, aiApi, assetGraphApi, frameworksApi, type PolicyVersion, type PolicyAttestation } from "../api/endpoints";
import type { Policy, PolicyLinkedControl, PolicyReview, Framework, FrameworkControl } from "../types";
import i18n from "../i18n";
import { useAuthStore, hasAnyRole, currentUserId } from "../store/auth";

// POST/PATCH/DELETE /policies, versions, approve, attestations: policy_manager + CISO.
const POLICY_WRITE_ROLES = ["policy_manager", "ciso", "tenant_admin", "super_admin"];

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  Security:          "bg-blue-50 text-blue-700",
  HR:                "bg-pink-50 text-pink-700",
  "Data Governance": "bg-emerald-50 text-emerald-700",
  "Vendor Risk":     "bg-orange-50 text-orange-700",
  "BCP / DR":        "bg-purple-50 text-purple-700",
};

const CATEGORY_OPTIONS = ["Security", "HR", "Data Governance", "Vendor Risk", "BCP / DR", "Legal & Compliance", "Privacy", "Physical Security"];
/** Category VALUES are stored as-is on the policy (English); only their display label is translated. */
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  Security:             "policies_ui.categories.security",
  HR:                   "policies_ui.categories.hr",
  "Data Governance":    "policies_ui.categories.data_governance",
  "Vendor Risk":        "policies_ui.categories.vendor_risk",
  "BCP / DR":           "policies_ui.categories.bcp_dr",
  "Legal & Compliance": "policies_ui.categories.legal_compliance",
  Privacy:              "policies_ui.categories.privacy",
  "Physical Security":  "policies_ui.categories.physical_security",
};
function categoryLabel(cat: string | null | undefined): string {
  if (!cat) return "—";
  const key = CATEGORY_LABEL_KEYS[cat];
  return key ? i18n.t(key) : cat;
}
/** Display locale for dates: Latin digits in Arabic, French day-month order in French. */
const dateLocale = (lang: string) => (lang?.startsWith("fr") ? "fr-FR" : lang?.startsWith("ar") ? "ar-u-nu-latn" : "en-US");

const STATUS_KEYS = ["draft", "in_review", "approved", "published", "retired"];
const REVIEW_FREQUENCIES = [
  { value: 6,  labelKey: "policies.review_6mo"  },
  { value: 12, labelKey: "policies.review_12mo" },
  { value: 24, labelKey: "policies.review_24mo" },
];

type TenantUser = { id: string; first_name: string; last_name: string; email: string };

function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

/** Only a published policy is reviewed periodically — the backend says when one is due. */
function reviewDue(p: Policy): boolean {
  return p.review_due ?? (p.status === "published" && isOverdue(p.next_review_date));
}

/** today + n months, as the backend computes it (day clamped to the month's end). */
function addMonthsIso(months: number): string {
  const d = new Date();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function apiError(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof msg === "string" ? msg : fallback;
}

// ── New Policy Modal ──────────────────────────────────────────────────────────

function NewPolicyModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: (p: Policy) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: "", category: "Security", status: "draft", review_months: 12, description: "",
    effective_date: "", expiration_date: "", business_process_id: "", org_entity_id: "",
  });
  const [error, setError]   = useState("");
  const [saving, setSaving] = useState(false);
  const [entities, setEntities] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);

  useEffect(() => {
    Promise.allSettled([assetGraphApi.listEntities(), assetGraphApi.listProcesses()]).then(([e, p]) => {
      setEntities(e.status === "fulfilled" ? e.value : []);
      setProcesses(p.status === "fulfilled" ? p.value : []);
    });
  }, []);

  const STATUS_MAP: Record<string, { label: string }> = {
    draft:     { label: t("policies.draft")     },
    in_review: { label: t("policies.in_review") },
    approved:  { label: t("policies.approved")  },
    published: { label: t("policies.published") },
    retired:   { label: t("policies.retired")   },
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("policies.title_required")); return; }
    setSaving(true); setError("");
    try {
      const created = await policiesApi.create({
        title: form.title.trim(), category: form.category,
        status: form.status as Policy["status"], description: form.description.trim() || undefined,
        review_frequency_months: form.review_months,
        effective_date: form.effective_date || null, expiration_date: form.expiration_date || null,
        business_process_id: form.business_process_id || null, org_entity_id: form.org_entity_id || null,
      });
      onSaved(created); onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : t("common.error_generic"));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{t("policies.new_policy")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label htmlFor="pol-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.policy_title_label")} *</label>
            <input id="pol-title" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("policies.policy_title_placeholder")}
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pol-category" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.category_label")}</label>
              <select id="pol-category" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{categoryLabel(o)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pol-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.status_label")}</label>
              <select id="pol-status" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {/* Approval needs a second person, so a new policy starts as draft or in review. */}
                {STATUS_KEYS.filter(o => o === "draft" || o === "in_review").map(o => <option key={o} value={o}>{STATUS_MAP[o]?.label ?? o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="pol-review" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.review_cycle")}</label>
            <select id="pol-review" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={form.review_months} onChange={e => setForm(f => ({ ...f, review_months: +e.target.value }))}>
              {REVIEW_FREQUENCIES.map(r => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pol-desc" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.description")}</label>
            <textarea id="pol-desc" rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("policies.description_placeholder")}
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pol-effective" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.effective_date_label", "Effective Date")}</label>
              <input id="pol-effective" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="pol-expiration" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.expiration_date_label", "Expiration Date")}</label>
              <input id="pol-expiration" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.expiration_date} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pol-process" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.business_process_label", "Business Process")}</label>
              <select id="pol-process" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.business_process_id} onChange={e => setForm(f => ({ ...f, business_process_id: e.target.value }))}>
                <option value="">{t("policies.no_process", "None")}</option>
                {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pol-entity" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.org_entity_label", "Org Entity")}</label>
              <select id="pol-entity" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.org_entity_id} onChange={e => setForm(f => ({ ...f, org_entity_id: e.target.value }))}>
                <option value="">{t("policies.no_entity", "None")}</option>
                {entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium transition-colors">
              {saving ? t("common.saving") : t("policies.create_policy")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Policy Details Modal ─────────────────────────────────────────────────
// PATCH without `status`: the workflow moves stay on their own buttons.

const EDIT_FREQUENCIES = [3, 6, 12, 24, 36];

function EditPolicyModal({ policy, users, onClose, onSaved }: {
  readonly policy: Policy;
  readonly users: TenantUser[];
  readonly onClose: () => void;
  readonly onSaved: (p: Policy) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: policy.title, description: policy.description ?? "", category: policy.category ?? "",
    owner_id: policy.owner_id ?? "", review_frequency_months: policy.review_frequency_months || 12,
    next_review_date: policy.next_review_date?.slice(0, 10) ?? "",
    effective_date: policy.effective_date ?? "", expiration_date: policy.expiration_date ?? "",
    business_process_id: policy.business_process_id ?? "", org_entity_id: policy.org_entity_id ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [entities, setEntities] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);

  useEffect(() => {
    Promise.allSettled([assetGraphApi.listEntities(), assetGraphApi.listProcesses()]).then(([e, p]) => {
      setEntities(e.status === "fulfilled" ? e.value : []);
      setProcesses(p.status === "fulfilled" ? p.value : []);
    });
  }, []);

  const frequencies = EDIT_FREQUENCIES.includes(form.review_frequency_months)
    ? EDIT_FREQUENCIES : [...EDIT_FREQUENCIES, form.review_frequency_months].sort((a, b) => a - b);
  const categories = form.category && !CATEGORY_OPTIONS.includes(form.category)
    ? [...CATEGORY_OPTIONS, form.category] : CATEGORY_OPTIONS;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: k === "review_frequency_months" ? +e.target.value : e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("policies.title_required")); return; }
    setSaving(true); setError("");
    // "" clears an optional field; an untouched review date is not re-sent, so it
    // does not become "hand-set" just because the form was saved.
    const original = policy.next_review_date?.slice(0, 10) ?? "";
    try {
      const updated = await policiesApi.update(policy.id, {
        title: form.title.trim(), description: form.description, category: form.category,
        owner_id: form.owner_id || undefined, review_frequency_months: form.review_frequency_months,
        ...(form.next_review_date !== original ? { next_review_date: form.next_review_date } : {}),
        effective_date: form.effective_date, expiration_date: form.expiration_date,
        business_process_id: form.business_process_id, org_entity_id: form.org_entity_id,
      });
      onSaved(updated); onClose();
    } catch (err: unknown) {
      setError(apiError(err, t("r2b.policies.error_save")));
    } finally { setSaving(false); }
  }

  const label = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1";
  const input = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{t("r2b.policies.edit_title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label htmlFor="ed-title" className={label}>{t("policies.policy_title_label")} *</label>
            <input id="ed-title" className={input} value={form.title} onChange={set("title")} />
          </div>
          <div>
            <label htmlFor="ed-desc" className={label}>{t("common.description")}</label>
            <textarea id="ed-desc" rows={3} className={`${input} resize-none`} value={form.description} onChange={set("description")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ed-category" className={label}>{t("policies.category_label")}</label>
              <select id="ed-category" className={input} value={form.category} onChange={set("category")}>
                <option value="">{t("r2.common.none")}</option>
                {categories.map(o => <option key={o} value={o}>{categoryLabel(o)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ed-owner" className={label}>{t("r2b.policies.owner")}</label>
              <select id="ed-owner" className={input} value={form.owner_id} onChange={set("owner_id")}>
                {!form.owner_id && <option value="">{t("r2.common.none")}</option>}
                {users.map(u => <option key={u.id} value={u.id}>{`${u.first_name} ${u.last_name}`.trim() || u.email}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ed-cycle" className={label}>{t("policies.review_cycle")}</label>
              <select id="ed-cycle" className={input} value={form.review_frequency_months} onChange={set("review_frequency_months")}>
                {frequencies.map(n => <option key={n} value={n}>{t("policies_ui.review_months", { n })}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ed-next" className={label}>{t("r2b.policies.next_review")}</label>
              <input id="ed-next" type="date" className={input} value={form.next_review_date} onChange={set("next_review_date")} />
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">{t("r2b.policies.next_review_hint")}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ed-effective" className={label}>{t("policies.effective_date_label", "Effective Date")}</label>
              <input id="ed-effective" type="date" className={input} value={form.effective_date} onChange={set("effective_date")} />
            </div>
            <div>
              <label htmlFor="ed-expiration" className={label}>{t("policies.expiration_date_label", "Expiration Date")}</label>
              <input id="ed-expiration" type="date" className={input} value={form.expiration_date} onChange={set("expiration_date")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ed-process" className={label}>{t("policies.business_process_label", "Business Process")}</label>
              <select id="ed-process" className={input} value={form.business_process_id} onChange={set("business_process_id")}>
                <option value="">{t("policies.no_process", "None")}</option>
                {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ed-entity" className={label}>{t("policies.org_entity_label", "Org Entity")}</label>
              <select id="ed-entity" className={input} value={form.org_entity_id} onChange={set("org_entity_id")}>
                <option value="">{t("policies.no_entity", "None")}</option>
                {entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium transition-colors">
              {saving ? t("common.saving") : t("r2.common.save_changes")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Policy Detail Modal ───────────────────────────────────────────────────────

type DetailTab = "overview" | "content" | "controls" | "history" | "attestations";

// ── Policy ↔ requirement picker ───────────────────────────────────────────────
// « Politiques internes applicables à l'organisation » only means something if a
// policy can be attached to the requirement it covers. `linked_controls` existed
// on the model and only the AI generator ever wrote it; the UI read its count and
// offered no way to set it. This tab writes it (PATCH /policies/{id}) and reads
// the resolved refs back (GET /policies/{id}/controls).

function PolicyControlsTab({ policy, onSaved }: {
  readonly policy: Policy;
  readonly onSaved: (p: Policy) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PolicyLinkedControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [frameworkId, setFrameworkId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FrameworkControl[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    policiesApi.listLinkedControls(policy.id)
      .then(rows => { if (!cancelled) setEntries(rows); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [policy.id]);

  useEffect(() => {
    frameworksApi.list().then(setFrameworks).catch(() => setFrameworks([]));
  }, []);

  // Debounced search — the corpus is ~4 500 requirements, one keystroke must not
  // be one round-trip.
  useEffect(() => {
    const term = query.trim();
    if (!term && !frameworkId) { setResults([]); return; }
    const timer = setTimeout(() => {
      setSearching(true);
      frameworksApi.searchControls({
        ...(term ? { q: term } : {}),
        ...(frameworkId ? { framework_id: frameworkId } : {}),
        limit: 25,
      })
        .then(res => setResults(res.items ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [query, frameworkId]);

  function add(control: FrameworkControl) {
    setSaved(false);
    setEntries(prev => prev.some(e => e.id === control.id) ? prev : [...prev, {
      id: control.id,
      control_ref: control.control_id,
      title: control.title,
      framework_id: control.framework_id,
      framework_short_name: control.source_short_name ?? null,
      domain: control.domain ?? null,
      requirement_type: control.requirement_type ?? null,
    }]);
  }

  function remove(id: string) {
    setSaved(false);
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await policiesApi.setLinkedControls(policy.id, entries.map(e => e.id));
      onSaved(updated);
      setSaved(true);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("errors.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      {/* Currently linked */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {t("policies.linked_controls")}
          </p>
          <span className="text-xs text-gray-400">
            {t("policies.controls_mapped", { count: entries.length })}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-400">{t("framework_editor.no_controls")}</p>
        ) : (
          <div className="space-y-2">
            {entries.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-xl px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {e.control_ref}
                    </span>
                    <span className="text-sm font-medium text-gray-800 truncate">{e.title}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {e.framework_short_name ?? e.framework_name ?? ""}
                    {e.domain ? ` · ${e.domain}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => remove(e.id)}
                  className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg flex-shrink-0"
                  title={t("common.delete")}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Picker */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {t("framework_editor.controls_title")}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              placeholder={t("framework_editor.search_controls")}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <select
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            value={frameworkId}
            onChange={e => setFrameworkId(e.target.value)}
          >
            <option value="">{t("frameworks.all_frameworks")}</option>
            {frameworks.map(f => (
              <option key={f.id} value={f.id}>{f.short_name}</option>
            ))}
          </select>
        </div>

        {searching ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : results.length === 0 ? (
          <p className="text-xs text-gray-400">{t("framework_editor.no_controls_found")}</p>
        ) : (
          <div className="border border-gray-200 rounded-lg bg-white overflow-y-auto max-h-56 divide-y divide-gray-50">
            {results.map(c => {
              const already = entries.some(e => e.id === c.id);
              return (
                <button key={c.id} type="button" onClick={() => add(c)} disabled={already}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-white transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                      {c.control_id}
                    </span>
                    <span className="text-xs text-gray-800 line-clamp-1">{c.title}</span>
                    {already
                      ? <CheckCircle className="w-3.5 h-3.5 text-green-500 ml-auto flex-shrink-0" />
                      : <Plus className="w-3.5 h-3.5 text-blue-500 ml-auto flex-shrink-0" />}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {c.source_short_name ?? ""}{c.domain ? ` · ${c.domain}` : ""}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" /> {t("common.success")}
        </p>
      )}

      <button
        onClick={save}
        disabled={saving || loading}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? t("common.saving") : t("common.save")}
      </button>
    </div>
  );
}

function PolicyDetailModal({ policy, onClose, onStatusChange, onDelete, onUpdated, users }: {
  readonly policy: Policy;
  readonly onClose: () => void;
  readonly onStatusChange: (id: string, next: string) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onUpdated: (p: Policy) => void;
  readonly users: TenantUser[];
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DetailTab>("overview");
  const authUser = useAuthStore((u) => u);
  const canManage = hasAnyRole(authUser, POLICY_WRITE_ROLES);
  const myId = currentUserId(authUser);
  const [workflowError, setWorkflowError] = useState("");
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "retired">(null);
  const [approvingVer, setApprovingVer] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // periodic review
  const [reviews, setReviews] = useState<PolicyReview[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  // version state
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [loadingVer, setLoadingVer] = useState(false);
  const [expandedVer, setExpandedVer] = useState<string | null>(null);
  const [newContent, setNewContent] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [savingVer, setSavingVer] = useState(false);
  const [verError, setVerError] = useState("");
  const [restoringVer, setRestoringVer] = useState<string | null>(null);

  // attestation state
  const [attestations, setAttestations] = useState<PolicyAttestation[]>([]);
  const [loadingAtt, setLoadingAtt] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [sendingAtt, setSendingAtt] = useState(false);
  const [attError, setAttError] = useState("");

  // pdf
  const [exportingPdf, setExportingPdf] = useState(false);

  // ai generation
  const [aiGenerating, setAiGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const currentVersion = versions.find(v => v.is_current) ?? versions[0] ?? null;

  const loadVersions = useCallback(async () => {
    setLoadingVer(true);
    try { setVersions(await policiesApi.getVersions(policy.id)); }
    catch { /* ignore */ } finally { setLoadingVer(false); }
  }, [policy.id]);

  const loadAttestations = useCallback(async () => {
    setLoadingAtt(true);
    try { setAttestations(await policiesApi.listAttestations(policy.id)); }
    catch { /* ignore */ } finally { setLoadingAtt(false); }
  }, [policy.id]);

  const loadReviews = useCallback(async () => {
    try { setReviews(await policiesApi.listReviews(policy.id)); } catch { /* history is optional */ }
  }, [policy.id]);

  useEffect(() => { loadVersions(); loadAttestations(); loadReviews(); }, [loadVersions, loadAttestations, loadReviews]);
  // Acknowledgements happen elsewhere (My policies) — re-read when the tab opens.
  useEffect(() => { if (tab === "attestations") loadAttestations(); }, [tab, loadAttestations]);

  /** Status / allowed moves can change after a version is added, restored or approved. */
  async function refreshPolicy() {
    try { onUpdated(await policiesApi.get(policy.id)); } catch { /* keep what is on screen */ }
  }

  async function handleReview() {
    if (!reviewComment.trim()) { setReviewError(t("r2b.policies.comment_required")); return; }
    setSavingReview(true); setReviewError("");
    try {
      onUpdated(await policiesApi.review(policy.id, reviewComment.trim()));
      setReviewOpen(false); setReviewComment("");
      await loadReviews();
    } catch (err: unknown) {
      setReviewError(apiError(err, t("common.error_generic")));
    } finally { setSavingReview(false); }
  }

  async function moveTo(next: string) {
    setMovingTo(next); setWorkflowError("");
    try {
      await onStatusChange(policy.id, next);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setWorkflowError(typeof msg === "string" ? msg : t("common.error_generic"));
    } finally { setMovingTo(null); }
  }

  async function handleApproveVersion(v: PolicyVersion) {
    setApprovingVer(v.id); setVerError("");
    try {
      await policiesApi.approveVersion(policy.id, v.id);
      await loadVersions();
      await refreshPolicy();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setVerError(typeof msg === "string" ? msg : t("common.error_generic"));
    } finally { setApprovingVer(null); }
  }

  // When switching to content tab, pre-fill with current version
  useEffect(() => {
    if (tab === "content" && currentVersion) setNewContent(currentVersion.content);
  }, [tab, currentVersion]);

  async function handleRestoreVersion(v: PolicyVersion) {
    if (!policy) return;
    // Restoring appends rather than rewrites, so nothing is lost — say so, or
    // it reads like a destructive action and nobody uses it.
    const ok = window.confirm(
      t(
        "policies.restore_confirm",
        "Restore version {{num}} as the current version?\n\nA new version is created holding its content. Nothing is deleted — the version being replaced stays in the history.",
        { num: v.version_number },
      ),
    );
    if (!ok) return;
    setRestoringVer(v.id);
    setVerError("");
    try {
      await policiesApi.restorePolicyVersion(policy.id, v.id);
      await loadVersions();
      await refreshPolicy();
    } catch (err: any) {
      setVerError(
        err?.response?.data?.detail ??
          t("policies.restore_failed", "Could not restore that version."),
      );
    } finally {
      setRestoringVer(null);
    }
  }

  async function handleSaveVersion() {
    if (!newContent.trim()) return;
    setSavingVer(true); setVerError("");
    try {
      const v = await policiesApi.createVersion(policy.id, { content: newContent.trim(), change_summary: changeSummary.trim() || undefined });
      setVersions(prev => [v, ...prev.map(x => ({ ...x, is_current: false }))]);
      setChangeSummary("");
      // An approved/published policy goes back to review with its new text.
      await refreshPolicy();
    } catch { setVerError(t("common.error_generic")); }
    finally { setSavingVer(false); }
  }

  async function handleSendAttestation(userIds: string[]) {
    if (!userIds.length) return;
    setSendingAtt(true); setAttError("");
    try {
      // The server returns existing pending requests instead of duplicating them — re-read the list.
      await policiesApi.createAttestations(policy.id, { user_ids: userIds, due_date: dueDate || undefined });
      await loadAttestations();
      setSelectedUserIds([]); setDueDate("");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAttError(typeof msg === "string" ? msg : t("common.error_generic"));
    } finally { setSendingAtt(false); }
  }

  async function handleBulkAttest() {
    const allIds = users.map(u => u.id);
    await handleSendAttestation(allIds);
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const blob = await policiesApi.exportPdf(policy.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${policy.title.replace(/\s+/g, "_")}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ } finally { setExportingPdf(false); }
  }

  function handleAiGenerate() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAiGenerating(true);
    setNewContent("");
    setVerError("");
    const lang = i18n.language?.startsWith("ar") ? "ar" : i18n.language?.startsWith("fr") ? "fr" : undefined;
    aiApi.streamPolicyContent(
      { title: policy.title, category: policy.category ?? undefined, description: policy.description ?? undefined, language: lang },
      (token) => setNewContent(prev => prev + token),
      () => setAiGenerating(false),
      ctrl.signal,
    ).catch(() => setAiGenerating(false));
  }

  function handleAiStop() {
    abortRef.current?.abort();
    setAiGenerating(false);
  }

  const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
    draft:     { label: t("policies.draft"),     icon: Clock,        color: "bg-gray-100 text-gray-500"     },
    in_review: { label: t("policies.in_review"), icon: AlertCircle,  color: "bg-orange-100 text-orange-600" },
    approved:  { label: t("policies.approved"),  icon: CheckCircle,  color: "bg-blue-100 text-blue-600"     },
    published: { label: t("policies.published"), icon: CheckCircle,  color: "bg-green-100 text-green-600"   },
    retired:   { label: t("policies.retired"),   icon: Clock,        color: "bg-gray-100 text-gray-400"     },
  };

  // One button per move the backend allows from here (policy.allowed_transitions).
  const MOVE_CFG: Record<string, { label: string; color: string }> = {
    in_review: { label: policy.status === "draft" ? t("policies.submit_for_review") : t("r2.policies.back_to_review"), color: "bg-orange-500 hover:bg-orange-600 text-white" },
    approved:  { label: t("policies.approve"),  color: "bg-blue-600 hover:bg-blue-700 text-white" },
    published: { label: t("policies.publish"),  color: "bg-green-600 hover:bg-green-700 text-white" },
    draft:     { label: policy.status === "retired" ? t("r2.policies.revive") : t("r2.policies.back_to_draft"), color: "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50" },
    retired:   { label: t("r2.policies.retire"), color: "bg-white border border-red-200 text-red-700 hover:bg-red-50" },
  };
  const moves = (policy.allowed_transitions ?? []).slice().sort(
    (a, b) => ["in_review", "approved", "published", "draft", "retired"].indexOf(a) - ["in_review", "approved", "published", "draft", "retired"].indexOf(b));
  // Approval of the text gates approved/published — say why the button is missing.
  const awaitingVersionApproval = policy.status === "in_review" && !policy.current_version_approved;

  const s = STATUS_MAP[policy.status] ?? STATUS_MAP.draft;
  const StatusIcon = s.icon;
  const versionNum = typeof policy.version === "number" ? policy.version
    : (typeof policy.version === "string" ? parseInt(policy.version, 10) || 1 : 1);
  const owner = users.find(u => u.id === policy.owner_id);
  const userName = (id?: string | null) => {
    if (!id) return "—";
    const u = users.find(x => x.id === id);
    return u ? `${u.first_name} ${u.last_name}`.trim() || u.email : (id === myId ? t("r2.policies.you") : id.slice(0, 8));
  };
  const ownerName = owner ? `${owner.first_name} ${owner.last_name}`.trim() : null;

  // Mirrors create_attestations: approved/published, current version approved by a second person.
  const attestable = (policy.status === "approved" || policy.status === "published") && !!policy.current_version_approved;
  const attAcked = attestations.filter(a => a.status === "acknowledged").length;
  const attTotal = attestations.length;
  const attPct = attTotal > 0 ? Math.round((attAcked / attTotal) * 100) : 0;

  const TABS: { key: DetailTab; label: string; icon: typeof FileText }[] = [
    { key: "overview",     label: t("policies.tab_overview"),     icon: FileText  },
    { key: "content",      label: t("policies.tab_content"),      icon: Edit3     },
    { key: "controls",     label: t("policies.linked_controls"),  icon: BookOpen  },
    { key: "history",      label: t("policies.tab_history"),      icon: History   },
    { key: "attestations", label: t("policies.tab_attestations"), icon: Users     },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 bg-blue-50 rounded-t-2xl flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 leading-snug">{policy.title}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${CAT_COLORS[policy.category ?? ""] ?? "bg-gray-50 text-gray-600"}`}>{categoryLabel(policy.category)}</span>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
                    <StatusIcon className="w-3 h-3" />{s.label}
                  </span>
                  <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 rounded">v{versionNum}</span>
                  {reviewDue(policy) && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                      <AlertTriangle className="w-3 h-3" />{t("r2b.policies.review_due")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={handleExportPdf} disabled={exportingPdf}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                <Download className="w-3.5 h-3.5" />
                {exportingPdf ? "…" : t("policies.export_pdf")}
              </button>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 bg-gray-50 flex-shrink-0 px-2">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                tab === key ? "border-blue-600 text-blue-600 bg-white" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Overview ── */}
          {tab === "overview" && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{(policy.linked_controls as string[])?.length ?? 0}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t("policies.linked_controls")}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{attPct}%</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t("policies.attestation_rate")}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">v{versionNum}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t("policies.version")}</p>
                </div>
              </div>

              {ownerName && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("policies.owner_display")}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
                      <Users className="w-3.5 h-3.5 text-blue-500" />
                    </div>
                    <span className="text-sm font-medium text-gray-800">{ownerName}</span>
                  </div>
                </div>
              )}

              {policy.description && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("common.description")}</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{policy.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-50">
                <div>
                  <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{t("policies.col_next_review")}</p>
                  <p className={`text-sm font-medium mt-0.5 ${reviewDue(policy) ? "text-red-600" : "text-gray-700"}`}>
                    {policy.next_review_date?.slice(0, 10) ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 flex items-center gap-1"><Link2 className="w-3 h-3" />{t("policies.review_cycle")}</p>
                  <p className="text-sm font-medium text-gray-700 mt-0.5">{t("policies_ui.review_months", { n: policy.review_frequency_months })}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{t("policies.effective_date_label", "Effective Date")}</p>
                  <p className="text-sm font-medium text-gray-700 mt-0.5">{policy.effective_date ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{t("policies.expiration_date_label", "Expiration Date")}</p>
                  <p className="text-sm font-medium text-gray-700 mt-0.5">{policy.expiration_date ?? "—"}</p>
                </div>
              </div>

              {/* Periodic review: due badge, mark as reviewed, history. */}
              <div className="pt-3 border-t border-gray-100 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t("r2b.policies.review_history")}</p>
                  {canManage && policy.status === "published" && (
                    <button onClick={() => { setReviewOpen(true); setReviewError(""); }}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        reviewDue(policy) ? "bg-red-600 hover:bg-red-700 text-white" : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                      <CheckCircle className="w-3.5 h-3.5" />{t("r2b.policies.mark_reviewed")}
                    </button>
                  )}
                </div>
                {policy.status !== "published" && !reviews.length && (
                  <p className="text-xs text-gray-500">{t("r2b.policies.review_published_only")}</p>
                )}
                {policy.status === "published" && !reviews.length && (
                  <p className="text-xs text-gray-500">{t("r2b.policies.never_reviewed")}</p>
                )}
                {reviews.length > 0 && (
                  <ul className="space-y-2">
                    {reviews.map(r => (
                      <li key={r.id} className="bg-gray-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500">
                          {t("r2b.policies.last_reviewed", {
                            date: new Date(r.reviewed_at).toLocaleDateString(dateLocale(i18n.language)),
                            name: r.reviewed_by_name ?? userName(r.reviewed_by_id) })}
                          {" · "}
                          <span>{t("r2b.policies.review_moved", { from: r.previous_review_date ?? "—", to: r.next_review_date ?? "—" })}</span>
                        </p>
                        <p className="text-sm text-gray-800 mt-0.5 whitespace-pre-line">{r.comment}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t("policies.approval_workflow")}</p>
                <div className="flex items-center gap-2 mb-4">
                  {(["draft", "in_review", "approved", "published"] as const).map((step, i) => {
                    const steps = ["draft", "in_review", "approved", "published"];
                    const currentIdx = steps.indexOf(policy.status);
                    const done    = i < currentIdx;
                    const current = i === currentIdx;
                    const cfg = STATUS_MAP[step];
                    const StepIcon = cfg.icon;
                    return (
                      <div key={step} className="flex items-center gap-1 flex-1">
                        <div className={`flex items-center gap-1.5 flex-1 justify-center py-1.5 px-2 rounded-lg text-xs font-medium border ${
                          current ? cfg.color + " border-transparent" :
                          done    ? "bg-green-50 text-green-700 border-green-100" :
                                    "bg-gray-50 text-gray-400 border-gray-100"
                        }`}>
                          <StepIcon className="w-3 h-3" />
                          <span className="hidden sm:inline">{cfg.label}</span>
                        </div>
                        {i < 3 && <div className={`w-3 h-0.5 flex-shrink-0 ${done ? "bg-green-300" : "bg-gray-200"}`} />}
                      </div>
                    );
                  })}
                </div>
                {awaitingVersionApproval && (
                  <p className="text-xs text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 mb-3">
                    {t("r2.policies.needs_version_approval")}
                  </p>
                )}
                {workflowError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{workflowError}</p>}
                {canManage && moves.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {moves.map(next => {
                      const cfg = MOVE_CFG[next];
                      return (
                        <button key={next} disabled={!!movingTo}
                          onClick={() => (next === "retired" ? setConfirm("retired") : moveTo(next))}
                          className={`flex-1 min-w-[140px] py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 ${cfg.color}`}>
                          {movingTo === next && <Loader2 className="w-4 h-4 animate-spin" />} {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {policy.status === "published" && (
                  <p className="text-center text-xs text-green-600 font-medium py-2">✓ {t("policies.policy_live")}</p>
                )}
              </div>

              {canManage && (
                <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
                  <button onClick={() => setEditing(true)}
                    className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium transition-colors">
                    <Edit3 className="w-4 h-4" /> {t("r2b.policies.edit_details")}
                  </button>
                  <button onClick={() => setConfirm("delete")}
                    className="flex items-center gap-2 text-red-500 hover:text-red-700 text-sm font-medium transition-colors">
                    <Trash2 className="w-4 h-4" /> {t("common.delete")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Content Editor ── */}
          {tab === "content" && (
            <div className="p-6 space-y-4">
              {loadingVer ? (
                <div className="text-center py-10 text-gray-400 text-sm">{t("common.loading")}</div>
              ) : (
                !canManage ? (
                  // Read-only roles see the current text; writing a version is policy_manager / CISO.
                  <div className="space-y-2">
                    {currentVersion && (
                      <span className="text-xs font-mono bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{t("policies.current_version")}: v{currentVersion.version_number}</span>
                    )}
                    <pre className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded-lg p-4 font-sans">
                      {currentVersion?.content ?? t("policies.no_versions")}
                    </pre>
                  </div>
                ) : <>
                  {/* AI banner */}
                  <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0" />
                      <p className="text-xs text-violet-700">{t("policies.ai_content_hint")}</p>
                    </div>
                    {aiGenerating ? (
                      <button onClick={handleAiStop}
                        className="flex items-center gap-1.5 flex-shrink-0 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                        <StopCircle className="w-3.5 h-3.5" />{t("policies.ai_stop")}
                      </button>
                    ) : (
                      <button onClick={handleAiGenerate}
                        className="flex items-center gap-1.5 flex-shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                        <Sparkles className="w-3.5 h-3.5" />{t("policies.ai_write_btn")}
                      </button>
                    )}
                  </div>

                  {currentVersion && !aiGenerating && !newContent && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-mono bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{t("policies.current_version")}: v{currentVersion.version_number}</span>
                      {currentVersion.change_summary && <span className="text-gray-400">— {currentVersion.change_summary}</span>}
                    </div>
                  )}

                  {aiGenerating && (
                    <div className="flex items-center gap-2 text-xs text-violet-600 font-medium animate-pulse">
                      <Sparkles className="w-3.5 h-3.5" />{t("policies.ai_generating")}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      {t("policies.tab_content")}
                    </label>
                    <textarea
                      rows={14}
                      className={`w-full border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 resize-y transition-colors ${
                        aiGenerating
                          ? "border-violet-300 bg-violet-50/40 focus:ring-violet-400"
                          : "border-gray-200 focus:ring-blue-500"
                      }`}
                      placeholder={aiGenerating ? t("policies.ai_generating") : t("policies.version_content_placeholder")}
                      value={newContent}
                      onChange={e => !aiGenerating && setNewContent(e.target.value)}
                      readOnly={aiGenerating}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      {t("policies.change_summary_label")}
                    </label>
                    <input
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={t("policies.change_summary_placeholder")}
                      value={changeSummary}
                      onChange={e => setChangeSummary(e.target.value)}
                    />
                  </div>
                  {verError && <p className="text-sm text-red-600">{verError}</p>}
                  <button
                    onClick={handleSaveVersion}
                    disabled={savingVer || !newContent.trim() || aiGenerating}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
                    <Edit3 className="w-4 h-4" />
                    {savingVer ? t("common.saving") : t("policies.add_version")}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Linked requirements ── */}
          {tab === "controls" && (
            <PolicyControlsTab policy={policy} onSaved={onUpdated} />
          )}

          {/* ── Version History ── */}
          {tab === "history" && (
            <div className="p-6 space-y-3">
              {/* Approve / restore happen on this tab, so their refusals show here too. */}
              {verError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{verError}</p>}
              {loadingVer ? (
                <div className="text-center py-10 text-gray-400 text-sm">{t("common.loading")}</div>
              ) : versions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">{t("policies.no_versions")}</p>
              ) : (
                versions.map(v => (
                  <div key={v.id} className="border border-gray-100 rounded-xl overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                      onClick={() => setExpandedVer(expandedVer === v.id ? null : v.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-gray-700">
                          {t("policies.version_label", { num: v.version_number })}
                        </span>
                        {v.is_current && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {t("policies.current_version")}
                          </span>
                        )}
                        {v.approved_by_id ? (
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-700">{t("r2.policies.version_approved")}</span>
                        ) : v.is_current && (
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-orange-100 text-orange-700">{t("r2.policies.version_awaiting")}</span>
                        )}
                        {v.change_summary && (
                          <span className="text-xs text-gray-400 truncate max-w-[200px]">— {v.change_summary}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                        {new Date(v.created_at).toLocaleDateString(dateLocale(i18n.language))}
                      </span>
                    </button>
                    {expandedVer === v.id && (
                      <div className="px-4 py-3 bg-white border-t border-gray-100">
                        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                          {v.content}
                        </pre>
                        <p className="mt-3 text-xs text-gray-500">
                          {t("r2.policies.authored_by", { name: userName(v.authored_by_id) })}
                          {v.approved_by_id && <> · {t("r2.policies.approved_by", { name: userName(v.approved_by_id), date: v.approved_at ? new Date(v.approved_at).toLocaleDateString(dateLocale(i18n.language)) : "" })}</>}
                        </p>
                        {canManage && v.is_current && !v.approved_by_id && (
                          v.authored_by_id && v.authored_by_id === myId ? (
                            <p className="mt-2 text-xs text-gray-500">{t("r2.policies.cannot_approve_own")}</p>
                          ) : (
                            <div className="mt-3 flex justify-end">
                              <button onClick={() => handleApproveVersion(v)} disabled={approvingVer === v.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                                {approvingVer === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                {t("r2.policies.approve_version")}
                              </button>
                            </div>
                          )
                        )}
                        {canManage && !v.is_current && (
                          <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                            <button
                              onClick={() => handleRestoreVersion(v)}
                              disabled={restoringVer === v.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
                            >
                              {restoringVer === v.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <History className="w-3.5 h-3.5" />}
                              {t("policies.restore_version", "Restore this version")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Attestations ── */}
          {tab === "attestations" && (
            <div className="p-6 space-y-5">
              {/* Progress */}
              {attTotal > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("policies.attest_progress")}</span>
                    <span className="text-xs font-bold text-gray-700">{attAcked}/{attTotal} ({attPct}%)</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${attPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Request form — managers only, and only for a signed-off text in force. */}
              {canManage && !attestable && (
                <p className="text-xs text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">{t("r2b.policies.attest_needs_approval")}</p>
              )}
              {canManage && attestable && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("policies.request_attestation")}</p>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t("policies.select_users")}</label>
                  <select
                    multiple
                    size={4}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={selectedUserIds}
                    onChange={e => setSelectedUserIds(Array.from(e.target.selectedOptions, o => o.value))}
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.first_name} {u.last_name} — {u.email}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">{t("policies.attest_select_help")}</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t("policies.attest_due_date")} ({t("common.optional")})</label>
                  <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
                {attError && <p className="text-sm text-red-600">{attError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSendAttestation(selectedUserIds)}
                    disabled={sendingAtt || !selectedUserIds.length}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
                    <Send className="w-3.5 h-3.5" />
                    {t("policies.send_attestation")}
                  </button>
                  <button
                    onClick={handleBulkAttest}
                    disabled={sendingAtt || !users.length}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
                    <Users className="w-3.5 h-3.5" />
                    {t("policies.bulk_attest")}
                  </button>
                </div>
              </div>
              )}

              {/* List */}
              {loadingAtt ? (
                <div className="text-center py-6 text-gray-400 text-sm">{t("common.loading")}</div>
              ) : attestations.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">{t("policies.no_attestations")}</p>
              ) : (
                <div className="space-y-2">
                  {attestations.map(a => {
                    const u = users.find(x => x.id === a.user_id);
                    const overdue = a.status === "pending" && a.due_date && new Date(a.due_date) < new Date();
                    return (
                      <div key={a.id} className="flex items-center justify-between px-4 py-3 border border-gray-100 rounded-xl bg-white">
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {u ? `${u.first_name} ${u.last_name}` : a.user_id}
                          </p>
                          {a.due_date && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {t("policies.attest_due_date")}: {new Date(a.due_date).toLocaleDateString(dateLocale(i18n.language))}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {a.status === "acknowledged" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                              <CheckCircle className="w-3 h-3" />{t("policies.attest_acknowledged")}
                            </span>
                          ) : overdue ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-600">
                              <AlertTriangle className="w-3 h-3" />{t("policies.attest_overdue_status")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-100 text-orange-600">
                              <Clock className="w-3 h-3" />{t("policies.attest_pending")}
                            </span>
                          )}
                          {a.acknowledged_at && (
                            <span className="text-xs text-gray-400">{new Date(a.acknowledged_at).toLocaleDateString(dateLocale(i18n.language))}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {editing && (
        <EditPolicyModal policy={policy} users={users} onClose={() => setEditing(false)} onSaved={onUpdated} />
      )}

      {reviewOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">{t("r2b.policies.review_title")}</h3>
            <p className="text-sm text-gray-600">{t("r2b.policies.review_body", { date: addMonthsIso(policy.review_frequency_months || 12) })}</p>
            <div>
              <label htmlFor="pol-review-comment" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("r2b.policies.review_comment")} *</label>
              <textarea id="pol-review-comment" rows={4} autoFocus value={reviewComment} onChange={e => setReviewComment(e.target.value)}
                placeholder={t("r2b.policies.review_comment_placeholder")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
            {reviewError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{reviewError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setReviewOpen(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">{t("common.cancel")}</button>
              <button onClick={handleReview} disabled={savingReview || !reviewComment.trim()}
                className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium inline-flex items-center justify-center gap-2">
                {savingReview && <Loader2 className="w-4 h-4 animate-spin" />}{t("r2b.policies.mark_reviewed")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" role="alertdialog" aria-modal="true">
            <h3 className="font-semibold text-gray-900">{confirm === "delete" ? t("r2.policies.delete_confirm_title") : t("r2.policies.retire_confirm_title")}</h3>
            <p className="text-sm text-gray-600">{confirm === "delete" ? t("r2.policies.delete_confirm_body", { title: policy.title }) : t("r2.policies.retire_confirm_body", { title: policy.title })}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
              <button
                onClick={async () => {
                  const what = confirm; setConfirm(null);
                  if (what === "delete") { await onDelete(policy.id); onClose(); } else { await moveTo("retired"); }
                }}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {confirm === "delete" ? t("common.delete") : t("r2.policies.retire")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PoliciesPage() {
  const { t } = useTranslation();
  const [policies, setPolicies]       = useState<Policy[]>([]);
  const [users, setUsers]             = useState<TenantUser[]>([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch]           = useState("");
  const [showAdd, setShowAdd]         = useState(false);
  const [selected, setSelected]       = useState<Policy | null>(null);
  const canManagePolicies = hasAnyRole(useAuthStore((u) => u), POLICY_WRITE_ROLES);

  const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
    draft:     { label: t("policies.draft"),     icon: Clock,        color: "bg-gray-100 text-gray-500"     },
    in_review: { label: t("policies.in_review"), icon: AlertCircle,  color: "bg-orange-100 text-orange-600" },
    approved:  { label: t("policies.approved"),  icon: CheckCircle,  color: "bg-blue-100 text-blue-600"     },
    published: { label: t("policies.published"), icon: CheckCircle,  color: "bg-green-100 text-green-600"   },
    retired:   { label: t("policies.retired"),   icon: Clock,        color: "bg-gray-100 text-gray-400"     },
  };

  const load = useCallback(async () => {
    try {
      const [polsResult, usrResult] = await Promise.allSettled([policiesApi.list(), usersApi.directory()]);
      if (polsResult.status === "fulfilled") setPolicies(polsResult.value);
      if (usrResult.status === "fulfilled") setUsers(usrResult.value);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Throws so the detail modal can show the backend's refusal (409 transition / approval).
  async function handleStatusChange(id: string, next: string) {
    const updated = await policiesApi.update(id, { status: next as Policy["status"] });
    setPolicies(prev => prev.map(p => p.id === id ? updated : p));
    setSelected(prev => (prev && prev.id === id ? updated : prev));
  }

  async function handleDelete(id: string) {
    try {
      await policiesApi.delete(id);
      setPolicies(prev => prev.filter(p => p.id !== id));
    } catch { /* ignore */ }
  }

  /** A policy edited inside the detail modal (today: its linked requirements)
   *  must not leave a stale row behind it in the register. */
  function handleUpdated(updated: Policy) {
    setPolicies(prev => prev.map(p => (p.id === updated.id ? updated : p)));
    setSelected(prev => (prev && prev.id === updated.id ? updated : prev));
  }

  const overdueCount = policies.filter(reviewDue).length;

  const filtered = useMemo(() => {
    let list = policies;
    if (statusFilter === "overdue") list = list.filter(reviewDue);
    else if (statusFilter !== "all") list = list.filter(p => p.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [policies, statusFilter, search]);

  const published = policies.filter(p => p.status === "published");

  const FILTER_TABS = [
    { key: "all",       label: t("common.all")             },
    { key: "published", label: t("policies.published")     },
    { key: "approved",  label: t("policies.approved")      },
    { key: "in_review", label: t("policies.in_review")     },
    { key: "draft",     label: t("policies.draft")         },
    { key: "overdue",   label: t("policies.overdue_review"), badge: overdueCount },
  ];

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("policies.management_title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("policies.subtitle", { published: published.length, review: policies.filter(p => p.status === "in_review").length })}
          </p>
        </div>
        {canManagePolicies && (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> {t("policies.new_policy")}
          </button>
        )}
      </div>

      {published.length < 3 && (
        <div className="flex items-center justify-between gap-4 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">{t("policies.ai_banner_title")}</p>
              <p className="text-xs text-white/80 mt-0.5">{t("policies.ai_banner_desc")}</p>
            </div>
          </div>
          <Link to="/policy-generator"
            className="flex-shrink-0 flex items-center gap-2 bg-white text-purple-700 font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-purple-50 transition-colors">
            <Wand2 className="w-4 h-4" /> {t("policies.open_generator")}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("policies.kpi_total"),      value: policies.length,                                                    icon: FileText,    color: "text-blue-500",   bg: "bg-blue-50"  },
          { label: t("policies.kpi_published"),   value: published.length,                                                   icon: CheckCircle, color: "text-green-500",  bg: "bg-green-50" },
          { label: t("policies.kpi_pending"),     value: policies.filter(p => p.status === "draft" || p.status === "in_review").length, icon: Clock, color: "text-orange-500", bg: "bg-orange-50" },
          { label: t("policies.kpi_overdue"),     value: overdueCount,                                                        icon: AlertTriangle, color: overdueCount > 0 ? "text-red-500" : "text-gray-400", bg: overdueCount > 0 ? "bg-red-50" : "bg-gray-50" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
            <div className={`w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs font-medium text-gray-500 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            placeholder={t("policies.search_placeholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                statusFilter === tab.key
                  ? tab.key === "overdue" ? "bg-red-600 text-white border-red-600" : "bg-blue-600 text-white border-blue-600"
                  : tab.key === "overdue" && overdueCount > 0 ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}>
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  statusFilter === tab.key ? "bg-white/20" : "bg-red-100 text-red-700"
                }`}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">{t("common.loading")}</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {[t("policies.col_policy"), t("policies.col_category"), t("policies.owner_display"), t("common.status"), t("policies.col_next_review"), ""].map((h, i) => (
                  <th key={i} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5 first:px-6">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(p => {
                const s = STATUS_MAP[p.status] ?? STATUS_MAP.draft;
                const StatusIcon = s.icon;
                const vNum = typeof p.version === "number" ? p.version : (p as { version_count?: number }).version_count ?? 0;
                const owner = users.find(u => u.id === p.owner_id);
                const ownerName = owner ? `${owner.first_name} ${owner.last_name}`.trim() : null;
                const overdue = reviewDue(p);
                return (
                  <tr key={p.id} onClick={() => setSelected(p)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                          <FileText className="w-4 h-4 text-blue-500" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">{p.title}</p>
                            {overdue && (
                              <span className="inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                                <AlertTriangle className="w-2.5 h-2.5" />{t("r2b.policies.review_due")}
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 rounded">v{vNum}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${CAT_COLORS[p.category ?? ""] ?? "bg-gray-50 text-gray-600"}`}>
                        {categoryLabel(p.category)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-xs text-gray-500">{ownerName ?? <span className="text-gray-300">—</span>}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
                        <StatusIcon className="w-3 h-3" />{s.label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {p.next_review_date
                        ? <span className={`flex items-center gap-1 text-xs ${overdue ? "text-red-500 font-medium" : "text-gray-500"}`}>
                            <Calendar className="w-3 h-3" />{p.next_review_date.slice(0, 10)}
                          </span>
                        : <span className="text-xs text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-4">
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">{t("policies.no_filter_match")}</div>
        )}
      </div>

      {showAdd && (
        <NewPolicyModal
          onClose={() => setShowAdd(false)}
          onSaved={p => setPolicies(prev => [p, ...prev])}
        />
      )}
      {selected && (
        <PolicyDetailModal
          policy={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onUpdated={handleUpdated}
          users={users}
        />
      )}
    </div>
  );
}
