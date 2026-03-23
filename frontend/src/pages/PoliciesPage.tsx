import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FileText, Plus, CheckCircle, Clock, AlertCircle, User, Calendar, Link2, X, ChevronRight, Wand2 } from "lucide-react";

const POLICIES = [
  { id: "1", title: "Information Security Policy",        category: "Security",        version: 3, status: "published", owner: "CISO",         attestation_rate: 94,   linked_controls: 12, next_review: "2026-06-01", description: "Defines the organization's overall approach to information security, including objectives, scope, and management commitment." },
];

type PolicyEntry = typeof POLICIES[0];

const CAT_COLORS: Record<string, string> = {
  Security:          "bg-blue-50 text-blue-700",
  HR:                "bg-pink-50 text-pink-700",
  "Data Governance": "bg-emerald-50 text-emerald-700",
  "Vendor Risk":     "bg-orange-50 text-orange-700",
  "BCP / DR":        "bg-purple-50 text-purple-700",
};

const CATEGORY_OPTIONS = ["Security", "HR", "Data Governance", "Vendor Risk", "BCP / DR", "Legal & Compliance", "Privacy", "Physical Security"];
const STATUS_KEYS      = ["draft", "in_review", "approved", "published", "retired"];
const REVIEW_FREQUENCIES = [
  { value: 6,  labelKey: "policies.review_6mo"  },
  { value: 12, labelKey: "policies.review_12mo" },
  { value: 24, labelKey: "policies.review_24mo" },
];

function attestationColor(rate: number) {
  if (rate >= 90) return "bg-green-500";
  if (rate >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

// ── New Policy Modal ──────────────────────────────────────────────────────────
function NewPolicyModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: (p: PolicyEntry) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: "", category: "Security", owner: "",
    status: "draft", review_months: 12, description: "",
  });
  const [error, setError] = useState("");

  const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
    draft:     { label: t("policies.draft"),     icon: Clock,        color: "bg-gray-100 text-gray-500"    },
    in_review: { label: t("policies.in_review"), icon: AlertCircle,  color: "bg-orange-100 text-orange-600"},
    approved:  { label: t("policies.approved"),  icon: CheckCircle,  color: "bg-blue-100 text-blue-600"    },
    published: { label: t("policies.published"), icon: CheckCircle,  color: "bg-green-100 text-green-600"  },
    retired:   { label: t("policies.retired"),   icon: Clock,        color: "bg-gray-100 text-gray-400"    },
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("policies.title_required")); return; }
    if (!form.owner.trim()) { setError(t("policies.owner_required")); return; }
    const nextReview = new Date();
    nextReview.setMonth(nextReview.getMonth() + form.review_months);
    onSaved({
      id: String(Date.now()),
      title: form.title.trim(),
      category: form.category,
      owner: form.owner.trim(),
      status: form.status,
      version: 1,
      attestation_rate: null,
      linked_controls: 0,
      next_review: nextReview.toISOString().slice(0, 10),
      description: form.description.trim(),
    });
    onClose();
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
                {CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pol-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.status_label")}</label>
              <select id="pol-status" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_KEYS.map(o => <option key={o} value={o}>{STATUS_MAP[o]?.label ?? o}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pol-owner" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.owner_label")} *</label>
              <input id="pol-owner" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("policies.owner_placeholder")}
                value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="pol-review" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policies.review_cycle")}</label>
              <select id="pol-review" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.review_months} onChange={e => setForm(f => ({ ...f, review_months: +e.target.value }))}>
                {REVIEW_FREQUENCIES.map(r => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="pol-desc" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.description")}</label>
            <textarea id="pol-desc" rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("policies.description_placeholder")}
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit"
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              {t("policies.create_policy")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Policy Detail Modal ───────────────────────────────────────────────────────
function PolicyDetailModal({ policy, onClose, onStatusChange }: {
  readonly policy: PolicyEntry;
  readonly onClose: () => void;
  readonly onStatusChange: (id: string, next: string) => void;
}) {
  const { t } = useTranslation();

  const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
    draft:     { label: t("policies.draft"),     icon: Clock,        color: "bg-gray-100 text-gray-500"    },
    in_review: { label: t("policies.in_review"), icon: AlertCircle,  color: "bg-orange-100 text-orange-600"},
    approved:  { label: t("policies.approved"),  icon: CheckCircle,  color: "bg-blue-100 text-blue-600"    },
    published: { label: t("policies.published"), icon: CheckCircle,  color: "bg-green-100 text-green-600"  },
    retired:   { label: t("policies.retired"),   icon: Clock,        color: "bg-gray-100 text-gray-400"    },
  };

  const WORKFLOW_ACTIONS: Record<string, { label: string; next: string; color: string } | undefined> = {
    draft:     { label: t("policies.submit_for_review"), next: "in_review", color: "bg-orange-500 hover:bg-orange-600 text-white" },
    in_review: { label: t("policies.approve"),           next: "approved",  color: "bg-blue-600 hover:bg-blue-700 text-white"    },
    approved:  { label: t("policies.publish"),           next: "published", color: "bg-green-600 hover:bg-green-700 text-white"  },
  };

  const s = STATUS_MAP[policy.status] ?? STATUS_MAP.draft;
  const StatusIcon = s.icon;
  const action = WORKFLOW_ACTIONS[policy.status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 bg-blue-50 rounded-t-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 leading-snug">{policy.title}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${CAT_COLORS[policy.category] ?? "bg-gray-50 text-gray-600"}`}>{policy.category}</span>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
                    <StatusIcon className="w-3 h-3" />{s.label}
                  </span>
                  <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 rounded">v{policy.version}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{policy.linked_controls}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t("policies.linked_controls")}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">
                {policy.attestation_rate === null ? "—" : `${policy.attestation_rate}%`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{t("policies.kpi_attestation")}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">v{policy.version}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t("policies.version")}</p>
            </div>
          </div>

          {policy.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("common.description")}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{policy.description}</p>
            </div>
          )}

          {/* Attestation bar */}
          {policy.attestation_rate != null && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t("policies.attestation_rate")}</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${attestationColor(policy.attestation_rate)} transition-all`}
                    style={{ width: `${policy.attestation_rate}%` }} />
                </div>
                <span className="text-sm font-bold text-gray-700 w-10 text-right">{policy.attestation_rate}%</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-50">
            <div>
              <p className="text-xs text-gray-400 flex items-center gap-1"><User className="w-3 h-3" />{t("common.owner")}</p>
              <p className="text-sm font-medium text-gray-700 mt-0.5">{policy.owner}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{t("policies.col_next_review")}</p>
              <p className="text-sm font-medium text-gray-700 mt-0.5">{policy.next_review}</p>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-50">
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-1"><Link2 className="w-3 h-3" />{t("policies.linked_controls")}</p>
            <p className="text-sm text-gray-600">{t("policies.controls_mapped", { count: policy.linked_controls })}</p>
          </div>

          {/* Approval workflow */}
          <div className="pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t("policies.approval_workflow")}</p>
            <div className="flex items-center gap-2 mb-4">
              {(["draft", "in_review", "approved", "published"] as const).map((step, i) => {
                const steps = ["draft", "in_review", "approved", "published"];
                const currentIdx = steps.indexOf(policy.status);
                const stepIdx = i;
                const done = stepIdx < currentIdx;
                const current = stepIdx === currentIdx;
                const cfg = STATUS_MAP[step];
                const StepIcon = cfg.icon;
                return (
                  <div key={step} className="flex items-center gap-1 flex-1">
                    <div className={`flex items-center gap-1.5 flex-1 justify-center py-1.5 px-2 rounded-lg text-xs font-medium border ${
                      current ? cfg.color + " border-transparent" :
                      done ? "bg-green-50 text-green-700 border-green-100" :
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
            {action && (
              <button
                onClick={() => { onStatusChange(policy.id, action.next); onClose(); }}
                className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${action.color}`}
              >
                {action.label} →
              </button>
            )}
            {policy.status === "published" && (
              <p className="text-center text-xs text-green-600 font-medium py-2">
                ✓ {t("policies.policy_live")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PoliciesPage() {
  const { t } = useTranslation();
  const [policies, setPolicies] = useState(POLICIES);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<PolicyEntry | null>(null);

  const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
    draft:     { label: t("policies.draft"),     icon: Clock,        color: "bg-gray-100 text-gray-500"    },
    in_review: { label: t("policies.in_review"), icon: AlertCircle,  color: "bg-orange-100 text-orange-600"},
    approved:  { label: t("policies.approved"),  icon: CheckCircle,  color: "bg-blue-100 text-blue-600"    },
    published: { label: t("policies.published"), icon: CheckCircle,  color: "bg-green-100 text-green-600"  },
    retired:   { label: t("policies.retired"),   icon: Clock,        color: "bg-gray-100 text-gray-400"    },
  };

  function handleStatusChange(id: string, next: string) {
    setPolicies((prev) => prev.map((p) =>
      p.id === id
        ? { ...p, status: next, version: next === "published" ? p.version + 1 : p.version }
        : p
    ));
  }

  const filtered  = policies.filter(p => statusFilter === "all" || p.status === statusFilter);
  const published = policies.filter(p => p.status === "published");
  const pubWithRate = published.filter(p => p.attestation_rate != null);
  const avgAttestation = pubWithRate.length > 0
    ? Math.round(pubWithRate.reduce((s, p) => s + (p.attestation_rate ?? 0), 0) / pubWithRate.length)
    : 0;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("policies.management_title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("policies.subtitle", { published: published.length, review: policies.filter(p => p.status === "in_review").length })}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> {t("policies.new_policy")}
        </button>
      </div>

      {/* Doc Generator banner */}
      {policies.filter(p => p.status === "published").length < 3 && (
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
          <Link
            to="/policy-generator"
            className="flex-shrink-0 flex items-center gap-2 bg-white text-purple-700 font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-purple-50 transition-colors"
          >
            <Wand2 className="w-4 h-4" /> {t("policies.open_generator")}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("policies.kpi_total"),       value: policies.length,  sub: t("policies.kpi_total_sub") },
          { label: t("policies.kpi_published"),    value: published.length, sub: t("policies.kpi_published_sub") },
          { label: t("policies.kpi_attestation"),  value: `${avgAttestation}%`, sub: t("policies.kpi_attestation_sub") },
          { label: t("policies.kpi_pending"),      value: policies.filter(p => p.status === "in_review" || p.status === "draft").length, sub: t("policies.kpi_pending_sub") },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {[
          { key: "all",       label: t("common.all")           },
          { key: "published", label: t("policies.published")   },
          { key: "approved",  label: t("policies.approved")    },
          { key: "in_review", label: t("policies.in_review")   },
          { key: "draft",     label: t("policies.draft")       },
        ].map(tab => (
          <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === tab.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {[t("policies.col_policy"), t("policies.col_category"), t("common.status"), t("policies.col_attestation"), t("policies.col_controls"), t("policies.col_next_review"), ""].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5 first:px-6">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(p => {
              const s = STATUS_MAP[p.status] ?? STATUS_MAP.draft;
              const StatusIcon = s.icon;
              return (
                <tr key={p.id} onClick={() => setSelected(p)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                        <FileText className="w-4 h-4 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">{p.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                          <span className="font-mono bg-gray-100 px-1.5 rounded">v{p.version}</span>
                          <span className="flex items-center gap-1"><User className="w-2.5 h-2.5" />{p.owner}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${CAT_COLORS[p.category] ?? "bg-gray-50 text-gray-600"}`}>
                      {p.category}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
                      <StatusIcon className="w-3 h-3" />{s.label}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {p.attestation_rate === null ? (
                      <span className="text-xs text-gray-300">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${attestationColor(p.attestation_rate)}`}
                            style={{ width: `${p.attestation_rate}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">{p.attestation_rate}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="flex items-center justify-center gap-1 text-xs text-gray-600">
                      <Link2 className="w-3 h-3 text-gray-400" />{p.linked_controls}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {p.next_review === "—"
                      ? <span className="text-xs text-gray-300">—</span>
                      : <span className="flex items-center gap-1 text-xs text-gray-500"><Calendar className="w-3 h-3 text-gray-400" />{p.next_review}</span>
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
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">{t("policies.no_filter_match")}</div>
        )}
      </div>

      {showAdd && (
        <NewPolicyModal
          onClose={() => setShowAdd(false)}
          onSaved={p => setPolicies(prev => [p, ...prev])}
        />
      )}
      {selected && <PolicyDetailModal policy={selected} onClose={() => setSelected(null)} onStatusChange={handleStatusChange} />}
    </div>
  );
}
