import { useState } from "react";
import { FileText, Plus, CheckCircle, Clock, AlertCircle, User, Calendar, Link2 } from "lucide-react";

const POLICIES = [
  { id: "1", title: "Information Security Policy",         category: "Security",       version: 3, status: "published", owner: "CISO",         attestation_rate: 94, linked_controls: 12, next_review: "2026-06-01" },
  { id: "2", title: "Acceptable Use Policy",               category: "HR",             version: 2, status: "published", owner: "HR Director",   attestation_rate: 87, linked_controls: 5,  next_review: "2026-03-01" },
  { id: "3", title: "Data Classification Policy",          category: "Data Governance",version: 1, status: "approved",  owner: "DPO",           attestation_rate: null, linked_controls: 8, next_review: "2026-06-01" },
  { id: "4", title: "Incident Response Policy",            category: "Security",       version: 4, status: "in_review", owner: "SOC Lead",      attestation_rate: null, linked_controls: 7, next_review: "2026-01-15" },
  { id: "5", title: "Third-Party Risk Management Policy",  category: "Vendor Risk",    version: 1, status: "draft",     owner: "Procurement",   attestation_rate: null, linked_controls: 4, next_review: "—" },
  { id: "6", title: "Access Control Policy",               category: "Security",       version: 2, status: "published", owner: "IT Manager",    attestation_rate: 78, linked_controls: 15, next_review: "2026-04-01" },
  { id: "7", title: "Business Continuity Plan",            category: "BCP / DR",       version: 1, status: "approved",  owner: "COO",           attestation_rate: null, linked_controls: 9, next_review: "2026-09-01" },
];

const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  draft:     { label: "Draft",     icon: Clock,       color: "bg-gray-100 text-gray-500"    },
  in_review: { label: "In Review", icon: AlertCircle, color: "bg-orange-100 text-orange-600"},
  approved:  { label: "Approved",  icon: CheckCircle, color: "bg-blue-100 text-blue-600"    },
  published: { label: "Published", icon: CheckCircle, color: "bg-green-100 text-green-600"  },
  retired:   { label: "Retired",   icon: Clock,       color: "bg-gray-100 text-gray-400"    },
};

const CAT_COLORS: Record<string, string> = {
  Security:         "bg-blue-50 text-blue-700",
  HR:               "bg-pink-50 text-pink-700",
  "Data Governance":"bg-emerald-50 text-emerald-700",
  "Vendor Risk":    "bg-orange-50 text-orange-700",
  "BCP / DR":       "bg-purple-50 text-purple-700",
};

function attestationColor(rate: number) {
  if (rate >= 90) return "bg-green-500";
  if (rate >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

export default function PoliciesPage() {
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = POLICIES.filter(p =>
    statusFilter === "all" || p.status === statusFilter
  );

  const published = POLICIES.filter(p => p.status === "published");
  const avgAttestation = Math.round(
    published.filter(p => p.attestation_rate != null)
      .reduce((s, p) => s + (p.attestation_rate ?? 0), 0) /
    published.filter(p => p.attestation_rate != null).length
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Policy Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            {published.length} published · {POLICIES.filter(p => p.status === "in_review").length} under review
          </p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          New Policy
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Policies",      value: POLICIES.length,  sub: "in library" },
          { label: "Published",           value: published.length, sub: "live & effective" },
          { label: "Avg. Attestation",    value: `${avgAttestation}%`, sub: "published policies" },
          { label: "Pending Review",      value: POLICIES.filter(p => p.status === "in_review" || p.status === "draft").length, sub: "need action" },
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
          { key: "all",       label: "All"        },
          { key: "published", label: "Published"  },
          { key: "approved",  label: "Approved"   },
          { key: "in_review", label: "In Review"  },
          { key: "draft",     label: "Draft"      },
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

      {/* Policies table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3.5">Policy</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Category</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Status</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Attestation</th>
              <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Controls</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Next Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((p) => {
              const s = STATUS_MAP[p.status] ?? STATUS_MAP.draft;
              return (
                <tr key={p.id} className="hover:bg-gray-50 cursor-pointer transition-colors group">
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
                      <s.icon className="w-3 h-3" />
                      {s.label}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {p.attestation_rate != null ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${attestationColor(p.attestation_rate)}`}
                            style={{ width: `${p.attestation_rate}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">{p.attestation_rate}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="flex items-center justify-center gap-1 text-xs text-gray-600">
                      <Link2 className="w-3 h-3 text-gray-400" />
                      {p.linked_controls}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {p.next_review === "—" ? (
                      <span className="text-xs text-gray-300">—</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Calendar className="w-3 h-3 text-gray-400" />
                        {p.next_review}
                      </span>
                    )}
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
    </div>
  );
}
