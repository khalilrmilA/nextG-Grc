import { useState, useEffect } from "react";
import { Search, Loader2, Crown, RefreshCw, Database, ChevronDown, StickyNote, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cveApi, assetsApi } from "@/api/endpoints";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";

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

function AnnotationModal({
  cve,
  assetOptions,
  onClose,
  onSaved,
}: {
  cve: any;
  assetOptions: MultiSelectOption[];
  onClose: () => void;
  onSaved: (updated: any) => void;
}) {
  const { t } = useTranslation();
  const [relevance, setRelevance] = useState(cve.relevance || "to_watch");
  const [notes, setNotes] = useState(cve.notes || "");
  const [linkedAssetIds, setLinkedAssetIds] = useState<string[]>(cve.linked_asset_ids || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await cveApi.annotate(cve.cve_id, { relevance, notes, linked_asset_ids: linkedAssetIds });
      onSaved({ ...cve, ...updated });
      onClose();
    } catch {
      setError(t("cve.error_save_failed", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 font-mono">{cve.cve_id}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4 line-clamp-3">{cve.description}</p>
        {error && <div className="mb-3 p-2.5 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("cve.col_rel", "Relevance")}</label>
            <select value={relevance} onChange={(e) => setRelevance(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {RELEVANCE.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("cve.notes_label", "Internal notes")}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder={t("cve.notes_placeholder", "Why this CVE matters (or doesn't) for our environment...")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("cve.linked_assets_label", "Linked assets")}</label>
            <MultiSelect
              options={assetOptions}
              selected={linkedAssetIds}
              onChange={setLinkedAssetIds}
              placeholder={t("risk_scenarios.select_placeholder")}
              emptyLabel={t("risk_scenarios.no_options")}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [annotating, setAnnotating] = useState<any | null>(null);
  const [assetOptions, setAssetOptions] = useState<MultiSelectOption[]>([]);

  const PAGE_SIZE = 200;  // backend caps page_size at 200; "Load more" appends the rest

  async function fetchPage(p: number) {
    const params: any = { page_size: PAGE_SIZE, page: p };
    if (q) params.q = q;
    if (minCvss) params.min_cvss = parseFloat(minCvss);
    if (relFilter) params.relevance = relFilter;
    const d = await cveApi.search(params);
    return Array.isArray(d) ? d : [];
  }

  async function load() {  // (re)load from page 1
    setLoading(true); setPage(1);
    try {
      const d = await fetchPage(1);
      setItems(d);
      setHasMore(d.length === PAGE_SIZE);
    } catch { setItems([]); setHasMore(false); } finally { setLoading(false); }
  }

  async function loadMore() {
    const next = page + 1;
    setLoadingMore(true);
    try {
      const d = await fetchPage(next);
      setItems((prev) => [...prev, ...d]);
      setPage(next);
      setHasMore(d.length === PAGE_SIZE);
    } catch { /* keep what we have */ } finally { setLoadingMore(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [relFilter, minCvss]);

  useEffect(() => {
    assetsApi.list({ page_size: 500 }).then((d: any) => {
      const list = Array.isArray(d) ? d : d.items || [];
      setAssetOptions(list.map((a: any) => ({ id: a.id, label: a.name })));
    }).catch(() => setAssetOptions([]));
  }, []);

  async function sync() {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await cveApi.sync(7);
      setSyncMsg(`Synced from NVD: ${r.added} added, ${r.updated} updated (${r.fetched} fetched).`);
      load();
    } catch { setSyncMsg("Sync failed — NVD may be unreachable or rate-limited."); }
    finally { setSyncing(false); }
  }

  async function setRelevance(cve: any, relevance: string) {
    setBusy(cve.cve_id);
    try {
      // Preserve existing notes/linked_asset_ids — the API requires the full
      // annotation payload, so a relevance-only change must not wipe them.
      await cveApi.annotate(cve.cve_id, { relevance, notes: cve.notes || null, linked_asset_ids: cve.linked_asset_ids || [] });
      setItems((prev) => prev.map((c) => (c.cve_id === cve.cve_id ? { ...c, relevance } : c)));
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
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("cve.col_notes", "Notes")}</th>
              </tr></thead>
              <tbody>
                {items.map((c) => {
                  const hasAnnotation = !!(c.notes || c.linked_asset_ids?.length);
                  return (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-6 py-4 font-mono text-xs text-blue-700 whitespace-nowrap">{c.cve_id}</td>
                      <td className="px-6 py-4"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CVSS_BADGE(c.cvss_score)}`}>{c.cvss_score ?? "—"}</span></td>
                      <td className="px-6 py-4 text-gray-600 max-w-xl"><span className="line-clamp-2">{c.description || "—"}</span></td>
                      <td className="px-6 py-4">
                        <select
                          value={c.relevance || ""}
                          disabled={busy === c.cve_id}
                          onChange={(e) => setRelevance(c, e.target.value)}
                          className={`text-xs rounded-full px-2.5 py-1 border font-semibold focus:outline-none ${c.relevance ? REL_BADGE[c.relevance] : "bg-white text-gray-500 border-gray-200"}`}
                        >
                          <option value="">{t("cve.triage", "Triage…")}</option>
                          {RELEVANCE.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => setAnnotating(c)}
                          title={t("cve.notes_label", "Internal notes")}
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${hasAnnotation ? "bg-blue-50 text-blue-600" : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"}`}
                        >
                          <StickyNote className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && items.length > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{t("cve.showing", "Showing")} {items.length}{hasMore ? "+" : ""} {t("cve.count_label", "CVEs")}</span>
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
              {t("cve.load_more", "Load more")}
            </button>
          )}
        </div>
      )}

      {annotating && (
        <AnnotationModal
          cve={annotating}
          assetOptions={assetOptions}
          onClose={() => setAnnotating(null)}
          onSaved={(updated) => setItems((prev) => prev.map((c) => (c.cve_id === updated.cve_id ? updated : c)))}
        />
      )}
    </div>
  );
}
