import { useState } from "react";
import { Globe, BookOpen, CheckCircle, Search, ArrowRight, Lock } from "lucide-react";

type FwStatus = "active" | "coming_soon";

interface Framework {
  name: string;
  short: string;
  region: string;
  controls: number;
  assessable: number;
  status: FwStatus;
  loaded: boolean;
  description: string;
  category: string;
  color: string;
  bgColor: string;
}

// Real control counts from CISO Assistant YAML files
const FRAMEWORKS: Framework[] = [
  { name: "ISO/IEC 27001:2022", short: "ISO 27001", region: "Global", controls: 140, assessable: 123, status: "active", loaded: true, description: "Information Security Management System — annex A controls & clauses", category: "Security", color: "text-blue-600", bgColor: "bg-blue-50" },
  { name: "NIST CSF 2.0", short: "NIST CSF", region: "Global", controls: 134, assessable: 106, status: "active", loaded: true, description: "Cybersecurity Framework — Govern, Identify, Protect, Detect, Respond, Recover", category: "Security", color: "text-indigo-600", bgColor: "bg-indigo-50" },
  { name: "SOC 2 (2017 + Rev 2022)", short: "SOC 2", region: "US", controls: 375, assessable: 301, status: "active", loaded: true, description: "Service Organization Controls — Trust Service Criteria", category: "Audit", color: "text-purple-600", bgColor: "bg-purple-50" },
  { name: "GDPR", short: "GDPR", region: "EU", controls: 1090, assessable: 287, status: "active", loaded: true, description: "General Data Protection Regulation — EU privacy & data protection law", category: "Privacy", color: "text-emerald-600", bgColor: "bg-emerald-50" },
  { name: "PCI DSS 4.0", short: "PCI DSS", region: "Global", controls: 373, assessable: 351, status: "active", loaded: true, description: "Payment Card Industry Data Security Standard v4.0", category: "Finance", color: "text-orange-600", bgColor: "bg-orange-50" },
  { name: "NIST SP 800-53 Rev 5", short: "NIST 800-53", region: "US Gov", controls: 1209, assessable: 1189, status: "active", loaded: true, description: "Security & Privacy Controls for Federal Information Systems", category: "Government", color: "text-slate-600", bgColor: "bg-slate-50" },
  { name: "NIS2 Directive", short: "NIS2", region: "EU", controls: 17, assessable: 13, status: "active", loaded: true, description: "Network & Information Security Directive 2 — EU critical infrastructure", category: "Regulation", color: "text-teal-600", bgColor: "bg-teal-50" },
  { name: "HIPAA", short: "HIPAA", region: "US", controls: 54, assessable: 54, status: "active", loaded: false, description: "Health Insurance Portability & Accountability Act — healthcare data protection", category: "Healthcare", color: "text-red-600", bgColor: "bg-red-50" },
  { name: "CIS Controls v8", short: "CIS 18", region: "Global", controls: 153, assessable: 153, status: "active", loaded: false, description: "Center for Internet Security — 18 critical security controls", category: "Security", color: "text-cyan-600", bgColor: "bg-cyan-50" },
  { name: "DORA", short: "DORA", region: "EU Finance", controls: 58, assessable: 58, status: "coming_soon", loaded: false, description: "Digital Operational Resilience Act — EU financial sector ICT resilience", category: "Finance", color: "text-yellow-600", bgColor: "bg-yellow-50" },
  { name: "NIST AI RMF", short: "AI RMF", region: "Global", controls: 72, assessable: 72, status: "coming_soon", loaded: false, description: "AI Risk Management Framework — responsible AI governance", category: "AI", color: "text-pink-600", bgColor: "bg-pink-50" },
  { name: "ISO 42001 (AI)", short: "ISO 42001", region: "Global", controls: 38, assessable: 38, status: "coming_soon", loaded: false, description: "AI Management System standard — governance of AI systems", category: "AI", color: "text-violet-600", bgColor: "bg-violet-50" },
];

const CATEGORIES = ["All", "Security", "Privacy", "Audit", "Finance", "Government", "Healthcare", "Regulation", "AI"];

function FrameworkCard({ fw }: { readonly fw: Framework }) {
  const coveragePct = fw.assessable > 0 ? Math.round((fw.assessable / fw.controls) * 100) : 0;
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all cursor-pointer group relative overflow-hidden ${fw.status === "coming_soon" ? "opacity-75" : ""}`}>
      {fw.status === "coming_soon" && (
        <div className="absolute top-3 right-3">
          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
            <Lock className="w-2.5 h-2.5" /> Soon
          </span>
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${fw.bgColor} group-hover:scale-105 transition-transform`}>
            <BookOpen className={`w-5 h-5 ${fw.color}`} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm leading-tight">{fw.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${fw.bgColor} ${fw.color}`}>
                {fw.category}
              </span>
              <span className="flex items-center gap-0.5 text-xs text-gray-400">
                <Globe className="w-3 h-3" />
                {fw.region}
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-4 leading-relaxed line-clamp-2">{fw.description}</p>

        {/* Control stats */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <p className="text-lg font-bold text-gray-900">{fw.controls.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Total controls</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <p className={`text-lg font-bold ${fw.color}`}>{fw.assessable.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Assessable</p>
          </div>
        </div>

        {/* Assessable coverage bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Assessable coverage</span>
            <span className="font-medium">{coveragePct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${fw.loaded ? "bg-green-500" : "bg-blue-400"}`}
              style={{ width: `${coveragePct}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {fw.loaded ? (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle className="w-3.5 h-3.5" /> YAML loaded
              </span>
            ) : (
              <span className="text-xs text-gray-400">Not loaded</span>
            )}
          </div>
          {fw.status === "active" ? (
            <button className={`flex items-center gap-1 text-xs font-semibold ${fw.color} group-hover:gap-2 transition-all`}>
              Start Assessment <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <span className="text-xs text-gray-400">Coming soon</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FrameworksPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const filtered = FRAMEWORKS.filter(fw => {
    const matchSearch = fw.name.toLowerCase().includes(search.toLowerCase()) ||
      fw.description.toLowerCase().includes(search.toLowerCase()) ||
      fw.short.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "All" || fw.category === category;
    return matchSearch && matchCat;
  });

  const active = filtered.filter(f => f.status === "active");
  const coming = filtered.filter(f => f.status === "coming_soon");
  const loadedCount = FRAMEWORKS.filter(f => f.loaded).length;
  const totalAssessable = FRAMEWORKS.filter(f => f.loaded).reduce((s, f) => s + f.assessable, 0);

  return (
    <div className="p-8 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Frameworks</h1>
          <p className="text-gray-500 text-sm mt-1">
            {loadedCount} frameworks loaded · {totalAssessable.toLocaleString()} total assessable controls
          </p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <BookOpen className="w-4 h-4" />
          Request Framework
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Frameworks Available", value: FRAMEWORKS.filter(f => f.status === "active").length, sub: "ready to use" },
          { label: "YAML Libraries Loaded", value: loadedCount, sub: "from CISO Assistant" },
          { label: "Assessable Controls", value: totalAssessable.toLocaleString(), sub: "across loaded frameworks" },
          { label: "Coming Soon", value: FRAMEWORKS.filter(f => f.status === "coming_soon").length, sub: "in development" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + Category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search frameworks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                category === cat
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Active frameworks */}
      {active.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Available Frameworks</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{active.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.map(fw => <FrameworkCard key={fw.short} fw={fw} />)}
          </div>
        </>
      )}

      {/* Coming soon */}
      {coming.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Coming Soon</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{coming.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {coming.map(fw => <FrameworkCard key={fw.short} fw={fw} />)}
          </div>
        </>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">No frameworks match your search</div>
      )}
    </div>
  );
}
