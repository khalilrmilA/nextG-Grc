import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Search, X, ChevronRight, Download } from "lucide-react";
import { risksApi } from "../api/endpoints";
import type { Risk, RiskSeverity } from "../types";
import RiskAIPanel from "../components/ai/RiskAIPanel";
import { exportRisksCSV } from "../utils/exportUtils";

const SEV_BADGE: Record<RiskSeverity, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-100 text-orange-700 border-orange-200",
  medium:   "bg-yellow-100 text-yellow-700 border-yellow-200",
  low:      "bg-green-100 text-green-700 border-green-200",
  info:     "bg-gray-100 text-gray-600 border-gray-200",
};
const SEV_DOT: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-yellow-500", low: "bg-green-500",
};
const SEV_ICON: Record<string, string> = {
  critical: "text-red-500", high: "text-orange-500", medium: "text-yellow-500", low: "text-green-500",
};
const STATUS_KEYS = [
  { value: "identified",            key: "risks.statuses.identified" },
  { value: "assessed",              key: "risks.statuses.assessed" },
  { value: "treatment_planned",     key: "risks.statuses.treatment_planned" },
  { value: "treatment_in_progress", key: "risks.statuses.treatment_in_progress" },
  { value: "treated",               key: "risks.statuses.treated" },
  { value: "accepted",              key: "risks.statuses.accepted" },
  { value: "closed",                key: "risks.statuses.closed" },
];
const CATEGORY_KEYS = [
  { value: "Technical",         key: "risks.categories.technical" },
  { value: "Access Control",    key: "risks.categories.access_control" },
  { value: "Identity & Access", key: "risks.categories.identity_access" },
  { value: "Business Continuity", key: "risks.categories.business_continuity" },
  { value: "Vendor Risk",       key: "risks.categories.vendor_risk" },
  { value: "People",            key: "risks.categories.people" },
  { value: "Incident Management", key: "risks.categories.incident_management" },
  { value: "Application",       key: "risks.categories.application" },
  { value: "Data Protection",   key: "risks.categories.data_protection" },
  { value: "Governance",        key: "risks.categories.governance" },
  { value: "Physical",          key: "risks.categories.physical" },
  { value: "Legal & Compliance", key: "risks.categories.legal_compliance" },
];

function heatmapColor(l: number, i: number): string {
  const s = l * i;
  if (s >= 20) return "bg-red-500 text-white";
  if (s >= 15) return "bg-red-400 text-white";
  if (s >= 10) return "bg-orange-400 text-white";
  if (s >= 6)  return "bg-yellow-400 text-gray-900";
  if (s >= 3)  return "bg-yellow-200 text-gray-700";
  return "bg-green-100 text-gray-600";
}
function heatmapLabel(l: number, i: number): string {
  const s = l * i;
  if (s >= 15) return "Critical/High";
  if (s >= 10) return "High";
  if (s >= 6)  return "Medium";
  return "Low";
}

// ── Demo data (fallback when API has no data) ─────────────────────────────────
const DEMO_RISKS: Risk[] = [
  { id: "1", tenant_id: "t1", title: "Unpatched critical vulnerabilities in production servers", description: "Several production servers have not received security patches in over 90 days.", risk_category: "Technical", status: "identified", likelihood: 4, impact: 5, inherent_risk_score: 20, severity: "critical", tags: ["patch-management", "infrastructure"], linked_controls: ["A.8.8"], linked_assets: [], created_at: "2025-11-01", updated_at: "2025-11-01" },
];

// ── Heatmap ───────────────────────────────────────────────────────────────────
function RiskHeatmap({ risks, onCellClick }: { readonly risks: Risk[]; readonly onCellClick: (l: number, i: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">{t("risks.heat_map")}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{t("risks.click_cell_filter")}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {([["bg-green-100", t("compliance.severities.low")], ["bg-yellow-300", t("compliance.severities.medium")], ["bg-orange-400", t("compliance.severities.high")], ["bg-red-500", t("compliance.severities.critical")]] as [string,string][]).map(([cls, lbl]) => (
            <span key={lbl} className="flex items-center gap-1">
              <span className={`w-3 h-3 rounded ${cls} inline-block`} />{lbl}
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-center items-center w-6">
          <span className="text-xs text-gray-400 select-none" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            {t("risks.likelihood")} →
          </span>
        </div>
        <div className="flex-1">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "auto repeat(5, 1fr)" }}>
            <div />
            {[1,2,3,4,5].map(i => <div key={i} className="text-center text-xs text-gray-400 pb-1 font-medium">{i}</div>)}
            {[5,4,3,2,1].map(l => (
              <>
                <div key={`l${l}`} className="flex items-center justify-end pr-2 text-xs text-gray-400 font-medium">{l}</div>
                {[1,2,3,4,5].map(impact => {
                  const count = risks.filter(r => r.likelihood === l && r.impact === impact).length;
                  const cellCls = count > 0 ? "shadow-sm" : "opacity-60";
                  const cellLabel = count > 0 ? String(count) : "";
                  return (
                    <button
                      key={`${l}-${impact}`}
                      onClick={() => onCellClick(l, impact)}
                      className={`rounded-lg h-12 flex items-center justify-center font-bold text-sm transition-all hover:ring-2 hover:ring-blue-400 hover:ring-offset-1 ${heatmapColor(l, impact)} ${cellCls}`}
                      title={`L${l}×I${impact} = ${heatmapLabel(l,impact)} (${count})`}
                    >
                      {cellLabel}
                    </button>
                  );
                })}
              </>
            ))}
          </div>
          <div className="text-center text-xs text-gray-400 mt-2">{t("risks.impact")} →</div>
        </div>
      </div>
    </div>
  );
}

function scoreSevColor(s: string) {
  if (s === "CRITICAL") return "text-red-600";
  if (s === "HIGH")     return "text-orange-600";
  if (s === "MEDIUM")   return "text-yellow-600";
  return "text-green-600";
}

function scoreChipCls(score: number) {
  if (score >= 20) return "bg-red-100 text-red-700";
  if (score >= 12) return "bg-orange-100 text-orange-700";
  if (score >= 6)  return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function severityFilterCls(s: string, active: boolean) {
  if (!active) return "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100";
  if (s === "all") return "bg-gray-900 text-white border-gray-900";
  return SEV_BADGE[s as RiskSeverity];
}

// ── Add Risk Modal ────────────────────────────────────────────────────────────
function AddRiskModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: "", description: "", risk_category: "Technical",
    likelihood: 3, impact: 3, status: "identified", tags: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const score = form.likelihood * form.impact;
  const sev = score >= 20 ? "CRITICAL" : score >= 12 ? "HIGH" : score >= 6 ? "MEDIUM" : "LOW";
  const sevColor = scoreSevColor(sev);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError("");
    try {
      await risksApi.create({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        risk_category: form.risk_category,
        likelihood: form.likelihood,
        impact: form.impact,
        status: form.status as Risk["status"],
        tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail ?? "Failed to save risk.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{t("risks.add_risk_title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("risks.risk_title")} *</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Unpatched production servers"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.description")}</label>
            <textarea rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("risks.describe_risk")}
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("risks.category")}</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.risk_category} onChange={e => setForm(f => ({ ...f, risk_category: e.target.value }))}>
                {CATEGORY_KEYS.map(c => <option key={c.value} value={c.value}>{t(c.key as never)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.status")}</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_KEYS.map(s => <option key={s.value} value={s.value}>{t(s.key as never)}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("risks.risk_score")}</span>
              <span className={`text-sm font-bold ${sevColor}`}>{score} — {sev}</span>
            </div>
            {(["likelihood","impact"] as const).map(field => (
              <div key={field}>
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <label htmlFor={`slider-${field}`} className="capitalize">{field}</label>
                  <span className="font-bold text-gray-800">{form[field]}</span>
                </div>
                <input id={`slider-${field}`} type="range" min={1} max={5} value={form[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: +e.target.value }))}
                  className="w-full accent-blue-600" />
                <div className="flex justify-between text-xs text-gray-300 mt-0.5">
                  <span>1 ({t("risks.scale_low")})</span><span>5 ({t("risks.scale_high")})</span>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("risks.tags_label")}</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. cloud, infrastructure, patch-management"
              value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium transition-colors">
              {saving ? t("risks.saving") : t("risks.new_risk")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Risk Detail Modal ─────────────────────────────────────────────────────────
function RiskDetailModal({ risk, onClose }: { readonly risk: Risk; readonly onClose: () => void }) {
  const { t } = useTranslation();
  const score = (risk.likelihood ?? 0) * (risk.impact ?? 0);
  const sev = risk.severity ?? "low";
  const sevBg = sev === "critical" ? "bg-red-50 border-red-200" : sev === "high" ? "bg-orange-50 border-orange-200" : sev === "medium" ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className={`px-6 py-5 border-b ${sevBg} border rounded-t-2xl`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${SEV_ICON[sev]}`} />
              <div>
                <h2 className="font-semibold text-gray-900 leading-snug">{risk.title}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border capitalize ${SEV_BADGE[sev as RiskSeverity]}`}>{sev}</span>
                  <span className="text-xs text-gray-500 capitalize">{risk.status.replaceAll("_", " ")}</span>
                  {risk.risk_category && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">{risk.risk_category}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{risk.likelihood ?? "—"}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t("risks.likelihood")}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{risk.impact ?? "—"}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t("risks.impact")}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-orange-50 rounded-xl p-3 text-center border border-orange-100">
              <p className="text-xl font-bold text-orange-700">{score || "—"}</p>
              <p className="text-xs text-orange-500 mt-0.5">{t("risks.inherent_risk_score")}</p>
            </div>
            <div className={`rounded-xl p-3 text-center border ${
              risk.residual_risk_score == null
                ? "bg-gray-50 border-gray-100"
                : risk.residual_risk_score <= 6
                  ? "bg-green-50 border-green-100"
                  : risk.residual_risk_score <= 12
                    ? "bg-yellow-50 border-yellow-100"
                    : "bg-red-50 border-red-100"
            }`}>
              <p className={`text-xl font-bold ${
                risk.residual_risk_score == null ? "text-gray-400"
                  : risk.residual_risk_score <= 6 ? "text-green-700"
                  : risk.residual_risk_score <= 12 ? "text-yellow-700"
                  : "text-red-700"
              }`}>
                {risk.residual_risk_score ?? "—"}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{t("risks.residual_risk_score")}</p>
            </div>
          </div>

          {risk.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("common.description")}</p>
              <p className="text-sm text-gray-700 leading-relaxed">{risk.description}</p>
            </div>
          )}

          {risk.tags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t("risks.tags")}</p>
              <div className="flex flex-wrap gap-1.5">
                {risk.tags.map(t => <span key={t} className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs rounded-lg font-medium">{t}</span>)}
              </div>
            </div>
          )}

          {risk.linked_controls.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t("risks.linked_controls")}</p>
              <div className="flex flex-wrap gap-1.5">
                {risk.linked_controls.map(c => <span key={c} className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs rounded-lg font-mono">{c}</span>)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-50">
            <div>
              <p className="text-xs text-gray-400">{t("common.created_at")}</p>
              <p className="text-sm text-gray-600 mt-0.5">{new Date(risk.created_at).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">{t("common.updated_at")}</p>
              <p className="text-sm text-gray-600 mt-0.5">{new Date(risk.updated_at).toLocaleDateString()}</p>
            </div>
          </div>

          <RiskAIPanel
            title={risk.title}
            description={risk.description ?? ""}
            category={risk.risk_category ?? "General"}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RisksPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [heatmapFilter, setHeatmapFilter] = useState<{ l: number; i: number } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedRisk, setSelectedRisk] = useState<Risk | null>(null);

  const queryClient = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ["risks"], queryFn: () => risksApi.list(), retry: false });
  const risks = (isError || !data?.items?.length) ? DEMO_RISKS : data.items;

  const filtered = risks.filter(r => {
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.risk_category ?? "").toLowerCase().includes(search.toLowerCase());
    const matchSev  = severityFilter === "all" || r.severity === severityFilter;
    const matchHeat = !heatmapFilter || (r.likelihood === heatmapFilter.l && r.impact === heatmapFilter.i);
    return matchSearch && matchSev && matchHeat;
  });

  const counts = {
    critical: risks.filter(r => r.severity === "critical").length,
    high:     risks.filter(r => r.severity === "high").length,
    medium:   risks.filter(r => r.severity === "medium").length,
    low:      risks.filter(r => r.severity === "low").length,
  };

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("risks.title")}</h1>
          <p className="text-gray-500 text-sm mt-1">{t("risks.risks_tracked", { count: risks.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportRisksCSV(risks)}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" /> {t("risks.export_csv")}
          </button>
          <button onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> {t("risks.new_risk")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {(["critical", "high", "medium", "low"] as const).map(sev => {
          const active = severityFilter === sev;
          return (
            <button key={sev} onClick={() => setSeverityFilter(active ? "all" : sev)}
              className={`p-4 rounded-2xl border text-left transition-all hover:shadow-md ${active ? SEV_BADGE[sev] + " shadow-sm" : "bg-white border-gray-100 shadow-sm"}`}>
              <p className="text-2xl font-bold text-gray-900">{counts[sev]}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2 h-2 rounded-full ${SEV_DOT[sev]}`} />
                <p className="text-sm text-gray-500">{t(`compliance.severities.${sev}`)}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RiskHeatmap risks={risks} onCellClick={(l, i) => setHeatmapFilter(prev => (prev?.l === l && prev?.i === i) ? null : { l, i })} />
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">{t("risks.filter_risks")}</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">{t("common.search")}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder={t("risks.search_placeholder")}
                  value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">{t("common.severity")}</label>
              <div className="flex flex-wrap gap-2">
                {(["all", "critical", "high", "medium", "low"] as const).map(s => (
                  <button key={s} onClick={() => setSeverityFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors border ${severityFilterCls(s, severityFilter === s)}`}>
                    {s === "all" ? t("common.all") : t(`compliance.severities.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            {heatmapFilter && (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <span className="text-xs text-blue-700 font-medium">{t("risks.heatmap_filter")}: L{heatmapFilter.l} × I{heatmapFilter.i}</span>
                <button onClick={() => setHeatmapFilter(null)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">{t("risks.clear")}</button>
              </div>
            )}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                {t("risks.showing")} <span className="font-semibold text-gray-900">{filtered.length}</span> {t("common.of")}{" "}
                <span className="font-semibold text-gray-900">{risks.length}</span> {t("risks.risks_word")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {[t("risks.risk_title"), t("risks.category"), t("common.severity"), "L × I", t("risks.risk_score"), t("common.status"), t("risks.tags"), ""].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5 first:px-6">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(risk => (
              <tr key={risk.id} onClick={() => setSelectedRisk(risk)}
                className="hover:bg-gray-50 cursor-pointer transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${SEV_ICON[risk.severity ?? "low"]}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900 leading-snug group-hover:text-blue-700 transition-colors">{risk.title}</p>
                      {risk.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{risk.description}</p>}
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
                  {risk.likelihood && risk.impact
                    ? <span className="text-xs font-semibold text-gray-500">{risk.likelihood} × {risk.impact}</span>
                    : "—"}
                </td>
                <td className="px-4 py-4 text-center">
                  {risk.inherent_risk_score != null && (
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${scoreChipCls(risk.inherent_risk_score)}`}>
                      {risk.inherent_risk_score}
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  <span className="text-xs text-gray-500 capitalize">{risk.status.replaceAll("_", " ")}</span>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-1">
                    {risk.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-md">{tag}</span>
                    ))}
                    {risk.tags.length > 2 && <span className="text-xs text-gray-400">+{risk.tags.length - 2}</span>}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">{t("risks.no_match")}</div>
        )}
      </div>

      {showAddModal && (
        <AddRiskModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["risks"] })}
        />
      )}
      {selectedRisk && <RiskDetailModal risk={selectedRisk} onClose={() => setSelectedRisk(null)} />}
    </div>
  );
}
