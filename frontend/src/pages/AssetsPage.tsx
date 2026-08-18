import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, Filter, Boxes, ShieldCheck, Layers, Crown, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { assetsApi, usersApi, authApi } from "@/api/endpoints";

const CRIT_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const CLASS_BADGE: Record<string, string> = {
  primary: "bg-blue-100 text-blue-700 border-blue-200",
  support: "bg-gray-100 text-gray-600 border-gray-200",
};

const LIFECYCLE_BADGE: Record<string, string> = {
  acquisition: "bg-purple-100 text-purple-700 border-purple-200",
  in_use: "bg-green-100 text-green-700 border-green-200",
  maintenance: "bg-yellow-100 text-yellow-700 border-yellow-200",
  retired: "bg-gray-100 text-gray-500 border-gray-200",
};

const ASSET_TYPES = ["server", "workstation", "cloud_service", "application", "database", "network_device", "mobile_device", "data", "process", "person"];
const CRITICALITIES = ["critical", "high", "medium", "low"];
const CLASSES = ["primary", "support"];
const LIFECYCLE_STATES = ["acquisition", "in_use", "maintenance", "retired"];

type UserLite = { id: string; first_name: string; last_name: string; email: string };

export default function AssetsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [me, setMe] = useState<UserLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [critFilter, setCritFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [eolAssets, setEolAssets] = useState<any[]>([]);
  const [eolDismissed, setEolDismissed] = useState(false);

  useEffect(() => {
    assetsApi.eolSoon().then((d: any) => setEolAssets(Array.isArray(d) ? d : [])).catch(() => setEolAssets([]));
  }, []);

  const emptyForm = {
    name: "",
    asset_type: "server",
    asset_class: "primary",
    criticality: "medium",
    owner_id: "",
    data_classification: "internal",
    lifecycle_state: "in_use",
    business_value: "medium",
    confidentiality: 3,
    integrity: 3,
    availability: 3,
  };
  const [form, setForm] = useState({ ...emptyForm });

  // Owner options: /users is tenant_admin-only, so always offer the current user
  // as a fallback and merge in the tenant users when the admin listing succeeds.
  const ownerOptions: UserLite[] = me ? [me, ...users.filter((u) => u.id !== me.id)] : users;

  async function load() {
    try {
      const data = await assetsApi.list({ page_size: 100 });
      const list = Array.isArray(data) ? data : data.items || [];
      setItems(list);
      setTotal(typeof data?.total === "number" ? data.total : list.length);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    usersApi.list().then((u) => setUsers(u as UserLite[])).catch(() => setUsers([]));
    authApi.getProfile()
      .then((p: any) => setMe({ id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email }))
      .catch(() => {});
  }, []);

  function openModal() {
    setError("");
    setForm({ ...emptyForm, owner_id: me?.id || "" });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("assets.error_name_required", "Name is required")); return; }
    if (!form.owner_id) { setError(t("assets.error_owner_required", "A business owner is required")); return; }
    setSubmitting(true);
    setError("");
    try {
      await assetsApi.create({
        name: form.name,
        asset_type: form.asset_type,
        asset_class: form.asset_class,
        criticality: form.criticality,
        owner_id: form.owner_id,
        data_classification: form.data_classification,
        lifecycle_state: form.lifecycle_state,
        business_value: form.business_value,
        security_objectives: {
          confidentiality: form.confidentiality,
          integrity: form.integrity,
          availability: form.availability,
        },
      });
      setShowModal(false);
      setForm({ ...emptyForm });
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("assets.error_create_failed", "Could not create asset"));
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = items.filter((i) => {
    if (critFilter && i.criticality !== critFilter) return false;
    if (classFilter && i.asset_class !== classFilter) return false;
    return i.name?.toLowerCase().includes(search.toLowerCase());
  });

  const primaryCount = items.filter((i) => i.asset_class === "primary").length;
  const criticalCount = items.filter((i) => i.criticality === "critical").length;
  const ownerName = (id?: string) => {
    const u = ownerOptions.find((x) => x.id === id);
    return u ? `${u.first_name} ${u.last_name}`.trim() : "—";
  };

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("assets.title", "Asset Inventory")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("assets.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("assets.subtitle", "Primary & support assets with CIA valuation, ownership and lifecycle")}</p>
        </div>
        <button
          onClick={openModal}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t("assets.new_asset", "New Asset")}
        </button>
      </div>

      {/* End-of-life banner (RFP mod 2.4) */}
      {!eolDismissed && eolAssets.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {t("assets.eol_banner_title", "{{count}} asset(s) approaching or past end-of-life", { count: eolAssets.length })}
            </p>
            <p className="text-xs text-amber-700 mt-1 truncate">
              {eolAssets.slice(0, 5).map((a: any) => a.name).join(", ")}{eolAssets.length > 5 ? "…" : ""}
            </p>
          </div>
          <button onClick={() => setEolDismissed(true)} className="text-amber-500 hover:text-amber-700 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("assets.stat_total", "Total assets"), value: total, icon: Boxes, color: "text-blue-600 bg-blue-50" },
          { label: t("assets.stat_primary", "Primary assets"), value: primaryCount, icon: Layers, color: "text-indigo-600 bg-indigo-50" },
          { label: t("assets.stat_critical", "Critical"), value: criticalCount, icon: ShieldCheck, color: "text-red-600 bg-red-50" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("assets.search_placeholder", "Search assets…")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={critFilter} onChange={(e) => setCritFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("assets.all_criticalities", "All criticalities")}</option>
            {CRITICALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("assets.all_classes", "Primary & support")}</option>
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
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
          <div className="text-center py-16 text-gray-400">{t("assets.no_assets", "No assets yet. Add your first asset to build the inventory.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_name", "Name")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_type", "Type")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_class", "Class")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_criticality", "Criticality")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_cia", "C·I·A")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_owner", "Owner")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_lifecycle", "Lifecycle")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item: any) => {
                  const so = item.security_objectives || {};
                  return (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                      <td className="px-6 py-4 text-gray-600">{(item.asset_type || "").replace(/_/g, " ")}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CLASS_BADGE[item.asset_class] || "bg-gray-100 text-gray-600"}`}>
                          {item.asset_class || "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CRIT_BADGE[item.criticality] || "bg-gray-100 text-gray-600"}`}>
                          {item.criticality || "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-gray-600">
                        {so.confidentiality ?? "-"}·{so.integrity ?? "-"}·{so.availability ?? "-"}
                      </td>
                      <td className="px-6 py-4 text-gray-700">{ownerName(item.owner_id)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${LIFECYCLE_BADGE[item.lifecycle_state] || "bg-gray-100 text-gray-500"}`}>
                          {(item.lifecycle_state || "—").replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("assets.new_asset", "New Asset")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_name", "Name")} *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_type", "Type")}</label>
                  <select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {ASSET_TYPES.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_class", "Class")}</label>
                  <select value={form.asset_class} onChange={(e) => setForm({ ...form, asset_class: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_criticality", "Criticality")}</label>
                  <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CRITICALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_lifecycle", "Lifecycle")}</label>
                  <select value={form.lifecycle_state} onChange={(e) => setForm({ ...form, lifecycle_state: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {LIFECYCLE_STATES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.owner", "Business owner")} *</label>
                <select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">{t("assets.select_owner", "Select an owner…")}</option>
                  {ownerOptions.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.email}){me && u.id === me.id ? " — you" : ""}</option>)}
                </select>
              </div>

              {/* CIA valuation */}
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">{t("assets.cia_valuation", "CIA valuation (1–5)")}</p>
                <div className="grid grid-cols-3 gap-4">
                  {([
                    ["confidentiality", t("assets.confidentiality", "Confidentiality")],
                    ["integrity", t("assets.integrity", "Integrity")],
                    ["availability", t("assets.availability", "Availability")],
                  ] as const).map(([key, label]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                      <input
                        type="number" min={1} max={5}
                        value={(form as any)[key]}
                        onChange={(e) => setForm({ ...form, [key]: parseInt(e.target.value) || 1 })}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("assets.business_value", "Business value")}</label>
                  <select value={form.business_value} onChange={(e) => setForm({ ...form, business_value: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CRITICALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("assets.new_asset", "New Asset")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
