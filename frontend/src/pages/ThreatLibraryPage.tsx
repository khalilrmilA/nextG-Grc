import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, Filter, Shield, Trash2, Tag } from "lucide-react";
import { threatsApi } from "@/api/endpoints";

const CATEGORY_OPTIONS = [
  "malware", "social_engineering", "network_attack", "physical",
  "insider_threat", "supply_chain", "web_application", "cloud",
  "iot",
];

const CATEGORY_BADGE: Record<string, string> = {
  malware: "bg-red-100 text-red-700 border-red-200",
  social_engineering: "bg-orange-100 text-orange-700 border-orange-200",
  network_attack: "bg-blue-100 text-blue-700 border-blue-200",
  physical: "bg-gray-100 text-gray-700 border-gray-200",
  insider_threat: "bg-purple-100 text-purple-700 border-purple-200",
  supply_chain: "bg-yellow-100 text-yellow-700 border-yellow-200",
  web_application: "bg-cyan-100 text-cyan-700 border-cyan-200",
  cloud: "bg-indigo-100 text-indigo-700 border-indigo-200",
  iot: "bg-teal-100 text-teal-700 border-teal-200",
};

export default function ThreatLibraryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    ref_id: "",
    name: "",
    description: "",
    category: "malware",
    typical_threat_actors: "",
    mitre_ids: "",
  });

  async function load() {
    try {
      const params: any = {};
      if (catFilter) params.category = catFilter;
      const data = await threatsApi.list(params);
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [catFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSubmitting(true);
    setError("");
    try {
      const payload: any = {
        ...form,
        typical_threat_actors: form.typical_threat_actors ? form.typical_threat_actors.split(",").map((s) => s.trim()).filter(Boolean) : [],
        mitre_ids: form.mitre_ids ? form.mitre_ids.split(",").map((s) => s.trim()).filter(Boolean) : [],
      };
      await threatsApi.create(payload);
      setShowModal(false);
      setForm({ ref_id: "", name: "", description: "", category: "malware", typical_threat_actors: "", mitre_ids: "" });
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
    try {
      await threatsApi.delete(id);
      load();
    } catch {}
  }

  const filtered = items.filter((i) =>
    i.name?.toLowerCase().includes(search.toLowerCase()) || i.ref_id?.toLowerCase().includes(search.toLowerCase())
  );

  // Group by category
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
          <p className="text-sm text-gray-500 mt-1">Browse and manage threat definitions</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Threat
        </button>
      </div>

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
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Categories</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16 text-gray-400">No threats found</div>
      ) : (
        Object.entries(grouped).map(([category, threats]) => (
          <div key={category} className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {category.replace(/_/g, " ")} ({threats.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {threats.map((threat: any) => (
                <div key={threat.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {threat.ref_id && <span className="font-mono text-xs text-gray-400">{threat.ref_id}</span>}
                      {threat.is_builtin ? (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">Built-in</span>
                      ) : (
                        <button onClick={() => handleDelete(threat.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[threat.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {threat.category?.replace(/_/g, " ")}
                    </span>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">{threat.name}</h3>
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{threat.description || "No description"}</p>
                  {threat.typical_threat_actors && threat.typical_threat_actors.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(Array.isArray(threat.typical_threat_actors) ? threat.typical_threat_actors : []).map((actor: string, idx: number) => (
                        <span key={idx} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-600">
                          <Tag className="w-3 h-3" />{actor}
                        </span>
                      ))}
                    </div>
                  )}
                  {threat.mitre_ids && threat.mitre_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(Array.isArray(threat.mitre_ids) ? threat.mitre_ids : []).map((id: string, idx: number) => (
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

      {/* Create Modal */}
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
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
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
