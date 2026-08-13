import { useState, useEffect } from "react";
import { Search, Loader2, Crown, RefreshCw, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cveApi } from "@/api/endpoints";

const CVSS_BADGE = (score?: number | null) => {
  if (score == null) return "bg-gray-100 text-gray-600 border-gray-200";
  if (score >= 9) return "bg-red-100 text-red-700 border-red-200";
  if (score >= 7) return "bg-orange-100 text-orange-700 border-orange-200";
  if (score >= 4) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
};
const REL_BADGE: Record<string, string> = {
  pertinent: "bg-blue-100 text-blue-700 border-blue-200",
  to_watch: "bg-amber-100 text-amber-700 border-amber-200",
  non_pertinent: "bg-gray-100 text-gray-500 border-gray-200",
};
const RELEVANCE = ["pertinent", "to_watch", "non_pertinent"];

export default function CvePage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [minCvss, setMinCvss] = useState("");
  const [relFilter, setRelFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params: any = { page_size: 100 };
      if (q) params.q = q;
      if (minCvss) params.min_cvss = parseFloat(minCvss);
      if (relFilter) params.relevance = relFilter;
      const d = await cveApi.search(params);
      setItems(Array.isArray(d) ? d : []);
    } catch { setItems([]); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [relFilter]);

  async function sync() {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await cveApi.sync(7);
      setSyncMsg(`Synced from NVD: ${r.added} added, ${r.updated} updated (${r.fetched} fetched).`);
      load();
    } catch { setSyncMsg("Sync failed — NVD may be unreachable or rate-limited."); }
    finally { setSyncing(false); }
  }

  async function setRelevance(cveId: string, relevance: string) {
    setBusy(cveId);
    try {
      await cveApi.annotate(cveId, { relevance, linked_asset_ids: [] });
      setItems((prev) => prev.map((c) => (c.cve_id === cveId ? { ...c, relevance } : c)));
    } catch {} finally { setBusy(""); }
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("cve.title", "CVE Knowledge Base")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("cve.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("cve.subtitle", "Search the NVD CVE catalog, sync the latest, and triage relevance for your environment")}</p>
        </div>
        <button onClick={sync} disabled={syncing} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {t("cve.sync", "Sync from NVD")}
        </button>
      </div>

      {syncMsg && <div className="p-3 rounded-xl text-sm bg-blue-50 text-blue-700">{syncMsg}</div>}

      <div className="flex items-center gap-3 flex-wrap">
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cve.search", "Search CVE id or description…")} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </form>
        <select value={minCvss} onChange={(e) => { setMinCvss(e.target.value); }} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">{t("cve.any_cvss", "Any CVSS")}</option>
          <option value="9">≥ 9.0 (critical)</option>
          <option value="7">≥ 7.0 (high+)</option>
          <option value="4">≥ 4.0 (medium+)</option>
        </select>
        <select value={relFilter} onChange={(e) => setRelFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">{t("cve.all_relevance", "All relevance")}</option>
          {RELEVANCE.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
        </select>
        <button onClick={load} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50">
          {t("cve.apply", "Search")}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Database className="w-8 h-8 mx-auto mb-3 text-gray-300" />
            {t("cve.empty", "No CVEs in the catalog yet. Click 'Sync from NVD' to pull the latest.")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_id", "CVE")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_cvss", "CVSS")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_desc", "Description")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_rel", "Relevance")}</th>
              </tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-4 font-mono text-xs text-blue-700 whitespace-nowrap">{c.cve_id}</td>
                    <td className="px-6 py-4"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CVSS_BADGE(c.cvss_score)}`}>{c.cvss_score ?? "—"}</span></td>
                    <td className="px-6 py-4 text-gray-600 max-w-xl"><span className="line-clamp-2">{c.description || "—"}</span></td>
                    <td className="px-6 py-4">
                      <select
                        value={c.relevance || ""}
                        disabled={busy === c.cve_id}
                        onChange={(e) => setRelevance(c.cve_id, e.target.value)}
                        className={`text-xs rounded-full px-2.5 py-1 border font-semibold focus:outline-none ${c.relevance ? REL_BADGE[c.relevance] : "bg-white text-gray-500 border-gray-200"}`}
                      >
                        <option value="">{t("cve.triage", "Triage…")}</option>
                        {RELEVANCE.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
