import { useState } from "react";
import { FileText, Plus, CheckCircle, Clock, AlertCircle, User, Calendar, Link2, X, ChevronRight } from "lucide-react";

const POLICIES = [
  { id: "1", title: "Information Security Policy",        category: "Security",        version: 3, status: "published", owner: "CISO",         attestation_rate: 94,   linked_controls: 12, next_review: "2026-06-01", description: "Defines the organization's overall approach to information security, including objectives, scope, and management commitment." },
  { id: "2", title: "Acceptable Use Policy",              category: "HR",              version: 2, status: "published", owner: "HR Director",  attestation_rate: 87,   linked_controls: 5,  next_review: "2026-03-01", description: "Governs the acceptable use of company IT resources, including computers, networks, and internet access by employees." },
  { id: "3", title: "Data Classification Policy",         category: "Data Governance", version: 1, status: "approved",  owner: "DPO",          attestation_rate: null, linked_controls: 8,  next_review: "2026-06-01", description: "Establishes a framework for classifying organizational data based on sensitivity, value, and criticality." },
  { id: "4", title: "Incident Response Policy",           category: "Security",        version: 4, status: "in_review", owner: "SOC Lead",     attestation_rate: null, linked_controls: 7,  next_review: "2026-01-15", description: "Defines procedures for detecting, reporting, and responding to information security incidents." },
  { id: "5", title: "Third-Party Risk Management Policy", category: "Vendor Risk",     version: 1, status: "draft",     owner: "Procurement",  attestation_rate: null, linked_controls: 4,  next_review: "—",          description: "Establishes requirements for assessing and managing risks associated with third-party vendors and suppliers." },
  { id: "6", title: "Access Control Policy",              category: "Security",        version: 2, status: "published", owner: "IT Manager",  attestation_rate: 78,   linked_controls: 15, next_review: "2026-04-01", description: "Defines requirements for user access management, including provisioning, review, and revocation of access rights." },
  { id: "7", title: "Business Continuity Plan",           category: "BCP / DR",        version: 1, status: "approved",  owner: "COO",          attestation_rate: null, linked_controls: 9,  next_review: "2026-09-01", description: "Outlines strategies and procedures to maintain essential business functions during and after a disruption." },
];

type PolicyEntry = typeof POLICIES[0];

const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  draft:     { label: "Draft",     icon: Clock,        color: "bg-gray-100 text-gray-500"    },
  in_review: { label: "In Review", icon: AlertCircle,  color: "bg-orange-100 text-orange-600"},
  approved:  { label: "Approved",  icon: CheckCircle,  color: "bg-blue-100 text-blue-600"    },
  published: { label: "Published", icon: CheckCircle,  color: "bg-green-100 text-green-600"  },
  retired:   { label: "Retired",   icon: Clock,        color: "bg-gray-100 text-gray-400"    },
};

const CAT_COLORS: Record<string, string> = {
  Security:          "bg-blue-50 text-blue-700",
  HR:                "bg-pink-50 text-pink-700",
  "Data Governance": "bg-emerald-50 text-emerald-700",
  "Vendor Risk":     "bg-orange-50 text-orange-700",
  "BCP / DR":        "bg-purple-50 text-purple-700",
};

const CATEGORY_OPTIONS = ["Security", "HR", "Data Governance", "Vendor Risk", "BCP / DR", "Legal & Compliance", "Privacy", "Physical Security"];
const STATUS_OPTIONS    = Object.keys(STATUS_MAP);
const REVIEW_FREQUENCIES = [
  { value: 6,  label: "Every 6 months" },
  { value: 12, label: "Annually"       },
  { value: 24, label: "Every 2 years"  },
];

function attestationColor(rate: number) {
  if (rate >= 90) return "bg-green-500";
  if (rate >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

// ── New Policy Modal ──────────────────────────────────────────────────────────
function NewPolicyModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: (p: PolicyEntry) => void }) {
  const [form, setForm] = useState({
    title: "", category: "Security", owner: "",
    status: "draft", review_months: 12, description: "",
  });
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.owner.trim()) { setError("Owner is required."); return; }
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
          <h2 className="font-semibold text-gray-900">New Policy</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label htmlFor="pol-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Title *</label>
            <input id="pol-title" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Password Management Policy"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pol-category" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Category</label>
              <select id="pol-category" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pol-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Status</label>
              <select id="pol-status" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(o => <option key={o} value={o}>{STATUS_MAP[o].label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pol-owner" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Owner *</label>
              <input id="pol-owner" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. CISO, IT Manager"
                value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="pol-review" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Review Cycle</label>
              <select id="pol-review" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.review_months} onChange={e => setForm(f => ({ ...f, review_months: +e.target.value }))}>
                {REVIEW_FREQUENCIES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="pol-desc" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</label>
            <textarea id="pol-desc" rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="What does this policy cover and why is it needed?"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              Create Policy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Policy Detail Modal ───────────────────────────────────────────────────────
function PolicyDetailModal({ policy, onClose }: { readonly policy: PolicyEntry; readonly onClose: () => void }) {
  const s = STATUS_MAP[policy.status] ?? STATUS_MAP.draft;
  const StatusIcon = s.icon;
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
              <p className="text-xs text-gray-400 mt-0.5">Linked Controls</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">
                {policy.attestation_rate === null ? "—" : `${policy.attestation_rate}%`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Attestation</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">v{policy.version}</p>
              <p className="text-xs text-gray-400 mt-0.5">Version</p>
            </div>
          </div>

          {policy.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-gray-700 leading-relaxed">{policy.description}</p>
            </div>
          )}

          {/* Attestation bar */}
          {policy.attestation_rate != null && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Attestation Rate</p>
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
              <p className="text-xs text-gray-400 flex items-center gap-1"><User className="w-3 h-3" />Owner</p>
              <p className="text-sm font-medium text-gray-700 mt-0.5">{policy.owner}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />Next Review</p>
              <p className="text-sm font-medium text-gray-700 mt-0.5">{policy.next_review}</p>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-50">
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-1"><Link2 className="w-3 h-3" />Linked Controls</p>
            <p className="text-sm text-gray-600">{policy.linked_controls} control{policy.linked_controls === 1 ? "" : "s"} mapped</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PoliciesPage() {
  const [policies, setPolicies] = useState(POLICIES);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<PolicyEntry | null>(null);

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
          <h1 className="text-2xl font-bold text-gray-900">Policy Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            {published.length} published · {policies.filter(p => p.status === "in_review").length} under review
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Policy
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Policies",   value: policies.length,  sub: "in library" },
          { label: "Published",        value: published.length, sub: "live & effective" },
          { label: "Avg. Attestation", value: `${avgAttestation}%`, sub: "published policies" },
          { label: "Pending Review",   value: policies.filter(p => p.status === "in_review" || p.status === "draft").length, sub: "need action" },
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
          { key: "all",       label: "All"       },
          { key: "published", label: "Published" },
          { key: "approved",  label: "Approved"  },
          { key: "in_review", label: "In Review" },
          { key: "draft",     label: "Draft"     },
        ].map(t => (
          <button key={t.key} onClick={() => setStatusFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === t.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {["Policy", "Category", "Status", "Attestation", "Controls", "Next Review", ""].map(h => (
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
          <div className="text-center py-16 text-gray-400 text-sm">No policies match this filter</div>
        )}
      </div>

      {showAdd && (
        <NewPolicyModal
          onClose={() => setShowAdd(false)}
          onSaved={p => setPolicies(prev => [p, ...prev])}
        />
      )}
      {selected && <PolicyDetailModal policy={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
