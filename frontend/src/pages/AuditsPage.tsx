import { ClipboardList, Plus, AlertTriangle, Calendar, Tag } from "lucide-react";

const AUDITS = [
  { id: "1", title: "ISO 27001 Internal Audit Q4 2025", type: "Internal", framework: "ISO 27001", status: "fieldwork", start: "2025-11-01", end: "2025-12-15", findings: { critical: 1, high: 3, medium: 4, low: 2, observation: 1 }, fwColor: "bg-blue-50 text-blue-700" },
  { id: "2", title: "SOC 2 Type II External Audit", type: "External", framework: "SOC 2", status: "reporting", start: "2025-09-01", end: "2025-11-30", findings: { critical: 0, high: 1, medium: 2, low: 3, observation: 2 }, fwColor: "bg-purple-50 text-purple-700" },
  { id: "3", title: "PCI DSS Annual Assessment", type: "Certification", framework: "PCI DSS", status: "planning", start: "2026-01-15", end: "2026-03-31", findings: { critical: 0, high: 0, medium: 0, low: 0, observation: 0 }, fwColor: "bg-orange-50 text-orange-700" },
  { id: "4", title: "GDPR Article 35 DPIA", type: "Internal", framework: "GDPR", status: "closed", start: "2025-07-01", end: "2025-09-30", findings: { critical: 0, high: 0, medium: 1, low: 2, observation: 3 }, fwColor: "bg-emerald-50 text-emerald-700" },
];

const FINDING_TYPES = [
  { key: "critical" as const,    label: "Critical",     color: "bg-red-100 text-red-700"    },
  { key: "high" as const,        label: "High",         color: "bg-orange-100 text-orange-700"},
  { key: "medium" as const,      label: "Medium",       color: "bg-yellow-100 text-yellow-700"},
  { key: "low" as const,         label: "Low",          color: "bg-green-100 text-green-700" },
  { key: "observation" as const, label: "Observation",  color: "bg-gray-100 text-gray-600"   },
];

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  planning:  { label: "Planning",   color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
  fieldwork: { label: "Fieldwork",  color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
  review:    { label: "Review",     color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  reporting: { label: "Reporting",  color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  closed:    { label: "Closed",     color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
};

const TYPE_COLORS: Record<string, string> = {
  Internal:    "bg-slate-100 text-slate-600",
  External:    "bg-violet-100 text-violet-700",
  Certification: "bg-amber-100 text-amber-700",
};

export default function AuditsPage() {
  const totalFindings = AUDITS.reduce((s, a) =>
    s + Object.values(a.findings).reduce((x, v) => x + v, 0), 0);
  const openFindings = AUDITS
    .filter(a => a.status !== "closed")
    .reduce((s, a) => s + Object.values(a.findings).reduce((x, v) => x + v, 0), 0);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Management</h1>
          <p className="text-gray-500 text-sm mt-1">{AUDITS.length} audits · {AUDITS.filter(a => a.status !== "closed").length} active</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          New Audit
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Active Audits",    value: AUDITS.filter(a => a.status !== "closed").length, sub: "in progress" },
          { label: "Total Findings",   value: totalFindings,  sub: "across all audits" },
          { label: "Open Findings",    value: openFindings,   sub: "requires action"   },
          { label: "Critical / High",  value: AUDITS.reduce((s, a) => s + a.findings.critical + a.findings.high, 0), sub: "priority findings" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Audit cards */}
      <div className="space-y-4">
        {AUDITS.map((audit) => {
          const totalF = Object.values(audit.findings).reduce((a, b) => a + b, 0);
          const st = STATUS_MAP[audit.status] ?? STATUS_MAP.planning;
          return (
            <div key={audit.id} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group">
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
                <span className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${st.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                  {st.label}
                </span>
              </div>

              {/* Findings */}
              <div className="pt-4 border-t border-gray-50">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-gray-400 font-medium mr-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Findings ({totalF}):
                  </span>
                  {totalF === 0 ? (
                    <span className="text-xs text-gray-400 italic">None identified yet</span>
                  ) : (
                    FINDING_TYPES.filter(f => audit.findings[f.key] > 0).map(f => (
                      <span key={f.key} className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${f.color}`}>
                        {audit.findings[f.key]} {f.label}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
