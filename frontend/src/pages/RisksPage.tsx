import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { risksApi } from "../api/endpoints";
import type { Risk, RiskSeverity } from "../types";

const SEV_BADGE: Record<RiskSeverity, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
  info: "bg-gray-100 text-gray-600 border-gray-200",
};

const SEV_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-green-500",
};

const SEV_ICON: Record<string, string> = {
  critical: "text-red-500",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-green-500",
};

// Heatmap cell color: likelihood (1-5) × impact (1-5)
function heatmapColor(l: number, i: number): string {
  const score = l * i;
  if (score >= 20) return "bg-red-500 text-white";
  if (score >= 15) return "bg-red-400 text-white";
  if (score >= 10) return "bg-orange-400 text-white";
  if (score >= 6)  return "bg-yellow-400 text-gray-900";
  if (score >= 3)  return "bg-yellow-200 text-gray-700";
  return "bg-green-100 text-gray-600";
}

function heatmapLabel(l: number, i: number): string {
  const score = l * i;
  if (score >= 20) return "Critical";
  if (score >= 15) return "High";
  if (score >= 10) return "High";
  if (score >= 6)  return "Medium";
  if (score >= 3)  return "Low";
  return "Low";
}

const DEMO_RISKS: Risk[] = [
  { id: "1", tenant_id: "t1", title: "Unpatched critical vulnerabilities in production servers", description: "Several production servers have not received security patches in over 90 days.", risk_category: "Technical", status: "identified", likelihood: 4, impact: 5, inherent_risk_score: 20, severity: "critical", tags: ["patch-management", "infrastructure"], linked_controls: ["A.8.8"], linked_assets: [], created_at: "2025-11-01", updated_at: "2025-11-01" },
  { id: "2", tenant_id: "t1", title: "Insufficient access controls on cloud storage buckets", description: "S3 buckets containing customer PII may be publicly accessible.", risk_category: "Access Control", status: "treatment_planned", likelihood: 3, impact: 5, inherent_risk_score: 15, severity: "high", tags: ["cloud", "data-protection"], linked_controls: ["A.5.15", "A.8.3"], linked_assets: [], created_at: "2025-10-15", updated_at: "2025-11-05" },
  { id: "3", tenant_id: "t1", title: "Lack of MFA for privileged accounts", description: "Administrative accounts do not require multi-factor authentication.", risk_category: "Identity & Access", status: "in_progress", likelihood: 3, impact: 4, inherent_risk_score: 12, severity: "high", tags: ["mfa", "privileged-access"], linked_controls: ["A.8.2", "A.5.17"], linked_assets: [], created_at: "2025-09-20", updated_at: "2025-11-10" },
  { id: "4", tenant_id: "t1", title: "Missing data backup and recovery procedures", description: "No documented and tested backup procedures exist for critical systems.", risk_category: "Business Continuity", status: "identified", likelihood: 2, impact: 5, inherent_risk_score: 10, severity: "medium", tags: ["backup", "recovery"], linked_controls: ["A.5.29"], linked_assets: [], created_at: "2025-10-01", updated_at: "2025-10-01" },
  { id: "5", tenant_id: "t1", title: "Third-party vendor without security assessment", description: "Key payment processing vendor has not undergone a security risk assessment.", risk_category: "Vendor Risk", status: "assessed", likelihood: 2, impact: 4, inherent_risk_score: 8, severity: "medium", tags: ["vendor", "tprm"], linked_controls: [], linked_assets: [], created_at: "2025-10-22", updated_at: "2025-11-08" },
  { id: "6", tenant_id: "t1", title: "Employees not completing security awareness training", description: "Less than 60% of employees have completed mandatory security training.", risk_category: "People", status: "treatment_in_progress", likelihood: 3, impact: 3, inherent_risk_score: 9, severity: "medium", tags: ["training", "awareness"], linked_controls: ["A.6.3"], linked_assets: [], created_at: "2025-08-15", updated_at: "2025-11-01" },
  { id: "7", tenant_id: "t1", title: "Outdated incident response plan", description: "The incident response plan has not been reviewed or tested in over 2 years.", risk_category: "Incident Management", status: "identified", likelihood: 2, impact: 3, inherent_risk_score: 6, severity: "low", tags: ["incident-response"], linked_controls: ["A.5.28"], linked_assets: [], created_at: "2025-11-12", updated_at: "2025-11-12" },
];

function RiskHeatmap({ risks, onCellClick }: { readonly risks: Risk[]; readonly onCellClick: (l: number, i: number) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Risk Heat Map</h3>
          <p className="text-xs text-gray-400 mt-0.5">Click a cell to filter by likelihood &times; impact</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 inline-block" /> Low</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-300 inline-block" /> Medium</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block" /> High</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> Critical</span>
        </div>
      </div>
      <div className="flex gap-2">
        {/* Y-axis label */}
        <div className="flex flex-col justify-center items-center w-6 gap-0">
          <span className="text-xs text-gray-400 -rotate-90 whitespace-nowrap mt-auto mb-auto select-none" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            Likelihood →
          </span>
        </div>
        <div className="flex-1">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "auto repeat(5, 1fr)" }}>
            {/* Column headers (Impact) */}
            <div />
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="text-center text-xs text-gray-400 pb-1 font-medium">{i}</div>
            ))}
            {/* Rows: likelihood 5→1 */}
            {[5, 4, 3, 2, 1].map(l => (
              <>
                <div key={`l${l}`} className="flex items-center justify-end pr-2 text-xs text-gray-400 font-medium">{l}</div>
                {[1, 2, 3, 4, 5].map(impact => {
                  const count = risks.filter(r => r.likelihood === l && r.impact === impact).length;
                  return (
                    <button
                      key={`${l}-${impact}`}
                      onClick={() => onCellClick(l, impact)}
                      className={`relative rounded-lg h-12 flex items-center justify-center font-bold text-sm transition-all hover:ring-2 hover:ring-blue-400 hover:ring-offset-1 ${heatmapColor(l, impact)} ${count > 0 ? "shadow-sm" : "opacity-60"}`}
                      title={`Likelihood ${l} × Impact ${impact} = ${heatmapLabel(l, impact)} (${count} risk${count !== 1 ? "s" : ""})`}
                    >
                      {count > 0 ? count : ""}
                    </button>
                  );
                })}
              </>
            ))}
          </div>
          <div className="text-center text-xs text-gray-400 mt-2">Impact →</div>
        </div>
      </div>
    </div>
  );
}

export default function RisksPage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [heatmapFilter, setHeatmapFilter] = useState<{ l: number; i: number } | null>(null);

  const { data, isError } = useQuery({
    queryKey: ["risks"],
    queryFn: () => risksApi.list(),
    retry: false,
  });

  const risks = (isError || !data?.items?.length) ? DEMO_RISKS : data.items;

  const filtered = risks.filter((r) => {
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.risk_category ?? "").toLowerCase().includes(search.toLowerCase());
    const matchSeverity = severityFilter === "all" || r.severity === severityFilter;
    const matchHeatmap = !heatmapFilter || (r.likelihood === heatmapFilter.l && r.impact === heatmapFilter.i);
    return matchSearch && matchSeverity && matchHeatmap;
  });

  const counts = {
    critical: risks.filter(r => r.severity === "critical").length,
    high:     risks.filter(r => r.severity === "high").length,
    medium:   risks.filter(r => r.severity === "medium").length,
    low:      risks.filter(r => r.severity === "low").length,
  };

  function handleCellClick(l: number, i: number) {
    setHeatmapFilter(prev => (prev?.l === l && prev?.i === i) ? null : { l, i });
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Risk Register</h1>
          <p className="text-gray-500 text-sm mt-1">{risks.length} risks tracked</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          Add Risk
        </button>
      </div>

      {/* Severity summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {(["critical", "high", "medium", "low"] as const).map((sev) => {
          const active = severityFilter === sev;
          return (
            <button
              key={sev}
              onClick={() => setSeverityFilter(active ? "all" : sev)}
              className={`p-4 rounded-2xl border text-left transition-all hover:shadow-md ${
                active ? SEV_BADGE[sev] + " shadow-sm" : "bg-white border-gray-100 shadow-sm"
              }`}
            >
              <p className="text-2xl font-bold text-gray-900">{counts[sev]}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2 h-2 rounded-full ${SEV_DOT[sev]}`} />
                <p className="text-sm capitalize text-gray-500">{sev}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Heatmap + Filters row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RiskHeatmap risks={risks} onCellClick={handleCellClick} />

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Filter Risks</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by title or category..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">Severity</label>
              <div className="flex flex-wrap gap-2">
                {(["all", "critical", "high", "medium", "low"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors border ${
                      severityFilter === s
                        ? s === "all" ? "bg-gray-900 text-white border-gray-900" : SEV_BADGE[s as RiskSeverity]
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    {s === "all" ? "All" : s}
                  </button>
                ))}
              </div>
            </div>
            {heatmapFilter && (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <span className="text-xs text-blue-700 font-medium">
                  Heatmap filter: L{heatmapFilter.l} &times; I{heatmapFilter.i}
                </span>
                <button onClick={() => setHeatmapFilter(null)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  Clear
                </button>
              </div>
            )}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Showing <span className="font-semibold text-gray-900">{filtered.length}</span> of{" "}
                <span className="font-semibold text-gray-900">{risks.length}</span> risks
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Risk table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3.5">Risk</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Category</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Severity</th>
              <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">L × I</th>
              <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Score</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Status</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((risk) => (
              <tr key={risk.id} className="hover:bg-gray-50 cursor-pointer transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${SEV_ICON[risk.severity ?? "low"]}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900 leading-snug group-hover:text-blue-700 transition-colors">{risk.title}</p>
                      {risk.description && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{risk.description}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-gray-500 whitespace-nowrap">{risk.risk_category ?? "—"}</td>
                <td className="px-4 py-4">
                  {risk.severity && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize ${SEV_BADGE[risk.severity]}`}>
                      {risk.severity}
                    </span>
                  )}
                </td>
                <td className="px-4 py-4 text-center">
                  {risk.likelihood && risk.impact ? (
                    <span className="text-xs font-semibold text-gray-500">{risk.likelihood} × {risk.impact}</span>
                  ) : "—"}
                </td>
                <td className="px-4 py-4 text-center">
                  {risk.inherent_risk_score != null && (
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${
                      risk.inherent_risk_score >= 20 ? "bg-red-100 text-red-700" :
                      risk.inherent_risk_score >= 12 ? "bg-orange-100 text-orange-700" :
                      risk.inherent_risk_score >= 6  ? "bg-yellow-100 text-yellow-700" :
                                                        "bg-green-100 text-green-700"
                    }`}>
                      {risk.inherent_risk_score}
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  <span className="text-xs text-gray-500 capitalize">{risk.status.replaceAll("_", " ")}</span>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-1">
                    {risk.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-md">
                        {tag}
                      </span>
                    ))}
                    {risk.tags.length > 2 && (
                      <span className="text-xs text-gray-400">+{risk.tags.length - 2}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">No risks match your filters</div>
        )}
      </div>
    </div>
  );
}
