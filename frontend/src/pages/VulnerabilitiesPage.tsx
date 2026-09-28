import { useState, useEffect, useMemo } from "react";
import { Plus, Search, X, Loader2, Filter, Bug, ShieldCheck, Wrench, BarChart3, Upload, Download, Plug, RefreshCw, Trash2, ChevronRight, ChevronDown, Check, Gauge, GitBranch, AlertTriangle, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { vulnerabilitiesApi, vulnImportApi, scannerConnectorsApi, riskScenariosApi } from "@/api/endpoints";
// Same axios instance as every `api` object (auth header, 401 refresh, outage
// guard) — used directly only because api/endpoints.ts is owned by another lane
// in this wave and cannot gain a `trend()` wrapper here. See needs_integration.
import { apiClient } from "@/api/client";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";
import ModuleDashboard from "@/components/dashboards/ModuleDashboard";
import { useBucketLabel } from "@/components/common/Breakdown";
import i18n from "@/i18n";

// Dates follow the UI language (Arabic keeps Latin digits).
const uiLocale = () => { const l = i18n.language || "en"; return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US"; };

// EASM connector settings as edited in the form (server shape: see
// backend app/services/easm_connector.py normalize_config).
type EasmForm = {
  auth_style: string;
  auth_header: string;
  auth_query_param: string;
  findings_path: string;
  assets_path: string;
  results_key: string;
  discover_assets: boolean;
  field_map: Record<string, string>;
  showAdvanced?: boolean;
};
const EMPTY_EASM: EasmForm = {
  auth_style: "bearer", auth_header: "X-API-Key", auth_query_param: "api_key",
  findings_path: "", assets_path: "", results_key: "", discover_assets: true, field_map: {},
};
function easmConfigPayload(f: EasmForm): Record<string, unknown> {
  const field_map: Record<string, string> = {};
  Object.entries(f.field_map).forEach(([k, v]) => { if (v && v.trim()) field_map[k] = v.trim(); });
  return {
    auth_style: f.auth_style,
    auth_header: f.auth_style === "header" ? (f.auth_header.trim() || "X-API-Key") : null,
    auth_query_param: f.auth_style === "query" ? (f.auth_query_param.trim() || "api_key") : null,
    findings_path: f.findings_path.trim(),
    assets_path: f.assets_path.trim() || null,
    results_key: f.results_key.trim() || null,
    discover_assets: f.discover_assets,
    field_map,
  };
}

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const STATUS_BADGE: Record<string, string> = {
  pending_validation: "bg-amber-100 text-amber-700 border-amber-200",
  validated: "bg-indigo-100 text-indigo-700 border-indigo-200",
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_remediation: "bg-yellow-100 text-yellow-700 border-yellow-200",
  mitigated: "bg-green-100 text-green-700 border-green-200",
  accepted: "bg-gray-100 text-gray-600 border-gray-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  false_positive: "bg-purple-100 text-purple-700 border-purple-200",
};

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS = ["pending_validation", "validated", "open", "in_remediation", "mitigated", "accepted", "closed", "false_positive"];
const SOURCE_OPTIONS = ["pen_test", "scan", "manual", "bug_bounty"];
const OPERATIONAL_CONTEXTS = ["internet_facing", "dmz", "production", "internal", "isolated", "test", "development"];

/** Remember whether the operator keeps the dashboard panel open. localStorage
 *  THROWS outright in some privacy modes — a preference must never take the
 *  vulnerability page down with it. */
const DASH_LS_KEY = "grceye.moduledash.vulnerabilities.open";

function readDashOpen(): boolean {
  try {
    return window.localStorage.getItem(DASH_LS_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The server's own message for a failed call — it is the one an operator can
 *  act on (a 424 names the migration to run). Never a redirect: a 5xx
 *  hard-redirects this SPA to /service-down, i.e. ejects the user out of the
 *  application rather than showing them the failure. */
function errorDetail(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : "";
}

/** Server-computed KPI strip. Every field is optional and `avg_cvss` is
 *  explicitly nullable: /vulnerabilities/stats returns `avg_cvss: null` when no
 *  finding carries a CVSS score, and the tile used to print that as "0.0" — a
 *  figure the backend never asserted, on a bank's screen. */
interface VulnStats {
  total?: number;
  open?: number;
  in_remediation?: number;
  avg_cvss?: number | null;
}

/* ── Historical trend (objectif 2 — « tendances historiques ») ────────────────
 *
 * The dashboard above is a point-in-time picture; the objective also asks for
 * the movement behind it. GET /vulnerabilities/trend returns one point per
 * calendar month, read from the daily `trend_snapshots` history and degrading
 * to an intake-volume proxy while that history is still thin — the same shape
 * RiskSnapshot has been proving in production.
 *
 * Four things this panel must never do:
 *   • Draw a missing month as a zero. `total: null` means "no snapshot existed
 *     for that month", not "nothing was held". A zero there is a fabricated
 *     figure on a bank's chart, so a null month is drawn as an explicit gap.
 *   • Pass an intake-volume series off as a balance. The two answer different
 *     questions (what was opened in the month vs. what was still carried at the
 *     end of it), so the source is named on screen, in the user's language.
 *   • Render the backend's `month` field. It is `strftime("%b")`, i.e. always
 *     English ("Sep"), which is exactly the class of bug this wave is closing —
 *     the axis is formatted from `period` ("2026-09") through Intl instead.
 *   • Take the page down when the route is not deployed. These endpoints ship
 *     in this wave but the running uvicorn workers predate them, so until the
 *     backend is restarted the call answers 404 (the `/{vid}` route swallows
 *     `/trend`). That is shown as a translated "not published yet" note, never
 *     as an error and never as a redirect.
 *
 * It goes through `apiClient` rather than a `vulnerabilitiesApi.trend()`
 * wrapper because api/endpoints.ts belongs to another lane in this wave — same
 * axios instance, same auth, same interceptors, so this is not a raw fetch. The
 * wrapper it should eventually live behind is reported for integration.
 */
const TREND_MONTHS = 6;

interface TrendPoint {
  month: string;
  period: string;
  as_of: string | null;
  /** null = no reading for that month. NEVER coerce to 0. */
  total: number | null;
  counts: Record<string, any>;
}

interface TrendEnvelope {
  metric: string;
  months: number;
  source: string;
  note?: string;
  series: TrendPoint[];
}

/** Operator-actionable message per HTTP status, reusing ModuleDashboard's
 *  vocabulary so the two panels never describe the same failure differently.
 *  405 is listed next to 404 because a router that has the module but not this
 *  path answers "Method Not Allowed" — same cause, same fix (restart). */
function trendErrorKey(status?: number): string {
  if (status === 404 || status === 405) return "moduledash.error_not_published";
  if (status === 424) return "moduledash.error_not_ready";
  if (status === undefined) return "moduledash.error_unreachable";
  return "moduledash.error_generic";
}

function TrendPanel({
  load,
  legendLabel,
  alertOf,
  footnote,
}: {
  load: () => Promise<TrendEnvelope>;
  /** What the tall bar counts, in the user's language. */
  legendLabel: string;
  /** Sub-bar highlighting the criticality signal, when the payload carries one. */
  alertOf?: (p: TrendPoint) => number;
  /** Extra reconciliation line the caller may need (built-in catalogue size…). */
  footnote?: (d: TrendEnvelope) => string;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<TrendEnvelope | null>(null);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // Month names in the UI language — see the note above about `%b`.
  const monthFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(i18n.language || "en", { month: "short" });
    } catch {
      return null;
    }
  }, [i18n.language]);

  function monthLabel(p: TrendPoint): string {
    const m = /^(\d{4})-(\d{2})$/.exec(p.period || "");
    if (!m || !monthFmt) return p.month || p.period || "";
    return monthFmt.format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
  }

  useEffect(() => {
    let alive = true;
    setState("loading");
    load()
      .then((d) => { if (alive) { setData(d); setState("ready"); } })
      .catch((err: any) => {
        if (!alive) return;
        setStatus(err?.response?.status);
        setState("error");
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const series = data?.series ?? [];
  const readings = series.filter((p) => typeof p.total === "number");
  const max = Math.max(1, ...readings.map((p) => p.total as number));
  const intake = data?.source === "intake_volume";
  // "unavailable" is the envelope the backend returns when even the fallback
  // could not be READ — every total null because the query failed, not because
  // nothing was measured. The two must not share a message: « historique encore
  // insuffisant » states a fact about the register, and stating it when the
  // truth is a fact about this request is the same fabrication as plotting a 0.
  // The backend distinguishes them with `source`, so the panel does too.
  const unavailable = data?.source === "unavailable";
  const noHistory = state === "ready" && readings.length === 0;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <TrendingUp className="w-4 h-4 text-gray-400 self-center" aria-hidden="true" />
        <p className="text-sm font-semibold text-gray-900">{t("moduledash.trend_title")}</p>
        <span className="text-xs text-gray-400">{t("moduledash.trend_months", { n: TREND_MONTHS })}</span>
        <span className="ms-auto text-xs text-gray-400">{t("moduledash.trend_updated_monthly")}</span>
      </div>

      {state === "loading" && (
        <div className="h-24 rounded-lg bg-gray-100 animate-pulse" role="status" aria-busy="true">
          <span className="sr-only">{t("moduledash.loading")}</span>
        </div>
      )}

      {state === "error" && (
        <p className="text-xs text-gray-500" role="status">{t(trendErrorKey(status))}</p>
      )}

      {state === "ready" && noHistory && (
        <p className="text-xs text-gray-500" role="status">
          {t(unavailable ? "moduledash.error_not_ready" : "moduledash.trend_no_history")}
        </p>
      )}

      {state === "ready" && !noHistory && (
        <>
          {intake && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2" role="status">
              {t("moduledash.trend_intake")}
            </p>
          )}

          <div className="flex items-end gap-1.5 h-28">
            {series.map((p) => {
              const value = p.total;
              const alert = value != null && alertOf ? Math.min(alertOf(p), value) : 0;
              const height = value == null ? 0 : Math.max(4, Math.round((value / max) * 92));
              const alertHeight = value ? Math.round((alert / max) * 92) : 0;
              const title = value == null
                ? `${monthLabel(p)} — ${t("moduledash.no_data")}`
                : `${monthLabel(p)} — ${t("moduledash.trend_count")}: ${value}`
                  + (alert ? ` (${alert} ${t("moduledash.alert_critical_high")})` : "");
              return (
                <div key={p.period} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1">
                  {value == null ? (
                    // An explicit gap. Never a zero-height bar sitting on the
                    // axis, which reads as "zero" to anyone glancing at it.
                    <div
                      className="w-full h-6 rounded-md border border-dashed border-gray-300 bg-white/60"
                      title={title}
                      aria-hidden="true"
                    />
                  ) : (
                    <div className="w-full rounded-t-md bg-blue-500/80 relative" style={{ height: `${height}px` }} title={title}>
                      {alertHeight > 0 && (
                        <span
                          className="absolute inset-x-0 bottom-0 rounded-b-md bg-rose-500"
                          style={{ height: `${Math.min(alertHeight, height)}px` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  )}
                  <span className="text-[10px] font-medium text-gray-600 tabular-nums">
                    {value == null ? "—" : value}
                  </span>
                  <span className="text-[10px] text-gray-400 truncate max-w-full">{monthLabel(p)}</span>
                </div>
              );
            })}
          </div>

          {/* The same series in text, for a screen reader and for a printed
              board pack where the bar heights carry nothing. */}
          <ul className="sr-only">
            {series.map((p) => (
              <li key={p.period}>
                {t("moduledash.trend_period")}: {monthLabel(p)} — {t("moduledash.trend_count")}:{" "}
                {p.total == null ? t("moduledash.no_data") : p.total}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-4 flex-wrap text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              {/* The legend names what the BAR counts, and that changes with the
                  source. On the snapshot series a bar is the register balance
                  (« Vulnérabilités enregistrées »); on the intake fallback it is
                  what was opened that month, which is a different measurement —
                  so it is legended neutrally (« Nombre ») rather than asserting
                  a total the register never held. The banner above says which
                  source is in force; the legend must not contradict it. */}
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500/80" aria-hidden="true" />{" "}
              {intake ? t("moduledash.trend_count") : legendLabel}
            </span>
            {alertOf && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" aria-hidden="true" />
                {t("moduledash.alert_critical_high")}
              </span>
            )}
          </div>

          <p className="text-[11px] text-gray-400">
            {intake ? t("moduledash.trend_source_intake") : t("moduledash.trend_source_snapshot")}
            {data && footnote ? ` ${footnote(data)}` : ""}
          </p>
        </>
      )}
    </div>
  );
}

export default function VulnerabilitiesPage() {
  const { t } = useTranslation();
  // Translates raw backend enum values (`in_remediation`, `false_positive`)
  // through the product vocabulary — `key.replace(/_/g," ")` showed a French
  // user "in remediation" and "false positive".
  const label = useBucketLabel();
  const [items, setItems] = useState<any[]>([]);
  // null, NOT a zero-filled object: a failed /stats call must not print
  // "Total 0 · Open 0 · Avg CVSS 0.0" over a register that may hold hundreds.
  const [stats, setStats] = useState<VulnStats | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dashOpen, setDashOpen] = useState<boolean>(readDashOpen);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Detail / actions modal
  const [detail, setDetail] = useState<any>(null);
  const [detailForm, setDetailForm] = useState<any>({});
  const [detailBusy, setDetailBusy] = useState("");
  const [detailErr, setDetailErr] = useState("");

  // Impact scoring (RFP mod 3.4)
  const [impactContext, setImpactContext] = useState("");
  const [impactOverrideMode, setImpactOverrideMode] = useState(false);
  const [impactOverrideValue, setImpactOverrideValue] = useState("");
  const [impactJustification, setImpactJustification] = useState("");
  const [impactBusy, setImpactBusy] = useState(false);
  const [impactErr, setImpactErr] = useState("");
  const [showImpactHistory, setShowImpactHistory] = useState(false);
  const [impactHistory, setImpactHistory] = useState<any[] | null>(null);
  const [impactHistoryLoading, setImpactHistoryLoading] = useState(false);

  // The risk scenarios this vulnerability's impact evaluation is attached to.
  const [scenarioLink, setScenarioLink] = useState<any | null>(null);
  const [scenarioOptions, setScenarioOptions] = useState<MultiSelectOption[]>([]);
  const [scenarioDraft, setScenarioDraft] = useState<string[]>([]);
  const [scenarioBusy, setScenarioBusy] = useState(false);

  // Scanner import
  const [showImport, setShowImport] = useState(false);
  const [importTool, setImportTool] = useState("csv");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const SAMPLE_CSV = `Name,Severity,CVSS,CVE,Host,Solution
Apache Struts 2 Remote Code Execution,Critical,9.8,CVE-2017-5638,Internet Banking Portal,Upgrade to Struts 2.5.13 or later
OpenSSL Heartbleed,High,7.5,CVE-2014-0160,SWIFT Gateway,Patch OpenSSL to 1.0.1g+
Outdated jQuery (Cross-Site Scripting),Medium,6.1,CVE-2020-11022,Internet Banking Portal,Upgrade jQuery to 3.5+
SMBv1 protocol enabled,High,8.1,CVE-2017-0144,Domain Controller AD,Disable SMBv1
Weak SSH ciphers,Low,3.7,,Backup Storage Array,Restrict to strong ciphers`;

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sample-openvas-scan.csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true); setImportResult(null);
    try {
      const journal = await vulnImportApi.upload(importFile, importTool);
      setImportResult(journal);
      setLoading(true);
      load(); loadStats();
    } catch (err: any) {
      setImportResult({ status: "failed", error: err?.response?.data?.detail || t("vulns_ui.import_failed") });
    } finally {
      setImporting(false);
    }
  }

  // Scanner connectors (live API sync)
  const [showConn, setShowConn] = useState(false);
  const [connectors, setConnectors] = useState<any[]>([]);
  const [connLoading, setConnLoading] = useState(false);
  const [connMsg, setConnMsg] = useState("");
  const [connBusy, setConnBusy] = useState("");
  const [addingConn, setAddingConn] = useState(false);
  const emptyConn = { name: "", tool: "demo", base_url: "", api_key: "", api_secret: "", schedule_enabled: false, interval_hours: 168 };
  const [connForm, setConnForm] = useState({ ...emptyConn });
  // EASM connector settings (non-secret; stored server-side as `config`).
  const [easmForm, setEasmForm] = useState<EasmForm>({ ...EMPTY_EASM, field_map: {} });
  // Inline edit of an existing EASM connector's settings (+ optional key rotation).
  const [easmEdit, setEasmEdit] = useState<{ id: string; base_url: string; api_key: string; api_secret: string; form: EasmForm } | null>(null);
  const [connPreview, setConnPreview] = useState<any[] | null>(null);
  // Tools the backend can pull from on its own; OpenVAS (GMP, not HTTP) is file-import only.
  const PULL_TOOLS = ["demo", "tenable", "nessus", "qualys", "easm"];
  const SYNC_INTERVALS = [
    { hours: 24, label: t("vulnerabilities.interval_daily", "Daily") },
    { hours: 168, label: t("vulnerabilities.interval_weekly", "Weekly") },
    { hours: 720, label: t("vulnerabilities.interval_monthly", "Monthly") },
  ];
  const intervalLabel = (h: number) =>
    SYNC_INTERVALS.find((i) => i.hours === h)?.label ?? t("vulnerabilities.interval_hours", "Every {{count}}h", { count: h });
  const connCanPull = PULL_TOOLS.includes(connForm.tool);
  const connNeedsUrl = connForm.tool !== "demo" && connForm.tool !== "openvas";
  const connNeedsKeys = ["tenable", "nessus", "qualys"].includes(connForm.tool);
  const connIsEasm = connForm.tool === "easm";

  async function loadConnectors() {
    setConnLoading(true);
    try { setConnectors(await scannerConnectorsApi.list()); } catch { setConnectors([]); } finally { setConnLoading(false); }
  }
  async function addConnector(e: React.FormEvent) {
    e.preventDefault();
    if (!connForm.name.trim()) return;
    if (connIsEasm && !easmForm.findings_path.trim()) {
      setConnMsg(t("vulnerabilities.easm_findings_path_required", "Enter the findings endpoint path (e.g. /api/v1/findings)."));
      return;
    }
    setAddingConn(true); setConnMsg(""); setConnPreview(null);
    try {
      await scannerConnectorsApi.create({
        name: connForm.name, tool: connForm.tool,
        base_url: connForm.base_url || null, api_key: connForm.api_key || null,
        api_secret: (!connIsEasm || easmForm.auth_style === "basic") ? (connForm.api_secret || null) : null,
        schedule_enabled: connCanPull && connForm.schedule_enabled, interval_hours: connForm.interval_hours,
        ...(connIsEasm ? { config: easmConfigPayload(easmForm) } : {}),
      });
      setConnForm({ ...emptyConn });
      setEasmForm({ ...EMPTY_EASM, field_map: {} });
      loadConnectors();
    } catch (err: any) {
      setConnMsg(err?.response?.data?.detail || t("vulns_ui.conn_add_failed"));
    } finally { setAddingConn(false); }
  }
  async function testConn(id: string) {
    setConnBusy(id + ":test"); setConnMsg(""); setConnPreview(null);
    try {
      const r = await scannerConnectorsApi.test(id);
      setConnMsg((r.ok ? "✓ " : "✗ ") + r.message);
      setConnPreview(Array.isArray(r.preview) && r.preview.length ? r.preview : null);
    }
    catch { setConnMsg(t("vulns_ui.conn_test_failed")); } finally { setConnBusy(""); }
  }
  async function syncConn(id: string) {
    setConnBusy(id + ":sync"); setConnMsg(""); setConnPreview(null);
    try {
      const j = await scannerConnectorsApi.sync(id);
      setConnMsg(j.status === "completed"
        ? `✓ ${t("vulns_ui.sync_done", { imported: j.imported_count, matched: j.matched_count, skipped: j.skipped_count })}`
          + (j.discovered_assets ? ` · ${t("vulnerabilities.easm_assets_discovered", "{{count}} new asset(s) discovered", { count: j.discovered_assets })}` : "")
          + (j.error ? ` · ${j.error}` : "")
        : `✗ ${j.error || t("vulns_ui.sync_failed")}`);
      loadConnectors(); setLoading(true); load(); loadStats();
    } catch { setConnMsg(t("vulns_ui.sync_failed")); } finally { setConnBusy(""); }
  }
  async function updateConn(id: string, patch: Record<string, unknown>) {
    setConnBusy(id + ":upd"); setConnMsg("");
    try {
      const updated = await scannerConnectorsApi.update(id, patch);
      setConnectors((cs) => cs.map((c) => (c.id === id ? updated : c)));
    } catch (err: any) {
      setConnMsg(err?.response?.data?.detail || t("vulnerabilities.conn_update_failed", "Could not update connector"));
    } finally { setConnBusy(""); }
  }
  function startEasmEdit(cn: any) {
    const c = cn.config || {};
    setConnMsg(""); setConnPreview(null);
    setEasmEdit({
      id: cn.id, base_url: cn.base_url || "", api_key: "", api_secret: "",
      form: {
        auth_style: c.auth_style || "bearer", auth_header: c.auth_header || "X-API-Key",
        auth_query_param: c.auth_query_param || "api_key", findings_path: c.findings_path || "",
        assets_path: c.assets_path || "", results_key: c.results_key || "",
        discover_assets: c.discover_assets !== false, field_map: { ...(c.field_map || {}) },
        showAdvanced: !!(c.results_key || Object.keys(c.field_map || {}).length),
      },
    });
  }
  type EasmEditState = { id: string; base_url: string; api_key: string; api_secret: string; form: EasmForm };
  function patchEasmEdit(p: Partial<EasmEditState>) {
    setEasmEdit((ed) => (ed ? { ...ed, ...p } : ed));
  }
  async function saveEasmEdit() {
    if (!easmEdit) return;
    if (!easmEdit.form.findings_path.trim()) {
      setConnMsg(t("vulnerabilities.easm_findings_path_required", "Enter the findings endpoint path (e.g. /api/v1/findings)."));
      return;
    }
    const patch: Record<string, unknown> = { base_url: easmEdit.base_url || null, config: easmConfigPayload(easmEdit.form) };
    // Blank = keep the stored key; the server never sends secrets back.
    if (easmEdit.api_key) patch.api_key = easmEdit.api_key;
    if (easmEdit.api_secret) patch.api_secret = easmEdit.api_secret;
    setConnBusy(easmEdit.id + ":upd"); setConnMsg("");
    try {
      const updated = await scannerConnectorsApi.update(easmEdit.id, patch);
      setConnectors((cs) => cs.map((c) => (c.id === easmEdit.id ? updated : c)));
      setEasmEdit(null);
      setConnMsg("✓ " + t("vulnerabilities.easm_saved", "EASM settings saved. Use Test to check the mapping."));
    } catch (err: any) {
      setConnMsg(err?.response?.data?.detail || t("vulnerabilities.conn_update_failed", "Could not update connector"));
    } finally { setConnBusy(""); }
  }

  const inputCls = "border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const EASM_FIELDS: { key: string; label: string; ph: string }[] = [
    { key: "title", label: t("vulnerabilities.easm_fm_title", "Title"), ph: "name" },
    { key: "severity", label: t("vulnerabilities.easm_fm_severity", "Severity"), ph: "risk_level" },
    { key: "ref_id", label: t("vulnerabilities.easm_fm_ref_id", "Reference / CVE"), ph: "cve" },
    { key: "cvss", label: t("vulnerabilities.easm_fm_cvss", "CVSS score"), ph: "cvss_score" },
    { key: "host", label: t("vulnerabilities.easm_fm_host", "Host / domain"), ph: "asset.hostname" },
    { key: "ip", label: t("vulnerabilities.easm_fm_ip", "IP address"), ph: "ip_address" },
    { key: "description", label: t("vulnerabilities.easm_fm_description", "Description"), ph: "description" },
    { key: "solution", label: t("vulnerabilities.easm_fm_solution", "Remediation"), ph: "remediation" },
    { key: "references", label: t("vulnerabilities.easm_fm_references", "References / URL"), ph: "references" },
  ];
  function renderEasmFields(f: EasmForm, set: (next: EasmForm) => void) {
    return (
      <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600 space-y-1">
            <span>{t("vulnerabilities.easm_auth_style", "Authentication")}</span>
            <select value={f.auth_style} onChange={(e) => set({ ...f, auth_style: e.target.value })} className={inputCls + " w-full"}>
              <option value="bearer">{t("vulnerabilities.easm_auth_bearer", "Bearer token (Authorization header)")}</option>
              <option value="header">{t("vulnerabilities.easm_auth_header", "API key in a header")}</option>
              <option value="basic">{t("vulnerabilities.easm_auth_basic", "Basic (username + password)")}</option>
              <option value="query">{t("vulnerabilities.easm_auth_query", "API key as a query parameter")}</option>
            </select>
          </label>
          {f.auth_style === "header" && (
            <label className="text-xs text-gray-600 space-y-1">
              <span>{t("vulnerabilities.easm_header_name", "Header name")}</span>
              <input value={f.auth_header} onChange={(e) => set({ ...f, auth_header: e.target.value })} placeholder="X-API-Key" className={inputCls + " w-full"} />
            </label>
          )}
          {f.auth_style === "query" && (
            <label className="text-xs text-gray-600 space-y-1">
              <span>{t("vulnerabilities.easm_query_param", "Parameter name")}</span>
              <input value={f.auth_query_param} onChange={(e) => set({ ...f, auth_query_param: e.target.value })} placeholder="api_key" className={inputCls + " w-full"} />
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600 space-y-1">
            <span>{t("vulnerabilities.easm_findings_path", "Findings endpoint path")} *</span>
            <input value={f.findings_path} onChange={(e) => set({ ...f, findings_path: e.target.value })} placeholder="/api/v1/findings" className={inputCls + " w-full"} />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            <span>{t("vulnerabilities.easm_assets_path", "Assets endpoint path (optional)")}</span>
            <input value={f.assets_path} onChange={(e) => set({ ...f, assets_path: e.target.value })} placeholder="/api/v1/assets" className={inputCls + " w-full"} />
          </label>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={f.discover_assets} onChange={(e) => set({ ...f, discover_assets: e.target.checked })} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          {t("vulnerabilities.easm_discover_assets", "Create assets for newly discovered domains/IPs")}
        </label>
        <div>
          <button type="button" onClick={() => set({ ...f, showAdvanced: !f.showAdvanced })} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800">
            {f.showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />}
            {t("vulnerabilities.easm_advanced", "Advanced field mapping")}
          </button>
          {f.showAdvanced && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-500">{t("vulnerabilities.easm_advanced_help", "Leave blank to auto-detect. Use the key name from the platform's JSON; dotted paths like asset.hostname or cves[0] are allowed.")}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label className="text-xs text-gray-600 space-y-1">
                  <span>{t("vulnerabilities.easm_results_key", "Results key (list location)")}</span>
                  <input value={f.results_key} onChange={(e) => set({ ...f, results_key: e.target.value })} placeholder="data.items" className={inputCls + " w-full"} />
                </label>
                {EASM_FIELDS.map((fd) => (
                  <label key={fd.key} className="text-xs text-gray-600 space-y-1">
                    <span>{fd.label}</span>
                    <input value={f.field_map[fd.key] || ""} onChange={(e) => set({ ...f, field_map: { ...f.field_map, [fd.key]: e.target.value } })} placeholder={fd.ph} className={inputCls + " w-full"} />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  async function deleteConn(id: string) {
    setConnBusy(id + ":del");
    try { await scannerConnectorsApi.remove(id); loadConnectors(); } catch {} finally { setConnBusy(""); }
  }

  const [form, setForm] = useState({
    ref_id: "",
    title: "",
    description: "",
    severity: "medium",
    cvss_score: 5.0,
    source: "scan",
    affected_systems: "",
  });

  async function load() {
    setLoadError("");
    try {
      const params: any = {};
      if (sevFilter) params.severity = sevFilter;
      if (statusFilter) params.status_filter = statusFilter;
      const data = await vulnerabilitiesApi.list(params);
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch (err) {
      // Never swallow this. An empty list on a failed call made the screen say
      // « aucune vulnérabilité » — telling a bank it has none when the server
      // refused to answer is the same class of lie as inventing rows.
      setItems([]);
      setLoadError(errorDetail(err) || t("errors.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      setStats(await vulnerabilitiesApi.stats());
    } catch {
      // The KPI strip degrades to « non disponible », never to zeros.
      setStats(null);
    }
  }

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

  useEffect(() => {
    load();
    loadStats();
  }, [sevFilter, statusFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("vulnerabilities.error_title_required")); return; }
    if (!form.ref_id.trim()) { setError(t("vulnerabilities.error_ref_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      await vulnerabilitiesApi.create(form);
      setShowModal(false);
      setForm({ ref_id: "", title: "", description: "", severity: "medium", cvss_score: 5.0, source: "scan", affected_systems: "" });
      setLoading(true);
      load();
      loadStats();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("vulnerabilities.error_create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  function openDetail(item: any) {
    setDetail(item);
    setDetailErr("");
    setImpactContext(""); setImpactOverrideMode(false); setImpactOverrideValue(""); setImpactJustification(""); setImpactErr("");
    setShowImpactHistory(false); setImpactHistory(null); setImpactHistoryLoading(false);
    setScenarioLink(null); setScenarioDraft([]);
    loadScenarioLink(item.id);
    setDetailForm({
      title: item.title ?? "",
      severity: item.severity ?? "medium",
      cvss_score: item.cvss_score ?? "",
      status: item.status ?? "open",
      remediation_due_date: item.remediation_due_date ? String(item.remediation_due_date).slice(0, 10) : "",
      description: item.description ?? "",
    });
  }
  function refreshAll() { setLoading(true); load(); loadStats(); }

  useEffect(() => {
    riskScenariosApi.list().then((d: any) => {
      const list = Array.isArray(d) ? d : d.items || [];
      setScenarioOptions(list.map((sc: any) => ({ id: sc.id, label: sc.name })));
    }).catch(() => setScenarioOptions([]));
  }, []);

  async function saveDetail() {
    if (!detail) return;
    setDetailBusy("save"); setDetailErr("");
    try {
      const payload: any = { ...detailForm };
      payload.cvss_score = payload.cvss_score === "" ? null : parseFloat(payload.cvss_score);
      if (!payload.remediation_due_date) delete payload.remediation_due_date;
      await vulnerabilitiesApi.update(detail.id, payload);
      setDetail(null); refreshAll();
    } catch (e: any) { setDetailErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setDetailBusy(""); }
  }
  async function validateDetail() {
    if (!detail) return;
    setDetailBusy("validate"); setDetailErr("");
    try {
      await vulnerabilitiesApi.validate(detail.id);
      setDetail(null); refreshAll();
    } catch (e: any) { setDetailErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setDetailBusy(""); }
  }
  async function loadScenarioLink(vulnId: string) {
    try {
      const link = await vulnerabilitiesApi.scenarios(vulnId);
      setScenarioLink(link);
      setScenarioDraft((link.scenarios || []).map((sc: any) => sc.id));
    } catch { setScenarioLink(null); }
  }
  async function saveScenarioLink() {
    if (!detail) return;
    setScenarioBusy(true); setImpactErr("");
    try {
      const link = await vulnerabilitiesApi.setScenarios(detail.id, scenarioDraft);
      setScenarioLink(link);
      setScenarioDraft((link.scenarios || []).map((sc: any) => sc.id));
    } catch (e: any) { setImpactErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setScenarioBusy(false); }
  }
  async function loadImpactHistory() {
    if (!detail) return;
    setImpactHistoryLoading(true);
    try {
      const h = await vulnerabilitiesApi.impactHistory(detail.id);
      setImpactHistory(Array.isArray(h) ? h : []);
    } catch { setImpactHistory([]); }
    finally { setImpactHistoryLoading(false); }
  }
  function toggleImpactHistory() {
    const next = !showImpactHistory;
    setShowImpactHistory(next);
    if (next && impactHistory === null) loadImpactHistory();
  }
  async function recalcImpact() {
    if (!detail) return;
    setImpactBusy(true); setImpactErr("");
    try {
      const updated = await vulnerabilitiesApi.scoreImpact(detail.id, { operational_context: impactContext || null });
      setDetail(updated);
      setImpactHistory(null);
      if (showImpactHistory) loadImpactHistory();
    } catch (e: any) { setImpactErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setImpactBusy(false); }
  }
  async function overrideImpact() {
    if (!detail) return;
    if (!impactJustification.trim()) { setImpactErr(t("vulnerabilities.impact_justification_required", "A justification is required to override the score")); return; }
    setImpactBusy(true); setImpactErr("");
    try {
      const updated = await vulnerabilitiesApi.scoreImpact(detail.id, { override: parseFloat(impactOverrideValue), justification: impactJustification });
      setDetail(updated);
      setImpactOverrideMode(false);
      setImpactHistory(null);
      if (showImpactHistory) loadImpactHistory();
    } catch (e: any) { setImpactErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setImpactBusy(false); }
  }
  async function deleteDetail() {
    if (!detail) return;
    if (!confirm(t("vulnerabilities.confirm_delete", "Delete this vulnerability?"))) return;
    setDetailBusy("delete"); setDetailErr("");
    try {
      await vulnerabilitiesApi.delete(detail.id);
      setDetail(null); refreshAll();
    } catch (e: any) { setDetailErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setDetailBusy(""); }
  }

  const filtered = items.filter((i) =>
    (i.title?.toLowerCase().includes(search.toLowerCase()) || i.ref_id?.toLowerCase().includes(search.toLowerCase()))
  );

  // GET /vulnerabilities caps at `limit` (default 1000, ceiling 5000) and this
  // page never asks for more, so the table and the free-text search above
  // describe only what came back. `stats.total` is computed server-side over the
  // WHOLE register, which makes it the one honest way to detect that gap without
  // reading X-Total-Count (the api wrapper returns the body only, and
  // api/endpoints.ts belongs to another lane this wave).
  //
  // Compared only when neither server-side filter is on: with `severity` or
  // `status_filter` set, items.length is legitimately below stats.total and
  // flagging that would be crying wolf.
  const serverFiltered = Boolean(sevFilter || statusFilter);
  const truncated =
    !serverFiltered && typeof stats?.total === "number" && items.length < stats.total;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("vulnerabilities.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("vulnerabilities.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setConnMsg(""); loadConnectors(); setShowConn(true); }}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Plug className="w-4 h-4" /> {t("vulnerabilities.connectors", "Connectors")}
          </button>
          <button
            onClick={() => { setImportResult(null); setImportFile(null); setShowImport(true); }}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-4 h-4" /> {t("vulnerabilities.import_scan", "Import scan")}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> {t("vulnerabilities.new_vulnerability")}
          </button>
        </div>
      </div>

      {/*
        Objectif 2 — « Accessible depuis la page dédiée aux vulnérabilités ».
        The vulnerability dashboard existed behind GET /dashboards/vulnerabilities
        but the only screen that ever called it was AnalyticsPage: a card in
        another navigation group does not make a dashboard accessible from the
        vulnerability page. The LOCATION is the requirement.

        Access stays « limité aux analystes sécurité » — the endpoint's
        require_roles_strict(SECURITY_ANALYST, CISO) answers 403 for anyone
        else, which ModuleDashboard renders as an explicit « vue restreinte »
        panel rather than a blank card. The Elite plan gate is likewise rendered
        as a translated upsell, never as silence.
      */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={toggleDash}
          aria-expanded={dashOpen}
          aria-controls="module-dashboard-vulnerabilities"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {dashOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
            : <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />}
          <BarChart3 className="w-4 h-4 text-rose-600" aria-hidden="true" />
          {t("moduledash.dashboard")}
          <span className="text-xs font-normal text-gray-400">
            {dashOpen ? t("moduledash.hide") : t("moduledash.show")}
          </span>
        </button>
        {dashOpen && (
          <ModuleDashboard module="vulnerabilities">
            {/* Rendered as a CHILD of the dashboard on purpose: ModuleDashboard
                only renders children once the dashboard itself loaded, so the
                trend never fires a second request behind the Elite gate or the
                security-analyst gate, and never appears next to an upsell or a
                « vue restreinte » panel. */}
            <TrendPanel
              load={() =>
                apiClient
                  .get<TrendEnvelope>("/vulnerabilities/trend", { params: { months: TREND_MONTHS } })
                  .then((r) => r.data)
              }
              legendLabel={t("moduledash.metric_total_vulnerabilities")}
              // « Alertes visuelles sur criticité élevée » on the history too:
              // by_severity is the one grouping BOTH sources carry, so the
              // critical/high band survives the intake-volume fallback.
              alertOf={(p) => {
                const sev = (p.counts?.by_severity ?? {}) as Record<string, number>;
                return (sev.critical || 0) + (sev.high || 0);
              }}
            />
          </ModuleDashboard>
        )}
      </div>

      {/* The register could not be read. Say what the server said — its detail
          carries the operator's next action. */}
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

      {/* Stats — every tile is server-computed over the whole register, and every
          one of them renders « non disponible » rather than a zero the backend
          never asserted. `avg_cvss` in particular comes back null when no
          finding carries a score, and printing "0.0" for that is a fabricated
          figure a bank will (rightly) stop trusting the screen over. */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("vulnerabilities.stat_total"), value: stats?.total, icon: Bug, color: "text-blue-600 bg-blue-50" },
          { label: t("vulnerabilities.stat_open"), value: stats?.open, icon: ShieldCheck, color: "text-red-600 bg-red-50" },
          { label: t("vulnerabilities.stat_in_remediation"), value: stats?.in_remediation, icon: Wrench, color: "text-yellow-600 bg-yellow-50" },
          {
            label: t("vulnerabilities.stat_avg_cvss"),
            value: typeof stats?.avg_cvss === "number" ? stats.avg_cvss.toFixed(1) : undefined,
            icon: BarChart3, color: "text-purple-600 bg-purple-50",
          },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900 tabular-nums">
                  {s.value == null ? t("moduledash.not_available") : s.value}
                </p>
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
            placeholder={t("vulnerabilities.search_placeholder")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("vulnerabilities.all_severities")}</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{t(`compliance.severities.${s}` as never)}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("vulnerabilities.all_statuses")}</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </div>
      </div>

      {/* What the table and the search box above actually cover — saying so beats
          letting the screen imply it is describing the whole register. */}
      {!loading && !loadError && items.length > 0 && (
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-gray-800">{filtered.length}</span>{" "}
          {t("common.of")}{" "}
          <span className="font-semibold text-gray-800">{items.length}</span>
          {truncated && (
            <span className="ms-1 text-amber-700">
              ({t("risks.truncated", { total: stats?.total ?? 0 })})
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
          // Distinct from "no vulnerabilities": the register is unknown, not empty.
          <div className="text-center py-16 text-gray-400">{t("common.no_data")}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("vulnerabilities.no_vulnerabilities")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_ref")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_title")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_severity")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_cvss")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_status")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_remediation_due")}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => (
                <tr
                  key={item.id}
                  onClick={() => openDetail(item)}
                  className="group border-b border-gray-50 hover:bg-blue-50/40 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.ref_id}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{item.title}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEV_BADGE[item.severity] || "bg-gray-100 text-gray-600"}`}>
                      {item.severity ? label(item.severity) : "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-700 font-medium">{item.cvss_score ?? "-"}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                      {item.status ? label(item.status) : "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">{item.remediation_due_date ? new Date(item.remediation_due_date).toLocaleDateString(uiLocale()) : "-"}</td>
                  <td className="px-6 py-4 text-right"><ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail / actions modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[88vh] overflow-auto">
            <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-gray-400">{detail.ref_id}</span>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[detailForm.status] || "bg-gray-100 text-gray-600"}`}>{detailForm.status?.replace(/_/g, " ")}</span>
                </div>
                <h3 className="font-semibold text-gray-900 mt-1">{detail.title}</h3>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {detailErr && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{detailErr}</div>}
              <div>
                <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_title", "Title")}</label>
                <input value={detailForm.title} onChange={(e) => setDetailForm({ ...detailForm, title: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_status", "Status")}</label>
                  <select value={detailForm.status} onChange={(e) => setDetailForm({ ...detailForm, status: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_severity", "Severity")}</label>
                  <select value={detailForm.severity} onChange={(e) => setDetailForm({ ...detailForm, severity: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_cvss", "CVSS")}</label>
                  <input type="number" step="0.1" min="0" max="10" value={detailForm.cvss_score} onChange={(e) => setDetailForm({ ...detailForm, cvss_score: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_remediation_due", "Remediation due")}</label>
                  <input type="date" value={detailForm.remediation_due_date} onChange={(e) => setDetailForm({ ...detailForm, remediation_due_date: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">{t("common.description", "Description")}</label>
                <textarea rows={3} value={detailForm.description} onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Impact scoring (RFP mod 3.4) */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5" /> {t("vulnerabilities.impact_title", "Impact Score")}
                </p>
                {impactErr && <div className="mb-2 p-2 bg-red-50 text-red-700 rounded-lg text-xs">{impactErr}</div>}
                <div className="flex items-center gap-3 mb-3">
                  <span className={`text-2xl font-bold ${detail.impact_score == null ? "text-gray-300" : detail.impact_score >= 70 ? "text-red-600" : detail.impact_score >= 40 ? "text-orange-600" : "text-green-600"}`}>
                    {detail.impact_score != null ? Math.round(detail.impact_score) : "—"}
                  </span>
                  <span className="text-xs text-gray-400">/ 100</span>
                  {detail.impact_override != null && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">{t("vulnerabilities.impact_manual", "Manual override")}</span>
                  )}
                </div>
                {detail.impact_justification && (
                  <p className="text-xs text-gray-500 mb-3 italic">"{detail.impact_justification}"</p>
                )}

                {impactOverrideMode ? (
                  <div className="space-y-2 bg-gray-50 rounded-xl p-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">{t("vulnerabilities.impact_override_value", "Override value (0-100)")}</label>
                      <input type="number" min={0} max={100} step={0.1} value={impactOverrideValue} onChange={(e) => setImpactOverrideValue(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">{t("vulnerabilities.impact_justification", "Justification")} *</label>
                      <textarea rows={2} value={impactJustification} onChange={(e) => setImpactJustification(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setImpactOverrideMode(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                      <button onClick={overrideImpact} disabled={impactBusy} className="inline-flex items-center gap-1.5 bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-50">
                        {impactBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.save", "Save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={impactContext} onChange={(e) => setImpactContext(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">{t("vulnerabilities.impact_context_default", "Default context")}</option>
                      {OPERATIONAL_CONTEXTS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </select>
                    <button onClick={recalcImpact} disabled={impactBusy} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
                      {impactBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t("vulnerabilities.impact_recalculate", "Recalculate")}
                    </button>
                    <button onClick={() => { setImpactOverrideMode(true); setImpactOverrideValue(detail.impact_score != null ? String(detail.impact_score) : ""); }} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                      {t("vulnerabilities.impact_override_btn", "Override manually")}
                    </button>
                  </div>
                )}

                {/* Risk scenarios this evaluation is attached to (RFP: impact must be
                    traceable to one or more existing risk scenarios) */}
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5" /> {t("vulnerabilities.impact_scenarios", "Risk scenarios this impact feeds")}
                  </p>
                  {scenarioLink === null ? (
                    <div className="flex items-center py-2"><Loader2 className="w-4 h-4 animate-spin text-blue-400" /></div>
                  ) : (
                    <>
                      {(scenarioLink.scenarios || []).length === 0 ? (
                        <p className="text-xs text-gray-400 italic mb-2">
                          {t("vulnerabilities.impact_scenarios_empty", "Not attached to any risk scenario — this impact score feeds no risk analysis yet.")}
                        </p>
                      ) : (
                        <div className="space-y-1.5 mb-2">
                          {(scenarioLink.scenarios || []).map((sc: any) => (
                            <div key={sc.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                              <span className="text-xs text-gray-700 flex-1 min-w-0 truncate" title={sc.name}>{sc.name}</span>
                              {sc.current_probability != null && sc.current_impact != null && (
                                <span className="text-[11px] text-gray-400 whitespace-nowrap">P{sc.current_probability} × I{sc.current_impact}</span>
                              )}
                              {sc.current_risk_level && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${SEV_BADGE[sc.current_risk_level] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                                  {sc.current_risk_level}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {scenarioLink.suggested_impact_level != null && (
                        <p className="text-xs text-gray-500 mb-2">
                          {t("vulnerabilities.impact_suggested", "Composite impact {{score}}/100 corresponds to impact level {{level}} on your 1–{{scale}} scale. Suggestion only — the scenario's own rating is never overwritten.", {
                            score: Math.round(scenarioLink.impact_score ?? 0),
                            level: scenarioLink.suggested_impact_level,
                            scale: scenarioLink.impact_scale_size,
                          })}
                        </p>
                      )}

                      <MultiSelect
                        options={scenarioOptions}
                        selected={scenarioDraft}
                        onChange={setScenarioDraft}
                        placeholder={t("vulnerabilities.impact_scenarios_pick", "Attach to risk scenarios…")}
                        emptyLabel={t("risk_scenarios.no_options", "No risk scenarios yet")}
                      />
                      {JSON.stringify([...scenarioDraft].sort()) !==
                        JSON.stringify((scenarioLink.scenarios || []).map((sc: any) => sc.id).sort()) && (
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={saveScenarioLink}
                            disabled={scenarioBusy}
                            className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                          >
                            {scenarioBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {t("vulnerabilities.impact_scenarios_save", "Update links")}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Impact score history */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={toggleImpactHistory}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
                  >
                    {showImpactHistory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {t("vulnerabilities.impact_history_title", "History")}
                  </button>
                  {showImpactHistory && (
                    <div className="mt-2 space-y-1.5">
                      {impactHistoryLoading ? (
                        <div className="flex items-center justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-blue-400" /></div>
                      ) : !impactHistory || impactHistory.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">{t("vulnerabilities.impact_history_empty", "No history yet")}</p>
                      ) : (
                        impactHistory.map((h: any) => (
                          <div key={h.id} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                            <span className="text-sm font-semibold text-gray-800">{h.score != null ? Math.round(h.score) : "—"}</span>
                            {h.override && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 whitespace-nowrap">
                                {t("vulnerabilities.impact_manual", "Manual override")}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              {h.justification && <p className="text-xs text-gray-500 italic truncate" title={h.justification}>"{h.justification}"</p>}
                              {(h.linked_scenario_ids || []).length > 0 && (
                                <p className="text-[11px] text-gray-400">
                                  {t("vulnerabilities.impact_history_scenarios", "judged against {{count}} risk scenario(s)", { count: (h.linked_scenario_ids || []).length })}
                                </p>
                              )}
                            </div>
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">{h.created_at ? new Date(h.created_at).toLocaleString(uiLocale()) : ""}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={deleteDetail} disabled={!!detailBusy} className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 disabled:opacity-50">
                {detailBusy === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t("common.delete", "Delete")}
              </button>
              <div className="flex items-center gap-2">
                {detailForm.status === "pending_validation" && (
                  <button onClick={validateDetail} disabled={!!detailBusy} className="inline-flex items-center gap-1.5 bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-50 disabled:opacity-50">
                    {detailBusy === "validate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} {t("vulnerabilities.validate", "Validate")}
                  </button>
                )}
                <button onClick={saveDetail} disabled={!!detailBusy} className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {detailBusy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("common.save", "Save changes")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("vulnerabilities.new_vulnerability")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.ref_id_label")} *</label>
                  <input value={form.ref_id} onChange={(e) => setForm({ ...form, ref_id: e.target.value })} placeholder={t("vulnerabilities.ref_id_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.name")} *</label>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.severity")}</label>
                  <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{t(`compliance.severities.${s}` as never)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.cvss_score")}</label>
                  <input type="number" min={0} max={10} step={0.1} value={form.cvss_score} onChange={(e) => setForm({ ...form, cvss_score: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.col_source")}</label>
                  <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.affected_systems")}</label>
                <input value={form.affected_systems} onChange={(e) => setForm({ ...form, affected_systems: e.target.value })} placeholder={t("vulnerabilities.affected_systems_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("vulnerabilities.new_vulnerability")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Scanner import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowImport(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" /> {t("vulnerabilities.import_title", "Import scanner results")}
              </h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-5">{t("vulnerabilities.import_help", "Upload a Nessus (.nessus) file or a Qualys / OpenVAS CSV export. Findings are parsed, deduplicated and auto-matched to your assets.")}</p>
            <form onSubmit={handleImport} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.scanner", "Scanner")}</label>
                  <select value={importTool} onChange={(e) => setImportTool(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="csv">{t("vulns_ui.tool_generic_csv")}</option>
                    <option value="openvas">OpenVAS</option>
                    <option value="qualys">Qualys</option>
                    <option value="nessus">Nessus / Tenable</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.file", "Scan file")}</label>
                  <input type="file" accept=".csv,.nessus,.xml" onChange={(e) => setImportFile(e.target.files?.[0] || null)} className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm hover:file:bg-blue-100" />
                </div>
              </div>
              <button type="button" onClick={downloadSample} className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Download className="w-3.5 h-3.5" /> {t("vulnerabilities.sample", "Download a sample OpenVAS CSV to try it")}
              </button>
              {importResult && (
                <div className={`p-3 rounded-xl text-sm ${importResult.status === "completed" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                  {importResult.status === "completed"
                    ? t("vulns_ui.import_done", { imported: importResult.imported_count, matched: importResult.matched_count, skipped: importResult.skipped_count, parsed: importResult.parsed_count })
                    : `${t("vulns_ui.import_failed")}: ${importResult.error || t("vulns_ui.unknown_error")}`}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.close", "Close")}</button>
                <button type="submit" disabled={importing || !importFile} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {importing && <Loader2 className="w-4 h-4 animate-spin" />} {t("vulnerabilities.import_run", "Import")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Scanner connectors modal */}
      {showConn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowConn(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Plug className="w-5 h-5 text-blue-600" /> {t("vulnerabilities.connectors_title", "Scanner connectors")}
              </h2>
              <button onClick={() => setShowConn(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{t("vulnerabilities.connectors_help", "Connect to Nessus/Tenable, Qualys or OpenVAS to pull findings automatically. Sync on demand or on a schedule; every run is journaled.")}</p>

            {connMsg && (
              <div className={`mb-4 p-3 rounded-xl text-sm whitespace-pre-line break-words ${connMsg.startsWith("✗") ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                {connMsg}
                {connPreview && (
                  <div className="mt-2 overflow-x-auto">
                    <p className="text-xs font-semibold mb-1">{t("vulnerabilities.easm_preview", "Preview of the first mapped findings")}</p>
                    <table className="text-xs w-full">
                      <tbody>
                        {connPreview.map((p, i) => (
                          <tr key={i} className="border-t border-blue-100">
                            <td className="py-1 pe-2 font-medium">{p.title}</td>
                            <td className="py-1 pe-2 capitalize">{p.severity}</td>
                            <td className="py-1 pe-2 font-mono">{p.ref_id || "—"}</td>
                            <td className="py-1 font-mono" dir="ltr">{p.host || p.ip || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 mb-6">
              {connLoading ? (
                <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
              ) : connectors.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">{t("vulnerabilities.no_connectors", "No connectors yet. Add one below.")}</p>
              ) : connectors.map((cn) => (
                <div key={cn.id} className="flex flex-wrap items-center gap-3 border border-gray-100 rounded-xl px-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center"><Plug className="w-4 h-4 text-blue-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{cn.name}</p>
                    <p className="text-xs text-gray-500">
                      <span className="capitalize">{cn.tool}</span>
                      {" · "}
                      {cn.last_sync_at
                        ? <>
                            {t("vulnerabilities.last_sync", "Last sync")}: {new Date(cn.last_sync_at + (String(cn.last_sync_at).endsWith("Z") ? "" : "Z")).toLocaleString(uiLocale())}
                            {cn.last_status && (
                              <span className={`ms-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cn.last_status === "failed" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>{cn.last_status}</span>
                            )}
                          </>
                        : t("vulnerabilities.never_synced", "Never synced")}
                    </p>
                    {cn.tool === "easm" && cn.config?.findings_path && (
                      <p className="text-xs text-gray-500 truncate mt-0.5" dir="ltr">
                        {t("vulnerabilities.easm_findings_path", "Findings endpoint path")}: <span className="font-mono">{cn.config.findings_path}</span>
                        {cn.config.discover_assets === false ? "" : ` · ${t("vulnerabilities.easm_discovery_on", "asset discovery on")}`}
                      </p>
                    )}
                    {PULL_TOOLS.includes(cn.tool) ? (
                      <div className="flex items-center gap-2 mt-1.5">
                        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!cn.schedule_enabled}
                            disabled={!!connBusy}
                            onChange={(e) => updateConn(cn.id, { schedule_enabled: e.target.checked })}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          {t("vulnerabilities.auto_sync", "Automatic sync")}
                        </label>
                        {cn.schedule_enabled && (
                          <select
                            value={cn.interval_hours}
                            disabled={!!connBusy}
                            onChange={(e) => updateConn(cn.id, { interval_hours: Number(e.target.value) })}
                            className="border border-gray-200 rounded-lg px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {!SYNC_INTERVALS.some((i) => i.hours === cn.interval_hours) && (
                              <option value={cn.interval_hours}>{intervalLabel(cn.interval_hours)}</option>
                            )}
                            {SYNC_INTERVALS.map((i) => <option key={i.hours} value={i.hours}>{i.label}</option>)}
                          </select>
                        )}
                        {connBusy === cn.id + ":upd" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
                      </div>
                    ) : (
                      <p className="text-xs text-amber-600 mt-1">{t("vulnerabilities.file_import_only", "File import only — export the report and use Import.")}</p>
                    )}
                  </div>
                  {cn.tool === "easm" && (
                    <button onClick={() => (easmEdit?.id === cn.id ? setEasmEdit(null) : startEasmEdit(cn))} disabled={!!connBusy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                      {easmEdit?.id === cn.id ? t("vulnerabilities.easm_cancel_edit", "Cancel") : t("vulnerabilities.easm_edit", "Edit")}
                    </button>
                  )}
                  <button onClick={() => testConn(cn.id)} disabled={!!connBusy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                    {connBusy === cn.id + ":test" ? "…" : t("vulnerabilities.test", "Test")}
                  </button>
                  <button onClick={() => syncConn(cn.id)} disabled={!!connBusy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {connBusy === cn.id + ":sync" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t("vulnerabilities.sync_now", "Sync now")}
                  </button>
                  <button onClick={() => deleteConn(cn.id)} disabled={!!connBusy} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                  {easmEdit && easmEdit.id === cn.id && (
                    <div className="basis-full space-y-3 pt-2">
                      <input value={easmEdit.base_url} onChange={(e) => patchEasmEdit({ base_url: e.target.value })} placeholder="https://easm.example.com" className={inputCls + " w-full"} />
                      <div className="grid grid-cols-2 gap-3">
                        <input value={easmEdit.api_key} onChange={(e) => patchEasmEdit({ api_key: e.target.value })} placeholder={t("vulnerabilities.easm_key_keep", "New API key (blank = keep current)")} type="password" autoComplete="new-password" className={inputCls} />
                        {easmEdit.form.auth_style === "basic" && (
                          <input value={easmEdit.api_secret} onChange={(e) => patchEasmEdit({ api_secret: e.target.value })} placeholder={t("vulnerabilities.easm_secret_keep", "New password (blank = keep current)")} type="password" autoComplete="new-password" className={inputCls} />
                        )}
                      </div>
                      {renderEasmFields(easmEdit.form, (form) => patchEasmEdit({ form }))}
                      <div className="flex justify-end">
                        <button type="button" onClick={saveEasmEdit} disabled={!!connBusy} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-1.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                          {connBusy === cn.id + ":upd" && <Loader2 className="w-4 h-4 animate-spin" />} {t("vulnerabilities.easm_save", "Save settings")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={addConnector} className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">{t("vulnerabilities.add_connector", "Add connector")}</p>
              <div className="grid grid-cols-2 gap-3">
                <input value={connForm.name} onChange={(e) => setConnForm({ ...connForm, name: e.target.value })} placeholder={t("vulnerabilities.conn_name", "Name")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={connForm.tool} onChange={(e) => setConnForm({ ...connForm, tool: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="demo">{t("vulnerabilities.tool_demo", "Demo (simulated)")}</option>
                  <optgroup label={t("vulnerabilities.tools_auto_pull", "Pulls findings automatically")}>
                    <option value="tenable">Tenable.io</option>
                    <option value="nessus">Nessus (Professional / Manager)</option>
                    <option value="qualys">Qualys VM</option>
                    <option value="easm">{t("vulnerabilities.easm_tool", "EASM (External Attack Surface)")}</option>
                  </optgroup>
                  <optgroup label={t("vulnerabilities.tools_file_only", "File import only")}>
                    <option value="openvas">{t("vulnerabilities.tool_openvas_file", "OpenVAS / Greenbone (file import only)")}</option>
                  </optgroup>
                </select>
              </div>
              {connNeedsUrl && (
                <input value={connForm.base_url} onChange={(e) => setConnForm({ ...connForm, base_url: e.target.value })} placeholder={connForm.tool === "tenable" ? "https://cloud.tenable.com" : connForm.tool === "qualys" ? "https://qualysapi.qualys.com" : connIsEasm ? t("vulnerabilities.easm_base_url", "Base URL, e.g. https://api.easm-vendor.com") : "https://nessus.host:8834"} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              )}
              {connNeedsKeys && (
                <div className="grid grid-cols-2 gap-3">
                  <input value={connForm.api_key} onChange={(e) => setConnForm({ ...connForm, api_key: e.target.value })} placeholder={connForm.tool === "qualys" ? t("vulnerabilities.api_username", "API username") : t("vulnerabilities.access_key", "Access key")} autoComplete="off" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={connForm.api_secret} onChange={(e) => setConnForm({ ...connForm, api_secret: e.target.value })} placeholder={connForm.tool === "qualys" ? t("vulnerabilities.api_password", "API password") : t("vulnerabilities.secret_key", "Secret key")} type="password" autoComplete="new-password" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {connIsEasm && (
                <div className="grid grid-cols-2 gap-3">
                  <input value={connForm.api_key} onChange={(e) => setConnForm({ ...connForm, api_key: e.target.value })} placeholder={easmForm.auth_style === "basic" ? t("vulnerabilities.api_username", "API username") : t("vulnerabilities.easm_api_key", "API key / token")} type={easmForm.auth_style === "basic" ? "text" : "password"} autoComplete="off" className={inputCls} />
                  {easmForm.auth_style === "basic" && (
                    <input value={connForm.api_secret} onChange={(e) => setConnForm({ ...connForm, api_secret: e.target.value })} placeholder={t("vulnerabilities.api_password", "API password")} type="password" autoComplete="new-password" className={inputCls} />
                  )}
                </div>
              )}
              {connIsEasm && renderEasmFields(easmForm, setEasmForm)}
              {connCanPull && (
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={connForm.schedule_enabled} onChange={(e) => setConnForm({ ...connForm, schedule_enabled: e.target.checked })} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    {t("vulnerabilities.auto_sync", "Automatic sync")}
                  </label>
                  {connForm.schedule_enabled && (
                    <select value={connForm.interval_hours} onChange={(e) => setConnForm({ ...connForm, interval_hours: Number(e.target.value) })} className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {SYNC_INTERVALS.map((i) => <option key={i.hours} value={i.hours}>{i.label}</option>)}
                    </select>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">{connForm.tool === "demo" ? t("vulnerabilities.demo_note", "Demo connector simulates a pull that matches your assets.") : connForm.tool === "openvas" ? t("vulnerabilities.openvas_note", "OpenVAS speaks GMP, not HTTP — it cannot be pulled. Export the report (XML or CSV) and use Import.") : connIsEasm ? t("vulnerabilities.easm_note", "Add, then click Test: it shows how the platform's fields were mapped.") : t("vulnerabilities.live_note", "Live pull needs a reachable scanner + valid credentials.")}</p>
                <button type="submit" disabled={addingConn} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {addingConn && <Loader2 className="w-4 h-4 animate-spin" />} {t("vulnerabilities.add", "Add")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
