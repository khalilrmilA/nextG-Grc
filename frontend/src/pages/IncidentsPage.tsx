import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, X, Loader2, Filter, AlertTriangle, ShieldAlert, Clock, Flame, GitCommitHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { incidentsApi, vulnerabilitiesApi, assetsApi, usersApi } from "@/api/endpoints";
import { MultiSelect } from "@/components/common/MultiSelect";
import IncidentDetailModal from "@/components/incidents/IncidentDetailModal";
import { useAuthStore, hasAnyRole } from "@/store/auth";
import i18n from "@/i18n";

// Dates follow the UI language (Arabic keeps Latin digits).
const uiLocale = () => { const l = i18n.language || "en"; return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US"; };

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  investigating: "bg-yellow-100 text-yellow-700 border-yellow-200",
  contained: "bg-orange-100 text-orange-700 border-orange-200",
  resolved: "bg-green-100 text-green-700 border-green-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  post_mortem: "bg-purple-100 text-purple-700 border-purple-200",
};

const CATEGORY_OPTIONS = [
  "data_breach", "unauthorized_access", "malware", "phishing",
  "dos_attack", "insider_threat", "physical_security", "system_outage",
  "policy_violation", "other",
];

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
// post_mortem is a real Incident status — the backend's /incidents/stats counts
// it and /incidents?status_filter=post_mortem filters on it — but it was absent
// here, so those incidents were unreachable from the status filter.
const STATUS_OPTIONS = ["open", "investigating", "contained", "resolved", "closed", "post_mortem"];

/** Raw backend enum -> the SPA's language, falling back to a humanised form of
 *  the value itself so an enum with no key yet still reads as a label. */
function humanise(v: string): string {
  return v ? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "";
}

export default function IncidentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ total: 0, open: 0, investigating: 0, critical: 0 });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  // PATCH and DELETE /incidents/{id} are require_roles(SECURITY_ANALYST, CISO);
  // require_roles auto-passes the scalar tenant_admin / super_admin role. Viewer
  // (and every other role) gets 403, so the panel opens read-only for them.
  // (Group-granted roles / delegations are resolved server-side only; the
  // backend stays the authority and its 403 detail is shown if we guess wrong.)
  const user = useAuthStore((u) => u);
  const isAdmin = user?.role === "tenant_admin" || user?.role === "super_admin";
  const canManage = isAdmin || hasAnyRole(user, ["security_analyst", "ciso"]);

  async function createScenarioFromIncident(incidentId: string) {
    setDraftingId(incidentId);
    setDraftError("");
    try {
      const draft = await incidentsApi.scenarioDraft(incidentId);
      navigate("/risk-scenarios", { state: { draft } });
    } catch {
      setDraftError(t("incidents.scenario_draft_failed", "Could not draft a risk scenario from this incident"));
    } finally {
      setDraftingId(null);
    }
  }

  const emptyForm = {
    title: "",
    description: "",
    category: "other",
    severity: "medium",
    breach_notification_required: false,
    linked_vulnerabilities: [] as string[],
    // M2.4 gap fix: real Asset FK links, alongside the free-text field below.
    affected_asset_ids: [] as string[],
    affected_systems_text: "",
  };
  const [form, setForm] = useState({ ...emptyForm });
  const [vulnOptions, setVulnOptions] = useState<any[]>([]);
  const [assetOptions, setAssetOptions] = useState<any[]>([]);
  // "Assigned To" printed the raw assigned_to_id UUID. GET /users is
  // tenant_admin-only, so the map stays empty for most roles — in that case the
  // cell keeps whatever it showed before rather than claiming "unassigned".
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  useEffect(() => {
    vulnerabilitiesApi.list().then((data: any) => setVulnOptions(Array.isArray(data) ? data : data.items || [])).catch(() => setVulnOptions([]));
    // GET /assets defaults to page_size=20, so this picker offered the FIRST
    // TWENTY assets and silently hid the rest of the inventory. /assets/options
    // exists for exactly this: {id, name, asset_type} for the whole register.
    usersApi.directory()
      .then((us: any) => setUserNames(Object.fromEntries(
        (Array.isArray(us) ? us : []).map((u: any) => [
          u.id, `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email,
        ]),
      )))
      .catch(() => setUserNames({}));
    assetsApi.options().then((data: any) => setAssetOptions(Array.isArray(data) ? data : data.items || [])).catch(() => setAssetOptions([]));
  }, []);

  async function load() {
    try {
      const params: any = {};
      if (sevFilter) params.severity = sevFilter;
      if (statusFilter) params.status_filter = statusFilter;
      const data = await incidentsApi.list(params);
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const s = await incidentsApi.stats();
      setStats(s);
    } catch {}
  }

  useEffect(() => {
    load();
    loadStats();
  }, [sevFilter, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("incidents.error_title_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      const { affected_systems_text, ...rest } = form;
      await incidentsApi.create({
        ...rest,
        // Free-text field stays a plain comma-separated list -> array, same
        // shape the backend already expects for affected_systems.
        affected_systems: affected_systems_text.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setShowModal(false);
      setForm({ ...emptyForm });
      setLoading(true);
      load();
      loadStats();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("incidents.error_create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = items.filter((i) =>
    i.title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {draftError && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{draftError}</div>}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("incidents.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("incidents.subtitle")}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t("incidents.new_incident")}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("incidents.stat_total"), value: stats.total, icon: AlertTriangle, color: "text-blue-600 bg-blue-50" },
          { label: t("incidents.stat_open"), value: stats.open, icon: ShieldAlert, color: "text-red-600 bg-red-50" },
          { label: t("incidents.stat_investigating"), value: stats.investigating, icon: Clock, color: "text-yellow-600 bg-yellow-50" },
          { label: t("incidents.stat_critical"), value: stats.critical, icon: Flame, color: "text-red-600 bg-red-50" },
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
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("incidents.search_placeholder")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("incidents.all_severities")}</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{t(`compliance.severities.${s}` as never)}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("incidents.all_statuses")}</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{String(t(`vocab.${s}` as never, humanise(s)))}</option>)}
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
          <div className="text-center py-16 text-gray-400">{t("incidents.no_incidents")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("incidents.col_title")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("incidents.col_category")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("incidents.col_severity")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("incidents.col_status")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("incidents.col_detected")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("incidents.col_assigned")}</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => (
                <tr key={item.id} onClick={() => setSelected(item)} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer">
                  <td className="px-6 py-4 font-medium text-gray-900">{item.title}</td>
                  <td className="px-6 py-4 text-gray-600">{item.category ? String(t(`vocab.${item.category}` as never, humanise(item.category))) : "-"}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEV_BADGE[item.severity] || "bg-gray-100 text-gray-600"}`}>
                      {String(t(`vocab.${item.severity}` as never, humanise(item.severity)))}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                      {String(t(`vocab.${item.status}` as never, humanise(item.status)))}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">{item.detected_at ? new Date(item.detected_at).toLocaleDateString(uiLocale()) : "-"}</td>
                  <td className="px-6 py-4 text-gray-500">{item.assigned_to_id ? (userNames[item.assigned_to_id] || item.assigned_to_id) : "-"}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); createScenarioFromIncident(item.id); }}
                      disabled={draftingId === item.id}
                      title={t("incidents.create_scenario", "Create risk scenario from this incident")}
                      className="inline-flex items-center justify-center p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-50"
                    >
                      {draftingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCommitHorizontal className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail / edit modal */}
      {selected && (
        <IncidentDetailModal
          key={selected.id}
          incident={selected}
          canEdit={canManage}
          canDelete={canManage}
          vulnOptions={vulnOptions}
          assetOptions={assetOptions}
          userNames={userNames}
          drafting={draftingId === selected.id}
          onCreateScenario={createScenarioFromIncident}
          onClose={() => setSelected(null)}
          onChanged={() => { load(); loadStats(); }}
        />
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("incidents.new_incident")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("incidents.form_title")} *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("incidents.form_description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("incidents.form_category")}</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{String(t(`vocab.${c}` as never, humanise(c)))}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("incidents.form_severity")}</label>
                  <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{t(`compliance.severities.${s}` as never)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("incidents.form_linked_vulnerabilities", "Linked vulnerabilities")}</label>
                <MultiSelect
                  options={vulnOptions.map((v) => ({ id: v.id, label: `${v.ref_id || v.id}${v.title ? " — " + v.title : ""}` }))}
                  selected={form.linked_vulnerabilities}
                  onChange={(ids) => setForm({ ...form, linked_vulnerabilities: ids })}
                  placeholder={t("incidents.select_vulnerabilities", "Select vulnerabilities…")}
                  emptyLabel={t("incidents.no_vulnerabilities", "No vulnerabilities found")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("incidents.form_linked_assets", "Linked assets")}</label>
                <MultiSelect
                  options={assetOptions.map((a) => ({ id: a.id, label: a.name || a.id }))}
                  selected={form.affected_asset_ids}
                  onChange={(ids) => setForm({ ...form, affected_asset_ids: ids })}
                  placeholder={t("incidents.select_assets", "Select affected asset(s)…")}
                  emptyLabel={t("incidents.no_assets_found", "No assets found")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("incidents.form_affected_systems", "Affected systems (free text)")}</label>
                <input
                  value={form.affected_systems_text}
                  onChange={(e) => setForm({ ...form, affected_systems_text: e.target.value })}
                  placeholder={t("incidents.affected_systems_placeholder", "e.g. web-server-01, payment-gateway")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">{t("incidents.affected_systems_hint", "Comma-separated. Use \"Linked assets\" above for systems already in the asset inventory.")}</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="breach" checked={form.breach_notification_required} onChange={(e) => setForm({ ...form, breach_notification_required: e.target.checked })} className="rounded border-gray-300" />
                <label htmlFor="breach" className="text-sm text-gray-700">{t("incidents.breach_notification")}</label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("incidents.new_incident")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
