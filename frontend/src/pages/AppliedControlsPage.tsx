import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { appliedControlsApi, riskScenariosApi } from "@/api/endpoints";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";

const STATUS_BADGE: Record<string, string> = {
  planned: "bg-gray-100 text-gray-600 border-gray-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  implemented: "bg-green-100 text-green-700 border-green-200",
  not_applicable: "bg-gray-100 text-gray-500 border-gray-200",
  deprecated: "bg-red-100 text-red-700 border-red-200",
};

const EFFORT_BADGE: Record<string, string> = {
  very_low: "bg-green-50 text-green-600",
  low: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  very_high: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS = ["planned", "in_progress", "implemented", "not_applicable", "deprecated"];
const EFFORT_OPTIONS = ["very_low", "low", "medium", "high", "very_high"];
const CSF_FUNCTIONS = ["govern", "identify", "protect", "detect", "respond", "recover"];

export default function AppliedControlsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    ref_id: "",
    name: "",
    description: "",
    category: "",
    csf_function: "protect",
    status: "planned",
    effort: "medium",
    cost: 0,
    recurring_cost: 0,
    eta: "",
    risk_scenario_ids: [] as string[],
  });
  const [scenarioOptions, setScenarioOptions] = useState<MultiSelectOption[]>([]);

  useEffect(() => {
    riskScenariosApi.list().then((d: any) => {
      const list = Array.isArray(d) ? d : d.items || [];
      setScenarioOptions(list.map((s: any) => ({ id: s.id, label: s.name })));
    }).catch(() => setScenarioOptions([]));
  }, []);

  async function load() {
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const data = await appliedControlsApi.list(params);
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("applied_controls.error_name_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      const payload: any = { ...form };
      if (!payload.eta) delete payload.eta;
      await appliedControlsApi.create(payload);
      setShowModal(false);
      setForm({ ref_id: "", name: "", description: "", category: "", csf_function: "protect", status: "planned", effort: "medium", cost: 0, recurring_cost: 0, eta: "", risk_scenario_ids: [] });
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("applied_controls.error_create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = items.filter((i) =>
    i.name?.toLowerCase().includes(search.toLowerCase()) || i.ref_id?.toLowerCase().includes(search.toLowerCase())
  );

  const kpiTotal = items.length;
  const kpiImplemented = items.filter((i) => i.status === "implemented").length;
  const kpiInProgress = items.filter((i) => i.status === "in_progress").length;
  const kpiTotalCost = items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("applied_controls.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("applied_controls.subtitle")}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t("applied_controls.new_control")}
        </button>
      </div>

      {/* KPI tiles (RFP mod 14.5) */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{kpiTotal}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_total", "Total Controls")}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{kpiImplemented}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_implemented", "Implemented")}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{kpiInProgress}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_in_progress", "In Progress")}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">${kpiTotalCost.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("applied_controls.kpi_total_cost", "Total Cost")}</p>
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
            placeholder={t("applied_controls.search_placeholder")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("applied_controls.all_statuses")}</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
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
          <div className="text-center py-16 text-gray-400">{t("applied_controls.no_controls")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_ref")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_name")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_category")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_status")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_progress")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_effort")}</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_cost")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("applied_controls.col_eta")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => {
                const progress = item.progress ?? (item.status === "implemented" ? 100 : item.status === "in_progress" ? 50 : 0);
                return (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.ref_id || "-"}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-4 text-gray-600">{item.category || "-"}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                        {item.status?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${progress >= 100 ? "bg-green-500" : progress >= 50 ? "bg-blue-500" : "bg-gray-300"}`}
                            style={{ width: `${Math.min(progress, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{progress}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${EFFORT_BADGE[item.effort] || "bg-gray-100 text-gray-600"}`}>
                        {item.effort?.replace(/_/g, " ") || "-"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-700">
                      {item.cost != null ? `$${Number(item.cost).toLocaleString()}` : "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{item.eta ? new Date(item.eta).toLocaleDateString() : "-"}</td>
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
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("applied_controls.modal_title")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.ref_id")}</label>
                  <input value={form.ref_id} onChange={(e) => setForm({ ...form, ref_id: e.target.value })} placeholder={t("applied_controls.ref_id_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.name_label")} *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.col_category")}</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("applied_controls.category_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.col_csf")}</label>
                  <select value={form.csf_function} onChange={(e) => setForm({ ...form, csf_function: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CSF_FUNCTIONS.map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.col_status")}</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_effort")}</label>
                  <select value={form.effort} onChange={(e) => setForm({ ...form, effort: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {EFFORT_OPTIONS.map((ef) => <option key={ef} value={ef}>{ef.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_cost")}</label>
                  <input type="number" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_recurring_cost")}</label>
                  <input type="number" min={0} value={form.recurring_cost} onChange={(e) => setForm({ ...form, recurring_cost: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.form_eta")}</label>
                  <input type="date" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("applied_controls.linked_scenarios", "Linked Risk Scenarios")}</label>
                <MultiSelect
                  options={scenarioOptions}
                  selected={form.risk_scenario_ids}
                  onChange={(ids) => setForm({ ...form, risk_scenario_ids: ids })}
                  placeholder={t("risk_scenarios.select_placeholder", "Select...")}
                  emptyLabel={t("risk_scenarios.no_options", "No matches")}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("applied_controls.new_control")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
