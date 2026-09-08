import { useState, useEffect } from "react";
import {
  Plus, Search, X, Loader2, Filter, Boxes, ShieldCheck, Layers, Crown, AlertTriangle,
  BarChart3, ChevronDown, ChevronRight, RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { assetsApi, usersApi, authApi } from "@/api/endpoints";
import { useColumnVisibility, type ColumnDef } from "@/components/common/useColumnVisibility";
import ColumnsMenu from "@/components/common/ColumnsMenu";
import ModuleDashboard from "@/components/dashboards/ModuleDashboard";
import Breakdown, { useBucketLabel } from "@/components/common/Breakdown";

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

/**
 * Operating status — objectif 1 names « leur statut » AND « le cycle de vie »
 * as two SEPARATE indicators, and answering both with lifecycle_state was the
 * appearance-over-existence failure the tender forbids. Asset.status is now a
 * real column (app.models.asset.AssetStatus) distinct by construction from
 * lifecycle_state: the two share no value, so a filter on one can never
 * silently answer the other.
 */
const STATUS_BADGE: Record<string, string> = {
  operational: "bg-emerald-100 text-emerald-700 border-emerald-200",
  degraded: "bg-amber-100 text-amber-700 border-amber-200",
  out_of_service: "bg-gray-100 text-gray-600 border-gray-200",
  quarantined: "bg-orange-100 text-orange-700 border-orange-200",
  lost: "bg-red-100 text-red-700 border-red-200",
};

const ASSET_TYPES = ["server", "workstation", "cloud_service", "application", "database", "network_device", "mobile_device", "data", "process", "person"];
const CRITICALITIES = ["critical", "high", "medium", "low"];
const CLASSES = ["primary", "support"];
const LIFECYCLE_STATES = ["acquisition", "in_use", "maintenance", "retired"];
const ASSET_STATUSES = ["operational", "degraded", "out_of_service", "quarantined", "lost"];
/** The bucket /assets/stats reports for rows whose status is NULL (its
 *  UNSPECIFIED_STATUS constant, "unspecified"). Offered in the FILTER only —
 *  never in the create form, which must always state a real status. Without it
 *  the tile could name a population the register could not be filtered to: any
 *  row written before the status backfill, or by a writer that bypasses this
 *  module, is unreachable from the screen that reports it. */
const UNSPECIFIED_STATUS = "unspecified";

/** The list endpoint caps page_size at 200 (`le=200` in assets.py). Ask for the
 *  ceiling: every client-side filter and the "showing X of Y" line below are
 *  computed from what this call returns, so the smaller the page the more of
 *  the inventory they silently omit. Beyond 200 the banner says so rather than
 *  letting the screen imply it is describing the whole estate. */
const PAGE_SIZE = 200;

/** Remember whether the operator keeps the dashboard panel open, per module.
 *  localStorage THROWS outright in some privacy modes — a preference must never
 *  take the assets page down with it. */
const DASH_LS_KEY = "grceye.moduledash.assets.open";

function readDashOpen(): boolean {
  try {
    return window.localStorage.getItem(DASH_LS_KEY) !== "0";
  } catch {
    return true;
  }
}

type UserLite = { id: string; first_name: string; last_name: string; email: string };

interface AssetStats {
  total?: number;
  by_criticality?: Record<string, number>;
  by_status?: Record<string, number>;
}

/** Message an operator can act on, for a failed /assets call.
 *
 *  424 is the live case while the `assets.status` migration is pending: the
 *  module answers 424 with the exact command to run rather than a 5xx, because
 *  a 5xx HARD-REDIRECTS this SPA to /service-down — i.e. it would eject the
 *  user out of the application instead of showing them an error. Surfacing the
 *  server's own detail is the whole point of that choice. */
function errorDetail(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detail = res?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return "";
}

export default function AssetsPage() {
  const { t } = useTranslation();
  // Translates a raw backend enum value (`in_use`, `out_of_service`, `server`)
  // through the product vocabulary. Rendering `key.replace(/_/g," ")` showed a
  // French user "in use" and "out of service" — this page is read by a Tunisian
  // bank in French and Arabic.
  const label = useBucketLabel();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [me, setMe] = useState<UserLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [critFilter, setCritFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [eolAssets, setEolAssets] = useState<any[]>([]);
  const [eolDismissed, setEolDismissed] = useState(false);
  const [dashOpen, setDashOpen] = useState<boolean>(readDashOpen);

  const ASSET_COLUMNS: ColumnDef[] = [
    { key: "name", label: t("assets.col_name", "Name"), lockable: false },
    { key: "type", label: t("assets.col_type", "Type") },
    { key: "class", label: t("assets.col_class", "Class") },
    { key: "criticality", label: t("assets.col_criticality", "Criticality") },
    { key: "cia", label: t("assets.col_cia", "C·I·A") },
    { key: "owner", label: t("assets.col_owner", "Owner") },
    { key: "status", label: t("common.status") },
    { key: "lifecycle", label: t("assets.col_lifecycle", "Lifecycle") },
  ];
  const { isVisible, toggle, reset } = useColumnVisibility("assets", ASSET_COLUMNS);

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
    status: "operational",
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

  function toggleDash() {
    setDashOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(DASH_LS_KEY, next ? "1" : "0");
      } catch {
        // Private browsing — the panel simply reopens next visit.
      }
      return next;
    });
  }

  async function load() {
    setLoadError("");
    try {
      const data = await assetsApi.list({ page: 1, page_size: PAGE_SIZE });
      const list = Array.isArray(data) ? data : data.items || [];
      setItems(list);
      setTotal(typeof data?.total === "number" ? data.total : list.length);
    } catch (err) {
      // Never swallow this. Setting an empty list on a failed call made the
      // screen say « aucun actif » — telling a bank its inventory is empty when
      // the server refused to answer is the same class of lie as inventing rows.
      setItems([]);
      setTotal(null);
      setLoadError(errorDetail(err) || t("errors.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      setStats(await assetsApi.stats());
    } catch {
      // The KPI strip degrades to « non disponible » rather than to zeros.
      setStats(null);
    }
  }

  // Mount only. `t` is deliberately NOT a dependency: react-i18next hands back a
  // new `t` identity on every language change, and depending on it would refire
  // the whole inventory + users + profile fetch each time the user switches
  // between FR, EN and AR.
  useEffect(() => {
    load();
    loadStats();
    usersApi.list().then((u) => setUsers(u as UserLite[])).catch(() => setUsers([]));
    authApi.getProfile()
      .then((p: any) => setMe({ id: p.id, first_name: p.first_name, last_name: p.last_name, email: p.email }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Always a valid AssetStatus value — POST answers 422 for anything else
        // and must never receive an explicit null.
        status: form.status,
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
      loadStats();
    } catch (err: any) {
      setError(errorDetail(err) || t("assets.error_create_failed", "Could not create asset"));
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = items.filter((i) => {
    if (critFilter && i.criticality !== critFilter) return false;
    if (classFilter && i.asset_class !== classFilter) return false;
    if (statusFilter === UNSPECIFIED_STATUS) {
      if (i.status) return false;
    } else if (statusFilter && i.status !== statusFilter) return false;
    return i.name?.toLowerCase().includes(search.toLowerCase());
  });

  // ── KPI strip ───────────────────────────────────────────────────────────────
  // Every one of these used to be counted over `items`, which is ONE PAGE of the
  // register. A tenant with 400 assets read "Critical: 12" while holding 40.
  // `total` and `by_criticality` are computed server-side over the whole tenant;
  // `primary` has no such aggregate yet (AssetStats carries no by_class), so it
  // is shown only when the loaded page demonstrably IS the whole inventory and
  // reads « non disponible » otherwise rather than quoting a partial count.
  const complete = total != null && items.length >= total;
  const totalAssets: number | null = stats?.total ?? total;
  const criticalCount: number | null = stats ? (stats.by_criticality?.critical ?? 0) : null;
  const primaryCount: number | null = complete ? items.filter((i) => i.asset_class === "primary").length : null;
  const truncated = total != null && total > items.length;
  const na = t("moduledash.not_available");

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

      {/*
        Objectif 1 — « Accessible depuis la page dédiée aux actifs ».
        The asset dashboard existed behind GET /dashboards/assets, but the only
        screen that ever called it was AnalyticsPage: a card in another
        navigation group does not make a dashboard accessible from the asset
        page. The LOCATION is the requirement, so it is mounted here, above the
        register, and the panel remembers whether the operator keeps it open.
      */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={toggleDash}
          aria-expanded={dashOpen}
          aria-controls="module-dashboard-assets"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {dashOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
            : <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />}
          <BarChart3 className="w-4 h-4 text-blue-600" aria-hidden="true" />
          {t("moduledash.dashboard")}
          <span className="text-xs font-normal text-gray-400">
            {dashOpen ? t("moduledash.hide") : t("moduledash.show")}
          </span>
        </button>
        {dashOpen && (
          <ModuleDashboard module="assets">
            {/*
              Objectif 1 names « leur statut » AND « le cycle de vie » as two
              SEPARATE indicators of the asset dashboard. GET /dashboards/assets
              groups by type, criticality, class and lifecycle — it has no
              by_status, so the dashboard answered the status clause with the
              lifecycle one, which is the appearance-over-existence failure this
              tender forbids. GET /assets/stats DOES compute it, server-side over
              the whole tenant (never over the loaded page), with `unspecified`
              for rows the migration has not backfilled, so the indicator is
              rendered here from that aggregate.

              Rendered as a CHILD so it only ever appears inside the loaded
              dashboard — never beside the Elite upsell, the « vue restreinte »
              panel or an error — and only when the server actually returned the
              grouping: an empty or absent by_status (column not migrated yet)
              renders nothing rather than an empty caption implying the
              indicator exists.
            */}
            {stats?.by_status && Object.keys(stats.by_status).length > 0 && (
              <Breakdown
                title={t("moduledash.by_status")}
                dataKey="by_status"
                data={stats.by_status}
                emptyLabel={t("moduledash.no_data")}
              />
            )}
          </ModuleDashboard>
        )}
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

      {/* The register could not be read. Say what the server said — the detail
          carries the operator's next action (e.g. the migration to run). */}
      {loadError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3" role="status">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-amber-900 flex-1 min-w-0">{loadError}</p>
          <button
            onClick={() => { setLoading(true); load(); loadStats(); }}
            className="inline-flex items-center gap-1.5 shrink-0 rounded-xl border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {t("common.retry")}
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("assets.stat_total", "Total assets"), value: totalAssets, icon: Boxes, color: "text-blue-600 bg-blue-50", hint: "" },
          {
            label: t("assets.stat_primary", "Primary assets"),
            value: primaryCount,
            icon: Layers,
            color: "text-indigo-600 bg-indigo-50",
            hint: primaryCount == null ? t("assets.stat_partial_hint", "Cannot be counted over a partial page — refine the filters or export the inventory.") : "",
          },
          { label: t("assets.stat_critical", "Critical"), value: criticalCount, icon: ShieldCheck, color: "text-red-600 bg-red-50", hint: "" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900 tabular-nums" title={s.hint || undefined}>
                  {s.value == null ? na : s.value}
                </p>
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
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={critFilter} onChange={(e) => setCritFilter(e.target.value)} aria-label={t("assets.col_criticality", "Criticality")} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("assets.all_criticalities", "All criticalities")}</option>
            {CRITICALITIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label={t("assets.col_class", "Class")} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("assets.all_classes", "Primary & support")}</option>
            {CLASSES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
          {/* « leur statut » — the operating status, not the lifecycle stage. */}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t("common.status")} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("common.all")}</option>
            {ASSET_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            <option value={UNSPECIFIED_STATUS}>{label(UNSPECIFIED_STATUS)}</option>
          </select>
          <ColumnsMenu columns={ASSET_COLUMNS} isVisible={isVisible} toggle={toggle} reset={reset} />
        </div>
      </div>

      {/* What the table and the filters above actually cover. The register can
          hold more than one page, and every filter here runs client-side over
          the loaded page — saying so beats implying this is the whole estate. */}
      {!loading && !loadError && (
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-gray-800">{filtered.length}</span>{" "}
          {t("common.of")}{" "}
          <span className="font-semibold text-gray-800">{total ?? items.length}</span>
          {truncated && (
            <span className="ms-1 text-amber-700">
              {t("assets.page_scope_hint", "— filters and the count above apply to the {{n}} most recent assets loaded on this page.", { n: items.length })}
            </span>
          )}
        </p>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : loadError ? (
          // Distinct from "no assets": the inventory is unknown, not empty.
          <div className="text-center py-16 text-gray-400">{t("common.no_data")}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("assets.no_assets", "No assets yet. Add your first asset to build the inventory.")}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("common.no_data")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_name", "Name")}</th>
                  {isVisible("type") && <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_type", "Type")}</th>}
                  {isVisible("class") && <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_class", "Class")}</th>}
                  {isVisible("criticality") && <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_criticality", "Criticality")}</th>}
                  {isVisible("cia") && <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_cia", "C·I·A")}</th>}
                  {isVisible("owner") && <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_owner", "Owner")}</th>}
                  {isVisible("status") && <th className="text-left px-6 py-3 font-medium text-gray-500">{t("common.status")}</th>}
                  {isVisible("lifecycle") && <th className="text-left px-6 py-3 font-medium text-gray-500">{t("assets.col_lifecycle", "Lifecycle")}</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item: any) => {
                  const so = item.security_objectives || {};
                  return (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                      {isVisible("type") && <td className="px-6 py-4 text-gray-600">{item.asset_type ? label(item.asset_type) : "—"}</td>}
                      {isVisible("class") && (
                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CLASS_BADGE[item.asset_class] || "bg-gray-100 text-gray-600"}`}>
                            {item.asset_class ? label(item.asset_class) : "—"}
                          </span>
                        </td>
                      )}
                      {isVisible("criticality") && (
                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CRIT_BADGE[item.criticality] || "bg-gray-100 text-gray-600"}`}>
                            {item.criticality ? label(item.criticality) : "—"}
                          </span>
                        </td>
                      )}
                      {isVisible("cia") && (
                        <td className="px-6 py-4 font-mono text-xs text-gray-600">
                          {so.confidentiality ?? "-"}·{so.integrity ?? "-"}·{so.availability ?? "-"}
                        </td>
                      )}
                      {isVisible("owner") && <td className="px-6 py-4 text-gray-700">{ownerName(item.owner_id)}</td>}
                      {isVisible("status") && (
                        <td className="px-6 py-4">
                          {/* Absent until the `assets.status` migration has run —
                              « non renseigné », never a fabricated "operational". */}
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[item.status] || "bg-gray-100 text-gray-500"}`}>
                            {item.status ? label(item.status) : label(UNSPECIFIED_STATUS)}
                          </span>
                        </td>
                      )}
                      {isVisible("lifecycle") && (
                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${LIFECYCLE_BADGE[item.lifecycle_state] || "bg-gray-100 text-gray-500"}`}>
                            {item.lifecycle_state ? label(item.lifecycle_state) : "—"}
                          </span>
                        </td>
                      )}
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
                    {ASSET_TYPES.map((a) => <option key={a} value={a}>{label(a)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_class", "Class")}</label>
                  <select value={form.asset_class} onChange={(e) => setForm({ ...form, asset_class: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CLASSES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_criticality", "Criticality")}</label>
                  <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CRITICALITIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Operating status and lifecycle stage are two separate answers. */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.status")}</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {ASSET_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("assets.col_lifecycle", "Lifecycle")}</label>
                  <select value={form.lifecycle_state} onChange={(e) => setForm({ ...form, lifecycle_state: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {LIFECYCLE_STATES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
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
                  ] as const).map(([key, lbl]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{lbl}</label>
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
                    {CRITICALITIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
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
