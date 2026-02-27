import { useState } from "react";
import { Building2, Plus, Globe, AlertTriangle, Search, ShieldCheck, ShieldX } from "lucide-react";

const VENDORS = [
  { id: "1", name: "AWS (Amazon Web Services)", industry: "Cloud Infrastructure",     country: "US", tier: "critical", status: "active",       risk_score: 18, dpa: true,  contract_expiry: "2026-12-31", services: "Cloud hosting, storage, compute" },
  { id: "2", name: "Stripe",                    industry: "Payment Processing",        country: "US", tier: "critical", status: "active",       risk_score: 22, dpa: true,  contract_expiry: "2026-06-30", services: "Payment processing, billing" },
  { id: "3", name: "Okta",                      industry: "Identity & Access Mgmt",    country: "US", tier: "high",     status: "active",       risk_score: 15, dpa: true,  contract_expiry: "2026-03-15", services: "SSO, MFA, identity" },
  { id: "4", name: "SendGrid (Twilio)",          industry: "Email Services",            country: "US", tier: "medium",   status: "active",       risk_score: 8,  dpa: true,  contract_expiry: "2026-01-31", services: "Transactional email" },
  { id: "5", name: "DataAnalytics Co.",          industry: "Analytics",                 country: "FR", tier: "high",     status: "under_review", risk_score: 28, dpa: false, contract_expiry: "2025-12-31", services: "Business analytics, reporting" },
  { id: "6", name: "CloudBackup Ltd.",           industry: "Data Backup",               country: "DE", tier: "medium",   status: "active",       risk_score: 12, dpa: true,  contract_expiry: "2026-09-01", services: "Offsite backup storage" },
  { id: "7", name: "Salesforce",                 industry: "CRM / SaaS",                country: "US", tier: "high",     status: "active",       risk_score: 11, dpa: true,  contract_expiry: "2026-11-30", services: "CRM platform" },
  { id: "8", name: "PenTest Corp",               industry: "Security Services",          country: "UK", tier: "low",      status: "onboarding",   risk_score: 5,  dpa: true,  contract_expiry: "2026-05-01", services: "Penetration testing" },
];

type Tier   = "critical" | "high" | "medium" | "low";
type Status = "active" | "under_review" | "onboarding" | "offboarding" | "inactive";

const TIER_BADGE: Record<Tier, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-100 text-orange-700 border-orange-200",
  medium:   "bg-yellow-100 text-yellow-700 border-yellow-200",
  low:      "bg-green-100 text-green-700 border-green-200",
};

const STATUS_BADGE: Record<Status, string> = {
  active:       "bg-green-100 text-green-700",
  under_review: "bg-orange-100 text-orange-700",
  onboarding:   "bg-blue-100 text-blue-700",
  offboarding:  "bg-gray-100 text-gray-600",
  inactive:     "bg-gray-100 text-gray-400",
};

function riskScoreColor(score: number) {
  if (score > 20) return "text-red-600 bg-red-50";
  if (score > 12) return "text-orange-600 bg-orange-50";
  if (score > 6)  return "text-yellow-600 bg-yellow-50";
  return "text-green-600 bg-green-50";
}

export default function VendorsPage() {
  const [search, setSearch] = useState("");
  const [tierFilter, setTier] = useState("all");

  const filtered = VENDORS.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.industry.toLowerCase().includes(search.toLowerCase());
    const matchTier = tierFilter === "all" || v.tier === tierFilter;
    return matchSearch && matchTier;
  });

  const tierCounts = {
    critical: VENDORS.filter(v => v.tier === "critical").length,
    high:     VENDORS.filter(v => v.tier === "high").length,
    medium:   VENDORS.filter(v => v.tier === "medium").length,
    low:      VENDORS.filter(v => v.tier === "low").length,
  };

  const missingDpa = VENDORS.filter(v => !v.dpa).length;
  const avgScore   = Math.round(VENDORS.reduce((s, v) => s + v.risk_score, 0) / VENDORS.length);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Risk Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            {VENDORS.length} vendors · {VENDORS.filter(v => v.tier === "critical").length} critical · {missingDpa} missing DPA
          </p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          Add Vendor
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Vendors",   value: VENDORS.length,       sub: "third parties" },
          { label: "Avg Risk Score",  value: avgScore,             sub: "across all vendors" },
          { label: "Missing DPA",     value: missingDpa,           sub: "data processing agreements" },
          { label: "Under Review",    value: VENDORS.filter(v => v.status === "under_review").length, sub: "require assessment" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Tier filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search vendors..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          {([
            { key: "all",      label: "All",      count: VENDORS.length, cls: "" },
            { key: "critical", label: "Critical", count: tierCounts.critical, cls: "text-red-700 border-red-200 bg-red-50" },
            { key: "high",     label: "High",     count: tierCounts.high,     cls: "text-orange-700 border-orange-200 bg-orange-50" },
            { key: "medium",   label: "Medium",   count: tierCounts.medium,   cls: "text-yellow-700 border-yellow-200 bg-yellow-50" },
            { key: "low",      label: "Low",      count: tierCounts.low,      cls: "text-green-700 border-green-200 bg-green-50" },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTier(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                tierFilter === t.key
                  ? "bg-blue-600 text-white border-blue-600"
                  : `bg-white text-gray-600 border-gray-200 hover:bg-gray-50`
              }`}
            >
              {t.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${tierFilter === t.key ? "bg-white/20" : "bg-gray-100 text-gray-600"}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Vendors table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3.5">Vendor</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Risk Tier</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Status</th>
              <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Risk Score</th>
              <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">DPA</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Contract Expiry</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">Services</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50 cursor-pointer transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-slate-200 transition-colors">
                      <Building2 className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">{v.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        <span>{v.industry}</span>
                        <span className="flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5" />{v.country}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${TIER_BADGE[v.tier as Tier]}`}>
                    {v.tier}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_BADGE[v.status as Status]}`}>
                    {v.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-4 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    {v.risk_score > 20 && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${riskScoreColor(v.risk_score)}`}>
                      {v.risk_score}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-4 text-center">
                  {v.dpa ? (
                    <ShieldCheck className="w-4 h-4 text-green-500 mx-auto" />
                  ) : (
                    <ShieldX className="w-4 h-4 text-red-500 mx-auto" />
                  )}
                </td>
                <td className="px-4 py-4 text-xs text-gray-500">{v.contract_expiry}</td>
                <td className="px-4 py-4 text-xs text-gray-400 max-w-[160px] truncate">{v.services}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">No vendors match your filters</div>
        )}
      </div>
    </div>
  );
}
