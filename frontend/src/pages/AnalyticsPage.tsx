import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Boxes, Bug, Radar, AlertTriangle, ShieldCheck, FileText, ClipboardCheck, Crown, Loader2, Download } from "lucide-react";
import { eliteDashboardsApi, reportBuilderApi } from "@/api/endpoints";

const BAR_COLORS = ["bg-blue-500", "bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-violet-500", "bg-cyan-500", "bg-orange-500"];

function Breakdown({ title, data }: { title: string; data?: Record<string, number> }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return null;
  const max = Math.max(1, ...entries.map(([, v]) => Number(v) || 0));
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {entries.map(([k, v], i) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-xs text-gray-600 capitalize truncate">{k.replace(/_/g, " ")}</span>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${BAR_COLORS[i % BAR_COLORS.length]} rounded-full`} style={{ width: `${((Number(v) || 0) / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right text-xs font-semibold text-gray-700 tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type ModuleDef = {
  key: string;
  label: string;
  icon: typeof Boxes;
  color: string;
  load: () => Promise<any>;
  total: (d: any) => number | undefined;
  breaks: [string, string][];
};

const MODULES: ModuleDef[] = [
  { key: "assets", label: "Assets", icon: Boxes, color: "text-blue-600 bg-blue-50", load: () => eliteDashboardsApi.assets(), total: (d) => d.total, breaks: [["By type", "by_type"], ["By criticality", "by_criticality"], ["By class", "by_class"], ["By lifecycle", "by_lifecycle"]] },
  { key: "vulnerabilities", label: "Vulnerabilities", icon: Bug, color: "text-rose-600 bg-rose-50", load: () => eliteDashboardsApi.vulnerabilities(), total: (d) => d.total, breaks: [["By severity", "by_severity"], ["By status", "by_status"]] },
  { key: "threats", label: "Threats", icon: Radar, color: "text-orange-600 bg-orange-50", load: () => eliteDashboardsApi.threats(), total: (d) => d.total, breaks: [["By category", "by_category"], ["Pending", "pending"]] },
  { key: "risks", label: "Risks", icon: AlertTriangle, color: "text-amber-600 bg-amber-50", load: () => eliteDashboardsApi.risks(), total: (d) => d.total, breaks: [["By severity", "by_severity"], ["By status", "by_status"]] },
  { key: "controls", label: "Controls", icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50", load: () => eliteDashboardsApi.controls(), total: (d) => d.total, breaks: [["By status", "by_status"]] },
  { key: "governance", label: "Governance", icon: FileText, color: "text-violet-600 bg-violet-50", load: () => eliteDashboardsApi.governance(), total: (d) => d.policies_total, breaks: [["Policies by status", "policies_by_status"], ["Attestations", "attestations_by_status"]] },
  { key: "audit", label: "Audit", icon: ClipboardCheck, color: "text-cyan-600 bg-cyan-50", load: () => eliteDashboardsApi.audit(), total: (d) => d.audits_total, breaks: [["Audits by status", "audits_by_status"], ["Findings by severity", "findings_by_severity"]] },
];

const EXPORT_DATASETS = [
  { name: "risks", label: "Risk Register" },
  { name: "vulnerabilities", label: "Vulnerabilities" },
  { name: "assets", label: "Asset Inventory" },
  { name: "applied_controls", label: "Applied Controls" },
  { name: "audits", label: "Audits" },
];

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [dataset, setDataset] = useState("risks");
  const [exporting, setExporting] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(MODULES.map((m) => m.load())).then((results) => {
      if (cancelled) return;
      const next: Record<string, any> = {};
      results.forEach((r, i) => { if (r.status === "fulfilled") next[MODULES[i].key] = r.value; });
      setData(next);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function handleExport(format: "xlsx" | "csv") {
    setExporting(format);
    try {
      const blob = await reportBuilderApi.exportFile(dataset, format);
      const url = window.URL.createObjectURL(blob as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${dataset}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      /* 402 is handled globally by the elite-upsell listener */
    } finally {
      setExporting("");
    }
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("analytics.title", "Analytics & Dashboards")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("analytics.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("analytics.subtitle", "Per-module KPIs across the whole risk programme, with Excel/CSV export")}</p>
        </div>
      </div>

      {/* Export card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t("analytics.export_title", "Report export")}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t("analytics.export_sub", "Download any dataset as a formatted Excel workbook or CSV")}</p>
          </div>
          <div className="flex items-end gap-2 ml-auto">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t("analytics.dataset", "Dataset")}</label>
              <select value={dataset} onChange={(e) => setDataset(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {EXPORT_DATASETS.map((d) => <option key={d.name} value={d.name}>{d.label}</option>)}
              </select>
            </div>
            <button onClick={() => handleExport("xlsx")} disabled={!!exporting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {exporting === "xlsx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Excel
            </button>
            <button onClick={() => handleExport("csv")} disabled={!!exporting} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
              {exporting === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} CSV
            </button>
          </div>
        </div>
      </div>

      {/* Dashboards grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {MODULES.map((m) => {
            const d = data[m.key];
            const total = d ? m.total(d) : undefined;
            return (
              <div key={m.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${m.color}`}>
                    <m.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{m.label}</p>
                    <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">{total ?? "—"}</p>
                  </div>
                </div>
                {d ? (
                  <div className="space-y-3">
                    {m.breaks.map(([label, key]) => <Breakdown key={key} title={label} data={d[key]} />)}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">{t("analytics.unavailable", "No data")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
