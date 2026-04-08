import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Plus, Globe, AlertTriangle, Search, ShieldCheck, ShieldX, X, ChevronRight, Calendar, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import VendorAIModal from "../components/ai/VendorAIModal";
import { vendorsApi } from "@/api/endpoints";

interface VendorEntry {
  id: string;
  name: string;
  industry: string | null;
  country: string | null;
  website: string | null;
  risk_tier: string;
  status: string;
  risk_score: number | null;
  has_data_processing_agreement: boolean;
  contract_expiry: string | null;
  services_provided: string | null;
  primary_contact_name?: string;
  primary_contact_email?: string;
  created_at?: string;
}
type Tier   = "critical" | "high" | "medium" | "low";
type Status = "active" | "under_review" | "onboarding" | "offboarding" | "inactive";
type RiskTier = Tier;

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

const TIER_OPTIONS:   Tier[]   = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS: Status[] = ["active", "under_review", "onboarding", "offboarding", "inactive"];
const INDUSTRY_OPTIONS = [
  "Cloud Infrastructure", "Telecommunications", "Payment Processing",
  "Identity & Access Mgmt", "Email Services", "Analytics", "Data Backup",
  "CRM / SaaS", "Security Services", "HR / Payroll", "Legal Tech",
  "IT Support & Maintenance", "Network Services", "Database Services",
  "Consulting & Advisory", "Managed Services Provider (MSP)",
  "Software Development", "Testing & QA", "Hosting & Colocation",
  "Disaster Recovery", "Backup & Archive", "Development Tools",
  "Supply Chain Management", "Healthcare Services", "Financial Services",
  "Insurance", "Retail & E-commerce", "Manufacturing", "Logistics",
  "Education", "Government", "Non-Profit", "Media & Entertainment",
  "Real Estate", "Travel & Hospitality", "Transportation", "Energy",
  "Utilities", "Pharmaceuticals", "Other",
];

function riskScoreColor(score: number) {
  if (score > 20) return "text-red-600 bg-red-50";
  if (score > 12) return "text-orange-600 bg-orange-50";
  if (score > 6)  return "text-yellow-600 bg-yellow-50";
  return "text-green-600 bg-green-50";
}

// ── Add Vendor Modal ──────────────────────────────────────────────────────────
function AddVendorModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: (v: VendorEntry) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "", industry: "Cloud Infrastructure", country: "", tier: "medium",
    status: "active", risk_score: 10, dpa: false,
    contract_expiry: "", services: "", website: "", notes: "",
  });
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim())    { setError(t("vendors.name_required")); return; }
    if (!form.country.trim()) { setError(t("vendors.country_required")); return; }

    try {
      setError("");
      setUploading(true);

      const newVendor = await vendorsApi.create({
        name: form.name.trim(),
        industry: form.industry,
        country: form.country.trim().toUpperCase().slice(0, 2),
        risk_tier: form.tier,
        status: form.status,
        risk_score: form.risk_score,
        services_provided: form.services.trim() || undefined,
        has_data_processing_agreement: form.dpa,
        contract_expiry: form.contract_expiry || undefined,
        website: form.website.trim() || undefined,
      } as any);

      // Upload contract if provided
      if (contractFile) {
        await vendorsApi.uploadContract(newVendor.id, contractFile);
      }

      onSaved(newVendor);
      onClose();
    } catch (err) {
      setError(`Failed to create 3rd party. Please try again. ${err instanceof Error ? err.message : ''}`);
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{t("vendors.add_vendor_modal_title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label htmlFor="v-name" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.vendor_name_label")} *</label>
            <input id="v-name" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("vendors.vendor_name_placeholder")}
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="v-industry" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.industry_label")}</label>
              <select id="v-industry" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="v-country" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.country_code")} *</label>
              <input id="v-country" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                placeholder={t("vendors.country_placeholder")} maxLength={2}
                value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="v-tier" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.risk_tier_label")}</label>
              <select id="v-tier" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}>
                {TIER_OPTIONS.map(o => <option key={o} value={o} className="capitalize">{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="v-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.status_label")}</label>
              <select id="v-status" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o.replaceAll("_", " ")}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="v-riskscore" className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("vendors.risk_score_label")}</label>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${riskScoreColor(form.risk_score)}`}>{form.risk_score}</span>
            </div>
            <input id="v-riskscore" type="range" min={1} max={40} value={form.risk_score}
              onChange={e => setForm(f => ({ ...f, risk_score: +e.target.value }))}
              className="w-full accent-blue-600" />
            <div className="flex justify-between text-xs text-gray-300 mt-0.5">
              <span>{t("vendors.risk_score_range")}</span><span>{t("vendors.risk_score_max")}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="v-expiry" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.contract_expiry_label")}</label>
              <input id="v-expiry" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.contract_expiry} onChange={e => setForm(f => ({ ...f, contract_expiry: e.target.value }))} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.dpa} onChange={e => setForm(f => ({ ...f, dpa: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm text-gray-700">{t("vendors.dpa_signed")}</span>
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="v-services" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.services_label")}</label>
            <input id="v-services" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("vendors.services_placeholder")}
              value={form.services} onChange={e => setForm(f => ({ ...f, services: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="v-website" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.website_label")}</label>
            <input id="v-website" type="url" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://vendor.com"
              value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="v-notes" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.notes_label")}</label>
            <textarea id="v-notes" rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("vendors.notes_placeholder")}
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="v-contract" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Upload Contract (Optional)</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              onClick={() => document.getElementById("v-contract")?.click()}>
              <input id="v-contract" type="file" accept=".pdf,.txt,.doc,.docx" className="hidden"
                onChange={e => setContractFile(e.target.files?.[0] || null)} />
              <p className="text-sm text-gray-600">
                {contractFile ? (
                  <>✓ <strong>{contractFile.name}</strong> selected</>
                ) : (
                  <>Click to upload contract (PDF, TXT, or DOC)</>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-1">AI will automatically review the contract</p>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={uploading}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={uploading}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                t("vendors.add_vendor_submit")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Vendor Detail Modal ───────────────────────────────────────────────────────
function VendorDetailModal({ vendor, onClose, onRunAI }: { readonly vendor: VendorEntry; readonly onClose: () => void; readonly onRunAI: () => void }) {
  const { t } = useTranslation();
  const tier   = vendor.risk_tier as Tier;
  const status = vendor.status as Status;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 bg-slate-50 rounded-t-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-slate-200 rounded-xl flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 leading-snug">{vendor.name}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border capitalize ${TIER_BADGE[tier]}`}>{vendor.risk_tier}</span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[status]}`}>{vendor.status.replaceAll("_", " ")}</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400"><Globe className="w-3 h-3" />{vendor.country}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className={`text-xl font-bold ${riskScoreColor(vendor.risk_score)} rounded-lg px-2 inline-block`}>{vendor.risk_score}</p>
              <p className="text-xs text-gray-400 mt-1">{t("vendors.risk_score_label")}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center flex flex-col items-center justify-center">
              {vendor.has_data_processing_agreement
                ? <ShieldCheck className="w-6 h-6 text-green-500" />
                : <ShieldX className="w-6 h-6 text-red-500" />
              }
              <p className="text-xs text-gray-400 mt-1">{t("vendors.col_dpa")}</p>
              <p className="text-xs font-semibold text-gray-700">{vendor.has_data_processing_agreement ? t("vendors.dpa_signed_label") : t("vendors.dpa_missing_label")}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1 flex items-center justify-center gap-1"><Calendar className="w-3 h-3" />{t("vendors.contract_label")}</p>
              <p className="text-sm font-semibold text-gray-800">{vendor.contract_expiry}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("vendors.industry_label")}</p>
            <p className="text-sm text-gray-700">{vendor.industry}</p>
          </div>

          {vendor.services_provided && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("vendors.services_label")}</p>
              <p className="text-sm text-gray-700">{vendor.services_provided}</p>
            </div>
          )}

          {vendor.website && (
            <div className="pt-2 border-t border-gray-50">
              <a href={vendor.website} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />{vendor.website}
              </a>
            </div>
          )}

          {!vendor.has_data_processing_agreement && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{t("vendors.no_dpa_warning")}</p>
            </div>
          )}

          {/* Show saved AI analysis if available */}
          {(vendor as any).description && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <p className="text-xs font-semibold text-blue-700">AI Risk Assessment Result</p>
              </div>
              <div className="prose prose-sm max-w-none text-gray-700 text-xs overflow-y-auto max-h-64">
                {(vendor as any).description.split('\n').map((line: string, i: number) => (
                  <div key={i} className="mb-1">{line}</div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onRunAI}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-medium transition-all shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            {t("vendors.ai_risk_assessment")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function VendorsPage() {
  const { t } = useTranslation();
  const [vendors, setVendors] = useState<VendorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<VendorEntry | null>(null);
  const [aiVendor, setAiVendor] = useState<VendorEntry | null>(null);

  useEffect(() => {
    const loadVendors = async () => {
      try {
        const response = await vendorsApi.list();
        setVendors(response.items || []);
      } catch (err) {
        console.error("Failed to load vendors:", err);
        setVendors([]);
      } finally {
        setLoading(false);
      }
    };
    loadVendors();
  }, []);

  const filtered = vendors.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.industry?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchTier = tierFilter === "all" || v.risk_tier === tierFilter;
    return matchSearch && matchTier;
  });

  const tierCounts = {
    critical: vendors.filter(v => v.risk_tier === "critical").length,
    high:     vendors.filter(v => v.risk_tier === "high").length,
    medium:   vendors.filter(v => v.risk_tier === "medium").length,
    low:      vendors.filter(v => v.risk_tier === "low").length,
  };
  const missingDpa = vendors.filter(v => !v.has_data_processing_agreement).length;
  const avgScore   = vendors.length > 0 ? Math.round(vendors.reduce((s, v) => s + (v.risk_score || 0), 0) / vendors.length) : 0;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("vendors.management_title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("vendors.subtitle", { count: vendors.length, critical: vendors.filter(v => v.risk_tier === "critical").length, missing_dpa: missingDpa })}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> {t("vendors.new_vendor")}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("vendors.kpi_total"),        value: vendors.length,      sub: t("vendors.kpi_total_sub") },
          { label: t("vendors.kpi_avg_score"),     value: avgScore,            sub: t("vendors.kpi_avg_score_sub") },
          { label: t("vendors.kpi_missing_dpa"),   value: missingDpa,          sub: t("vendors.kpi_missing_dpa_sub") },
          { label: t("vendors.kpi_under_review"),  value: vendors.filter(v => v.status === "under_review").length, sub: t("vendors.kpi_under_review_sub") },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder={t("vendors.search_placeholder")}
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-2">
          {([
            { key: "all",      label: t("common.all"),           count: vendors.length,       cls: "" },
            { key: "critical", label: t("vendors.tiers.critical"), count: tierCounts.critical,  cls: "text-red-700 border-red-200 bg-red-50" },
            { key: "high",     label: t("vendors.tiers.high"),     count: tierCounts.high,      cls: "text-orange-700 border-orange-200 bg-orange-50" },
            { key: "medium",   label: t("vendors.tiers.medium"),   count: tierCounts.medium,    cls: "text-yellow-700 border-yellow-200 bg-yellow-50" },
            { key: "low",      label: t("vendors.tiers.low"),      count: tierCounts.low,       cls: "text-green-700 border-green-200 bg-green-50" },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setTierFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                tierFilter === tab.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}>
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${tierFilter === tab.key ? "bg-white/20" : "bg-gray-100 text-gray-600"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {[t("vendors.col_vendor"), t("vendors.col_risk_tier"), t("vendors.col_status"), t("vendors.col_risk_score"), t("vendors.col_dpa"), t("vendors.col_contract_expiry"), t("vendors.col_services"), ""].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5 first:px-6">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(v => (
              <tr key={v.id} onClick={() => setSelected(v)}
                className="hover:bg-gray-50 cursor-pointer transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-slate-200 transition-colors">
                      <Building2 className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">{v.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        <span>{v.industry}</span>
                        <span className="flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" />{v.country}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${TIER_BADGE[v.risk_tier as Tier]}`}>
                    {v.risk_tier}
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
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${riskScoreColor(v.risk_score)}`}>{v.risk_score}</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-center">
                  {v.has_data_processing_agreement
                    ? <ShieldCheck className="w-4 h-4 text-green-500 mx-auto" />
                    : <ShieldX className="w-4 h-4 text-red-500 mx-auto" />
                  }
                </td>
                <td className="px-4 py-4 text-xs text-gray-500">{v.contract_expiry}</td>
                <td className="px-4 py-4 text-xs text-gray-400 max-w-[160px] truncate">{v.services_provided}</td>
                <td className="px-4 py-4">
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">{t("vendors.no_filter_match")}</div>
        )}
      </div>

      {showAdd && (
        <AddVendorModal
          onClose={() => setShowAdd(false)}
          onSaved={v => setVendors(prev => [v, ...prev])}
        />
      )}
      {selected && (
        <VendorDetailModal
          vendor={selected}
          onClose={() => setSelected(null)}
          onRunAI={() => { setAiVendor(selected); setSelected(null); }}
        />
      )}
      {aiVendor && (
        <VendorAIModal
          vendorId={aiVendor.id}
          vendorName={aiVendor.name}
          vendorIndustry={aiVendor.industry}
          vendorServices={aiVendor.services_provided}
          onClose={() => setAiVendor(null)}
        />
      )}
    </div>
  );
}
