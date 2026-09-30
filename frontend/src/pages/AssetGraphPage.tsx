import { useState, useEffect, useMemo } from "react";
import {
  Network, Plus, X, Loader2, Filter, Building2, Workflow,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { assetGraphApi, assetsApi, usersApi } from "@/api/endpoints";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GraphNode { id: string; label: string; type: "entity" | "process" | "asset"; }
interface GraphEdge { source: string; target: string; kind: string; }
interface CartographyGraph { nodes: GraphNode[]; edges: GraphEdge[]; stats: Record<string, number>; }

const TYPE_COLOR: Record<string, { fill: string; stroke: string; text: string }> = {
  entity:  { fill: "#EEF2FF", stroke: "#3F92D6", text: "#4338CA" },
  process: { fill: "#ECFDF5", stroke: "#5BBD74", text: "#047857" },
  asset:   { fill: "#FFF7ED", stroke: "#EF852E", text: "#C2410C" },
};

// ─── Deterministic concentric-ring layout (no physics dependency) ──────────

function computeLayout(nodes: GraphNode[], width: number, height: number) {
  const cx = width / 2, cy = height / 2;
  const minDim = Math.min(width, height);
  const rings: Record<string, GraphNode[]> = { entity: [], process: [], asset: [] };
  nodes.forEach((n) => rings[n.type]?.push(n));
  const radii: Record<string, number> = {
    entity: rings.entity.length <= 1 ? 0 : minDim * 0.16,
    process: minDim * 0.32,
    asset: minDim * 0.46,
  };
  const pos: Record<string, { x: number; y: number }> = {};
  (["entity", "process", "asset"] as const).forEach((type) => {
    const arr = rings[type];
    const r = radii[type];
    arr.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(arr.length, 1) - Math.PI / 2;
      pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  });
  return pos;
}

// ─── Graph canvas ───────────────────────────────────────────────────────────

function GraphCanvas({ graph }: { graph: CartographyGraph }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const width = 900, height = 620;
  const pos = useMemo(() => computeLayout(graph.nodes, width, height), [graph.nodes]);

  const connected = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>([selected]);
    graph.edges.forEach((e) => {
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    });
    return s;
  }, [selected, graph.edges]);

  const selectedNode = graph.nodes.find((n) => n.id === selected) || null;

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <Network className="w-10 h-10 mb-3 text-gray-300" />
        <p className="text-sm">{t("asset_graph.empty", "No org entities or business processes yet. Create some on the left to see the graph.")}</p>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1 overflow-auto bg-gray-50/50 rounded-xl border border-gray-100">
        <svg width={width} height={height} className="select-none">
          {graph.edges.map((e, i) => {
            const a = pos[e.source], b = pos[e.target];
            if (!a || !b) return null;
            const dim = connected && !(connected.has(e.source) && connected.has(e.target));
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={dim ? "#D9DAD6" : "#8E9299"}
                strokeWidth={dim ? 1 : 1.5}
                opacity={dim ? 0.4 : 0.9}
              />
            );
          })}
          {graph.nodes.map((n) => {
            const p = pos[n.id];
            if (!p) return null;
            const c = TYPE_COLOR[n.type];
            const dim = connected && !connected.has(n.id);
            const isSelected = selected === n.id;
            const r = n.type === "entity" ? 9 : n.type === "process" ? 7 : 5.5;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                onClick={() => setSelected(isSelected ? null : n.id)}
                className="cursor-pointer"
                opacity={dim ? 0.35 : 1}
              >
                <circle r={r} fill={c.fill} stroke={c.stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
                <text
                  y={r + 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill={c.text}
                  fontWeight={isSelected ? 700 : 500}
                >
                  {n.label.length > 16 ? n.label.slice(0, 15) + "…" : n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="w-56 flex-shrink-0 space-y-4">
        <div className="bg-white border border-gray-100 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t("asset_graph.legend", "Legend")}</p>
          {(["entity", "process", "asset"] as const).map((type) => (
            <div key={type} className="flex items-center gap-2 text-xs text-gray-600 mb-1.5">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: TYPE_COLOR[type].fill, border: `1.5px solid ${TYPE_COLOR[type].stroke}` }} />
              {type === "entity" ? t("asset_graph.type_entity", "Org Entity") : type === "process" ? t("asset_graph.type_process", "Business Process") : t("asset_graph.type_asset", "Asset")}
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-3 text-xs text-gray-600 space-y-1">
          <div className="flex justify-between"><span>{t("asset_graph.stat_entities", "Entities")}</span><b>{graph.stats.entities ?? 0}</b></div>
          <div className="flex justify-between"><span>{t("asset_graph.stat_processes", "Processes")}</span><b>{graph.stats.processes ?? 0}</b></div>
          <div className="flex justify-between"><span>{t("asset_graph.stat_assets", "Assets")}</span><b>{graph.stats.assets ?? 0}</b></div>
          <div className="flex justify-between border-t border-gray-50 pt-1 mt-1"><span>{t("asset_graph.stat_edges", "Links")}</span><b>{graph.stats.edges ?? 0}</b></div>
        </div>

        {selectedNode && (
          <div className="bg-white border border-gray-100 rounded-xl p-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t("asset_graph.selected", "Selected")}</p>
            <p className="text-sm font-medium text-gray-800">{selectedNode.label}</p>
            <p className="text-xs text-gray-400 mt-0.5 capitalize">{selectedNode.type}</p>
            <p className="text-xs text-gray-500 mt-2">
              {t("asset_graph.connections", "{{count}} direct connection(s)", { count: (connected?.size ?? 1) - 1 })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function AssetGraphPage() {
  const { t } = useTranslation();
  const [graph, setGraph] = useState<CartographyGraph>({ nodes: [], edges: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [assetOptions, setAssetOptions] = useState<MultiSelectOption[]>([]);
  const [userOptions, setUserOptions] = useState<MultiSelectOption[]>([]);
  const [assetTypes, setAssetTypes] = useState<string[]>([]);

  const [entityFilter, setEntityFilter] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("");

  const [showEntityForm, setShowEntityForm] = useState(false);
  const [entityForm, setEntityForm] = useState({ name: "", parent_id: "", entity_type: "" });
  const [entitySubmitting, setEntitySubmitting] = useState(false);

  const [showProcessForm, setShowProcessForm] = useState(false);
  const [processForm, setProcessForm] = useState({ name: "", entity_id: "", criticality: "medium", owner_id: "", asset_ids: [] as string[] });
  const [processSubmitting, setProcessSubmitting] = useState(false);

  async function loadGraph() {
    setLoading(true);
    try {
      const params: any = {};
      if (entityFilter) params.entity = entityFilter;
      if (assetTypeFilter) params.asset_type = assetTypeFilter;
      const data = await assetGraphApi.cartography(params);
      setGraph(data);
    } catch {
      setGraph({ nodes: [], edges: [], stats: {} });
    } finally {
      setLoading(false);
    }
  }

  async function loadSidebars() {
    const [ents, procs] = await Promise.allSettled([assetGraphApi.listEntities(), assetGraphApi.listProcesses()]);
    setEntities(ents.status === "fulfilled" ? ents.value : []);
    setProcesses(procs.status === "fulfilled" ? procs.value : []);
  }

  useEffect(() => { loadGraph(); /* eslint-disable-next-line */ }, [entityFilter, assetTypeFilter]);
  useEffect(() => { loadSidebars(); }, []);
  useEffect(() => {
    assetsApi.options().then((d: any) => {
      const list = Array.isArray(d) ? d : d.items || [];
      setAssetOptions(list.map((a: any) => ({ id: a.id, label: a.name })));
      setAssetTypes(Array.from(new Set(list.map((a: any) => a.asset_type).filter(Boolean))) as string[]);
    }).catch(() => {});
    usersApi.list?.().then((d: any) => {
      const list = Array.isArray(d) ? d : d.items || [];
      setUserOptions(list.map((u: any) => ({ id: u.id, label: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email })));
    }).catch(() => {});
  }, []);

  async function createEntity(e: React.FormEvent) {
    e.preventDefault();
    if (!entityForm.name.trim()) return;
    setEntitySubmitting(true);
    try {
      await assetGraphApi.createEntity({
        name: entityForm.name,
        parent_id: entityForm.parent_id || null,
        entity_type: entityForm.entity_type || null,
      });
      setEntityForm({ name: "", parent_id: "", entity_type: "" });
      setShowEntityForm(false);
      loadSidebars();
      loadGraph();
    } catch { /* keep form open on failure */ }
    finally { setEntitySubmitting(false); }
  }

  async function deleteEntity(id: string) {
    if (!confirm(t("asset_graph.confirm_delete_entity", "Delete this org entity? Child entities and processes will be detached, not deleted."))) return;
    await assetGraphApi.deleteEntity(id).catch(() => {});
    loadSidebars();
    loadGraph();
  }

  async function createProcess(e: React.FormEvent) {
    e.preventDefault();
    if (!processForm.name.trim()) return;
    setProcessSubmitting(true);
    try {
      await assetGraphApi.createProcess({
        name: processForm.name,
        entity_id: processForm.entity_id || null,
        criticality: processForm.criticality,
        owner_id: processForm.owner_id || null,
        asset_ids: processForm.asset_ids,
      });
      setProcessForm({ name: "", entity_id: "", criticality: "medium", owner_id: "", asset_ids: [] });
      setShowProcessForm(false);
      loadSidebars();
      loadGraph();
    } catch { /* keep form open on failure */ }
    finally { setProcessSubmitting(false); }
  }

  async function deleteProcess(id: string) {
    if (!confirm(t("asset_graph.confirm_delete_process", "Delete this business process?"))) return;
    await assetGraphApi.deleteProcess(id).catch(() => {});
    loadSidebars();
    loadGraph();
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Network className="w-6 h-6 text-blue-500" />
            {t("asset_graph.title", "Asset Cartography")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("asset_graph.subtitle", "Interactive map of org entities, business processes, and the assets that support them")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Left sidebar — org entities + business processes management */}
        <div className="lg:col-span-1 space-y-5">
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-indigo-500" /> {t("asset_graph.org_entities", "Org Entities")}
              </h3>
              <button onClick={() => setShowEntityForm((v) => !v)} className="text-gray-400 hover:text-gray-700">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {showEntityForm && (
              <form onSubmit={createEntity} className="space-y-2 mb-3 bg-gray-50 rounded-xl p-3">
                <input
                  value={entityForm.name}
                  onChange={(e) => setEntityForm({ ...entityForm, name: e.target.value })}
                  placeholder={t("asset_graph.entity_name_placeholder", "Entity name")}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={entityForm.parent_id}
                  onChange={(e) => setEntityForm({ ...entityForm, parent_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
                >
                  <option value="">{t("asset_graph.no_parent", "No parent (top-level)")}</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <input
                  value={entityForm.entity_type}
                  onChange={(e) => setEntityForm({ ...entityForm, entity_type: e.target.value })}
                  placeholder={t("asset_graph.entity_type_placeholder", "Type (e.g. department, branch)")}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="submit" disabled={entitySubmitting} className="w-full inline-flex items-center justify-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {entitySubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.save")}
                </button>
              </form>
            )}
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {entities.length === 0 && <p className="text-xs text-gray-400 py-2">{t("asset_graph.no_entities", "No entities yet.")}</p>}
              {entities.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
                  <button onClick={() => setEntityFilter(e.id === entityFilter ? "" : e.id)} className={`flex-1 min-w-0 text-left text-xs truncate ${entityFilter === e.id ? "font-semibold text-indigo-600" : "text-gray-700"}`}>
                    {e.name}
                  </button>
                  <button onClick={() => deleteEntity(e.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 flex-shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Workflow className="w-4 h-4 text-emerald-500" /> {t("asset_graph.business_processes", "Business Processes")}
              </h3>
              <button onClick={() => setShowProcessForm((v) => !v)} className="text-gray-400 hover:text-gray-700">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {showProcessForm && (
              <form onSubmit={createProcess} className="space-y-2 mb-3 bg-gray-50 rounded-xl p-3">
                <input
                  value={processForm.name}
                  onChange={(e) => setProcessForm({ ...processForm, name: e.target.value })}
                  placeholder={t("asset_graph.process_name_placeholder", "Process name")}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={processForm.entity_id}
                  onChange={(e) => setProcessForm({ ...processForm, entity_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
                >
                  <option value="">{t("asset_graph.no_entity", "No entity")}</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <select
                  value={processForm.criticality}
                  onChange={(e) => setProcessForm({ ...processForm, criticality: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
                >
                  {["critical", "high", "medium", "low"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={processForm.owner_id}
                  onChange={(e) => setProcessForm({ ...processForm, owner_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
                >
                  <option value="">{t("asset_graph.no_owner", "No owner")}</option>
                  {userOptions.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
                <MultiSelect
                  options={assetOptions}
                  selected={processForm.asset_ids}
                  onChange={(ids) => setProcessForm({ ...processForm, asset_ids: ids })}
                  placeholder={t("risk_scenarios.select_placeholder", "Select...")}
                  emptyLabel={t("risk_scenarios.no_options", "No matches")}
                />
                <button type="submit" disabled={processSubmitting} className="w-full inline-flex items-center justify-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {processSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.save")}
                </button>
              </form>
            )}
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {processes.length === 0 && <p className="text-xs text-gray-400 py-2">{t("asset_graph.no_processes", "No processes yet.")}</p>}
              {processes.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
                  <span className="flex-1 min-w-0 text-left text-xs truncate text-gray-700">{p.name}</span>
                  <button onClick={() => deleteProcess(p.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 flex-shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — filters + graph */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t("asset_graph.filter_all_entities", "All entities")}</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <select value={assetTypeFilter} onChange={(e) => setAssetTypeFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t("asset_graph.filter_all_asset_types", "All asset types")}</option>
              {assetTypes.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
            </select>
            {(entityFilter || assetTypeFilter) && (
              <button onClick={() => { setEntityFilter(""); setAssetTypeFilter(""); }} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                <X className="w-3.5 h-3.5" /> {t("asset_graph.clear_filters", "Clear filters")}
              </button>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            {loading ? (
              <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
            ) : (
              <GraphCanvas graph={graph} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
