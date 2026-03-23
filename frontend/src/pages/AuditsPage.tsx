import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList, Plus, AlertTriangle, Calendar, Tag, X, ChevronRight, Sparkles, UserPlus } from "lucide-react";
import AuditPlanModal from "../components/ai/AuditPlanModal";
import CreateAuditorModal from "../components/features/compliance/CreateAuditorModal";

const FW_SHORT: Record<string, string> = {
  "ISO 27001": "ISO 27001", "SOC 2": "SOC 2", "PCI DSS": "PCI DSS",
  "GDPR": "GDPR", "HIPAA": "HIPAA", "NIST CSF": "NIST CSF",
  "NIST 800-53": "NIST 800-53", "CIS Controls": "CIS",
};

const AUDITS = [
  { id: "1", title: "ISO 27001 Internal Audit Q4 2025", type: "Internal", framework: "ISO 27001", status: "fieldwork", start: "2025-11-01", end: "2025-12-15", findings: { critical: 1, high: 3, medium: 4, low: 2, observation: 1 }, fwColor: "bg-blue-50 text-blue-700", scope: "All production IT systems, cloud workloads, and HR systems.", lead_auditor: "Sarah Chen (CISO)", objective: "Assess conformance against ISO 27001:2022 controls" },
];

type AuditEntry = typeof AUDITS[0];

const FRAMEWORK_OPTIONS = ["ISO 27001", "SOC 2", "PCI DSS", "GDPR", "HIPAA", "NIST CSF", "NIST 800-53", "CIS Controls"];
const TYPE_OPTIONS      = ["Internal", "External", "Regulatory", "Certification"];
const STATUS_KEYS       = ["planning", "fieldwork", "review", "reporting", "closed"];

const TYPE_COLORS: Record<string, string> = {
  Internal:      "bg-slate-100 text-slate-600",
  External:      "bg-violet-100 text-violet-700",
  Certification: "bg-amber-100 text-amber-700",
};

// ── New Audit Modal ───────────────────────────────────────────────────────────
function NewAuditModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: (a: AuditEntry) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: "", framework: "ISO 27001", type: "Internal",
    status: "planning", start: "", end: "",
    scope: "", lead_auditor: "", objective: "",
  });
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("audits.title_required")); return; }
    if (!form.start || !form.end) { setError(t("audits.dates_required")); return; }
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

  const STATUS_LABELS: Record<string, string> = {
    planning:  t("audits.status_planning"),
    fieldwork: t("audits.status_fieldwork"),
    review:    t("audits.status_review"),
    reporting: t("audits.status_reporting"),
    closed:    t("audits.status_closed"),
  };

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
            <label htmlFor="audit-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_title")} *</label>
            <input id="audit-title" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("audits.form_title_placeholder")}
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-framework" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_framework")}</label>
              <select id="audit-framework" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.framework} onChange={e => setForm(f => ({ ...f, framework: e.target.value }))}>
                {FRAMEWORK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="audit-type" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_type")}</label>
              <select id="audit-type" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-start" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_start_date")} *</label>
              <input id="audit-start" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="audit-end" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_end_date")} *</label>
              <input id="audit-end" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_status")}</label>
              <select id="audit-status" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_KEYS.map(o => <option key={o} value={o}>{STATUS_LABELS[o]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="audit-lead" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.lead_auditor")}</label>
              <input id="audit-lead" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("audits.form_lead_placeholder")}
                value={form.lead_auditor} onChange={e => setForm(f => ({ ...f, lead_auditor: e.target.value }))} />
            </div>
          </div>

          <div>
            <label htmlFor="audit-objective" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.objective")}</label>
            <input id="audit-objective" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("audits.form_objective_placeholder")}
              value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="audit-scope" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.scope")}</label>
            <textarea id="audit-scope" rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("audits.form_scope_placeholder")}
              value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit"
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              {t("audits.create_audit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Audit Detail Modal ────────────────────────────────────────────────────────
function AuditDetailModal({ audit, onClose, onGeneratePlan }: { readonly audit: AuditEntry; readonly onClose: () => void; readonly onGeneratePlan: () => void }) {
  const { t } = useTranslation();

  const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
    planning:  { label: t("audits.status_planning"),  color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
    fieldwork: { label: t("audits.status_fieldwork"), color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
    review:    { label: t("audits.status_review"),    color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
    reporting: { label: t("audits.status_reporting"), color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
    closed:    { label: t("audits.status_closed"),    color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
  };

  const FINDING_TYPES = [
    { key: "critical" as const,    label: t("audits.finding_critical"),     color: "bg-red-100 text-red-700"     },
    { key: "high" as const,        label: t("audits.finding_high"),         color: "bg-orange-100 text-orange-700"},
    { key: "medium" as const,      label: t("audits.finding_medium"),       color: "bg-yellow-100 text-yellow-700"},
    { key: "low" as const,         label: t("audits.finding_low"),          color: "bg-green-100 text-green-700"  },
    { key: "observation" as const, label: t("audits.finding_observation"),  color: "bg-gray-100 text-gray-600"    },
  ];

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
              <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" />{t("audits.form_start_date")}</p>
              <p className="text-sm font-semibold text-gray-800">{audit.start}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" />{t("audits.form_end_date")}</p>
              <p className="text-sm font-semibold text-gray-800">{audit.end}</p>
            </div>
          </div>

          {audit.lead_auditor && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("audits.lead_auditor")}</p>
              <p className="text-sm text-gray-700">{audit.lead_auditor}</p>
            </div>
          )}

          {audit.objective && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("audits.objective")}</p>
              <p className="text-sm text-gray-700">{audit.objective}</p>
            </div>
          )}

          {audit.scope && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("audits.scope")}</p>
              <p className="text-sm text-gray-700">{audit.scope}</p>
            </div>
          )}

          {/* Findings */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t("audits.findings_count", { count: totalF })}
            </p>
            {totalF === 0 ? (
              <p className="text-sm text-gray-400 italic">{t("audits.no_findings_yet")}</p>
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

          {/* AI Audit Program */}
          <button
            type="button"
            onClick={onGeneratePlan}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-sm font-medium transition-all shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            {t("audits.generate_ai_program")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditsPage() {
  const { t } = useTranslation();
  const [audits, setAudits] = useState(AUDITS);
  const [showAdd, setShowAdd] = useState(false);
  const [showCreateAuditor, setShowCreateAuditor] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [planAudit, setPlanAudit] = useState<AuditEntry | null>(null);

  const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
    planning:  { label: t("audits.status_planning"),  color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
    fieldwork: { label: t("audits.status_fieldwork"), color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
    review:    { label: t("audits.status_review"),    color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
    reporting: { label: t("audits.status_reporting"), color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
    closed:    { label: t("audits.status_closed"),    color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
  };

  const FINDING_TYPES = [
    { key: "critical" as const,    label: t("audits.finding_critical"),     color: "bg-red-100 text-red-700"     },
    { key: "high" as const,        label: t("audits.finding_high"),         color: "bg-orange-100 text-orange-700"},
    { key: "medium" as const,      label: t("audits.finding_medium"),       color: "bg-yellow-100 text-yellow-700"},
    { key: "low" as const,         label: t("audits.finding_low"),          color: "bg-green-100 text-green-700"  },
    { key: "observation" as const, label: t("audits.finding_observation"),  color: "bg-gray-100 text-gray-600"    },
  ];

  const totalFindings = audits.reduce((s, a) => s + Object.values(a.findings).reduce((x, v) => x + v, 0), 0);
  const openFindings  = audits.filter(a => a.status !== "closed").reduce((s, a) => s + Object.values(a.findings).reduce((x, v) => x + v, 0), 0);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("audits.management_title")}</h1>
          <p className="text-gray-500 text-sm mt-1">{t("audits.subtitle", { count: audits.length, active: audits.filter(a => a.status !== "closed").length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateAuditor(true)}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UserPlus className="w-4 h-4" /> {t("audits.add_auditor")}
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> {t("audits.new_audit")}
          </button>
        </div>
      </div>

      {showCreateAuditor && (
        <CreateAuditorModal
          onClose={() => setShowCreateAuditor(false)}
          onCreated={() => setShowCreateAuditor(false)}
        />
      )}

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("audits.kpi_active"),         value: audits.filter(a => a.status !== "closed").length, sub: t("audits.kpi_active_sub") },
          { label: t("audits.kpi_total_findings"),  value: totalFindings, sub: t("audits.kpi_total_findings_sub") },
          { label: t("audits.kpi_open_findings"),   value: openFindings,  sub: t("audits.kpi_open_findings_sub") },
          { label: t("audits.kpi_critical_high"),   value: audits.reduce((s, a) => s + a.findings.critical + a.findings.high, 0), sub: t("audits.kpi_critical_high_sub") },
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
                    <AlertTriangle className="w-3.5 h-3.5" />{t("audits.findings_count", { count: totalF })}:
                  </span>
                  {totalF === 0
                    ? <span className="text-xs text-gray-400 italic">{t("audits.none_identified")}</span>
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
      {selected && (
        <AuditDetailModal
          audit={selected}
          onClose={() => setSelected(null)}
          onGeneratePlan={() => { setPlanAudit(selected); setSelected(null); }}
        />
      )}
      {planAudit && (
        <AuditPlanModal
          auditTitle={planAudit.title}
          frameworkName={planAudit.framework}
          frameworkShortName={FW_SHORT[planAudit.framework] ?? planAudit.framework}
          auditScope={planAudit.scope}
          auditObjective={planAudit.objective}
          onClose={() => setPlanAudit(null)}
        />
      )}
    </div>
  );
}
