import { useState } from "react";
import { CheckCircle, Clock, AlertCircle, XCircle, Plus, User, Calendar } from "lucide-react";

const ASSESSMENTS = [
  { id: "1", name: "ISO 27001:2022 Certification Assessment", framework: "ISO 27001", score: 72, status: "in_progress", controls: { implemented: 45, in_progress: 20, not_started: 18, not_applicable: 10 }, lead: "Alice Martin", started: "2025-10-01", due: "2026-01-31", fwColor: "bg-blue-50 text-blue-700" },
  { id: "2", name: "SOC 2 Type II Readiness", framework: "SOC 2", score: 85, status: "completed", controls: { implemented: 52, in_progress: 5, not_started: 2, not_applicable: 5 }, lead: "Bob Chen", started: "2025-07-01", due: "2025-12-01", fwColor: "bg-purple-50 text-purple-700" },
  { id: "3", name: "GDPR Compliance Review 2025", framework: "GDPR", score: 61, status: "in_progress", controls: { implemented: 28, in_progress: 8, not_started: 7, not_applicable: 4 }, lead: "Claire Dupont", started: "2025-09-15", due: "2026-03-01", fwColor: "bg-emerald-50 text-emerald-700" },
  { id: "4", name: "PCI DSS 4.0 — Annual Assessment", framework: "PCI DSS", score: 48, status: "in_progress", controls: { implemented: 168, in_progress: 84, not_started: 78, not_applicable: 21 }, lead: "David Reyes", started: "2025-11-01", due: "2026-02-28", fwColor: "bg-orange-50 text-orange-700" },
  { id: "5", name: "HIPAA Security Rule Assessment", framework: "HIPAA", score: null, status: "draft", controls: { implemented: 0, in_progress: 0, not_started: 54, not_applicable: 0 }, lead: "—", started: "—", due: "2026-06-30", fwColor: "bg-red-50 text-red-700" },
  { id: "6", name: "NIST CSF 2.0 Gap Analysis", framework: "NIST CSF", score: 79, status: "under_review", controls: { implemented: 84, in_progress: 12, not_started: 6, not_applicable: 4 }, lead: "Emma Wilson", started: "2025-08-01", due: "2026-01-15", fwColor: "bg-indigo-50 text-indigo-700" },
];

const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  draft:        { label: "Draft",        icon: XCircle,    color: "text-gray-500 bg-gray-100"   },
  in_progress:  { label: "In Progress",  icon: Clock,      color: "text-blue-600 bg-blue-50"    },
  under_review: { label: "Under Review", icon: AlertCircle,color: "text-orange-600 bg-orange-50"},
  completed:    { label: "Completed",    icon: CheckCircle,color: "text-green-600 bg-green-50"  },
};

const CONTROL_SEGMENTS = [
  { key: "implemented" as const,   label: "Implemented", color: "bg-green-500" },
  { key: "in_progress" as const,   label: "In Progress", color: "bg-blue-400"  },
  { key: "not_started" as const,   label: "Not Started", color: "bg-gray-200"  },
  { key: "not_applicable" as const,label: "N/A",         color: "bg-gray-100 border border-gray-200" },
];

function scoreColor(score: number) {
  if (score >= 80) return "text-green-700 bg-green-50";
  if (score >= 60) return "text-yellow-700 bg-yellow-50";
  return "text-red-700 bg-red-50";
}

function ScoreBadge({ score }: { readonly score: number | null }) {
  if (score === null) return <span className="text-gray-400 text-sm italic">Not started</span>;
  return <span className={`text-xl font-bold px-3 py-1.5 rounded-xl ${scoreColor(score)}`}>{score}%</span>;
}

function StatusBadge({ status }: { readonly status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
      <s.icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

export default function CompliancePage() {
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = ASSESSMENTS.filter(a =>
    statusFilter === "all" || a.status === statusFilter
  );

  const totalImplemented = ASSESSMENTS.reduce((s, a) => s + a.controls.implemented, 0);
  const totalControls    = ASSESSMENTS.reduce((s, a) =>
    s + Object.values(a.controls).reduce((x, v) => x + v, 0), 0);
  const avgScore = Math.round(
    ASSESSMENTS.filter(a => a.score !== null).reduce((s, a) => s + (a.score ?? 0), 0) /
    ASSESSMENTS.filter(a => a.score !== null).length
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Assessments</h1>
          <p className="text-gray-500 text-sm mt-1">
            {ASSESSMENTS.length} assessments · {ASSESSMENTS.filter(a => a.status === "in_progress").length} in progress
          </p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          New Assessment
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Avg. Score",         value: `${avgScore}%`,    sub: "across active assessments" },
          { label: "Controls Implemented",value: totalImplemented, sub: `of ${totalControls} total` },
          { label: "Completed",          value: ASSESSMENTS.filter(a => a.status === "completed").length, sub: "assessments" },
          { label: "Overdue",            value: 1,                 sub: "requires attention" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { key: "all",          label: "All"          },
          { key: "in_progress",  label: "In Progress"  },
          { key: "under_review", label: "Under Review" },
          { key: "completed",    label: "Completed"    },
          { key: "draft",        label: "Draft"        },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === t.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Assessment cards */}
      <div className="space-y-4">
        {filtered.map((a) => {
          const total = Object.values(a.controls).reduce((s, v) => s + v, 0);
          const implementedPct = total > 0 ? Math.round((a.controls.implemented / total) * 100) : 0;

          return (
            <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group">
              {/* Top row */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{a.name}</h3>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    <span className={`font-semibold px-2 py-0.5 rounded-md ${a.fwColor}`}>{a.framework}</span>
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{a.lead}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Due {a.due}</span>
                  </div>
                </div>
                <ScoreBadge score={a.score} />
              </div>

              {/* Segmented progress bar */}
              <div className="mb-3">
                <div className="flex h-3 rounded-full overflow-hidden gap-px bg-gray-100">
                  {CONTROL_SEGMENTS.map(seg =>
                    a.controls[seg.key] > 0 ? (
                      <div
                        key={seg.key}
                        className={`${seg.color} transition-all`}
                        style={{ flex: a.controls[seg.key] }}
                        title={`${seg.label}: ${a.controls[seg.key]}`}
                      />
                    ) : null
                  )}
                </div>
              </div>

              {/* Legend + coverage */}
              <div className="flex flex-wrap items-center gap-5 text-xs">
                {CONTROL_SEGMENTS.map(seg => (
                  <div key={seg.key} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${seg.color.split(" ")[0]}`} />
                    <span className="text-gray-400">{seg.label}:</span>
                    <strong className="text-gray-700">{a.controls[seg.key]}</strong>
                  </div>
                ))}
                <div className="ml-auto font-semibold text-gray-700">{implementedPct}% implemented</div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">No assessments match this filter</div>
      )}
    </div>
  );
}
