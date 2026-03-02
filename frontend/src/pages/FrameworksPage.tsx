import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe, BookOpen, CheckCircle, Search, ArrowRight, Lock,
  Plus, Loader2, Trash2, AlertCircle, RefreshCw,
} from "lucide-react";
import { frameworksApi } from "@/api/endpoints";
import type { Framework } from "@/types";

// Well-known frameworks shown as reference cards (not from DB)
const BUILTIN_CATALOG = [
  { name: "ISO/IEC 27001:2022",    short: "ISO 27001",  region: "Global",   controls: 140,  category: "Security",    color: "text-blue-600",    bgColor: "bg-blue-50",    description: "Information Security Management System — annex A controls & clauses" },
  { name: "NIST CSF 2.0",          short: "NIST CSF",   region: "Global",   controls: 134,  category: "Security",    color: "text-indigo-600",  bgColor: "bg-indigo-50",  description: "Cybersecurity Framework — Govern, Identify, Protect, Detect, Respond, Recover" },
  { name: "SOC 2 (2017 + Rev 2022)",short: "SOC 2",     region: "US",       controls: 375,  category: "Audit",       color: "text-purple-600",  bgColor: "bg-purple-50",  description: "Service Organization Controls — Trust Service Criteria" },
  { name: "GDPR",                   short: "GDPR",       region: "EU",       controls: 1090, category: "Privacy",     color: "text-emerald-600", bgColor: "bg-emerald-50", description: "General Data Protection Regulation — EU privacy & data protection law" },
  { name: "PCI DSS 4.0",            short: "PCI DSS",    region: "Global",   controls: 373,  category: "Finance",     color: "text-orange-600",  bgColor: "bg-orange-50",  description: "Payment Card Industry Data Security Standard v4.0" },
  { name: "NIST SP 800-53 Rev 5",   short: "NIST 800-53",region: "US Gov",  controls: 1209, category: "Government",  color: "text-slate-600",   bgColor: "bg-slate-50",   description: "Security & Privacy Controls for Federal Information Systems" },
  { name: "NIS2 Directive",         short: "NIS2",       region: "EU",       controls: 17,   category: "Regulation",  color: "text-teal-600",    bgColor: "bg-teal-50",    description: "Network & Information Security Directive 2 — EU critical infrastructure" },
  { name: "HIPAA",                  short: "HIPAA",      region: "US",       controls: 54,   category: "Healthcare",  color: "text-red-600",     bgColor: "bg-red-50",     description: "Health Insurance Portability & Accountability Act" },
  { name: "CIS Controls v8",        short: "CIS 18",     region: "Global",   controls: 153,  category: "Security",    color: "text-cyan-600",    bgColor: "bg-cyan-50",    description: "Center for Internet Security — 18 critical security controls" },
  { name: "DORA",                   short: "DORA",       region: "EU Finance",controls: 58,  category: "Finance",     color: "text-yellow-600",  bgColor: "bg-yellow-50",  description: "Digital Operational Resilience Act — EU financial sector ICT resilience", comingSoon: true },
  { name: "NIST AI RMF",            short: "AI RMF",     region: "Global",   controls: 72,   category: "AI",          color: "text-pink-600",    bgColor: "bg-pink-50",    description: "AI Risk Management Framework — responsible AI governance", comingSoon: true },
  { name: "ISO 42001 (AI)",         short: "ISO 42001",  region: "Global",   controls: 38,   category: "AI",          color: "text-violet-600",  bgColor: "bg-violet-50",  description: "AI Management System standard — governance of AI systems", comingSoon: true },
];

const CATEGORIES = ["All", "Security", "Privacy", "Audit", "Finance", "Government", "Healthcare", "Regulation", "AI"];

const CAT_COLORS: Record<string, { color: string; bg: string }> = {
  Security:    { color: "text-blue-600",    bg: "bg-blue-50"    },
  Privacy:     { color: "text-emerald-600", bg: "bg-emerald-50" },
  Audit:       { color: "text-purple-600",  bg: "bg-purple-50"  },
  Finance:     { color: "text-orange-600",  bg: "bg-orange-50"  },
  Government:  { color: "text-slate-600",   bg: "bg-slate-50"   },
  Healthcare:  { color: "text-red-600",     bg: "bg-red-50"     },
  Regulation:  { color: "text-teal-600",    bg: "bg-teal-50"    },
  AI:          { color: "text-violet-600",  bg: "bg-violet-50"  },
};

function getCatStyle(category: string | null) {
  return CAT_COLORS[category ?? ""] ?? { color: "text-gray-600", bg: "bg-gray-50" };
}

// ── Custom Framework card (from DB) ─────────────────────────────────────────
function CustomFrameworkCard({
  fw,
  onDelete,
  onAssess,
}: {
  readonly fw: Framework;
  readonly onDelete: (id: string) => void;
  readonly onAssess: (fw: Framework) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const style = getCatStyle(null);

  async function handleDelete() {
    setDeleting(true);
    try {
      await frameworksApi.delete(fw.id);
      onDelete(fw.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all group relative overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${style.bg}`}>
              <BookOpen className={`w-5 h-5 ${style.color}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm leading-tight">{fw.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{fw.short_name}</span>
                <span className="text-xs text-gray-400">v{fw.version}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  fw.status === "active" ? "bg-green-50 text-green-600" : "bg-yellow-50 text-yellow-600"
                }`}>{fw.status}</span>
              </div>
            </div>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? "..." : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
              title="Delete framework"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {fw.description && (
          <p className="text-xs text-gray-500 mb-4 leading-relaxed line-clamp-2">{fw.description}</p>
        )}

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-400">
            {fw.control_count} {fw.control_count === 1 ? "control" : "controls"}
          </span>
          {fw.control_count > 0 ? (
            <button
              type="button"
              onClick={() => onAssess(fw)}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:gap-2 transition-all"
            >
              Start Assessment <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <span className="text-xs text-gray-400 italic">Add controls first</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Builtin catalog card (static reference) ──────────────────────────────────
function CatalogCard({ fw }: { readonly fw: typeof BUILTIN_CATALOG[0] }) {
  const coveragePct = fw.controls > 0 ? 100 : 0;
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm transition-all relative overflow-hidden ${fw.comingSoon ? "opacity-60" : "hover:shadow-lg hover:border-blue-200"}`}>
      {fw.comingSoon && (
        <div className="absolute top-3 right-3">
          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
            <Lock className="w-2.5 h-2.5" /> Soon
          </span>
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${fw.bgColor}`}>
            <BookOpen className={`w-5 h-5 ${fw.color}`} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm leading-tight">{fw.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${fw.bgColor} ${fw.color}`}>{fw.category}</span>
              <span className="flex items-center gap-0.5 text-xs text-gray-400"><Globe className="w-3 h-3" />{fw.region}</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed line-clamp-2">{fw.description}</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <p className="text-lg font-bold text-gray-900">{fw.controls.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Controls</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <p className={`text-lg font-bold ${fw.color}`}>{fw.short}</p>
            <p className="text-xs text-gray-400">Short name</p>
          </div>
        </div>
        <div className="mb-4">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${fw.color.replace("text-", "bg-")}`} style={{ width: `${coveragePct}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle className="w-3.5 h-3.5" /> YAML available
          </span>
          {fw.comingSoon !== true && (
            <span className="text-xs text-gray-400 italic">Use "Create Custom" to add</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FrameworksPage() {
  const navigate = useNavigate();
  const [search, setSearch]       = useState("");
  const [category, setCategory]   = useState("All");
  const [dbFrameworks, setDbFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const list = await frameworksApi.list();
      setDbFrameworks(list);
    } catch {
      setError("Could not load frameworks from server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleDelete(id: string) {
    setDbFrameworks(prev => prev.filter(f => f.id !== id));
  }

  function handleAssess(fw: Framework) {
    // Go to compliance page — user can create an assessment for this framework
    navigate("/compliance");
  }

  const filteredCatalog = BUILTIN_CATALOG.filter(fw => {
    const q = search.toLowerCase();
    const matchSearch = fw.name.toLowerCase().includes(q) || fw.short.toLowerCase().includes(q) || fw.description.toLowerCase().includes(q);
    const matchCat = category === "All" || fw.category === category;
    return matchSearch && matchCat;
  });

  const filteredDb = dbFrameworks.filter(fw => {
    const q = search.toLowerCase();
    return fw.name.toLowerCase().includes(q) || fw.short_name.toLowerCase().includes(q);
  });

  const activeCatalog = filteredCatalog.filter(f => f.comingSoon !== true);
  const comingSoon    = filteredCatalog.filter(f => f.comingSoon === true);

  return (
    <div className="p-8 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Frameworks</h1>
          <p className="text-gray-500 text-sm mt-1">
            {dbFrameworks.length} custom framework{dbFrameworks.length === 1 ? "" : "s"} · {BUILTIN_CATALOG.filter(f => f.comingSoon !== true).length} standard frameworks available
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/frameworks/custom/new")}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Custom Framework
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Standard Frameworks",  value: BUILTIN_CATALOG.filter(f => f.comingSoon !== true).length, sub: "YAML available" },
          { label: "Custom Frameworks",    value: dbFrameworks.length,                                sub: "in your tenant" },
          { label: "Total Controls",       value: dbFrameworks.reduce((s, f) => s + (f.control_count ?? 0), 0), sub: "across custom frameworks" },
          { label: "Coming Soon",          value: BUILTIN_CATALOG.filter(f => f.comingSoon === true).length, sub: "in development" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + filter */}
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
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                category === cat ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Your custom frameworks */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your frameworks…
        </div>
      ) : filteredDb.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Your Custom Frameworks</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{filteredDb.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDb.map(fw => (
              <CustomFrameworkCard key={fw.id} fw={fw} onDelete={handleDelete} onAssess={handleAssess} />
            ))}
          </div>
        </>
      )}

      {/* Standard catalog */}
      {activeCatalog.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Standard Framework Catalog</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{activeCatalog.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeCatalog.map(fw => <CatalogCard key={fw.short} fw={fw} />)}
          </div>
        </>
      )}

      {/* Coming soon */}
      {comingSoon.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Coming Soon</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{comingSoon.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {comingSoon.map(fw => <CatalogCard key={fw.short} fw={fw} />)}
          </div>
        </>
      )}

      {filteredCatalog.length === 0 && filteredDb.length === 0 && !loading && (
        <div className="text-center py-16 text-gray-400 text-sm">No frameworks match your search</div>
      )}
    </div>
  );
}
