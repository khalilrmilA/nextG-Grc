import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Globe, BookOpen, Search, ArrowRight, Plus,
  Loader2, Trash2, AlertCircle, RefreshCw, Filter,
  Shield, Lock, FileText, Heart, CreditCard, Cpu, Scale,
} from "lucide-react";
import { frameworksApi } from "@/api/endpoints";
import type { Framework } from "@/types";

// ── Per-framework metadata (icon, category, region) ──────────────────────────
const FW_META: Record<string, {
  category: string;
  regions: string[];
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  description: string;
}> = {
  "ISO27001":     { category: "Security",    regions: ["Global"],             icon: Shield,   color: "text-blue-600",    bg: "bg-blue-50",    description: "International standard for Information Security Management Systems (ISMS). 118 controls across Clauses 4–10 and Annex A." },
  "ISO27001-2013":{ category: "Security",    regions: ["Global"],             icon: Shield,   color: "text-blue-500",    bg: "bg-blue-50",    description: "Previous version of ISO 27001. Still referenced during transition. Superseded by 2022 edition." },
  "SOC2":         { category: "Audit",       regions: ["Global"],             icon: FileText, color: "text-purple-600",  bg: "bg-purple-50",  description: "AICPA Trust Services Criteria. Required for SaaS and cloud service providers demonstrating security, availability, and confidentiality." },
  "NIST-CSF":     { category: "Security",    regions: ["Global", "USA"],      icon: Shield,   color: "text-indigo-600",  bg: "bg-indigo-50",  description: "NIST Cybersecurity Framework 2.0. Six functions: Govern, Identify, Protect, Detect, Respond, Recover. 103 outcomes." },
  "NIST-800-53":  { category: "Government",  regions: ["USA", "Global"],      icon: Lock,     color: "text-slate-600",   bg: "bg-slate-50",   description: "Comprehensive security and privacy controls for US federal information systems. 84 control families. Widely adopted beyond government." },
  "NIST-AI-RMF":  { category: "AI",          regions: ["Global", "USA"],      icon: Cpu,      color: "text-pink-600",    bg: "bg-pink-50",    description: "NIST AI Risk Management Framework 1.0. Governs responsible AI across four core functions: Govern, Map, Measure, Manage." },
  "GDPR":         { category: "Privacy",     regions: ["Europe", "Global"],   icon: Scale,    color: "text-emerald-600", bg: "bg-emerald-50", description: "EU General Data Protection Regulation. Applies to all organizations processing personal data of EU residents. Article-by-article controls." },
  "HIPAA":        { category: "Healthcare",  regions: ["USA"],                icon: Heart,    color: "text-red-600",     bg: "bg-red-50",     description: "US Health Insurance Portability and Accountability Act. Protects sensitive patient health information (PHI/ePHI)." },
  "PCI-DSS":      { category: "Finance",     regions: ["Global"],             icon: CreditCard,color:"text-orange-600", bg: "bg-orange-50",  description: "Payment Card Industry Data Security Standard v4.0. Required for all entities storing, processing, or transmitting cardholder data." },
  "NIS2":         { category: "Regulation",  regions: ["Europe"],             icon: Scale,    color: "text-teal-600",    bg: "bg-teal-50",    description: "EU Network and Information Security Directive 2. Expanded scope covering critical infrastructure and digital service providers." },
  "DORA":         { category: "Finance",     regions: ["Europe"],             icon: CreditCard,color:"text-yellow-600", bg: "bg-yellow-50",  description: "Digital Operational Resilience Act. Mandatory for EU financial sector from January 2025. ICT risk, incident reporting, TLPT." },
  "CMMC":         { category: "Government",  regions: ["USA"],                icon: Lock,     color: "text-gray-600",    bg: "bg-gray-50",    description: "Cybersecurity Maturity Model Certification 2.0. Required for US DoD contractors handling Controlled Unclassified Information (CUI)." },
  "CIS-CSC":      { category: "Security",    regions: ["Global"],             icon: Shield,   color: "text-cyan-600",    bg: "bg-cyan-50",    description: "CIS Critical Security Controls v8. 18 prioritized controls across three Implementation Groups for organizations of any size." },
  "ISO-42001":    { category: "AI",          regions: ["Global"],             icon: Cpu,      color: "text-violet-600",  bg: "bg-violet-50",  description: "ISO/IEC 42001:2023 Artificial Intelligence Management System. First international standard for responsible AI governance." },
  "SAMA-CSF":     { category: "Finance",     regions: ["Middle East"],        icon: CreditCard,color:"text-amber-600",  bg: "bg-amber-50",   description: "Saudi Arabia Monetary Authority Cybersecurity Framework. Mandatory for all SAMA-regulated financial institutions." },
  "ESSENTIAL-8":  { category: "Security",    regions: ["Asia-Pacific"],       icon: Shield,   color: "text-lime-600",    bg: "bg-lime-50",    description: "Australian Cyber Security Centre Essential Eight. Eight prioritized mitigation strategies across three maturity levels." },
  "OWASP-ASVS":   { category: "AppSec",      regions: ["Global"],             icon: Lock,     color: "text-rose-600",    bg: "bg-rose-50",    description: "OWASP Application Security Verification Standard 4.0. Requirements for verifying secure design and implementation of web applications." },
  "ISO-Lite":     { category: "Security",    regions: ["Global"],             icon: BookOpen, color: "text-gray-500",    bg: "bg-gray-50",    description: "Lightweight demo version of ISO 27001 with 8 core controls. Use for quick assessments or platform demonstrations." },
};

const CATEGORIES = ["All", "Security", "Privacy", "Audit", "Finance", "Government", "Healthcare", "Regulation", "AI", "AppSec"];
const REGIONS     = ["All", "Global", "Europe", "USA", "Middle East", "Asia-Pacific"];

const CAT_COLORS: Record<string, { color: string; bg: string }> = {
  Security:   { color: "text-blue-600",    bg: "bg-blue-50"    },
  Privacy:    { color: "text-emerald-600", bg: "bg-emerald-50" },
  Audit:      { color: "text-purple-600",  bg: "bg-purple-50"  },
  Finance:    { color: "text-orange-600",  bg: "bg-orange-50"  },
  Government: { color: "text-slate-600",   bg: "bg-slate-50"   },
  Healthcare: { color: "text-red-600",     bg: "bg-red-50"     },
  Regulation: { color: "text-teal-600",    bg: "bg-teal-50"    },
  AI:         { color: "text-violet-600",  bg: "bg-violet-50"  },
  AppSec:     { color: "text-rose-600",    bg: "bg-rose-50"    },
};

function getMeta(shortName: string) {
  return FW_META[shortName] ?? {
    category: "Security",
    regions: ["Global"],
    icon: BookOpen,
    color: "text-gray-600",
    bg: "bg-gray-50",
    description: "",
  };
}

// ── Framework card ─────────────────────────────────────────────────────────────
function FrameworkCard({
  fw,
  onDelete,
  onAssess,
}: {
  readonly fw: Framework;
  readonly onDelete: (id: string) => void;
  readonly onAssess: (fw: Framework) => void;
}) {
  const { t } = useTranslation();
  const meta = getMeta(fw.short_name);
  const Icon = meta.icon;
  const catStyle = CAT_COLORS[meta.category] ?? { color: "text-gray-600", bg: "bg-gray-50" };
  const isCustom = !fw.is_builtin;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all group relative overflow-hidden flex flex-col">
      {/* Top bar */}
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
              <Icon className={`w-5 h-5 ${meta.color}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2">{fw.name}</h3>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">{fw.short_name}</span>
                {fw.version && <span className="text-xs text-gray-400">v{fw.version}</span>}
                {isCustom && (
                  <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-medium">{t("frameworks.tenant")}</span>
                )}
              </div>
            </div>
          </div>
          {/* Delete for custom */}
          {isCustom && (
            confirmDelete ? (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button type="button" onClick={handleDelete} disabled={deleting}
                  className="text-xs px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
                  {deleting ? "..." : t("common.delete")}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                  {t("common.cancel")}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3">
          {meta.description || fw.description || ""}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catStyle.bg} ${catStyle.color}`}>
            {meta.category}
          </span>
          {meta.regions.slice(0, 2).map(r => (
            <span key={r} className="flex items-center gap-0.5 text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">
              <Globe className="w-2.5 h-2.5" />{r}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 border-t border-gray-50 pt-3 flex items-center justify-between">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{fw.control_count ?? 0}</p>
          <p className="text-xs text-gray-400">{t("frameworks.controls")}</p>
        </div>
        {fw.control_count && fw.control_count > 0 ? (
          <button
            type="button"
            onClick={() => onAssess(fw)}
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all"
          >
            Start Assessment <ArrowRight className="w-3 h-3" />
          </button>
        ) : (
          <span className="text-xs text-gray-400 italic">Add controls first</span>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FrameworksPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [search, setSearch]       = useState("");
  const [category, setCategory]   = useState("All");
  const [region, setRegion]       = useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [frameworks, setFrameworks]   = useState<Framework[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const list = await frameworksApi.list();
      setFrameworks(list);
    } catch {
      setError(t("errors.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleDelete(id: string) {
    setFrameworks(prev => prev.filter(f => f.id !== id));
  }

  function handleAssess(_fw: Framework) {
    navigate("/compliance");
  }

  const filtered = frameworks.filter(fw => {
    const meta = getMeta(fw.short_name);
    const q = search.toLowerCase();
    const matchSearch = !q || fw.name.toLowerCase().includes(q) || fw.short_name.toLowerCase().includes(q) || (meta.description.toLowerCase().includes(q));
    const matchCat    = category === "All" || meta.category === category;
    const matchRegion = region === "All"   || meta.regions.some(r => r.toLowerCase().includes(region.toLowerCase()));
    return matchSearch && matchCat && matchRegion;
  });

  const builtins = filtered.filter(fw => fw.is_builtin && fw.short_name !== "ISO-Lite");
  const customs  = filtered.filter(fw => !fw.is_builtin);
  const demo     = filtered.filter(fw => fw.short_name === "ISO-Lite");

  const totalControls = frameworks.reduce((s, f) => s + (f.control_count ?? 0), 0);

  return (
    <div className="p-8 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("frameworks.title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {frameworks.filter(f => f.is_builtin).length} {t("frameworks.builtin").toLowerCase()} · {frameworks.filter(f => !f.is_builtin).length} {t("frameworks.tenant").toLowerCase()} · {totalControls.toLocaleString()} total controls
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title={t("common.refresh")}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => navigate("/frameworks/custom/new")}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />
            {t("frameworks.create_custom")}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t("frameworks.builtin"),  value: frameworks.filter(f => f.is_builtin).length,  sub: "ready to use",        color: "text-blue-600"  },
          { label: t("frameworks.tenant"),   value: frameworks.filter(f => !f.is_builtin).length, sub: "in your workspace",   color: "text-purple-600"},
          { label: "Total Controls",          value: totalControls.toLocaleString(),               sub: "across all frameworks",color: "text-green-600"},
          { label: "Categories",              value: CATEGORIES.length - 1,                        sub: "security domains",    color: "text-orange-600"},
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-sm font-medium text-gray-700 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={`${t("common.search")} frameworks... (ISO 27001, GDPR, PCI DSS...)`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="button" onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2.5 border rounded-lg text-sm font-medium transition-colors ${showFilters ? "bg-blue-50 border-blue-200 text-blue-600" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            <Filter className="w-3.5 h-3.5" />
            {t("common.filter")}
            {(category !== "All" || region !== "All") && (
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
            )}
          </button>
        </div>

        {showFilters && (
          <div className="space-y-3 pt-1 border-t border-gray-100">
            {/* Category filter */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">{t("common.type")}</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(cat => (
                  <button key={cat} type="button" onClick={() => setCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      category === cat ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            {/* Region filter */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">{t("frameworks.regions")}</p>
              <div className="flex flex-wrap gap-1.5">
                {REGIONS.map(r => (
                  <button key={r} type="button" onClick={() => setRegion(r)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      region === r ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    <Globe className="w-2.5 h-2.5" />
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {(category !== "All" || region !== "All") && (
              <button type="button" onClick={() => { setCategory("All"); setRegion("All"); }}
                className="text-xs text-blue-600 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <>
          {/* Custom frameworks */}
          {customs.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Your Custom Frameworks</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{customs.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customs.map(fw => <FrameworkCard key={fw.id} fw={fw} onDelete={handleDelete} onAssess={handleAssess} />)}
              </div>
            </section>
          )}

          {/* Built-in frameworks */}
          {builtins.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Standard Framework Library</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{builtins.length}</span>
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">✓ Ready to use</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {builtins.map(fw => <FrameworkCard key={fw.id} fw={fw} onDelete={handleDelete} onAssess={handleAssess} />)}
              </div>
            </section>
          )}

          {/* Demo frameworks */}
          {demo.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Demo / Sandbox</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{demo.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {demo.map(fw => <FrameworkCard key={fw.id} fw={fw} onDelete={handleDelete} onAssess={handleAssess} />)}
              </div>
            </section>
          )}

          {filtered.length === 0 && (
            <div className="text-center py-16">
              <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">No frameworks match your search</p>
              <p className="text-gray-400 text-sm mt-1">Try adjusting your filters or search query</p>
              <button type="button" onClick={() => { setSearch(""); setCategory("All"); setRegion("All"); }}
                className="mt-4 text-sm text-blue-600 hover:underline">
                Clear all filters
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
