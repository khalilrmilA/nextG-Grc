import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, Filter, History, GitCommitHorizontal, AlertTriangle, ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { riskScenariosApi, scenarioVersionsApi, assetsApi, vulnerabilitiesApi, threatsApi, appliedControlsApi } from "@/api/endpoints";
import { MultiSelect, type MultiSelectOption as Option } from "@/components/common/MultiSelect";

// ─── Version timeline modal (RFP mod 5.2) ──────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: "Name", description: "Description", justification: "Justification",
  current_probability: "Current Probability", current_impact: "Current Impact", current_risk_level: "Current Risk Level",
  target_probability: "Target Probability", target_impact: "Target Impact", target_risk_level: "Target Risk Level",
  treatment: "Treatment", threat_ids: "Threats", vulnerability_ids: "Vulnerabilities",
  asset_ids: "Assets", applied_control_ids: "Applied Controls",
};

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? `${v.length} linked` : "none";
  return String(v);
}

function VersionTimelineModal({ scenarioId, scenarioName, onClose }: { scenarioId: string; scenarioName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapReason, setSnapReason] = useState("");
  const [snapping, setSnapping] = useState(false);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const [diff, setDiff] = useState<any[] | null>(null);
  const [diffing, setDiffing] = useState(false);

  function load() {
    setLoading(true);
    scenarioVersionsApi.list(scenarioId)
      .then((data) => setVersions(Array.isArray(data) ? data : []))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, [scenarioId]);

  async function snapshot() {
    setSnapping(true);
    try {
      await scenarioVersionsApi.snapshot(scenarioId, snapReason || undefined);
      setSnapReason("");
      load();
    } catch { /* keep modal open, list refresh will show nothing new */ }
    finally { setSnapping(false); }
  }

  async function runDiff() {
    if (diffFrom == null || diffTo == null) return;
    setDiffing(true);
    setDiff(null);
    try {
      const d = await scenarioVersionsApi.diff(scenarioId, diffFrom, diffTo);
      setDiff(Array.isArray(d) ? d : []);
    } catch { setDiff([]); }
    finally { setDiffing(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <History className="w-5 h-5 text-gray-400" /> {t("risk_scenarios.version_history", "Version History")}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{scenarioName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Manual snapshot */}
          <div className="flex items-center gap-2">
            <input
              value={snapReason}
              onChange={(e) => setSnapReason(e.target.value)}
              placeholder={t("risk_scenarios.snapshot_reason_placeholder", "Reason for this snapshot (optional)")}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={snapshot}
              disabled={snapping}
              className="inline-flex items-center gap-1.5 bg-gray-800 text-white px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-gray-900 disabled:opacity-50 whitespace-nowrap"
            >
              {snapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCommitHorizontal className="w-4 h-4" />}
              {t("risk_scenarios.take_snapshot", "Snapshot now")}
            </button>
          </div>

          {/* Diff selector */}
          {versions.length >= 2 && (
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <select value={diffFrom ?? ""} onChange={(e) => setDiffFrom(e.target.value ? parseInt(e.target.value) : null)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <option value="">{t("risk_scenarios.diff_from", "From version…")}</option>
                  {versions.map((v) => <option key={v.id} value={v.version_number}>v{v.version_number}</option>)}
                </select>
                <span className="text-xs text-gray-400">→</span>
                <select value={diffTo ?? ""} onChange={(e) => setDiffTo(e.target.value ? parseInt(e.target.value) : null)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <option value="">{t("risk_scenarios.diff_to", "To version…")}</option>
                  {versions.map((v) => <option key={v.id} value={v.version_number}>v{v.version_number}</option>)}
                </select>
                <button
                  onClick={runDiff}
                  disabled={diffFrom == null || diffTo == null || diffing}
                  className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-100 disabled:opacity-50"
                >
                  {diffing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t("risk_scenarios.compare", "Compare")}
                </button>
              </div>
              {diff && (
                diff.length === 0 ? (
                  <p className="text-xs text-gray-400 mt-2.5">{t("risk_scenarios.no_diff", "No differences between these versions.")}</p>
                ) : (
                  <div className="mt-2.5 space-y-1.5">
                    {diff.map((d: any) => (
                      <div key={d.field} className="text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                        <span className="font-medium text-gray-700">{FIELD_LABELS[d.field] || d.field}</span>{": "}
                        <span className="text-red-500 line-through">{fmtVal(d.from_value)}</span>
                        {" → "}
                        <span className="text-green-600 font-medium">{fmtVal(d.to_value)}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {/* Timeline */}
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t("risk_scenarios.no_versions", "No snapshots yet.")}</p>
          ) : (
            <div className="space-y-0">
              {versions.map((v, i) => (
                <div key={v.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                    {i < versions.length - 1 && <div className="w-px flex-1 bg-gray-200 my-1" />}
                  </div>
                  <div className="pb-4 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">v{v.version_number}</span>
                      <span className="text-xs text-gray-400">{v.created_at ? new Date(v.created_at).toLocaleString() : ""}</span>
                    </div>
                    {v.change_reason && <p className="text-xs text-gray-600 mt-0.5">{v.change_reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TREATMENT_BADGE: Record<string, string> = {
  mitigate: "bg-blue-100 text-blue-700 border-blue-200",
  accept: "bg-green-100 text-green-700 border-green-200",
  transfer: "bg-purple-100 text-purple-700 border-purple-200",
  avoid: "bg-orange-100 text-orange-700 border-orange-200",
  untreated: "bg-gray-100 text-gray-600 border-gray-200",
};

const RISK_LEVEL_BG: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-green-100 text-green-700",
};

const TREATMENT_OPTIONS = ["mitigate", "accept", "transfer", "avoid", "untreated"];
const SOK_OPTIONS = ["high", "medium", "low", "very_low"];

function riskLevel(prob: number, impact: number): string {
  const score = prob * impact;
  if (score >= 20) return "critical";
  if (score >= 12) return "high";
  if (score >= 6) return "medium";
  return "low";
}

function isOverdue(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}


const EMPTY_FORM = {
  name: "",
  description: "",
  treatment: "untreated",
  current_probability: 3,
  current_impact: 3,
  target_probability: 1,
  target_impact: 1,
  threat_actor: "",
  strength_of_knowledge: "medium",
  justification: "",
  next_review_date: "",
  regulatory_exposure_weight: 0,
  asset_ids: [] as string[],
  vulnerability_ids: [] as string[],
  threat_ids: [] as string[],
  applied_control_ids: [] as string[],
};

export default function RiskScenariosPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [treatmentFilter, setTreatmentFilter] = useState("");
  const [sortBy, setSortBy] = useState<"" | "priority">("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [assetOptions, setAssetOptions] = useState<Option[]>([]);
  const [vulnOptions, setVulnOptions] = useState<Option[]>([]);
  const [threatOptions, setThreatOptions] = useState<Option[]>([]);
  const [controlOptions, setControlOptions] = useState<Option[]>([]);
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);

  async function load() {
    try {
      const params: any = {};
      if (treatmentFilter) params.treatment = treatmentFilter;
      if (sortBy) params.sort = sortBy;
      const data = await riskScenariosApi.list(params);
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadOptions() {
    const results = await Promise.allSettled([
      assetsApi.list({ page_size: 500 }),
      vulnerabilitiesApi.list(),
      threatsApi.list(),
      appliedControlsApi.list(),
    ]);
    const [assetsRes, vulnsRes, threatsRes, controlsRes] = results;

    const unwrap = (r: PromiseSettledResult<any>): any[] => {
      if (r.status !== "fulfilled") return [];
      const d = r.value;
      return Array.isArray(d) ? d : d.items || [];
    };

    setAssetOptions(unwrap(assetsRes).map((a: any) => ({ id: a.id, label: a.name })));
    setVulnOptions(unwrap(vulnsRes).map((v: any) => ({ id: v.id, label: v.title })));
    setThreatOptions(unwrap(threatsRes).map((th: any) => ({ id: th.id, label: th.name })));
    setControlOptions(unwrap(controlsRes).map((c: any) => ({ id: c.id, label: c.name })));
  }

  useEffect(() => {
    load();
  }, [treatmentFilter, sortBy]);

  useEffect(() => {
    loadOptions();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("risk_scenarios.error_name_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      const payload = { ...form, next_review_date: form.next_review_date || null };
      await riskScenariosApi.create(payload);
      setShowModal(false);
      setForm(EMPTY_FORM);
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("risk_scenarios.error_create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = items.filter((i) =>
    i.name?.toLowerCase().includes(search.toLowerCase())
  );

  function linkedCount(item: any): number {
    return (
      (item.asset_ids?.length || 0) +
      (item.vulnerability_ids?.length || 0) +
      (item.threat_ids?.length || 0) +
      (item.applied_control_ids?.length || 0)
    );
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("risk_scenarios.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("risk_scenarios.subtitle")}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t("risk_scenarios.add_scenario")}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("risk_scenarios.search_placeholder")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={treatmentFilter} onChange={(e) => setTreatmentFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("risk_scenarios.all_treatments")}</option>
            {TREATMENT_OPTIONS.map((tr) => <option key={tr} value={tr}>{tr.charAt(0).toUpperCase() + tr.slice(1)}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "" | "priority")}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("risk_scenarios.sort_default", "Sort: Newest")}</option>
            <option value="priority">{t("risk_scenarios.sort_priority", "Sort: Priority")}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("risk_scenarios.no_scenarios")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_name")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_treatment")}</th>
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_probability")}</th>
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_impact")}</th>
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_current_risk")}</th>
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_target_risk")}</th>
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_priority", "Priority")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.table_threat_actor")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.col_knowledge")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.col_linked")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.next_review_date_label", "Next review")}</th>
                <th className="text-center px-6 py-3 font-medium text-gray-500">{t("risk_scenarios.version_history", "History")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => {
                const curLevel = item.current_risk_level || riskLevel(item.current_probability || 1, item.current_impact || 1);
                const tgtLevel = item.target_risk_level || riskLevel(item.target_probability || 1, item.target_impact || 1);
                const linked = linkedCount(item);
                return (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${TREATMENT_BADGE[item.treatment] || "bg-gray-100 text-gray-600"}`}>
                        {item.treatment}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">{item.current_probability}</td>
                    <td className="px-6 py-4 text-center text-gray-700">{item.current_impact}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${RISK_LEVEL_BG[curLevel] || "bg-gray-100 text-gray-600"}`}>
                        {curLevel}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${RISK_LEVEL_BG[tgtLevel] || "bg-gray-100 text-gray-600"}`}>
                        {tgtLevel}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {item.priority_score != null ? (
                        <span
                          title={t("risk_scenarios.priority_hint", "probability x impact, weighted by regulatory exposure")}
                          className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700"
                        >
                          {item.priority_score}
                        </span>
                      ) : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{item.threat_actor || "-"}</td>
                    <td className="px-6 py-4 text-gray-600">{item.strength_of_knowledge?.replace(/_/g, " ") || "-"}</td>
                    <td className="px-6 py-4 text-gray-500">
                      {linked > 0 ? t("risk_scenarios.linked_count", { count: linked }) : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {item.next_review_date ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          {new Date(item.next_review_date).toLocaleDateString()}
                          {isOverdue(item.next_review_date) && (
                            <span
                              title={t("risk_scenarios.overdue", "Overdue")}
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold"
                            >
                              <AlertTriangle className="w-3 h-3" /> {t("risk_scenarios.overdue", "Overdue")}
                            </span>
                          )}
                        </span>
                      ) : "-"}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => setHistoryFor({ id: item.id, name: item.name })}
                        title={t("risk_scenarios.version_history", "History")}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <History className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("risk_scenarios.new_scenario")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_name_label")} *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Threat → Vulnerability → Asset → Control chain selectors */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_threats_label")}</label>
                  <MultiSelect
                    options={threatOptions}
                    selected={form.threat_ids}
                    onChange={(ids) => setForm({ ...form, threat_ids: ids })}
                    placeholder={t("risk_scenarios.select_placeholder")}
                    emptyLabel={t("risk_scenarios.no_options")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_vulnerabilities_label")}</label>
                  <MultiSelect
                    options={vulnOptions}
                    selected={form.vulnerability_ids}
                    onChange={(ids) => setForm({ ...form, vulnerability_ids: ids })}
                    placeholder={t("risk_scenarios.select_placeholder")}
                    emptyLabel={t("risk_scenarios.no_options")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_assets_label")}</label>
                  <MultiSelect
                    options={assetOptions}
                    selected={form.asset_ids}
                    onChange={(ids) => setForm({ ...form, asset_ids: ids })}
                    placeholder={t("risk_scenarios.select_placeholder")}
                    emptyLabel={t("risk_scenarios.no_options")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_controls_label")}</label>
                  <MultiSelect
                    options={controlOptions}
                    selected={form.applied_control_ids}
                    onChange={(ids) => setForm({ ...form, applied_control_ids: ids })}
                    placeholder={t("risk_scenarios.select_placeholder")}
                    emptyLabel={t("risk_scenarios.no_options")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_treatment_label")}</label>
                  <select value={form.treatment} onChange={(e) => setForm({ ...form, treatment: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {TREATMENT_OPTIONS.map((tr) => <option key={tr} value={tr}>{tr.charAt(0).toUpperCase() + tr.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_knowledge_label")}</label>
                  <select value={form.strength_of_knowledge} onChange={(e) => setForm({ ...form, strength_of_knowledge: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SOK_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_current_probability")}</label>
                  <input type="number" min={1} max={5} value={form.current_probability} onChange={(e) => setForm({ ...form, current_probability: parseInt(e.target.value) || 1 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_current_impact")}</label>
                  <input type="number" min={1} max={5} value={form.current_impact} onChange={(e) => setForm({ ...form, current_impact: parseInt(e.target.value) || 1 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_target_probability")}</label>
                  <input type="number" min={1} max={5} value={form.target_probability} onChange={(e) => setForm({ ...form, target_probability: parseInt(e.target.value) || 1 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_target_impact")}</label>
                  <input type="number" min={1} max={5} value={form.target_impact} onChange={(e) => setForm({ ...form, target_impact: parseInt(e.target.value) || 1 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_threat_actor_label")}</label>
                  <input value={form.threat_actor} onChange={(e) => setForm({ ...form, threat_actor: e.target.value })} placeholder={t("risk_scenarios.form_threat_actor_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.next_review_date_label", "Next review date")}</label>
                  <input type="date" value={form.next_review_date} onChange={(e) => setForm({ ...form, next_review_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                  <span>{t("risk_scenarios.form_regulatory_exposure_label", "Regulatory exposure weight")}</span>
                  <span className="text-xs font-normal text-gray-400">{form.regulatory_exposure_weight.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={form.regulatory_exposure_weight}
                  onChange={(e) => setForm({ ...form, regulatory_exposure_weight: parseFloat(e.target.value) })}
                  className="w-full accent-blue-600"
                />
                <p className="text-xs text-gray-400 mt-1">{t("risk_scenarios.form_regulatory_exposure_hint", "How much regulatory exposure (e.g. PCI-DSS, GDPR, central-bank reporting) should boost this scenario's priority ranking beyond raw probability x impact. 0 = none, 1 = maximum.")}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("risk_scenarios.form_justification_label")}</label>
                <textarea
                  value={form.justification}
                  onChange={(e) => setForm({ ...form, justification: e.target.value })}
                  rows={2}
                  placeholder={t("risk_scenarios.form_justification_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("risk_scenarios.btn_cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("risk_scenarios.btn_add_scenario")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyFor && (
        <VersionTimelineModal
          scenarioId={historyFor.id}
          scenarioName={historyFor.name}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}
