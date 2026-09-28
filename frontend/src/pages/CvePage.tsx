import { useState, useEffect } from "react";
import {
  Search, Loader2, Crown, RefreshCw, Database, ChevronDown, StickyNote, X,
  ShieldCheck, Wrench, ExternalLink, Bug, CalendarDays, Flame,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AutoTranslatedBadge, TranslatedText, pickText } from "@/components/common/AutoTranslatedBadge";
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
// The triage verdict on a CVE. Rendered through t() with a humanised fallback
// (keys: cve.rel_pertinent / cve.rel_to_watch / cve.rel_non_pertinent) — this
// select printed the raw enum in every language.
const RELEVANCE = ["pertinent", "to_watch", "non_pertinent"];

// CVSS v3 vector metrics, spelled out. "AV:N/AC:L/PR:N" is precise and
// unreadable; the requirement asks the sheet to show the attack vector, which
// means showing what it says, not the shorthand.
const VECTOR_METRICS: Record<string, { label: string; values: Record<string, string> }> = {
  AV: { label: "Attack vector", values: { N: "Network", A: "Adjacent network", L: "Local", P: "Physical" } },
  AC: { label: "Attack complexity", values: { L: "Low", H: "High" } },
  PR: { label: "Privileges required", values: { N: "None", L: "Low", H: "High" } },
  UI: { label: "User interaction", values: { N: "None", R: "Required" } },
  S: { label: "Scope", values: { U: "Unchanged", C: "Changed" } },
  C: { label: "Confidentiality impact", values: { H: "High", L: "Low", N: "None" } },
  I: { label: "Integrity impact", values: { H: "High", L: "Low", N: "None" } },
  A: { label: "Availability impact", values: { H: "High", L: "Low", N: "None" } },
};

/** The English text in VECTOR_METRICS is the t() fallback, not the rendered
 *  string: these eight metric names and their values were printed in English
 *  whatever the interface language was. Keys go under cve.vec_* / cve.vecv_*. */
function decodeVector(
  vector: string | null | undefined,
  tr: (key: string, fallback: string) => string,
): { key: string; label: string; value: string }[] {
  if (!vector) return [];
  return vector
    .split("/")
    .map((part) => part.split(":"))
    .filter(([k, v]) => k && v && VECTOR_METRICS[k])
    .map(([k, v]) => ({
      key: k,
      label: tr(`cve.vec_${k}`, VECTOR_METRICS[k].label),
      value: tr(`cve.vecv_${k}_${v}`, VECTOR_METRICS[k].values[v] || v),
    }));
}

// NVD tags a reference by what it is. Patch and Mitigation are the ones a
// responder is looking for, so they lead and are visually separated.
const REF_TAG_STYLE: Record<string, string> = {
  patch: "bg-green-100 text-green-700 border-green-200",
  mitigation: "bg-blue-100 text-blue-700 border-blue-200",
  "vendor advisory": "bg-indigo-100 text-indigo-700 border-indigo-200",
  exploit: "bg-red-100 text-red-700 border-red-200",
};

function fmtDate(value?: string | null) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function CveSheet({
  cveId,
  assetOptions,
  onClose,
  onSaved,
}: {
  cveId: string;
  assetOptions: MultiSelectOption[];
  onClose: () => void;
  onSaved: (updated: any) => void;
}) {
  const { t, i18n } = useTranslation();
  const [cve, setCve] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [relevance, setRelevance] = useState("to_watch");
  const [notes, setNotes] = useState("");
  const [linkedAssetIds, setLinkedAssetIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // NVD text is machine-translated into the UI language on demand by the API.
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    cveApi
      .detail(cveId)
      .then((d: any) => {
        if (!alive) return;
        setCve(d);
        setRelevance(d.relevance || "to_watch");
        setNotes(d.notes || "");
        setLinkedAssetIds(d.linked_asset_ids || []);
      })
      .catch(() => alive && setError(t("cve.error_load_failed", "Could not load this CVE")))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [cveId, t]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await cveApi.annotate(cveId, { relevance, notes, linked_asset_ids: linkedAssetIds });
      onSaved({ ...(cve || {}), ...updated });
      onClose();
    } catch {
      setError(t("cve.error_save_failed", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  const decoded = decodeVector(cve?.cvss_vector, (k, fb) => String(t(k as never, fb)));
  // NVD reference tags ("Patch", "Vendor Advisory", …) are feed data; the common
  // ones get a translated label, anything else is shown as NVD wrote it.
  const refTagLabel = (tag: string) => {
    const k = `cve_ui.ref_tags.${String(tag).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    return i18n.exists(k) ? String(t(k as never)) : tag;
  };
  const refs: any[] = cve?.references || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 font-mono">{cveId}</h2>
              {cve && (
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CVSS_BADGE(cve.cvss_score)}`}>
                  CVSS {cve.cvss_score ?? "—"}
                </span>
              )}
              {cve?.published_at && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <CalendarDays className="w-3.5 h-3.5" /> {fmtDate(cve.published_at)}
                </span>
              )}
            </div>
            {cve?.cvss_vector && <p className="text-xs font-mono text-gray-400 mt-1 truncate">{cve.cvss_vector}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {error && <div className="p-2.5 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

            {cve?.known_exploited && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
                <Flame className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-red-800">
                    {t("cve.kev_title", "Actively exploited (CISA KEV)")}
                    {cve.kev_added_at ? ` · ${t("cve.kev_since", "listed {{date}}", { date: cve.kev_added_at })}` : ""}
                  </p>
                  {cve.kev_due_date && (
                    <p className="text-red-700">{t("cve.kev_due", "Remediation due {{date}}", { date: cve.kev_due_date })}</p>
                  )}
                  {cve.kev_action && <p className="text-red-700 mt-1">{pickText(cve, "kev_action", showOriginal)}</p>}
                </div>
              </div>
            )}

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t("cve.col_desc", "Description")}</h3>
              <p className="text-sm text-gray-700 leading-relaxed">{pickText(cve, "description", showOriginal) || "—"}</p>
              {cve?.translated && (
                <AutoTranslatedBadge className="mt-2" showingOriginal={showOriginal} onToggle={() => setShowOriginal(v => !v)} />
              )}
            </section>

            {decoded.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t("cve.attack_vector", "Attack vector")}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {decoded.map((d) => (
                    <div key={d.key} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
                      <div className="text-[11px] text-gray-400">{d.label}</div>
                      <div className="text-sm font-medium text-gray-800">{d.value}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" /> {t("cve.flaw_type", "Flaw type (MITRE CWE)")}
              </h3>
              {(cve?.weaknesses || []).length === 0 ? (
                <p className="text-sm text-gray-400 italic">
                  {(cve?.cwe_ids || []).length > 0
                    ? t("cve.cwe_not_synced", "NVD classified this as {{codes}}, but the MITRE catalog has not been synced yet.", { codes: (cve?.cwe_ids || []).join(", ") })
                    : t("cve.cwe_none", "NVD has not classified this CVE against a weakness type yet.")}
                </p>
              ) : (
                <div className="space-y-3">
                  {(cve?.weaknesses || []).map((w: any) => (
                    <div key={w.cwe_id} className="rounded-xl border border-gray-100 p-4">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-xs text-blue-700">{w.cwe_id}</span>
                        <span className="text-sm font-semibold text-gray-900">{w.name}</span>
                        {w.abstraction && (
                          <span className="text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">{w.abstraction}</span>
                        )}
                      </div>
                      {w.description && <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{w.description}</p>}
                      {(w.mitigations || []).length > 0 && (
                        <div className="mt-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5" /> {t("cve.workarounds", "Known workarounds (MITRE)")}
                          </div>
                          <ul className="space-y-1.5">
                            {(w.mitigations || []).slice(0, 4).map((m: any, i: number) => (
                              <li key={i} className="text-sm text-gray-600 flex gap-2">
                                <span className="text-gray-300 mt-0.5">•</span>
                                <span>
                                  {m.phase && <span className="text-[11px] text-gray-400 mr-1.5">[{m.phase}]</span>}
                                  {m.description}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(w.capec_ids || []).length > 0 && (
                        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-gray-400">{t("cve.attack_patterns", "Attack patterns")}</span>
                          {(w.capec_ids || []).slice(0, 8).map((c: string) => (
                            <a
                              key={c}
                              href={`https://capec.mitre.org/data/definitions/${c.replace("CAPEC-", "")}.html`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-mono rounded-full border border-gray-200 px-2 py-0.5 text-gray-500 hover:text-blue-700 hover:border-blue-200"
                            >
                              {c}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5" /> {t("cve.fixes", "Fixes and advisories")}
              </h3>
              {refs.length === 0 ? (
                <p className="text-sm text-gray-400 italic">
                  {t("cve.no_refs", "No reference links recorded. Run a sync to pull them from NVD.")}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {refs.slice(0, 12).map((r: any, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <div className="flex gap-1 shrink-0 pt-0.5">
                        {(r.tags || []).slice(0, 2).map((tag: string) => (
                          <span
                            key={tag}
                            className={`text-[10px] rounded-full px-2 py-0.5 border font-semibold whitespace-nowrap ${
                              REF_TAG_STYLE[String(tag).toLowerCase()] || "bg-gray-100 text-gray-500 border-gray-200"
                            }`}
                          >
                            {refTagLabel(tag)}
                          </span>
                        ))}
                      </div>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline break-all inline-flex items-start gap-1"
                      >
                        {r.url}
                        <ExternalLink className="w-3 h-3 mt-1 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border-t border-gray-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                {t("cve.your_triage", "Your assessment for this environment")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("cve.col_rel", "Relevance")}</label>
                  <select value={relevance} onChange={(e) => setRelevance(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {RELEVANCE.map((r) => <option key={r} value={r}>{String(t(`cve.rel_${r}` as never, r.replace(/_/g, " ")))}</option>)}
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
                <div className="flex justify-end gap-3 pt-1">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
                  <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save")}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CvePage() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [vector, setVector] = useState("");
  const [cwe, setCwe] = useState("");
  const [publishedAfter, setPublishedAfter] = useState("");
  const [minCvss, setMinCvss] = useState("");
  const [relFilter, setRelFilter] = useState("");
  const [kevOnly, setKevOnly] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [annotateError, setAnnotateError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openCve, setOpenCve] = useState<string | null>(null);
  const [assetOptions, setAssetOptions] = useState<MultiSelectOption[]>([]);
  const [cweSuggestions, setCweSuggestions] = useState<{ cwe_id: string; name: string }[]>([]);

  const PAGE_SIZE = 200;  // backend caps page_size at 200; "Load more" appends the rest

  function buildParams(p: number) {
    const params: any = { page_size: PAGE_SIZE, page: p };
    if (q) params.q = q;
    if (vector) params.vector = vector;
    if (cwe) params.cwe = cwe;
    if (publishedAfter) params.published_after = `${publishedAfter}T00:00:00`;
    if (minCvss) params.min_cvss = parseFloat(minCvss);
    if (relFilter) params.relevance = relFilter;
    if (kevOnly) params.known_exploited = true;
    return params;
  }

  async function fetchPage(p: number) {
    const d = await cveApi.search(buildParams(p));
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
  // i18n.language: descriptions come back in the UI language (translated on demand).
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [relFilter, minCvss, kevOnly, i18n.language]);

  useEffect(() => {
    assetsApi.options().then((d: any) => {
      const list = Array.isArray(d) ? d : d.items || [];
      setAssetOptions(list.map((a: any) => ({ id: a.id, label: a.name })));
    }).catch(() => setAssetOptions([]));
  }, []);

  // Suggest weakness types as the user types, so the flaw-type filter can be
  // driven by a name ("cross-site scripting") rather than a memorised code.
  useEffect(() => {
    const term = cwe.trim();
    if (term.length < 2) { setCweSuggestions([]); return; }
    const handle = setTimeout(() => {
      cveApi.cwe(term, 12).then((d: any) => setCweSuggestions(Array.isArray(d) ? d : [])).catch(() => setCweSuggestions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [cwe]);

  async function sync() {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await cveApi.sync(7);
      const cweBit = r.cwe && !r.cwe.skipped
        ? t("cve.sync_cwe", " MITRE CWE catalog {{version}}: {{n}} weaknesses.", { version: r.cwe.version || "", n: (r.cwe.added || 0) + (r.cwe.updated || 0) })
        : "";
      setSyncMsg(
        t("cve.sync_result", "NVD: {{added}} added, {{updated}} updated, {{refreshed}} re-checked for new analysis.", {
          added: r.added, updated: r.updated, refreshed: r.refreshed ?? 0,
        }) + cweBit
      );
      load();
    } catch { setSyncMsg(t("cve.sync_failed", "Sync failed — NVD may be unreachable or rate-limited.")); }
    finally { setSyncing(false); }
  }

  async function setRelevance(cve: any, relevance: string) {
    setBusy(cve.cve_id);
    setAnnotateError("");
    try {
      // Preserve existing notes/linked_asset_ids — the API requires the full
      // annotation payload, so a relevance-only change must not wipe them.
      await cveApi.annotate(cve.cve_id, { relevance, notes: cve.notes || null, linked_asset_ids: cve.linked_asset_ids || [] });
      setItems((prev) => prev.map((c) => (c.cve_id === cve.cve_id ? { ...c, relevance } : c)));
    } catch (err: any) {
      // This used to `catch {}`: the triage badge simply did not move and the
      // user had no way to tell a refused write from a slow one.
      setAnnotateError(err?.response?.data?.detail || t("errors.save_failed"));
    } finally { setBusy(""); }
  }

  const inputCls = "border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500";

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
      {annotateError && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{annotateError}</div>}

      <div className="flex items-center gap-3 flex-wrap">
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="relative flex-1 min-w-[16rem] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cve.search", "Search CVE id or description…")} className={`w-full pl-10 pr-4 py-2 ${inputCls}`} />
        </form>
        <div>
          <input
            list="cwe-suggestions"
            value={cwe}
            onChange={(e) => setCwe(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder={t("cve.cwe_filter_placeholder", "Flaw type, e.g. CWE-79 or XSS")}
            className={`${inputCls} w-56`}
          />
          <datalist id="cwe-suggestions">
            {cweSuggestions.map((c) => <option key={c.cwe_id} value={c.cwe_id}>{`${c.cwe_id} — ${c.name}`}</option>)}
          </datalist>
        </div>
        <input
          value={vector}
          onChange={(e) => setVector(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(); }}
          placeholder={t("cve.vector_filter_placeholder", "CVSS vector, e.g. AV:N/AC:L/...")}
          className={`${inputCls} font-mono w-52`}
        />
        <input
          type="date"
          value={publishedAfter}
          onChange={(e) => setPublishedAfter(e.target.value)}
          title={t("cve.published_after", "Published on or after")}
          className={inputCls}
        />
        <select value={minCvss} onChange={(e) => { setMinCvss(e.target.value); }} className={inputCls}>
          <option value="">{t("cve.any_cvss", "Any CVSS")}</option>
          <option value="9">{t("cve_ui.cvss_min_9", "≥ 9.0 (critical)")}</option>
          <option value="7">{t("cve_ui.cvss_min_7", "≥ 7.0 (high+)")}</option>
          <option value="4">{t("cve_ui.cvss_min_4", "≥ 4.0 (medium+)")}</option>
        </select>
        <button
          type="button"
          onClick={() => setKevOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium ${
            kevOnly ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
        >
          <Flame className="w-4 h-4" /> {t("cve.kev_filter", "Actively exploited")}
        </button>
        <select value={relFilter} onChange={(e) => setRelFilter(e.target.value)} className={inputCls}>
          <option value="">{t("cve.all_relevance", "All relevance")}</option>
          {RELEVANCE.map((r) => <option key={r} value={r}>{String(t(`cve.rel_${r}` as never, r.replace(/_/g, " ")))}</option>)}
          <option value="untriaged">{t("cve.untriaged", "untriaged")}</option>
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
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_cwe", "Flaw type")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_desc", "Description")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_published", "Published")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("cve.col_rel", "Relevance")}</th>
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("cve.col_notes", "Notes")}</th>
              </tr></thead>
              <tbody>
                {items.map((c) => {
                  const hasAnnotation = !!(c.notes || c.linked_asset_ids?.length);
                  const weaknesses: { cwe_id: string; name?: string | null }[] = c.cwe?.length ? c.cwe : (c.cwe_ids || []).map((id: string) => ({ cwe_id: id }));
                  return (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button onClick={() => setOpenCve(c.cve_id)} className="font-mono text-xs text-blue-700 hover:underline">{c.cve_id}</button>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CVSS_BADGE(c.cvss_score)}`}>{c.cvss_score ?? "—"}</span>
                          {c.known_exploited && (
                            <span
                              title={t("cve.kev_hint", "CISA lists this as actively exploited — remediate by {{date}}", { date: c.kev_due_date || "—" })}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border bg-red-100 text-red-700 border-red-200 whitespace-nowrap"
                            >
                              <Flame className="w-3 h-3" /> {t("cve.kev_short", "Exploited")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {weaknesses.length === 0 ? <span className="text-gray-300">—</span> : (
                          <div className="flex flex-col gap-0.5 max-w-[13rem]">
                            {weaknesses.slice(0, 2).map((w) => (
                              <span key={w.cwe_id} className="text-xs text-gray-600 truncate" title={w.name ? `${w.cwe_id} — ${w.name}` : w.cwe_id}>
                                <span className="font-mono text-[11px] text-gray-400">{w.cwe_id}</span>
                                {w.name ? <span className="ml-1.5">{w.name}</span> : null}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600 max-w-md"><TranslatedText item={c} field="description" className="line-clamp-2">{c.description || "—"}</TranslatedText></td>
                      <td className="px-6 py-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(c.published_at)}</td>
                      <td className="px-6 py-4">
                        <select
                          value={c.relevance || ""}
                          disabled={busy === c.cve_id}
                          onChange={(e) => setRelevance(c, e.target.value)}
                          className={`text-xs rounded-full px-2.5 py-1 border font-semibold focus:outline-none ${c.relevance ? REL_BADGE[c.relevance] : "bg-white text-gray-500 border-gray-200"}`}
                        >
                          <option value="">{t("cve.triage", "Triage…")}</option>
                          {RELEVANCE.map((r) => <option key={r} value={r}>{String(t(`cve.rel_${r}` as never, r.replace(/_/g, " ")))}</option>)}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => setOpenCve(c.cve_id)}
                          title={t("cve.open_sheet", "Open the full sheet")}
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

      {openCve && (
        <CveSheet
          cveId={openCve}
          assetOptions={assetOptions}
          onClose={() => setOpenCve(null)}
          onSaved={(updated) => setItems((prev) => prev.map((c) => (c.cve_id === updated.cve_id ? { ...c, ...updated } : c)))}
        />
      )}
    </div>
  );
}
