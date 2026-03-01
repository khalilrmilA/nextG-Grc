import { useState } from "react";
import { ClipboardList, Plus, AlertTriangle, Calendar, Tag, X, ChevronRight } from "lucide-react";

const AUDITS = [
  { id: "1", title: "ISO 27001 Internal Audit Q4 2025", type: "Internal", framework: "ISO 27001", status: "fieldwork", start: "2025-11-01", end: "2025-12-15", findings: { critical: 1, high: 3, medium: 4, low: 2, observation: 1 }, fwColor: "bg-blue-50 text-blue-700", scope: "All production IT systems, cloud workloads, and HR systems.", lead_auditor: "Sarah Chen (CISO)", objective: "Assess conformance against ISO 27001:2022 controls" },
  { id: "2", title: "SOC 2 Type II External Audit", type: "External", framework: "SOC 2", status: "reporting", start: "2025-09-01", end: "2025-11-30", findings: { critical: 0, high: 1, medium: 2, low: 3, observation: 2 }, fwColor: "bg-purple-50 text-purple-700", scope: "Trust Services Criteria: Security, Availability, Confidentiality.", lead_auditor: "Deloitte LLP", objective: "Issue SOC 2 Type II report for customer assurance" },
  { id: "3", title: "PCI DSS Annual Assessment", type: "Certification", framework: "PCI DSS", status: "planning", start: "2026-01-15", end: "2026-03-31", findings: { critical: 0, high: 0, medium: 0, low: 0, observation: 0 }, fwColor: "bg-orange-50 text-orange-700", scope: "Cardholder data environment (CDE), payment processing systems.", lead_auditor: "TBD", objective: "Achieve PCI DSS v4.0 certification" },
  { id: "4", title: "GDPR Article 35 DPIA", type: "Internal", framework: "GDPR", status: "closed", start: "2025-07-01", end: "2025-09-30", findings: { critical: 0, high: 0, medium: 1, low: 2, observation: 3 }, fwColor: "bg-emerald-50 text-emerald-700", scope: "Data Processing Impact Assessment for new analytics platform.", lead_auditor: "Maria López (DPO)", objective: "Identify and mitigate GDPR risks for new data processing activities" },
];

type AuditEntry = typeof AUDITS[0];

const FINDING_TYPES = [
  { key: "critical" as const,    label: "Critical",    color: "bg-red-100 text-red-700"     },
  { key: "high" as const,        label: "High",        color: "bg-orange-100 text-orange-700"},
  { key: "medium" as const,      label: "Medium",      color: "bg-yellow-100 text-yellow-700"},
  { key: "low" as const,         label: "Low",         color: "bg-green-100 text-green-700"  },
  { key: "observation" as const, label: "Observation", color: "bg-gray-100 text-gray-600"    },
];

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  planning:  { label: "Planning",  color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
  fieldwork: { label: "Fieldwork", color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
  review:    { label: "Review",    color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  reporting: { label: "Reporting", color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  closed:    { label: "Closed",    color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
};

const TYPE_COLORS: Record<string, string> = {
  Internal:      "bg-slate-100 text-slate-600",
  External:      "bg-violet-100 text-violet-700",
  Certification: "bg-amber-100 text-amber-700",
};

const FRAMEWORK_OPTIONS = ["ISO 27001", "SOC 2", "PCI DSS", "GDPR", "HIPAA", "NIST CSF", "NIST 800-53", "CIS Controls"];
const TYPE_OPTIONS      = ["Internal", "External", "Regulatory", "Certification"];
const STATUS_OPTIONS    = Object.keys(STATUS_MAP);

// ── New Audit Modal ───────────────────────────────────────────────────────────
function NewAuditModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: (a: AuditEntry) => void }) {
  const [form, setForm] = useState({
    title: "", framework: "ISO 27001", type: "Internal",
    status: "planning", start: "", end: "",
    scope: "", lead_auditor: "", objective: "",
  });
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.start || !form.end) { setError("Start and end dates are required."); return; }
    const fwColors: Record<string, string> = {
      "ISO 27001": "bg-blue-50 text-blue-700", "SOC 2": "bg-purple-50 text-purple-700",
      "PCI DSS": "bg-orange-50 text-orange-700", "GDPR": "bg-emerald-50 text-emerald-700",
    };
    onSaved({
      id: String(Date.now()),
      title: form.title.trim(),
      framework: form.framework,
      type: form.type,
      status: form.status,
      start: form.start,
      end: form.end,
      scope: form.scope.trim(),
      lead_auditor: form.lead_auditor.trim(),
      objective: form.objective.trim(),
      findings: { critical: 0, high: 0, medium: 0, low: 0, observation: 0 },
      fwColor: fwColors[form.framework] ?? "bg-gray-50 text-gray-700",
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">New Audit</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label htmlFor="audit-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Title *</label>
            <input id="audit-title" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. ISO 27001 Internal Audit Q1 2026"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-framework" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Framework</label>
              <select id="audit-framework" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.framework} onChange={e => setForm(f => ({ ...f, framework: e.target.value }))}>
                {FRAMEWORK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="audit-type" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Type</label>
              <select id="audit-type" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-start" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Start Date *</label>
              <input id="audit-start" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="audit-end" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">End Date *</label>
              <input id="audit-end" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Status</label>
              <select id="audit-status" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(o => <option key={o} value={o}>{STATUS_MAP[o].label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="audit-lead" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Lead Auditor</label>
              <input id="audit-lead" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Name or firm"
                value={form.lead_auditor} onChange={e => setForm(f => ({ ...f, lead_auditor: e.target.value }))} />
            </div>
          </div>

          <div>
            <label htmlFor="audit-objective" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Objective</label>
            <input id="audit-objective" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What should this audit achieve?"
              value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="audit-scope" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Scope</label>
            <textarea id="audit-scope" rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Systems, processes, or departments in scope"
              value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              Create Audit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Audit Detail Modal ────────────────────────────────────────────────────────
function AuditDetailModal({ audit, onClose }: { readonly audit: AuditEntry; readonly onClose: () => void }) {
  const st = STATUS_MAP[audit.status] ?? STATUS_MAP.planning;
  const totalF = Object.values(audit.findings).reduce((a, b) => a + b, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 bg-orange-50 rounded-t-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <ClipboardList className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 leading-snug">{audit.title}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${audit.fwColor}`}>{audit.framework}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${TYPE_COLORS[audit.type] ?? "bg-gray-100 text-gray-600"}`}>
                    <Tag className="w-2.5 h-2.5 inline mr-1" />{audit.type}
                  </span>
                  <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${st.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" />Start</p>
              <p className="text-sm font-semibold text-gray-800">{audit.start}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" />End</p>
              <p className="text-sm font-semibold text-gray-800">{audit.end}</p>
            </div>
          </div>

          {audit.lead_auditor && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Lead Auditor</p>
              <p className="text-sm text-gray-700">{audit.lead_auditor}</p>
            </div>
          )}

          {audit.objective && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Objective</p>
              <p className="text-sm text-gray-700">{audit.objective}</p>
            </div>
          )}

          {audit.scope && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Scope</p>
              <p className="text-sm text-gray-700">{audit.scope}</p>
            </div>
          )}

          {/* Findings */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Findings ({totalF})
            </p>
            {totalF === 0 ? (
              <p className="text-sm text-gray-400 italic">No findings recorded yet</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {FINDING_TYPES.filter(f => audit.findings[f.key] > 0).map(f => (
                  <span key={f.key} className={`text-sm font-semibold px-3 py-1.5 rounded-lg ${f.color}`}>
                    {audit.findings[f.key]} {f.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditsPage() {
  const [audits, setAudits] = useState(AUDITS);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const totalFindings = audits.reduce((s, a) => s + Object.values(a.findings).reduce((x, v) => x + v, 0), 0);
  const openFindings  = audits.filter(a => a.status !== "closed").reduce((s, a) => s + Object.values(a.findings).reduce((x, v) => x + v, 0), 0);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Management</h1>
          <p className="text-gray-500 text-sm mt-1">{audits.length} audits · {audits.filter(a => a.status !== "closed").length} active</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Audit
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Active Audits",   value: audits.filter(a => a.status !== "closed").length, sub: "in progress" },
          { label: "Total Findings",  value: totalFindings, sub: "across all audits" },
          { label: "Open Findings",   value: openFindings,  sub: "requires action"  },
          { label: "Critical / High", value: audits.reduce((s, a) => s + a.findings.critical + a.findings.high, 0), sub: "priority findings" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {audits.map(audit => {
          const totalF = Object.values(audit.findings).reduce((a, b) => a + b, 0);
          const st = STATUS_MAP[audit.status] ?? STATUS_MAP.planning;
          return (
            <button key={audit.id} type="button"
              onClick={() => setSelected(audit)}
              className="w-full text-left bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-orange-100 transition-colors">
                    <ClipboardList className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{audit.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${audit.fwColor}`}>{audit.framework}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${TYPE_COLORS[audit.type] ?? "bg-gray-100 text-gray-600"}`}>
                        <Tag className="w-2.5 h-2.5 inline mr-1" />{audit.type}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Calendar className="w-3 h-3" />{audit.start} → {audit.end}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${st.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </div>
              </div>
              <div className="pt-4 border-t border-gray-50">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-gray-400 font-medium mr-1">
                    <AlertTriangle className="w-3.5 h-3.5" />Findings ({totalF}):
                  </span>
                  {totalF === 0
                    ? <span className="text-xs text-gray-400 italic">None identified yet</span>
                    : FINDING_TYPES.filter(f => audit.findings[f.key] > 0).map(f => (
                        <span key={f.key} className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${f.color}`}>
                          {audit.findings[f.key]} {f.label}
                        </span>
                      ))
                  }
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {showAdd && (
        <NewAuditModal
          onClose={() => setShowAdd(false)}
          onSaved={a => setAudits(prev => [a, ...prev])}
        />
      )}
      {selected && <AuditDetailModal audit={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
