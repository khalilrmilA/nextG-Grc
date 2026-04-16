import { useState, useEffect } from "react";
import {
  Plus, Search, X, Loader2, Filter, Shield, Trash2, Tag,
  Sparkles, Download, ThumbsUp, ThumbsDown, Clock, CheckCircle2, RefreshCw,
  AlertTriangle, ExternalLink, CheckCheck, ChevronRight,
} from "lucide-react";
import { threatsApi } from "@/api/endpoints";

const CATEGORY_OPTIONS = [
  "cyber_attack", "social_engineering", "insider_threat", "supply_chain",
  "physical", "natural_disaster", "technical_failure", "human_error", "legal_regulatory",
];

const CATEGORY_BADGE: Record<string, string> = {
  cyber_attack:       "bg-red-100 text-red-700 border-red-200",
  social_engineering: "bg-orange-100 text-orange-700 border-orange-200",
  insider_threat:     "bg-purple-100 text-purple-700 border-purple-200",
  supply_chain:       "bg-yellow-100 text-yellow-700 border-yellow-200",
  physical:           "bg-gray-100 text-gray-700 border-gray-200",
  natural_disaster:   "bg-blue-100 text-blue-700 border-blue-200",
  technical_failure:  "bg-cyan-100 text-cyan-700 border-cyan-200",
  human_error:        "bg-pink-100 text-pink-700 border-pink-200",
  legal_regulatory:   "bg-indigo-100 text-indigo-700 border-indigo-200",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-100 text-orange-700 border-orange-200",
  medium:   "bg-yellow-100 text-yellow-700 border-yellow-200",
  low:      "bg-green-100 text-green-700 border-green-200",
};

function fmt(s: string) {
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function ThreatDetailModal({ threat, onClose }: { threat: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {threat.ref_id && (
                <span className="font-mono text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                  {threat.ref_id}
                </span>
              )}
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[threat.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                {fmt(threat.category || "other")}
              </span>
              {threat.severity && (
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEVERITY_BADGE[threat.severity] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                  {fmt(threat.severity)}
                </span>
              )}
              {threat.is_builtin && (
                <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                  Built-in
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{threat.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0 mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Description */}
          {threat.description && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Description</h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{threat.description}</p>
            </div>
          )}

          {/* Threat actors */}
          {threat.typical_threat_actors?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Threat Actors</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.typical_threat_actors.map((a: string, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs bg-red-50 text-red-700 border border-red-200">
                    <AlertTriangle className="w-3 h-3" />{a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Attack vectors / tags */}
          {threat.typical_attack_vectors?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Attack Vectors / Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.typical_attack_vectors.map((v: string, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs bg-orange-50 text-orange-700 border border-orange-200">
                    <Tag className="w-3 h-3" />{v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* MITRE IDs */}
          {threat.mitre_ids?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">MITRE ATT&CK IDs</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.mitre_ids.map((id: string, i: number) => (
                  <span key={i} className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-mono bg-purple-50 text-purple-700 border border-purple-200">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Affected assets */}
          {threat.affected_assets?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Affected Assets</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.affected_assets.map((a: string, i: number) => (
                  <span key={i} className="inline-flex rounded-full px-2.5 py-0.5 text-xs bg-gray-100 text-gray-600 border border-gray-200">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source + link */}
          {(threat.source || threat.url) && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Source</h3>
              <div className="flex items-center gap-3">
                {threat.source && (
                  <span className="text-sm text-gray-600 font-medium">{threat.source}</span>
                )}
                {threat.url && (
                  <a
                    href={threat.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> View Advisory
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ThreatLibraryPage() {
  const [items, setItems]           = useState<any[]>([]);
  const [pending, setPending]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [detail, setDetail]         = useState<any | null>(null);
  const [search, setSearch]         = useState("");
  const [catFilter, setCatFilter]   = useState("");
  const [error, setError]           = useState("");
  const [submitting, setSubmitting] = useState(false);

  // button states
  const [importing, setImporting]     = useState(false);
  const [fetching, setFetching]       = useState(false);
  const [actioning, setActioning]     = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [notice, setNotice]           = useState<{ msg: string; ok: boolean } | null>(null);

  const [form, setForm] = useState({
    ref_id: "", name: "", description: "",
    category: "cyber_attack", typical_threat_actors: "", mitre_ids: "",
  });

  async function load() {
    try {
      const params: any = {};
      if (catFilter) params.category = catFilter;
      const [data, pend] = await Promise.all([
        threatsApi.list(params),
        threatsApi.listPending(),
      ]);
      setItems(Array.isArray(data) ? data : []);
      setPending(Array.isArray(pend) ? pend : []);
    } catch {
      setItems([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [catFilter]);

  /* ── MITRE one-time import ── */
  async function handleImportMitre() {
    if (!confirm("This will import all 700+ MITRE ATT&CK techniques into your library. Continue?")) return;
    setImporting(true);
    setNotice(null);
    try {
      const r = await threatsApi.importMitre();
      setNotice({ msg: r.message, ok: true });
      setLoading(true);
      load();
    } catch {
      setNotice({ msg: "MITRE import failed — check backend logs.", ok: false });
    } finally {
      setImporting(false);
    }
  }

  /* ── Ongoing feed ── */
  async function handleFetchNews() {
    setFetching(true);
    setNotice(null);
    try {
      const r = await threatsApi.fetchNews();
      setNotice({ msg: r.message, ok: r.created > 0 });
      if (r.created > 0) load();
    } catch {
      setNotice({ msg: "Feed fetch failed — check backend logs.", ok: false });
    } finally {
      setFetching(false);
    }
  }

  /* ── Approve single ── */
  async function handleApprove(id: string) {
    setActioning(id);
    try { await threatsApi.approve(id); load(); }
    finally { setActioning(null); }
  }

  /* ── Approve all pending ── */
  async function handleApproveAll() {
    if (!confirm(`Approve all ${pending.length} pending threats and add them to your library?`)) return;
    setApprovingAll(true);
    setNotice(null);
    try {
      await Promise.all(pending.map((t) => threatsApi.approve(t.id)));
      setNotice({ msg: `Approved ${pending.length} threat${pending.length > 1 ? "s" : ""} — added to library.`, ok: true });
      load();
    } catch {
      setNotice({ msg: "Some approvals failed — check backend logs.", ok: false });
    } finally {
      setApprovingAll(false);
    }
  }

  /* ── Reject single ── */
  async function handleReject(id: string) {
    setActioning(id);
    try { await threatsApi.reject(id); load(); }
    finally { setActioning(null); }
  }

  /* ── Manual create ── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSubmitting(true);
    setError("");
    try {
      await threatsApi.create({
        ...form,
        typical_threat_actors: form.typical_threat_actors
          ? form.typical_threat_actors.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        mitre_ids: form.mitre_ids
          ? form.mitre_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      });
      setShowModal(false);
      setForm({ ref_id: "", name: "", description: "", category: "cyber_attack", typical_threat_actors: "", mitre_ids: "" });
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to create threat");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this threat?")) return;
    try { await threatsApi.delete(id); load(); } catch {}
  }

  const filtered = items.filter(
    (i) => i.name?.toLowerCase().includes(search.toLowerCase()) ||
           i.ref_id?.toLowerCase().includes(search.toLowerCase()),
  );

  const grouped: Record<string, any[]> = {};
  for (const item of filtered) {
    const cat = item.category || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Threat Library</h1>
          <p className="text-sm text-gray-500 mt-1">
            Browse threats · {items.length} in library
            {pending.length > 0 && <span className="ml-2 text-amber-600 font-medium">· {pending.length} pending review</span>}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-purple-400" />
            Auto-fetches from CISA KEV · SANS ISC · opensourcemalware.com every 24h
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportMitre}
            disabled={importing}
            title="One-time import of all 700+ MITRE ATT&CK techniques"
            className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-orange-600 disabled:opacity-60 transition-colors"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {importing ? "Importing..." : "Import MITRE ATT&CK"}
          </button>
          <button
            onClick={handleFetchNews}
            disabled={fetching}
            title="Auto-fetches every 24h · Click to run now (CISA KEV, SANS ISC, opensourcemalware.com)"
            className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
          >
            {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {fetching ? "Fetching..." : "Fetch Now"}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Threat
          </button>
        </div>
      </div>

      {/* Notice banner */}
      {notice && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm border ${notice.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-700"}`}>
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="flex-1">{notice.msg}</span>
          <button onClick={() => setNotice(null)}><X className="w-4 h-4 opacity-50 hover:opacity-100" /></button>
        </div>
      )}

      {/* Pending approval queue */}
      {pending.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-amber-100 bg-amber-50/60">
            <Clock className="w-4 h-4 text-amber-600" />
            <h2 className="font-semibold text-amber-900 text-sm">
              Pending Review — {pending.length} new threat{pending.length > 1 ? "s" : ""} from feeds
            </h2>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-amber-600 hidden sm:inline">Approve to add · Reject to discard</span>
              <button
                onClick={handleApproveAll}
                disabled={approvingAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {approvingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                {approvingAll ? "Approving..." : "Approve All"}
              </button>
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {pending.map((t: any) => (
              <div
                key={t.id}
                className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50/40 transition-colors cursor-pointer"
                onClick={() => setDetail(t)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.ref_id && <span className="font-mono text-xs text-gray-400">{t.ref_id}</span>}
                    <span className="font-medium text-sm text-gray-900">{t.name}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[t.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {fmt(t.category || "cyber_attack")}
                    </span>
                    {t.severity && (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${SEVERITY_BADGE[t.severity] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {fmt(t.severity)}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {t.typical_threat_actors?.slice(0, 3).map((a: string, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-red-50 text-red-600 border border-red-100">
                        <AlertTriangle className="w-2.5 h-2.5" />{a}
                      </span>
                    ))}
                    {t.typical_attack_vectors?.slice(0, 3).map((v: string, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-orange-50 text-orange-600 border border-orange-100">
                        <Tag className="w-2.5 h-2.5" />{v}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleApprove(t.id)}
                    disabled={actioning === t.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {actioning === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(t.id)}
                    disabled={actioning === t.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {actioning === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threats..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{fmt(c)}</option>)}
          </select>
        </div>
      </div>

      {/* Library grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No threats in library yet</p>
          <p className="text-xs mt-1">Click <strong>Import MITRE ATT&CK</strong> to seed 700+ techniques, or <strong>Fetch Now</strong> for live feeds</p>
        </div>
      ) : (
        Object.entries(grouped).map(([category, threats]) => (
          <div key={category} className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {fmt(category)} ({threats.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {threats.map((threat: any) => (
                <div
                  key={threat.id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
                  onClick={() => setDetail(threat)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {threat.ref_id && <span className="font-mono text-xs text-gray-400">{threat.ref_id}</span>}
                      {threat.is_builtin ? (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">Built-in</span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(threat.id); }}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[threat.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {fmt(threat.category || "other")}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400 transition-colors" />
                    </div>
                  </div>

                  <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2 leading-snug">{threat.name}</h3>
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{threat.description || "No description"}</p>

                  {/* Actors + vectors/tags combined */}
                  {((threat.typical_threat_actors?.length > 0) || (threat.typical_attack_vectors?.length > 0)) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {threat.typical_threat_actors?.slice(0, 2).map((actor: string, idx: number) => (
                        <span key={`a-${idx}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-red-50 text-red-600 border border-red-100">
                          <AlertTriangle className="w-2.5 h-2.5" />{actor}
                        </span>
                      ))}
                      {threat.typical_attack_vectors?.slice(0, 3).map((v: string, idx: number) => (
                        <span key={`v-${idx}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-orange-50 text-orange-600 border border-orange-100">
                          <Tag className="w-2.5 h-2.5" />{v}
                        </span>
                      ))}
                      {((threat.typical_threat_actors?.length || 0) + (threat.typical_attack_vectors?.length || 0)) > 5 && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-500">
                          +{(threat.typical_threat_actors?.length || 0) + (threat.typical_attack_vectors?.length || 0) - 5} more
                        </span>
                      )}
                    </div>
                  )}

                  {threat.mitre_ids?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {threat.mitre_ids.slice(0, 3).map((id: string, idx: number) => (
                        <span key={idx} className="inline-flex rounded-full px-2 py-0.5 text-xs font-mono bg-purple-50 text-purple-600 border border-purple-200">
                          {id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Detail modal */}
      {detail && <ThreatDetailModal threat={detail} onClose={() => setDetail(null)} />}

      {/* Manual create modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Add Threat</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reference ID</label>
                  <input value={form.ref_id} onChange={(e) => setForm({ ...form, ref_id: e.target.value })} placeholder="T-001" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{fmt(c)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Typical Threat Actors (comma-separated)</label>
                <input value={form.typical_threat_actors} onChange={(e) => setForm({ ...form, typical_threat_actors: e.target.value })} placeholder="APT28, Lazarus Group" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">MITRE ATT&CK IDs (comma-separated)</label>
                <input value={form.mitre_ids} onChange={(e) => setForm({ ...form, mitre_ids: e.target.value })} placeholder="T1566, T1078" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Add Threat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
